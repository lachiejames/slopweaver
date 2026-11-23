/**
 * The outbound privacy check at the GitHub write TRANSPORT: every write the door sends through the one write
 * Octokit (`../../corpus/github/writeCtx.ts`) is judged by `../privacyCheck.ts` before `fetch` runs — a comment, a
 * label, a review reply, a repository description, a ref, a merge, every REST write and every GraphQL mutation —
 * not only the four families whose own gates already scan (PR forms, commit messages, self-review, attachments).
 *
 * ## The policy comes from an explicit home
 *
 * A {@link GithubWritePrivacy} is built from the state home the verb already resolved (`--home` included) and is a
 * REQUIRED input to every write client, so the compiler names each construction site and none reads an ambient
 * home. It loads on each request that is a write: a read never touches the policy files, so a read still runs with
 * no private-terms file at all.
 *
 * ## Fail-closed
 *
 * The private-terms file is fail-closed (`../../hygiene/privateTerms.ts`): absent, unreadable, readable by others
 * or malformed, it refuses EVERY write. An unreadable denylist refuses too; an absent one is normal.
 *
 * ## The same rules, not the author's
 *
 * `checkPrivacy` only. First person and host wording are a pull request author's rules
 * (`../publicationScan.ts`) and stay at those gates: a review reply saying "I think" is ordinary collaboration.
 *
 * ## What it does not cover
 *
 * `git push` is a git transport, not this client: commit messages are judged by the push gate. An attachment
 * upload rides its own client (`./attachClient.ts`) and is judged by the attachment scan. A request mutated after
 * the hook, or an object whose accessors answer differently on a second read, is the in-process adversary the
 * dead-host module names too; callers pass plain data.
 */
import { err, ok, type Result } from "../../lib/result.js";
import type { PrivacyDestination, PrivacyPolicy } from "../privacyCheck.js";
import {
  type PrivateTermReviewPort,
  privateTermReviewPort,
  privateTermWriteRefusal,
} from "../privateTermReview/gate.js";
import { writePrivacyRefusal } from "../writePrivacyLeaves.js";
import { loadWritePrivacyPolicy } from "../writePrivacyPolicy.js";
import { readInstallationIdentifiers } from "./installationIdentifiersRead.js";
import {
  githubWriteFindings,
  githubWriteLeaves,
  githubWriteOperation,
  githubWriteTarget,
} from "./writePrivacyPayload.js";

/** The policy and destination one write is judged under, or the sentence it is refused with. */
type GithubWritePrivacyResolution = Result<
  { readonly destination: PrivacyDestination; readonly policy: PrivacyPolicy },
  string
>;

/**
 * The privacy capability every GitHub write client requires: resolve the policy and the destination facts for one
 * write's target repository.
 */
export interface GithubWritePrivacy {
  readonly resolve: (input: { readonly ownRepository: string | undefined }) => Promise<GithubWritePrivacyResolution>;
  /** Holds a write a meant private term matched for a review in context; absent, such a match refuses outright. */
  readonly review?: PrivateTermReviewPort | undefined;
}

/**
 * A write a transport refused because the outbound privacy check stopped it. A throw rather than a `Result`,
 * matching the dead-host refusal beside it: the write Octokit's hook runs inside the caller's `safeProviderCall`,
 * which turns this into the verb's ordinary write failure with the message intact.
 */
export class GithubPrivacyRefusedError extends Error {}

/**
 * The production capability over one home. The home-wide policy (`../writePrivacyPolicy.ts`) is read afresh on
 * EVERY write, never cached: a terms file deleted or broken between two writes of one client must refuse the
 * second, and the read is two small files. The installation identifiers are read per target, and an input that
 * cannot be read forgives nothing.
 *
 * @param home the state home the verb resolved
 * @returns the capability a write client requires
 */
export function githubWritePrivacy({ home }: { home: string }): GithubWritePrivacy {
  return {
    resolve: async ({ ownRepository }) => {
      const policy = loadWritePrivacyPolicy({ home });
      if (policy.isErr()) {
        return err(policy.error);
      }
      const identifiers =
        ownRepository === undefined
          ? undefined
          : (await readInstallationIdentifiers({ home, targetRepository: ownRepository })).identifiers;
      const destination = {
        identifierAudience: "strict" as const,
        installationIdentifiers: identifiers,
        ownRepository,
      };
      return ok({ destination, policy: policy.value });
    },
    review: privateTermReviewPort({ home }),
  };
}

/**
 * Judge one write payload and throw before it is sent when the privacy check refuses it.
 *
 * @param payload the write payload (`githubWritePayload`'s answer; a read never reaches here)
 * @param privacy the client's capability
 * @returns nothing; resolves when the write may be sent
 * @throws GithubPrivacyRefusedError when the policy did not load or a leaf carries a finding
 */
export async function refuseGithubWriteOnPrivacy({
  payload,
  privacy,
}: {
  payload: unknown;
  privacy: GithubWritePrivacy;
}): Promise<void> {
  const command = githubWriteOperation({ payload });
  const resolved = await privacy.resolve({ ownRepository: githubWriteTarget({ payload }) });
  if (resolved.isErr()) {
    // The terms did not load, so there are none to withhold a line for; the load refusal names no term.
    throw new GithubPrivacyRefusedError(writePrivacyRefusal({ command, reasons: [resolved.error], terms: [] }));
  }
  const findings = githubWriteFindings({ payload, ...resolved.value });
  const target = githubWriteTarget({ payload });
  const refusal = privateTermWriteRefusal({
    findings,
    policy: resolved.value.policy,
    privacyDestination: resolved.value.destination,
    review: privacy.review,
    write: {
      command,
      contents: githubWriteLeaves({ payload }),
      destination: target === undefined ? "a GitHub object addressed by node id" : `the GitHub repository ${target}`,
      family: "github",
      request: requestOf({ payload }),
    },
  });
  if (refusal !== undefined) {
    throw new GithubPrivacyRefusedError(refusal);
  }
}

/**
 * What a held write's key covers: the method, the route, every path parameter and body field. The headers are
 * left out, because they carry the transport (an agent string, a token the client may rotate) and never content.
 */
function requestOf({ payload }: { payload: unknown }): unknown {
  if (typeof payload !== "object" || payload === null) {
    return payload;
  }
  return Object.fromEntries(Object.entries(payload).filter(([key]) => key !== "headers"));
}
