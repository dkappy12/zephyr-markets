import { NextResponse } from "next/server";
import { logAuthAuditEvent } from "@/lib/auth/audit";
import { requireEntitlement } from "@/lib/auth/require-entitlement";
import { checkRateLimit } from "@/lib/auth/rate-limit";
import { assertSameOrigin } from "@/lib/auth/request-security";
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

const MAX_FOCUS_POSITIONS = 8;
const MAX_OVERNIGHT_SUMMARY_CHARS = 1600;
const MAX_ONE_RISK_CHARS = 450;

function clampContext(s: string, maxChars: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  if (t.length <= maxChars) return t;
  const cut = t.slice(0, maxChars);
  const lastSpace = cut.lastIndexOf(" ");
  const base = lastSpace > maxChars * 0.7 ? cut.slice(0, lastSpace) : cut;
  return `${base.trim()}…`;
}

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
  if (v == null) return "n/a";
  return v.toFixed(2);
}

function fmtGw(n: unknown): string {
  const v = asNum(n);
  if (v == null) return "n/a";
  return v.toFixed(1);
}

function fmtScore(n: unknown): string {
  const v = asNum(n);
  if (v == null) return "n/a";
  return v.toFixed(1);
}

/** Common analyst filler / meta phrases to discourage (guardrail hint). */
const BANNED_FILLER =
  /\b(it is worth noting|it is important to|needless to say|moving forward|at the end of the day|leverage synergies|robust framework)\b/i;

