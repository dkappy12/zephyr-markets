#!/usr/bin/env python3
"""
Zephyr Markets ingestion agent — REMIT (Elexon BMRS) + weather (Open-Meteo ECMWF)
+ gas storage (GIE AGSI) + N2EX MID market prices.

- REMIT: polls BMRS REMIT dataset → Supabase `signals` (PostgREST HTTP).
- Weather: polls Open-Meteo forecast → Supabase `weather_forecasts` (upsert by
  forecast_time + location).
- Storage: polls GIE AGSI (GB + DE/FR/IT/NL/AT) → Supabase `storage_levels`
  (upsert by report_date + location).
- N2EX MID: polls BMRS `datasets/MID` (optional `MID/stream` fallback) → Supabase
  `market_prices` (upsert by price_date + settlement_period + market).
- TTF/NBP gas: EEX NGP CSV → Supabase `gas_prices` (upsert on price_time + hub).
- FX rates: Frankfurter EUR/GBP daily fix → Supabase `fx_rates` (upsert on rate_date + base + quote).
- Carbon: Ember EUA + derived UKA → Supabase `carbon_prices` (upsert on price_date + hub).
- Solar: Sheffield Solar PV_Live API → Supabase `solar_outturn` (upsert on datetime_gmt).
- Physical premium: CCGT SRMC model → Supabase `physical_premium` (append-only history).
- Morning brief: Claude → Supabase `brief_entries` (append-only).

Required Supabase:
  - signals: remit_message_id, type, title, description, direction, source,
    confidence, raw_data (jsonb)
  - weather_forecasts: see weather_forecasts.sql
  - storage_levels: see storage_levels.sql
  - market_prices: see market_prices.sql
  - gas_prices: see gas_prices.sql
  - fx_rates: see fx_rates.sql
  - carbon_prices: price_date, hub, price_gbp_per_t, price_eur_per_t, source, fetched_at
  - solar_outturn: see solar_outturn.sql
  - physical_premium: see physical_premium.sql
  - brief_entries: see brief_entries.sql

Environment:
  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY — required
  RESEND_API_KEY — optional; required to send premium score email alerts
  ANTHROPIC_API_KEY — required for morning brief generation
  ELEXON_API_KEY — optional; sent as APIKey query param when set
  GIE_API_KEY — optional; sent as request header x-key for GIE AGSI (required for production API)
"""

from __future__ import annotations

import asyncio
import csv
import io
import json
import logging
import math
import os
from collections import defaultdict
import re
import sys
import threading
import time
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Any
from urllib.parse import quote, urljoin, urlparse
from zoneinfo import ZoneInfo

import httpx
import schedule
from dotenv import load_dotenv

# -----------------------------------------------------------------------------
# Configuration
# -----------------------------------------------------------------------------


def _normalize_anthropic_api_key(raw: str | None) -> str:
    """Strip whitespace, UTF-8 BOM, and optional surrounding quotes from pasted keys."""
    if not raw:
        return ""
    s = raw.strip().lstrip("\ufeff")
    if len(s) >= 2 and s[0] in "\"'":
        if s[-1] == s[0]:
            s = s[1:-1].strip()
    return s


def _anthropic_api_key() -> str:
    """Return the current Anthropic API key (read fresh from the environment)."""
    return _normalize_anthropic_api_key(os.environ.get("ANTHROPIC_API_KEY", ""))


# On Railway, secrets are injected at runtime. Do not load a local `.env` here — it can
# override `ANTHROPIC_API_KEY` with an empty or stale value if present in the image.
_RAILWAY_ENV = any(
    os.environ.get(k)
    for k in (
        "RAILWAY_ENVIRONMENT",
        "RAILWAY_PROJECT_ID",
        "RAILWAY_SERVICE_ID",
        "RAILWAY_REPLICA_ID",
        "RAILWAY_GIT_COMMIT_SHA",
    )
)
if not _RAILWAY_ENV:
    load_dotenv(override=False)

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").strip()
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
ELEXON_API_KEY = os.environ.get("ELEXON_API_KEY", "").strip()
GIE_API_KEY = os.environ.get("GIE_API_KEY", "").strip()
RESEND_API_KEY = os.environ.get("RESEND_API_KEY", "").strip()

REMIT_DATASET_URL = "https://data.elexon.co.uk/bmrs/api/v1/datasets/REMIT"
MID_DATASET_URL = "https://data.elexon.co.uk/bmrs/api/v1/datasets/MID"
MID_STREAM_URL = "https://data.elexon.co.uk/bmrs/api/v1/datasets/MID/stream"
MARKET_CODE_N2EX = "N2EX"
MARKET_CODE_APX = "APX"
MARKET_MID_SOURCE = "Elexon BMRS MID"
MARKET_INDEX_POLL_MINUTES = 30

TTF_NGP_CSV_URL = "https://gasandregistry.eex.com/Gas/NGP/TTF_NGP_15_Mins.csv"
STOOQ_NBP_QUOTE_URL = "https://stooq.com/q/l/?s=nf.f&i=d"

# Absolute sanity bounds on NBP close values published by the Stooq NF.F
# feed. These are write-time guardrails: if Stooq ever prints a value outside
# this band (feed glitch, wrong ticker, unit confusion) we skip the upsert
# rather than poison gas_prices. Modern-era NBP day-ahead has not traded
# below ~60 p/th since the UK ETS launched, and the 2022 war peaks stayed
# comfortably under 300 p/th at the daily-close level. The [30, 300] window
# is deliberately wide so a real but dramatic market move still goes
# through; the point is to catch structural errors like the 2026-04 Yahoo/
# TTF-derived backfill that wrote ~15 p/th rows because of a broken
# conversion. Keep in sync with NBP_LEVEL_FLOOR_PTH in the app's
# lib/portfolio/gas-aggregate.ts.
NBP_SANITY_MIN_PTH = 30.0
NBP_SANITY_MAX_PTH = 300.0

# Same defense applied to EUA/UKA carbon prices written by fetch_carbon_prices.
# EUA has traded €5-100/t across Phase 3 and Phase 4 of the EU ETS; we widen
# to €300/t at the top to allow for a genuine crisis-level spike without
# fighting the data. Values below €5/t suggest a unit-confusion bug (cents
# vs euros, $/tCO2e-of-CO2e vs $/tCO2) or a broken OilPriceAPI response.
# UKA is derived from EUA minus the ~£18 CPS in the same function, so a
# sane EUA implies a sane UKA automatically; we still guard it explicitly
# to catch a CPS-mispriced scenario or a broken FX rate.
EUA_SANITY_MIN_EUR_T = 5.0
EUA_SANITY_MAX_EUR_T = 300.0
UKA_SANITY_MIN_GBP_T = 5.0
UKA_SANITY_MAX_GBP_T = 300.0
OILPRICE_API_URL = "https://api.oilpriceapi.com/v1/prices/latest"
OILPRICE_API_KEY = os.environ.get("OILPRICE_API_KEY", "").strip()
ELEXON_FUELINST_URL = "https://data.elexon.co.uk/bmrs/api/v1/datasets/FUELINST"
PV_LIVE_GSP0_URL = "https://api.pvlive.uk/pvlive/api/v4/gsp/0"
GAS_PRICE_SOURCE_DEFAULT = "EEX NGP"
SOLAR_SOURCE_DEFAULT = "Sheffield Solar PV_Live"
HUB_TTF = "TTF"
HUB_NBP = "NBP"
HUB_EUA = "EUA"
HUB_UKA = "UKA"
# Reference URL for EUA market context (ingestion uses Ember API + DB fallback).
EEX_CARBON_CSV_URL = (
    "https://www.eex.com/en/market-data/environmental-markets/"
    "spot-market/european-emission-allowances"
)
TTF_POLL_MINUTES = 15
GAS_BACKFILL_DAYS = 180
SOLAR_POLL_MINUTES = 5

# Physical premium (CCGT SRMC merit order, Ward et al. 2019; Hagfors & Bunn 2016; Ghelasi & Ziel 2025)
GBP_EUR_RATE = 0.855
ETA_CCGT = 0.50
EF_TCO2_PER_MWH_EL = 0.37
UKA_PRICE_GBP_PER_T = float(os.environ.get("UKA_PRICE_GBP_T", "55.0"))
CPS_GBP_PER_T = 18.0
VOM_GBP_PER_MWH = 2.0
# GB installed wind capacity ~32 GW (2026). At 8 m/s mean wind speed,
# capacity factor ~45%, giving ~14.4 GW expected output.
# This constant is used as fallback only when BMRS FUELINST wind outturn is unavailable.
WIND_MS_TO_GW = 14.4 / 8.0
PHYSICAL_PREMIUM_SOURCE = "Zephyr Physical Model v1"
PHYSICAL_PREMIUM_POLL_MINUTES = 5
# v1.0.0 — initial hand-tuned coefficients
# v1.1.0 — 2026-04-13: piecewise RD premium recalibrated from observed market data,
#           demand baseline corrected for spring/summer conditions,
#           REMIT restructured as demand-side shift (Hagfors & Bunn 2016),
#           wind suppression made piecewise (ECIU 2024/2025)
# v1.2.0 — 2026-04-14: score divisor changed from 10 to 5,
#           seasonal demand baseline added (winter +18%, shoulder +8%),
#           wind outturn from Elexon FUELINST (actual not forecast),
#           renewable regime anchored to SRMC
# v1.3.0 — 2026-04-17: demand baseline recalibrated against observed N2EX market
#           prices. Previous flat profile (24/28/30/32 GW) was 4-7 GW too low
#           during morning and evening peaks. New hourly profile correctly
#           captures morning peak (34 GW at 07:00), midday solar trough (26 GW),
#           and evening peak (35.5 GW at 19:00). Summer multiplier added (x0.92).
PREMIUM_MODEL_VERSION = "v1.3.0"

# Kalman filter — initial coefficient state (matches v1.3.0 hand-calibrated values)
KF_INITIAL_COEFFS = [0.00, 0.50, 1.50, 5.00, 20.00, 3.50, 2.50, 4.50]  # [b1,b2,b3,b4,b5,w1,w2,w3]

# Live coefficient state — updated by Kalman job when a promotion occurs
# None means use the hardcoded constants in _residual_demand_premium_gbp_mwh
# and _wind_price_suppression_gbp_mwh
_KALMAN_LIVE_COEFFS: list[float] | None = None

# Kalman filter — process noise Q (diagonal variances per day, from research paper)
KF_Q_DIAG = [3e-8, 1.7e-6, 1.5e-5, 4.4e-4, 5e-4, 1.1e-4, 5.7e-5, 2.6e-4]

# Kalman filter — initial covariance P0 (diagonal, moderate confidence in hand-tuned priors)
KF_P0_DIAG = [0.0025, 0.0225, 0.20, 4.00, 100.0, 0.39, 0.20, 1.96]

# Kalman filter — observation noise variance R
KF_R = 36.0  # (6 £/MWh)^2

# Kalman filter — RD piecewise breakpoints [GW]
KF_RD_BREAKPOINTS = [0.0, 20.0, 28.0, 32.0, 35.0]

# Kalman filter — wind piecewise breakpoints [GW]
KF_WIND_BREAKPOINTS = [0.0, 5.0, 15.0]

# Kalman filter — minimum filled days before trusting posterior
KF_MIN_FILLED_DAYS = 10

# Kalman filter — per-segment minimum observation counts (last 30 days)
KF_MIN_OBS_PER_SEGMENT = {"b2": 50, "b3": 30, "b4": 20, "b5": 10, "w1": 40, "w2": 30, "w3": 15}

# Kalman filter — physical plausibility bounds for each coefficient
KF_BOUNDS = {
    "b1": (0.0, 0.01),
    "b2": (0.0, 3.0),
    "b3": (0.0, 6.0),
    "b4": (1.0, 15.0),
    "b5": (5.0, 50.0),
    "w1": (0.5, 5.0),
    "w2": (0.5, 5.0),
    "w3": (0.5, 8.0),
}


# Governance REST: tables may live in `governance` schema — expose them in PostgREST or use
# Accept-Profile as needed. Writes require SUPABASE_SERVICE_ROLE_KEY (see _supabase_auth_headers()).


def _governance_model_versions_url() -> str:
    return f"{SUPABASE_URL.rstrip('/')}/rest/v1/model_versions"


def _governance_coefficient_updates_url() -> str:
    return f"{SUPABASE_URL.rstrip('/')}/rest/v1/coefficient_updates"


def _supabase_governance_headers() -> dict:
    """Headers for PostgREST requests to the governance schema."""
    return {
        **_supabase_auth_headers(),
        "Accept-Profile": "governance",
        "Content-Profile": "governance",
    }


def _supabase_ops_headers() -> dict:
    """Headers for PostgREST requests to the ops schema."""
    return {
        **_supabase_auth_headers(),
        "Accept-Profile": "ops",
        "Content-Profile": "ops",
    }


async def _update_pipeline_health(
    client: httpx.AsyncClient,
    feed_id: str,
    success: bool,
    last_value: dict | None = None,
    error: str | None = None,
) -> None:
    """
    Upsert a row into ops.pipeline_health to record the outcome of a feed cycle.
    Called at the end of each scheduled feed function — success or failure.
    Fails silently so pipeline health writes never break the actual feed cycle.
    """
    try:
        now = datetime.now(timezone.utc).isoformat()
        payload: dict[str, Any] = {
            "last_attempt_ts": now,
            "updated_at": now,
        }
        if success:
            payload["last_success_ts"] = now
            payload["last_error"] = None
            payload["consecutive_failures"] = 0
            if last_value is not None:
                payload["last_value"] = last_value
            payload["staleness_status"] = "fresh"
        else:
            payload["last_error"] = str(error)[:500] if error else "Unknown error"
            payload["staleness_status"] = "stale"

        resp = await client.patch(
            f"{SUPABASE_URL.rstrip('/')}/rest/v1/pipeline_health",
            headers={
                **_supabase_ops_headers(),
                "Content-Type": "application/json",
                "Prefer": "return=minimal",
            },
            json=payload,
            params={"feed_id": f"eq.{feed_id}"},
        )
        resp.raise_for_status()
    except Exception as e:
        logger.debug("pipeline_health: write failed for %s: %s", feed_id, e)


# Future: ops.pipeline_health lives in the ops schema — use Accept-Profile: ops for those requests.


def demand_baseline_gw_utc(hour: int, month: int | None = None) -> float:
    """
    GB electricity demand baseline by UTC hour, seasonally adjusted.

    Recalibrated 2026-04-17 against observed N2EX market prices.
    Previous flat profile (24/28/30/32 GW) was systematically wrong —
    missing morning and evening peaks by 4-7 GW, and overstating midday demand.

    April base profile reflects actual GB half-hourly demand shape:
    - Overnight trough: 22-24 GW (00:00-05:00 UTC)
    - Morning ramp: 28-34 GW (05:00-09:00 UTC) — previous baseline was 7 GW too low
    - Daytime plateau: 26-29 GW (09:00-16:00 UTC) — solar suppresses net demand
    - Evening peak: 33-36 GW (16:00-20:00 UTC) — previous baseline was 4 GW too low
    - Late evening: 27-30 GW (20:00-23:00 UTC)

    Seasonal multipliers applied on top of April base:
    - Winter (Nov-Feb): x1.18
    - Shoulder (Mar, Oct): x1.08
    - Summer (Jun-Aug): x0.92 (solar suppression, lower heating)
    - Spring/Autumn (Apr-May, Sep): x1.00 (base)
    """
    # April base profile — hourly resolution
    APRIL_BASE = {
        0:  23.0,   # 00:00 UTC — overnight trough
        1:  22.5,   # 01:00
        2:  22.0,   # 02:00
        3:  22.0,   # 03:00
        4:  22.5,   # 04:00
        5:  25.0,   # 05:00 — morning ramp begins
        6:  30.0,   # 06:00 — morning peak building
        7:  34.0,   # 07:00 — peak morning demand
        8:  34.0,   # 08:00
        9:  31.0,   # 09:00 — daytime plateau
        10: 29.0,   # 10:00
        11: 27.5,   # 11:00 — solar suppressing net demand
        12: 26.5,   # 12:00 — midday trough
        13: 26.0,   # 13:00
        14: 26.5,   # 14:00
        15: 27.5,   # 15:00
        16: 30.0,   # 16:00 — evening ramp begins
        17: 33.0,   # 17:00
        18: 35.0,   # 18:00 — evening peak
        19: 35.5,   # 19:00 — peak evening demand
        20: 34.0,   # 20:00
        21: 31.0,   # 21:00
        22: 28.0,   # 22:00
        23: 25.5,   # 23:00
    }

    base = APRIL_BASE.get(hour, 27.0)

    if month is None:
        return base

    # Seasonal multipliers
    if month in (11, 12, 1, 2):
        return base * 1.18   # winter
    if month in (3, 10):
        return base * 1.08   # shoulder
    if month in (6, 7, 8):
        return base * 0.92   # summer
    # Apr, May, Sep — base profile
    return base

CLAUDE_BRIEF_MODEL = "claude-haiku-4-5-20251001"
# Further reading step 2 (JSON format only, no tools).
CLAUDE_ARTICLES_FORMAT_MODEL = "claude-haiku-4-5-20251001"
BRIEF_SOURCE = "Claude claude-haiku-4-5-20251001"

# Further reading: strip articles from these URL substrings before storing (backend guardrail).
BLOCKED_DOMAINS = [
    "wafa.ps",
    "aljazeera",
    "presstv",
    "rt.com",
    "sputnik",
    "middleeasteye",
    "electronicintifada",
    "mondoweiss",
    "memo.co.uk",
    "palestinechronicle",
]
_ANTHROPIC_RAW = os.environ.get("ANTHROPIC_API_KEY", "")
ANTHROPIC_API_KEY = _normalize_anthropic_api_key(_ANTHROPIC_RAW)
if ANTHROPIC_API_KEY:
    os.environ["ANTHROPIC_API_KEY"] = ANTHROPIC_API_KEY
ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages"

OPEN_METEO_FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
WEATHER_LAT = 54.0
WEATHER_LON = -2.0
WEATHER_LOCATION = "GB"
WEATHER_SOURCE = "Open-Meteo ECMWF"
WEATHER_POLL_MINUTES = 30

GIE_AGSI_API_URL = "https://agsi.gie.eu/api"
STORAGE_SOURCE = "GIE AGSI"
STORAGE_POLL_HOURS = 6
# GB plus top EU storage markets (country=eu aggregate often returns no rows).
STORAGE_COUNTRY_CODES = ("GB", "DE", "FR", "IT", "NL", "AT")
# First Open-Meteo fetch on startup uses asyncio.sleep(this many seconds) to avoid 429s when
# a new deploy overlaps the previous instance's startup fetch.
WEATHER_START_DELAY_SECONDS = 60

POLL_INTERVAL_SECONDS = 60
HTTP_TIMEOUT = 45.0

# Cooldown between premium-score alert emails per user (module-local; resets on process restart).
PREMIUM_ALERT_EMAIL_COOLDOWN_SEC = 3600
_PREMIUM_ALERT_LAST_SENT_AT: dict[str, float] = {}
# Price-move alerts: at most one email per (user_id, threshold_type) per UTC calendar day (job run date).
_PRICE_MOVE_ALERT_LAST_SENT_DAY: dict[tuple[str, str], str] = {}
MAX_RETRIES = 6
INITIAL_BACKOFF_SEC = 1.0
MAX_BACKOFF_SEC = 60.0

SOURCE_LABEL = "Elexon BMRS"
SIGNAL_TYPE = "remit"
# Confidence is now derived per-notice in classify_confidence()

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

_ak = _anthropic_api_key()
if _ak:
    logger.info(
        "anthropic: API key loaded prefix=%s len=%d",
        _ak[:15] + ("…" if len(_ak) > 15 else ""),
        len(_ak),
    )
else:
    logger.warning("anthropic: ANTHROPIC_API_KEY not set — morning brief will be skipped")


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


def _market_prices_rest_url() -> str:
    base = SUPABASE_URL.rstrip("/")
    return f"{base}/rest/v1/market_prices"


def _gas_prices_rest_url() -> str:
    base = SUPABASE_URL.rstrip("/")
    return f"{base}/rest/v1/gas_prices"


def _solar_outturn_rest_url() -> str:
    base = SUPABASE_URL.rstrip("/")
    return f"{base}/rest/v1/solar_outturn"


def _fx_rates_rest_url() -> str:
    base = SUPABASE_URL.rstrip("/")
    return f"{base}/rest/v1/fx_rates"


def _carbon_prices_rest_url() -> str:
    base = SUPABASE_URL.rstrip("/")
    return f"{base}/rest/v1/carbon_prices"


def _physical_premium_rest_url() -> str:
    base = SUPABASE_URL.rstrip("/")
    return f"{base}/rest/v1/physical_premium"


def _alerts_rest_url() -> str:
    base = SUPABASE_URL.rstrip("/")
    return f"{base}/rest/v1/alerts"


def _admin_job_log_rest_url() -> str:
    base = SUPABASE_URL.rstrip("/")
    return f"{base}/rest/v1/admin_job_log"


def _premium_predictions_rest_url() -> str:
    base = SUPABASE_URL.rstrip("/")
    return f"{base}/rest/v1/premium_predictions"


