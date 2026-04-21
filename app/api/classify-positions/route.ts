import { NextResponse } from "next/server";
import { logAuthAuditEvent } from "@/lib/auth/audit";
import { requireEntitlement } from "@/lib/auth/require-entitlement";
import { checkRateLimit } from "@/lib/auth/rate-limit";
import { assertSameOrigin } from "@/lib/auth/request-security";
import { requireUser } from "@/lib/auth/require-user";
import { createClient } from "@/lib/supabase/server";
import { tenorToExpiryDate } from "@/lib/portfolio/book";
import { makeReliabilityEnvelope } from "@/lib/reliability/contract";

const MODEL = "claude-haiku-4-5-20251001";
const MAX_TOKENS = 6400;
const REDACT_KEYS = [
  "name",
  "email",
  "phone",
  "counterparty",
  "account",
  "iban",
  "swift",
  "address",
  "trader",
  "book",
  "portfolio",
];

const SYSTEM_PROMPT = `You are a trading position classifier for an energy markets intelligence platform. Your job is to analyse rows from a trading CSV export and classify each row as energy-relevant or not. You must handle any CSV format from any broker or exchange — Trayport, ICE, Bloomberg TOMS, Marex, Tradition, BGC, GFI, or any other. Be flexible with column names and formats.

For each row, determine:
1. Is this an energy position? (power, gas, LNG, carbon, renewable certificates, spark spreads, dark spreads, electricity derivatives)
2. If yes, extract the standardised fields

Return ONLY a JSON array with no preamble, no markdown, no backticks. Each element must be an object with these keys (use double quotes for JSON):
"keep": boolean,
"discard_reason": string or null (null if keep is true),
"instrument_type": one of "power_forward"|"gas_forward"|"spark_spread"|"dark_spread"|"carbon"|"renewable_certificate"|"power_option"|"gas_option"|"other_energy"|null,
"market": one of "GB_power"|"NBP"|"TTF"|"EUA"|"UKA"|"nordic_power"|"german_power"|"french_power"|"other_gas"|"other_power"|"other_carbon"|null,
"direction": "long"|"short"|null,
"size": number or null,
"unit": "MW"|"MWh"|"therm"|"MMBtu"|"tCO2"|"lot"|null,
"tenor": string or null,
"trade_price": number or null,
"currency": "GBP"|"EUR"|"USD"|null,
"expiry_date": "YYYY-MM-DD" string or null,
"entry_date": "YYYY-MM-DD" string or null,
"instrument": string (human readable instrument name),
"original_row": object (the original row fields as key-value pairs)

The array must have exactly one object per input row, in the same order as the input rows.

CRITICAL — trade_price:
trade_price must be extracted EXACTLY from the CSV row — it is the price at which the trade was executed, not the current market price. Never substitute, infer, or estimate a price from live markets or benchmarks. If no executed trade price is visible in the row, return null. The trade_price field is critical for P&L accuracy.

CRITICAL — currency:
For TTF and other EUR-denominated markets, set currency to "EUR" and trade_price as the numeric value in EUR/MWh (or appropriate EUR unit) exactly as in the CSV. Do not convert EUR trade prices to GBP at extraction time.`;

async function callAnthropic(
  apiKey: string,
  userMessage: string,
): Promise<string> {
  const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    }),
  });

  const rawText = await anthropicRes.text();
  if (!anthropicRes.ok) {
    throw new Error(
      `Anthropic API error (${anthropicRes.status}): ${rawText.slice(0, 300)}`,
    );
  }
  return rawText;
}

