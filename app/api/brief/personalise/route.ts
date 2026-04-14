import { NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/auth/rate-limit";
import { requireUser } from "@/lib/auth/require-user";
import { createClient } from "@/lib/supabase/server";

type PersonaliseReq = {
  overnight_summary?: string;
  one_risk?: string;
  normalised_score?: number;
  direction?: string;
  regime?: string | null;
  residual_demand?: number | null;
  implied_price?: number | null;
  market_price?: number | null;
  gap?: number | null;
  srmc?: number | null;
  remit_mw?: number | null;
  positions?: Array<{
    instrument?: string;
    market?: string;
    direction?: string;
    size?: number;
    unit?: string;
    trade_price?: number | null;
  }>;
};

function asNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function fmtGbp(n: unknown): string {
  const v = asNum(n);
  if (v == null) return "—";
  return v.toFixed(2);
}

function fmtGw(n: unknown): string {
  const v = asNum(n);
  if (v == null) return "—";
  return v.toFixed(1);
}

function fmtScore(n: unknown): string {
  const v = asNum(n);
  if (v == null) return "—";
  return v.toFixed(1);
}

function extractAnthropicText(rawText: string): string {
  const parsed = JSON.parse(rawText) as {
    content?: Array<{ type?: string; text?: string }>;
  };
  return (parsed.content ?? [])
    .filter((c) => c?.type === "text" && typeof c.text === "string")
    .map((c) => c.text ?? "")
    .join("\n")
    .trim();
}

/** Match if full label appears, or enough distinctive tokens (models paraphrase names). */
function positionReferencedInText(text: string, label: string): boolean {
  const lower = text.toLowerCase();
  const l = label.trim().toLowerCase();
  if (!l) return false;
  if (lower.includes(l)) return true;
  const words = l.split(/\s+/).filter((w) => w.length > 2);
  if (words.length <= 1) {
    return words.length === 1 && lower.includes(words[0]!);
  }
  const hits = words.filter((w) => lower.includes(w));
  return hits.length >= Math.min(words.length, Math.ceil(words.length * 0.6));
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
    const rateLimit = checkRateLimit({
      key: user.id,
      bucket: "brief_personalise",
      limit: 6,
      windowMs: 60_000,
    });
    if (!rateLimit.allowed) {
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

    const body = (await req.json()) as PersonaliseReq;
    const normalised_score = fmtScore(body.normalised_score);
    const direction = String(body.direction ?? "STABLE");
    const regime = String(body.regime ?? "—").trim() || "—";
    const residual_demand = fmtGw(body.residual_demand);
    const market_price = fmtGbp(body.market_price);
    const implied_price = fmtGbp(body.implied_price);
    const gap = fmtGbp(body.gap);
    const srmc = fmtGbp(body.srmc);
    const remitMwRaw = asNum(body.remit_mw);
    const remit_mw =
      remitMwRaw != null && Number.isFinite(remitMwRaw)
        ? remitMwRaw.toFixed(1)
        : "—";

    const positions = Array.isArray(body.positions) ? body.positions : [];
    const normalizedPositions = positions.map((p) => {
      const dir = String(p.direction ?? "long");
      const size = asNum(p.size) ?? 0;
      const unit = String(p.unit ?? "");
      const instrument = String(p.instrument ?? "").trim();
      const market = String(p.market ?? "unknown");
      const tp = asNum(p.trade_price);
      const label =
        instrument ||
        `${market} ${dir} ${size} ${unit}`.replace(/\s+/g, " ").trim();
      return { dir, size, unit, instrument, market, tp, label };
    });

    const focusPositions = [...normalizedPositions].sort(
      (a, b) => Math.abs(b.size) - Math.abs(a.size),
    );

    if (focusPositions.length === 0) {
      return NextResponse.json(
        { error: "No open positions to personalise" },
        { status: 400 },
      );
    }

    const requiredLabels = focusPositions.map((p) => p.label).filter(Boolean);

    const position_lines = focusPositions
      .map((p) => {
        const side = p.dir.toLowerCase() === "short" ? "SHORT" : "LONG";
        const inst = p.instrument || p.label;
        const entry =
          p.tp == null || !Number.isFinite(p.tp) ? "market" : String(p.tp);
        return `${side} ${p.size} ${p.unit} ${inst} (${p.market}) — entered at ${entry}`;
      })
      .join("\n");

    const userPrompt = `Physical conditions as of this morning:
- Regime: ${regime} | Residual demand: ${residual_demand} GW | Physical premium score: ${normalised_score} (${direction})
- Market price: £${market_price}/MWh | Physically-implied price: £${implied_price}/MWh | Gap: £${gap}/MWh
- SRMC anchor: £${srmc}/MWh | REMIT capacity impact: ${remit_mw} MW active outages

Open positions:
${position_lines}

Write one paragraph explaining what this morning's physical picture means for these specific lines. 
Rules:
- Reference each position by its exact instrument name using third-person observational language ("The long …", "The short …") — never "I", "we", "you", "my", "your", or "our"
- State whether each position is helped or hurt by current conditions and by how much in £/MWh terms where possible
- Identify the single biggest risk to the book today
- End with one specific thing to watch
- No hedging language. No 'may', 'could', 'might'. State things directly.

Example of the style and quality required:
"The long 50 MW GB Power Q3 2026 Baseload entered at £89.50 faces £35/MWh of mean reversion risk with the market at £125 against a physically-implied £90 — renewable dominance at 18 GW wind is structurally suppressing the price anchor the position needs. Both short gas legs are correctly positioned: the short 25,000 therm NBP Winter 2026 and short 10 MW TTF Q4 2026 benefit from temperature-suppressed demand keeping TTF capped around €50/MWh. The key risk today is a wind ramp-down below 15 GW switching the regime and pulling power back toward SRMC — watch the 14:00-18:00 UTC window where forecast uncertainty is highest."`;

    const systemPrompt =
      "You are a senior energy markets analyst writing a single morning observation paragraph. You write exactly one paragraph of 3-4 sentences. Every sentence contains a specific number — price, volume, or percentage. You never use phrases like 'it is worth noting', 'it is important', or filler. You write in third-person observational voice only: describe the book and the physical picture as an analyst would — never first or second person (no I, we, you, my, your, our).";

    async function runAnthropic(
      apiKey: string,
      prompt: string,
    ): Promise<string> {
      const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 600,
          system: systemPrompt,
          messages: [{ role: "user", content: prompt }],
        }),
      });

      const rawText = await anthropicRes.text();
      if (!anthropicRes.ok) {
        throw new Error(
          `Anthropic error: ${anthropicRes.status} ${rawText.slice(0, 300)}`,
        );
      }
      return extractAnthropicText(rawText);
    }

    function validatePersonalisedText(text: string): boolean {
      if (!text || /^invalid\.?$/i.test(text.trim())) return false;
      return requiredLabels.every((label) =>
        positionReferencedInText(text, label),
      );
    }

    let text = "";
    try {
      text = await runAnthropic(key, userPrompt);
      if (!validatePersonalisedText(text)) {
        text = await runAnthropic(
          key,
          `${userPrompt}\n\nRewrite in third-person observational analyst voice. Reference every named instrument from the book above; no I/you/we/my/your.`,
        );
      }
      if (!validatePersonalisedText(text)) {
        text = await runAnthropic(
          key,
          `${userPrompt}\n\nFinal pass: name each instrument from the list explicitly and link each to today's drivers. Third person only.`,
        );
      }
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : String(error) },
        { status: 500 },
      );
    }

    if (!validatePersonalisedText(text)) {
      return NextResponse.json(
        { error: "Personalised output was not specific to the user's book" },
        { status: 500 },
      );
    }

    const cleaned = text.replace(/\[P\d+\]\s*/g, "").trim();
    if (!cleaned || !validatePersonalisedText(cleaned)) {
      return NextResponse.json(
        { error: "Personalised output omitted one or more open positions" },
        { status: 500 },
      );
    }

    return NextResponse.json({ text: cleaned });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
