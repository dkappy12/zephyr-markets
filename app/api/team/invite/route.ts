import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/require-user";
import { requireEntitlement } from "@/lib/auth/require-entitlement";
import { assertSameOrigin } from "@/lib/auth/request-security";
import { getEffectiveBillingState } from "@/lib/billing/subscription-state";
import { sendTeamInviteEmail } from "@/lib/email/team-invite";
import { buildTeamInviteUrl } from "@/lib/team/invite-url";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

function normaliseEmail(value: string): string {
  return value.trim().toLowerCase();
}

function isPendingInviteUniqueError(message: string): boolean {
  return message.includes("team_invitations_team_pending_email_uniq");
}

export async function POST(req: Request) {
  try {
    const csrf = assertSameOrigin(req);
    if (csrf) return csrf;

    const supabase = await createClient();
    const auth = await requireUser(supabase);
    if (auth.response) return auth.response;
    const user = auth.user!;
    const entitlement = await requireEntitlement(supabase, user.id, {
      minimumTier: "team",
    });
    if (entitlement.response) return entitlement.response;

    const body = (await req.json().catch(() => ({}))) as { email?: string };
    const invitedEmail = normaliseEmail(String(body.email ?? ""));
    if (!invitedEmail || !invitedEmail.includes("@")) {
      return NextResponse.json({ error: "Valid invite email is required" }, { status: 400 });
    }

    const admin = createAdminClient();
    const { data: team, error: teamError } = await admin
      .from("teams")
      .select("id, owner_id, name")
      .eq("owner_id", user.id)
      .maybeSingle();
    if (teamError) throw new Error(teamError.message);
    if (!team) {
      return NextResponse.json(
        { code: "TEAM_NOT_FOUND", error: "Create a team before inviting members." },
        { status: 400 },
      );
    }

    const billingState = await getEffectiveBillingState(supabase, user.id, {
      skipTeamInheritance: true,
    });
    const seatLimit = billingState.entitlements.seats;
    const { count: activeMembers, error: membersError } = await admin
      .from("team_members")
      .select("id", { count: "exact", head: true })
      .eq("team_id", team.id)
      .eq("status", "active");
    if (membersError) throw new Error(membersError.message);
    const { count: pendingInvites, error: invitesError } = await admin
      .from("team_invitations")
      .select("id", { count: "exact", head: true })
      .eq("team_id", team.id)
      .eq("status", "pending");
    if (invitesError) throw new Error(invitesError.message);

    const usedSeats = (activeMembers ?? 0) + (pendingInvites ?? 0);
    if (typeof seatLimit === "number" && usedSeats >= seatLimit) {
      return NextResponse.json(
        {
          code: "SEAT_LIMIT_REACHED",
          error: `Seat limit reached for ${billingState.effectiveTier} plan.`,
          seatLimit,
          usedSeats,
        },
        { status: 409 },
      );
    }

    const existingPendingRes = await admin
      .from("team_invitations")
      .select("id, team_id, invited_email, status, token, expires_at, created_at")
      .eq("team_id", team.id)
      .eq("invited_email", invitedEmail)
      .eq("status", "pending")
      .maybeSingle();
    if (existingPendingRes.error) throw new Error(existingPendingRes.error.message);

    const alreadyPending = !!existingPendingRes.data;
    let invitation = existingPendingRes.data;
    let usedSeatsAfterInvite = usedSeats;

    if (!invitation) {
      const token = randomUUID();
      const insertRes = await admin
      .from("team_invitations")
      .insert({
        team_id: team.id,
        invited_email: invitedEmail,
        invited_by: user.id,
        token,
        status: "pending",
      })
      .select("id, team_id, invited_email, status, token, expires_at, created_at")
      .single();
      if (insertRes.error) {
        if (isPendingInviteUniqueError(insertRes.error.message ?? "")) {
          const retry = await admin
            .from("team_invitations")
            .select("id, team_id, invited_email, status, token, expires_at, created_at")
            .eq("team_id", team.id)
            .eq("invited_email", invitedEmail)
            .eq("status", "pending")
            .maybeSingle();
          if (retry.error) throw new Error(retry.error.message);
          if (!retry.data) {
            throw new Error("Could not load existing invitation.");
          }
          invitation = retry.data;
        } else {
          throw new Error(insertRes.error.message);
        }
      } else {
        invitation = insertRes.data;
        usedSeatsAfterInvite = usedSeats + 1;
      }
    }

    if (!invitation?.token) {
      throw new Error("Invitation token missing.");
    }

    const inviteUrl = buildTeamInviteUrl(invitation.token, req);
    const emailResult = await sendTeamInviteEmail({
      to: invitedEmail,
      inviteUrl,
      teamName: String(team.name ?? "Team"),
    });

    return NextResponse.json({
      invitation,
      seatLimit,
      usedSeats: usedSeatsAfterInvite,
      inviteAlreadyPending: alreadyPending,
      inviteEmailSent: emailResult.sent,
      inviteEmailSkipped: emailResult.skipped === true,
      ...(emailResult.error
        ? { inviteEmailError: emailResult.error }
        : {}),
    });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to create invitation" },
      { status: 500 },
    );
  }
}
