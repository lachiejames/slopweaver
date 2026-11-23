/**
 * The outbound privacy check at the Linear write TRANSPORT: every mutation `sendGraphql`
 * (`../../corpus/linear/writeGraphql.ts`) sends is judged by `../privacyCheck.ts` before a rate slot is taken or a
 * byte leaves, and an asset upload is judged before its slot is reserved and again before its PUT. What counts as a
 * write and what is judged: `./writePrivacyPayload.ts`.
 *
 * ## The policy comes from an explicit home, on every write
 *
 * A {@link LinearWritePrivacy} is built from the state home the verb already resolved and is a REQUIRED input to
 * every Linear write factory, so the compiler names each construction site and none reads an ambient home. The
 * policy (`../writePrivacyPolicy.ts`) is read afresh on every write and never cached, so a terms file deleted
 * between two writes refuses the second; a query never touches it.
 *
 * ## A hold, and definitely unsent
 *
 * The GraphQL refusal is a throw carrying `refusedBeforeWire`. `safeProviderCall` maps it into an `IngestError`
 * whose `cause` is this error, so `./sendFailure.ts` reads the marker through that chain and the verb releases the
 * reservation it took rather than leaving it unconfirmed. There is no override and no hatch: every finding names a
 * rewording that is always possible.
 */
import { err, ok, type Result } from "../../lib/result.js";
import type { PrivacyPolicy } from "../privacyCheck.js";
import {
  type PrivateTermReviewPort,
  privateTermReviewPort,
  privateTermWriteRefusal,
} from "../privateTermReview/gate.js";
import { writePrivacyRefusal } from "../writePrivacyLeaves.js";
import { loadWritePrivacyPolicy } from "../writePrivacyPolicy.js";
import {
  LINEAR_WORKSPACE_DESTINATION,
  type LinearWriteLeaf,
  linearGraphqlLeaves,
  linearUploadLeaves,
  linearWriteFindings,
} from "./writePrivacyPayload.js";

/** The privacy capability every Linear write factory requires: the policy one write is judged under. */
export interface LinearWritePrivacy {
  readonly resolve: () => Promise<Result<PrivacyPolicy, string>>;
  /** Holds a mutation a meant private term matched for a review in context; absent, such a match refuses outright. */
  readonly review?: PrivateTermReviewPort | undefined;
}

/**
 * A mutation the Linear transport refused because the outbound privacy check stopped it. Nothing was sent, which
 * `refusedBeforeWire` tells the verb that reserved an id for it.
 */
export class LinearPrivacyRefusedError extends Error {
  readonly refusedBeforeWire = true;
}

/**
 * The production capability over one home: the policy read afresh on every write.
 *
 * @param home the state home the verb resolved
 * @returns the capability every Linear write factory requires
 */
export function linearWritePrivacy({ home }: { home: string }): LinearWritePrivacy {
  return { resolve: () => Promise.resolve(loadWritePrivacyPolicy({ home })), review: privateTermReviewPort({ home }) };
}

/**
 * The capability for a client built only to READ, with no home in reach: a query never consults it, and any
 * mutation sent through it is refused before the wire because no policy resolves.
 */
export const READ_ONLY_LINEAR_PRIVACY: LinearWritePrivacy = {
  resolve: () => Promise.resolve(err("this Linear client was built to read, so it sends no write")),
};

/**
 * The refusal one write is stopped with, or undefined when it may be sent. Loads the policy only when there is
 * something to judge.
 *
 * @param command the operation a refusal names first, `linear linear.issueCreate`
 * @param leaves what the write would send, or the refusal for an upload that could not be read
 * @param privacy the capability the policy comes from
 * @returns the refusal text, or undefined
 */
async function refusalFor({
  command,
  leaves,
  privacy,
  review,
  request,
}: {
  command: string;
  leaves: Result<readonly LinearWriteLeaf[], string>;
  privacy: LinearWritePrivacy;
  /** The port a meant match is held through; undefined refuses one outright. */
  review: PrivateTermReviewPort | undefined;
  /** The whole operation as sent, the ids it targets included, which a held write's key covers. */
  request: unknown;
}): Promise<string | undefined> {
  if (leaves.isOk() && leaves.value.length === 0) {
    return undefined;
  }
  const policy = await privacy.resolve();
  if (policy.isErr()) {
    // The terms did not load, so there are none to withhold a line for; the load refusal names no term.
    return writePrivacyRefusal({ command, reasons: [policy.error], terms: [] });
  }
  const terms = policy.value.privateTerms;
  if (leaves.isErr()) {
    return writePrivacyRefusal({ command, reasons: [leaves.error], terms });
  }
  const findings = linearWriteFindings({ leaves: leaves.value, policy: policy.value });
  return privateTermWriteRefusal({
    findings,
    policy: policy.value,
    privacyDestination: LINEAR_WORKSPACE_DESTINATION,
    review,
    write: {
      command,
      contents: leaves.value,
      destination: "the installation's own Linear workspace",
      family: "linear",
      request,
    },
  });
}

/**
 * Judge one GraphQL operation and throw before it is sent when the privacy check refuses it. A query returns at
 * once and never loads the policy.
 *
 * @param operation the door's label for the operation, `linear.issueCreate`
 * @param query the GraphQL document as sent
 * @param variables the operation's variables as sent
 * @param privacy the send context's capability
 * @returns nothing; resolves when the operation may be sent
 * @throws LinearPrivacyRefusedError when the policy did not load or a leaf carries a finding
 */
export async function refuseLinearWriteOnPrivacy({
  operation,
  query,
  variables,
  privacy,
}: {
  operation: string;
  query: string;
  variables: Readonly<Record<string, unknown>>;
  privacy: LinearWritePrivacy;
}): Promise<void> {
  const refusal = await refusalFor({
    command: `linear ${operation}`,
    leaves: ok(linearGraphqlLeaves({ operation, query, variables })),
    privacy,
    request: { operation, query, variables },
    review: privacy.review,
  });
  if (refusal !== undefined) {
    throw new LinearPrivacyRefusedError(refusal);
  }
}

/**
 * The refusal an asset upload is stopped with before its slot is reserved, or before its PUT, or undefined when
 * its name and text-like bytes may be sent.
 *
 * @param fileName the name the file is uploaded under
 * @param bytes the file's contents
 * @param privacy the verb's capability
 * @returns the refusal text, or undefined
 */
export async function linearUploadPrivacyRefusal({
  fileName,
  bytes,
  privacy,
}: {
  fileName: string;
  bytes: Uint8Array;
  privacy: LinearWritePrivacy;
}): Promise<string | undefined> {
  // An upload is judged twice, before its slot and before its PUT, so a receipt spent on the first would hold the
  // second: a meant match in an upload refuses outright instead, and the review covers the mutations.
  return refusalFor({
    command: "linear attach upload",
    leaves: linearUploadLeaves({ bytes, fileName }),
    privacy,
    request: { bytes, fileName },
    review: undefined,
  });
}
