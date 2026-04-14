import { NextResponse } from "next/server";

export function assertSameOrigin(request: Request) {
  const reqUrl = new URL(request.url);
  const originHeader = request.headers.get("origin");
  const refererHeader = request.headers.get("referer");
  const sameOrigin =
    (originHeader && originHeader === reqUrl.origin) ||
    (refererHeader && refererHeader.startsWith(reqUrl.origin));

  if (!sameOrigin) {
    return NextResponse.json(
      { code: "CSRF_BLOCKED", error: "Cross-site request blocked." },
      { status: 403 },
    );
  }
  return null;
}
