import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo";
const CALLBACK_SUCCESS_PATH = "/dashboard/portfolio/book?gmail=connected";
const CALLBACK_ERROR_PATH = "/dashboard/portfolio/book?gmail=error";

type GoogleTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
};

type GoogleUserInfoResponse = {
  email?: string;
};

function errorRedirect(requestUrl: string) {
  const { origin } = new URL(requestUrl);
  return NextResponse.redirect(`${origin}${CALLBACK_ERROR_PATH}`);
}

export async function GET(request: Request) {
  try {
    const requestUrl = new URL(request.url);
    const code = requestUrl.searchParams.get("code");
    const state = requestUrl.searchParams.get("state");

    if (!code || !state) return errorRedirect(request.url);

    let userId: string;
    let brokerSenderFilter: string | null = null;
    try {
      const decoded = Buffer.from(state, "base64").toString("utf8");
      if (!decoded) return errorRedirect(request.url);
      if (decoded.startsWith("{")) {
        const parsed = JSON.parse(decoded) as {
          user_id?: unknown;
          broker_sender_filter?: unknown;
        };
        if (typeof parsed.user_id !== "string" || !parsed.user_id) {
          return errorRedirect(request.url);
        }
        userId = parsed.user_id;
        brokerSenderFilter =
          typeof parsed.broker_sender_filter === "string" &&
          parsed.broker_sender_filter.trim()
            ? parsed.broker_sender_filter.trim()
            : null;
      } else {
        userId = decoded;
      }
    } catch {
      return errorRedirect(request.url);
    }

    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const redirectUri = process.env.GOOGLE_REDIRECT_URI;

    if (!clientId || !clientSecret || !redirectUri) {
      return errorRedirect(request.url);
    }

    const tokenResponse = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
      cache: "no-store",
    });

    if (!tokenResponse.ok) return errorRedirect(request.url);

    const tokenJson = (await tokenResponse.json()) as GoogleTokenResponse;
    const accessToken = tokenJson.access_token;
    const refreshToken = tokenJson.refresh_token;
    const expiresIn = tokenJson.expires_in;

    if (!accessToken || !refreshToken || !expiresIn) {
      return errorRedirect(request.url);
    }

    const userInfoResponse = await fetch(GOOGLE_USERINFO_URL, {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    if (!userInfoResponse.ok) return errorRedirect(request.url);

    const userInfo = (await userInfoResponse.json()) as GoogleUserInfoResponse;
    const gmailAddress = userInfo.email;
    if (!gmailAddress) return errorRedirect(request.url);

    const tokenExpiry = new Date(Date.now() + expiresIn * 1000).toISOString();
    const supabase = await createClient();
    const { error } = await supabase.from("gmail_connections").upsert(
      {
        user_id: userId,
        gmail_address: gmailAddress,
        access_token: accessToken,
        refresh_token: refreshToken,
        token_expiry: tokenExpiry,
        broker_sender_filter: brokerSenderFilter,
      },
      { onConflict: "user_id" },
    );
    if (error) return errorRedirect(request.url);

    return NextResponse.redirect(`${requestUrl.origin}${CALLBACK_SUCCESS_PATH}`);
  } catch {
    return errorRedirect(request.url);
  }
}
