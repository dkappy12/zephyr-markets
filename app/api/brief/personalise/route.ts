import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

type PersonaliseReq = {
  overnight_summary?: string;
  one_risk?: string;
  normalised_score?: number;
  direction?: string;
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

type FocusPosition = {
  dir: string;
  size: number;
  unit: string;
  label: string;
  market: string;
  tp: number | null;
};

function formatSize(size: number, unit: string): string {
  const u = unit.toLowerCase();
  const abs = Number.isFinite(size) ? Math.abs(size) : 0;
  if (u === "therm" && abs >= 1000) {
    return `${abs.toLocaleString("en-GB")} therm`;
  }
  return `${abs} ${unit}`.trim();
}

/** Guaranteed book-specific copy derived only from platform position rows (no generic long/short templates). */
function buildDeterministicBookTouchpoints(
  focus: FocusPosition[],
  score: number,
  direction: string,
): string {
  const scoreLabel = Number.isFinite(score) ? score.toFixed(1) : String(score);
  const intro = `Physical premium ${scoreLabel} (${direction}). Your open lines:`;
  const parts = focus.map((p) => {
    const sz = formatSize(p.size, p.unit);
    const px =
      p.tp == null || !Number.isFinite(p.tp)
        ? "trade unknown"
        : `trade ${p.tp}`;
    return `${p.label}: ${p.dir} ${sz} (${p.market}), ${px}`;
  });
  return `${intro} ${parts.join(" · ")}`;
}

function labelsPresentInText(text: string, labels: string[]): boolean {
  if (labels.length === 0) return false;
  const lower = text.toLowerCase();
  return labels.every((l) => l.length > 0 && lower.includes(l.toLowerCase()));
}

export async function POST(req: Request) {
  try {
    const key = process.env.ANTHROPIC_API_KEY;

    const supabase = await createClient();

    const authHeader = req.headers.get("authorization");
    const bearer =
      authHeader && authHeader.toLowerCase().startsWith("bearer ")
        ? authHeader.slice(7).trim()
        : null;

    const fromCookies = await supabase.auth.getUser();
    let user = fromCookies.data.user;
    if (!user && bearer) {
      const fromJwt = await supabase.auth.getUser(bearer);
      user = fromJwt.data.user ?? null;
    }
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await req.json()) as PersonaliseReq;
    const overnight = String(body.overnight_summary ?? "").slice(0, 200);
    const oneRisk = String(body.one_risk ?? "").slice(0, 150);
    const score = asNum(body.normalised_score) ?? 0;
    const direction = String(body.direction ?? "STABLE");
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

    const focusPositions = [...normalizedPositions]
      .sort((a, b) => Math.abs(b.size) - Math.abs(a.size))
      .slice(0, 4);

    if (focusPositions.length === 0) {
      return NextResponse.json(
        { error: "No open positions to personalise" },
        { status: 400 },
      );
    }

    const deterministic = buildDeterministicBookTouchpoints(
      focusPositions,
      score,
      direction,
    );

    const requiredTokens = focusPositions.map((_, idx) => `[P${idx + 1}]`);
    const requiredLabels = focusPositions.map((p) => p.label).filter(Boolean);
    const positionLines = focusPositions
      .map((p, idx) => {
        const token = `[P${idx + 1}]`;
        return `${token} ${p.dir} ${p.size} ${p.unit} ${p.label} (${p.market}), entry ${p.tp == null ? "unknown" : p.tp}`;
      })
      .join("\n");

    const userPrompt = `Today's physical conditions:
- Physical premium score: ${score} (${direction})
- Overnight summary: ${overnight}
- One risk: ${oneRisk}

The trader's open positions (actual book):
${positionLines}

Write 2-3 sentences about these positions only.
Requirements:
1) Mention each token exactly once or more: ${requiredTokens.join(", ")}
2) Tie each token to whether today's physical setup helps or hurts that specific line.
3) No abstract commentary without token references.
4) Keep one paragraph and concrete numbers only.`;

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
          max_tokens: 300,
          system:
            "You are Zephyr's market intelligence engine. You write concise, direct analysis for professional energy traders. One paragraph maximum. No padding. Active voice. Specific numbers only. Every sentence must refer to the trader's listed positions.",
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
      const lower = text.toLowerCase();
      const hasAllTokens = requiredTokens.every((t) =>
        lower.includes(t.toLowerCase()),
      );
      const hasAllLabels = requiredLabels.every((l) =>
        lower.includes(l.toLowerCase()),
      );
      return hasAllTokens && hasAllLabels;
    }

    if (!key) {
      return NextResponse.json({ text: deterministic });
    }

    let text = "";
    try {
      text = await runAnthropic(key, userPrompt);
      if (!validatePersonalisedText(text)) {
        text = await runAnthropic(
          key,
          `${userPrompt}\n\nYour previous answer was not specific enough. Rewrite and include every required token and label explicitly.`,
        );
      }
    } catch {
      return NextResponse.json({ text: deterministic });
    }

    if (!validatePersonalisedText(text)) {
      return NextResponse.json({ text: deterministic });
    }

    const cleaned = text.replace(/\[P\d+\]\s*/g, "").trim();
    if (!cleaned || !labelsPresentInText(cleaned, requiredLabels)) {
      return NextResponse.json({ text: deterministic });
    }

    const genericLongShort =
      /\b(long|short)\s+gb\s+power\s+positions?\b/i.test(cleaned) ||
      /\bshort\s+gas\s+positions?\b/i.test(cleaned);
    if (genericLongShort) {
      return NextResponse.json({ text: deterministic });
    }

    return NextResponse.json({ text: cleaned });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

