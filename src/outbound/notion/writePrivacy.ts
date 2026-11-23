/**
 * The outbound privacy check at the Notion write TRANSPORT: every write the ONE Notion write-lane client sends
 * (`../../corpus/notion/writeApi.ts`'s seam, whose `fetch` is `../../corpus/notion/guardedFetch.ts`) is judged by
 * `../privacyCheck.ts` after the SDK has serialised it and before the network `fetch` runs — a page's markdown,
 * title and icon, a block's caption, an upload's name, type and text-like bytes, and any write added later. An
 * upload is also judged whole before its slot is reserved. What counts as a write and what is judged:
 * `./writePrivacyPayload.ts`.
 *
 * ## Two refusals, in a fixed order
 *
 * {@link refuseNotionWrite} runs the dead-Datadog-host refusal (`../invalidDatadogHost.ts`) first and this check
 * second, exactly as the GitHub, Slack and Linear transports order them, and only then may the request be sent.
 *
 * ## The policy comes from an explicit home, on every write
 *
 * A {@link NotionWritePrivacy} is built from the state home the verb already resolved and is a REQUIRED input to the
 * write seam, so the compiler names each construction site and none reads an ambient home. The policy
 * (`../writePrivacyPolicy.ts`) is read afresh on every write and never cached, so a terms file deleted between two
 * writes refuses the second; a read returns before it is loaded.
 *
 * ## A hold, and definitely unsent
 *
 * The refusal is a throw. The SDK re-throws a non-Notion error from its `fetch` untouched and `safeProviderCall`
 * maps it into an `IngestError` whose `cause` is this error, so `./sendFailure.ts` finds it by class and a create
 * releases the reservation it took. There is no override and no hatch: every finding names a rewording that is
 * always possible.
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
import { NOTION_WORKSPACE_DESTINATION, type NotionWriteRequest, notionWriteFindings } from "./writePrivacyPayload.js";

/** The privacy capability the Notion write seam requires: the policy one write is judged under. */
export interface NotionWritePrivacy {
  readonly resolve: () => Promise<Result<PrivacyPolicy, string>>;
  /** Holds a write a meant private term matched for a review in context; absent, such a match refuses outright. */
  readonly review?: PrivateTermReviewPort | undefined;
}

/** A write the Notion transport refused because the outbound privacy check stopped it. Nothing was sent. */
export class NotionPrivacyRefusedError extends Error {}

/**
 * The production capability over one home: the policy read afresh on every write.
 *
 * @param home the state home the verb resolved
 * @returns the capability the Notion write seam requires
 */
export function notionWritePrivacy({ home }: { home: string }): NotionWritePrivacy {
  return { resolve: () => Promise.resolve(loadWritePrivacyPolicy({ home })), review: privateTermReviewPort({ home }) };
}

/**
 * Judge one write and throw before it is sent when the privacy check refuses it.
 *
 * @param request the write as `./writePrivacyPayload.ts` reads it
 * @param privacy the seam's capability
 * @returns nothing; resolves when the write may be sent
 * @throws NotionPrivacyRefusedError when the policy did not load, the body could not be judged, or a leaf carries a
 *   finding
 */
async function refuseNotionWriteOnPrivacy({
  request,
  privacy,
}: {
  request: NotionWriteRequest;
  privacy: NotionWritePrivacy;
}): Promise<void> {
  const { command } = request;
  const policy = await privacy.resolve();
  if (policy.isErr()) {
    // The terms did not load, so there are none to withhold a line for; the load refusal names no term.
    throw new NotionPrivacyRefusedError(writePrivacyRefusal({ command, reasons: [policy.error], terms: [] }));
  }
  const terms = policy.value.privateTerms;
  if (request.leaves.isErr()) {
    throw new NotionPrivacyRefusedError(
      writePrivacyRefusal({ command, reasons: [request.leaves.error.message], terms }),
    );
  }
  const findings = notionWriteFindings({ leaves: request.leaves.value, policy: policy.value });
  // An upload is judged whole before its slot and again at each request, so a receipt spent on the first would
  // hold the next: a meant match in an upload refuses outright, and the review covers pages and blocks.
  const upload = UPLOAD_COMMAND.test(command);
  const refusal = privateTermWriteRefusal({
    findings,
    policy: policy.value,
    privacyDestination: NOTION_WORKSPACE_DESTINATION,
    review: upload ? undefined : privacy.review,
    write: {
      command,
      contents: request.leaves.value,
      destination: "the installation's own Notion workspace",
      family: "notion",
      request: request.request,
    },
  });
  if (refusal !== undefined) {
    throw new NotionPrivacyRefusedError(refusal);
  }
}

/** A command naming an upload, whole or one of its requests. */
const UPLOAD_COMMAND = /fileUploads|attach upload/u;

/**
 * Both pre-wire refusals over one write, dead host first, then privacy.
 *
 * @param request the write as `./writePrivacyPayload.ts` reads it
 * @param privacy the seam's capability
 * @returns nothing; resolves when the write may be sent
 * @throws InvalidDatadogHostRefusedError when the payload carries a dead Datadog console host
 * @throws NotionPrivacyRefusedError when the privacy check refuses it
 */
export async function refuseNotionWrite({
  request,
  privacy,
}: {
  request: NotionWriteRequest;
  privacy: NotionWritePrivacy;
}): Promise<void> {
  refuseInvalidDatadogHost({
    command: request.command,
    hatchIsOpen: invalidDatadogHostHatchOpen,
    payload: request.payload,
  });
  await refuseNotionWriteOnPrivacy({ privacy, request });
}
