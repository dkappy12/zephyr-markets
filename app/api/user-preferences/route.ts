import { NextResponse } from "next/server";
import { assertSameOrigin } from "@/lib/auth/request-security";
import { requireUser } from "@/lib/auth/require-user";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const DEFAULT_MARKET_VISIBILITY = {
  gb_power: true,
  nbp: true,
  ttf: true,
  uka: true,
  eua: true,
} as const;

type MarketVisibility = Record<string, boolean>;

function defaultPreferences() {
  return {
    market_visibility: { ...DEFAULT_MARKET_VISIBILITY },
    remit_min_mw: null as number | null,
    remit_unplanned_only: false,
  };
}

function mergeMarketVisibility(raw: unknown): MarketVisibility {
  const base = { ...DEFAULT_MARKET_VISIBILITY } as Record<string, boolean>;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const k of Object.keys(DEFAULT_MARKET_VISIBILITY)) {
      const v = (raw as Record<string, unknown>)[k];
      if (typeof v === "boolean") base[k] = v;
    }
  }
  base.gb_power = true;
  return base;
}

export async function GET(req: Request) {
  try {
    const csrf = assertSameOrigin(req);
    if (csrf) return csrf;

    const supabase = await createClient();
    const auth = await requireUser(supabase);
    if (auth.response) return auth.response;

    const { data, error } = await supabase
      .from("user_preferences")
      .select("market_visibility, remit_min_mw, remit_unplanned_only")
      .eq("user_id", auth.user!.id)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!data) {
      return NextResponse.json(defaultPreferences());
    }

    const row = data as {
      market_visibility?: unknown;
      remit_min_mw?: unknown;
      remit_unplanned_only?: unknown;
    };

    let remit_min_mw: number | null = null;
    if (row.remit_min_mw != null) {
      const n = Number(row.remit_min_mw);
      remit_min_mw = Number.isFinite(n) && n >= 0 ? n : null;
    }

    return NextResponse.json({
      market_visibility: mergeMarketVisibility(row.market_visibility),
      remit_min_mw,
      remit_unplanned_only: Boolean(row.remit_unplanned_only),
    });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load preferences" },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  try {
    const csrf = assertSameOrigin(req);
    if (csrf) return csrf;

    const supabase = await createClient();
    const auth = await requireUser(supabase);
    if (auth.response) return auth.response;
    const user = auth.user!;

    const body = (await req.json().catch(() => ({}))) as {
      market_visibility?: unknown;
      remit_min_mw?: unknown;
      remit_unplanned_only?: unknown;
    };

    const { data: existing, error: readErr } = await supabase
      .from("user_preferences")
      .select("market_visibility, remit_min_mw, remit_unplanned_only")
      .eq("user_id", user.id)
      .maybeSingle();

    if (readErr) {
      return NextResponse.json({ error: readErr.message }, { status: 500 });
    }

    const cur = existing as {
      market_visibility?: unknown;
      remit_min_mw?: unknown;
      remit_unplanned_only?: unknown;
    } | null;

    let market_visibility = mergeMarketVisibility(cur?.market_visibility);
    if (body.market_visibility !== undefined) {
      market_visibility = mergeMarketVisibility({
        ...market_visibility,
        ...(typeof body.market_visibility === "object" &&
        body.market_visibility !== null &&
        !Array.isArray(body.market_visibility)
          ? (body.market_visibility as Record<string, unknown>)
          : {}),
      });
    }

    let remit_min_mw: number | null =
      cur?.remit_min_mw != null && Number.isFinite(Number(cur.remit_min_mw))
        ? Number(cur.remit_min_mw)
        : null;
    if (body.remit_min_mw !== undefined) {
      if (body.remit_min_mw === null || body.remit_min_mw === "") {
        remit_min_mw = null;
      } else {
        const n = Number(body.remit_min_mw);
        if (!Number.isFinite(n) || n < 0) {
          return NextResponse.json(
            { error: "remit_min_mw must be a non-negative number or null" },
            { status: 400 },
          );
        }
        remit_min_mw = n;
      }
    }

    let remit_unplanned_only = Boolean(cur?.remit_unplanned_only);
    if (body.remit_unplanned_only !== undefined) {
      remit_unplanned_only = Boolean(body.remit_unplanned_only);
    }

    const payload = {
      user_id: user.id,
      market_visibility,
      remit_min_mw,
      remit_unplanned_only,
      updated_at: new Date().toISOString(),
    };

    const { data: saved, error: upsertErr } = await supabase
      .from("user_preferences")
      .upsert(payload, { onConflict: "user_id" })
      .select("market_visibility, remit_min_mw, remit_unplanned_only")
      .single();

    if (upsertErr) {
      return NextResponse.json({ error: upsertErr.message }, { status: 500 });
    }

    const s = saved as {
      market_visibility?: unknown;
      remit_min_mw?: unknown;
      remit_unplanned_only?: unknown;
    };

    return NextResponse.json({
      market_visibility: mergeMarketVisibility(s.market_visibility),
      remit_min_mw:
        s.remit_min_mw != null && Number.isFinite(Number(s.remit_min_mw))
          ? Number(s.remit_min_mw)
          : null,
      remit_unplanned_only: Boolean(s.remit_unplanned_only),
    });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to save preferences" },
      { status: 500 },
    );
  }
}
