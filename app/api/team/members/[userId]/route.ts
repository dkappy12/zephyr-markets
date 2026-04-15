import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/require-user";
import { requireEntitlement } from "@/lib/auth/require-entitlement";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type Ctx = { params: Promise<{ userId: string }> };

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const { userId: targetUserId } = await ctx.params;
    if (!targetUserId?.trim()) {
      return NextResponse.json(
        { code: "INVALID_ID", error: "Member id is required." },
        { status: 400 },
      );
    }

    const supabase = await createClient();
    const auth = await requireUser(supabase);
    if (auth.response) return auth.response;
    const user = auth.user!;
    const entitlement = await requireEntitlement(supabase, user.id, {
      minimumTier: "team",
    });
    if (entitlement.response) return entitlement.response;

    const admin = createAdminClient();
    const { data: team, error: teamError } = await admin
      .from("teams")
      .select("id, owner_id")
      .eq("owner_id", user.id)
      .maybeSingle();
    if (teamError) throw new Error(teamError.message);
    if (!team) {
      return NextResponse.json(
        { code: "TEAM_NOT_FOUND", error: "Create a team before managing members." },
        { status: 400 },
      );
    }

    if (targetUserId === team.owner_id) {
      return NextResponse.json(
        {
          code: "CANNOT_REMOVE_OWNER",
          error: "You cannot remove the team owner from the team.",
        },
        { status: 403 },
      );
    }

    const { data: memberRow, error: memberLookupError } = await admin
      .from("team_members")
      .select("id, role")
      .eq("team_id", team.id)
      .eq("user_id", targetUserId)
      .maybeSingle();
    if (memberLookupError) throw new Error(memberLookupError.message);
    if (!memberRow) {
      return NextResponse.json(
        { code: "MEMBER_NOT_FOUND", error: "That user is not on this team." },
        { status: 404 },
      );
    }

    if (memberRow.role === "owner") {
      return NextResponse.json(
        {
          code: "CANNOT_REMOVE_OWNER",
          error: "You cannot remove the team owner from the team.",
        },
        { status: 403 },
      );
    }

    const { error: deleteError } = await admin
      .from("team_members")
      .delete()
      .eq("team_id", team.id)
      .eq("user_id", targetUserId);
    if (deleteError) throw new Error(deleteError.message);

    return NextResponse.json({ removed: true });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to remove team member" },
      { status: 500 },
    );
  }
}
