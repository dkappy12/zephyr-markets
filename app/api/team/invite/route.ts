import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/require-user";
import { requireEntitlement } from "@/lib/auth/require-entitlement";
import { getEffectiveBillingState } from "@/lib/billing/subscription-state";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

function normaliseEmail(value: string): string {
  return value.trim().toLowerCase();
}

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

    const body = (await req.json().catch(() => ({}))) as { email?: string };
    const invitedEmail = normaliseEmail(String(body.email ?? ""));
    if (!invitedEmail || !invitedEmail.includes("@")) {
      return NextResponse.json({ error: "Valid invite email is required" }, { status: 400 });
    }

    const admin = createAdminClient();
    const { data: team, error: teamError } = await admin
      .from("teams")
      .select("id, owner_id")
      .eq("owner_id", user.id)
      .maybeSingle();
    if (teamError) throw new Error(teamError.message);
    if (!team) {
      return NextResponse.json(
        { code: "TEAM_NOT_FOUND", error: "Create a team before inviting members." },
        { status: 400 },
      );
    }

    const billingState = await getEffectiveBillingState(supabase, user.id);
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

    const token = randomUUID();
    const { data: invitation, error: invitationError } = await admin
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
    if (invitationError) throw new Error(invitationError.message);

    return NextResponse.json({
      invitation,
      seatLimit,
      usedSeats: usedSeats + 1,
    });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to create invitation" },
      { status: 500 },
    );
  }
}
