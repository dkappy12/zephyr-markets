import { NextResponse } from "next/server";
import { assertSameOrigin } from "@/lib/auth/request-security";
import { checkRateLimit } from "@/lib/auth/rate-limit";
import { requireEntitlement } from "@/lib/auth/require-entitlement";
import { requireUser } from "@/lib/auth/require-user";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_MESSAGES_URL =
  "https://gmail.googleapis.com/gmail/v1/users/me/messages";

type GmailConnection = {
  user_id: string;
  access_token: string;
  refresh_token: string;
  token_expiry: string | null;
  broker_sender_filter: string | null;
};

type GmailListResponse = {
  messages?: Array<{ id?: string }>;
};

type GmailMessageHeader = {
  name?: string;
  value?: string;
};

type GmailMessagePart = {
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailMessagePart[];
  headers?: GmailMessageHeader[];
};

type GmailMessageResponse = {
  id?: string;
  payload?: GmailMessagePart;
  internalDate?: string;
};

type TokenRefreshResponse = {
  access_token?: string;
  expires_in?: number;
};

type EmailTradeImportInsert = {
  user_id: string;
  gmail_message_id: string;
  subject: string | null;
  sender: string | null;
  received_at: string;
  raw_text: string;
  status: "pending";
};

type SyncedImportRow = {
  id: string;
  sender: string | null;
  subject: string | null;
  received_at: string | null;
};

function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4;
  const withPadding =
    padding === 0 ? normalized : `${normalized}${"=".repeat(4 - padding)}`;
  return Buffer.from(withPadding, "base64").toString("utf8");
}

function findHeader(
  headers: GmailMessageHeader[] | undefined,
  target: string,
): string | null {
  if (!headers) return null;
  const match = headers.find(
    (header) => header.name?.toLowerCase() === target.toLowerCase(),
  );
  return typeof match?.value === "string" ? match.value : null;
}

function extractPlainTextFromPart(part: GmailMessagePart | undefined): string {
  if (!part) return "";

  if (part.mimeType === "text/plain" && typeof part.body?.data === "string") {
    return decodeBase64Url(part.body.data);
  }

  if (Array.isArray(part.parts)) {
    for (const child of part.parts) {
      const text = extractPlainTextFromPart(child);
      if (text) return text;
    }
  }

  return "";
}

function extractBodyText(payload: GmailMessagePart | undefined): string {
  if (!payload) return "";
  const plain = extractPlainTextFromPart(payload);
  if (plain) return plain;
  if (typeof payload.body?.data === "string") {
    return decodeBase64Url(payload.body.data);
  }
  return "";
}

function expiresWithinFiveMinutes(tokenExpiry: string | null): boolean {
  if (!tokenExpiry) return true;
  const expiryMs = Date.parse(tokenExpiry);
  if (!Number.isFinite(expiryMs)) return true;
  return expiryMs - Date.now() <= 5 * 60 * 1000;
}

async function refreshAccessTokenIfNeeded(
  connection: GmailConnection,
): Promise<{ accessToken: string; tokenExpiry: string | null }> {
  if (!expiresWithinFiveMinutes(connection.token_expiry)) {
    return {
      accessToken: connection.access_token,
      tokenExpiry: connection.token_expiry,
    };
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("Missing Google OAuth configuration.");
  }

  const refreshResponse = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: connection.refresh_token,
    }),
    cache: "no-store",
  });

  if (!refreshResponse.ok) {
    throw new Error("Failed to refresh Google access token.");
  }

  const refreshJson = (await refreshResponse.json()) as TokenRefreshResponse;
  if (!refreshJson.access_token || !refreshJson.expires_in) {
    throw new Error("Invalid token refresh response.");
  }

  const expiry = new Date(Date.now() + refreshJson.expires_in * 1000).toISOString();
  return { accessToken: refreshJson.access_token, tokenExpiry: expiry };
}

