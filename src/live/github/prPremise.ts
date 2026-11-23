/**
 * The cheapest live read that can tell whether a briefing card's premise still holds: one pull request's
 * `state` and its merge-queue entry, nothing else.
 *
 * ## Why a fourth pull-request read rather than one of the three that exist
 *
 * `./read.ts`'s `readGithubObject` pulls every comment, review and review thread; `./mergeQueue.ts`'s `pr`
 * read pulls a hundred rollup contexts. A briefing page carries one card per open pull request of the owner's —
 * MEASURED, 36 of them on the work repository — and the gate that runs before it publishes needs
 * exactly two fields per card. Reusing either of those reads would pay for a page of provider payload per
 * card to answer a question two scalars settle.
 *
 * ## One call, aliased, rather than one call per card
 *
 * Every address is asked for in the same document under its own `p<i>` alias, so thirty-six cards cost one
 * round trip instead of thirty-six. Owner and repo travel as VARIABLES rather than being interpolated into
 * the query text: a repository slug reaches this module from a rendered page's own markup, and a query
 * assembled by string concatenation over that is an injection seam. Only the alias itself is generated, and
 * it is `p` plus the index.
 *
 * ## A missing answer is an absent key, never a default
 *
 * An address GitHub answers `null` for — a repository the credential cannot see, a number that does not
 * exist — is simply not in the returned map. The gate reading it treats an unknown premise as unverified and
 * says so, which is the opposite of what a coalesced `"OPEN"` would do: invent a fresh premise out of a read
 * that never happened.
 */

import { isRecord } from "../../lib/parsers.js";
import { err, ok, type Result } from "../../lib/result.js";
import { type GithubLiveError, GithubLiveErrors } from "./errors.js";
import type { GithubReadGraphql } from "./read.js";

/** One pull request a briefing card names, addressed the way GitHub addresses it. */
export interface PrAddress {
  readonly owner: string;
  readonly repo: string;
  readonly number: number;
}

/** One pull request's place in a merge queue, when GitHub reports it has one. */
interface PrQueueEntry {
  /** GitHub's own entry state: `QUEUED`, `AWAITING_CHECKS`, `MERGEABLE`, `UNMERGEABLE` or `LOCKED`. */
  readonly state: string;
  /** Its place in the queue, 1-based, as GitHub numbers it. */
  readonly position: number;
}

/** Everything the freshness gate judges about one pull request, read live. */
export interface PrPremise {
  /** `owner/repo#number`, the key the gate looks it up by. */
  readonly identity: string;
  /** GitHub's own `OPEN`, `CLOSED` or `MERGED`. */
  readonly state: string;
  /** Its merge-queue entry, or `undefined` when it is not queued. */
  readonly queue: PrQueueEntry | undefined;
}

/**
 * How many addresses travel in one document.
 *
 * GitHub's GraphQL API scores a query's complexity before running it, and a batch is the one thing here that
 * grows without bound — a page may carry fifty cards. Twenty-five keeps a single document small enough to
 * stay well inside that score while still turning the measured 36-card sweep into two round trips.
 */
const BATCH_SIZE = 25;

