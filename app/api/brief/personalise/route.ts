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

    async function runAnthropic(prompt: string): Promise<string> {
      const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": key,
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

    let text = "";
    try {
      text = await runAnthropic(userPrompt);
      if (!validatePersonalisedText(text)) {
        text = await runAnthropic(
          `${userPrompt}\n\nYour previous answer was not specific enough. Rewrite and include every required token and label explicitly.`,
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
        {
          error:
            "Personalised text did not reference the user's actual open positions",
        },
        { status: 500 },
      );
    }

    const cleaned = text.replace(/\[P\d+\]\s*/g, "").trim();
    if (!cleaned) {
      return NextResponse.json(
        { error: "Personalised text was empty after formatting" },
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

