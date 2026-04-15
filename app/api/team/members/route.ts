import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/require-user";
import { requireEntitlement } from "@/lib/auth/require-entitlement";
import { getEffectiveBillingState } from "@/lib/billing/subscription-state";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  try {
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
      .select("id, name, owner_id, created_at")
      .eq("owner_id", user.id)
      .maybeSingle();
    if (teamError) throw new Error(teamError.message);
    if (!team) {
      return NextResponse.json({ team: null, members: [], invitations: [] });
    }

    const [membersRes, invitationsRes, billingState] = await Promise.all([
      admin
        .from("team_members")
        .select("id, user_id, role, status, created_at")
        .eq("team_id", team.id)
        .order("created_at", { ascending: true }),
      admin
        .from("team_invitations")
        .select("id, invited_email, status, expires_at, created_at, token")
        .eq("team_id", team.id)
        .eq("status", "pending")
        .order("created_at", { ascending: false }),
      getEffectiveBillingState(supabase, user.id),
    ]);

    if (membersRes.error) throw new Error(membersRes.error.message);
    if (invitationsRes.error) throw new Error(invitationsRes.error.message);

    const seats = billingState.entitlements.seats;
    return NextResponse.json({
      team,
      members: membersRes.data ?? [],
      invitations: invitationsRes.data ?? [],
      seatLimit: seats,
      usedSeats: (membersRes.data ?? []).length + (invitationsRes.data ?? []).length,
    });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load team members" },
      { status: 500 },
    );
  }
}
