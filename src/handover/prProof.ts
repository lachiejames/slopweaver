/**
 * Has a pull request the owner asked for proof on got it — the verdict `handover currency` publishes per pull request, and
 * the one sentence a card about it leads with when it has not.
 *
 * Three verdicts, and only one of them accuses: `requested-and-unmet` is published only off a body that was READ and
 * carries none of what the owner asked for. A body that could not be read is `body-unread`, worded as not checked, never as
 * missing — a card that tells the owner proof is absent off a read that never happened is the silent-failure class again,
 * pointed at a seat that may have done the work. A pull request nobody asked proof on is not published at all.
 *
 * Pure: the board's pull requests and the bodies already read, in; verdicts out. The site cannot import this tree, so
 * the sentence travels in the reading rather than being re-worded on the page.
 */

import { PROOF_KIND_WORDS, PROOF_KINDS, type ProofKind } from "./proofKinds.js";
import { proofAskOf, proofCarriedBy, proofMissing } from "./prProofAsk.js";
import type { PrOnBoard } from "./prSteers.js";

/** The ask a verdict answers: the latest quote of the owner's asking proof on the pull request, and every kind asked. */
export interface ProofAskOnPr {
  readonly rowSlug: string;
  readonly words: string;
  readonly atIso: string;
  readonly anchor: string;
  /** Every kind any of the owner's asks on this pull request named — empty when none named a kind. */
  readonly kinds: readonly ProofKind[];
}

/** A pull request's body, as the live read left it. */
export type PrBodyState =
  { readonly kind: "read"; readonly body: string } | { readonly kind: "unread"; readonly why: string };

/** What the body says about the owner's ask. */
export type PrProof =
  | { readonly kind: "requested-and-met"; readonly ask: ProofAskOnPr }
  | {
      readonly kind: "requested-and-unmet";
      readonly ask: ProofAskOnPr;
      readonly missing: readonly ProofKind[];
      /** The sentence a card about this pull request leads with. */
      readonly gap: string;
    }
  | { readonly kind: "body-unread"; readonly ask: ProofAskOnPr; readonly why: string };

/** One pull request's verdict, as the currency reading publishes it. */
export interface CurrencyPullRequest {
  readonly identity: string;
  /** Every board row naming it — the cards this verdict leads. */
  readonly rowSlugs: readonly string[];
  readonly proof: PrProof;
}

/** Where the owner's words are cut inside a gap sentence, in characters. */
const GAP_QUOTE_CHARS = 240;

/**
 * The owner's proof ask on one pull request, folded over every quote of theirs stored on a row naming it.
 *
 * @param pr the pull request, as the board names it
 * @returns the ask — the latest asking quote, every kind asked — or `undefined` when no quote asks for proof
 */
export function proofAskedOn({ pr }: { pr: PrOnBoard }): ProofAskOnPr | undefined {
  const kinds = new Set<ProofKind>();
  let latest: PrOnBoard["steers"][number] | undefined;
  for (const steer of pr.steers) {
    const asked = proofAskOf({ words: steer.quote.words });
    if (asked.kind === "none") {
      continue;
    }
    for (const kind of asked.kinds) {
      kinds.add(kind);
    }
    if (latest === undefined || steer.quote.atIso > latest.quote.atIso) {
      latest = steer;
    }
  }
  if (latest === undefined) {
    return undefined;
  }
  return {
    anchor: latest.quote.anchor,
    atIso: latest.quote.atIso,
    kinds: PROOF_KINDS.filter((kind) => kinds.has(kind)),
    rowSlug: latest.rowSlug,
    words: latest.quote.words,
  };
}

/**
 * The sentence a card leads with when the body lacks what the owner asked for.
 *
 * @param identity the pull request, `owner/repo#number`
 * @param ask the owner's ask
 * @param missing what the body lacks
 * @returns the sentence
 */
function proofGapSentence({
  identity,
  ask,
  missing,
}: {
  identity: string;
  ask: ProofAskOnPr;
  missing: readonly ProofKind[];
}): string {
  const words = ask.words.length > GAP_QUOTE_CHARS ? `${ask.words.slice(0, GAP_QUOTE_CHARS)} …` : ask.words;
  const lacking = missing.map((kind) => `no ${PROOF_KIND_WORDS[kind]}`).join(", ");
  return `You asked for proof on ${identity} on ${ask.atIso.slice(0, 10)} ("${words}") and its body still carries ${lacking}.`;
}

/**
 * The verdict on one pull request's ask, given its body.
 *
 * @param identity the pull request, `owner/repo#number`
 * @param ask the owner's ask on it
 * @param body the body as the live read left it
 * @returns the verdict
 */
export function prProofOf({
  identity,
  ask,
  body,
}: {
  identity: string;
  ask: ProofAskOnPr;
  body: PrBodyState;
}): PrProof {
  if (body.kind === "unread") {
    return { ask, kind: "body-unread", why: body.why };
  }
  const missing = proofMissing({ asked: ask.kinds, carried: proofCarriedBy({ body: body.body }) });
  if (missing.length === 0) {
    return { ask, kind: "requested-and-met" };
  }
  return { ask, gap: proofGapSentence({ ask, identity, missing }), kind: "requested-and-unmet", missing };
}

/**
 * The pull requests on the board the owner asked proof on — the only ones whose body is worth reading.
 *
 * @param prs every pull request the board names
 * @returns each with its ask, in first-named order
 */
export function proofAskedPrs({
  prs,
}: {
  prs: ReadonlyMap<string, PrOnBoard>;
}): readonly { readonly pr: PrOnBoard; readonly ask: ProofAskOnPr }[] {
  const out: { pr: PrOnBoard; ask: ProofAskOnPr }[] = [];
  for (const pr of prs.values()) {
    const ask = proofAskedOn({ pr });
    if (ask !== undefined) {
      out.push({ ask, pr });
    }
  }
  return out;
}

/**
 * Every asked pull request's verdict over the bodies read. A pull request the read did not answer is `body-unread`
 * with the reason given, never a missing body.
 *
 * @param asked the pull requests the owner asked proof on ({@link proofAskedPrs})
 * @param bodies each answered body, keyed by lowercased identity — or why no body was read at all
 * @returns the verdicts
 */
export function currencyPullRequestsOf({
  asked,
  bodies,
}: {
  asked: readonly { readonly pr: PrOnBoard; readonly ask: ProofAskOnPr }[];
  bodies:
    | { readonly kind: "read"; readonly bodies: ReadonlyMap<string, string> }
    | { readonly kind: "unread"; readonly why: string };
}): readonly CurrencyPullRequest[] {
  return asked.map(({ pr, ask }) => {
    let body: PrBodyState;
    if (bodies.kind === "unread") {
      body = bodies;
    } else {
      const read = bodies.bodies.get(pr.identity);
      body =
        read === undefined
          ? { kind: "unread", why: "GitHub returned no pull request at that address" }
          : { body: read, kind: "read" };
    }
    return { identity: pr.identity, proof: prProofOf({ ask, body, identity: pr.identity }), rowSlugs: pr.rowSlugs };
  });
}