export async function POST(req: Request) {
  try {
    const csrf = assertSameOrigin(req);
    if (csrf) return csrf;

    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) {
      return NextResponse.json(
        { error: "ANTHROPIC_API_KEY is not configured" },
        { status: 500 },
      );
    }

    const supabase = await createClient();
    const auth = await requireUser(supabase);
    if (auth.response) {
      await logAuthAuditEvent({
        event: "classify_positions_unauthorized",
        status: "failure",
      });
      return auth.response;
    }
    const user = auth.user!;
    const entitlement = await requireEntitlement(supabase, user.id, {
      feature: "portfolioEnabled",
      minimumTier: "pro",
    });
    if (entitlement.response) {
      await logAuthAuditEvent({
        event: "classify_positions_plan_required",
        userId: user.id,
        status: "failure",
      });
      return entitlement.response;
    }

    const rateLimit = await checkRateLimit({
      key: user.id,
      bucket: "classify_positions",
      limit: 12,
      windowMs: 60_000,
    });
    if (!rateLimit.allowed) {
      await logAuthAuditEvent({
        event: "classify_positions_rate_limited",
        userId: user.id,
        status: "failure",
      });
      return NextResponse.json(
        {
          code: "RATE_LIMITED",
          error: "Too many requests. Please wait before retrying.",
        },
        {
          status: 429,
          headers: { "Retry-After": String(rateLimit.retryAfterSec) },
        },
      );
    }

    const body = (await req.json()) as {
      headers?: unknown;
      rows?: unknown;
    };
    const headers = Array.isArray(body.headers)
      ? body.headers.filter((h): h is string => typeof h === "string")
      : [];
    const rows = Array.isArray(body.rows)
      ? body.rows.filter(
          (r): r is Record<string, unknown> =>
            r != null && typeof r === "object" && !Array.isArray(r),
        )
      : [];
    if (rows.length === 0) {
      return NextResponse.json(
        { error: "rows array is required" },
        { status: 400 },
      );
    }
    if (rows.length > 1000) {
      return NextResponse.json(
        { error: "Maximum 1000 rows are allowed per request." },
        { status: 400 },
      );
    }

    const redactedRows = rows.map(redactRow);
    const userMessage = `Classify these trading positions. CSV headers: ${JSON.stringify(headers)}. Rows (sensitive fields redacted): ${JSON.stringify(redactedRows)}`;
    await logAuthAuditEvent({
      event: "classify_positions_attempted",
      userId: user.id,
      status: "info",
      metadata: { rows: rows.length },
    });

    let rawText: string;
    try {
      rawText = await callAnthropic(key, userMessage);
    } catch (err: unknown) {
      await logAuthAuditEvent({
        event: "classify_positions_model_fallback",
        userId: user.id,
        status: "failure",
        metadata: {
          reason:
            err instanceof Error ? err.message : "Anthropic API request failed",
        },
      });
      const reliability = makeReliabilityEnvelope({
        modelVersion: MODEL,
        dataVersion: "classify_v1",
        fallbackUsed: true,
        coverage: rows.length > 0 ? 1 : 0,
        evidence: ["anthropic_request_failed"],
      });
      return NextResponse.json({
        classified: heuristicClassify(rows),
        mode: "fallback",
        reliability,
      });
    }

    let parsed: {
      content?: Array<{ type?: string; text?: string }>;
    };
    try {
      parsed = JSON.parse(rawText) as typeof parsed;
    } catch {
      await logAuthAuditEvent({
        event: "classify_positions_model_fallback",
        userId: user.id,
        status: "failure",
        metadata: { reason: "Invalid response envelope from Anthropic" },
      });
      const reliability = makeReliabilityEnvelope({
        modelVersion: MODEL,
        dataVersion: "classify_v1",
        fallbackUsed: true,
        coverage: rows.length > 0 ? 1 : 0,
        evidence: ["invalid_response_envelope"],
      });
      return NextResponse.json({
        classified: heuristicClassify(rows),
        mode: "fallback",
        reliability,
      });
    }

    const textBlock = parsed.content?.find((c) => c.type === "text");
    const text = textBlock?.text?.trim() ?? "";
    const jsonStr = extractJsonArray(text);
    if (!jsonStr) {
      await logAuthAuditEvent({
        event: "classify_positions_model_fallback",
        userId: user.id,
        status: "failure",
        metadata: { reason: "Could not parse classification JSON" },
      });
      const reliability = makeReliabilityEnvelope({
        modelVersion: MODEL,
        dataVersion: "classify_v1",
        fallbackUsed: true,
        coverage: rows.length > 0 ? 1 : 0,
        evidence: ["json_array_extract_failed"],
      });
      return NextResponse.json({
        classified: heuristicClassify(rows),
        mode: "fallback",
        reliability,
      });
    }

    let classified: unknown;
    try {
      classified = JSON.parse(jsonStr);
    } catch {
      // Retry with a strict JSON-repair pass to avoid UI failures on otherwise good classifications.
      const repairPrompt = `Convert the following content into valid strict JSON only.
Return ONLY a JSON array and nothing else.
Preserve array length and object field values exactly where possible.

CONTENT:
${jsonStr}`;
      try {
        const repairRaw = await callAnthropic(key, repairPrompt);
        const repairParsed = JSON.parse(repairRaw) as {
          content?: Array<{ type?: string; text?: string }>;
        };
        const repairedText =
          repairParsed.content?.find((c) => c.type === "text")?.text?.trim() ??
          "";
        const repairedArray = extractJsonArray(repairedText);
        if (!repairedArray) {
          await logAuthAuditEvent({
            event: "classify_positions_model_fallback",
            userId: user.id,
            status: "failure",
            metadata: { reason: "Repair pass did not return JSON array" },
          });
          const reliability = makeReliabilityEnvelope({
            modelVersion: MODEL,
            dataVersion: "classify_v1",
            fallbackUsed: true,
            coverage: rows.length > 0 ? 1 : 0,
            evidence: ["repair_no_json_array"],
          });
          return NextResponse.json({
            classified: heuristicClassify(rows),
            mode: "fallback",
            reliability,
          });
        }
        classified = JSON.parse(repairedArray);
      } catch {
        await logAuthAuditEvent({
          event: "classify_positions_model_fallback",
          userId: user.id,
          status: "failure",
          metadata: { reason: "Classification JSON parse failed" },
        });
        const reliability = makeReliabilityEnvelope({
          modelVersion: MODEL,
          dataVersion: "classify_v1",
          fallbackUsed: true,
          coverage: rows.length > 0 ? 1 : 0,
          evidence: ["repair_parse_failed"],
        });
        return NextResponse.json({
          classified: heuristicClassify(rows),
          mode: "fallback",
          reliability,
        });
      }
    }

    if (!Array.isArray(classified)) {
      await logAuthAuditEvent({
        event: "classify_positions_model_fallback",
        userId: user.id,
        status: "failure",
        metadata: { reason: "Model response was not an array" },
      });
      const reliability = makeReliabilityEnvelope({
        modelVersion: MODEL,
        dataVersion: "classify_v1",
        fallbackUsed: true,
        coverage: rows.length > 0 ? 1 : 0,
        evidence: ["model_not_array"],
      });
      return NextResponse.json({
        classified: heuristicClassify(rows),
        mode: "fallback",
        reliability,
      });
    }

    // Keep user-facing row context local; do not forward raw rows externally.
    const merged = classified.map((entry, idx) => {
      if (!entry || typeof entry !== "object") return entry;
      return {
        ...normaliseClassifiedEntry(entry as Record<string, unknown>),
        original_row: rows[idx] ?? null,
      };
    });

    if (merged.length !== rows.length) {
      await logAuthAuditEvent({
        event: "classify_positions_model_fallback",
        userId: user.id,
        status: "failure",
        metadata: {
          reason: "Model length mismatch",
          modelCount: merged.length,
          rowCount: rows.length,
        },
      });
      const reliability = makeReliabilityEnvelope({
        modelVersion: MODEL,
        dataVersion: "classify_v1",
        fallbackUsed: true,
        coverage: rows.length > 0 ? 1 : 0,
        evidence: ["model_length_mismatch"],
      });
      return NextResponse.json({
        classified: heuristicClassify(rows),
        mode: "fallback",
        reliability,
      });
    }
    await logAuthAuditEvent({
      event: "classify_positions_succeeded",
      userId: user.id,
      status: "success",
      metadata: { rows: rows.length, mode: "model" },
    });
    const reliability = makeReliabilityEnvelope({
      modelVersion: MODEL,
      dataVersion: "classify_v1",
      fallbackUsed: false,
      coverage: rows.length > 0 ? 1 : 0,
      evidence: ["model_json_parse_ok", "normalization_applied"],
    });
    return NextResponse.json({
      classified: merged,
      mode: "model",
      reliability,
    });
  } catch (e: unknown) {
    await logAuthAuditEvent({
      event: "classify_positions_failed",
      status: "failure",
      metadata: { reason: e instanceof Error ? e.message : String(e) },
    });
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

function heuristicClassify(rows: Record<string, unknown>[]) {
  return rows.map((row) => classifyRowHeuristic(row));
}

function classifyRowHeuristic(row: Record<string, unknown>) {
  const text = Object.values(row)
    .map((v) => String(v ?? ""))
    .join(" ")
    .toLowerCase();

  const market = inferMarket(text);
  const isEnergy =
    market != null ||
    /(power|electricity|spark|dark|gas|ttf|nbp|lng|uka|eua|carbon|co2|eload|baseload|peakload)/i.test(
      text,
    );

  const direction = inferDirection(text);
  const size = inferNumber(row, ["size", "qty", "quantity", "volume", "nominal"]);
  const tradePrice = inferNumber(row, [
    "trade_price",
    "price",
    "strike",
    "deal_price",
    "avg_price",
  ]);
  const instrument =
    inferString(row, ["instrument", "product", "contract", "description"]) ??
    "Unclassified position";
  const unit = inferUnit(row, text);
  const currency = inferCurrency(row, text, market);

  const inferredType = inferInstrumentType(text, market);
  const UNSUPPORTED = new Set(["power_option", "gas_option", "renewable_certificate"]);
  const isUnsupported = inferredType != null && UNSUPPORTED.has(inferredType);
  const keepFinal = isEnergy && !isUnsupported;
  const discardReasonFinal = keepFinal
    ? null
    : isUnsupported
      ? inferredType === "renewable_certificate"
        ? "Renewable certificates (GOO/REGO) are not yet supported — P&L cannot be calculated"
        : inferredType === "power_option"
          ? "Power options are not yet supported — P&L cannot be calculated"
          : "Gas options are not yet supported — P&L cannot be calculated"
      : "Non-energy instrument";

  const tenor = inferString(row, ["tenor", "prompt", "delivery", "period", "strip"]);
  const expiryDate =
    inferDate(row, ["expiry_date", "expiry", "maturity", "end_date"]) ??
    tenorToExpiryDate(tenor);
  return {
    keep: keepFinal,
    discard_reason: discardReasonFinal,
    instrument_type: inferredType,
    market,
    direction,
    size,
    unit,
    tenor,
    trade_price: tradePrice,
    currency,
    expiry_date: expiryDate,
    entry_date: inferDate(row, ["entry_date", "trade_date", "deal_date", "date"]),
    instrument,
    original_row: row,
  };
}

function inferMarket(text: string) {
  if (/\bttf\b/.test(text)) return "TTF";
  if (/\bnbp\b/.test(text)) return "NBP";
  if (/\buka\b/.test(text)) return "UKA";
  if (/\beua\b/.test(text) || /\beuu?a\b/.test(text)) return "EUA";
  if (/\bnordic\b/.test(text)) return "nordic_power";
  if (/\bgerman\b|\bde power\b/.test(text)) return "german_power";
  if (/\bfrench\b|\bfr power\b/.test(text)) return "french_power";
  if (/\bgb\b|\bapx\b|\bn2ex\b|\bpower\b|\bbaseload\b|\bpeakload\b/.test(text))
    return "GB_power";
  if (/\bgas\b|\blng\b/.test(text)) return "other_gas";
  if (/\bco2\b|\bcarbon\b/.test(text)) return "other_carbon";
  return null;
}

function inferInstrumentType(text: string, market: string | null) {
  if (/\b(goo|rego|guarantee\s+of\s+origin|renewable\s+certificate)\b/i.test(text)) {
    return "renewable_certificate";
  }
  if (/\bspark\b/.test(text)) return "spark_spread";
  if (/\bdark\b/.test(text)) return "dark_spread";
  if (/\boption\b|\bcall\b|\bput\b/.test(text)) {
    if (market === "TTF" || market === "NBP" || market === "other_gas") {
      return "gas_option";
    }
    return "power_option";
  }
  if (market === "UKA" || market === "EUA" || market === "other_carbon")
    return "carbon";
  if (market === "TTF" || market === "NBP" || market === "other_gas")
    return "gas_forward";
  if (
    market === "GB_power" ||
    market === "nordic_power" ||
    market === "german_power" ||
    market === "french_power" ||
    market === "other_power"
  ) {
    return "power_forward";
  }
  return "other_energy";
}

function inferDirection(text: string): "long" | "short" | null {
  if (/\b(short|sell|sold)\b/.test(text)) return "short";
  if (/\b(long|buy|bought)\b/.test(text)) return "long";
  return null;
}

function inferUnit(
  row: Record<string, unknown>,
  text: string,
): "MW" | "MWh" | "therm" | "MMBtu" | "tCO2" | "lot" | null {
  const raw = inferString(row, ["unit", "uom", "units"])?.toLowerCase() ?? "";
  const merged = `${raw} ${text}`;
  if (merged.includes("mmbtu")) return "MMBtu";
  if (merged.includes("therm")) return "therm";
  if (merged.includes("tco2") || merged.includes(" co2") || merged.includes("carbon"))
    return "tCO2";
  if (/\bmw\b/.test(merged)) return "MW";
  if (/\bmwh\b/.test(merged)) return "MWh";
  if (merged.includes("lot")) return "lot";
  return null;
}

function inferCurrency(
  row: Record<string, unknown>,
  text: string,
  market: string | null,
): "GBP" | "EUR" | "USD" | null {
  const raw = inferString(row, ["currency", "ccy"])?.toUpperCase() ?? "";
  if (raw === "GBP" || raw === "EUR" || raw === "USD") return raw;
  if (market === "TTF" || market === "EUA") return "EUR";
  if (/\beur\b|€/.test(text)) return "EUR";
  if (/\busd\b|\$/.test(text)) return "USD";
  if (/\bgbp\b|£/.test(text)) return "GBP";
  return null;
}

function inferNumber(
  row: Record<string, unknown>,
  keys: string[],
): number | null {
  for (const [k, v] of Object.entries(row)) {
    const key = k.toLowerCase();
    if (!keys.some((candidate) => key.includes(candidate))) continue;
    const parsed = parseLooseNumber(v);
    if (parsed != null) return parsed;
  }
  return null;
}

function inferString(row: Record<string, unknown>, keys: string[]): string | null {
  for (const [k, v] of Object.entries(row)) {
    const key = k.toLowerCase();
    if (!keys.some((candidate) => key.includes(candidate))) continue;
    const text = String(v ?? "").trim();
    if (text) return text;
  }
  return null;
}

function inferDate(row: Record<string, unknown>, keys: string[]): string | null {
  const raw = inferString(row, keys);
  if (!raw) return null;
  const value = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(value)) {
    const [d, m, y] = value.split("/");
    return `${y}-${m}-${d}`;
  }
  return null;
}

function parseLooseNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const text = String(value ?? "")
    .replace(/,/g, "")
    .replace(/[^\d.\-]/g, "")
    .trim();
  if (!text) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

const MARKET_SET = new Set([
  "GB_power",
  "NBP",
  "TTF",
  "EUA",
  "UKA",
  "nordic_power",
  "german_power",
  "french_power",
  "other_gas",
  "other_power",
  "other_carbon",
] as const);

const INSTRUMENT_TYPE_SET = new Set([
  "power_forward",
  "gas_forward",
  "spark_spread",
  "dark_spread",
  "carbon",
  "renewable_certificate",
  "power_option",
  "gas_option",
  "other_energy",
] as const);

function normaliseClassifiedEntry(entry: Record<string, unknown>) {
  const warnings: string[] = [];
  const market = normaliseMarketValue(entry.market);
  if (!market) warnings.push("Unknown market; defaulted to null.");
  const unit = normaliseUnitValue(entry.unit, market);
  if (!safeString(entry.unit)) warnings.push("Missing unit; inferred default unit.");
  let currency = normaliseCurrencyValue(entry.currency, market, unit);
  if (!safeString(entry.currency))
    warnings.push("Missing currency; inferred default currency.");
  // UKA trades settle in GBP, EUA trades settle in EUR. When a user-supplied
  // currency contradicts the market convention the trade_price is almost
  // always already in the conventional currency and the tag is a CSV
  // mis-label — coercing silently produced wrong P&L before (a UKA position
  // tagged EUR would be FX-converted at import). Coerce back to the
  // convention and emit a warning so the user can audit the row.
  if (market === "UKA" && currency === "EUR") {
    warnings.push(
      "UKA settles in GBP; overriding EUR tag. If trade_price is actually EUR/tCO2, re-upload with market=EUA.",
    );
    currency = "GBP";
  }
  if (market === "EUA" && currency === "GBP") {
    warnings.push(
      "EUA settles in EUR; overriding GBP tag. If trade_price is actually GBP/tCO2, re-upload with market=UKA.",
    );
    currency = "EUR";
  }
  const direction = normaliseDirectionValue(entry.direction);
  if (!direction) warnings.push("Missing direction.");
  const size = parseLooseNumber(entry.size);
  if (size == null) warnings.push("Missing size.");
  const tradePrice = parseLooseNumber(entry.trade_price);
  if (tradePrice == null) warnings.push("Missing trade price.");
  const UNSUPPORTED_INSTRUMENT_TYPES = new Set([
    "power_option",
    "gas_option",
    "renewable_certificate",
  ]);

  const rawInstrumentType = normaliseInstrumentTypeValue(entry.instrument_type, market);
  const isUnsupportedType = rawInstrumentType != null && UNSUPPORTED_INSTRUMENT_TYPES.has(rawInstrumentType);

  const keepRaw =
    typeof entry.keep === "boolean"
      ? entry.keep
      : market != null || !!inferDirection(JSON.stringify(entry).toLowerCase());

  const keep = keepRaw && !isUnsupportedType;

  const discardReason = keep
    ? null
    : isUnsupportedType
      ? rawInstrumentType === "renewable_certificate"
        ? "Renewable certificates (GOO/REGO) are not yet supported — P&L cannot be calculated"
        : rawInstrumentType === "power_option"
          ? "Power options are not yet supported — P&L cannot be calculated"
          : "Gas options are not yet supported — P&L cannot be calculated"
      : typeof entry.discard_reason === "string" && entry.discard_reason.trim()
        ? entry.discard_reason.trim()
        : "Non-energy instrument";

  const tenorValue = safeString(entry.tenor);
  const expiryValue =
    normaliseDateValue(entry.expiry_date) ?? tenorToExpiryDate(tenorValue);
  return {
    keep,
    discard_reason: discardReason,
    instrument_type: normaliseInstrumentTypeValue(entry.instrument_type, market),
    market,
    direction,
    size,
    unit,
    tenor: tenorValue,
    trade_price: tradePrice,
    currency,
    expiry_date: expiryValue,
    entry_date: normaliseDateValue(entry.entry_date),
    instrument: safeString(entry.instrument) ?? "Unclassified position",
    warnings,
  };
}

