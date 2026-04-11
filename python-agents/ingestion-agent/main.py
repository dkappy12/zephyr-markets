#!/usr/bin/env python3
"""
Zephyr Markets ingestion agent — REMIT (Elexon BMRS) + weather (Open-Meteo ECMWF)
+ gas storage (GIE AGSI).

- REMIT: polls BMRS REMIT dataset → Supabase `signals` (PostgREST HTTP).
- Weather: polls Open-Meteo forecast → Supabase `weather_forecasts` (upsert by
  forecast_time + location).
- Storage: polls GIE AGSI → Supabase `storage_levels` (upsert by report_date +
  location).

Required Supabase:
  - signals: remit_message_id, type, title, description, direction, source,
    confidence, raw_data (jsonb)
  - weather_forecasts: see weather_forecasts.sql
  - storage_levels: see storage_levels.sql

Environment:
  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY — required
  ELEXON_API_KEY — optional; sent as APIKey query param when set
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
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

OPEN_METEO_FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
WEATHER_LAT = 54.0
WEATHER_LON = -2.0
WEATHER_LOCATION = "GB"
WEATHER_SOURCE = "Open-Meteo ECMWF"
WEATHER_POLL_MINUTES = 30

GIE_AGSI_API_URL = "https://agsi.gie.eu/api"
STORAGE_SOURCE = "GIE AGSI"
STORAGE_POLL_HOURS = 6

POLL_INTERVAL_SECONDS = 60
HTTP_TIMEOUT = 45.0
MAX_RETRIES = 6
INITIAL_BACKOFF_SEC = 1.0
MAX_BACKOFF_SEC = 60.0

SOURCE_LABEL = "Elexon BMRS"
SIGNAL_TYPE = "remit"
CONFIDENCE = "HIGH"

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
logging.basicConfig(level=logging.DEBUG, handlers=[_handler])
# Suppress verbose third-party DEBUG logs when the root level is DEBUG
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)
logger = logging.getLogger("bmrs-ingestion")
logger.setLevel(logging.DEBUG)


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


def _weather_forecasts_rest_url() -> str:
    base = SUPABASE_URL.rstrip("/")
    return f"{base}/rest/v1/weather_forecasts"


def _storage_levels_rest_url() -> str:
    base = SUPABASE_URL.rstrip("/")
    return f"{base}/rest/v1/storage_levels"


def _supabase_auth_headers() -> dict[str, str]:
    key = SUPABASE_SERVICE_ROLE_KEY
    return {
        "apikey": key,
        "Authorization": f"Bearer {key}",
    }


def _header_preview(value: str, max_len: int = 20) -> str:
    """First max_len characters only (for logging secrets)."""
    if not value:
        return ""
    return value[:max_len]


async def remit_message_exists_http(client: httpx.AsyncClient, message_id: str) -> bool:
    """Return True if a signal with this remit_message_id (mrid) is already stored."""
    if not message_id:
        return True
    try:
        q = quote(message_id, safe="")
        url = f"{_signals_rest_url()}?remit_message_id=eq.{q}&select=id"
        headers = _supabase_auth_headers()
        logger.debug(
            "remit_message_exists_http request: url=%s apikey_prefix=%r authorization_prefix=%r",
            url,
            _header_preview(headers.get("apikey", "")),
            _header_preview(headers.get("Authorization", "")),
        )
        resp = await client.get(url, headers=headers)
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
# Open-Meteo → weather_forecasts (upsert on forecast_time + location)
# -----------------------------------------------------------------------------


def _normalize_forecast_time_iso(t: str) -> str:
    """Ensure timestamptz-friendly ISO; Open-Meteo hourly times are UTC."""
    s = str(t).strip()
    if not s:
        return s
    if s.endswith("Z"):
        return s
    if "T" in s and "+" not in s and s.count("-") >= 2:
        return s + "Z"
    return s


def _hourly_float_at(hourly: dict[str, Any], key: str, i: int) -> float | None:
    raw = hourly.get(key)
    if not isinstance(raw, list) or i >= len(raw):
        return None
    v = raw[i]
    if v is None or v == "":
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def parse_open_meteo_hourly(payload: dict[str, Any]) -> list[dict[str, Any]]:
    """Build one row per hour for PostgREST (column names match weather_forecasts)."""
    hourly = payload.get("hourly") or {}
    times = hourly.get("time") or []
    if not isinstance(times, list):
        return []

    fetched_at = datetime.now(timezone.utc).isoformat()
    rows: list[dict[str, Any]] = []

    for i, t in enumerate(times):
        if not isinstance(t, str):
            continue
        w10 = _hourly_float_at(hourly, "windspeed_10m", i)
        if w10 is None:
            w10 = _hourly_float_at(hourly, "wind_speed_10m", i)
        w100 = _hourly_float_at(hourly, "windspeed_100m", i)
        if w100 is None:
            w100 = _hourly_float_at(hourly, "wind_speed_100m", i)
        t2 = _hourly_float_at(hourly, "temperature_2m", i)
        rad = _hourly_float_at(hourly, "direct_radiation", i)

        rows.append(
            {
                "forecast_time": _normalize_forecast_time_iso(t),
                "location": WEATHER_LOCATION,
                "wind_speed_10m": w10,
                "wind_speed_100m": w100,
                "temperature_2m": t2,
                "solar_radiation": rad,
                "source": WEATHER_SOURCE,
                "fetched_at": fetched_at,
            }
        )

    return rows


async def fetch_open_meteo_forecast(client: httpx.AsyncClient) -> dict[str, Any]:
    params = {
        "latitude": str(WEATHER_LAT),
        "longitude": str(WEATHER_LON),
        "hourly": "windspeed_10m,windspeed_100m,temperature_2m,direct_radiation",
        "wind_speed_unit": "ms",
        "forecast_days": "7",
        "timezone": "UTC",
    }
    resp = await client.get(
        OPEN_METEO_FORECAST_URL,
        params=params,
        timeout=HTTP_TIMEOUT,
    )
    resp.raise_for_status()
    return resp.json()


async def upsert_weather_forecasts_http(
    client: httpx.AsyncClient, rows: list[dict[str, Any]]
) -> None:
    """INSERT ... ON CONFLICT (forecast_time, location) DO UPDATE via PostgREST."""
    if not rows:
        return
    headers = {
        **_supabase_auth_headers(),
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=minimal",
    }
    resp = await client.post(
        _weather_forecasts_rest_url(),
        headers=headers,
        json=rows,
        params={"on_conflict": "forecast_time,location"},
    )
    resp.raise_for_status()


async def run_weather_cycle() -> None:
    """Fetch ECMWF hourly forecast from Open-Meteo and upsert into weather_forecasts."""
    _require_supabase_env()
    async with httpx.AsyncClient(
        headers={
            "Accept": "application/json",
            "User-Agent": "ZephyrMarkets-Weather-Ingestion/1.0",
        },
        follow_redirects=True,
    ) as http:
        payload = await fetch_open_meteo_forecast(http)
        rows = parse_open_meteo_hourly(payload)
        n = len(rows)
        if n == 0:
            logger.info("weather_cycle: no hourly rows from Open-Meteo")
            return
        await upsert_weather_forecasts_http(http, rows)
        logger.info(
            "weather_cycle: upserted %s forecast hours (location=%s, source=%s)",
            n,
            WEATHER_LOCATION,
            WEATHER_SOURCE,
        )


def scheduled_weather() -> None:
    try:
        asyncio.run(run_weather_cycle())
    except Exception as e:
        logger.error("Weather cycle aborted: %s", e, exc_info=True)


# -----------------------------------------------------------------------------
# GIE AGSI → storage_levels (upsert on report_date + location)
# -----------------------------------------------------------------------------


def _agsi_parse_float(raw: Any) -> float | None:
    if raw is None:
        return None
    s = str(raw).strip()
    if not s or s == "-":
        return None
    try:
        return float(s)
    except (TypeError, ValueError):
        return None


def _agsi_row_to_storage_record(
    item: dict[str, Any],
    location: str,
    gas_day_fallback: str,
    fetched_at: str,
) -> dict[str, Any] | None:
    """Map one AGSI row object to a PostgREST row (volumes as TWh per AGSI JSON)."""
    day = (item.get("gasDayStart") or gas_day_fallback or "").strip()
    if not day:
        return None

    full = _agsi_parse_float(item.get("full"))
    wgv = _agsi_parse_float(item.get("workingGasVolume"))
    inj = _agsi_parse_float(item.get("injection"))
    wd = _agsi_parse_float(item.get("withdrawal"))

    return {
        "report_date": day,
        "location": location,
        "full_pct": full,
        "working_volume_twh": wgv,
        "injection_twh": inj,
        "withdrawal_twh": wd,
        "source": STORAGE_SOURCE,
        "fetched_at": fetched_at,
    }


def _agsi_json_for_log(payload: Any) -> str:
    try:
        return json.dumps(payload, ensure_ascii=False, default=str)
    except (TypeError, ValueError):
        return repr(payload)


def _agsi_extract_items(payload: Any) -> tuple[list[dict[str, Any]], bool]:
    """
    Normalize AGSI JSON into a list of row dicts.

    Returns (rows, structure_ok). structure_ok is False when the payload cannot
    be interpreted (caller should log the raw body at WARNING).
    """
    if payload is None:
        return [], False

    if isinstance(payload, list):
        rows = [x for x in payload if isinstance(x, dict)]
        # Top-level array of rows — valid even if empty.
        return rows, True

    if not isinstance(payload, dict):
        return [], False

    data = payload.get("data")
    if isinstance(data, list):
        return [x for x in data if isinstance(x, dict)], True

    for key in ("results", "items", "records", "rows"):
        alt = payload.get(key)
        if isinstance(alt, list):
            return [x for x in alt if isinstance(x, dict)], True

    # Single row object without a wrapper (unusual but easy to support).
    if any(
        k in payload
        for k in (
            "gasDayStart",
            "workingGasVolume",
            "full",
            "gasInStorage",
            "injection",
            "withdrawal",
        )
    ):
        return [payload], True

    return [], False


def _agsi_select_row(items: list[dict[str, Any]]) -> dict[str, Any] | None:
    """Prefer EU-style aggregate row (`name` ~ aggregated); else first row."""
    if not items:
        return None
    for it in items:
        if str(it.get("name", "")).strip().lower() == "aggregated":
            return it
    return items[0]


async def fetch_agsi_json(
    client: httpx.AsyncClient, *, country: str, size: int, page: int
) -> Any:
    resp = await client.get(
        GIE_AGSI_API_URL,
        params={"country": country, "size": str(size), "page": str(page)},
        timeout=HTTP_TIMEOUT,
    )
    resp.raise_for_status()
    raw = resp.json()
    logger.debug(
        "agsi raw response country=%s size=%s page=%s: %s",
        country,
        size,
        page,
        _agsi_json_for_log(raw),
    )
    return raw


async def upsert_storage_levels_http(
    client: httpx.AsyncClient, rows: list[dict[str, Any]]
) -> None:
    if not rows:
        return
    headers = {
        **_supabase_auth_headers(),
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=minimal",
    }
    resp = await client.post(
        _storage_levels_rest_url(),
        headers=headers,
        json=rows,
        params={"on_conflict": "report_date,location"},
    )
    resp.raise_for_status()


def _agsi_gas_day_fallback(payload: Any) -> str:
    if isinstance(payload, dict):
        v = payload.get("gas_day")
        if v is not None and str(v).strip():
            return str(v).strip()
    return ""


async def run_storage_cycle() -> None:
    """Fetch GB + EU aggregate from GIE AGSI and upsert into storage_levels."""
    _require_supabase_env()
    fetched_at = datetime.now(timezone.utc).isoformat()

    async with httpx.AsyncClient(
        headers={
            "Accept": "application/json",
            "User-Agent": "ZephyrMarkets-Storage-Ingestion/1.0",
        },
        follow_redirects=True,
    ) as http:
        gb_payload = await fetch_agsi_json(http, country="GB", size=1, page=1)
        eu_payload = await fetch_agsi_json(http, country="eu", size=1, page=1)

        rows: list[dict[str, Any]] = []

        gb_items, gb_ok = _agsi_extract_items(gb_payload)
        if not gb_ok:
            logger.warning(
                "storage_cycle: unexpected AGSI JSON structure for GB; raw=%s",
                _agsi_json_for_log(gb_payload),
            )
        gas_day_gb = _agsi_gas_day_fallback(gb_payload)
        gb_item = _agsi_select_row(gb_items) if gb_ok else None
        if gb_ok and gb_item is None:
            logger.info(
                "storage_cycle: no AGSI data rows for GB (gas_day=%s)",
                gas_day_gb or "?",
            )
        elif gb_item is not None:
            rec = _agsi_row_to_storage_record(
                gb_item, "GB", gas_day_gb, fetched_at
            )
            if rec:
                rows.append(rec)
                logger.info(
                    "storage_cycle: GB gas_day=%s full_pct=%s working_volume_twh=%s "
                    "injection_twh=%s withdrawal_twh=%s",
                    rec["report_date"],
                    rec["full_pct"],
                    rec["working_volume_twh"],
                    rec["injection_twh"],
                    rec["withdrawal_twh"],
                )

        eu_items, eu_ok = _agsi_extract_items(eu_payload)
        if not eu_ok:
            logger.warning(
                "storage_cycle: unexpected AGSI JSON structure for EU; raw=%s",
                _agsi_json_for_log(eu_payload),
            )
        gas_day_eu = _agsi_gas_day_fallback(eu_payload)
        eu_item = _agsi_select_row(eu_items) if eu_ok else None
        if eu_ok and eu_item is None:
            logger.info(
                "storage_cycle: no AGSI data rows for EU aggregate "
                "(country=eu, gas_day=%s)",
                gas_day_eu or "?",
            )
        elif eu_item is not None:
            rec_eu = _agsi_row_to_storage_record(
                eu_item, "EU", gas_day_eu, fetched_at
            )
            if rec_eu:
                rows.append(rec_eu)
                logger.info(
                    "storage_cycle: EU gas_day=%s full_pct=%s working_volume_twh=%s "
                    "injection_twh=%s withdrawal_twh=%s",
                    rec_eu["report_date"],
                    rec_eu["full_pct"],
                    rec_eu["working_volume_twh"],
                    rec_eu["injection_twh"],
                    rec_eu["withdrawal_twh"],
                )

        if not rows:
            logger.info("storage_cycle: nothing to upsert (no AGSI rows)")
            return

        await upsert_storage_levels_http(http, rows)
        logger.info(
            "storage_cycle: upserted %s storage level row(s) (source=%s)",
            len(rows),
            STORAGE_SOURCE,
        )


def scheduled_storage() -> None:
    try:
        asyncio.run(run_storage_cycle())
    except Exception as e:
        logger.error("Storage cycle aborted: %s", e, exc_info=True)


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


def humanise_unavailability_enum(raw: str) -> str:
    """Long unavailability type enums: insert spaces before capitals for readability."""
    if not raw:
        return ""
    s = re.sub(r"([a-z])([A-Z])", r"\1 \2", raw)
    s = re.sub(r"([A-Z]+)([A-Z][a-z])", r"\1 \2", s)
    return s.strip()


def event_label_from_message_type(message_type: str) -> str:
    """
    Humanised event category for titles (from messageType, not unavailabilityType).
    Production is checked before Generation so combined names map to Production.
    """
    if not message_type:
        return "Grid Event"
    mt = message_type
    if "Production" in mt:
        return "Production Unavailability"
    if "Electricity" in mt or "Generation" in mt:
        return "Generation Outage"
    if "Consumption" in mt:
        return "Consumption Unavailability"
    return "Grid Event"


def format_event_time_utc(iso: str) -> str:
    """Format ISO instant as 'HH:MM UTC DD MMM' (e.g. 21:00 UTC 10 Apr)."""
    if not iso or not str(iso).strip():
        return ""
    s = str(iso).strip()
    try:
        if s.endswith("Z"):
            s = s[:-1] + "+00:00"
        dt = datetime.fromisoformat(s)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        dt = dt.astimezone(timezone.utc)
        months = (
            "Jan",
            "Feb",
            "Mar",
            "Apr",
            "May",
            "Jun",
            "Jul",
            "Aug",
            "Sep",
            "Oct",
            "Nov",
            "Dec",
        )
        return f"{dt.strftime('%H:%M UTC')} {dt.day} {months[dt.month - 1]}"
    except (ValueError, TypeError, OSError):
        return ""


def build_title(notice: dict[str, Any]) -> str:
    """{assetName} — event label from messageType (not Planned/Unplanned)."""
    asset = _get_str(notice, "assetName")
    if not asset:
        asset = _get_str(notice, "affectedUnit", "assetId")
    mt = _get_str(notice, "messageType", "MessageType")
    event_label = event_label_from_message_type(mt)
    if asset and event_label:
        return f"{asset} — {event_label}"
    if asset:
        return asset
    if event_label:
        return event_label
    return "REMIT notice"


def build_description(notice: dict[str, Any]) -> str:
    """
    "{assetName} derated by … {Planned|Unplanned} outage from … to …"
    Event category (Generation Outage, etc.) is only in the title, not here.
    """
    asset = _get_str(notice, "assetName", "affectedUnit") or "Unit"
    ucap = _get_str(notice, "unavailableCapacity", "UnavailableCapacity")
    ncap = _get_str(notice, "normalCapacity", "NormalCapacity")
    ut_raw = _get_str(notice, "unavailabilityType", "UnavailabilityType")
    es = format_event_time_utc(_get_str(notice, "eventStartTime", "EventStartTime"))
    ee = format_event_time_utc(_get_str(notice, "eventEndTime", "EventEndTime"))

    s1 = f"{asset} derated by {ucap or '—'}MW ({ncap or '—'}MW normal)."

    if ut_raw in ("Planned", "Unplanned"):
        plan_phrase = ut_raw
    elif ut_raw:
        plan_phrase = humanise_unavailability_enum(ut_raw)
    else:
        plan_phrase = ""

    if es and ee:
        if plan_phrase:
            s2 = f" {plan_phrase} outage from {es} to {ee}."
        else:
            s2 = f" Outage from {es} to {ee}."
    elif es:
        if plan_phrase:
            s2 = f" {plan_phrase} outage from {es}."
        else:
            s2 = f" Outage from {es}."
    elif ee:
        if plan_phrase:
            s2 = f" {plan_phrase} outage until {ee}."
        else:
            s2 = f" Outage until {ee}."
    else:
        s2 = f" {plan_phrase} outage." if plan_phrase else " Outage."

    return (s1 + s2).strip()


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


def supabase_startup_check() -> None:
    """
    Verify PostgREST is reachable with the service role key before polling.
    GET {SUPABASE_URL}/rest/v1/signals?select=id&limit=1
    """
    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        logger.error(
            "Supabase startup check skipped: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set"
        )
        return
    url = f"{SUPABASE_URL.rstrip('/')}/rest/v1/signals?select=id&limit=1"
    headers = _supabase_auth_headers()
    try:
        with httpx.Client(timeout=HTTP_TIMEOUT, follow_redirects=True) as client:
            resp = client.get(url, headers=headers)
        if resp.is_success:
            logger.info("Supabase startup check succeeded: HTTP %s", resp.status_code)
        else:
            logger.error("Supabase startup check failed: HTTP %s", resp.status_code)
    except httpx.HTTPError as e:
        logger.error("Supabase startup check failed: %s", e, exc_info=True)


def main() -> None:
    supabase_startup_check()

    logger.info(
        "Ingestion agent starting | REMIT every %ss (%s) | weather every %s min (%s) "
        "| GIE AGSI storage every %sh (%s)",
        POLL_INTERVAL_SECONDS,
        REMIT_DATASET_URL,
        WEATHER_POLL_MINUTES,
        OPEN_METEO_FORECAST_URL,
        STORAGE_POLL_HOURS,
        GIE_AGSI_API_URL,
    )

    scheduled_poll()
    scheduled_weather()
    scheduled_storage()
    schedule.every(POLL_INTERVAL_SECONDS).seconds.do(scheduled_poll)
    schedule.every(WEATHER_POLL_MINUTES).minutes.do(scheduled_weather)
    schedule.every(STORAGE_POLL_HOURS).hours.do(scheduled_storage)

    while True:
        schedule.run_pending()
        time.sleep(1)


if __name__ == "__main__":
    main()
