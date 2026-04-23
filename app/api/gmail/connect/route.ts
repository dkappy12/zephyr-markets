import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/require-user";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const GOOGLE_OAUTH_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const GOOGLE_EMAIL_SCOPE = "https://www.googleapis.com/auth/userinfo.email";

export async function GET(request: Request) {
  try {
    const supabase = await createClient();
    const auth = await requireUser(supabase);
    if (auth.response) return auth.response;
    const user = auth.user!;

    const clientId = process.env.GOOGLE_CLIENT_ID;
    const redirectUri = process.env.GOOGLE_REDIRECT_URI;

    if (!clientId || !redirectUri) {
      return NextResponse.json(
        { error: "Missing Google OAuth configuration." },
        { status: 500 },
      );
    }

    const brokerSenderFilter =
      new URL(request.url).searchParams.get("broker_sender_filter")?.trim() ?? "";
    const state = Buffer.from(
      JSON.stringify({
        user_id: user.id,
        broker_sender_filter: brokerSenderFilter || null,
      }),
      "utf8",
    ).toString("base64");
    const url = new URL(GOOGLE_OAUTH_AUTHORIZE_URL);
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", `${GOOGLE_GMAIL_SCOPE} ${GOOGLE_EMAIL_SCOPE}`);
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");
    url.searchParams.set("state", state);

    return NextResponse.redirect(url.toString());
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to start Gmail connect" },
      { status: 500 },
    );
  }
}