function safeString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normaliseDirectionValue(value: unknown): "long" | "short" | null {
  const v = safeString(value)?.toLowerCase();
  if (v === "long") return "long";
  if (v === "short") return "short";
  if (v === "buy") return "long";
  if (v === "sell") return "short";
  return null;
}

function normaliseMarketValue(value: unknown): string | null {
  const v = safeString(value);
  if (!v) return null;
  const lowered = v.toLowerCase().replace(/[\s-]+/g, "_");
  const aliasMap: Record<string, string> = {
    gb: "GB_power",
    gb_power: "GB_power",
    power: "other_power",
    uk_power: "GB_power",
    de_power: "german_power",
    fr_power: "french_power",
    nordic: "nordic_power",
    gas: "other_gas",
    carbon: "other_carbon",
    co2: "other_carbon",
  };
  const mapped = aliasMap[lowered] ?? v;
  if (MARKET_SET.has(mapped as (typeof MARKET_SET extends Set<infer T> ? T : never))) {
    return mapped;
  }
  return null;
}

function normaliseInstrumentTypeValue(
  value: unknown,
  market: string | null,
): string | null {
  const v = safeString(value)?.toLowerCase().replace(/[\s-]+/g, "_");
  const aliasMap: Record<string, string> = {
    power: "power_forward",
    gas: "gas_forward",
    option: market === "TTF" || market === "NBP" ? "gas_option" : "power_option",
    spread: "spark_spread",
  };
  const mapped = (v ? aliasMap[v] ?? v : null) as string | null;
  if (mapped && INSTRUMENT_TYPE_SET.has(mapped as (typeof INSTRUMENT_TYPE_SET extends Set<infer T> ? T : never))) {
    return mapped;
  }
  if (market === "UKA" || market === "EUA" || market === "other_carbon") {
    return "carbon";
  }
  if (market === "TTF" || market === "NBP" || market === "other_gas") {
    return "gas_forward";
  }
  if (
    market === "GB_power" ||
    market === "nordic_power" ||
    market === "german_power" ||
    market === "french_power" ||
    market === "other_power"
  ) {
    return "power_forward";
  }
  return "other_energy";
}

