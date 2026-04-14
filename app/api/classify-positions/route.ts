import { NextResponse } from "next/server";
import { logAuthAuditEvent } from "@/lib/auth/audit";
import { checkRateLimit } from "@/lib/auth/rate-limit";
import { assertSameOrigin } from "@/lib/auth/request-security";
import { requireUser } from "@/lib/auth/require-user";
import { createClient } from "@/lib/supabase/server";

const MODEL = "claude-haiku-4-5-20251001";
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

    const slice = rows.slice(0, 100);
    const redactedSlice = slice.map(redactRow);
    const userMessage = `Classify these trading positions. CSV headers: ${JSON.stringify(headers)}. Rows (sensitive fields redacted): ${JSON.stringify(redactedSlice)}`;

    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 16384,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userMessage }],
      }),
    });

    const rawText = await anthropicRes.text();
    if (!anthropicRes.ok) {
      return NextResponse.json(
        {
          error: "Anthropic API error",
          status: anthropicRes.status,
          detail: rawText.slice(0, 2000),
        },
        { status: 502 },
      );
    }

    let parsed: {
      content?: Array<{ type?: string; text?: string }>;
    };
    try {
      parsed = JSON.parse(rawText) as typeof parsed;
    } catch {
      return NextResponse.json(
        { error: "Invalid response from Anthropic" },
        { status: 502 },
      );
    }

    const textBlock = parsed.content?.find((c) => c.type === "text");
    const text = textBlock?.text?.trim() ?? "";
    const jsonStr = extractJsonArray(text);
    if (!jsonStr) {
      return NextResponse.json(
        {
          error: "Could not parse classification JSON",
          raw: text.slice(0, 4000),
        },
        { status: 502 },
      );
    }

    let classified: unknown;
    try {
      classified = JSON.parse(jsonStr);
    } catch {
      return NextResponse.json(
        { error: "Classification JSON parse failed", raw: jsonStr.slice(0, 2000) },
        { status: 502 },
      );
    }

    if (!Array.isArray(classified)) {
      return NextResponse.json(
        { error: "Expected JSON array from model" },
        { status: 502 },
      );
    }

    // Keep user-facing row context local; do not forward raw rows externally.
    const merged = classified.map((entry, idx) => {
      if (!entry || typeof entry !== "object") return entry;
      return {
        ...entry,
        original_row: slice[idx] ?? null,
      };
    });

    return NextResponse.json({ classified: merged });
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
