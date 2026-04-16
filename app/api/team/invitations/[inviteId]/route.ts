import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/require-user";
import { requireEntitlement } from "@/lib/auth/require-entitlement";
import { assertSameOrigin } from "@/lib/auth/request-security";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type Ctx = { params: Promise<{ inviteId: string }> };

export async function DELETE(req: Request, ctx: Ctx) {
  try {
    const csrf = assertSameOrigin(req);
    if (csrf) return csrf;

    const { inviteId } = await ctx.params;
    if (!inviteId?.trim()) {
      return NextResponse.json(
        { code: "INVALID_ID", error: "Invitation id is required." },
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
        { code: "TEAM_NOT_FOUND", error: "Create a team before managing invites." },
        { status: 400 },
      );
    }

    const { data: invite, error: inviteError } = await admin
      .from("team_invitations")
      .select("id, team_id, status")
      .eq("id", inviteId)
      .maybeSingle();
    if (inviteError) throw new Error(inviteError.message);
    if (!invite || invite.team_id !== team.id) {
      return NextResponse.json(
        { code: "INVITE_NOT_FOUND", error: "Invitation not found." },
        { status: 404 },
      );
    }

    if (invite.status !== "pending") {
      return NextResponse.json(
        {
          code: "INVITE_NOT_PENDING",
          error: "Only pending invitations can be cancelled.",
        },
        { status: 409 },
      );
    }

    const { error: deleteError } = await admin
      .from("team_invitations")
      .delete()
      .eq("id", invite.id);
    if (deleteError) throw new Error(deleteError.message);

    return NextResponse.json({ cancelled: true });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to cancel invitation" },
      { status: 500 },
    );
  }
}
