import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/require-user";
import { assertSameOrigin } from "@/lib/auth/request-security";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export async function POST(req: Request) {
  try {
    const csrf = assertSameOrigin(req);
    if (csrf) return csrf;

    const supabase = await createClient();
    const auth = await requireUser(supabase);
    if (auth.response) return auth.response;
    const user = auth.user!;

    const admin = createAdminClient();
    const { data: membership, error: memErr } = await admin
      .from("team_members")
      .select("team_id, role")
      .eq("user_id", user.id)
      .eq("status", "active")
      .maybeSingle();
    if (memErr) throw new Error(memErr.message);
    if (!membership) {
      return NextResponse.json(
        { code: "NOT_A_MEMBER", error: "You are not on a team." },
        { status: 400 },
      );
    }

    const { data: team, error: teamErr } = await admin
      .from("teams")
      .select("owner_id")
      .eq("id", membership.team_id)
      .maybeSingle();
    if (teamErr) throw new Error(teamErr.message);
    if (!team) {
      return NextResponse.json(
        { code: "TEAM_NOT_FOUND", error: "Team no longer exists." },
        { status: 404 },
      );
    }

    if (team.owner_id === user.id) {
      return NextResponse.json(
        {
          code: "OWNER_CANNOT_LEAVE",
          error:
            "Team owners cannot leave through this action. Transfer ownership or delete the team from your provider workflow.",
        },
        { status: 403 },
      );
    }

    const { error: delErr } = await admin
      .from("team_members")
      .delete()
      .eq("team_id", membership.team_id)
      .eq("user_id", user.id);
    if (delErr) throw new Error(delErr.message);

    return NextResponse.json({ left: true });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Could not leave team" },
      { status: 500 },
    );
  }
}
