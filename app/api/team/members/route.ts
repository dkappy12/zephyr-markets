import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/require-user";
import { requireEntitlement } from "@/lib/auth/require-entitlement";
import { getEffectiveBillingState } from "@/lib/billing/subscription-state";
import { buildTeamInviteUrl } from "@/lib/team/invite-url";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export async function GET(req: Request) {
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

    const { data: ownedTeam, error: ownedErr } = await admin
      .from("teams")
      .select("id, name, owner_id, created_at")
      .eq("owner_id", user.id)
      .maybeSingle();
    if (ownedErr) throw new Error(ownedErr.message);

    let team = ownedTeam;
    let isOwner = !!ownedTeam;
    let viewerRole: "owner" | "member" = ownedTeam ? "owner" : "member";

    if (!team) {
      const { data: membership, error: memErr } = await admin
        .from("team_members")
        .select("team_id, role")
        .eq("user_id", user.id)
        .eq("status", "active")
        .maybeSingle();
      if (memErr) throw new Error(memErr.message);
      if (!membership) {
        return NextResponse.json({
          team: null,
          members: [],
          invitations: [],
          isOwner: false,
          viewerRole: null,
        });
      }
      const { data: joinedTeam, error: jErr } = await admin
        .from("teams")
        .select("id, name, owner_id, created_at")
        .eq("id", membership.team_id)
        .maybeSingle();
      if (jErr) throw new Error(jErr.message);
      if (!joinedTeam) {
        return NextResponse.json({
          team: null,
          members: [],
          invitations: [],
          isOwner: false,
          viewerRole: null,
        });
      }
      team = joinedTeam;
      isOwner = joinedTeam.owner_id === user.id;
      viewerRole = membership.role === "owner" ? "owner" : "member";
    }

    const canSeeInvites = isOwner;

    const [membersRes, invitationsRes, pendingCountRes, billingState] =
      await Promise.all([
        admin
          .from("team_members")
          .select("id, user_id, role, status, created_at")
          .eq("team_id", team.id)
          .order("created_at", { ascending: true }),
        canSeeInvites
          ? admin
              .from("team_invitations")
              .select("id, invited_email, status, expires_at, created_at, token")
              .eq("team_id", team.id)
              .eq("status", "pending")
              .order("created_at", { ascending: false })
          : Promise.resolve({ data: [], error: null }),
        admin
          .from("team_invitations")
          .select("id", { count: "exact", head: true })
          .eq("team_id", team.id)
          .eq("status", "pending"),
        getEffectiveBillingState(admin, team.owner_id, {
          skipTeamInheritance: true,
        }),
      ]);

    if (membersRes.error) throw new Error(membersRes.error.message);
    if (invitationsRes.error) throw new Error(invitationsRes.error.message);
    if (pendingCountRes.error) throw new Error(pendingCountRes.error.message);

    const rawMembers = membersRes.data ?? [];
    const userIds = [...new Set(rawMembers.map((m) => m.user_id))];
    const displayByUserId = new Map<string, string>();

    await Promise.all(
      userIds.map(async (uid) => {
        try {
          const { data, error } = await admin.auth.admin.getUserById(uid);
          if (error || !data.user) {
            displayByUserId.set(uid, `${uid.slice(0, 8)}…`);
            return;
          }
          const full = String(data.user.user_metadata?.full_name ?? "").trim();
          const email = data.user.email?.trim() ?? "";
          displayByUserId.set(uid, full || email || `${uid.slice(0, 8)}…`);
        } catch {
          displayByUserId.set(uid, `${uid.slice(0, 8)}…`);
        }
      }),
    );

    const members = rawMembers.map((m) => ({
      ...m,
      display_name: displayByUserId.get(m.user_id) ?? `${m.user_id.slice(0, 8)}…`,
    }));

    const seats = billingState.entitlements.seats;
    const invitations = canSeeInvites
      ? (invitationsRes.data ?? []).map((inv) => ({
          ...inv,
          invite_url: inv.token ? buildTeamInviteUrl(inv.token, req) : null,
        }))
      : [];
    const pendingInvites = pendingCountRes.count ?? 0;

    return NextResponse.json({
      team,
      members,
      invitations,
      seatLimit: seats,
      usedSeats: members.length + pendingInvites,
      isOwner,
      viewerRole,
    });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load team members" },
      { status: 500 },
    );
  }
}
