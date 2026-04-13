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
    const positionLines = positions
      .map((p) => {
        const dir = String(p.direction ?? "long");
        const size = asNum(p.size) ?? 0;
        const unit = String(p.unit ?? "");
        const instrument = String(p.instrument ?? "position");
        const market = String(p.market ?? "unknown");
        const tp = asNum(p.trade_price);
        return `- ${dir} ${size} ${unit} ${instrument} (${market}), entry ${tp == null ? "unknown" : tp}`;
      })
      .join("\n");

    const userPrompt = `Today's physical conditions:
- Physical premium score: ${score} (${direction})
- Overnight summary: ${overnight}
- One risk: ${oneRisk}

The trader's open positions:
${positionLines}

In 2-3 sentences, explain specifically how today's physical conditions affect this trader's book. Reference their actual positions by name. Be direct about whether conditions are favourable or unfavourable for each position and why. No generic language.`;

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
          "You are Zephyr's market intelligence engine. You write concise, direct analysis for professional energy traders. One paragraph maximum. No padding. Active voice. Specific numbers only.",
        messages: [{ role: "user", content: userPrompt }],
      }),
    });

    const rawText = await anthropicRes.text();
    if (!anthropicRes.ok) {
      return NextResponse.json(
        {
          error: `Anthropic error: ${anthropicRes.status} ${rawText.slice(0, 300)}`,
        },
        { status: 500 },
      );
    }

    const parsed = JSON.parse(rawText) as {
      content?: Array<{ type?: string; text?: string }>;
    };
    const text = (parsed.content ?? [])
      .filter((c) => c?.type === "text" && typeof c.text === "string")
      .map((c) => c.text ?? "")
      .join("\n")
      .trim();

    if (!text) {
      return NextResponse.json(
        { error: "Anthropic returned empty response" },
        { status: 500 },
      );
    }

    return NextResponse.json({ text });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

