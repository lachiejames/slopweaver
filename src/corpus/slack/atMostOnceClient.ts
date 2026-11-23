/**
 * The NON-RETRYING Slack write client: its retry budget, its brand, and the one place it is minted.
 *
 * Two clients exist in this seam. `./writeApi.ts`'s default `WebClient` retries — correctly, because
 * updating, uploading, reading back and the ordinary `chat.delete` are all safely repeatable. A handful of
 * calls are not, and for those a second attempt is the defect rather than the recovery.
 *
 * ## Why the choice is a TYPE and not a comment
 *
 * It used to live only in `makeSlackWriteTransport`'s wiring table, as which of two in-scope identifiers a
 * one-line arrow passed along. MEASURED: changing
 * `deleteMessageOnceCall({ client: posting, … })` to `deleteMessageOnceCall({ client, … })` — one word —
 * survived every test in this repository, because every test of that delete injects its own
 * `deleteMessageOnce` and nothing reads the table that builds the real one. The restored retries are
 * destructive rather than wasteful: a first `chat.delete` that fails transiently, a concurrent session that
 * REPAIRS the message during the retry delay, and a second attempt that succeeds together remove a message
 * nobody ever judged, since Slack's `ts` is stable across `chat.update`.
 *
 * `retryConfig` is private on `WebClient`, so no test can ask a client how many times it will try. The
 * property is carried by a brand instead: {@link postingClient} is the only thing in this repository that
 * mints an {@link AtMostOnceClient}, and a call that must not repeat asks for that type. The mutant above no
 * longer compiles, which is a stronger witness than a test and runs on every `yarn typecheck`:
 *
 * ```bash
 * sed -i '' 's/deleteMessageOnceCall({ client: posting,/deleteMessageOnceCall({ client,/' src/corpus/slack/writeApi.ts
 * yarn typecheck   # before: clean.  after: the brand refuses the retrying client
 * ```
 *
 * Its own module rather than a section of `./writeApi.ts` for two reasons that are both mechanical:
 * `./writeApiRead.ts` can REQUIRE the brand without importing the write seam it is imported by, and the
 * whole subject of the non-retrying client — budget, brand and construction — is one short file a reader
 * auditing "what here cannot be retried?" reads end to end.
 */
import type { WebClientOptions } from "@slack/web-api";

import type { SlackWritePrivacy } from "../../outbound/slack/writePrivacy.js";
import { GuardedWebClient } from "./guardedWebClient.js";

/** The brand's key. A real symbol, not a phantom, so minting it needs no type assertion. */
const AT_MOST_ONCE: unique symbol = Symbol("slack.write.atMostOnce");

/**
 * A `WebClient` built to make exactly one attempt, carried in the TYPE so a caller cannot substitute the
 * repeatable one. Structurally a `WebClient` — every read of it stays ordinary — and mintable only by
 * {@link postingClient}, since {@link AT_MOST_ONCE} is not exported.
 */
export type AtMostOnceClient = GuardedWebClient & { readonly [AT_MOST_ONCE]: true };

/**
 * The `WebClient` options that make a call at-most-once.
 *
 * Its own exported constant so the number is assertable: `WebClient` keeps `retryConfig` private, so a test
 * cannot ask a built client what it will do, and this value is the last point where the answer is readable.
 */
export const AT_MOST_ONCE_OPTIONS = { retryConfig: { retries: 0 } } as const satisfies WebClientOptions;

/**
 * A client that NEVER retries, for the irreversible calls in `./writeApi.ts`.
 *
 * This exists because posting a message is the one irreversible thing there, and both retry layers above it
 * were happy to do it again. `WebClient` defaults to `tenRetriesInAboutThirtyMinutes` (eleven attempts),
 * and `postCardCall` additionally wrapped that in `retryTransient` (four more) — up to forty-four attempts
 * at an irreversible POST. A `chat.postMessage` that Slack PROCESSES and whose response is then lost to a
 * timeout or a 5xx is indistinguishable from one that never arrived, so a retry posts the message twice,
 * and the O_EXCL reservation cannot see it because it all happens inside one winning claim.
 *
 * So posting is AT-MOST-ONCE by construction, and so is `deleteMessageOnceCall`. The cost is real and
 * accepted: a transient 429 or 5xx now fails the call instead of quietly recovering. That is the correct
 * direction for an irreversible action — the drip loop reports exactly which messages landed, and a re-run
 * skips them. Every OTHER call in that file (upload, update, history read, the repeatable delete) is safely
 * repeatable and keeps its retries.
 *
 * @param token the bot token the client writes as
 * @param privacy the outbound privacy capability every post it makes is judged by
 * @returns the client, branded so the type system keeps it apart from the retrying one
 */
export function postingClient({ token, privacy }: { token: string; privacy: SlackWritePrivacy }): AtMostOnceClient {
  // devlint: sdk-factory -- the NON-RETRYING posting client; retries here would double-post. Guarded like every write client
  return Object.assign(new GuardedWebClient({ options: AT_MOST_ONCE_OPTIONS, privacy, token }), {
    [AT_MOST_ONCE]: true as const,
  });
}
