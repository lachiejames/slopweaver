/*
 * A counting Gmail transport for tests that drive the REAL pinned Gmail SDK through the write guard: a plain `fetch`
 * (not a mock) that records exactly what reached it — method, host, path and query, the authorisation it carried, and
 * the body — and answers every read with one JSON document every seam can project. A `drafts.get` asking for
 * `format=raw` answers with the draft text a case gives it, or with the status a case names. Nothing leaves the
 * process. Beside it, a throwaway home connected to Gmail with a token no refresh is needed for. Synthetic values
 * throughout.
 */
import { unwrap } from "../lib/result.js";
import type { GmailFetch } from "../live/gmail/guardedFetch.js";
import { gmailGrantStore } from "../secrets/gmailGrant.js";
import { writeSecretFile } from "../secrets/store.js";

/**
 * Connect a throwaway home to Gmail: a grant carrying `scopes` whose cached access token expires in 2100, so no token
 * refresh is ever sent, and the OAuth client id and secret as `0600` secret files. Writes only under `home`.
 *
 * @param scopes the Google OAuth scopes the stored grant carries
 */
export function connectGmailHome({ home, scopes }: { home: string; scopes: readonly string[] }): void {
  unwrap(
    gmailGrantStore.write({
      grant: {
        accessToken: "at-fixture",
        account: "owner@acme.test",
        expiryMs: 4_102_444_800_000,
        grantedAtIso: "2026-10-01T00:00:00.000Z",
        refreshToken: "rt-1",
        scopes,
      },
      home,
    }),
  );
  for (const [name, value] of [
    ["google-client-id", "client-id"],
    ["google-client-secret", "client-secret"],
  ] as const) {
    unwrap(writeSecretFile({ home, name, value }));
  }
}

/** One request that reached the transport under the guard. */
export interface SentGmailRequest {
  /** `METHOD host/path?query`, the way the routes are asserted. */
  readonly route: string;
  readonly authorization: string | null;
  readonly body: string | undefined;
}

/** One answer every read the door makes can be projected from: a message, a thread, a label list, a draft and more. */
const ANSWER = {
  data: "aGk",
  emailAddress: "owner@acme.test",
  history: [],
  historyId: "9",
  id: "m1",
  labelIds: ["INBOX"],
  labels: [{ id: "INBOX", name: "INBOX", type: "system" }],
  message: { id: "m1", threadId: "t1" },
  messages: [{ id: "m1", threadId: "t1" }],
  messagesTotal: 1,
  resultSizeEstimate: 1,
  size: 2,
  threadId: "t1",
};

/** The JSON response gaxios reads back. */
function jsonResponse({ body, status }: { body: unknown; status: number }): Response {
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" }, status });
}

/** The request's body as text, the only shape gaxios sends a Gmail body in. */
function bodyOf({ init }: { init: Parameters<GmailFetch>[1] }): string | undefined {
  const body = init?.body;
  return typeof body === "string" ? body : undefined;
}

/**
 * A counting transport, and what it recorded.
 *
 * @param draftText the message a `format=raw` draft re-read answers with, as text; it is base64url-encoded here
 * @param reReadBody replaces the whole re-read answer, for a shape the pinned SDK does not declare
 * @param rawAnswer overrides the re-read's `message.raw` verbatim — a malformed one, or none at all when null
 * @param reReadStatus the HTTP status the re-read answers with
 * @returns the transport and the list it records into
 */
export function countingGmailTransport({
  draftText = "Subject: hello\r\n\r\nthe build is green\r\n",
  rawAnswer,
  reReadBody,
  reReadStatus = 200,
}: {
  draftText?: string;
  rawAnswer?: string | null;
  reReadBody?: Record<string, unknown>;
  reReadStatus?: number;
} = {}): { transport: GmailFetch; sent: SentGmailRequest[] } {
  const sent: SentGmailRequest[] = [];
  const transport: GmailFetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input);
    let method = "GET";
    if (init?.method !== undefined) {
      method = init.method;
    }
    sent.push({
      authorization: new Headers(init?.headers).get("authorization"),
      body: bodyOf({ init }),
      route: `${method} ${url.host}${url.pathname}${url.search}`,
    });
    if (url.searchParams.get("format") !== "raw") {
      return jsonResponse({ body: ANSWER, status: 200 });
    }
    if (reReadBody !== undefined) {
      return jsonResponse({ body: reReadBody, status: reReadStatus });
    }
    if (rawAnswer === null) {
      return jsonResponse({ body: { id: "d1", message: { id: "m1" } }, status: reReadStatus });
    }
    let raw = Buffer.from(draftText, "utf8").toString("base64url");
    if (rawAnswer !== undefined) {
      raw = rawAnswer;
    }
    return jsonResponse({ body: { id: "d1", message: { id: "m1", raw } }, status: reReadStatus });
  };
  return { sent, transport };
}
