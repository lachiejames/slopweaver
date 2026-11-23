/**
 * The outbound privacy check at the Slack write TRANSPORT: every write either Slack write client sends
 * (`../../corpus/slack/guardedWebClient.ts`, the retrying client and the at-most-once posting client alike) is judged
 * by `../privacyCheck.ts` before the SDK sends anything — a message, a block, a canvas, a channel name or topic, a
 * status, an assistant thread title, an upload's name, comment and text-like bytes. What counts as a write and
 * what is judged: `./writePrivacyPayload.ts`.
 *
 * ## The policy comes from an explicit home, on every write
 *
 * A {@link SlackWritePrivacy} is built from the state home the verb already resolved and is a REQUIRED input to
 * every Slack write client, so the compiler names each construction site and none reads an ambient home. The policy
 * (`../writePrivacyPolicy.ts`) is read afresh on every write and never cached, so a terms file deleted between two
 * writes refuses the second; a read never touches it.
 *
 * ## A hold, and definitely unsent
 *
 * The refusal is a throw carrying `refusedBeforeWire`, which `./sendFailure.ts` reads to release a send reservation
 * rather than leave it ambiguous, exactly as the repeat and high-stakes guards do. `safeProviderCall` re-throws the
 * original error, so the marker and the message survive to the verb. There is no override and no hatch: every
 * finding names a rewording that is always possible.
 */
import { ok, type Result } from "../../lib/result.js";
import type { PrivacyPolicy } from "../privacyCheck.js";
import {
  type PrivateTermReviewPort,
  privateTermReviewPort,
  privateTermWriteRefusal,
} from "../privateTermReview/gate.js";
import { writePrivacyRefusal } from "../writePrivacyLeaves.js";
import { loadWritePrivacyPolicy } from "../writePrivacyPolicy.js";
import {
  isSlackRead,
  SLACK_WORKSPACE_DESTINATION,
  slackUploadLeaves,
  slackWriteFindings,
  slackWriteLeaves,
} from "./writePrivacyPayload.js";

/** The privacy capability every Slack write client requires: the policy one write is judged under. */
export interface SlackWritePrivacy {
  readonly resolve: () => Promise<Result<PrivacyPolicy, string>>;
  /** Holds a write a meant private term matched for a review in context; absent, such a match refuses outright. */
  readonly review?: PrivateTermReviewPort | undefined;
}

/**
 * A write the Slack transport refused because the outbound privacy check stopped it. Nothing was sent, which
 * `refusedBeforeWire` tells a send reservation.
 */
export class SlackPrivacyRefusedError extends Error {
  readonly refusedBeforeWire = true;
}

/**
 * The production capability over one home: the policy read afresh on every write.
 *
 * @param home the state home the verb resolved
 * @returns the capability a Slack write client requires
 */
export function slackWritePrivacy({ home }: { home: string }): SlackWritePrivacy {
  return { resolve: () => Promise.resolve(loadWritePrivacyPolicy({ home })), review: privateTermReviewPort({ home }) };
}

/**
 * Judge one Slack call and throw before it is sent when the privacy check refuses it. A read returns at once and
 * never loads the policy.
 *
 * @param method the Web API method, or `files.uploadV2` for a whole upload judged before its first request
 * @param args the call's arguments; for an upload, every file already read into bytes
 * @param privacy the client's capability
 * @param principal an opaque digest of the token the client writes as, which a held write's key covers: a
 *   channel id names a conversation only within one workspace
 * @returns nothing; resolves when the call may be sent
 * @throws SlackPrivacyRefusedError when the policy did not load, a text-like upload could not be read, or a leaf
 *   carries a finding
 */
export async function refuseSlackWriteOnPrivacy({
  method,
  args,
  privacy,
  principal,
}: {
  method: string;
  args: unknown;
  privacy: SlackWritePrivacy;
  principal: string;
}): Promise<void> {
  if (isSlackRead({ method })) {
    return;
  }
  const command = `slack ${method}`;
  const policy = await privacy.resolve();
  if (policy.isErr()) {
    // The terms did not load, so there are none to withhold a line for; the load refusal names no term.
    throw new SlackPrivacyRefusedError(writePrivacyRefusal({ command, reasons: [policy.error], terms: [] }));
  }
  const terms = policy.value.privateTerms;
  const uploads = method === "files.uploadV2" ? slackUploadLeaves({ args }) : ok({ leaves: [], unreadBinaries: 0 });
  if (uploads.isErr()) {
    throw new SlackPrivacyRefusedError(writePrivacyRefusal({ command, reasons: [uploads.error], terms }));
  }
  const leaves = [...slackWriteLeaves({ args, method }), ...uploads.value.leaves];
  const findings = slackWriteFindings({ leaves, policy: policy.value });
  const refusal = privateTermWriteRefusal({
    findings,
    policy: policy.value,
    privacyDestination: SLACK_WORKSPACE_DESTINATION,
    review: privacy.review,
    // The whole call, `channel_id` and `thread_ts` included (the leaves skip those structural fields), and the
    // token's digest, so the same channel id in another workspace is another hold.
    write: {
      command,
      contents: leaves,
      destination: slackDestination({ args }),
      family: "slack",
      request: { args, method, principal },
    },
  });
  if (refusal !== undefined) {
    throw new SlackPrivacyRefusedError(refusal);
  }
}

/** Where a Slack call goes, in words a reviewer reads: the conversation it names, else the workspace. */
function slackDestination({ args }: { args: unknown }): string {
  const channel: unknown = typeof args === "object" && args !== null ? Reflect.get(args, "channel") : undefined;
  if (typeof channel === "string") {
    return `the Slack conversation ${channel}, in the installation's own workspace`;
  }
  return "the installation's own Slack workspace";
}
