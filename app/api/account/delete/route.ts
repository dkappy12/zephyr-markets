import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

export async function DELETE() {
  // Verify the user is authenticated
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  const userId = user.id;

  try {
    // Delete user data from all tables first
    // Use service role key to bypass RLS
    const adminClient = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );

    // Delete in dependency order — child tables first
    await adminClient.from("portfolio_pnl").delete().eq("user_id", userId);
    await adminClient.from("positions").delete().eq("user_id", userId);
    await adminClient.from("brief_entries").delete().eq("user_id", userId);
    await adminClient.from("premium_predictions").delete().eq("user_id", userId);

    // Finally delete the auth record
    const { error: deleteError } = await adminClient.auth.admin.deleteUser(
      userId,
    );

    if (deleteError) {
      console.error("Failed to delete auth user:", deleteError);
      return NextResponse.json(
        { error: "Failed to delete account" },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Account deletion error:", error);
    return NextResponse.json({ error: "Failed to delete account" }, { status: 500 });
  }
}