function normaliseUnitValue(value: unknown, market: string | null) {
  const v = safeString(value)?.toLowerCase();
  if (v === "mw") return "MW";
  if (v === "mwh") return "MWh";
  if (v === "therm" || v === "therms") return "therm";
  if (v === "mmbtu") return "MMBtu";
  if (v === "tco2" || v === "tco₂") return "tCO2";
  if (v === "lot" || v === "lots") return "lot";
  if (market === "NBP" || market === "other_gas") return "therm";
  if (market === "UKA" || market === "EUA" || market === "other_carbon")
    return "tCO2";
  return "MW";
}

function normaliseCurrencyValue(
  value: unknown,
  market: string | null,
  unit: string | null,
): "GBP" | "EUR" | "USD" | null {
  const v = safeString(value)?.toUpperCase();
  if (v === "GBP" || v === "EUR" || v === "USD") return v;
  if (market === "TTF" || market === "EUA") return "EUR";
  if (market === "NBP") return "GBP";
  if (market === "UKA") return "GBP";
  if (unit === "therm") return "GBP";
  return "GBP";
}

function normaliseDateValue(value: unknown): string | null {
  const v = safeString(value);
  if (!v) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(v)) {
    const [d, m, y] = v.split("/");
    return `${y}-${m}-${d}`;
  }
  return null;
}

function redactRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    const lowered = key.toLowerCase();
    const isSensitive = REDACT_KEYS.some((s) => lowered.includes(s));
    if (isSensitive) {
      out[key] = "[REDACTED]";
      continue;
    }
    if (typeof value === "string") {
      out[key] = value.length > 120 ? `${value.slice(0, 120)}…` : value;
      continue;
    }
    out[key] = value;
  }
  return out;
}

function extractJsonArray(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed.startsWith("[")) {
    return trimmed;
  }
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) {
    const inner = fence[1].trim();
    if (inner.startsWith("[")) return inner;
  }
  const start = trimmed.indexOf("[");
  const end = trimmed.lastIndexOf("]");
  if (start >= 0 && end > start) {
    return trimmed.slice(start, end + 1);
  }
  return null;
}