def _current_settlement_period(now_utc: datetime) -> int:
    """GB settlement periods: SP1 = 00:00-00:30 UTC, SP2 = 00:30-01:00, etc.
    SP = floor(minutes_since_midnight / 30) + 1, capped at 48."""
    minutes = now_utc.hour * 60 + now_utc.minute
    sp = (minutes // 30) + 1
    return min(sp, 48)


def _brief_entries_rest_url() -> str:
    base = SUPABASE_URL.rstrip("/")
    return f"{base}/rest/v1/brief_entries"


def _supabase_auth_headers() -> dict[str, str]:
    key = SUPABASE_SERVICE_ROLE_KEY
    return {
        "apikey": key,
        "Authorization": f"Bearer {key}",
    }


# -----------------------------------------------------------------------------
# Kalman self-improvement (piecewise RD + wind coefficients)
# -----------------------------------------------------------------------------


def _build_kalman_observation_vector(effective_rd: float, wind_gw: float) -> list[float]:
    """
    Build the F_t observation row vector for the Kalman filter.

    State vector x = [b1, b2, b3, b4, b5, w1, w2, w3]
    Observation equation: y_t - SRMC_t = F_t @ x_t + v_t

    F_t contains saturated segment widths:
    - RD segments (positive): how much of each RD segment is activated
    - Wind segments (negative): how much of each wind segment is activated

    Example: effective_rd=30, wind=8
    F_t = [20, 8, 2, 0, 0, -5, -3, 0]
    RD: seg1=min(30,20)=20, seg2=min(30-20,8)=8, seg3=min(30-28,4)=2, seg4=0, seg5=0
    Wind: seg1=-min(8,5)=-5, seg2=-min(8-5,10)=-3, seg3=0
    """
    rd_bp = KF_RD_BREAKPOINTS  # [0, 20, 28, 32, 35]
    w_bp = KF_WIND_BREAKPOINTS  # [0, 5, 15]

    # RD segments (5 segments, positive contribution)
    rd_segs = []
    for i in range(len(rd_bp) - 1):
        lo, hi = rd_bp[i], rd_bp[i + 1]
        seg = max(0.0, min(effective_rd, hi) - lo)
        rd_segs.append(seg)
    # Segment 5: above 35 GW
    rd_segs.append(max(0.0, effective_rd - rd_bp[-1]))

    # Wind segments (3 segments, negative contribution)
    w_segs = []
    for i in range(len(w_bp) - 1):
        lo, hi = w_bp[i], w_bp[i + 1]
        seg = max(0.0, min(wind_gw, hi) - lo)
        w_segs.append(-seg)  # negative — wind suppresses price
    # Segment 3: above 15 GW
    w_segs.append(-max(0.0, wind_gw - w_bp[-1]))

    return rd_segs + w_segs  # 8 elements: [b1_act, b2_act, ...]


def _run_kalman_filter(
    observations: list[dict],
    prior_coeffs: list[float],
    prior_cov: list[list[float]],
) -> dict:
    """
    Run standard linear Kalman filter over a set of filled prediction observations.

    Each observation dict must have:
      - effective_rd_gw: float
      - wind_gw: float
      - actual_price_gbp_mwh: float
      - srmc_gbp_mwh: float
      - prediction_timestamp: str (ISO)

    Returns dict with:
      - posterior_coeffs: list[float] (8 values)
      - posterior_cov: list[list[float]] (8x8)
      - innovations: list[float]
      - log_likelihood: float
      - n_processed: int
      - kalman_gain_summary: dict
    """
    import numpy as np

    n = len(prior_coeffs)  # 8
    x = np.array(prior_coeffs, dtype=float)
    P = np.array(prior_cov, dtype=float)
    Q = np.diag(KF_Q_DIAG)
    R = KF_R

    innovations = []
    log_likelihood = 0.0
    n_processed = 0
    last_K = None

    sorted_obs = sorted(observations, key=lambda r: r.get("prediction_timestamp", ""))

    for obs in sorted_obs:
        try:
            rd = float(obs["effective_rd_gw"] or 0)
            wind = float(obs["wind_gw"] or 0)
            actual = float(obs["actual_price_gbp_mwh"])
            srmc = float(obs["srmc_gbp_mwh"] or 90.0)
        except (TypeError, ValueError, KeyError):
            continue

        y = actual - srmc
        F = np.array(_build_kalman_observation_vector(rd, wind), dtype=float)

        P_pred = P + Q

        y_hat = float(F @ x)
        innovation = y - y_hat

        S = float(F @ P_pred @ F) + R
        if S <= 0:
            continue
        if abs(innovation) > 3.0 * (S**0.5):
            logger.debug("kalman: outlier skipped innovation=%.2f S=%.2f", innovation, S)
            continue

        K = (P_pred @ F) / S

        x = x + K * innovation
        P = P_pred - np.outer(K, F) @ P_pred

        log_likelihood += -0.5 * (np.log(2 * np.pi * S) + (innovation**2) / S)

        innovations.append(float(innovation))
        last_K = K
        n_processed += 1

    # Apply monotonicity projection: b1 <= b2 <= b3 <= b4 <= b5, all >= 0
    b = list(x[:5])
    b[0] = max(0.0, b[0])
    for i in range(1, 5):
        b[i] = max(b[i], b[i - 1])
    x[:5] = b

    bounds_list = [
        KF_BOUNDS["b1"],
        KF_BOUNDS["b2"],
        KF_BOUNDS["b3"],
        KF_BOUNDS["b4"],
        KF_BOUNDS["b5"],
        KF_BOUNDS["w1"],
        KF_BOUNDS["w2"],
        KF_BOUNDS["w3"],
    ]
    for i, (lo, hi) in enumerate(bounds_list):
        x[i] = max(lo, min(hi, x[i]))

    kalman_gain_summary: dict[str, float] = {}
    if last_K is not None:
        names = ["b1", "b2", "b3", "b4", "b5", "w1", "w2", "w3"]
        kalman_gain_summary = {names[i]: round(float(last_K[i]), 6) for i in range(n)}

    return {
        "posterior_coeffs": x.tolist(),
        "posterior_cov": P.tolist(),
        "innovations": innovations,
        "log_likelihood": float(log_likelihood),
        "n_processed": n_processed,
        "kalman_gain_summary": kalman_gain_summary,
    }


def _run_promotion_gates(
    challenger_coeffs: list[float],
    prior_coeffs: list[float],
    champion_errors: list[float],
    challenger_errors: list[float],
    n_filled_days: int,
    regime_errors: dict,
) -> dict:
    """
    Run 6 promotion gates. Returns dict with gate results and overall decision.

    Gates (evaluated in order, hard fail stops evaluation):
    1. Sample size: n_paired >= 288
    2. MAE improvement: >= 2%
    3. HLN-DM significance: p < 0.05 (relaxed from 0.01 for warm-up period)
    4. Coefficient stability: max relative change < 50%
    5. Regime balance: improvement in >= 2 of 3 regimes
    6. Economic plausibility: all coefficients within KF_BOUNDS
    """
    import numpy as np
    from scipy import stats as scipy_stats

    gates = {}
    soft_fails = 0

    n = len(champion_errors)

    gate1_pass = n >= 288
    gates["g1_sample"] = {
        "pass": gate1_pass,
        "value": n,
        "threshold": 288,
        "type": "hard",
    }
    if not gate1_pass:
        return {
            "gates": gates,
            "decision": "reject",
            "reason": f"Insufficient samples: {n} < 288 required",
            "soft_fails": 0,
        }

    champ_mae = float(np.mean(np.abs(champion_errors)))
    chall_mae = float(np.mean(np.abs(challenger_errors)))
    mae_improvement = (champ_mae - chall_mae) / champ_mae if champ_mae > 0 else 0
    gate2_pass = mae_improvement >= 0.02
    gates["g2_mae"] = {
        "pass": gate2_pass,
        "value": round(mae_improvement, 4),
        "threshold": 0.02,
        "champ_mae": round(champ_mae, 3),
        "chall_mae": round(chall_mae, 3),
        "type": "hard",
    }
    if not gate2_pass:
        return {
            "gates": gates,
            "decision": "reject",
            "reason": f"MAE improvement {mae_improvement:.1%} below 2% threshold",
            "soft_fails": 0,
        }

    e1 = np.array(champion_errors)
    e2 = np.array(challenger_errors)
    d = np.abs(e1) - np.abs(e2)
    d_bar = float(np.mean(d))
    T = len(d)
    d_c = d - d_bar
    h = 1
    lrv = float(np.dot(d_c, d_c)) / T
    for k in range(1, h):
        lrv += 2 * (1 - k / h) * float(np.dot(d_c[k:], d_c[:-k])) / T
    lrv = max(lrv, 1e-12)
    DM = d_bar / ((lrv / T) ** 0.5)
    DM_star = DM * ((T + 1 - 2 * h + h * (h - 1) / T) / T) ** 0.5
    p_value = float(2 * (1 - scipy_stats.t.cdf(abs(DM_star), df=T - 1)))
    gate3_pass = p_value < 0.05
    gate3_soft = not gate3_pass and p_value < 0.10
    if gate3_soft:
        soft_fails += 1
    gates["g3_dm"] = {
        "pass": gate3_pass,
        "soft": gate3_soft,
        "value": round(p_value, 4),
        "threshold": 0.05,
        "DM_star": round(DM_star, 4),
        "type": "soft" if gate3_soft else "hard",
    }
    if not gate3_pass and not gate3_soft:
        return {
            "gates": gates,
            "decision": "reject",
            "reason": f"DM test p={p_value:.4f} not significant at 0.05",
            "soft_fails": soft_fails,
        }

    names = ["b1", "b2", "b3", "b4", "b5", "w1", "w2", "w3"]
    max_rel_change = 0.0
    worst_coeff = ""
    for i, (new, old) in enumerate(zip(challenger_coeffs, prior_coeffs)):
        if abs(old) > 1e-6:
            rel = abs(new - old) / abs(old)
            if rel > max_rel_change:
                max_rel_change = rel
                worst_coeff = names[i]
    gate4_hard_fail = max_rel_change >= 0.50
    gate4_soft_fail = 0.30 <= max_rel_change < 0.50
    if gate4_soft_fail:
        soft_fails += 1
    gate4_pass = max_rel_change < 0.50
    gates["g4_stability"] = {
        "pass": gate4_pass,
        "soft": gate4_soft_fail,
        "value": round(max_rel_change, 4),
        "threshold_soft": 0.30,
        "threshold_hard": 0.50,
        "worst_coeff": worst_coeff,
        "type": "soft/hard",
    }
    if gate4_hard_fail:
        return {
            "gates": gates,
            "decision": "flag_for_review",
            "reason": f"Coefficient {worst_coeff} changed {max_rel_change:.1%} — exceeds 50% hard limit",
            "soft_fails": soft_fails,
        }

    if soft_fails >= 2:
        return {
            "gates": gates,
            "decision": "reject",
            "reason": "Two soft fails accumulated — promotion blocked",
            "soft_fails": soft_fails,
        }

    regime_wins = 0
    regime_results = {}
    for regime_name, regime_data in regime_errors.items():
        if len(regime_data.get("champion", [])) < 5:
            regime_results[regime_name] = "insufficient_data"
            continue
        r_champ_mae = float(np.mean(np.abs(regime_data["champion"])))
        r_chall_mae = float(np.mean(np.abs(regime_data["challenger"])))
        win = r_chall_mae < r_champ_mae
        worse_pct = (r_chall_mae - r_champ_mae) / r_champ_mae if r_champ_mae > 0 else 0
        regime_results[regime_name] = {
            "win": win,
            "champ_mae": round(r_champ_mae, 3),
            "chall_mae": round(r_chall_mae, 3),
            "worse_pct": round(worse_pct, 4),
        }
        if win:
            regime_wins += 1
        elif worse_pct > 0.05:
            return {
                "gates": {**gates, "g5_regime": {"pass": False, "results": regime_results, "type": "hard"}},
                "decision": "reject",
                "reason": f"Regime {regime_name} is {worse_pct:.1%} worse — exceeds 5% limit",
                "soft_fails": soft_fails,
            }
    gate5_pass = regime_wins >= 2
    gates["g5_regime"] = {
        "pass": gate5_pass,
        "wins": regime_wins,
        "threshold": 2,
        "results": regime_results,
        "type": "hard",
    }
    if not gate5_pass:
        return {
            "gates": gates,
            "decision": "reject",
            "reason": f"Only {regime_wins} regime(s) improved — need at least 2",
            "soft_fails": soft_fails,
        }

    bounds_list = [
        KF_BOUNDS["b1"],
        KF_BOUNDS["b2"],
        KF_BOUNDS["b3"],
        KF_BOUNDS["b4"],
        KF_BOUNDS["b5"],
        KF_BOUNDS["w1"],
        KF_BOUNDS["w2"],
        KF_BOUNDS["w3"],
    ]
    plausibility_violations = []
    for i, (lo, hi) in enumerate(bounds_list):
        val = challenger_coeffs[i]
        if not (lo <= val <= hi):
            plausibility_violations.append(f"{names[i]}={val:.3f} outside [{lo},{hi}]")
    gate6_pass = len(plausibility_violations) == 0
    gates["g6_plausibility"] = {
        "pass": gate6_pass,
        "violations": plausibility_violations,
        "type": "hard",
    }
    if not gate6_pass:
        return {
            "gates": gates,
            "decision": "reject",
            "reason": f"Plausibility violations: {'; '.join(plausibility_violations)}",
            "soft_fails": soft_fails,
        }

    return {
        "gates": gates,
        "decision": "promote",
        "reason": f"All 6 gates passed. MAE improvement: {mae_improvement:.1%}. DM p={p_value:.4f}.",
        "soft_fails": soft_fails,
        "mae_improvement": mae_improvement,
        "dm_pvalue": p_value,
    }


def _generate_change_summary(
    prior_coeffs: list[float],
    posterior_coeffs: list[float],
    gate_result: dict,
    n_observations: int,
    mae_before: float,
    mae_after: float,
) -> str:
    """Generate a deterministic plain-English change summary (official record)."""
    names = ["b1", "b2", "b3", "b4", "b5", "w1", "w2", "w3"]
    labels = [
        "RD slope 0-20GW",
        "RD slope 20-28GW",
        "RD slope 28-32GW",
        "RD slope 32-35GW",
        "RD slope >35GW",
        "Wind suppression 0-5GW",
        "Wind suppression 5-15GW",
        "Wind suppression >15GW",
    ]

    decision = gate_result.get("decision", "unknown")
    reason = gate_result.get("reason", "")

    if decision != "promote":
        return f"Kalman update not promoted. Reason: {reason}. Observations: {n_observations}."

    changes = []
    for i, (old, new) in enumerate(zip(prior_coeffs, posterior_coeffs)):
        delta = new - old
        if abs(delta) > 0.001:
            direction = "increased" if delta > 0 else "decreased"
            changes.append(
                f"{labels[i]} ({names[i]}) {direction} from {old:.3f} to {new:.3f} "
                f"(Δ{delta:+.3f} £/MWh/GW)"
            )

    mae_improvement_pct = (mae_before - mae_after) / mae_before * 100 if mae_before > 0 else 0

    if not changes:
        summary = "Kalman nightly update promoted with no material coefficient changes. "
    else:
        summary = f"Kalman nightly update promoted. Changes: {'; '.join(changes)}. "

    summary += (
        f"MAE improved from £{mae_before:.2f} to £{mae_after:.2f}/MWh "
        f"({mae_improvement_pct:.1f}% improvement) "
        f"over {n_observations} observations."
    )
    return summary


async def _write_coefficient_update(
    client: httpx.AsyncClient,
    run_id: str,
    run_started_at: str,
    window_start: str,
    window_end: str,
    n_observations: int,
    prior_version_id: str | None,
    prior_coeffs: list[float],
    prior_cov: list[list[float]],
    kf_result: dict,
    gate_result: dict,
    promoted_version_id: str | None,
    runtime_ms: int,
) -> None:
    """Write a coefficient_updates row to the governance schema."""
    inns = kf_result["innovations"]
    payload = {
        "run_id": run_id,
        "run_started_at": run_started_at,
        "run_finished_at": datetime.now(timezone.utc).isoformat(),
        "window_start_ts": window_start,
        "window_end_ts": window_end,
        "n_observations": n_observations,
        "prior_version_id": prior_version_id,
        "prior_coefficients": prior_coeffs,
        "prior_covariance": prior_cov,
        "innovation_mean": float(sum(inns) / len(inns)) if inns else None,
        "innovation_var": float(sum(i**2 for i in inns) / len(inns)) if inns else None,
        "kalman_gain_summary": kf_result["kalman_gain_summary"],
        "posterior_coefficients": kf_result["posterior_coeffs"],
        "posterior_covariance": kf_result["posterior_cov"],
        "log_likelihood": kf_result["log_likelihood"],
        "decision": gate_result["decision"],
        "promoted_version_id": promoted_version_id,
        "gate_results": gate_result["gates"],
        "reason": gate_result["reason"],
        "runtime_ms": runtime_ms,
    }
    headers = {
        **_supabase_governance_headers(),
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }
    resp = await client.post(
        _governance_coefficient_updates_url(),
        headers=headers,
        json=payload,
    )
    resp.raise_for_status()


async def _promote_model_version(
    client: httpx.AsyncClient,
    new_version: str,
    parent_version_id: str | None,
    posterior_coeffs: list[float],
    posterior_cov: list[list[float]],
    change_summary: str,
    gate_result: dict,
    n_observations: int,
) -> str | None:
    """Write a new model version to governance.model_versions. Returns the new version ID."""
    names = ["b1", "b2", "b3", "b4", "b5", "w1", "w2", "w3"]
    coeffs_dict = {names[i]: posterior_coeffs[i] for i in range(8)}

    if parent_version_id:
        patch_headers = {
            **_supabase_governance_headers(),
            "Content-Type": "application/json",
            "Prefer": "return=minimal",
        }
        await client.patch(
            f"{_governance_model_versions_url()}?is_current=eq.true",
            headers=patch_headers,
            json={"is_current": False},
        )

    payload = {
        "version": new_version,
        "model_name": "zephyr_premium_v1",
        "parent_version_id": parent_version_id,
        "effective_from": datetime.now(timezone.utc).isoformat(),
        "is_current": True,
        "b1": posterior_coeffs[0],
        "b2": posterior_coeffs[1],
        "b3": posterior_coeffs[2],
        "b4": posterior_coeffs[3],
        "b5": posterior_coeffs[4],
        "w1": posterior_coeffs[5],
        "w2": posterior_coeffs[6],
        "w3": posterior_coeffs[7],
        "coefficients": coeffs_dict,
        "covariance": posterior_cov,
        "constants": {
            "ETA_CCGT": ETA_CCGT,
            "EF_TCO2": EF_TCO2_PER_MWH_EL,
            "CPS_GBP": CPS_GBP_PER_T,
            "VOM_GBP": VOM_GBP_PER_MWH,
            "score_divisor": 5.0,
        },
        "metric_sample_n": n_observations,
        "change_summary": change_summary,
        "approval_status": "auto_approved",
        "approval_decided_at": datetime.now(timezone.utc).isoformat(),
        "promotion_audit": gate_result.get("gates", {}),
    }

    headers = {
        **_supabase_governance_headers(),
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }
    resp = await client.post(
        _governance_model_versions_url(),
        headers=headers,
        json=payload,
    )
    resp.raise_for_status()
    result = resp.json()
    return result[0]["id"] if result else None


async def _load_kalman_coefficients_on_startup(client: httpx.AsyncClient) -> None:
    """Load latest promoted coefficients from governance.model_versions on startup."""
    global _KALMAN_LIVE_COEFFS
    try:
        resp = await client.get(
            _governance_model_versions_url(),
            headers=_supabase_governance_headers(),
            params={
                "is_current": "eq.true",
                "select": "b1,b2,b3,b4,b5,w1,w2,w3",
                "limit": "1",
            },
        )
        resp.raise_for_status()
        rows = resp.json()
        if rows:
            mv = rows[0]
            _KALMAN_LIVE_COEFFS = [
                float(mv["b1"]),
                float(mv["b2"]),
                float(mv["b3"]),
                float(mv["b4"]),
                float(mv["b5"]),
                float(mv["w1"]),
                float(mv["w2"]),
                float(mv["w3"]),
            ]
            logger.info("kalman: loaded live coefficients from governance on startup: %s", _KALMAN_LIVE_COEFFS)
    except Exception as e:
        logger.info("kalman: no promoted coefficients found on startup, using hardcoded defaults: %s", e)


async def run_kalman_calibration_job() -> None:
    """
    Nightly Kalman filter calibration job. Runs after accuracy fill at 02:00 UTC.

    1. Fetches all filled predictions from last 30 days
    2. Loads current coefficient state (from governance.model_versions or defaults)
    3. Runs Kalman filter
    4. Applies 6 promotion gates
    5. Writes coefficient_updates row regardless of outcome
    6. If promoted: writes new model_versions row and updates live coefficients
    """
    global _KALMAN_LIVE_COEFFS

    import numpy as np
    import time as time_module

    run_id = f"kalman_{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}"
    run_started_at = datetime.now(timezone.utc).isoformat()
    t_start = time_module.time()

    logger.info("kalman: starting calibration job run_id=%s", run_id)

    async with httpx.AsyncClient(timeout=60.0) as client:

        since = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
        try:
            resp = await client.get(
                f"{SUPABASE_URL.rstrip('/')}/rest/v1/premium_predictions",
                headers=_supabase_auth_headers(),
                params={
                    "is_filled": "eq.true",
                    "prediction_timestamp": f"gte.{since}",
                    "select": "id,prediction_timestamp,target_date,target_settlement_period,"
                    "effective_rd_gw,wind_gw,srmc_gbp_mwh,actual_price_gbp_mwh,"
                    "predicted_price_gbp_mwh,regime,model_version",
                    "order": "prediction_timestamp.asc",
                    "limit": "5000",
                },
            )
            resp.raise_for_status()
            all_rows = resp.json()
        except Exception as e:
            logger.error("kalman: failed to fetch predictions: %s", e)
            return

        if not all_rows:
            logger.info("kalman: no filled predictions available — skipping")
            return

        n_total = len(all_rows)
        n_filled_days = len({r["target_date"] for r in all_rows if r.get("target_date")})
        logger.info("kalman: loaded %d filled predictions across %d days", n_total, n_filled_days)

        prior_version_id = None
        prior_coeffs = list(KF_INITIAL_COEFFS)
        prior_cov = [
            [KF_P0_DIAG[i] if i == j else 0.0 for j in range(8)] for i in range(8)
        ]

        try:
            resp = await client.get(
                _governance_model_versions_url(),
                headers=_supabase_governance_headers(),
                params={
                    "is_current": "eq.true",
                    "select": "id,b1,b2,b3,b4,b5,w1,w2,w3,covariance",
                    "limit": "1",
                },
            )
            resp.raise_for_status()
            mv_rows = resp.json()
            if mv_rows:
                mv = mv_rows[0]
                prior_version_id = mv["id"]
                prior_coeffs = [
                    float(mv["b1"]),
                    float(mv["b2"]),
                    float(mv["b3"]),
                    float(mv["b4"]),
                    float(mv["b5"]),
                    float(mv["w1"]),
                    float(mv["w2"]),
                    float(mv["w3"]),
                ]
                if mv.get("covariance"):
                    prior_cov = mv["covariance"]
                logger.info("kalman: loaded prior from governance.model_versions id=%s", prior_version_id)
        except Exception as e:
            logger.warning("kalman: could not load prior from governance, using defaults: %s", e)

        alpha = min(1.0, n_filled_days / KF_MIN_FILLED_DAYS)
        if alpha < 1.0:
            logger.info(
                "kalman: warm-up mode day %d of %d (alpha=%.2f)",
                n_filled_days,
                KF_MIN_FILLED_DAYS,
                alpha,
            )

        window_start = all_rows[0]["prediction_timestamp"]
        window_end = all_rows[-1]["prediction_timestamp"]

        kf_result = _run_kalman_filter(all_rows, prior_coeffs, prior_cov)

        raw_posterior = kf_result["posterior_coeffs"]
        blended = [
            alpha * raw_posterior[i] + (1 - alpha) * KF_INITIAL_COEFFS[i] for i in range(8)
        ]
        kf_result["posterior_coeffs"] = blended

        logger.info(
            "kalman: filter complete n_processed=%d log_likelihood=%.2f",
            kf_result["n_processed"],
            kf_result["log_likelihood"],
        )
        logger.info(
            "kalman: posterior coeffs b=[%.3f,%.3f,%.3f,%.3f,%.3f] w=[%.3f,%.3f,%.3f]",
            *kf_result["posterior_coeffs"],
        )

        champion_errors = []
        challenger_errors = []
        regime_data: dict[str, dict] = {
            "gas-dominated": {"champion": [], "challenger": []},
            "transitional": {"champion": [], "challenger": []},
            "renewable": {"champion": [], "challenger": []},
        }

        for row in all_rows:
            try:
                actual = float(row["actual_price_gbp_mwh"])
                predicted = float(row["predicted_price_gbp_mwh"])
                srmc = float(row["srmc_gbp_mwh"] or 90.0)
                rd = float(row["effective_rd_gw"] or 0)
                wind = float(row["wind_gw"] or 0)
            except (TypeError, ValueError, KeyError):
                continue

            champ_err = predicted - actual

            F = np.array(_build_kalman_observation_vector(rd, wind))
            chall_pred = srmc + float(F @ np.array(kf_result["posterior_coeffs"]))
            chall_err = chall_pred - actual

            champion_errors.append(champ_err)
            challenger_errors.append(chall_err)

            regime = row.get("regime") or "transitional"
            if regime in regime_data:
                regime_data[regime]["champion"].append(champ_err)
                regime_data[regime]["challenger"].append(chall_err)

        gate_result = _run_promotion_gates(
            challenger_coeffs=kf_result["posterior_coeffs"],
            prior_coeffs=prior_coeffs,
            champion_errors=champion_errors,
            challenger_errors=challenger_errors,
            n_filled_days=n_filled_days,
            regime_errors=regime_data,
        )

        logger.info(
            "kalman: gate decision=%s reason=%s",
            gate_result["decision"],
            gate_result["reason"],
        )

        promoted_version_id = None
        new_version_str = None

        if gate_result["decision"] == "promote":
            current_ver = PREMIUM_MODEL_VERSION
            ver_clean = current_ver.lstrip("v")
            try:
                count_resp = await client.get(
                    _governance_model_versions_url(),
                    headers=_supabase_governance_headers(),
                    params={"select": "id", "limit": "1000"},
                )
                count_resp.raise_for_status()
                k_count = len(count_resp.json()) + 1
            except Exception:
                k_count = 1

            new_version_str = f"{ver_clean}-k{k_count:04d}"

            mae_before = float(np.mean(np.abs(champion_errors))) if champion_errors else 0
            mae_after = float(np.mean(np.abs(challenger_errors))) if challenger_errors else 0

            change_summary = _generate_change_summary(
                prior_coeffs=prior_coeffs,
                posterior_coeffs=kf_result["posterior_coeffs"],
                gate_result=gate_result,
                n_observations=len(champion_errors),
                mae_before=mae_before,
                mae_after=mae_after,
            )

            try:
                promoted_version_id = await _promote_model_version(
                    client=client,
                    new_version=new_version_str,
                    parent_version_id=prior_version_id,
                    posterior_coeffs=kf_result["posterior_coeffs"],
                    posterior_cov=kf_result["posterior_cov"],
                    change_summary=change_summary,
                    gate_result=gate_result,
                    n_observations=len(champion_errors),
                )
                logger.info(
                    "kalman: promoted new version %s id=%s",
                    new_version_str,
                    promoted_version_id,
                )

                _KALMAN_LIVE_COEFFS = kf_result["posterior_coeffs"]

            except Exception as e:
                logger.error("kalman: failed to write model version: %s", e)
                gate_result["decision"] = "reject"
                gate_result["reason"] += f" (write failed: {e})"

        runtime_ms = int((time_module.time() - t_start) * 1000)
        try:
            await _write_coefficient_update(
                client=client,
                run_id=run_id,
                run_started_at=run_started_at,
                window_start=window_start,
                window_end=window_end,
                n_observations=kf_result["n_processed"],
                prior_version_id=prior_version_id,
                prior_coeffs=prior_coeffs,
                prior_cov=prior_cov,
                kf_result=kf_result,
                gate_result=gate_result,
                promoted_version_id=promoted_version_id,
                runtime_ms=runtime_ms,
            )
            logger.info("kalman: wrote coefficient_updates run_id=%s", run_id)
        except Exception as e:
            logger.error("kalman: failed to write coefficient_updates: %s", e)

        logger.info(
            "kalman: job complete decision=%s runtime=%dms",
            gate_result["decision"],
            runtime_ms,
        )


def scheduled_kalman_calibration() -> None:
    try:
        asyncio.run(run_kalman_calibration_job())
    except Exception as e:
        logger.error("Kalman calibration job aborted: %s", e, exc_info=True)


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
        async def _report() -> None:
            async with httpx.AsyncClient(timeout=10.0) as c:
                await _update_pipeline_health(c, "open_meteo", True)

        try:
            asyncio.run(_report())
        except Exception:
            pass
    except Exception as e:
        logger.error("Weather cycle aborted: %s", e, exc_info=True)
        async def _report_fail() -> None:
            async with httpx.AsyncClient(timeout=10.0) as c:
                await _update_pipeline_health(c, "open_meteo", False, error=str(e))

        try:
            asyncio.run(_report_fail())
        except Exception:
            pass


def _schedule_weather_with_startup_delay() -> None:
    """
    First weather run after asyncio.sleep(WEATHER_START_DELAY_SECONDS) on a background
    thread (avoids Open-Meteo rate limits on overlapping deploys), then every
    WEATHER_POLL_MINUTES via the schedule loop. REMIT and other cycles are not delayed.
    """

    def _first_run_then_register_interval() -> None:
        async def _delayed_first() -> None:
            await asyncio.sleep(WEATHER_START_DELAY_SECONDS)
            logger.info(
                "weather_cycle: startup delayed 60s to avoid rate limit",
            )
            try:
                await run_weather_cycle()
                async with httpx.AsyncClient(timeout=10.0) as c:
                    await _update_pipeline_health(c, "open_meteo", True)
            except Exception as e:
                logger.error("Weather cycle (delayed first) aborted: %s", e, exc_info=True)
                try:
                    async with httpx.AsyncClient(timeout=10.0) as c:
                        await _update_pipeline_health(c, "open_meteo", False, error=str(e))
                except Exception:
                    pass

        asyncio.run(_delayed_first())
        schedule.every(WEATHER_POLL_MINUTES).minutes.do(scheduled_weather)

    threading.Thread(target=_first_run_then_register_interval, daemon=True).start()


# -----------------------------------------------------------------------------
# GIE AGSI → storage_levels (upsert on report_date + location)
# -----------------------------------------------------------------------------


def _agsi_parse_float(raw: Any) -> float | None:
    """Parse AGSI numeric fields; API uses '-' (and similar) for missing values → None."""
    if raw is None:
        return None
    if isinstance(raw, (int, float)) and not isinstance(raw, bool):
        try:
            return float(raw)
        except (TypeError, ValueError):
            return None
    s = str(raw).strip()
    if not s or s in ("-", "—", "–") or s.lower() in ("n/a", "na"):
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
    if not day or day == "-":
        return None

    full = _agsi_parse_float(item.get("full"))
    wgv = _agsi_parse_float(item.get("workingGasVolume"))
    inj = _agsi_parse_float(item.get("injection"))
    wd = _agsi_parse_float(item.get("withdrawal"))
    # GIE AGSI usually returns GWh/d; values ≫1 are almost certainly GWh → store as TWh
    if inj is not None and abs(inj) > 2:
        inj = inj / 1000.0
    if wd is not None and abs(wd) > 2:
        wd = wd / 1000.0

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


def _agsi_request_headers() -> dict[str, str]:
    """Headers for GET https://agsi.gie.eu/api — API key must be x-key, not a query param."""
    h: dict[str, str] = {
        "Accept": "application/json",
        "User-Agent": "ZephyrMarkets-Storage-Ingestion/1.0",
    }
    if GIE_API_KEY:
        h["x-key"] = GIE_API_KEY
    return h


async def fetch_agsi_json(
    client: httpx.AsyncClient, *, country: str, size: int, page: int
) -> Any:
    resp = await client.get(
        GIE_AGSI_API_URL,
        params={"country": country, "size": str(size), "page": str(page)},
        headers=_agsi_request_headers(),
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
    """Fetch GB + major EU markets from GIE AGSI and upsert into storage_levels."""
    _require_supabase_env()
    fetched_at = datetime.now(timezone.utc).isoformat()

    async with httpx.AsyncClient(follow_redirects=True) as http:
        rows: list[dict[str, Any]] = []

        for country_code in STORAGE_COUNTRY_CODES:
            payload = await fetch_agsi_json(
                http, country=country_code, size=1, page=1
            )
            items, ok = _agsi_extract_items(payload)
            if not ok:
                logger.warning(
                    "storage_cycle: unexpected AGSI JSON structure for %s; raw=%s",
                    country_code,
                    _agsi_json_for_log(payload),
                )
                continue

            gas_day = _agsi_gas_day_fallback(payload)
            item = _agsi_select_row(items)
            if item is None:
                logger.info(
                    "storage_cycle: no AGSI data rows for %s (gas_day=%s)",
                    country_code,
                    gas_day or "?",
                )
                continue

            rec = _agsi_row_to_storage_record(
                item, country_code, gas_day, fetched_at
            )
            if rec:
                rows.append(rec)
                logger.info(
                    "storage_cycle: %s full_pct=%s working_volume_twh=%s",
                    country_code,
                    rec["full_pct"],
                    rec["working_volume_twh"],
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
        async def _report() -> None:
            async with httpx.AsyncClient(timeout=10.0) as c:
                await _update_pipeline_health(c, "gie_agsi", True)

        try:
            asyncio.run(_report())
        except Exception:
            pass
    except Exception as e:
        logger.error("Storage cycle aborted: %s", e, exc_info=True)
        async def _report_fail() -> None:
            async with httpx.AsyncClient(timeout=10.0) as c:
                await _update_pipeline_health(c, "gie_agsi", False, error=str(e))

        try:
            asyncio.run(_report_fail())
        except Exception:
            pass


# -----------------------------------------------------------------------------
# Elexon BMRS MID → market_prices (N2EX / APX, upsert on price_date + settlement_period + market)
# -----------------------------------------------------------------------------


def _mid_volume_mwh(row: dict[str, Any]) -> float | None:
    """Optional traded / accepted volume (MWh) from a BMRS MID row when present."""
    for k in ("volume", "Volume", "totalVolume", "volumeMWh", "acceptedVolume"):
        v = row.get(k)
        if v is None or v == "":
            continue
        try:
            x = float(v)
        except (TypeError, ValueError):
            continue
        if x > 0:
            return x
    return None


def _mid_utc_day_bounds_iso() -> tuple[str, str, str]:
    """Return (from, to) ISO 8601 Z for the current UTC calendar day, and YYYY-MM-DD."""
    today = datetime.now(timezone.utc).date()
    start = datetime(
        today.year, today.month, today.day, 0, 0, 0, tzinfo=timezone.utc
    )
    end = datetime(
        today.year, today.month, today.day, 23, 59, 59, tzinfo=timezone.utc
    )
    zfmt = "%Y-%m-%dT%H:%M:%SZ"
    return start.strftime(zfmt), end.strftime(zfmt), today.isoformat()


def _mid_build_upsert_rows(
    data: list[Any],
    fallback_date: str,
    fetched_at: str,
) -> list[dict[str, Any]]:
    """
    One row per settlement period: prefer N2EXMIDP price if > 0, else APXMIDP if > 0.
    """
    by_sp: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for r in data:
        if not isinstance(r, dict):
            continue
        sp_raw = r.get("settlementPeriod")
        if sp_raw is None or str(sp_raw).strip() == "":
            continue
        try:
            sp = int(round(float(str(sp_raw).strip())))
        except (TypeError, ValueError):
            continue
        by_sp[sp].append(r)

    out: list[dict[str, Any]] = []
    for sp in sorted(by_sp.keys()):
        rows = by_sp[sp]
        n2ex_p: float | None = None
        apx_p: float | None = None
        n2ex_vol: float | None = None
        apx_vol: float | None = None
        pdate = fallback_date
        for r in rows:
            dp = r.get("dataProvider")
            pr = _get_float(r, "price", "Price")
            rd = r.get("settlementDate")
            if rd is not None and str(rd).strip():
                pdate = str(rd).strip()[:10]
            if dp == "N2EXMIDP":
                n2ex_p = pr
                if pr is not None and pr > 0:
                    n2ex_vol = _mid_volume_mwh(r)
            elif dp == "APXMIDP":
                apx_p = pr
                if pr is not None and pr > 0:
                    apx_vol = _mid_volume_mwh(r)

        if n2ex_p is not None and n2ex_p > 0:
            market = MARKET_CODE_N2EX
            price = n2ex_p
            vol_mwh = n2ex_vol
        elif apx_p is not None and apx_p > 0:
            market = MARKET_CODE_APX
            price = apx_p
            vol_mwh = apx_vol
        else:
            continue

        row_out: dict[str, Any] = {
            "price_date": pdate,
            "settlement_period": sp,
            "price_gbp_mwh": price,
            "market": market,
            "source": MARKET_MID_SOURCE,
            "fetched_at": fetched_at,
        }
        if vol_mwh is not None:
            row_out["volume"] = vol_mwh
        out.append(row_out)
    return out


async def upsert_market_prices_http(
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
        _market_prices_rest_url(),
        headers=headers,
        json=rows,
        params={"on_conflict": "price_date,settlement_period,market"},
    )
    resp.raise_for_status()


def _parse_mid_http_body(text: str) -> Any:
    """Parse JSON body or newline-delimited JSON (stream) into an object with `data` rows."""
    text = text.strip()
    if not text:
        return None
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    rows: list[dict[str, Any]] = []
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
            if isinstance(obj, dict):
                rows.append(obj)
        except json.JSONDecodeError:
            continue
    if rows:
        return {"data": rows}
    return None


async def fetch_market_prices() -> None:
    """Fetch today's MID dataset from Elexon BMRS and upsert into market_prices."""
    _require_supabase_env()
    from_iso, to_iso, settlement_date = _mid_utc_day_bounds_iso()
    fetched_at = datetime.now(timezone.utc).isoformat()

    base_params: dict[str, str] = {
        "from": from_iso,
        "to": to_iso,
    }
    if ELEXON_API_KEY:
        base_params["APIKey"] = ELEXON_API_KEY

    dataset_params = {**base_params, "format": "json"}
    stream_params = dict(base_params)

    async with httpx.AsyncClient(
        headers={"Accept": "application/json", "User-Agent": "ZephyrMarkets-MID-Ingestion/1.0"},
        follow_redirects=True,
    ) as http:
        resp = await http.get(
            MID_DATASET_URL, params=dataset_params, timeout=HTTP_TIMEOUT
        )
        logger.info(
            "n2ex_cycle: GET %s status=%s",
            MID_DATASET_URL,
            resp.status_code,
        )
        logger.debug(
            "n2ex_cycle: raw MID response body: %s",
            resp.text,
        )

        if resp.status_code == 404:
            resp = await http.get(
                MID_STREAM_URL, params=stream_params, timeout=HTTP_TIMEOUT
            )
            logger.info(
                "n2ex_cycle: GET %s status=%s",
                MID_STREAM_URL,
                resp.status_code,
            )
            logger.debug(
                "n2ex_cycle: raw MID stream response body: %s",
                resp.text,
            )

        if resp.status_code == 404:
            logger.error(
                "n2ex_cycle: MID dataset and stream both returned 404 date=%s",
                settlement_date,
            )
            return

        try:
            resp.raise_for_status()
        except httpx.HTTPStatusError as e:
            logger.error(
                "n2ex_cycle: MID HTTP error status=%s url=%s",
                e.response.status_code if e.response is not None else "?",
                str(e.request.url) if e.request else "?",
            )
            return

        try:
            payload = resp.json()
        except json.JSONDecodeError:
            payload = _parse_mid_http_body(resp.text)
        if not isinstance(payload, dict):
            logger.error(
                "n2ex_cycle: MID response is not a JSON object date=%s",
                settlement_date,
            )
            return

        data = payload.get("data")
        if not isinstance(data, list):
            logger.warning(
                "n2ex_cycle: missing or invalid data[] for %s",
                settlement_date,
            )
            return

        out = _mid_build_upsert_rows(data, settlement_date, fetched_at)

        if not out:
            logger.warning(
                "n2ex_cycle: no MID rows to upsert for %s (data len=%s)",
                settlement_date,
                len(data),
            )
            return

        await upsert_market_prices_http(http, out)

        avg_price = sum(x["price_gbp_mwh"] for x in out) / len(out)
        logger.info(
            "n2ex_cycle: upserted %s rows for %s (average price: £%.2f/MWh)",
            len(out),
            settlement_date,
            avg_price,
        )


def scheduled_market_prices() -> None:
    try:
        asyncio.run(fetch_market_prices())
        async def _report() -> None:
            async with httpx.AsyncClient(timeout=10.0) as c:
                await _update_pipeline_health(c, "elexon_bmrs", True)

        try:
            asyncio.run(_report())
        except Exception:
            pass
    except Exception as e:
        logger.error("Market prices cycle aborted: %s", e, exc_info=True)
        async def _report_fail() -> None:
            async with httpx.AsyncClient(timeout=10.0) as c:
                await _update_pipeline_health(c, "elexon_bmrs", False, error=str(e))

        try:
            asyncio.run(_report_fail())
        except Exception:
            pass


# -----------------------------------------------------------------------------
# EEX TTF NGP CSV → gas_prices | Sheffield Solar PV_Live → solar_outturn
# -----------------------------------------------------------------------------


def _parse_dt_flexible(raw: str) -> datetime | None:
    """Parse CSV/API datetime strings to timezone-aware UTC where possible."""
    s = (raw or "").strip()
    if not s:
        return None
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(s)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except ValueError:
        pass
    for fmt in (
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%dT%H:%M:%S",
        "%d.%m.%Y %H:%M",
        "%d/%m/%Y %H:%M",
        "%Y/%m/%d %H:%M:%S",
    ):
        try:
            return datetime.strptime(s, fmt).replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    return None


def _ttf_normalize_header_key(k: str | None) -> str:
    """Strip BOM and whitespace from CSV header keys."""
    if k is None:
        return ""
    return k.replace("\ufeff", "").strip()


def _ttf_csv_dict_rows(text: str) -> list[dict[str, str]]:
    text = text.strip()
    if not text:
        return []
    first_line = text.splitlines()[0] if text else ""
    delim = ";" if first_line.count(";") >= first_line.count(",") else ","
    reader = csv.DictReader(io.StringIO(text), delimiter=delim)
    out: list[dict[str, str]] = []
    for row in reader:
        out.append(
            {
                _ttf_normalize_header_key(k): (v or "").strip()
                for k, v in row.items()
            }
        )
    return out


def _ttf_resolve_columns(
    headers: list[str],
) -> tuple[str | None, str | None, str | None]:
    """EEX TTF NGP CSV: Gasday (date), IndexValue (€/MWh), optional Status."""
    gasday_col = None
    indexvalue_col = None
    status_col = None
    for h in headers:
        low = h.lower()
        if "gasday" in low:
            gasday_col = h
        if "indexvalue" in low:
            indexvalue_col = h
        if low == "status":
            status_col = h
    return gasday_col, indexvalue_col, status_col


def _ttf_parse_gasday_dd_mm_yyyy(raw: str) -> datetime | None:
    """Gasday values like 11/04/2026 → UTC midnight that calendar day."""
    s = (raw or "").strip()
    if not s:
        return None
    try:
        d = datetime.strptime(s, "%d/%m/%Y")
        return datetime(d.year, d.month, d.day, 0, 0, 0, tzinfo=timezone.utc)
    except ValueError:
        return None


def _ttf_parse_index_value_eur(raw: str) -> float | None:
    """IndexValue (€/MWh) cell → float."""
    s = (raw or "").strip().replace(" ", "").replace(",", ".")
    for ch in ("€", "\u20ac", "\xa3"):
        s = s.replace(ch, "")
    try:
        return float(s)
    except (TypeError, ValueError):
        return None


async def upsert_gas_prices_http(
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
        _gas_prices_rest_url(),
        headers=headers,
        json=rows,
        params={"on_conflict": "price_time,hub"},
    )
    resp.raise_for_status()


async def upsert_fx_rates_http(
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
        _fx_rates_rest_url(),
        headers=headers,
        json=rows,
        params={"on_conflict": "rate_date,base,quote"},
    )
    resp.raise_for_status()


async def upsert_carbon_prices_http(
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
        _carbon_prices_rest_url(),
        headers=headers,
        json=rows,
        params={"on_conflict": "price_date,hub"},
    )
    resp.raise_for_status()


async def fetch_ttf_price() -> None:
    """Fetch EEX TTF NGP CSV; upsert today's UTC gas day if present, else latest Gasday."""
    _require_supabase_env()
    fetched_at = datetime.now(timezone.utc).isoformat()

    logger.debug(
        "ttf_cycle: SSL verification disabled for EEX gasandregistry domain",
    )
    async with httpx.AsyncClient(
        headers={
            "Accept": "text/csv,text/plain,*/*",
            "User-Agent": "ZephyrMarkets-TTF-Ingestion/1.0",
        },
        follow_redirects=True,
        verify=False,
    ) as http:
        resp = await http.get(TTF_NGP_CSV_URL, timeout=HTTP_TIMEOUT)
        resp.raise_for_status()
        text = resp.text

    rows = _ttf_csv_dict_rows(text)
    logger.debug("ttf_cycle: first 3 parsed CSV rows: %s", rows[:3])

    if not rows:
        logger.warning("ttf_cycle: empty TTF CSV")
        return

    hdrs = list(rows[0].keys())
    gasday_col, price_col, status_col = _ttf_resolve_columns(hdrs)
    if price_col is None or gasday_col is None:
        logger.error(
            "ttf_cycle: could not resolve Gasday/IndexValue columns in headers=%s",
            hdrs,
        )
        return

    parsed: list[tuple[datetime, float, str]] = []
    for row in rows:
        dt = _ttf_parse_gasday_dd_mm_yyyy(row.get(gasday_col, ""))
        price = _ttf_parse_index_value_eur(row.get(price_col, ""))
        if dt is None or price is None:
            continue
        status_txt = ""
        if status_col and status_col in row:
            status_txt = (row.get(status_col) or "").strip()
        parsed.append((dt, price, status_txt))

    if not parsed:
        logger.warning("ttf_cycle: no parseable TTF rows (headers=%s)", hdrs)
        return

    today_utc = datetime.now(timezone.utc).date()
    cutoff = today_utc - timedelta(days=GAS_BACKFILL_DAYS)
    backfill_rows = [t for t in parsed if t[0].date() >= cutoff]
    if not backfill_rows:
        backfill_rows = [max(parsed, key=lambda x: x[0])]

    payload = [
        {
            "price_time": dt.astimezone(timezone.utc).isoformat(),
            "hub": HUB_TTF,
            "price_eur_mwh": price,
            "source": GAS_PRICE_SOURCE_DEFAULT,
            "fetched_at": fetched_at,
        }
        for dt, price, _ in backfill_rows
        if price is not None and price > 0.1
    ]
    logger.debug(
        "ttf_cycle: filtered payload to %d rows with price > 0.1 (from %d backfill rows)",
        len(payload),
        len(backfill_rows),
    )

    async with httpx.AsyncClient(follow_redirects=True) as http:
        await upsert_gas_prices_http(http, payload)

    selected: tuple[datetime, float, str] | None = None
    today_rows = [t for t in backfill_rows if t[0].date() == today_utc]
    if today_rows:
        today_final = [t for t in today_rows if t[2] == "Final NGP"]
        selected = max(today_final or today_rows, key=lambda x: x[0])
    if selected is None:
        final_rows = [t for t in backfill_rows if t[2] == "Final NGP"]
        if final_rows:
            selected = max(final_rows, key=lambda x: x[0])
    if selected is None:
        selected = max(backfill_rows, key=lambda x: x[0])

    selected_dt, selected_price, _selected_status = selected
    gas_day_label = selected_dt.strftime("%Y-%m-%d")

    logger.info(
        "ttf_cycle: TTF NGP = €%.2f/MWh for gas day %s (%s)",
        selected_price,
        gas_day_label,
        f"upserted {len(payload)} rows",
    )


def scheduled_ttf() -> None:
    try:
        asyncio.run(fetch_ttf_price())
        async def _report() -> None:
            async with httpx.AsyncClient(timeout=10.0) as c:
                await _update_pipeline_health(c, "eex_ngp", True)

        try:
            asyncio.run(_report())
        except Exception:
            pass
    except Exception as e:
        logger.error("TTF cycle aborted: %s", e, exc_info=True)
        async def _report_fail() -> None:
            async with httpx.AsyncClient(timeout=10.0) as c:
                await _update_pipeline_health(c, "eex_ngp", False, error=str(e))

        try:
            asyncio.run(_report_fail())
        except Exception:
            pass


async def fetch_nbp_price() -> None:
    """Fetch NBP via public Stooq UK Natural Gas endpoint only."""
    _require_supabase_env()
    fetched_at = datetime.now(timezone.utc).isoformat()
    logger.debug("nbp_cycle: fetching Stooq quote endpoint for NF.F")
    async with httpx.AsyncClient(
        headers={
            "Accept": "text/plain,text/csv,*/*",
            "User-Agent": "ZephyrMarkets-NBP-Ingestion/1.0",
        },
        follow_redirects=True,
    ) as http:
        resp = await http.get(STOOQ_NBP_QUOTE_URL, timeout=HTTP_TIMEOUT)
        resp.raise_for_status()
        line = (resp.text or "").strip()
    if not line:
        logger.error("nbp_cycle: empty Stooq response; skipping write")
        return

    # Expected Stooq format:
    # SYMBOL,YYYYMMDD,HHMMSS,open,high,low,close,volume,
    parts = [p.strip() for p in line.split(",")]
    if len(parts) < 7:
        logger.error("nbp_cycle: unexpected Stooq format: %r", line[:120])
        return
    symbol = parts[0].upper()
    date_s = parts[1]
    close_s = parts[6]
    if symbol != "NF.F":
        logger.error("nbp_cycle: unexpected symbol %s", symbol)
        return
    try:
        d = datetime.strptime(date_s, "%Y%m%d").replace(tzinfo=timezone.utc)
        px = float(close_s)
    except Exception:
        logger.error("nbp_cycle: failed parsing quote line %r", line[:160])
        return

    gas_day_label = d.strftime("%Y-%m-%d")
    # Write-time sanity range. Blocks the class of bug that produced the
    # 2026-04 "Yahoo Finance / TTF-derived" residue (342 rows at ~15 p/th
    # from a broken TTF→NBP conversion) and any future Stooq unit/ticker
    # drift. Skip the upsert rather than coerce: a missing row is far less
    # damaging to Risk/Optimise P&L than a silently wrong one.
    if not math.isfinite(px) or not (NBP_SANITY_MIN_PTH <= px <= NBP_SANITY_MAX_PTH):
        logger.error(
            "nbp_cycle: Stooq NBP close %.3f p/th is outside sanity range "
            "[%.0f, %.0f]; suspected feed artefact, wrong units, or broken "
            "ticker. Skipping upsert to avoid poisoning gas_prices. "
            "gas_day=%s",
            px,
            NBP_SANITY_MIN_PTH,
            NBP_SANITY_MAX_PTH,
            gas_day_label,
        )
        return
    now_utc = datetime.now(timezone.utc)
    age_days = (now_utc.date() - d.date()).days
    if age_days > 3:
        logger.warning(
            "nbp_cycle: NBP price is %d days stale (gas day %s) — "
            "Stooq may not have updated over weekend/holiday. "
            "Skipping upsert to avoid poisoning P&L calculations.",
            age_days,
            gas_day_label,
        )
        return
    elif age_days > 1:
        logger.warning(
            "nbp_cycle: NBP price is %d days stale (gas day %s) — "
            "using anyway but P&L accuracy may be reduced.",
            age_days,
            gas_day_label,
        )

    payload = [{
        "price_time": d.isoformat(),
        "hub": HUB_NBP,
        "price_eur_mwh": px,
        "source": "Stooq UK Natural Gas ICE NF.F",
        "fetched_at": fetched_at,
    }]

    async with httpx.AsyncClient(follow_redirects=True) as http:
        await upsert_gas_prices_http(http, payload)

    logger.info(
        "nbp_cycle: NBP = %.3f for gas day %s (%s)",
        px,
        gas_day_label,
        f"upserted {len(payload)} rows",
    )


def scheduled_nbp() -> None:
    try:
        asyncio.run(fetch_nbp_price())
        async def _report() -> None:
            async with httpx.AsyncClient(timeout=10.0) as c:
                await _update_pipeline_health(c, "stooq_nbp", True)

        try:
            asyncio.run(_report())
        except Exception:
            pass
    except Exception as e:
        logger.error("NBP cycle aborted: %s", e, exc_info=True)
        async def _report_fail() -> None:
            async with httpx.AsyncClient(timeout=10.0) as c:
                await _update_pipeline_health(c, "stooq_nbp", False, error=str(e))

        try:
            asyncio.run(_report_fail())
        except Exception:
            pass


async def upsert_solar_outturn_http(
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
        _solar_outturn_rest_url(),
        headers=headers,
        json=rows,
        params={"on_conflict": "datetime_gmt"},
    )
    resp.raise_for_status()


async def fetch_solar_outturn() -> None:
    """Fetch PV_Live GB national aggregate (gsp_id=0) and upsert latest row."""
    _require_supabase_env()
    fetched_at = datetime.now(timezone.utc).isoformat()

    async with httpx.AsyncClient(
        headers={
            "Accept": "application/json",
            "User-Agent": "ZephyrMarkets-Solar-Ingestion/1.0",
        },
        follow_redirects=True,
    ) as http:
        resp = await http.get(PV_LIVE_GSP0_URL, timeout=HTTP_TIMEOUT)
        resp.raise_for_status()
        payload = resp.json()

    data = payload.get("data") if isinstance(payload, dict) else None
    if not isinstance(data, list) or not data:
        logger.warning("solar_cycle: PV_Live empty data")
        return

    def _pv_ts_key(row: Any) -> float:
        if isinstance(row, (list, tuple)) and len(row) > 1:
            dt = _parse_dt_flexible(str(row[1]))
            if dt:
                return dt.timestamp()
        return float("-inf")

    latest = max(data, key=_pv_ts_key)
    if not isinstance(latest, (list, tuple)) or len(latest) < 3:
        logger.warning("solar_cycle: unexpected PV_Live row shape: %s", latest)
        return

    _gsp_id, dt_raw, solar_mw = latest[0], latest[1], latest[2]
    dt_s = str(dt_raw).strip()
    try:
        mw = float(solar_mw)
    except (TypeError, ValueError):
        logger.warning("solar_cycle: bad solar_mw value: %s", solar_mw)
        return

    row = {
        "datetime_gmt": dt_s,
        "solar_mw": mw,
        "source": SOLAR_SOURCE_DEFAULT,
        "fetched_at": fetched_at,
    }

    async with httpx.AsyncClient(follow_redirects=True) as http:
        await upsert_solar_outturn_http(http, [row])

    logger.info(
        "solar_cycle: GB solar = %s MW at %s",
        f"{mw:,.0f}",
        dt_s,
    )


async def fetch_wind_outturn_gw(client: httpx.AsyncClient) -> float | None:
    """
    Fetch latest GB wind generation outturn from Elexon BMRS FUELINST dataset.
    FUELINST provides generation by fuel type at settlement period resolution.
    Returns wind generation in GW or None if unavailable.
    """
    try:
        now_utc = datetime.now(timezone.utc)
        # Fetch last 2 hours to ensure we get the latest settlement period
        from_dt = (now_utc - timedelta(hours=2)).strftime("%Y-%m-%dT%H:%M:%SZ")
        to_dt = now_utc.strftime("%Y-%m-%dT%H:%M:%SZ")
        resp = await client.get(
            ELEXON_FUELINST_URL,
            params={
                "from": from_dt,
                "to": to_dt,
                "format": "json",
            },
            timeout=HTTP_TIMEOUT,
        )
        resp.raise_for_status()
        payload = resp.json()
        data = payload.get("data") if isinstance(payload, dict) else None
        if not isinstance(data, list) or not data:
            return None
        # FUELINST rows have fuelType and generation fields
        # Find the most recent row where fuelType is WIND
        wind_rows = [
            r
            for r in data
            if isinstance(r, dict)
            and str(r.get("fuelType", "")).upper()
            in ("WIND", "WIND_OFFSHORE", "WIND_ONSHORE")
        ]
        if not wind_rows:
            # Try alternative field name
            wind_rows = [
                r
                for r in data
                if isinstance(r, dict) and "wind" in str(r.get("fuelType", "")).lower()
            ]
        if not wind_rows:
            logger.debug("wind_outturn: no WIND fuel type in FUELINST response")
            return None
        # Sum onshore + offshore if separate, or take total wind
        # Group by settlement period and take the latest
        latest_sp = max(
            wind_rows,
            key=lambda r: r.get("startTime", r.get("settlementPeriod", 0)),
        )
        # Check if we need to sum offshore + onshore
        sp_time = latest_sp.get("startTime", "")
        same_sp_rows = [
            r for r in wind_rows if r.get("startTime", "") == sp_time
        ]
        total_mw = sum(
            float(r.get("generation", r.get("initialOutput", 0)) or 0)
            for r in same_sp_rows
        )
        if total_mw > 0:
            logger.debug(
                "wind_outturn: ELEXON FUELINST wind = %.0f MW at %s",
                total_mw,
                sp_time,
            )
            # Report pipeline health inline — FUELINST has no dedicated scheduler
            try:
                await _update_pipeline_health(
                    client,
                    "elexon_fuelinst",
                    True,
                    last_value={"wind_mw": total_mw, "sp_time": sp_time},
                )
            except Exception:
                pass
            return total_mw / 1000.0
        return None
    except Exception as e:
        logger.debug("wind_outturn: Elexon FUELINST fetch failed: %s", e)
        return None


def scheduled_solar() -> None:
    try:
        asyncio.run(fetch_solar_outturn())
        async def _report() -> None:
            async with httpx.AsyncClient(timeout=10.0) as c:
                await _update_pipeline_health(c, "sheffield_pvlive", True)

        try:
            asyncio.run(_report())
        except Exception:
            pass
    except Exception as e:
        logger.error("Solar cycle aborted: %s", e, exc_info=True)
        async def _report_fail() -> None:
            async with httpx.AsyncClient(timeout=10.0) as c:
                await _update_pipeline_health(c, "sheffield_pvlive", False, error=str(e))

        try:
            asyncio.run(_report_fail())
        except Exception:
            pass


# -----------------------------------------------------------------------------
# Physical premium (CCGT SRMC) → physical_premium (INSERT history)
# -----------------------------------------------------------------------------

REMIT_DERATED_MW_RE = re.compile(r"derated by\s+([\d.]+)\s*MW", re.IGNORECASE)
REMIT_OUTAGE_END_RE = re.compile(
    r"to\s+(\d{1,2}:\d{2})\s+UTC\s+(\d{1,2})\s+([A-Za-z]{3})",
    re.IGNORECASE,
)


def _remit_parse_outage_end_utc(description: str, now: datetime) -> datetime | None:
    """Parse outage end from '... to HH:MM UTC DD Mon'. None if unparseable."""
    matches = list(REMIT_OUTAGE_END_RE.finditer(description))
    if not matches:
        return None
    m = matches[-1]
    hhmm = m.group(1)
    try:
        day = int(m.group(2))
    except ValueError:
        return None
    mon_s = m.group(3).title()
    candidates: list[datetime] = []
    for y in (now.year - 1, now.year, now.year + 1):
        try:
            dt = datetime.strptime(
                f"{hhmm} UTC {day} {mon_s} {y}",
                "%H:%M UTC %d %b %Y",
            )
            dt = dt.replace(tzinfo=timezone.utc)
            candidates.append(dt)
        except ValueError:
            continue
    if not candidates:
        return None
    return min(candidates, key=lambda c: abs((c - now).total_seconds()))


def _remit_active_planned_unplanned_mw(
    descriptions: list[str], now: datetime
) -> tuple[float, float, int, int]:
    """Sum MW for outages verified active: parsed end time must be in the future.

    Signals with no parseable end are skipped (they were inflating totals by treating
    every historical REMIT in the 24h window as still active).

    Returns (planned_mw, unplanned_mw, active_outage_count, total_signals_24h).
    """
    total_signals_24h = len(descriptions)
    planned_mw = 0.0
    unplanned_mw = 0.0
    active_outage_count = 0
    for desc in descriptions:
        if not desc:
            continue
        m = REMIT_DERATED_MW_RE.search(desc)
        if not m:
            continue
        try:
            mw = float(m.group(1))
        except ValueError:
            continue
        end_dt = _remit_parse_outage_end_utc(desc, now)
        if end_dt is None:
            continue
        if end_dt <= now:
            continue
        low = desc.lower()
        if "unplanned" in low:
            unplanned_mw += mw
        elif "planned" in low:
            planned_mw += mw
        else:
            planned_mw += mw
        active_outage_count += 1
    return planned_mw, unplanned_mw, active_outage_count, total_signals_24h


def _residual_demand_premium_gbp_mwh(rd: float) -> float:
    """
    Piecewise-linear residual demand premium above SRMC.

    Recalibrated 2026-04-13 based on observed GB market data:
    - At rd=27-31 GW, market traded at ~£97-110 vs SRMC £112 (premium near zero)
    - Implies the supply curve is essentially flat in the 20-32 GW range
    - Only steepens significantly above 32 GW where peakers genuinely enter
    - Above 35 GW the hockey-stick effect applies (scarcity territory)

    Research basis: Ghelasi & Ziel (2025), Kanamura & Ohashi (2007).
    Kalman filter will continue to adjust these slopes as validation data accumulates.

    Breakpoints:
      0-20 GW:  £0.00/MWh per GW (renewables dominant, price below SRMC)
      20-28 GW: £0.50/MWh per GW (cheap CCGTs marginal, small premium)
      28-32 GW: £1.50/MWh per GW (mid-merit CCGTs, modest premium)
      32-35 GW: £5.00/MWh per GW (expensive plant entering)
      >35 GW:   £20.00/MWh per GW (peakers and scarcity)
    """
    if _KALMAN_LIVE_COEFFS is not None:
        b1, b2, b3, b4, b5 = _KALMAN_LIVE_COEFFS[:5]
    else:
        b1, b2, b3, b4, b5 = 0.00, 0.50, 1.50, 5.00, 20.00

    if rd <= 0:
        return 0.0
    premium = 0.0
    # Segment 1: 0 to 20 GW (flat — renewables dominant)
    seg1 = min(rd, 20.0)
    premium += seg1 * b1
    if rd <= 20.0:
        return premium
    # Segment 2: 20 to 28 GW (cheap CCGTs, small premium)
    seg2 = min(rd - 20.0, 8.0)
    premium += seg2 * b2
    if rd <= 28.0:
        return premium
    # Segment 3: 28 to 32 GW (mid-merit, modest premium)
    seg3 = min(rd - 28.0, 4.0)
    premium += seg3 * b3
    if rd <= 32.0:
        return premium
    # Segment 4: 32 to 35 GW (expensive plant)
    seg4 = min(rd - 32.0, 3.0)
    premium += seg4 * b4
    if rd <= 35.0:
        return premium
    # Segment 5: above 35 GW (scarcity)
    seg5 = rd - 35.0
    premium += seg5 * b5
    return premium


def _wind_price_suppression_gbp_mwh(wind_gw: float) -> float:
    """
    Piecewise wind price suppression effect on implied price.
    Research basis: ECIU (2024/2025), UK DML causal study showing U-shaped relationship.
    At low penetration: moderate suppression ~£3.5/GW
    At mid penetration (5-15 GW): lower suppression ~£2.5/GW (saturation effect)
    At high penetration (>15 GW): stronger suppression ~£4.5/GW (merit-order intensifies)
    Applied as a downward adjustment to the gas-dominated implied price.
    """
    if _KALMAN_LIVE_COEFFS is not None:
        w1, w2, w3 = _KALMAN_LIVE_COEFFS[5:]
    else:
        w1, w2, w3 = 3.50, 2.50, 4.50

    if wind_gw <= 0:
        return 0.0
    suppression = 0.0
    # Segment 1: 0 to 5 GW
    seg1 = min(wind_gw, 5.0)
    suppression += seg1 * w1
    if wind_gw <= 5.0:
        return suppression
    # Segment 2: 5 to 15 GW
    seg2 = min(wind_gw - 5.0, 10.0)
    suppression += seg2 * w2
    if wind_gw <= 15.0:
        return suppression
    # Segment 3: above 15 GW
    seg3 = wind_gw - 15.0
    suppression += seg3 * w3
    return suppression


async def _fetch_weather_wind_closest_now(
    client: httpx.AsyncClient,
) -> tuple[float | None, str | None]:
    """Latest GB wind_speed_100m where forecast_time is closest to now (UTC)."""
    now = datetime.now(timezone.utc)
    lo = (now - timedelta(days=4)).isoformat()
    hi = (now + timedelta(days=4)).isoformat()
    url = _weather_forecasts_rest_url()
    params = [
        ("location", "eq.GB"),
        ("select", "wind_speed_100m,forecast_time"),
        ("forecast_time", f"gte.{lo}"),
        ("forecast_time", f"lte.{hi}"),
    ]
    resp = await client.get(
        url,
        headers=_supabase_auth_headers(),
        params=params,
        timeout=HTTP_TIMEOUT,
    )
    resp.raise_for_status()
    rows = resp.json()
    if not isinstance(rows, list) or not rows:
        return None, None
    best: dict[str, Any] | None = None
    best_abs = float("inf")
    for r in rows:
        if not isinstance(r, dict):
            continue
        ft = r.get("forecast_time")
        if not ft:
            continue
        dt = _parse_dt_flexible(str(ft))
        if dt is None:
            continue
        d = abs((dt - now).total_seconds())
        if d < best_abs:
            best_abs = d
            best = r
    if best is None:
        return None, None
    w = best.get("wind_speed_100m")
    try:
        w_ms = float(w) if w is not None else None
    except (TypeError, ValueError):
        w_ms = None
    ft = str(best.get("forecast_time") or "")
    return w_ms, ft


async def insert_physical_premium_http(
    client: httpx.AsyncClient, row: dict[str, Any]
) -> None:
    headers = {
        **_supabase_auth_headers(),
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }
    resp = await client.post(
        _physical_premium_rest_url(),
        headers=headers,
        json=row,
    )
    resp.raise_for_status()


async def fetch_premium_score_email_alerts_http(
    client: httpx.AsyncClient,
) -> list[dict[str, Any]]:
    """Rows in `alerts` for premium score email delivery."""
    r = await client.get(
        _alerts_rest_url(),
        headers=_supabase_auth_headers(),
        params={
            "threshold_type": "eq.premium_score",
            "delivery_channel": "eq.email",
            "select": "id,user_id,threshold_value",
        },
        timeout=HTTP_TIMEOUT,
    )
    r.raise_for_status()
    data = r.json()
    return data if isinstance(data, list) else []


def _premium_alert_user_id_key(uid_raw: Any) -> str | None:
    """Canonical user id for cooldown dict + auth URL (PostgREST UUID casing varies)."""
    if uid_raw is None:
        return None
    s = str(uid_raw).strip()
    if not s:
        return None
    try:
        return str(uuid.UUID(s)).lower()
    except (ValueError, TypeError, AttributeError):
        return s.lower()


async def fetch_auth_user_email_http(
    client: httpx.AsyncClient, user_id: str
) -> str | None:
    """Resolve email via GoTrue admin API (service role)."""
    url = f"{SUPABASE_URL.rstrip('/')}/auth/v1/admin/users/{user_id}"
    r = await client.get(url, headers=_supabase_auth_headers(), timeout=20.0)
    if r.status_code == 404:
        return None
    if not r.is_success:
        logger.warning(
            "premium_alert: auth admin lookup failed for %s: %s %s",
            user_id,
            r.status_code,
            (r.text or "")[:240],
        )
        return None
    body = r.json()
    if not isinstance(body, dict):
        return None
    email = body.get("email")
    if not email and isinstance(body.get("user"), dict):
        email = body["user"].get("email")
    if isinstance(email, str) and "@" in email:
        return email.strip()
    return None


async def send_resend_plain_email_http(
    client: httpx.AsyncClient,
    *,
    to: str,
    subject: str,
    text: str,
) -> None:
    if not RESEND_API_KEY:
        raise RuntimeError("RESEND_API_KEY is not set")
    r = await client.post(
        "https://api.resend.com/emails",
        headers={
            "Authorization": f"Bearer {RESEND_API_KEY}",
            "Content-Type": "application/json",
        },
        json={
            "from": "Zephyr Alerts <alerts@zephyr.markets>",
            "to": [to],
            "subject": subject,
            "text": text,
        },
        timeout=30.0,
    )
    if not r.is_success:
        logger.warning(
            "premium_alert: Resend HTTP %s: %s",
            r.status_code,
            (r.text or "")[:500],
        )
    r.raise_for_status()


async def insert_premium_alert_job_log_http(
    client: httpx.AsyncClient,
    *,
    user_id: str,
    normalised_score: float,
    threshold_value: float,
) -> None:
    """Audit row for each premium alert email sent."""
    started_at = datetime.now(timezone.utc).isoformat()
    meta = {
        "user_id": user_id,
        "normalised_score": normalised_score,
        "threshold_value": threshold_value,
    }
    headers = {
        **_supabase_auth_headers(),
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }
    payloads: list[dict[str, Any]] = [
        {
            "job_name": "premium_alert",
            "status": "sent",
            "started_at": started_at,
            "metadata": meta,
        },
        {
            "job_name": "premium_alert",
            "status": "sent",
            "started_at": started_at,
            "error_message": json.dumps(meta),
        },
    ]
    last_err: str | None = None
    for payload in payloads:
        resp = await client.post(_admin_job_log_rest_url(), headers=headers, json=payload)
        if resp.is_success:
            return
        last_err = f"{resp.status_code} {(resp.text or '')[:400]}"
    logger.warning("premium_alert: admin_job_log insert failed: %s", last_err)


async def process_premium_score_email_alerts(
    client: httpx.AsyncClient,
    *,
    normalised_score: float,
    direction: str,
    calculated_at: str,
    implied_price_gbp_mwh: float | None,
    market_price_gbp_mwh: float | None,
) -> None:
    """Send threshold emails via Resend; rate-limit per user in-process."""
    if not RESEND_API_KEY:
        logger.debug("premium_alert: RESEND_API_KEY not set; skipping")
        return
    try:
        alert_rows = await fetch_premium_score_email_alerts_http(client)
    except Exception as e:
        logger.warning("premium_alert: could not query alerts: %s", e)
        return
    if not alert_rows:
        return

    score = float(normalised_score)
    abs_score = abs(score)
    now_ts = time.time()
    ip_s = (
        f"£{implied_price_gbp_mwh:.2f}/MWh"
        if implied_price_gbp_mwh is not None
        else "n/a"
    )
    mp_s = (
        f"£{market_price_gbp_mwh:.2f}/MWh"
        if market_price_gbp_mwh is not None
        else "n/a"
    )

    for row in alert_rows:
        uid_key = _premium_alert_user_id_key(row.get("user_id"))
        if not uid_key:
            continue
        try:
            th = float(row.get("threshold_value"))
        except (TypeError, ValueError):
            continue
        if abs_score < th:
            continue
        last_sent = _PREMIUM_ALERT_LAST_SENT_AT.get(uid_key)
        if last_sent is not None and (
            now_ts - last_sent < PREMIUM_ALERT_EMAIL_COOLDOWN_SEC
        ):
            continue

        to_email = await fetch_auth_user_email_http(client, uid_key)
        if not to_email:
            continue

        subject = f"Zephyr alert: Physical premium score {score:+.1f}"
        body = "\n".join(
            [
                "Physical premium score alert",
                "",
                f"Normalised score: {score:+.1f}",
                f"Direction: {direction}",
                "",
                f"Implied price (physical model): {ip_s}",
                f"N2EX day-ahead reference: {mp_s}",
                "",
                f"Model run (UTC): {calculated_at}",
                "",
                f"Your alert threshold is set to {th:g}. The score has exceeded this level.",
                "",
                "Zephyr Meridian",
            ]
        )
        try:
            await send_resend_plain_email_http(
                client, to=to_email, subject=subject, text=body
            )
        except Exception as e:
            logger.warning("premium_alert: send failed for %s: %s", uid_key, e)
            continue

        _PREMIUM_ALERT_LAST_SENT_AT[uid_key] = time.time()
        try:
            await insert_premium_alert_job_log_http(
                client,
                user_id=uid_key,
                normalised_score=score,
                threshold_value=th,
            )
        except Exception as e:
            logger.warning("premium_alert: job log failed for %s: %s", uid_key, e)


PRICE_MOVE_ALERT_TYPES = frozenset(
    {"n2ex_daily_move", "ttf_daily_move", "nbp_daily_move"}
)


async def fetch_price_move_email_alerts_http(
    client: httpx.AsyncClient,
) -> list[dict[str, Any]]:
    """Rows in `alerts` for day-on-day price move email delivery."""
    types_csv = ",".join(sorted(PRICE_MOVE_ALERT_TYPES))
    r = await client.get(
        _alerts_rest_url(),
        headers=_supabase_auth_headers(),
        params={
            "threshold_type": f"in.({types_csv})",
            "delivery_channel": "eq.email",
            "select": "id,user_id,threshold_type,threshold_value",
        },
        timeout=HTTP_TIMEOUT,
    )
    r.raise_for_status()
    data = r.json()
    return data if isinstance(data, list) else []


async def _avg_n2ex_apx_price_gbp_for_date(
    client: httpx.AsyncClient, d: date
) -> float | None:
    """Mean N2EX/APX day-ahead £/MWh for settlement date ``d``."""
    d_s = d.isoformat()
    url = (
        f"{_market_prices_rest_url()}"
        f"?price_date=eq.{d_s}"
        f"&market=in.(N2EX,APX)"
        f"&select=price_gbp_mwh"
    )
    r = await client.get(url, headers=_supabase_auth_headers(), timeout=HTTP_TIMEOUT)
    r.raise_for_status()
    rows = r.json()
    if not isinstance(rows, list) or not rows:
        return None
    vals: list[float] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        raw = row.get("price_gbp_mwh")
        try:
            v = float(raw) if raw is not None else None
        except (TypeError, ValueError):
            v = None
        if v is not None and v == v:  # not NaN
            vals.append(v)
    if not vals:
        return None
    return sum(vals) / len(vals)


async def _avg_gas_hub_price_for_date(
    client: httpx.AsyncClient, hub: str, d: date
) -> float | None:
    """Mean hub price for all ``gas_prices`` rows whose ``price_time`` falls on UTC date ``d``."""
    start = datetime(d.year, d.month, d.day, tzinfo=timezone.utc)
    end = start + timedelta(days=1)
    # hub.eq.TTF,price_time.gte.<iso>,price_time.lt.<iso>
    and_clause = (
        f"and=(hub.eq.{hub},price_time.gte.{quote(start.isoformat())},"
        f"price_time.lt.{quote(end.isoformat())})"
    )
    url = f"{_gas_prices_rest_url()}?{and_clause}&select=price_eur_mwh"
    r = await client.get(url, headers=_supabase_auth_headers(), timeout=HTTP_TIMEOUT)
    r.raise_for_status()
    rows = r.json()
    if not isinstance(rows, list) or not rows:
        return None
    vals: list[float] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        raw = row.get("price_eur_mwh")
        try:
            v = float(raw) if raw is not None else None
        except (TypeError, ValueError):
            v = None
        if v is not None and v == v and v > 0:
            vals.append(v)
    if not vals:
        return None
    return sum(vals) / len(vals)


def _price_move_market_label(threshold_type: str) -> tuple[str, str]:
    """(human market name for body, unit string for formatting)."""
    if threshold_type == "n2ex_daily_move":
        return "N2EX day-ahead (N2EX & APX average)", "£/MWh"
    if threshold_type == "ttf_daily_move":
        return "TTF", "€/MWh"
    if threshold_type == "nbp_daily_move":
        return "NBP", "p/therm"
    return threshold_type, ""


def _price_move_subject_market(threshold_type: str) -> str:
    """Short market name for email subject line."""
    if threshold_type == "n2ex_daily_move":
        return "N2EX day-ahead"
    if threshold_type == "ttf_daily_move":
        return "TTF"
    if threshold_type == "nbp_daily_move":
        return "NBP"
    return threshold_type


async def insert_price_move_alert_job_log_http(
    client: httpx.AsyncClient,
    *,
    metadata: dict[str, Any],
) -> None:
    started_at = datetime.now(timezone.utc).isoformat()
    headers = {
        **_supabase_auth_headers(),
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }
    base = {
        "job_name": "price_move_alert",
        "status": "sent",
        "started_at": started_at,
    }
    payloads: list[dict[str, Any]] = [
        {**base, "metadata": metadata},
        {**base, "error_message": json.dumps(metadata)},
    ]
    last_err: str | None = None
    for payload in payloads:
        resp = await client.post(_admin_job_log_rest_url(), headers=headers, json=payload)
        if resp.is_success:
            return
        last_err = f"{resp.status_code} {(resp.text or '')[:400]}"
    logger.warning("price_move_alert: admin_job_log insert failed: %s", last_err)


async def run_price_move_alerts() -> None:
    """
    Daily ~07:30 UTC: compare UTC calendar today vs yesterday (N2EX: ``price_date``;
    gas: ``price_time`` falling on each UTC day). Email if |move| >= threshold.
    """
    if not RESEND_API_KEY:
        logger.debug("price_move_alert: RESEND_API_KEY not set; skipping")
        return
    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        return

    now_utc = datetime.now(timezone.utc)
    run_day = now_utc.date().isoformat()
    today_d = now_utc.date()
    yesterday_d = today_d - timedelta(days=1)

    async with httpx.AsyncClient(timeout=HTTP_TIMEOUT, follow_redirects=True) as client:
        try:
            alert_rows = await fetch_price_move_email_alerts_http(client)
        except Exception as e:
            logger.warning("price_move_alert: could not query alerts: %s", e)
            return

        if not alert_rows:
            return

        cache_key = (today_d.isoformat(), yesterday_d.isoformat())
        n2ex_cache: dict[tuple[str, str], tuple[float | None, float | None]] = {}
        gas_cache: dict[tuple[str, str, str], tuple[float | None, float | None]] = {}

        async def n2ex_pair() -> tuple[float | None, float | None]:
            if cache_key not in n2ex_cache:
                latest = await _avg_n2ex_apx_price_gbp_for_date(client, today_d)
                prior = await _avg_n2ex_apx_price_gbp_for_date(client, yesterday_d)
                n2ex_cache[cache_key] = (latest, prior)
            return n2ex_cache[cache_key]

        async def gas_pair(hub: str) -> tuple[float | None, float | None]:
            ck = (cache_key[0], cache_key[1], hub)
            if ck not in gas_cache:
                latest = await _avg_gas_hub_price_for_date(client, hub, today_d)
                prior = await _avg_gas_hub_price_for_date(client, hub, yesterday_d)
                gas_cache[ck] = (latest, prior)
            return gas_cache[ck]

        for row in alert_rows:
            if not isinstance(row, dict):
                continue
            tt_raw = row.get("threshold_type")
            tt = str(tt_raw or "").strip()
            if tt not in PRICE_MOVE_ALERT_TYPES:
                continue
            uid_key = _premium_alert_user_id_key(row.get("user_id"))
            if not uid_key:
                continue

            dedupe_key = (uid_key, tt)
            if _PRICE_MOVE_ALERT_LAST_SENT_DAY.get(dedupe_key) == run_day:
                continue

            try:
                th = float(row.get("threshold_value"))
            except (TypeError, ValueError):
                continue
            if th <= 0 or th != th:
                continue

            latest_avg: float | None
            prior_avg: float | None
            if tt == "n2ex_daily_move":
                latest_avg, prior_avg = await n2ex_pair()
            elif tt == "ttf_daily_move":
                latest_avg, prior_avg = await gas_pair(HUB_TTF)
            else:
                latest_avg, prior_avg = await gas_pair(HUB_NBP)

            if latest_avg is None or prior_avg is None:
                continue

            # today vs yesterday (UTC calendar)
            move = latest_avg - prior_avg
            if abs(move) < th:
                continue

            to_email = await fetch_auth_user_email_http(client, uid_key)
            if not to_email:
                continue

            mlabel, unit = _price_move_market_label(tt)
            direction = "up" if move > 0 else "down"
            subject = (
                f"Zephyr alert: {_price_move_subject_market(tt)} moved {move:+.2f} {unit} today"
            )
            body = "\n".join(
                [
                    f"Market: {mlabel}",
                    "",
                    f"Today ({today_d.isoformat()} UTC) average: {latest_avg:.4f} {unit}",
                    f"Yesterday ({yesterday_d.isoformat()} UTC) average: {prior_avg:.4f} {unit}",
                    "",
                    f"Move: {move:+.2f} {unit} ({direction} vs yesterday).",
                    f"Your alert threshold: {th:g} {unit}.",
                    "",
                    "Zephyr Meridian",
                ]
            )

            try:
                await send_resend_plain_email_http(
                    client, to=to_email, subject=subject, text=body
                )
            except Exception as e:
                logger.warning(
                    "price_move_alert: send failed for %s %s: %s", uid_key, tt, e
                )
                continue

            _PRICE_MOVE_ALERT_LAST_SENT_DAY[dedupe_key] = run_day
            try:
                await insert_price_move_alert_job_log_http(
                    client,
                    metadata={
                        "user_id": uid_key,
                        "threshold_type": tt,
                        "threshold_value": th,
                        "today_date": today_d.isoformat(),
                        "yesterday_date": yesterday_d.isoformat(),
                        "latest_avg": latest_avg,
                        "prior_avg": prior_avg,
                        "move": move,
                    },
                )
            except Exception as e:
                logger.warning(
                    "price_move_alert: job log failed for %s %s: %s", uid_key, tt, e
                )

        logger.info(
            "price_move_alert: completed run for %s vs %s",
            today_d.isoformat(),
            yesterday_d.isoformat(),
        )


def scheduled_price_move_alerts() -> None:
    """Daily price-move emails — schedule at 07:30 with TZ=UTC on the host (e.g. Railway)."""
    try:
        asyncio.run(run_price_move_alerts())
    except Exception as e:
        logger.error("price_move_alert: job aborted: %s", e, exc_info=True)


# Supabase (run once): unique constraint required for PostgREST upsert merge-duplicates.
# ALTER TABLE premium_predictions ADD CONSTRAINT premium_predictions_date_sp_version_key UNIQUE (target_date, target_settlement_period, model_version);


async def insert_premium_prediction_http(
    client: httpx.AsyncClient, row: dict[str, Any]
) -> None:
    headers = {
        **_supabase_auth_headers(),
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=minimal",
    }
    resp = await client.post(
        _premium_predictions_rest_url(),
        headers=headers,
        json=row,
        params={
            "on_conflict": "target_date,target_settlement_period,model_version",
        },
    )
    resp.raise_for_status()


async def fetch_unfilled_predictions_http(
    client: httpx.AsyncClient, target_date: str
) -> list[dict]:
    """Fetch all is_filled=false predictions for a given date (YYYY-MM-DD)."""
    headers = _supabase_auth_headers()
    url = (
        f"{SUPABASE_URL.rstrip('/')}/rest/v1/premium_predictions"
        f"?target_date=eq.{target_date}&is_filled=eq.false&select=*"
    )
    resp = await client.get(url, headers=headers)
    resp.raise_for_status()
    return resp.json()


async def fetch_actual_price_for_sp_http(
    client: httpx.AsyncClient, target_date: str, settlement_period: int
) -> float | None:
    """
    Fetch the actual N2EX/APX intraday price for a given date and settlement period
    from the market_prices table.
    Queries by price_date + settlement_period (not price_time).
    """
    headers = _supabase_auth_headers()
    url = (
        f"{SUPABASE_URL.rstrip('/')}/rest/v1/market_prices"
        f"?price_date=eq.{target_date}"
        f"&settlement_period=eq.{settlement_period}"
        f"&price_gbp_mwh=gt.0"
        f"&select=price_gbp_mwh"
        f"&order=price_gbp_mwh.desc"
        f"&limit=1"
    )
    resp = await client.get(url, headers=headers)
    resp.raise_for_status()
    rows = resp.json()
    if rows and float(rows[0]["price_gbp_mwh"]) > 0:
        return float(rows[0]["price_gbp_mwh"])

    # Fallback: find closest settlement period on the same date
    fallback_url = (
        f"{SUPABASE_URL.rstrip('/')}/rest/v1/market_prices"
        f"?price_date=eq.{target_date}"
        f"&price_gbp_mwh=gt.0"
        f"&select=price_gbp_mwh,settlement_period"
        f"&order=settlement_period.asc"
    )
    resp2 = await client.get(fallback_url, headers=headers)
    resp2.raise_for_status()
    all_rows = resp2.json()

    if not all_rows:
        return None

    # Find closest settlement period
    best_row = min(
        all_rows,
        key=lambda r: abs(int(r["settlement_period"]) - settlement_period)
    )
    delta_sp = abs(int(best_row["settlement_period"]) - settlement_period)

    # Only use fallback if within 1 settlement period (30 min)
    if delta_sp <= 1:
        logger.debug(
            "accuracy_fill: used fallback sp=%d (delta=%d) for sp=%d date=%s price=£%.2f",
            int(best_row["settlement_period"]), delta_sp, settlement_period,
            target_date, float(best_row["price_gbp_mwh"])
        )
        return float(best_row["price_gbp_mwh"])

    return None


async def fill_prediction_accuracy_http(
    client: httpx.AsyncClient,
    prediction_id: str,
    actual_price: float,
    predicted_price: float,
) -> None:
    """Fill in actual price and error metrics for a prediction row."""
    headers = {
        **_supabase_auth_headers(),
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }
    error = predicted_price - actual_price
    payload = {
        "actual_price_gbp_mwh": actual_price,
        "error_gbp_mwh": error,
        "absolute_error_gbp_mwh": abs(error),
        "signed_error_gbp_mwh": error,
        "is_filled": True,
    }
    url = (
        f"{SUPABASE_URL.rstrip('/')}/rest/v1/premium_predictions"
        f"?id=eq.{prediction_id}"
    )
    resp = await client.patch(url, headers=headers, json=payload)
    resp.raise_for_status()


async def run_accuracy_fill_job(target_date_str: str | None = None) -> None:
    """
    Nightly job: fill actual prices and error metrics for previous day's predictions.
    Runs at 02:00 UTC. By this time all settlement periods for the previous day
    are finalised in the market_prices table.

    target_date_str: override date for testing (YYYY-MM-DD).
    If None, uses yesterday's date.
    """
    from datetime import date, timedelta

    if target_date_str is None:
        yesterday = (datetime.now(timezone.utc) - timedelta(days=1)).date()
        target_date_str = yesterday.isoformat()

    logger.info("accuracy_fill: starting for date=%s", target_date_str)

    async with httpx.AsyncClient(timeout=30.0) as client:
        # Fetch all unfilled predictions for the target date
        try:
            predictions = await fetch_unfilled_predictions_http(client, target_date_str)
        except Exception as e:
            logger.error("accuracy_fill: failed to fetch predictions: %s", e)
            return

        if not predictions:
            logger.info("accuracy_fill: no unfilled predictions for %s", target_date_str)
            return

        logger.info(
            "accuracy_fill: found %d unfilled predictions for %s",
            len(predictions), target_date_str
        )

        filled = 0
        skipped = 0
        errors = 0

        for pred in predictions:
            prediction_id = pred["id"]
            predicted_price = pred["predicted_price_gbp_mwh"]
            settlement_period = pred["target_settlement_period"]

            if predicted_price is None:
                skipped += 1
                continue

            try:
                actual_price = await fetch_actual_price_for_sp_http(
                    client, target_date_str, settlement_period
                )

                if actual_price is None:
                    logger.debug(
                        "accuracy_fill: no actual price for sp=%d date=%s — skipping",
                        settlement_period, target_date_str
                    )
                    skipped += 1
                    continue

                await fill_prediction_accuracy_http(
                    client, prediction_id, actual_price, float(predicted_price)
                )
                filled += 1

                logger.debug(
                    "accuracy_fill: sp=%d predicted=£%.2f actual=£%.2f error=£%.2f",
                    settlement_period, float(predicted_price), actual_price,
                    float(predicted_price) - actual_price,
                )

            except Exception as e:
                logger.warning(
                    "accuracy_fill: failed for prediction_id=%s sp=%d: %s",
                    prediction_id, settlement_period, e
                )
                errors += 1

        logger.info(
            "accuracy_fill: complete for %s — filled=%d skipped=%d errors=%d",
            target_date_str, filled, skipped, errors
        )


async def fetch_gbp_eur_rate(http: httpx.AsyncClient) -> float:
    try:
        resp = await http.get(
            "https://api.frankfurter.app/latest?from=EUR&to=GBP",
            timeout=10.0,
        )
        if resp.status_code == 200:
            data = resp.json()
            rate = data["rates"]["GBP"]
            logger.info("fx_rate: EUR/GBP = %.4f", rate)
            return rate
        else:
            logger.warning(
                "fx_rate: failed HTTP %s, using fallback 0.86",
                resp.status_code,
            )
            return 0.86
    except Exception as e:
        logger.warning("fx_rate: error %s, using fallback 0.86", e)
        return 0.86


async def upsert_daily_fx_rate(http: httpx.AsyncClient, rate: float) -> None:
    rate_date = datetime.now(timezone.utc).date().isoformat()
    row = {
        "rate_date": rate_date,
        "base": "EUR",
        "quote": "GBP",
        "rate": rate,
        "source": "Frankfurter ECB",
        "fetched_at": datetime.now(timezone.utc).isoformat(),
    }
    await upsert_fx_rates_http(http, [row])
    try:
        await _update_pipeline_health(
            http,
            "frankfurter_fx",
            True,
            last_value={"rate": rate, "base": "EUR", "quote": "GBP"},
        )
    except Exception:
        pass
    logger.info("fx_rate: upserted EUR/GBP %.4f for %s", rate, rate_date)


def _parse_ember_eua_eur_per_t(data: Any) -> float | None:
    """Best-effort parse for Ember Climate carbon-price JSON (shape may vary by version)."""
    if isinstance(data, dict):
        inner = data.get("data")
        if inner is not None:
            return _parse_ember_eua_eur_per_t(inner)
    if isinstance(data, list) and data:
        rows = [x for x in data if isinstance(x, dict)]
        if not rows:
            return None

        def _sort_key(r: dict) -> str:
            return str(r.get("date") or r.get("Date") or r.get("time") or "")

        try:
            rows = sorted(rows, key=_sort_key)
        except Exception:
            pass
        latest = rows[-1]
        for key in ("price", "value", "eua", "close"):
            v = latest.get(key)
            if v is not None:
                try:
                    return float(v)
                except (TypeError, ValueError):
                    continue
    return None


async def fetch_carbon_prices(http: httpx.AsyncClient) -> None:
    """
    Fetch EUA price from Ember Climate API and derive UKA.
    EUA source: https://api.ember-climate.org/v2/carbon-price
    UKA = EUA_GBP - CPS_GBP_PER_T (academically correct: UKA ≈ EUA - £18/t CPS)

    Falls back to last EUA row in carbon_prices if Ember unavailable.
    Stores both EUA and UKA in carbon_prices table.
    """
    logger.debug("carbon_cycle: EEX market page reference %s", EEX_CARBON_CSV_URL)
    today = datetime.now(timezone.utc).date().isoformat()

    eua_eur_per_t: float | None = None

    # Fetch EUA from OilPriceAPI (EU_CARBON_EUR)
    try:
        if not OILPRICE_API_KEY:
            logger.warning("carbon_cycle: OILPRICE_API_KEY not set, skipping fetch")
        else:
            resp = await http.get(
                OILPRICE_API_URL,
                params={"by_code": "EU_CARBON_EUR"},
                headers={"Authorization": f"Token {OILPRICE_API_KEY}"},
                timeout=HTTP_TIMEOUT,
            )
            if resp.status_code == 200:
                data = resp.json()
                price = data.get("data", {}).get("price")
                if price is not None:
                    eua_eur_per_t = float(price)
                    logger.info("carbon_cycle: EUA = €%.2f/t from OilPriceAPI", eua_eur_per_t)
                else:
                    logger.warning("carbon_cycle: OilPriceAPI returned 200 but no price. Response: %s", str(data)[:200])
            else:
                logger.warning("carbon_cycle: OilPriceAPI returned HTTP %s", resp.status_code)
    except Exception as e:
        logger.warning("carbon_cycle: OilPriceAPI fetch failed: %s", e)

    # If primary fetch failed, try fetching latest from our own DB (keeps last known value)
    if eua_eur_per_t is None:
        try:
            resp = await http.get(
                _carbon_prices_rest_url(),
                headers=_supabase_auth_headers(),
                params={
                    "hub": "eq.EUA",
                    "select": "price_eur_per_t,price_date",
                    "order": "price_date.desc",
                    "limit": "1",
                },
                timeout=10.0,
            )
            if resp.status_code == 200:
                rows = resp.json()
                if rows and rows[0].get("price_eur_per_t") is not None:
                    eua_eur_per_t = float(rows[0]["price_eur_per_t"])
                    logger.info(
                        "carbon_cycle: using cached EUA = €%.2f/t from DB",
                        eua_eur_per_t,
                    )
        except Exception as e:
            logger.warning("carbon_cycle: DB fallback failed: %s", e)

    if eua_eur_per_t is None:
        logger.warning("carbon_cycle: no EUA price available, skipping upsert")
        return

    # Get FX rate
    try:
        fx_resp = await http.get(
            _fx_rates_rest_url(),
            headers=_supabase_auth_headers(),
            params={
                "base": "eq.EUR",
                "quote": "eq.GBP",
                "select": "rate",
                "order": "rate_date.desc",
                "limit": "1",
            },
            timeout=10.0,
        )
        fx_rows = fx_resp.json() if fx_resp.status_code == 200 else []
        gbp_per_eur = float(fx_rows[0]["rate"]) if fx_rows else 0.86
    except Exception:
        gbp_per_eur = 0.86

    eua_gbp_per_t = eua_eur_per_t * gbp_per_eur
    uka_gbp_per_t = max(0.0, eua_gbp_per_t - CPS_GBP_PER_T)

    # Write-time sanity range for carbon. Same pattern as the NBP guardrail:
    # reject the whole cycle rather than upsert silently-wrong values. Catches
    # OilPriceAPI unit drift, bad FX rates that scale EUA_GBP implausibly, or
    # any future manual backfill that targets carbon_prices with broken math.
    if (
        not math.isfinite(eua_eur_per_t)
        or not (EUA_SANITY_MIN_EUR_T <= eua_eur_per_t <= EUA_SANITY_MAX_EUR_T)
    ):
        logger.error(
            "carbon_cycle: EUA %.3f €/t is outside sanity range [%.0f, %.0f]; "
            "suspected feed artefact, wrong units, or broken ticker. "
            "Skipping upsert to avoid poisoning carbon_prices.",
            eua_eur_per_t,
            EUA_SANITY_MIN_EUR_T,
            EUA_SANITY_MAX_EUR_T,
        )
        return
    if (
        not math.isfinite(uka_gbp_per_t)
        or not (UKA_SANITY_MIN_GBP_T <= uka_gbp_per_t <= UKA_SANITY_MAX_GBP_T)
    ):
        logger.error(
            "carbon_cycle: UKA %.3f £/t (derived from EUA=%.3f €/t, FX=%.4f, "
            "CPS=%.2f) is outside sanity range [%.0f, %.0f]; suspected broken "
            "FX or CPS value. Skipping upsert.",
            uka_gbp_per_t,
            eua_eur_per_t,
            gbp_per_eur,
            CPS_GBP_PER_T,
            UKA_SANITY_MIN_GBP_T,
            UKA_SANITY_MAX_GBP_T,
        )
        return

    fetched_at = datetime.now(timezone.utc).isoformat()
    rows = [
        {
            "price_date": today,
            "hub": HUB_EUA,
            "price_eur_per_t": round(eua_eur_per_t, 4),
            "price_gbp_per_t": round(eua_gbp_per_t, 4),
            "source": "Ember Climate / EEX",
            "fetched_at": fetched_at,
        },
        {
            "price_date": today,
            "hub": HUB_UKA,
            "price_eur_per_t": None,
            "price_gbp_per_t": round(uka_gbp_per_t, 4),
            "source": "Derived: EUA_GBP - CPS (£18/t)",
            "fetched_at": fetched_at,
        },
    ]

    await upsert_carbon_prices_http(http, rows)
    logger.info(
        "carbon_cycle: upserted EUA=€%.2f/t (£%.2f/t) UKA=£%.2f/t",
        eua_eur_per_t,
        eua_gbp_per_t,
        uka_gbp_per_t,
    )


def scheduled_carbon() -> None:
    try:

        async def _run() -> None:
            async with httpx.AsyncClient(timeout=30.0) as http:
                await fetch_carbon_prices(http)

        asyncio.run(_run())

        async def _report() -> None:
            async with httpx.AsyncClient(timeout=10.0) as c:
                await _update_pipeline_health(c, "carbon_eua_uka", True)

        asyncio.run(_report())
    except Exception as e:
        logger.error("Carbon price cycle aborted: %s", e, exc_info=True)

        async def _report_fail() -> None:
            async with httpx.AsyncClient(timeout=10.0) as c:
                await _update_pipeline_health(c, "carbon_eua_uka", False, error=str(e))

        try:
            asyncio.run(_report_fail())
        except Exception:
            pass


async def calculate_physical_premium() -> None:
    """CCGT-anchored SRMC implied price vs market; append to physical_premium."""
    _require_supabase_env()
    now_utc = datetime.now(timezone.utc)
    calculated_at = now_utc.isoformat()

    async with httpx.AsyncClient(follow_redirects=True) as http:
        gbp_eur_rate = await fetch_gbp_eur_rate(http)
        await upsert_daily_fx_rate(http, gbp_eur_rate)
        wind_ms: float | None = None
        wind_gw: float | None = None
        try:
            wind_gw = await fetch_wind_outturn_gw(http)
            if wind_gw is not None:
                logger.debug(
                    "premium_cycle: wind outturn from BMRS FUELINST = %.1f GW",
                    wind_gw,
                )
            else:
                # Fallback: convert Open-Meteo forecast wind speed
                wind_ms, _wind_ft = await _fetch_weather_wind_closest_now(http)
                if wind_ms is not None:
                    wind_gw = wind_ms * WIND_MS_TO_GW
                    logger.debug(
                        "premium_cycle: wind from forecast fallback = %.1f GW (%.2f m/s)",
                        wind_gw,
                        wind_ms,
                    )
        except Exception as e:
            logger.warning("premium_cycle: wind fetch failed: %s", e)

        solar_mw: float | None = None
        try:
            r = await http.get(
                _solar_outturn_rest_url(),
                headers=_supabase_auth_headers(),
                params={
                    "order": "datetime_gmt.desc",
                    "limit": "1",
                    "select": "solar_mw",
                },
                timeout=HTTP_TIMEOUT,
            )
            r.raise_for_status()
            sr = r.json()
            if isinstance(sr, list) and sr and isinstance(sr[0], dict):
                sm = sr[0].get("solar_mw")
                solar_mw = float(sm) if sm is not None else None
        except Exception as e:
            logger.warning("premium_cycle: solar fetch failed: %s", e)
        if solar_mw is None:
            logger.debug("premium_cycle: solar data unavailable (null) — using 0 GW")
        elif solar_mw == 0:
            logger.debug(
                "premium_cycle: solar = 0 MW (nighttime or genuine zero outturn)"
            )

        ttf_eur_mwh: float | None = None
        try:
            r = await http.get(
                _gas_prices_rest_url(),
                headers=_supabase_auth_headers(),
                params={
                    "hub": "eq.TTF",
                    "order": "price_time.desc",
                    "limit": "1",
                    "select": "price_eur_mwh",
                },
                timeout=HTTP_TIMEOUT,
            )
            r.raise_for_status()
            gr = r.json()
            if isinstance(gr, list) and gr and isinstance(gr[0], dict):
                te = gr[0].get("price_eur_mwh")
                ttf_eur_mwh = float(te) if te is not None else None
        except Exception as e:
            logger.warning("premium_cycle: TTF gas fetch failed: %s", e)

        market_price_gbp_mwh: float | None = None
        try:
            r = await http.get(
                _market_prices_rest_url(),
                headers=_supabase_auth_headers(),
                params={
                    "order": "price_date.desc,settlement_period.desc",
                    "limit": "1",
                    "select": "price_gbp_mwh",
                },
                timeout=HTTP_TIMEOUT,
            )
            r.raise_for_status()
            mr = r.json()
            if isinstance(mr, list) and mr and isinstance(mr[0], dict):
                mp = mr[0].get("price_gbp_mwh")
                market_price_gbp_mwh = float(mp) if mp is not None else None
        except Exception as e:
            logger.warning("premium_cycle: market price fetch failed: %s", e)

        remit_descriptions: list[str] = []
        try:
            since = (now_utc - timedelta(hours=24)).isoformat()
            r = await http.get(
                _signals_rest_url(),
                headers=_supabase_auth_headers(),
                params={
                    "type": "eq.remit",
                    "created_at": f"gte.{since}",
                    "select": "description",
                },
                timeout=HTTP_TIMEOUT,
            )
            r.raise_for_status()
            sigs = r.json()
            if isinstance(sigs, list):
                seen_desc: set[str] = set()
                for s in sigs:
                    if isinstance(s, dict) and s.get("description"):
                        d = str(s["description"]).strip()
                        if not d or d in seen_desc:
                            continue
                        seen_desc.add(d)
                        remit_descriptions.append(d)
        except Exception as e:
            logger.warning("premium_cycle: REMIT signals fetch failed: %s", e)

        (
            remit_planned_mw,
            remit_unplanned_mw,
            remit_active_count,
            remit_total_24h,
        ) = _remit_active_planned_unplanned_mw(remit_descriptions, now_utc)
        # Sum derated MW only (no 2.5× on unplanned — that inflated headline remit_mw_lost)
        remit_total_mw = remit_planned_mw + remit_unplanned_mw
        logger.info(
            "premium_cycle REMIT: %s active outages (%s total in 24h) = %.0f MW planned + %.0f MW unplanned",
            remit_active_count,
            remit_total_24h,
            remit_planned_mw,
            remit_unplanned_mw,
        )

        solar_gw: float | None = None
        if solar_mw is not None:
            solar_gw = solar_mw / 1000.0

        wg = wind_gw if wind_gw is not None else 0.0
        sg = solar_gw if solar_gw is not None else 0.0
        baseline_demand_gw = demand_baseline_gw_utc(now_utc.hour, now_utc.month)
        residual_demand_gw = max(baseline_demand_gw - wg - sg, 0.0)

        # Try to get live UKA price from carbon_prices table
        live_uka_gbp_per_t: float | None = None
        try:
            carbon_resp = await http.get(
                _carbon_prices_rest_url(),
                headers=_supabase_auth_headers(),
                params={
                    "hub": "eq.UKA",
                    "select": "price_gbp_per_t,price_date",
                    "order": "price_date.desc",
                    "limit": "1",
                },
                timeout=8.0,
            )
            if carbon_resp.status_code == 200:
                carbon_rows = carbon_resp.json()
                if carbon_rows and carbon_rows[0].get("price_gbp_per_t") is not None:
                    live_uka_gbp_per_t = float(carbon_rows[0]["price_gbp_per_t"])
        except Exception as e:
            logger.debug("premium_cycle: could not fetch live UKA price: %s", e)

        uka_price = (
            live_uka_gbp_per_t if live_uka_gbp_per_t is not None else UKA_PRICE_GBP_PER_T
        )
        total_carbon_cost = uka_price + CPS_GBP_PER_T
        srmc_gbp_mwh: float | None = None
        if ttf_eur_mwh is not None:
            ttf_gbp_mwh = ttf_eur_mwh * gbp_eur_rate
            gas_component = ttf_gbp_mwh / ETA_CCGT
            carbon_component = total_carbon_cost * EF_TCO2_PER_MWH_EL
            srmc_gbp_mwh = gas_component + carbon_component + VOM_GBP_PER_MWH

        implied_price_gbp_mwh: float | None = None
        premium_regime: str | None = None
        unplanned_gw = remit_unplanned_mw / 1000.0
        remit_gw = remit_total_mw / 1000.0
        # Unplanned REMIT shifts effective residual demand upward.
        # Planned REMIT is already reflected in day-ahead scheduling and market prices.
        # Research basis: Hagfors & Bunn (2016), Ghelasi & Ziel (2025) — REMIT treated
        # as a supply-side shift moving the system up the merit order curve, not a
        # separate scarcity adder.
        effective_rd = min(residual_demand_gw + unplanned_gw, 38.0)
        # Cap at 38 GW — GB peak demand rarely exceeds this even in winter.
        # Above 38 GW the market operates under emergency measures outside model scope.

        rd = residual_demand_gw
        rd_premium_mwh = _residual_demand_premium_gbp_mwh(effective_rd)
        wind_suppression_mwh = _wind_price_suppression_gbp_mwh(wg)
        if rd < 15.0:
            premium_regime = "renewable"
            # Renewable regime: wind_suppression_mwh is the sole below-SRMC mechanism.
            # Do not apply an additional surplus-GW discount, which double-counts
            # renewable-driven price suppression already encoded by wind_suppression_mwh.
            srmc_anchor = srmc_gbp_mwh if srmc_gbp_mwh is not None else 70.0
            implied = srmc_anchor - wind_suppression_mwh
            logger.debug(
                "premium_cycle model: rd=%.1fGW unplanned_remit=%.1fGW effective_rd=%.1fGW "
                "wind_suppression=£%.2f/MWh rd_premium=£%.2f/MWh",
                rd,
                unplanned_gw,
                effective_rd,
                _wind_price_suppression_gbp_mwh(wg),
                _residual_demand_premium_gbp_mwh(effective_rd),
            )
            implied_price_gbp_mwh = max(implied, -60.0)
        elif rd < 22.0:
            premium_regime = "transitional"
            if srmc_gbp_mwh is not None:
                transition_factor = (rd - 15.0) / 7.0
                srmc_anchor = srmc_gbp_mwh if srmc_gbp_mwh is not None else 70.0
                renewable_price = srmc_anchor - wind_suppression_mwh
                gas_price = (
                    srmc_gbp_mwh
                    + rd_premium_mwh
                    - wind_suppression_mwh
                )
                implied = (
                    renewable_price * (1.0 - transition_factor)
                    + gas_price * transition_factor
                )
                logger.debug(
                    "premium_cycle model: rd=%.1fGW unplanned_remit=%.1fGW effective_rd=%.1fGW "
                    "wind_suppression=£%.2f/MWh rd_premium=£%.2f/MWh",
                    rd,
                    unplanned_gw,
                    effective_rd,
                    _wind_price_suppression_gbp_mwh(wg),
                    _residual_demand_premium_gbp_mwh(effective_rd),
                )
                implied_price_gbp_mwh = max(implied, -60.0)
        else:
            premium_regime = "gas-dominated"
            if srmc_gbp_mwh is not None:
                implied = (
                    srmc_gbp_mwh
                    + rd_premium_mwh
                    - wind_suppression_mwh
                )
                logger.debug(
                    "premium_cycle model: rd=%.1fGW unplanned_remit=%.1fGW effective_rd=%.1fGW "
                    "wind_suppression=£%.2f/MWh rd_premium=£%.2f/MWh",
                    rd,
                    unplanned_gw,
                    effective_rd,
                    _wind_price_suppression_gbp_mwh(wg),
                    _residual_demand_premium_gbp_mwh(effective_rd),
                )
                implied_price_gbp_mwh = max(implied, -60.0)

        premium_value: float | None = None
        normalised_score: float | None = None
        direction = "STABLE"
        if implied_price_gbp_mwh is not None and market_price_gbp_mwh is not None:
            premium_value = implied_price_gbp_mwh - market_price_gbp_mwh
            normalised_score = round(premium_value / 5.0, 1)
            normalised_score = max(-9.9, min(9.9, normalised_score))
            if normalised_score > 0.3:
                direction = "FIRMING"
            elif normalised_score < -0.3:
                direction = "SOFTENING"
            else:
                direction = "STABLE"

        inputs_available = sum(
            1
            for x in (wind_gw, solar_mw, ttf_eur_mwh, market_price_gbp_mwh)
            if x is not None
        )
        if inputs_available == 4:
            confidence = "High"
        elif inputs_available >= 2:
            confidence = "Medium"
        else:
            confidence = "Low"

        row: dict[str, Any] = {
            "calculated_at": calculated_at,
            "implied_price_gbp_mwh": implied_price_gbp_mwh,
            "market_price_gbp_mwh": market_price_gbp_mwh,
            "premium_value": premium_value,
            "normalised_score": normalised_score,
            "direction": direction,
            "confidence": confidence,
            "wind_gw": wind_gw,
            "solar_gw": solar_gw,
            "residual_demand_gw": residual_demand_gw,
            "ttf_eur_mwh": ttf_eur_mwh,
            "gbp_eur_rate": gbp_eur_rate,
            "srmc_gbp_mwh": srmc_gbp_mwh,
            "remit_mw_lost": remit_total_mw,
            "regime": premium_regime,
            "source": PHYSICAL_PREMIUM_SOURCE,
        }

        await insert_physical_premium_http(http, row)

        if normalised_score is not None:
            try:
                await process_premium_score_email_alerts(
                    http,
                    normalised_score=normalised_score,
                    direction=direction,
                    calculated_at=calculated_at,
                    implied_price_gbp_mwh=implied_price_gbp_mwh,
                    market_price_gbp_mwh=market_price_gbp_mwh,
                )
            except Exception as e:
                logger.warning("premium_alert: cycle error: %s", e)

        # Log prediction for self-improvement engine validation
        # actual_price_gbp_mwh will be filled by the nightly accuracy job
        if implied_price_gbp_mwh is not None and market_price_gbp_mwh is not None:
            try:
                settlement_period = _current_settlement_period(now_utc)
                prediction_row: dict[str, Any] = {
                    "prediction_timestamp": calculated_at,
                    "target_date": now_utc.date().isoformat(),
                    "target_settlement_period": settlement_period,
                    "model_version": PREMIUM_MODEL_VERSION,
                    "wind_gw": wind_gw,
                    "solar_gw": solar_gw,
                    "residual_demand_gw": residual_demand_gw,
                    "effective_rd_gw": float(effective_rd),
                    "unplanned_remit_gw": float(unplanned_gw),
                    "ttf_eur_mwh": ttf_eur_mwh,
                    "srmc_gbp_mwh": srmc_gbp_mwh,
                    "regime": premium_regime,
                    "predicted_price_gbp_mwh": implied_price_gbp_mwh,
                    # Note: market_price_gbp_mwh here is the latest available price
                    # at prediction time, not necessarily the target SP price.
                    # The accuracy fill job uses the actual SP price from market_prices
                    # table for error calculation — that is the authoritative actual price.
                    "market_price_gbp_mwh": market_price_gbp_mwh,
                    "actual_price_gbp_mwh": None,
                    "error_gbp_mwh": None,
                    "absolute_error_gbp_mwh": None,
                    "signed_error_gbp_mwh": None,
                    "day_of_week": now_utc.weekday(),
                    "is_filled": False,
                }
                await insert_premium_prediction_http(http, prediction_row)
                logger.debug(
                    "prediction_log: logged prediction sp=%d predicted=£%.2f market=£%.2f regime=%s",
                    settlement_period,
                    implied_price_gbp_mwh,
                    market_price_gbp_mwh,
                    premium_regime or "unknown",
                )
            except Exception as e:
                logger.warning("prediction_log: failed to log prediction: %s", e)

        ip = implied_price_gbp_mwh
        mp = market_price_gbp_mwh
        pv = premium_value
        ns = normalised_score
        wg_s = f"{wind_gw:.1f}" if wind_gw is not None else "n/a"
        sg_s = f"{solar_gw:.1f}" if solar_gw is not None else "n/a"
        rd_s = f"{residual_demand_gw:.1f}"
        sr = srmc_gbp_mwh
        prem_s = f"{pv:+.2f}" if pv is not None else "n/a"
        score_s = f"{ns:+.1f}" if ns is not None else "n/a"
        ip_s = f"{ip:.2f}" if ip is not None else "n/a"
        mp_s = f"{mp:.2f}" if mp is not None else "n/a"
        sr_s = f"{sr:.2f}" if sr is not None else "n/a"
        logger.info(
            "premium_cycle: implied=£%s market=£%s premium=%s score=%s wind=%sGW solar=%sGW "
            "residual=%sGW SRMC=£%s REMIT=%.0fMW direction=%s confidence=%s regime=%s",
            ip_s,
            mp_s,
            prem_s,
            score_s,
            wg_s,
            sg_s,
            rd_s,
            sr_s,
            remit_total_mw,
            direction,
            confidence,
            premium_regime or "n/a",
        )


def scheduled_physical_premium() -> None:
    try:
        asyncio.run(calculate_physical_premium())
    except Exception as e:
        logger.error("Physical premium cycle aborted: %s", e, exc_info=True)


def scheduled_accuracy_fill() -> None:
    """Nightly accuracy fill — runs at 02:00 UTC."""
    logger.info("accuracy_fill: nightly job triggered")
    asyncio.run(run_accuracy_fill_job())


# -----------------------------------------------------------------------------
# Morning brief (Claude) → brief_entries (INSERT history)
# -----------------------------------------------------------------------------

BRIEF_FIVE_RE = re.compile(
    r"(?is)OVERNIGHT\s+SUMMARY\s*(.*?)\s*WEATHER\s+WATCH\s*(.*?)\s*"
    r"ONE\s+RISK\s+THE\s+MARKET\s+MAY\s+BE\s+UNDERPRICING\s*(.*?)\s*"
    r"WATCH\s+LIST\s*(.*?)\s*BOOK\s+TOUCHPOINTS\s*(.*)"
)


def _regime_plain_english(regime: str | None) -> str:
    if not regime:
        return "unknown"
    r = regime.lower()
    if r == "renewable":
        return "renewable-dominated"
    if r == "transitional":
        return "transitional"
    if r == "gas-dominated":
        return "gas-dominated"
    return regime


def _brief_fmt_num(v: Any, nd: int = 2) -> str:
    try:
        if v is None:
            return "n/a"
        return f"{float(v):.{nd}f}"
    except (TypeError, ValueError):
        return "n/a"


def _normalize_watch_list_block(text: str) -> str:
    lines: list[str] = []
    for ln in text.splitlines():
        s = ln.strip()
        if not s:
            continue
        if s.startswith("-"):
            s = "• " + s[1:].strip()
        elif not s.startswith("•"):
            s = "• " + s
        lines.append(s)
    return "\n".join(lines)


def _brief_strip_em_dashes(text: str) -> str:
    """Remove em dash (U+2014) from model prose; Claude often over-uses it."""
    if not text:
        return text
    t = text.replace(" \u2014 ", "; ").replace("\u2014", ", ")
    while ", ," in t:
        t = t.replace(", ,", ",")
    return t.replace(",  ", ", ").replace(" ,", ",")


def parse_brief_sections(raw: str) -> tuple[str, str, str, str, str]:
    """Split on five section headers; returns overnight, weather, one_risk, watch, book."""
    m = BRIEF_FIVE_RE.search(raw)
    if not m:
        lump = raw.strip()
        return lump, "", "", "", ""
    overnight = m.group(1).strip()
    weather = m.group(2).strip()
    one_risk = m.group(3).strip()
    watch_s = _normalize_watch_list_block(m.group(4).strip())
    book_s = m.group(5).strip()
    return overnight, weather, one_risk, watch_s, book_s


def _float_for_prompt(v: Any, default: float = 0.0) -> float:
    try:
        if v is None:
            return default
        return float(v)
    except (TypeError, ValueError):
        return default


def _parse_iso_dt(v: Any) -> datetime | None:
    if v is None:
        return None
    if isinstance(v, datetime):
        return v if v.tzinfo else v.replace(tzinfo=timezone.utc)
    if not isinstance(v, str):
        return None
    s = v.strip()
    if not s:
        return None
    try:
        if s.endswith("Z"):
            s = s[:-1] + "+00:00"
        return datetime.fromisoformat(s)
    except ValueError:
        return None


def _anthropic_concat_text_blocks(data: dict[str, Any]) -> str:
    """Join all assistant text blocks from a Messages API response."""
    blocks = data.get("content")
    if not isinstance(blocks, list):
        return ""
    parts: list[str] = []
    for b in blocks:
        if isinstance(b, dict) and b.get("type") == "text":
            parts.append(str(b.get("text") or ""))
    return "\n".join(parts).strip()


def _parse_json_articles_array_from_response(
    data: dict[str, Any],
) -> tuple[list[dict[str, Any]], bool]:
    """Parse list of article dicts from formatter response; bool is whether parse succeeded."""
    articles: list[dict[str, Any]] = []
    text_blocks = [
        (i, block)
        for i, block in enumerate(data.get("content", []))
        if isinstance(block, dict) and block.get("type") == "text"
    ]
    logger.debug(
        "articles_search: found %d text blocks at indices %s",
        len(text_blocks),
        [i for i, _ in text_blocks],
    )
    parsed_from_block = False
    for i, block in reversed(text_blocks):
        try:
            text = str(block.get("text", "")).strip()
            try:
                parsed = json.loads(text)
                if isinstance(parsed, list):
                    articles = [x for x in parsed if isinstance(x, dict)]
                    parsed_from_block = True
                    logger.debug(
                        "articles_search: direct parse succeeded, %d articles",
                        len(articles),
                    )
                    break
            except json.JSONDecodeError:
                pass
            start = text.find("[")
            end = text.rfind("]")
            if start != -1 and end != -1 and end > start:
                try:
                    parsed = json.loads(text[start : end + 1])
                    if isinstance(parsed, list):
                        articles = [x for x in parsed if isinstance(x, dict)]
                        parsed_from_block = True
                        logger.debug(
                            "articles_search: extracted JSON array from block %d, %d articles",
                            i,
                            len(articles),
                        )
                        break
                except json.JSONDecodeError:
                    pass
        except Exception as e:
            logger.debug("articles_search: block %d parse error: %s", i, e)
    return articles, parsed_from_block


async def _brief_already_generated_today(http: httpx.AsyncClient) -> bool:
    """True if the latest brief_entries row was generated on today's UTC date."""
    resp = await http.get(
        _brief_entries_rest_url(),
        headers=_supabase_auth_headers(),
        params={
            "select": "generated_at",
            "order": "generated_at.desc",
            "limit": "1",
        },
        timeout=HTTP_TIMEOUT,
    )
    resp.raise_for_status()
    rows = resp.json()
    if not isinstance(rows, list) or not rows:
        return False
    raw = rows[0].get("generated_at")
    if raw is None:
        return False
    dt = _parse_iso_dt(raw)
    if dt is None:
        return False
    today = datetime.now(timezone.utc).date()
    return dt.date() == today


def _resolve_to_absolute_url(page_url: str, raw: str) -> str:
    """Resolve og:image / twitter:image to an absolute http(s) URL."""
    raw = raw.strip()
    if not raw:
        return raw
    if raw.startswith("//"):
        return "https:" + raw
    parsed = urlparse(raw)
    if parsed.scheme in ("http", "https"):
        return raw
    base = page_url.strip()
    if not base.endswith("/"):
        base = base + "/"
    return urljoin(base, raw)


# Formatter models sometimes emit these when real URLs were not in the truncated input.
_PLACEHOLDER_ARTICLE_HOSTS = frozenset(
    {
        "example.com",
        "example.org",
        "example.net",
        "example.edu",
        "test.com",
        "invalid",
        "localhost",
    }
)


def _article_url_hostname(url: str) -> str:
    try:
        u = url.strip()
        if not u.lower().startswith(("http://", "https://")):
            u = "https://" + u.lstrip("/")
        return (urlparse(u).netloc or "").lower().split(":")[0]
    except Exception:
        return ""


def _is_placeholder_article_url(url: str | None) -> bool:
    if not url or not isinstance(url, str):
        return True
    h = _article_url_hostname(url)
    if not h:
        return True
    if h in _PLACEHOLDER_ARTICLE_HOSTS:
        return True
    if h.endswith(".example.com") or h.endswith(".example.org"):
        return True
    return False


def _extract_http_urls_from_text(text: str) -> list[str]:
    """Collect http(s) URLs in order (web search step puts real links in text / JSON)."""
    if not text:
        return []
    out: list[str] = []
    seen: set[str] = set()
    for m in re.finditer(r"https?://[^\s\>\]\)\"\'\,]+", text, flags=re.IGNORECASE):
        u = m.group(0).rstrip(".,;:!?)]\"'")
        if u not in seen:
            seen.add(u)
            out.append(u)
    return out


def _normalize_article_url(url: str | None) -> str | None:
    """Ensure article links are absolute https URLs (avoids same-origin relative paths)."""
    if not url or not isinstance(url, str):
        return None
    u = url.strip()
    if not u:
        return None
    if u.lower().startswith("http://") or u.lower().startswith("https://"):
        nu = u
    elif u.startswith("//"):
        nu = "https:" + u
    else:
        # "bbc.co.uk/news/..." → https://...
        host = u.split("/")[0]
        if "." in host and not host.startswith("."):
            nu = "https://" + u.lstrip("/")
        else:
            return None
    if _is_placeholder_article_url(nu):
        return None
    return nu


def _repair_brief_articles_with_search_urls(
    articles: list[dict[str, Any]], extracted_urls: list[str]
) -> list[dict[str, Any]]:
    """Drop/repair URLs: use real links from web search; discard example.com hallucinations."""
    pool = [
        u
        for u in extracted_urls
        if not _is_placeholder_article_url(u)
    ]
    pool = list(dict.fromkeys(pool))
    used: set[str] = set()
    pi = 0
    out: list[dict[str, Any]] = []
    for a in articles:
        if not isinstance(a, dict):
            continue
        raw_u = a.get("url")
        nu = _normalize_article_url(raw_u) if isinstance(raw_u, str) else None
        if nu and nu not in used:
            used.add(nu)
            a["url"] = nu
            out.append(a)
            continue
        while pi < len(pool) and pool[pi] in used:
            pi += 1
        if pi < len(pool):
            fixed = _normalize_article_url(pool[pi])
            if fixed:
                used.add(pool[pi])
                a["url"] = fixed
                pi += 1
                out.append(a)
    return out[:30]


def _thumbnail_url_is_valid_for_brief(url: str | None) -> bool:
    """True if URL is http(s) with a host — used for og:image URLs parsed from the article page."""
    if not url or not isinstance(url, str):
        return False
    t = url.strip()
    if not t:
        return False
    try:
        p = urlparse(t)
        return p.scheme in ("http", "https") and bool(p.netloc)
    except Exception:
        return False


def _parse_og_image_from_html(html: str, page_url: str) -> str | None:
    """Extract best preview image URL from HTML (Open Graph, Twitter, link rel)."""
    patterns = (
        r'<meta[^>]+property=["\']og:image["\'][^>]+content=["\']([^"\']+)["\']',
        r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+property=["\']og:image["\']',
        r'<meta[^>]+property=["\']og:image:secure_url["\'][^>]+content=["\']([^"\']+)["\']',
        r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+property=["\']og:image:secure_url["\']',
        r'<meta[^>]+name=["\']twitter:image["\'][^>]+content=["\']([^"\']+)["\']',
        r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+name=["\']twitter:image["\']',
        r'<meta[^>]+name=["\']twitter:image:src["\'][^>]+content=["\']([^"\']+)["\']',
        r'<link[^>]+rel=["\']image_src["\'][^>]+href=["\']([^"\']+)["\']',
        r'<link[^>]+href=["\']([^"\']+)["\'][^>]+rel=["\']image_src["\']',
    )
    for pat in patterns:
        match = re.search(pat, html, re.IGNORECASE)
        if match:
            raw_img = match.group(1).strip()
            if raw_img:
                out = _resolve_to_absolute_url(page_url, raw_img)
                if _thumbnail_url_is_valid_for_brief(out):
                    return out
    return None


_HTML_HEADERS_PRIMARY = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": (
        "text/html,application/xhtml+xml,application/xml;q=0.9,"
        "image/avif,image/webp,*/*;q=0.8"
    ),
    "Accept-Language": "en-GB,en;q=0.9",
}

_HTML_HEADERS_ALT = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 "
        "(KHTML, like Gecko) Version/17.2 Safari/605.1.15"
    ),
    "Accept": "text/html,application/xhtml+xml",
    "Accept-Language": "en-GB,en;q=0.9",
}


async def _fetch_og_image(http: httpx.AsyncClient, url: str) -> str | None:
    page_url = url.strip() if isinstance(url, str) else ""
    if not page_url:
        return None
    try:
        resp = await http.get(
            page_url,
            timeout=12.0,
            follow_redirects=True,
            headers=_HTML_HEADERS_PRIMARY,
        )
        if resp.status_code == 403:
            resp = await http.get(
                page_url,
                timeout=12.0,
                follow_redirects=True,
                headers=_HTML_HEADERS_ALT,
            )
        if resp.status_code != 200:
            return None
        html = resp.text
        return _parse_og_image_from_html(html, page_url)
    except Exception as e:
        logger.debug("og:image fetch failed for %s: %s", url, e)
    return None


async def _collect_brief_articles_with_thumbnails(
    http: httpx.AsyncClient,
    articles: list[dict[str, Any]],
    *,
    min_count: int = 3,
    max_count: int = 5,
) -> list[dict[str, Any]]:
    """
    Walk candidates in order (newest first). Keep an article only if we fetch its
    HTML and extract a real preview image (Open Graph / Twitter / image_src from
    that page). No other thumbnail source.
    """
    og_cache: dict[str, str | None] = {}
    out: list[dict[str, Any]] = []
    for a in articles:
        if not isinstance(a, dict):
            continue
        if len(out) >= max_count:
            break
        raw_u = a.get("url")
        if not isinstance(raw_u, str) or not raw_u.strip():
            continue
        page_url = raw_u.strip()
        if page_url not in og_cache:
            og_cache[page_url] = await _fetch_og_image(http, page_url)
        og = og_cache[page_url]
        if og and _thumbnail_url_is_valid_for_brief(og):
            row = dict(a)
            row["thumbnail_url"] = og
            out.append(row)
    if len(out) < min_count:
        logger.warning(
            "further reading: only %d articles with og/twitter preview from page HTML "
            "(target %d–%d); candidates=%d",
            len(out),
            min_count,
            max_count,
            len([x for x in articles if isinstance(x, dict)]),
        )
    return out


async def _anthropic_further_reading_articles(
    http: httpx.AsyncClient,
    *,
    wind_gw: float,
    solar_gw: float,
    ttf_eur: float,
    n2ex_price: float,
    direction: str,
    remit_count: int,
) -> list[dict[str, Any]]:
    if not _anthropic_api_key():
        return []

    _now_utc = datetime.now(timezone.utc)
    _today_long = _now_utc.strftime("%A %d %B %Y")
    _today_short = _now_utc.strftime("%d %B %Y")

    # --- Step 1: web search, natural-language summaries (tools enabled) ---
    headers_search = {
        "x-api-key": _anthropic_api_key(),
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "web-search-2025-03-05",
        "content-type": "application/json",
    }
    search_prompt = f"""Search for news articles published in the last 7 days. Today's date is {_today_long}. Do not include any articles older than 7 days. Prioritise the most recent articles first in how you order and emphasise your findings (newest and most relevant at the top). If you cannot find suitable articles on a topic within that window, skip it rather than returning out-of-date pieces. Only include articles from FREE publicly accessible sources with no paywall or login required. Good sources (prioritise these in order — they consistently provide preview images):
1. BBC News (bbc.co.uk/news) — always has og:image
2. The Guardian (theguardian.com) — always has og:image
3. Recharge News (rechargenews.com) — reliable og:image
4. Energy Monitor (energymonitor.ai) — reliable og:image
5. Carbon Brief (carbonbrief.org) — reliable og:image
6. Energy Voice (energyvoice.com) — reliable og:image
7. PV Magazine (pv-magazine.com) — reliable og:image
8. Wind Power Monthly (windpowermonthly.com) — reliable og:image
9. NESO blog (nationalgrideso.com) — reliable og:image
10. Ofgem news (ofgem.gov.uk) — reliable og:image
11. GOV.UK press releases — reliable og:image
Deprioritise: Cornwall Insight blog, Montel News, Wind Power Monthly (these often lack preview images).
Always aim to find at least 8 candidate articles so that after image filtering 5 remain.
Do NOT include Bloomberg, Reuters, Financial Times, S&P Global Platts, ICIS, Argus Media, or any paywalled source.

STRICTLY EXCLUDE articles from these sources and domains: wafa.ps, WAFA, Palestine News Agency, Al Jazeera, Press TV, RT (Russia Today), Sputnik, any state-controlled media, any news agency affiliated with a government or political organisation, any activist or advocacy publication. Only include editorially independent journalism and official regulatory/government sources (Ofgem, NESO, GOV.UK).

Use this context for relevance:
- Wind generation: {wind_gw:.1f}GW, Solar: {solar_gw:.1f}GW
- TTF: €{ttf_eur:.2f}/MWh, N2EX: £{n2ex_price:.2f}/MWh
- Physical premium direction: {direction}
- Active REMIT outages: {remit_count} outages

Prioritise stories about: GB power prices, REMIT outages, European gas markets, wind generation, energy storage, UK electricity.

Summarise your findings in plain English. For each piece, include headline, publication, URL, author if known, publication date if known, and a short description of what it covers. Do not output JSON."""
    body_search: dict[str, Any] = {
        "model": CLAUDE_BRIEF_MODEL,
        "max_tokens": 6000,
        "tools": [{"type": "web_search_20250305", "name": "web_search"}],
        "messages": [{"role": "user", "content": search_prompt}],
    }
    resp1 = await http.post(
        ANTHROPIC_MESSAGES_URL,
        headers=headers_search,
        json=body_search,
        timeout=120.0,
    )
    logger.debug("articles_search: step1 HTTP status=%s", resp1.status_code)
    logger.debug("articles_search: step1 raw response=%s", resp1.text[:2000])
    resp1.raise_for_status()
    data1 = resp1.json()
    blocks1 = data1.get("content")
    if isinstance(blocks1, list):
        for i, b in enumerate(blocks1):
            if isinstance(b, dict):
                logger.debug(
                    "articles_search: step1 content block[%s] type=%s",
                    i,
                    b.get("type"),
                )
    text_from_step_1 = _anthropic_concat_text_blocks(data1)
    if not text_from_step_1:
        logger.warning("further reading: step1 returned no text blocks")
        return []

    # Include full response JSON so we still capture URLs if they only appear in tool/citation blocks.
    search_blob = text_from_step_1 + "\n" + json.dumps(data1, default=str)
    extracted_urls = _extract_http_urls_from_text(search_blob)
    logger.info(
        "further reading: extracted %s http(s) URLs from web search response",
        len(extracted_urls),
    )

    # Truncating to 3k chars removed real URLs from the formatter input → Haiku invented
    # example.com links. Keep a large slice so step 2 still sees actual article URLs.
    _max_step2 = 48000
    text_for_step2 = text_from_step_1[:_max_step2]
    logger.debug(
        "articles_search: step1 text length=%d, step2 input length=%d (cap %d)",
        len(text_from_step_1),
        len(text_for_step2),
        _max_step2,
    )
    await asyncio.sleep(60)
    logger.debug("articles_search: sleeping 60s between step1 and step2")

    # --- Step 2: format as JSON only (no tools) ---
    headers_format = {
        "x-api-key": _anthropic_api_key(),
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
    }
    format_user = f"""Convert these article summaries into a JSON array. Return ONLY the JSON array, starting with [ and ending with ]. No explanation, no markdown fences, no preamble.

Only include articles published within the last 7 days. Today is {_today_short}. Exclude any article that appears older than 7 days. Order the array with the most recently published articles first.

Include **10 to 15** distinct articles in the array (the product shows 3–5 with preview images; extras are fallback candidates).

Do not include entries whose URL points to excluded domains (e.g. state-controlled or activist outlets listed in the search instructions). Prefer editorially independent news and official regulatory sources (Ofgem, NESO, GOV.UK).

CRITICAL for "url":
- Copy each URL exactly as it appears in the summaries below (https://...).
- NEVER use example.com, example.org, test.com, placeholder domains, or invented URLs.
- If you cannot find a real https URL for an item in the text below, OMIT that article from the array.

Article summaries to format:
{text_for_step2}

Required JSON format:
[
  {{
    "headline": "Full article headline",
    "snippet": "First 150-200 characters of article body text...",
    "author": "Author name or null",
    "publication": "Publication name",
    "url": "Full article URL starting with https:// (required — never omit the scheme)",
    "thumbnail_url": "og:image URL or null",
    "published_date": "e.g. 12 April 2026 or null if unknown"
  }}
]"""
    body_format: dict[str, Any] = {
        "model": CLAUDE_ARTICLES_FORMAT_MODEL,
        "max_tokens": 4500,
        "system": "You are a JSON formatter. You output only valid JSON arrays, nothing else.",
        "messages": [{"role": "user", "content": format_user}],
    }
    resp2 = await http.post(
        ANTHROPIC_MESSAGES_URL,
        headers=headers_format,
        json=body_format,
        timeout=120.0,
    )
    logger.debug("articles_search: step2 HTTP status=%s", resp2.status_code)
    logger.debug("articles_search: step2 raw response=%s", resp2.text[:2000])
    resp2.raise_for_status()
    data2 = resp2.json()
    blocks2 = data2.get("content")
    if isinstance(blocks2, list):
        for i, b in enumerate(blocks2):
            if isinstance(b, dict):
                logger.debug(
                    "articles_search: step2 content block[%s] type=%s",
                    i,
                    b.get("type"),
                )
    articles, parsed_ok = _parse_json_articles_array_from_response(data2)
    if not parsed_ok:
        logger.warning(
            "further reading: could not parse articles JSON from any text block",
        )
    articles = _repair_brief_articles_with_search_urls(articles, extracted_urls)
    if not articles and extracted_urls:
        logger.warning(
            "further reading: formatter returned no usable URLs; %s URLs were in search but lost in JSON",
            len(extracted_urls),
        )
    articles = [
        a
        for a in articles
        if not any(
            blocked in (a.get("url") or "").lower() for blocked in BLOCKED_DOMAINS
        )
    ]
    logger.info("articles after domain filter: %d articles remaining", len(articles))
    return articles


async def _anthropic_morning_brief(
    system: str,
    user: str,
    *,
    max_tokens: int = 3500,
    http: httpx.AsyncClient | None = None,
) -> str:
    if not _anthropic_api_key():
        raise RuntimeError("ANTHROPIC_API_KEY is not set")
    headers = {
        "x-api-key": _anthropic_api_key(),
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
    }
    body: dict[str, Any] = {
        "model": CLAUDE_BRIEF_MODEL,
        "max_tokens": max_tokens,
        "system": system,
        "messages": [{"role": "user", "content": user}],
    }

    async def _post(client: httpx.AsyncClient) -> dict[str, Any]:
        resp = await client.post(
            ANTHROPIC_MESSAGES_URL,
            headers=headers,
            json=body,
            timeout=120.0,
        )
        if not resp.is_success:
            logger.error(
                "anthropic API error: status=%s body=%s",
                resp.status_code,
                resp.text[:1000],
            )
        resp.raise_for_status()
        return resp.json()

    if http is not None:
        data = await _post(http)
    else:
        async with httpx.AsyncClient(follow_redirects=True) as client:
            data = await _post(client)
    blocks = data.get("content")
    if not isinstance(blocks, list) or not blocks:
        raise RuntimeError("Claude response missing content")
    parts: list[str] = []
    for b in blocks:
        if isinstance(b, dict) and b.get("type") == "text":
            parts.append(str(b.get("text") or ""))
    if not parts:
        raise RuntimeError("Claude response has no text blocks")
    return "\n".join(parts).strip()


async def insert_brief_entry_http(
    client: httpx.AsyncClient, row: dict[str, Any]
) -> None:
    headers = {
        **_supabase_auth_headers(),
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }
    url = _brief_entries_rest_url()
    for attempt in range(2):
        resp = await client.post(
            url,
            headers=headers,
            json=row,
        )
        if resp.status_code < 500:
            resp.raise_for_status()
            return
        if attempt == 0:
            logger.warning(
                "brief insert: 5xx error %s, retrying in 5s",
                resp.status_code,
            )
            await asyncio.sleep(5)
    resp.raise_for_status()


async def generate_morning_brief() -> None:
    """Fetch inputs, call Claude, parse sections, INSERT into brief_entries."""
    _require_supabase_env()
    if not _anthropic_api_key():
        logger.error("Morning brief skipped: ANTHROPIC_API_KEY not set")
        return

    now = datetime.now(timezone.utc)
    ts_label = now.strftime("%Y-%m-%d %H:%M UTC")
    iso_lo = now.isoformat()
    iso_hi = (now + timedelta(hours=24)).isoformat()

    async with httpx.AsyncClient(follow_redirects=True) as http:
        pp_resp = await http.get(
            _physical_premium_rest_url(),
            headers=_supabase_auth_headers(),
            params={
                "select": (
                    "normalised_score,direction,implied_price_gbp_mwh,market_price_gbp_mwh,"
                    "wind_gw,solar_gw,residual_demand_gw,srmc_gbp_mwh,remit_mw_lost,regime,"
                    "premium_value"
                ),
                "order": "calculated_at.desc",
                "limit": "1",
            },
            timeout=HTTP_TIMEOUT,
        )
        pp_resp.raise_for_status()
        pp_rows = pp_resp.json()
        pp = pp_rows[0] if isinstance(pp_rows, list) and pp_rows else {}

        gas_resp = await http.get(
            _gas_prices_rest_url(),
            headers=_supabase_auth_headers(),
            params={
                "hub": "eq.TTF",
                "select": "price_eur_mwh",
                "order": "price_time.desc",
                "limit": "1",
            },
            timeout=HTTP_TIMEOUT,
        )
        gas_resp.raise_for_status()
        gas_rows = gas_resp.json()
        ttf_eur = None
        if isinstance(gas_rows, list) and gas_rows:
            ttf_eur = gas_rows[0].get("price_eur_mwh")

        mp_resp = await http.get(
            _market_prices_rest_url(),
            headers=_supabase_auth_headers(),
            params={
                "price_gbp_mwh": "gt.0",
                "select": "price_gbp_mwh,settlement_period",
                "order": "price_date.desc,settlement_period.desc",
                "limit": "1",
            },
            timeout=HTTP_TIMEOUT,
        )
        mp_resp.raise_for_status()
        mp_rows = mp_resp.json()
        n2ex_price = None
        n2ex_sp: str | int | None = None
        if isinstance(mp_rows, list) and mp_rows:
            n2ex_price = mp_rows[0].get("price_gbp_mwh")
            n2ex_sp = mp_rows[0].get("settlement_period")

        sig_resp = await http.get(
            _signals_rest_url(),
            headers=_supabase_auth_headers(),
            params={
                "type": "eq.remit",
                "select": "title,description",
                "order": "created_at.desc",
                "limit": "20",
            },
            timeout=HTTP_TIMEOUT,
        )
        sig_resp.raise_for_status()
        sig_rows = sig_resp.json()
        remit_lines: list[str] = []
        if isinstance(sig_rows, list):
            for s in sig_rows:
                if not isinstance(s, dict):
                    continue
                t = str(s.get("title") or "").strip()
                d = str(s.get("description") or "").strip()
                remit_lines.append(f"- {t}: {d}" if t else f"- {d}")
        remit_count = len(remit_lines)

        st_resp = await http.get(
            _storage_levels_rest_url(),
            headers=_supabase_auth_headers(),
            params={
                "location": "in.(DE,FR)",
                "select": "location,full_pct,report_date",
                "order": "report_date.desc",
                "limit": "40",
            },
            timeout=HTTP_TIMEOUT,
        )
        st_resp.raise_for_status()
        st_rows = st_resp.json()
        de_pct: float | None = None
        fr_pct: float | None = None
        if isinstance(st_rows, list):
            for row in st_rows:
                if not isinstance(row, dict):
                    continue
                loc = row.get("location")
                if loc == "DE" and de_pct is None:
                    fp = row.get("full_pct")
                    de_pct = float(fp) if fp is not None else None
                elif loc == "FR" and fr_pct is None:
                    fp = row.get("full_pct")
                    fr_pct = float(fp) if fp is not None else None
                if de_pct is not None and fr_pct is not None:
                    break

        wf_resp = await http.get(
            _weather_forecasts_rest_url(),
            headers=_supabase_auth_headers(),
            params=[
                ("location", "eq.GB"),
                ("select", "wind_speed_100m,temperature_2m,forecast_time"),
                ("forecast_time", f"gte.{iso_lo}"),
                ("forecast_time", f"lte.{iso_hi}"),
            ],
            timeout=HTTP_TIMEOUT,
        )
        wf_resp.raise_for_status()
        wf_rows = wf_resp.json()
        parsed_w: list[tuple[datetime, float, float | None]] = []
        if isinstance(wf_rows, list):
            for r in wf_rows:
                if not isinstance(r, dict):
                    continue
                ft = _parse_iso_dt(r.get("forecast_time"))
                if ft is None:
                    continue
                w = r.get("wind_speed_100m")
                try:
                    wms = float(w) if w is not None else None
                except (TypeError, ValueError):
                    wms = None
                if wms is None:
                    continue
                t2 = r.get("temperature_2m")
                try:
                    t2f = float(t2) if t2 is not None else None
                except (TypeError, ValueError):
                    t2f = None
                parsed_w.append((ft, wms, t2f))
        parsed_w.sort(key=lambda x: x[0])
        wind_speeds = [x[1] for x in parsed_w]
        w_min = min(wind_speeds) if wind_speeds else None
        w_max = max(wind_speeds) if wind_speeds else None
        wind_gw_low = w_min * WIND_MS_TO_GW if w_min is not None else None
        wind_gw_high = w_max * WIND_MS_TO_GW if w_max is not None else None
        current_temp_c: float | None = None
        closest_w_ms: float | None = None
        best_age: float | None = None
        for ft, wms, t2f in parsed_w:
            age = abs((ft - now).total_seconds())
            if best_age is None or age < best_age:
                best_age = age
                current_temp_c = t2f
                closest_w_ms = wms
        wind_trend_note = "n/a"
        if len(parsed_w) >= 4:
            mid = len(parsed_w) // 2
            first = parsed_w[:mid]
            second = parsed_w[mid:]
            a = sum(x[1] for x in first) / len(first)
            b = sum(x[1] for x in second) / len(second)
            if b > a * 1.05:
                wind_trend_note = (
                    "wind speeds higher in the second half of the 24h window vs the first"
                )
            elif b < a * 0.95:
                wind_trend_note = (
                    "wind speeds lower in the second half of the 24h window vs the first"
                )
            else:
                wind_trend_note = "wind speeds relatively steady across the 24h window"
        temps_24h = [x[2] for x in parsed_w if x[2] is not None]
        t_min_c = min(temps_24h) if temps_24h else None
        t_max_c = max(temps_24h) if temps_24h else None

        ns = pp.get("normalised_score")
        direction = str(pp.get("direction") or "n/a")
        implied = pp.get("implied_price_gbp_mwh")
        market_p = pp.get("market_price_gbp_mwh")
        gap = pp.get("premium_value")
        r_reg = pp.get("regime")
        regime = _regime_plain_english(
            str(r_reg) if r_reg is not None else None
        )
        srmc = pp.get("srmc_gbp_mwh")
        remit_mw_lost = pp.get("remit_mw_lost")
        wind_gw = pp.get("wind_gw")
        solar_gw = pp.get("solar_gw")
        residual = pp.get("residual_demand_gw")

        remit_block = (
            "\n".join(remit_lines)
            if remit_lines
            else "(no recent REMIT signals in feed)"
        )

        system_prompt = (
            "You are Zephyr's market intelligence engine. You write concise, professional "
            "morning briefs for GB and NW European energy traders. Your tone is direct, "
            "precise, and analytical, like a senior trader explaining the physical picture "
            "to a colleague. Never use filler phrases. Every sentence should contain a "
            "tradeable insight or relevant context. Write in present tense. "
            "Never use the em dash character (Unicode U+2014); use commas, semicolons, "
            "colons, or short separate sentences instead."
        )

        implied_vs_mkt = (
            f"market £{_brief_fmt_num(market_p)}/MWh vs physically implied "
            f"£{_brief_fmt_num(implied)}/MWh"
        )

        user_prompt = f"""Generate a morning brief for GB energy traders based on these physical conditions as of {ts_label}.

DATA (use concrete numbers from below in your answer):

PHYSICAL PREMIUM MODEL:
- Normalised score: {_brief_fmt_num(ns, 1)} (direction: {direction})
- Implied price: £{_brief_fmt_num(implied)}/MWh | Market price: £{_brief_fmt_num(market_p)}/MWh | Premium gap: £{_brief_fmt_num(gap)}/MWh
- {implied_vs_mkt}
- Regime: {regime}
- SRMC anchor: £{_brief_fmt_num(srmc)}/MWh
- REMIT capacity impact (model): {_brief_fmt_num(remit_mw_lost)} MW (if shown)

GENERATION:
- Wind (model): {_brief_fmt_num(wind_gw, 1)} GW | Solar: {_brief_fmt_num(solar_gw, 1)} GW | Residual demand: {_brief_fmt_num(residual, 1)} GW
- 24h forecast wind speed range at 100m: {_brief_fmt_num(w_min, 1)}–{_brief_fmt_num(w_max, 1)} m/s (forecast range only; actual current wind outturn shown above as Wind (model) GW from Elexon FUELINST).
- Nearest forecast temperature: {_brief_fmt_num(current_temp_c, 1)} °C.
- 24h temperature span: {_brief_fmt_num(t_min_c, 1)}–{_brief_fmt_num(t_max_c, 1)} °C.
- Wind profile (24h window, first vs second half): {wind_trend_note}

GAS & POWER PRICE:
- TTF: €{_brief_fmt_num(ttf_eur)}/MWh
- N2EX: £{_brief_fmt_num(n2ex_price)}/MWh (SP{n2ex_sp if n2ex_sp is not None else "n/a"})

REMIT SIGNALS (recent; {remit_count} items):
{remit_block}

EU STORAGE:
- Germany: {(_brief_fmt_num(de_pct, 1) if de_pct is not None else "n/a")}% full
- France: {(_brief_fmt_num(fr_pct, 1) if fr_pct is not None else "n/a")}% full

Write the brief with EXACTLY these section headers on their own lines, in this order, and nothing else before the first header:

OVERNIGHT SUMMARY
What the physical world has done since the previous close. Reference the physical premium score direction, wind and solar generation levels, any significant REMIT outages that came in overnight, and how the market price compares to the physically-implied price. Be specific with numbers. 2-3 sentences.

WEATHER WATCH
Based on the 24-hour wind forecast range and current temperature. Quantify the expected wind generation range in GW (using the {WIND_MS_TO_GW:.4f} GW per m/s scaling). Note whether wind is forecast to rise or fall through the session and what that means for residual demand and price direction. Note current temperature and whether it is supportive of gas demand. The renewable-to-gas regime transition threshold is 15 GW of residual demand; use this figure if referencing regime switches in the watch list or weather watch. Use the Wind (model) GW figure as the actual current wind outturn. The m/s forecast range is for directional context only; do not convert m/s to GW using any scaling factor. 2-3 sentences.

ONE RISK THE MARKET MAY BE UNDERPRICING
The single most important contrarian physical signal in the current data. Look for disconnects between the market price and the physical implied price, REMIT capacity that could clear and tighten the system, wind forecast drops that would switch regime from renewable to gas-dominated, or storage levels that signal supply tightness. Be specific and quantified. 2-3 sentences.

WATCH LIST
Exactly three bullet lines starting with • (bullet character). Each one line, specific, and actionable. Reference actual asset names, prices, or GW figures from the data.

BOOK TOUCHPOINTS
Write nothing substantive here (a single word "reserved" is fine). Book-specific touchpoints are generated in the web app from each user's live open positions.

Do not use markdown bold or headings other than the exact headers above. Do not add extra sections.
Do not use em dashes (—); use commas, semicolons, colons, or parentheses."""

        raw_text = await _anthropic_morning_brief(
            system_prompt, user_prompt, max_tokens=3500, http=http
        )
        raw_text = _brief_strip_em_dashes(raw_text)
        logger.debug("brief_cycle: sleeping 10s before article search to avoid rate limit")
        await asyncio.sleep(10)
        overnight_s, weather_s, one_risk_s, watch_s, book_s = parse_brief_sections(
            raw_text
        )
        exec_s = overnight_s if overnight_s else raw_text.strip()

        score_store = None
        try:
            if ns is not None:
                score_store = float(ns)
        except (TypeError, ValueError):
            pass
        wind_store = None
        try:
            if wind_gw is not None:
                wind_store = float(wind_gw)
        except (TypeError, ValueError):
            pass
        ttf_store = None
        try:
            if ttf_eur is not None:
                ttf_store = float(ttf_eur)
        except (TypeError, ValueError):
            pass
        mkt_store = None
        try:
            if n2ex_price is not None:
                mkt_store = float(n2ex_price)
        except (TypeError, ValueError):
            pass

        articles = await _anthropic_further_reading_articles(
            http,
            wind_gw=_float_for_prompt(wind_gw),
            solar_gw=_float_for_prompt(solar_gw),
            ttf_eur=_float_for_prompt(ttf_eur),
            n2ex_price=_float_for_prompt(n2ex_price),
            direction=direction,
            remit_count=remit_count,
        )

        # Normalize article URLs to absolute https (bare domains break browser href resolution)
        for article in articles:
            if not isinstance(article, dict):
                continue
            raw_u = article.get("url")
            nu = _normalize_article_url(raw_u) if isinstance(raw_u, str) else None
            if nu:
                article["url"] = nu

        # Keep 3–5 further-reading items, each thumbnail parsed from the article HTML.
        articles = await _collect_brief_articles_with_thumbnails(
            http,
            articles,
            min_count=3,
            max_count=5,
        )

        logger.info(
            "further reading: inserting %s articles (preview image from article page)",
            len(articles),
        )

        row = {
            "executive_summary": exec_s,
            "overnight_summary": overnight_s,
            "weather_watch": weather_s,
            "one_risk": one_risk_s,
            "watch_list": watch_s,
            # Book-specific copy is generated in the Next.js app from the user's open positions.
            "book_touchpoints": None,
            "articles": articles,
            "raw_response": raw_text,
            "physical_premium_score": score_store,
            "wind_gw": wind_store,
            "ttf_eur_mwh": ttf_store,
            "market_price_gbp_mwh": mkt_store,
            "source": BRIEF_SOURCE,
        }

        await insert_brief_entry_http(http, row)

        preview = (overnight_s or exec_s or "").replace("\n", " ")[:100]
        logger.info(
            "brief_cycle: generated brief score=%s wind=%sGW ttf=€%s | "
            "overnight_summary preview: %s",
            _brief_fmt_num(ns, 1) if ns is not None else "n/a",
            _brief_fmt_num(wind_gw, 1) if wind_gw is not None else "n/a",
            _brief_fmt_num(ttf_eur) if ttf_eur is not None else "n/a",
            preview,
        )
        logger.info(
            "brief_cycle: found %s articles for further reading",
            len(articles),
        )


def scheduled_morning_brief() -> None:
    logger.info("brief_cycle: morning brief run starting")
    try:

        async def _run() -> bool:
            if os.environ.get("FORCE_BRIEF") == "true":
                logger.info(
                    "brief_cycle: FORCE_BRIEF=true, skipping today check",
                )
            else:
                _require_supabase_env()
                async with httpx.AsyncClient(follow_redirects=True) as http:
                    if await _brief_already_generated_today(http):
                        logger.info(
                            "brief_cycle: brief already generated today, skipping",
                        )
                        return False
            await generate_morning_brief()
            return True

        if asyncio.run(_run()):
            logger.info("brief_cycle: morning brief run finished")
    except Exception as e:
        logger.error("Morning brief cycle aborted: %s", e, exc_info=True)


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


def classify_confidence(unavailable_mw: float | None, unavailability_type: str | None) -> str:
    """
    Derive signal confidence from outage size and type.
    HIGH   — unplanned outage >= 400 MW, or any outage >= 800 MW
    MEDIUM — unplanned 100-399 MW, or planned 300-799 MW
    LOW    — small outages, unknown type, or derates < 100 MW
    """
    mw = unavailable_mw or 0.0
    ut = (unavailability_type or "").strip().lower()
    unplanned = "unplanned" in ut
    if unplanned and mw >= 400:
        return "HIGH"
    if mw >= 800:
        return "HIGH"
    if unplanned and mw >= 100:
        return "MEDIUM"
    if mw >= 300:
        return "MEDIUM"
    return "LOW"


def notice_to_row(notice: dict[str, Any]) -> dict[str, Any] | None:
    mid = _get_remit_mrid(notice)
    if not mid:
        logger.warning("Skipping notice without mrid: %s", str(notice)[:200])
        return None

    unavailable = _get_float(notice, "unavailableCapacity", "UnavailableCapacity")
    unavailability_type = _get_str(notice, "unavailabilityType", "UnavailabilityType")

    return {
        "remit_message_id": mid,
        "type": SIGNAL_TYPE,
        "title": build_title(notice),
        "description": build_description(notice),
        "direction": classify_direction(unavailable),
        "source": SOURCE_LABEL,
        "confidence": classify_confidence(unavailable, unavailability_type),
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


async def _startup_load_kalman_async() -> None:
    async with httpx.AsyncClient(timeout=30.0) as client:
        await _load_kalman_coefficients_on_startup(client)


def main() -> None:
    supabase_startup_check()

    asyncio.run(_startup_load_kalman_async())

    logger.info(
        "GIE_API_KEY %s",
        "is set" if GIE_API_KEY else "is missing (AGSI requests may fail)",
    )
    logger.info(
        "Physical premium carbon input | UKA_PRICE_GBP_T=%.2f (from env UKA_PRICE_GBP_T, default 55.0)",
        UKA_PRICE_GBP_PER_T,
    )

    logger.info(
        "Ingestion agent starting | REMIT every %ss (%s) | weather first after %ss then "
        "every %s min (%s) | GIE AGSI storage every %sh (%s) | N2EX MID every %s min (%s) "
        "| TTF NGP every %s min | NBP NGP every %s min | PV_Live solar every %s min | physical premium every %s min "
        "| morning brief daily 06:00 (host TZ; use UTC) | price move alerts daily 07:30 UTC "
        "| accuracy fill daily 02:00 UTC | Kalman calibration daily 02:05 UTC",
        POLL_INTERVAL_SECONDS,
        REMIT_DATASET_URL,
        WEATHER_START_DELAY_SECONDS,
        WEATHER_POLL_MINUTES,
        OPEN_METEO_FORECAST_URL,
        STORAGE_POLL_HOURS,
        GIE_AGSI_API_URL,
        MARKET_INDEX_POLL_MINUTES,
        MID_DATASET_URL,
        TTF_POLL_MINUTES,
        TTF_POLL_MINUTES,
        SOLAR_POLL_MINUTES,
        PHYSICAL_PREMIUM_POLL_MINUTES,
    )

    scheduled_poll()
    _schedule_weather_with_startup_delay()
    scheduled_storage()
    scheduled_market_prices()
    scheduled_ttf()
    scheduled_nbp()
    scheduled_solar()
    scheduled_carbon()
    scheduled_physical_premium()
    scheduled_morning_brief()
    schedule.every(POLL_INTERVAL_SECONDS).seconds.do(scheduled_poll)
    schedule.every(STORAGE_POLL_HOURS).hours.do(scheduled_storage)
    schedule.every(MARKET_INDEX_POLL_MINUTES).minutes.do(scheduled_market_prices)
    schedule.every(TTF_POLL_MINUTES).minutes.do(scheduled_ttf)
    schedule.every(TTF_POLL_MINUTES).minutes.do(scheduled_nbp)
    schedule.every(SOLAR_POLL_MINUTES).minutes.do(scheduled_solar)
    schedule.every(1).hours.do(scheduled_carbon)
    schedule.every(PHYSICAL_PREMIUM_POLL_MINUTES).minutes.do(scheduled_physical_premium)
    # 06:00 / 07:30 — use TZ=UTC on the host (e.g. Railway) so these align with UTC.
    schedule.every().day.at("06:00").do(scheduled_morning_brief)
    schedule.every().day.at("07:30").do(scheduled_price_move_alerts)
    schedule.every().day.at("02:00").do(scheduled_accuracy_fill)
    schedule.every().day.at("02:05").do(scheduled_kalman_calibration)

    while True:
        schedule.run_pending()
        time.sleep(1)


if __name__ == "__main__":
    main()
