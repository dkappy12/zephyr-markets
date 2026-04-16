import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/require-user";

type RequireAdminUserResult = {
  user: NonNullable<Awaited<ReturnType<typeof requireUser>>["user"]> | null;
  response: NextResponse | null;
};

export async function requireAdminUser(
  supabase: Parameters<typeof requireUser>[0],
): Promise<RequireAdminUserResult> {
  const { user, response } = await requireUser(supabase);
  if (response || !user) return { user: null, response };

  const isAdmin =
    (user?.app_metadata as { role?: string } | null | undefined)?.role === "admin" ||
    (user?.user_metadata as { role?: string } | null | undefined)?.role === "admin";
  if (!isAdmin) {
    return {
      user: null,
      response: NextResponse.json(
        { code: "FORBIDDEN", error: "Admin access required" },
        { status: 403 },
      ),
    };
  }

  return { user, response: null };
}

