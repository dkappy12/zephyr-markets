#!/usr/bin/env python3
"""
Elexon BMRS REMIT ingestion agent — Zephyr Markets.

Polls the public BMRS API for active REMIT notices and upserts new rows into
Supabase `signals`. Intended to run continuously on Railway.

Required Supabase columns (add via migration if missing):
  - remit_message_id (text, unique) — deduplication key from REMIT messageId
  - type, title, description, direction, source, confidence, raw_data (jsonb)

Example: add remit_message_id (text) and a unique index on it for deduplication.

Environment:
  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY — required
  ELEXON_API_KEY — optional; sent as APIKey query param when set
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import sys
import time
from datetime import datetime, timezone
from typing import Any

import httpx
import schedule
from dotenv import load_dotenv
from supabase import Client, create_client

# -----------------------------------------------------------------------------
# Configuration
# -----------------------------------------------------------------------------

load_dotenv()

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").strip()
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
ELEXON_API_KEY = os.environ.get("ELEXON_API_KEY", "").strip()

REMIT_ACTIVE_URL = "https://data.elexon.co.uk/bmrs/api/v1/remit/list/active"

POLL_INTERVAL_SECONDS = 60
HTTP_TIMEOUT = 45.0
MAX_RETRIES = 6
INITIAL_BACKOFF_SEC = 1.0
MAX_BACKOFF_SEC = 60.0

SOURCE_LABEL = "Elexon BMRS"
SIGNAL_TYPE = "remit"
CONFIDENCE = "High"

# -----------------------------------------------------------------------------
# Logging — structured, Railway-friendly (stdout, no noisy libraries)
# -----------------------------------------------------------------------------

class _UtcFormatter(logging.Formatter):
    def formatTime(self, record: logging.LogRecord, datefmt: str | None = None) -> str:
        dt = datetime.fromtimestamp(record.created, tz=timezone.utc)
        if datefmt:
            return dt.strftime(datefmt)
        return dt.isoformat(timespec="seconds")


_handler = logging.StreamHandler(sys.stdout)
_handler.setFormatter(
    _UtcFormatter(
        fmt="%(asctime)s | %(levelname)s | %(message)s",
        datefmt="%Y-%m-%dT%H:%M:%SZ",
    )
)
logging.basicConfig(level=logging.INFO, handlers=[_handler])
logger = logging.getLogger("bmrs-ingestion")


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# -----------------------------------------------------------------------------
# Supabase
# -----------------------------------------------------------------------------


def create_supabase_client() -> Client:
    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        raise RuntimeError(
            "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in the environment."
        )
    return create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)


def remit_message_exists(client: Client, message_id: str) -> bool:
    """Return True if a signal with this REMIT message id is already stored."""
    if not message_id:
        return True  # skip invalid
    try:
        res = (
            client.table("signals")
            .select("id")
            .eq("remit_message_id", message_id)
            .limit(1)
            .execute()
        )
        rows = getattr(res, "data", None) or []
        return len(rows) > 0
    except Exception as e:
        logger.exception("Failed to query signals for remit_message_id=%s: %s", message_id, e)
        raise


def insert_signal(client: Client, row: dict[str, Any]) -> None:
    """Insert a signal row; PostgREST raises on constraint or permission errors."""
    client.table("signals").insert(row).execute()


# -----------------------------------------------------------------------------
# REMIT HTTP + parsing
# -----------------------------------------------------------------------------


def _parse_json_list(payload: Any) -> list[dict[str, Any]]:
    """Normalise BMRS JSON responses that may be a list or wrapped in an object."""
    if payload is None:
        return []
    if isinstance(payload, list):
        return [x for x in payload if isinstance(x, dict)]
    if isinstance(payload, dict):
        for key in ("data", "results", "items", "messages", "content"):
            inner = payload.get(key)
            if isinstance(inner, list):
                return [x for x in inner if isinstance(x, dict)]
        # Single object
        return [payload]
    return []


def _get_message_id(notice: dict[str, Any]) -> str | None:
    for key in ("messageId", "messageID", "MessageId", "MessageID", "id"):
        val = notice.get(key)
        if val is not None and str(val).strip():
            return str(val).strip()
    return None


def _get_str(notice: dict[str, Any], *keys: str) -> str:
    for k in keys:
        v = notice.get(k)
        if v is not None and str(v).strip():
            return str(v).strip()
    return ""


def _get_float(notice: dict[str, Any], *keys: str) -> float | None:
    for k in keys:
        v = notice.get(k)
        if v is None or v == "":
            continue
        try:
            return float(v)
        except (TypeError, ValueError):
            continue
    return None


def build_title(notice: dict[str, Any]) -> str:
    asset = _get_str(
        notice,
        "affectedAssetName",
        "affectedAsset",
        "assetName",
        "AssetName",
        "asset",
    )
    event = _get_str(
        notice,
        "eventType",
        "EventType",
        "event_type",
        "messageType",
        "MessageType",
    )
    if asset and event:
        return f"{asset} — {event}"
    if asset:
        return asset
    if event:
        return event
    return "REMIT notice"


def build_description(notice: dict[str, Any]) -> str:
    parts = [
        ("Unavailability type", _get_str(notice, "unavailabilityType", "UnavailabilityType")),
        ("Affected asset", _get_str(notice, "affectedAsset", "affectedAssetName", "AssetName")),
        (
            "Unavailable capacity (MW)",
            _get_str(notice, "unavailableCapacity", "UnavailableCapacity"),
        ),
        ("Normal capacity (MW)", _get_str(notice, "normalCapacity", "NormalCapacity")),
    ]
    lines = [f"{label}: {value}" for label, value in parts if value]
    if not lines:
        return json.dumps(notice, default=str)[:2000]
    return "\n".join(lines)


def classify_direction(unavailable_mw: float | None) -> str:
    """
    bear  — unavailable capacity > 200 MW
    watch — 50–200 MW inclusive
    neutral — below 50 MW or unknown
    """
    if unavailable_mw is None:
        return "neutral"
    if unavailable_mw > 200:
        return "bear"
    if unavailable_mw >= 50:
        return "watch"
    return "neutral"


def notice_to_row(notice: dict[str, Any]) -> dict[str, Any] | None:
    mid = _get_message_id(notice)
    if not mid:
        logger.warning("Skipping notice without messageId: %s", str(notice)[:200])
        return None

    unavailable = _get_float(notice, "unavailableCapacity", "UnavailableCapacity")

    return {
        "remit_message_id": mid,
        "type": SIGNAL_TYPE,
        "title": build_title(notice),
        "description": build_description(notice),
        "direction": classify_direction(unavailable),
        "source": SOURCE_LABEL,
        "confidence": CONFIDENCE,
        "raw_data": notice,
    }


async def fetch_remit_notices_http(client: httpx.AsyncClient) -> list[dict[str, Any]]:
    """GET active REMIT list with exponential backoff on transport/5xx errors."""
    params: dict[str, str] = {}
    if ELEXON_API_KEY:
        params["APIKey"] = ELEXON_API_KEY

    delay = INITIAL_BACKOFF_SEC
    last_error: Exception | None = None

    for attempt in range(1, MAX_RETRIES + 1):
        try:
            resp = await client.get(
                REMIT_ACTIVE_URL,
                params=params or None,
                timeout=HTTP_TIMEOUT,
            )
            resp.raise_for_status()
            payload = resp.json()
            notices = _parse_json_list(payload)
            return notices
        except httpx.HTTPStatusError as e:
            code = e.response.status_code
            body_preview = (e.response.text or "")[:200]
            # Do not retry permanent client errors (except 429 rate limit)
            if code < 500 and code != 429:
                logger.error(
                    "BMRS returned client error %s (no retry): %s",
                    code,
                    body_preview,
                )
                raise
            last_error = e
            logger.warning(
                "BMRS HTTP %s (attempt %s/%s): %s — backing off %.1fs",
                code,
                attempt,
                MAX_RETRIES,
                body_preview,
                delay,
            )
        except httpx.RequestError as e:
            last_error = e
            logger.warning(
                "BMRS request failed (attempt %s/%s): %s — backing off %.1fs",
                attempt,
                MAX_RETRIES,
                e,
                delay,
            )
        except (json.JSONDecodeError, ValueError) as e:
            last_error = e
            logger.warning(
                "BMRS JSON parse failed (attempt %s/%s): %s — backing off %.1fs",
                attempt,
                MAX_RETRIES,
                e,
                delay,
            )

        if attempt >= MAX_RETRIES:
            break
        await asyncio.sleep(delay)
        delay = min(delay * 2, MAX_BACKOFF_SEC)

    assert last_error is not None
    logger.error("BMRS REMIT fetch exhausted retries: %s", last_error)
    raise last_error


async def run_poll_cycle(supabase: Client) -> None:
    """One poll: fetch notices, insert new signals, log summary."""
    ts = _utc_now_iso()
    new_count = 0

    async with httpx.AsyncClient(
        headers={"Accept": "application/json", "User-Agent": "ZephyrMarkets-BMRS-Ingestion/1.0"},
        follow_redirects=True,
    ) as http:
        notices = await fetch_remit_notices_http(http)

    total = len(notices)
    skipped = 0

    for notice in notices:
        row = notice_to_row(notice)
        if row is None:
            skipped += 1
            continue
        mid = row["remit_message_id"]
        try:
            if remit_message_exists(supabase, mid):
                continue
            insert_signal(supabase, row)
            new_count += 1
            logger.info("Inserted REMIT signal remit_message_id=%s title=%s", mid, row["title"][:120])
        except Exception:
            logger.exception("Failed to process notice messageId=%s", mid)
            raise

    logger.info(
        "poll_cycle ts=%s notices_total=%s new_inserted=%s skipped_no_id=%s",
        ts,
        total,
        new_count,
        skipped,
    )


def scheduled_poll() -> None:
    """Sync entrypoint for schedule — runs async poll in a fresh loop."""
    try:
        supabase = create_supabase_client()
        asyncio.run(run_poll_cycle(supabase))
    except Exception as e:
        logger.error("Poll cycle aborted: %s", e, exc_info=True)


def main() -> None:
    logger.info(
        "BMRS ingestion agent starting | poll every %ss | REMIT URL=%s",
        POLL_INTERVAL_SECONDS,
        REMIT_ACTIVE_URL,
    )

    # First run immediately, then every 60 seconds via schedule
    scheduled_poll()
    schedule.every(POLL_INTERVAL_SECONDS).seconds.do(scheduled_poll)

    while True:
        schedule.run_pending()
        time.sleep(1)


if __name__ == "__main__":
    main()
