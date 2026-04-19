import { NextResponse } from "next/server";
import { assertSameOrigin } from "@/lib/auth/request-security";
import { requireUser } from "@/lib/auth/require-user";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const PREMIUM_SCORE_MIN = 0.5;
const PREMIUM_SCORE_MAX = 10;

function roundHalfStep(n: number): number {
  return Math.round(n * 2) / 2;
}

export async function GET() {
  try {
    const supabase = await createClient();
    const auth = await requireUser(supabase);
    if (auth.response) return auth.response;
    const user = auth.user!;

    const { data, error } = await supabase
      .from("alerts")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ alerts: data ?? [] });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load alerts" },
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
      threshold_type?: unknown;
      threshold_value?: unknown;
      delivery_channel?: unknown;
    };

    const threshold_type = String(body.threshold_type ?? "").trim();
    const delivery_channel = String(body.delivery_channel ?? "").trim();

    if (!threshold_type || !delivery_channel) {
      return NextResponse.json(
        { error: "threshold_type and delivery_channel are required" },
        { status: 400 },
      );
    }

    const raw = body.threshold_value;
    let threshold_value: number;
    if (typeof raw === "number" && Number.isFinite(raw)) {
      threshold_value = raw;
    } else if (typeof raw === "string" && raw.trim() !== "") {
      threshold_value = Number(raw);
    } else {
      return NextResponse.json(
        { error: "threshold_value must be a number" },
        { status: 400 },
      );
    }

    if (!Number.isFinite(threshold_value)) {
      return NextResponse.json(
        { error: "threshold_value must be a finite number" },
        { status: 400 },
      );
    }

    if (threshold_type === "premium_score") {
      const v = roundHalfStep(threshold_value);
      if (v < PREMIUM_SCORE_MIN || v > PREMIUM_SCORE_MAX) {
        return NextResponse.json(
          {
            error: `threshold_value must be between ${PREMIUM_SCORE_MIN} and ${PREMIUM_SCORE_MAX}`,
          },
          { status: 400 },
        );
      }
      threshold_value = v;
    }

    const { data, error } = await supabase
      .from("alerts")
      .upsert(
        {
          user_id: user.id,
          threshold_type,
          threshold_value,
          delivery_channel,
        },
        { onConflict: "user_id,threshold_type" },
      )
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ alert: data });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to save alert" },
      { status: 500 },
    );
  }
}

export async function DELETE(req: Request) {
  try {
    const csrf = assertSameOrigin(req);
    if (csrf) return csrf;

    const supabase = await createClient();
    const auth = await requireUser(supabase);
    if (auth.response) return auth.response;
    const user = auth.user!;

    const body = (await req.json().catch(() => ({}))) as {
      threshold_type?: unknown;
    };
    const threshold_type = String(body.threshold_type ?? "").trim();
    if (!threshold_type) {
      return NextResponse.json(
        { error: "threshold_type is required" },
        { status: 400 },
      );
    }

    const { error } = await supabase
      .from("alerts")
      .delete()
      .eq("user_id", user.id)
      .eq("threshold_type", threshold_type);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to delete alert" },
      { status: 500 },
    );
  }
}
