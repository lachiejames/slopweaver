/**
 * The live read behind a proof gap: each pull request's markdown `body`, nothing else, so a card about a pull request
 * the owner asked for proof on can say whether the body carries it NOW (`../../handover/proofAsk.ts`).
 *
 * The same aliased, batched document as `./prPremise.ts`, for the same reasons its header gives — one round trip per
 * twenty-five pull requests, owner and repo as variables, an unanswered address an absent key rather than an empty
 * body. That last one is the load-bearing half here: an empty string reads as "carries no proof", which is an
 * accusation, while an absent key reads as "not read", which is not.
 *
 * Only `body`, never `bodyHTML`: the markdown is what a seat writes and what the proof shapes match. An image GitHub
 * rewrites only in rendered HTML is stated residue.
 */

import { isRecord } from "../../lib/parsers.js";
import { err, ok, type Result } from "../../lib/result.js";
import type { GithubLiveError } from "./errors.js";
import { aliasedPrQuery, type PrAddress, prBatches } from "./prPremise.js";
import type { GithubReadGraphql } from "./read.js";

/** The read a caller injects: every address in, each answered pull request's body out, keyed by lowercased identity. */
export type ReadPrBodies = (args: {
  addresses: readonly PrAddress[];
}) => Promise<Result<ReadonlyMap<string, string>, GithubLiveError>>;

/**
 * The key a body is looked up by: `owner/repo#number`, lowercased — the board's spelling, so a card's identity and
 * the answer meet whatever case a seat wrote the link in.
 *
 * @param address the pull request
 * @returns the lowercased identity
 */
export function prBodyKey({ address }: { address: PrAddress }): string {
  return `${address.owner}/${address.repo}#${String(address.number)}`.toLowerCase();
}

/**
 * Read a lowercased `owner/repo#number` back as an address.
 *
 * @param identity the identity a board row published
 * @returns the address, or `undefined` when the string is not one
 */
