/**
 * The Slack PROFILE calls — the owner's own status and presence, on the owner's user token. Behind
 * `slopweaver slack status`, and split out of `./writeApi.ts` for the reason `./writeApiConversations.ts`
 * is: that file is over `file-size-ratchet`'s cap. The client is still built THERE
 * (`makeSlackProfileTransport`), so "what can this program do to Slack" is still answered from one factory.
 *
 * A SEPARATE transport interface rather than four more members on `SlackWriteTransport`: that one is the
 * message seam every send fake implements, and a status write shares none of its policy. The methods are
 * named `setProfileStatus`/`readProfileStatus` so nobody confuses them with an assistant thread's status.
 *
 * Every call retries as `transient`: each is idempotent in its end state — setting the same status or the
 * same presence twice leaves Slack exactly where one call did. There is no policy here; what counts as a
 * refusal, and which scope a `missing_scope` names, lives in `../../cli/commands/slack/statusCore.ts`.
 */
import type { WebClient } from "@slack/web-api";

import { isRecord } from "#lib/parsers.js";
import { safeProviderCall } from "#lib/providerCall.js";
import { orThrow } from "#lib/safeBoundary.js";

/** The owner's status as Slack holds it. An empty string is "none"; `expirationSeconds` 0 means it never expires. */
export interface HeldStatus {
  readonly text: string;
  readonly emoji: string;
  readonly expirationSeconds: number;
}

/** The owner's presence as Slack reports it. `manualAway` is the sticky away `users.setPresence` sets. */
export interface HeldPresence {
  readonly presence: "active" | "away";
  readonly manualAway: boolean;
  readonly online: boolean;
}

/** The status fields one `users.profile.set` sends — all three every time, so a clear is never partial. */
export interface StatusWrite {
  readonly statusText: string;
  readonly statusEmoji: string;
  /** Epoch seconds; 0 is "never expires", which is also how a clear says it. */
  readonly expirationSeconds: number;
}

/** The four profile calls, each one raw SDK call. */
export interface SlackProfileTransport {
  readonly setProfileStatus: (args: StatusWrite) => Promise<void>;
  readonly setPresence: (args: { presence: "away" | "auto" }) => Promise<void>;
  readonly readProfileStatus: () => Promise<HeldStatus>;
  readonly readPresence: () => Promise<HeldPresence>;
}

/**
 * Read the status fields off a `users.profile.get` response.
 *
 * An absent text or emoji is the empty string and an absent expiry is 0 — which is what Slack itself means
 * by leaving them out — while a response with no `profile` object at all is not a status and answers
 * `undefined`.
 *
 * @param result the raw response body
 * @returns the held status, or undefined when the response carries no profile
 */
export function readProfileStatus({ result }: { result: unknown }): HeldStatus | undefined {
  if (!isRecord(result) || !isRecord(result["profile"])) {
    return undefined;
  }
  const profile = result["profile"];
  const text = profile["status_text"];
  const emoji = profile["status_emoji"];
  const expiration = profile["status_expiration"];
  return {
    emoji: typeof emoji === "string" ? emoji : "",
    expirationSeconds: typeof expiration === "number" && Number.isFinite(expiration) ? expiration : 0,
    text: typeof text === "string" ? text : "",
  };
}

/**
 * Read presence off a `users.getPresence` response.
 *
 * @param result the raw response body
 * @returns the held presence, or undefined when Slack named neither `active` nor `away`
 */
export function readPresence({ result }: { result: unknown }): HeldPresence | undefined {
  if (!isRecord(result)) {
    return undefined;
  }
  const presence = result["presence"];
  if (presence !== "active" && presence !== "away") {
    return undefined;
  }
  return { manualAway: result["manual_away"] === true, online: result["online"] === true, presence };
}

/** `users.profile.set` — the owner's status text, emoji and expiry, all three at once. */
async function profileSetCall({
  client,
  scopeId,
  write,
}: {
  client: WebClient;
  scopeId: string;
  write: StatusWrite;
}): Promise<void> {
  orThrow({
    result: await safeProviderCall({
      execute: () =>
        client.users.profile.set({
          profile: {
            status_emoji: write.statusEmoji,
            status_expiration: write.expirationSeconds,
            status_text: write.statusText,
          },
        }),
      operation: "slack.users.profile.set",
      provider: "slack",
      retryMode: "transient",
      scopeId,
    }),
  });
}

/** `users.setPresence` — manual away, or back to Slack's automatic presence. */
async function setPresenceCall({
  client,
  presence,
  scopeId,
}: {
  client: WebClient;
  presence: "away" | "auto";
  scopeId: string;
}): Promise<void> {
  orThrow({
    result: await safeProviderCall({
      execute: () => client.users.setPresence({ presence }),
      operation: "slack.users.setPresence",
      provider: "slack",
      retryMode: "transient",
      scopeId,
    }),
  });
}

/** `users.profile.get` — the owner's own profile, read back for the status fields. */
async function profileGetCall({ client, scopeId }: { client: WebClient; scopeId: string }): Promise<HeldStatus> {
  const res = orThrow({
    result: await safeProviderCall({
      execute: () => client.users.profile.get({}),
      operation: "slack.users.profile.get",
      provider: "slack",
      retryMode: "transient",
      scopeId,
    }),
  });
  const held = readProfileStatus({ result: res });
  if (held === undefined) {
    throw new Error("slack.users.profile.get returned no profile");
  }
  return held;
}

/** `users.getPresence` — the owner's own presence, read back. */
async function getPresenceCall({ client, scopeId }: { client: WebClient; scopeId: string }): Promise<HeldPresence> {
  const res = orThrow({
    result: await safeProviderCall({
      execute: () => client.users.getPresence({}),
      operation: "slack.users.getPresence",
      provider: "slack",
      retryMode: "transient",
      scopeId,
    }),
  });
  const held = readPresence({ result: res });
  if (held === undefined) {
    throw new Error("slack.users.getPresence returned no presence");
  }
  return held;
}

/**
 * Wire the four calls over one client.
 *
 * @param client the repeatable-call client, built by `./writeApi.ts`'s factory
 * @param scopeId the shared-429-block key for this token
 * @returns the profile transport
 */
export function profileMethods({ client, scopeId }: { client: WebClient; scopeId: string }): SlackProfileTransport {
  return {
    readPresence: () => getPresenceCall({ client, scopeId }),
    readProfileStatus: () => profileGetCall({ client, scopeId }),
    setPresence: ({ presence }) => setPresenceCall({ client, presence, scopeId }),
    setProfileStatus: (write) => profileSetCall({ client, scopeId, write }),
  };
}
