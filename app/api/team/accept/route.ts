import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectiveBillingState } from "@/lib/billing/subscription-state";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const auth = await requireUser(supabase);
    if (auth.response) return auth.response;
    const user = auth.user!;
    const userEmail = String(user.email ?? "").toLowerCase();
    const body = (await req.json().catch(() => ({}))) as { token?: string };
    const token = String(body.token ?? "").trim();
    if (!token) {
      return NextResponse.json({ error: "Invitation token is required" }, { status: 400 });
    }

    const admin = createAdminClient();
    const { data: invitation, error: invitationError } = await admin
      .from("team_invitations")
      .select("id, team_id, invited_email, status, expires_at")
      .eq("token", token)
      .eq("status", "pending")
      .maybeSingle();
    if (invitationError) throw new Error(invitationError.message);
    if (!invitation) {
      return NextResponse.json({ code: "INVITE_NOT_FOUND", error: "Invitation not found." }, { status: 404 });
    }
    if (String(invitation.invited_email).toLowerCase() !== userEmail) {
      return NextResponse.json(
        { code: "INVITE_EMAIL_MISMATCH", error: "Invitation email does not match this account." },
        { status: 403 },
      );
    }
    if (new Date(invitation.expires_at).getTime() < Date.now()) {
      return NextResponse.json(
        { code: "INVITE_EXPIRED", error: "Invitation has expired." },
        { status: 410 },
      );
    }

    const { data: team, error: teamError } = await admin
      .from("teams")
      .select("id, owner_id")
      .eq("id", invitation.team_id)
      .maybeSingle();
    if (teamError) throw new Error(teamError.message);
    if (!team) {
      return NextResponse.json({ code: "TEAM_NOT_FOUND", error: "Team no longer exists." }, { status: 404 });
    }

    const ownerBilling = await getEffectiveBillingState(admin, team.owner_id, {
      skipTeamInheritance: true,
    });
    const seatLimit = ownerBilling.entitlements.seats;
    const { count: activeMembers, error: membersError } = await admin
      .from("team_members")
      .select("id", { count: "exact", head: true })
      .eq("team_id", team.id)
      .eq("status", "active");
    if (membersError) throw new Error(membersError.message);
    if (typeof seatLimit === "number" && (activeMembers ?? 0) >= seatLimit) {
      return NextResponse.json(
        {
          code: "SEAT_LIMIT_REACHED",
          error: "Team seat limit reached.",
          seatLimit,
          usedSeats: activeMembers ?? 0,
        },
        { status: 409 },
      );
    }

    const { error: memberUpsertError } = await admin.from("team_members").upsert(
      {
        team_id: team.id,
        user_id: user.id,
        role: "member",
        status: "active",
      },
      { onConflict: "team_id,user_id" },
    );
    if (memberUpsertError) throw new Error(memberUpsertError.message);

    const { error: invitationUpdateError } = await admin
      .from("team_invitations")
      .update({
        status: "accepted",
        accepted_by: user.id,
        accepted_at: new Date().toISOString(),
      })
      .eq("id", invitation.id);
    if (invitationUpdateError) throw new Error(invitationUpdateError.message);

    return NextResponse.json({ accepted: true, teamId: team.id });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to accept invitation" },
      { status: 500 },
    );
  }
}
