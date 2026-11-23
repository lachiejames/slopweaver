/**
 * The outbound privacy check at the Gmail write TRANSPORT: every write the Gmail SDK client sends
 * (`../../live/gmail/client.ts` installs `../../live/gmail/guardedFetch.ts` as its auth transport's `fetch`) is judged
 * by `../privacyCheck.ts` after the SDK has serialised it and before the network `fetch` runs — a label change, a
 * draft's whole decoded MIME message, the draft a send delivers (re-read first), and any write added later. The
 * one-click unsubscribe POST, which goes to a third party rather than Gmail, is judged the same way just before its own
 * `fetch` (`../../live/gmail/unsubscribe.ts`). What counts as a write and what is judged: `./writePrivacyPayload.ts`.
 *
 * ## Two refusals, in a fixed order
 *
 * {@link refuseGmailWrite} runs the dead-Datadog-host refusal (`../invalidDatadogHost.ts`) first and this check
 * second, exactly as the GitHub, Slack, Linear and Notion transports order them, and only then may the request be sent.
 *
 * ## The policy comes from the verb's home, on every write
 *
 * A {@link GmailWritePrivacy} is built from the state home the verb already resolved — `resolveGmailClient({ home })`
 * builds it, so every verb that binds a Gmail client judges under its own home and none reads an ambient one. The
 * policy (`../writePrivacyPolicy.ts`) is read afresh on every write and never cached, so a terms file deleted between
 * two writes refuses the second; a read returns before it is loaded.
 *
 * ## A hold, and definitely unsent
 *
 * The refusal is a throw. gaxios wraps what its `fetch` threw in a `GaxiosError` whose `cause` is this error, and
 * `safeProviderCall` maps that into an `IngestError` whose `cause` is the `GaxiosError`, so `./sendFailure.ts` finds
 * it by class and a board draft releases the claim it took. There is no override and no hatch: every finding names a
 * rewording that is always possible.
 */
import type { Result } from "../../lib/result.js";
import { invalidDatadogHostHatchOpen, refuseInvalidDatadogHost } from "../invalidDatadogHost.js";
import type { PrivacyPolicy } from "../privacyCheck.js";
import {
  type PrivateTermReviewPort,
  privateTermReviewPort,
  privateTermWriteRefusal,
} from "../privateTermReview/gate.js";
import { writePrivacyRefusal } from "../writePrivacyLeaves.js";
import { loadWritePrivacyPolicy } from "../writePrivacyPolicy.js";
import { GMAIL_STRICT_DESTINATION, type GmailWriteRequest, gmailWriteFindings } from "./writePrivacyPayload.js";

/** The privacy capability the Gmail transport requires: the policy one write is judged under. */
export interface GmailWritePrivacy {
  readonly resolve: () => Promise<Result<PrivacyPolicy, string>>;
  /** Holds a write a meant private term matched for a review in context; absent, such a match refuses outright. */
  readonly review?: PrivateTermReviewPort | undefined;
  /**
   * The mailbox the credential is bound to. A held write's key covers it, because `me` names a different mailbox
   * once the home is reconnected to another account.
   */
  readonly principal?: string | undefined;
}

/** A write the Gmail guard refused because the outbound privacy check stopped it, or could not judge it. Nothing was sent. */
export class GmailWriteRefusedError extends Error {}

/**
 * The production capability over one home: the policy read afresh on every write.
 *
 * @param home the state home the verb resolved
 * @returns the capability the guarded Gmail transport requires
 */
export function gmailWritePrivacy({ home }: { home: string }): GmailWritePrivacy {
  return { resolve: () => Promise.resolve(loadWritePrivacyPolicy({ home })), review: privateTermReviewPort({ home }) };
}

/**
 * Judge one write and throw before it is sent when the privacy check refuses it.
 *
 * @param request the write as `./writePrivacyPayload.ts` reads it
 * @param privacy the transport's capability
 * @returns nothing; resolves when the write may be sent
 * @throws GmailWriteRefusedError when the policy did not load, the request could not be judged, or a leaf carries a
 *   finding
 */
async function refuseGmailWriteOnPrivacy({
  request,
  privacy,
}: {
  request: GmailWriteRequest;
  privacy: GmailWritePrivacy;
}): Promise<void> {
  const { command } = request;
  const policy = await privacy.resolve();
  if (policy.isErr()) {
    // The terms did not load, so there are none to withhold a line for; the load refusal names no term.
    throw new GmailWriteRefusedError(writePrivacyRefusal({ command, reasons: [policy.error], terms: [] }));
  }
  const terms = policy.value.privateTerms;
  if (request.leaves.isErr()) {
    throw new GmailWriteRefusedError(writePrivacyRefusal({ command, reasons: [request.leaves.error.message], terms }));
  }
  const findings = gmailWriteFindings({ leaves: request.leaves.value, policy: policy.value });
  const refusal = privateTermWriteRefusal({
    findings,
    policy: policy.value,
    privacyDestination: GMAIL_STRICT_DESTINATION,
    review: privacy.review,
    write: {
      command,
      contents: request.leaves.value,
      destination: "the owner's Gmail mailbox, and any recipient the message names",
      family: "gmail",
      request: { payload: request.payload, principal: privacy.principal },
    },
  });
  if (refusal !== undefined) {
    throw new GmailWriteRefusedError(refusal);
  }
}

/**
 * Both pre-wire refusals over one write, dead host first, then privacy.
 *
 * @param request the write as `./writePrivacyPayload.ts` reads it
 * @param privacy the transport's capability
 * @returns nothing; resolves when the write may be sent
 * @throws InvalidDatadogHostRefusedError when the payload carries a dead Datadog console host
 * @throws GmailWriteRefusedError when the privacy check refuses it
 */
export async function refuseGmailWrite({
  request,
  privacy,
}: {
  request: GmailWriteRequest;
  privacy: GmailWritePrivacy;
}): Promise<void> {
  refuseInvalidDatadogHost({
    command: request.command,
    hatchIsOpen: invalidDatadogHostHatchOpen,
    payload: request.payload,
  });
  await refuseGmailWriteOnPrivacy({ privacy, request });
}
