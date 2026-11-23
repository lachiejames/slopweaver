/**
 * `apps.connections.open` — the one call that turns an app-level token into a websocket URL.
 *
 * ## Why this is a raw `fetch` inside the paced door, and not an SDK call
 *
 * Two reasons, and the second is the load-bearing one.
 *
 * The method takes an APP-LEVEL token, which is not the credential any `WebClient` in this program is built
 * with — the read seam, the write seam and the structural seam each hold a workspace token. Reaching this
 * endpoint through one of them would mean widening a sanctioned factory to accept a token of a different
 * kind, for a call that has nothing to do with the workspace.
 *
 * More importantly, this repo's rule is that every Slack call goes through `safeProviderCall`, so a 429
 * stops the whole process rather than one caller: the Slack SDK ABSORBS a 429 by retrying inside itself, and
 * the error it eventually surfaces carries no `status`, so a naive classifier reads a rate limit as
 * permanent. A raw `fetch` inside the shared door has neither problem — it is one attempt, its failure is
 * mapped by the door, and a 429 lands on the shared block immediately. `slack.files.download` in
 * `../slack/download.ts` is the same shape for the same reason.
 *
 * The ticket is single-use and short-lived (Slack expires it in seconds), so it is never cached: every
 * connection attempt opens a fresh one.
 *
 * ## The answer is read through a strict boundary, both arms
 *
 * MEASURED: one call with the installed app token and one with a made-up one, printing key names
 * and never a value: success is exactly `{ ok: true, url }` and refusal exactly `{ ok: false, error }`. Any
 * other key, a missing `url` or one that is not `wss://` with a host is drift, refused by name rather than
 * guessed past.
 */

import { z } from "zod";

import { defineBoundary } from "../../lib/boundary.js";
import { safeProviderCall, scopeIdForToken } from "../../lib/providerCall.js";
import { err, ok, type Result } from "../../lib/result.js";
import { type SocketTicketError, SocketTicketErrors } from "./errors.js";

/** Slack's Socket Mode connection endpoint. */
const CONNECTIONS_OPEN_URL = "https://slack.com/api/apps.connections.open";

/** A lowercase DNS host, alphanumeric at both ends — the only host shape the ticket url is admitted with. */
const TICKET_HOST = "[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?";

/**
 * The ticket url, checked twice on purpose. `z.url` runs the WHATWG parser, so `wss://:` and `wss://@/x` fail
 * as unparseable. That parser also collapses `wss:///link` into host `link`, so the regex pins the literal text
 * to `wss://`, a spelled-out host and an optional port as well.
 */
const TICKET_URL = z
  .url({ hostname: new RegExp(`^${TICKET_HOST}$`, "u"), protocol: /^wss$/u })
  .regex(new RegExp(`^wss://${TICKET_HOST}(?::\\d+)?(?:[/?#]\\S*)?$`, "u"));

/** The two arms `apps.connections.open` answers, as measured. */
const TICKET_ANSWER = defineBoundary({
  endpoint: "POST /api/apps.connections.open",
  schema: z.discriminatedUnion("ok", [
    z.strictObject({ ok: z.literal(true), url: TICKET_URL }),
    z.strictObject({ error: z.string().regex(/\S/u), ok: z.literal(false) }),
  ]),
});

/**
 * Read the websocket URL out of an `apps.connections.open` response. PURE, so every failure shape — `ok:false`
 * with an error code, a body that is not JSON, a key Slack added, a missing url — is unit-tested without a
 * network.
 *
 * @param text the response body as sent
 * @param status the HTTP status it came with, named when the body is not JSON
 * @returns the `wss://` URL, or the reason it could not be used
 */
export function readTicket({ text, status }: { text: string; status: number }): Result<string, SocketTicketError> {
  const read = TICKET_ANSWER.parseJson({ text });
  if (read.isErr()) {
    if (read.error.code === "BOUNDARY_NOT_JSON") {
      return err(SocketTicketErrors.noJsonBody({ status }));
    }
    return err(SocketTicketErrors.responseChanged({ message: read.error.message }));
  }
  if (!read.value.ok) {
    return err(SocketTicketErrors.refused({ slackErrorCode: read.value.error }));
  }
  return ok(read.value.url);
}

/**
 * Open a Socket Mode connection ticket.
 *
 * `signal`, when given, aborts the underlying `fetch` directly — it is closed over in the attempt closure
 * rather than threaded through `safeProviderCall` itself, so an in-flight request settles (rejecting)
 * promptly on abort instead of running to its own completion. The one thing it does NOT cover is a wait the
 * shared retry door takes AROUND an attempt — the rate-limit block or the backoff sleep between retries —
 * both bounded (the block by its recorded deadline, the backoff by {@link retryTransient}'s 30s ceiling) and
 * only reachable after a real transient failure, never during the common case this closes: a request that
 * is merely slow or stalled.
 *
 * @param appToken the `xapp-` app-level token, which must carry `connections:write`
 * @param signal aborts the in-flight request; omit for the no-deadline caller, which never aborts
 * @returns the single-use `wss://` URL, or the reason the ticket could not be opened
 */
export async function openSocketTicket({
  appToken,
  signal,
}: {
  appToken: string;
  signal?: AbortSignal;
}): Promise<Result<string, SocketTicketError>> {
  const called = await safeProviderCall({
    // devlint: raw-http -- an app-level token is not any WebClient's credential; see the module header.
    execute: () =>
      fetch(CONNECTIONS_OPEN_URL, {
        headers: {
          authorization: `Bearer ${appToken}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        method: "POST",
        ...(signal === undefined ? {} : { signal }),
      }),
    operation: "slack.apps.connections.open",
    provider: "slack",
    retryMode: "transient",
    scopeId: scopeIdForToken({ token: appToken }),
  });
  if (called.isErr()) {
    return err(SocketTicketErrors.unreachable({ message: called.error.message }));
  }
  let text: string;
  try {
    text = await called.value.text();
  } catch {
    return err(SocketTicketErrors.noJsonBody({ status: called.value.status }));
  }
  return readTicket({ status: called.value.status, text });
}