export function prAddressOfIdentity({ identity }: { identity: string }): PrAddress | undefined {
  const match = /^([^/\s#]{1,100})\/([^/\s#]{1,100})#(\d{1,12})$/u.exec(identity);
  if (match === null) {
    return undefined;
  }
  return { number: Number(match[3]), owner: match[1]!, repo: match[2]! };
}

/**
 * The aliased document asking for every address's body.
 *
 * @param addresses at most one batch of pull requests
 * @returns the query text and its variables
 *
 * @internal — exported so a test asserts the generated document rather than the transport.
 */
export function prBodyQuery({ addresses }: { addresses: readonly PrAddress[] }): {
  readonly query: string;
  readonly variables: Readonly<Record<string, unknown>>;
} {
  return aliasedPrQuery({ addresses, name: "SlopweaverPrProofBody", selection: "number body" });
}

/**
 * Shape one aliased response into bodies, keyed by {@link prBodyKey}.
 *
 * @param data the raw GraphQL response
 * @param addresses the addresses the document asked for, in alias order
 * @returns one entry per pull request GitHub answered with a string body; any other answer is absent
 *
 * @internal — exported so a test drives the parse without a transport.
 */
export function parsePrBodies({
  data,
  addresses,
}: {
  data: unknown;
  addresses: readonly PrAddress[];
}): ReadonlyMap<string, string> {
  const bodies = new Map<string, string>();
  if (!isRecord(data)) {
    return bodies;
  }
  addresses.forEach((address, index) => {
    const repository = data[`p${String(index)}`];
    const pullRequest = isRecord(repository) ? repository["pullRequest"] : undefined;
    if (isRecord(pullRequest) && typeof pullRequest["body"] === "string") {
      bodies.set(prBodyKey({ address }), pullRequest["body"]);
    }
  });
  return bodies;
}

/**
 * GitHub's wording when one aliased `pullRequest(number:)` names nothing. It fails the WHOLE document while the
 * other aliases answered, so a single deleted or mistyped pull request on the board once made every verdict
 * `body-unread` — measured against an `acme/acme-admin` pull request:
 * `slopweaver handover currency --json | jq .sources.github`.
 */
const UNRESOLVED_PULL_REQUEST = "Could not resolve to a PullRequest";

/** The first line octokit writes for a GraphQL response that carried errors. */
const AGGREGATE_HEADER = "Request failed due to following response errors:";

/** One listed error that is exactly an unresolved number and nothing else beside it on the line. */
const UNRESOLVED_BULLET = new RegExp(`^ - ${UNRESOLVED_PULL_REQUEST} with the number of (\\d{1,12})\\.$`, "u");

/**
 * Whether a failed read failed ONLY because numbers this batch asked for resolved to nothing: a plain read failure
 * whose every listed GraphQL error is {@link UNRESOLVED_PULL_REQUEST} naming one of the batch's own numbers. A rate
 * limit, an aggregate carrying any other error beside one, or one naming a number nobody asked for, is the
 * whole read's failure.
 *
 * @param error the failed read
 * @param batch the addresses the failed document asked for
 * @returns true when nothing but this batch's unresolvable numbers failed it
 */
function onlyUnresolved({ error, batch }: { error: GithubLiveError; batch: readonly PrAddress[] }): boolean {
  if (error.code !== "READ_FAILED") {
    return false;
  }
  // The WHOLE message, byte for byte as octokit writes it: its header, then nothing but unresolved bullets. Any other
  // line, a blank one included, any other text on a bullet, or any whitespace octokit does not
  // write, is a failure this read does not understand — and so is a number the batch never asked for.
  // The number is compared as octokit spells it, never normalised: "0001" is not what it writes for 1.
  const asked = new Set(batch.map((address) => String(address.number)));
  const [header, ...listed] = error.message.split("\n");
  return (
    header === AGGREGATE_HEADER &&
    listed.length > 0 &&
    listed.every((line) => {
      const number = UNRESOLVED_BULLET.exec(line)?.[1];
      return number !== undefined && asked.has(number);
    })
  );
}

/**
 * One batch's bodies. A batch GitHub refuses because one of its numbers resolves to nothing is read again one
 * address at a time, and that address is left absent — "GitHub returned no pull request at that address" — while
 * every other keeps its body. Any other failure, a rate limit included, is the whole read's.
 *
 * @param graphql the injected transport
 * @param batch at most one batch of pull requests
 * @returns the batch's bodies, or the failure that is not one unresolvable number
 */
async function readBatch({
  graphql,
  batch,
}: {
  graphql: GithubReadGraphql;
  batch: readonly PrAddress[];
}): Promise<Result<ReadonlyMap<string, string>, GithubLiveError>> {
  const answered = await graphql(prBodyQuery({ addresses: batch }));
  if (answered.isOk()) {
    return ok(parsePrBodies({ addresses: batch, data: answered.value }));
  }
  if (!onlyUnresolved({ batch, error: answered.error })) {
    return err(answered.error);
  }
  if (batch.length === 1) {
    return ok(new Map());
  }
  const bodies = new Map<string, string>();
  for (const address of batch) {
    const alone = await readBatch({ batch: [address], graphql });
    if (alone.isErr()) {
      return err(alone.error);
    }
    for (const [key, body] of alone.value) {
      bodies.set(key, body);
    }
  }
  return ok(bodies);
}

/**
 * Build the production read over one GraphQL transport. An empty address list sends nothing.
 *
 * @param graphql the injected transport
 * @returns the read
 */
export function makeReadPrBodies({ graphql }: { graphql: GithubReadGraphql }): ReadPrBodies {
  return async ({ addresses }) => {
    const bodies = new Map<string, string>();
    for (const batch of prBatches({ addresses })) {
      const answered = await readBatch({ batch, graphql });
      if (answered.isErr()) {
        return err(answered.error);
      }
      for (const [key, body] of answered.value) {
        bodies.set(key, body);
      }
    }
    return ok(bodies);
  };
}