/** First/second person slips (positions copy must stay third-person observational). Omit \\bus\\b to avoid false positives on "US" (e.g. US Henry Hub). */
function containsDisallowedVoice(text: string): boolean {
  return /\b(I|me|my|mine|we|our|ours|you|your|yours)\b/i.test(text);
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
        event: "brief_personalise_unauthorized",
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
        event: "brief_personalise_plan_required",
        userId: user.id,
        status: "failure",
      });
      return entitlement.response;
    }

    const rateLimit = await checkRateLimit({
      key: user.id,
      bucket: "brief_personalise",
      limit: 6,
      windowMs: 60_000,
    });
    if (!rateLimit.allowed) {
      await logAuthAuditEvent({
        event: "brief_personalise_rate_limited",
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

    const body = (await req.json()) as PersonaliseReq;
    if (
      body.positions != null &&
      (!Array.isArray(body.positions) || body.positions.length > 500)
    ) {
      return NextResponse.json(
        {
          code: "INVALID_PAYLOAD",
          error: "positions must be an array with at most 500 rows.",
        },
        { status: 400 },
      );
    }
    const normalised_score = fmtScore(body.normalised_score);
    const direction = String(body.direction ?? "STABLE");
    const regime = String(body.regime ?? "n/a").trim() || "n/a";
    const residual_demand = fmtGw(body.residual_demand);
    const market_price = fmtGbp(body.market_price);
    const implied_price = fmtGbp(body.implied_price);
    const gap = fmtGbp(body.gap);
    const srmc = fmtGbp(body.srmc);
    const remitMwRaw = asNum(body.remit_mw);
    const remit_mw =
      remitMwRaw != null && Number.isFinite(remitMwRaw)
        ? remitMwRaw.toFixed(1)
        : "n/a";

    const positions = Array.isArray(body.positions)
      ? body.positions.filter((p) => p != null && typeof p === "object")
      : [];
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

    const focus = focusPositions.slice(0, MAX_FOCUS_POSITIONS);

    if (focus.length === 0) {
      return NextResponse.json(
        { error: "No open positions to personalise" },
        { status: 400 },
      );
    }

    const requiredLabels = focus.map((p) => p.label).filter(Boolean);

    const position_lines = focus
      .map((p) => {
        const side = p.dir.toLowerCase() === "short" ? "SHORT" : "LONG";
        const inst = p.instrument || p.label;
        const entry =
          p.tp == null || !Number.isFinite(p.tp) ? "market" : String(p.tp);
        return `${side} ${p.size} ${p.unit} ${inst} (${p.market}), entered at ${entry}`;
      })
      .join("\n");

    const overnightRaw = String(body.overnight_summary ?? "").trim();
    const oneRiskRaw = String(body.one_risk ?? "").trim();
    const overnightDesk = clampContext(
      overnightRaw,
      MAX_OVERNIGHT_SUMMARY_CHARS,
    );
    const oneRiskDesk = clampContext(oneRiskRaw, MAX_ONE_RISK_CHARS);

    const deskContextBlock =
      overnightDesk || oneRiskDesk
        ? `\nMorning brief desk context (facts for alignment; weave in briefly, do not contradict named drivers):\n${overnightDesk ? `- Overnight desk summary: ${overnightDesk}\n` : ""}${oneRiskDesk ? `- Systemic risk line from desk: ${oneRiskDesk}\n` : ""}`
        : "";

    const userPrompt = `${deskContextBlock.trim() ? `${deskContextBlock.trim()}\n\n` : ""}Physical conditions as of this morning:
- Regime: ${regime} | Residual demand: ${residual_demand} GW | Physical premium score: ${normalised_score} (${direction})
- Market price: £${market_price}/MWh | Physically-implied price: £${implied_price}/MWh | Gap: £${gap}/MWh
- SRMC anchor: £${srmc}/MWh | REMIT capacity impact: ${remit_mw} MW active outages

Open positions:
${position_lines}

Write one paragraph explaining what this morning's physical picture means for these specific lines. 
Rules:
- Reference each position by its exact instrument name using third-person observational language ("The long …", "The short …"); never "I", "we", "you", "my", "your", or "our"
- State whether each position is helped or hurt by current conditions and by how much in £/MWh terms where possible
- Identify the single biggest risk to the book today
- End with one specific thing to watch
- Prefer direct statements over vague hedges ("may", "could", "might"); if uncertainty matters, tie it to a named condition or time window
- Do not invent outages, flows, or prices that are not supported by the inputs above
- No meta-commentary ("this paragraph", "below we", "the following"). No filler phrases
- Never use the em dash character (—); use commas, semicolons, colons, or separate sentences instead.

Example of the style and quality required:
"The long 50 MW GB Power Q3 2026 Baseload entered at £89.50 faces £35/MWh of mean reversion risk with the market at £125 against a physically-implied £90; renewable dominance at 18 GW wind is structurally suppressing the price anchor the position needs. Both short gas legs are correctly positioned: the short 25,000 therm NBP Winter 2026 and short 10 MW TTF Q4 2026 benefit from temperature-suppressed demand keeping TTF capped around €50/MWh. The key risk today is a wind ramp-down below 15 GW switching the regime and pulling power back toward SRMC; watch the 14:00-18:00 UTC window where forecast uncertainty is highest."`;

    const systemPrompt =
      "You are a senior GB/NW European power and gas analyst writing one morning observation paragraph for a trading desk. Output exactly one paragraph of 3 to 4 sentences. Each sentence must include at least one concrete number (price £/MWh, MW, GW, therm, EUR/MWh, or percent). Stay anchored to the supplied desk context and physical inputs; do not contradict the overnight summary on named drivers unless reconciling with the updated physical metrics shown. Third-person observational voice only: describe positions and conditions as an analyst would. Never first or second person (no I, we, you, my, your, our). Avoid meta setups and filler ('it is worth noting', 'this analysis', 'moving forward'). Never use the em dash character (—); use commas, semicolons, or colons.";

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
          model: "claude-haiku-4-5-20251001",
          max_tokens: 600,
          temperature: 0.35,
          system: systemPrompt,
          messages: [{ role: "user", content: prompt }],
        }),
      });

      const rawText = await anthropicRes.text();
      if (!anthropicRes.ok) {
        // Log the full error server-side but never expose raw API response to frontend
        console.error(`Anthropic API error ${anthropicRes.status}:`, rawText.slice(0, 500));
        throw new Error("Touchpoints are temporarily unavailable.");
      }
      return extractAnthropicText(rawText);
    }

    function validatePersonalisedText(text: string): boolean {
      if (!text || /^invalid\.?$/i.test(text.trim())) return false;
      if (containsDisallowedVoice(text)) return false;
      if (BANNED_FILLER.test(text)) return false;
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
          `${userPrompt}\n\nRewrite in third-person observational analyst voice. Reference every named instrument from the book above; no I/you/we/my/your/our. Remove filler phrases. Keep numbers in every sentence.`,
        );
      }
      if (!validatePersonalisedText(text)) {
        text = await runAnthropic(
          key,
          `${userPrompt}\n\nFinal pass: name each instrument from the list explicitly and link each to today's drivers and desk context. Third person only; no banned pronouns.`,
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

    const cleaned = text
      .replace(/\[P\d+\]\s*/g, "")
      .replace(/\u2014/g, ", ")
      .replace(/\s*,\s*,/g, ",")
      .replace(/ ,/g, ",")
      .trim();
    if (!cleaned || !validatePersonalisedText(cleaned)) {
      return NextResponse.json(
        { error: "Personalised output omitted one or more open positions" },
        { status: 500 },
      );
    }

    return NextResponse.json({ text: cleaned });
  } catch (e: unknown) {
    await logAuthAuditEvent({
      event: "brief_personalise_failed",
      status: "failure",
      metadata: { reason: e instanceof Error ? e.message : String(e) },
    });
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
