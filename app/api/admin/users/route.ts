import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/auth/require-admin-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET() {
  const supabase = await createClient();
  const auth = await requireAdminUser(supabase);
  if (auth.response) return auth.response;

  const admin = createAdminClient();
  const { data: profiles } = await admin
    .from("profiles")
    .select("id, email, role, plan, created_at")
    .order("created_at", { ascending: false });

  return NextResponse.json({ profiles: profiles ?? [] });
}