async function fetchMessage(
  accessToken: string,
  messageId: string,
): Promise<GmailMessageResponse> {
  const url = `${GOOGLE_MESSAGES_URL}/${encodeURIComponent(messageId)}?format=full`;
  const response = await fetch(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  if (!response.ok) throw new Error("Failed to fetch Gmail message.");
  return (await response.json()) as GmailMessageResponse;
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();

    const auth = await requireUser(supabase);
    if (auth.response) return auth.response;
    const user = auth.user!;

    const entitlement = await requireEntitlement(supabase, user.id, {
      feature: "portfolioEnabled",
      minimumTier: "pro",
    });
    if (entitlement.response) return entitlement.response;

    const csrf = assertSameOrigin(request);
    if (csrf) return csrf;

    const rate = await checkRateLimit({
      key: user.id,
      bucket: "gmail_sync",
      limit: 5,
      windowMs: 60_000,
    });
    if (!rate.allowed) {
      return NextResponse.json(
        { code: "RATE_LIMITED", error: "Too many sync requests. Please retry." },
        {
          status: 429,
          headers: { "Retry-After": String(rate.retryAfterSec) },
        },
      );
    }

    const { data: connection, error: connectionError } = await supabase
      .from("gmail_connections")
      .select(
        "user_id, access_token, refresh_token, token_expiry, broker_sender_filter",
      )
      .eq("user_id", user.id)
      .maybeSingle<GmailConnection>();

    if (connectionError) {
      return NextResponse.json({ error: connectionError.message }, { status: 500 });
    }
    if (!connection) {
      return NextResponse.json(
        { error: "No Gmail account connected" },
        { status: 400 },
      );
    }

    const refreshed = await refreshAccessTokenIfNeeded(connection);
    let accessToken = refreshed.accessToken;
    if (refreshed.accessToken !== connection.access_token) {
      const { error: updateError } = await supabase
        .from("gmail_connections")
        .update({
          access_token: refreshed.accessToken,
          token_expiry: refreshed.tokenExpiry,
        })
        .eq("user_id", user.id);
      if (updateError) {
        return NextResponse.json({ error: updateError.message }, { status: 500 });
      }
      accessToken = refreshed.accessToken;
    }

    const query = connection.broker_sender_filter?.trim()
      ? `from:${connection.broker_sender_filter.trim()} newer_than:30d`
      : "newer_than:7d";

    const listUrl = new URL(GOOGLE_MESSAGES_URL);
    listUrl.searchParams.set("q", query);
    listUrl.searchParams.set("maxResults", "20");

    const listResponse = await fetch(listUrl.toString(), {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    if (!listResponse.ok) {
      return NextResponse.json(
        { error: "Failed to list Gmail messages" },
        { status: 502 },
      );
    }

    const listJson = (await listResponse.json()) as GmailListResponse;
    const messageIds = (listJson.messages ?? [])
      .map((message) => message.id)
      .filter((id): id is string => typeof id === "string" && id.length > 0);

    if (messageIds.length === 0) {
      return NextResponse.json({ synced: 0, skipped: 0, imports: [] });
    }

    const { data: existingRows, error: existingError } = await supabase
      .from("email_trade_imports")
      .select("gmail_message_id")
      .eq("user_id", user.id)
      .in("gmail_message_id", messageIds);
    if (existingError) {
      return NextResponse.json({ error: existingError.message }, { status: 500 });
    }

    const existingIds = new Set(
      (existingRows ?? [])
        .map((row) => row.gmail_message_id)
        .filter((value): value is string => typeof value === "string"),
    );

    const unseenIds = messageIds.filter((id) => !existingIds.has(id));
    const skipped = messageIds.length - unseenIds.length;

    if (unseenIds.length === 0) {
      return NextResponse.json({ synced: 0, skipped, imports: [] });
    }

    const fullMessages = await Promise.all(
      unseenIds.map((messageId) => fetchMessage(accessToken, messageId)),
    );

    const inserts: EmailTradeImportInsert[] = fullMessages
      .map((message) => {
        const gmailMessageId = message.id;
        if (!gmailMessageId) return null;

        const headers = message.payload?.headers;
        const subject = findHeader(headers, "subject");
        const sender = findHeader(headers, "from");
        const rawText = extractBodyText(message.payload);
        const internalDateMs = Number(message.internalDate);
        const receivedAt = Number.isFinite(internalDateMs)
          ? new Date(internalDateMs).toISOString()
          : new Date().toISOString();

        return {
          user_id: user.id,
          gmail_message_id: gmailMessageId,
          subject,
          sender,
          received_at: receivedAt,
          raw_text: rawText,
          status: "pending",
        };
      })
      .filter((row): row is EmailTradeImportInsert => row !== null);

    if (inserts.length === 0) {
      return NextResponse.json({
        synced: 0,
        skipped: messageIds.length,
        imports: [],
      });
    }

    const { data: insertedRows, error: insertError } = await supabase
      .from("email_trade_imports")
      .insert(inserts)
      .select("id, sender, subject, received_at");
    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }

    return NextResponse.json({
      synced: inserts.length,
      skipped,
      imports: (insertedRows ?? []) as SyncedImportRow[],
    });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to sync Gmail" },
      { status: 500 },
    );
  }
}
