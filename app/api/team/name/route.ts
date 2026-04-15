import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/require-user";
import { requireEntitlement } from "@/lib/auth/require-entitlement";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function PATCH(req: Request) {
  try {
    const supabase = await createClient();
    const auth = await requireUser(supabase);
    if (auth.response) return auth.response;
    const user = auth.user!;

    const entitlement = await requireEntitlement(supabase, user.id, {
      minimumTier: "team",
    });
    if (entitlement.response) return entitlement.response;

    const body = (await req.json().catch(() => ({}))) as { name?: string };
    const name = String(body.name ?? "").trim();
    if (!name) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    const admin = createAdminClient();
    const { data: team, error: findError } = await admin
      .from("teams")
      .select("id, name")
      .eq("owner_id", user.id)
      .maybeSingle();
    if (findError) throw new Error(findError.message);
    if (!team) {
      return NextResponse.json({ error: "No team found" }, { status: 404 });
    }

    const { data: updated, error: updateError } = await admin
      .from("teams")
      .update({ name })
      .eq("id", team.id)
      .select("id, name")
      .single();
    if (updateError || !updated) {
      throw new Error(updateError?.message ?? "Could not update team name");
    }

    return NextResponse.json({ team: updated });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Could not update team name" },
      { status: 500 },
    );
  }
}
