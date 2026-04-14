import { NextResponse } from "next/server";

type SupabaseAuthClient = {
  auth: {
    getUser: () => Promise<{
      data: { user: { id: string; email_confirmed_at?: string | null } | null };
      error: { message?: string } | null;
    }>;
  };
};

type RequireUserOptions = {
  requireVerifiedEmail?: boolean;
};

export async function requireUser(
  supabase: SupabaseAuthClient,
  options: RequireUserOptions = {},
) {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return {
      user: null,
      response: NextResponse.json(
        { code: "UNAUTHORIZED", error: "Unauthorized" },
        { status: 401 },
      ),
    };
  }

  if (options.requireVerifiedEmail && !user.email_confirmed_at) {
    return {
      user: null,
      response: NextResponse.json(
        { code: "EMAIL_UNVERIFIED", error: "Email verification required" },
        { status: 403 },
      ),
    };
  }

  return { user, response: null };
}
