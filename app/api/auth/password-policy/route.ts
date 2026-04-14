import { passwordPolicyHint, validatePasswordPolicy } from "@/lib/auth/password-policy";
import { assertSameOrigin } from "@/lib/auth/request-security";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const csrf = assertSameOrigin(request);
  if (csrf) return csrf;

  const body = await request.json().catch(() => ({}));
  const password = typeof body?.password === "string" ? body.password : "";
  const result = validatePasswordPolicy(password);
  if (!result.ok) {
    return NextResponse.json(
      {
        code: "WEAK_PASSWORD",
        error: "Password does not meet policy requirements.",
        reasons: result.reasons,
        hint: passwordPolicyHint(),
      },
      { status: 400 },
    );
  }
  return NextResponse.json({ ok: true });
}
