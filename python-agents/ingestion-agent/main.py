#!/usr/bin/env python3
"""
Elexon BMRS REMIT ingestion agent — Zephyr Markets.

Polls the public BMRS API for active REMIT notices and inserts new rows into
Supabase `signals` via the PostgREST HTTP API (no supabase-py client).

Required Supabase columns (add via migration if missing):
  - remit_message_id (text, unique) — deduplication key from REMIT notice mrid
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
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import quote

import httpx
import schedule
from dotenv import load_dotenv

# -----------------------------------------------------------------------------
# Configuration
# -----------------------------------------------------------------------------

load_dotenv()

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").strip()
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
ELEXON_API_KEY = os.environ.get("ELEXON_API_KEY", "").strip()

REMIT_DATASET_URL = "https://data.elexon.co.uk/bmrs/api/v1/datasets/REMIT"

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


def _remit_publish_window_iso() -> tuple[str, str]:
    """Return (publishDateTimeFrom, publishDateTimeTo) as ISO 8601 UTC strings."""
    now = datetime.now(timezone.utc)
    start = now - timedelta(minutes=70)
    fmt = "%Y-%m-%dT%H:%M:%SZ"
    return start.strftime(fmt), now.strftime(fmt)


# -----------------------------------------------------------------------------
# Supabase PostgREST (direct httpx — no supabase Python package)
# -----------------------------------------------------------------------------


def _require_supabase_env() -> None:
    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        raise RuntimeError(
            "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in the environment."
        )


def _signals_rest_url() -> str:
    base = SUPABASE_URL.rstrip("/")
    return f"{base}/rest/v1/signals"


def _supabase_auth_headers() -> dict[str, str]:
    key = SUPABASE_SERVICE_ROLE_KEY
    return {
        "apikey": key,
        "Authorization": f"Bearer {key}",
    }


async def remit_message_exists_http(client: httpx.AsyncClient, message_id: str) -> bool:
    """Return True if a signal with this remit_message_id (mrid) is already stored."""
    if not message_id:
        return True
    try:
        q = quote(message_id, safe="")
        url = f"{_signals_rest_url()}?remit_message_id=eq.{q}&select=id"
        resp = await client.get(url, headers=_supabase_auth_headers())
        resp.raise_for_status()
        rows = resp.json()
        return isinstance(rows, list) and len(rows) > 0
    except Exception as e:
        logger.exception("Failed to query signals for remit_message_id=%s: %s", message_id, e)
        raise


async def insert_signal_http(client: httpx.AsyncClient, row: dict[str, Any]) -> None:
    """Insert a signal row via PostgREST."""
    headers = {
        **_supabase_auth_headers(),
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }
    resp = await client.post(_signals_rest_url(), headers=headers, json=row)
    resp.raise_for_status()


# -----------------------------------------------------------------------------
# REMIT HTTP + parsing
# -----------------------------------------------------------------------------


def _parse_remit_dataset(payload: Any) -> list[dict[str, Any]]:
    """Extract REMIT rows from Insights Solution JSON (primary: top-level 'data' array).

    Each row should include an 'mrid' used downstream as the unique deduplication key.
    """
    if payload is None:
        return []
    if isinstance(payload, dict):
        data = payload.get("data")
        if isinstance(data, list):
            return [x for x in data if isinstance(x, dict)]
    if isinstance(payload, list):
        return [x for x in payload if isinstance(x, dict)]
    if isinstance(payload, dict):
        for key in ("results", "items", "messages", "content"):
            inner = payload.get(key)
            if isinstance(inner, list):
                return [x for x in inner if isinstance(x, dict)]
        return [payload]
    return []


def _get_remit_mrid(notice: dict[str, Any]) -> str | None:
    """Unique key for dedup: Elexon REMIT mrid (legacy id/messageId as fallback)."""
    val = notice.get("mrid")
    if val is not None and str(val).strip():
        return str(val).strip()
    for key in ("messageId", "messageID", "MessageId", "MessageID", "id"):
        v = notice.get(key)
        if v is not None and str(v).strip():
            return str(v).strip()
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
    """Human-readable title from REMIT dataset fields (assetName, messageType, etc.)."""
    asset = _get_str(notice, "assetName", "affectedUnit")
    if not asset:
        asset = _get_str(notice, "assetId")
    event = _get_str(notice, "messageType", "unavailabilityType")
    if asset and event:
        return f"{asset} — {event}"
    if asset:
        return asset
    if event:
        return event
    return "REMIT notice"


def build_description(notice: dict[str, Any]) -> str:
    """Lines for whichever of the standard REMIT fields are present."""
    parts: list[tuple[str, str]] = [
        ("MRID", _get_str(notice, "mrid")),
        ("Message type", _get_str(notice, "messageType")),
        ("Revision", _get_str(notice, "revisionNumber")),
        ("Publish time", _get_str(notice, "publishTime")),
        ("Unavailability type", _get_str(notice, "unavailabilityType")),
        ("Asset ID", _get_str(notice, "assetId")),
        ("Asset name", _get_str(notice, "assetName")),
        ("Affected unit", _get_str(notice, "affectedUnit")),
        ("Unavailable capacity (MW)", _get_str(notice, "unavailableCapacity")),
        ("Normal capacity (MW)", _get_str(notice, "normalCapacity")),
        ("Event start", _get_str(notice, "eventStartTime")),
        ("Event end", _get_str(notice, "eventEndTime")),
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
    mid = _get_remit_mrid(notice)
    if not mid:
        logger.warning("Skipping notice without mrid: %s", str(notice)[:200])
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
    """GET REMIT dataset (publish window) with exponential backoff on transport/5xx errors."""
    publish_from, publish_to = _remit_publish_window_iso()
    params: dict[str, str] = {
        "publishDateTimeFrom": publish_from,
        "publishDateTimeTo": publish_to,
        "format": "json",
    }
    if ELEXON_API_KEY:
        params["APIKey"] = ELEXON_API_KEY

    delay = INITIAL_BACKOFF_SEC
    last_error: Exception | None = None

    for attempt in range(1, MAX_RETRIES + 1):
        try:
            resp = await client.get(
                REMIT_DATASET_URL,
                params=params,
                timeout=HTTP_TIMEOUT,
            )
            resp.raise_for_status()
            payload = resp.json()
            notices = _parse_remit_dataset(payload)
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


async def run_poll_cycle() -> None:
    """One poll: fetch notices, insert new signals, log summary."""
    _require_supabase_env()
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
                if await remit_message_exists_http(http, mid):
                    continue
                await insert_signal_http(http, row)
                new_count += 1
                logger.info("Inserted REMIT signal remit_message_id=%s title=%s", mid, row["title"][:120])
            except Exception:
                logger.exception("Failed to process notice remit_message_id=%s", mid)
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
        asyncio.run(run_poll_cycle())
    except Exception as e:
        logger.error("Poll cycle aborted: %s", e, exc_info=True)


def main() -> None:
    logger.info(
        "BMRS ingestion agent starting | poll every %ss | REMIT URL=%s",
        POLL_INTERVAL_SECONDS,
        REMIT_DATASET_URL,
    )

    # First run immediately, then every 60 seconds via schedule
    scheduled_poll()
    schedule.every(POLL_INTERVAL_SECONDS).seconds.do(scheduled_poll)

    while True:
        schedule.run_pending()
        time.sleep(1)


if __name__ == "__main__":
    main()