/** `https://github.com/<owner>/<repo>/pull/<number>`, the only pull-request link shape a rendered page carries. */
const PULL_REQUEST_URL = /^https:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/pull\/(\d{1,7})(?:[/?#].*)?$/;

/**
 * The `owner/repo#number` key one address is looked up by.
 *
 * @param address the pull request
 * @returns the identity string, the same spelling GitHub itself uses
 */
export function prIdentity({ address }: { address: PrAddress }): string {
  return `${address.owner}/${address.repo}#${String(address.number)}`;
}

/**
 * Read a pull-request URL as an address.
 *
 * @param url the href a page carries
 * @returns the address, or `undefined` when the link is not a pull request at all
 */
export function prAddressOfUrl({ url }: { url: string }): PrAddress | undefined {
  const match = PULL_REQUEST_URL.exec(url.trim());
  if (match === null) {
    return undefined;
  }
  const [, owner, repo, number] = match;
  if (owner === undefined || repo === undefined || number === undefined) {
    return undefined;
  }
  return { number: Number.parseInt(number, 10), owner, repo };
}

/**
 * Build the aliased document that asks for every address at once.
 *
 * @param addresses the pull requests to ask about, at most {@link BATCH_SIZE} of them
 * @returns the query text and the variables it reads owner, repo and number from
 *
 * @internal — exported so a test asserts the generated document rather than the transport.
 */
export function prPremiseQuery({ addresses }: { addresses: readonly PrAddress[] }): {
  readonly query: string;
  readonly variables: Readonly<Record<string, unknown>>;
} {
  return aliasedPrQuery({
    addresses,
    name: "SlopweaverBriefingPrPremise",
    selection: "number state mergeQueueEntry { state position }",
  });
}

/**
 * The aliased document asking one selection of every address's pull request: each under its own `p<i>` alias, owner,
 * repo and number travelling as variables — the shape every batched pull-request read here shares.
 *
 * @param addresses the pull requests, at most {@link BATCH_SIZE} of them
 * @param name the operation name GitHub logs the query under
 * @param selection the pull-request fields to ask for, a constant of the caller's — never data
 * @returns the query text and its variables
 */
export function aliasedPrQuery({
  addresses,
  name,
  selection,
}: {
  addresses: readonly PrAddress[];
  name: string;
  selection: string;
}): { readonly query: string; readonly variables: Readonly<Record<string, unknown>> } {
  const params: string[] = [];
  const selections: string[] = [];
  const variables: Record<string, unknown> = {};
  addresses.forEach((address, index) => {
    const i = String(index);
    params.push(`$o${i}: String!, $r${i}: String!, $n${i}: Int!`);
    selections.push(
      `  p${i}: repository(owner: $o${i}, name: $r${i}) {\n` +
        `    pullRequest(number: $n${i}) { ${selection} }\n` +
        `  }`,
    );
    variables[`o${i}`] = address.owner;
    variables[`r${i}`] = address.repo;
    variables[`n${i}`] = address.number;
  });
  return {
    query: `query ${name}(${params.join(", ")}) {\n${selections.join("\n")}\n}`,
    variables,
  };
}

/** The queue entry on one pull-request node, or `undefined` when GitHub reports none. */
function queueEntryOf({ pullRequest }: { pullRequest: Record<string, unknown> }): PrQueueEntry | undefined {
  const entry = pullRequest["mergeQueueEntry"];
  if (!isRecord(entry)) {
    return undefined;
  }
  const state = entry["state"];
  const position = entry["position"];
  return {
    position: typeof position === "number" ? position : 0,
    state: typeof state === "string" ? state : "UNKNOWN",
  };
}

/**
 * Shape one aliased response into premises, keyed by identity.
 *
 * @param data the raw GraphQL response
 * @param addresses the addresses the document asked for, in the order their aliases were generated
 * @returns one entry per address GitHub actually answered for; an unanswered address is simply absent
 *
 * @internal — exported so a test drives the parse without a transport.
 */
export function parsePrPremises({
  data,
  addresses,
}: {
  data: unknown;
  addresses: readonly PrAddress[];
}): ReadonlyMap<string, PrPremise> {
  const premises = new Map<string, PrPremise>();
  if (!isRecord(data)) {
    return premises;
  }
  addresses.forEach((address, index) => {
    const repository = data[`p${String(index)}`];
    const pullRequest = isRecord(repository) ? repository["pullRequest"] : undefined;
    if (!isRecord(pullRequest) || typeof pullRequest["state"] !== "string") {
      return;
    }
    const identity = prIdentity({ address });
    premises.set(identity, { identity, queue: queueEntryOf({ pullRequest }), state: pullRequest["state"] });
  });
  return premises;
}

/**
 * The addresses deduplicated by identity, then split into documents of at most {@link BATCH_SIZE} — so a page linking
 * one pull request from two cards asks about it once.
 *
 * @param addresses every address a caller named, repeats allowed
 * @returns the batches, in first-seen order
 */
export function prBatches({ addresses }: { addresses: readonly PrAddress[] }): readonly (readonly PrAddress[])[] {
  const unique = new Map<string, PrAddress>();
  for (const address of addresses) {
    unique.set(prIdentity({ address }), address);
  }
  const all = [...unique.values()];
  const batches: (readonly PrAddress[])[] = [];
  for (let start = 0; start < all.length; start += BATCH_SIZE) {
    batches.push(all.slice(start, start + BATCH_SIZE));
  }
  return batches;
}

/**
 * Build the production read over one GraphQL transport.
 *
 * Duplicate addresses are collapsed before anything is sent — a page linking the same pull request from two
 * cards asks about it once.
 *
 * @param graphql the injected transport
 * @returns a read taking every address a page named and answering with what GitHub said about each
 */
export function makeReadPrPremises({
  graphql,
}: {
  graphql: GithubReadGraphql;
}): (args: { addresses: readonly PrAddress[] }) => Promise<Result<ReadonlyMap<string, PrPremise>, GithubLiveError>> {
  return async ({ addresses }) => {
    const premises = new Map<string, PrPremise>();
    for (const batch of prBatches({ addresses })) {
      const answered = await graphql(prPremiseQuery({ addresses: batch }));
      if (answered.isErr()) {
        return err(answered.error);
      }
      for (const [identity, premise] of parsePrPremises({ addresses: batch, data: answered.value })) {
        premises.set(identity, premise);
      }
    }
    return ok(premises);
  };
}

/**
 * The refusal a caller reports when it has no credential to read with at all.
 *
 * @returns the typed read failure, worded for an operator rather than for a log
 */
export function noGithubCredential(): GithubLiveError {
  return GithubLiveErrors.readFailed({
    message: "no GitHub credential is configured, so no pull request's live state could be read",
  });
}
