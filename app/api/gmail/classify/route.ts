import { NextResponse } from "next/server";
import { requireEntitlement } from "@/lib/auth/require-entitlement";
import { assertSameOrigin } from "@/lib/auth/request-security";
import { requireUser } from "@/lib/auth/require-user";
import { tenorToExpiryDate } from "@/lib/portfolio/book";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const MODEL = "claude-haiku-4-5-20251001";
const MAX_TOKENS = 6400;

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

type ClassifiedEntry = {
  keep: boolean;
  discard_reason: string | null;
  instrument_type: string | null;
  market: string | null;
  direction: "long" | "short" | null;
  size: number | null;
  unit: "MW" | "MWh" | "therm" | "MMBtu" | "tCO2" | "lot" | null;
  tenor: string | null;
  trade_price: number | null;
  currency: "GBP" | "EUR" | "USD" | null;
  expiry_date: string | null;
  entry_date: string | null;
  instrument: string;
  warnings: string[];
};

type TradeImportRow = {
  id: string;
  subject: string | null;
  raw_text: string | null;
};

async function callAnthropic(apiKey: string, userMessage: string): Promise<string> {
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
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) {
      return NextResponse.json(
        { error: "ANTHROPIC_API_KEY is not configured" },
        { status: 500 },
      );
    }

    const supabase = await createClient();
    const auth = await requireUser(supabase);
    if (auth.response) return auth.response;
    const user = auth.user!;

    const entitlement = await requireEntitlement(supabase, user.id, {
      feature: "portfolioEnabled",
      minimumTier: "pro",
    });
    if (entitlement.response) return entitlement.response;

    const csrf = assertSameOrigin(req);
    if (csrf) return csrf;

    const body = (await req.json().catch(() => ({}))) as { import_id?: unknown };
    const importId =
      typeof body.import_id === "string" ? body.import_id.trim() : "";
    if (!importId) {
      return NextResponse.json({ error: "import_id is required" }, { status: 400 });
    }

    const { data: pendingImport, error: fetchError } = await supabase
      .from("email_trade_imports")
      .select("id, subject, raw_text")
      .eq("id", importId)
      .eq("user_id", user.id)
      .eq("status", "pending")
      .maybeSingle<TradeImportRow>();

    if (fetchError) {
      return NextResponse.json({ error: fetchError.message }, { status: 500 });
    }
    if (!pendingImport) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const subject = pendingImport.subject ?? "";
    const rawText = pendingImport.raw_text ?? "";
    const userMessage = `Parse this broker trade confirmation email and extract all energy trading positions. Email subject: ${subject}. Email body: ${rawText}`;

    const rawModelResponse = await callAnthropic(key, userMessage);
    const parsedEnvelope = JSON.parse(rawModelResponse) as {
      content?: Array<{ type?: string; text?: string }>;
    };
    const text = parsedEnvelope.content?.find((c) => c.type === "text")?.text ?? "";
    const jsonStr = extractJsonArray(text);
    if (!jsonStr) {
      return NextResponse.json(
        { error: "Could not parse classification JSON" },
        { status: 502 },
      );
    }

    const parsedPositions = JSON.parse(jsonStr) as unknown;
    if (!Array.isArray(parsedPositions)) {
      return NextResponse.json(
        { error: "Classifier response was not an array" },
        { status: 502 },
      );
    }

    const classified = parsedPositions.map((entry) =>
      normaliseClassifiedEntry(
        entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {},
      ),
    );

    const { error: updateError } = await supabase
      .from("email_trade_imports")
      .update({
        status: "classified",
        classified_positions: classified,
      })
      .eq("id", importId)
      .eq("user_id", user.id);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    return NextResponse.json({ classified, import_id: importId });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Classification failed" },
      { status: 500 },
    );
  }
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

function normaliseClassifiedEntry(entry: Record<string, unknown>): ClassifiedEntry {
  const warnings: string[] = [];
  const market = normaliseMarketValue(entry.market);
  if (!market) warnings.push("Unknown market; defaulted to null.");
  const unit = normaliseUnitValue(entry.unit, market);
  if (!safeString(entry.unit)) warnings.push("Missing unit; inferred default unit.");
  let currency = normaliseCurrencyValue(entry.currency, market, unit);
  if (!safeString(entry.currency))
    warnings.push("Missing currency; inferred default currency.");
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
  const unsupportedTypes = new Set([
    "power_option",
    "gas_option",
    "renewable_certificate",
  ]);

  const rawInstrumentType = normaliseInstrumentTypeValue(entry.instrument_type, market);
  const isUnsupportedType =
    rawInstrumentType != null && unsupportedTypes.has(rawInstrumentType);

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

function inferDirection(text: string): "long" | "short" | null {
  if (/\b(short|sell|sold)\b/.test(text)) return "short";
  if (/\b(long|buy|bought)\b/.test(text)) return "long";
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
