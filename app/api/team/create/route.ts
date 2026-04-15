import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/require-user";
import { requireEntitlement } from "@/lib/auth/require-entitlement";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { defaultTeamNameFromUser } from "@/lib/team/default-team-name";

export async function POST(req: Request) {
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
    const trimmed = String(body.name ?? "").trim();
    const name = trimmed || defaultTeamNameFromUser(user);
    const admin = createAdminClient();

    const { data: existing, error: existingError } = await admin
      .from("teams")
      .select("id, name")
      .eq("owner_id", user.id)
      .maybeSingle();
    if (existingError) {
      throw new Error(existingError.message);
    }
    if (existing) {
      return NextResponse.json({ team: existing, created: false });
    }

    const { data: team, error: teamError } = await admin
      .from("teams")
      .insert({ owner_id: user.id, name })
      .select("id, name")
      .single();
    if (teamError || !team) {
      throw new Error(teamError?.message ?? "Could not create team");
    }

    const { error: memberError } = await admin.from("team_members").insert({
      team_id: team.id,
      user_id: user.id,
      role: "owner",
      status: "active",
    });
    if (memberError) {
      throw new Error(memberError.message);
    }

    return NextResponse.json({ team, created: true });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Team creation failed" },
      { status: 500 },
    );
  }
}
