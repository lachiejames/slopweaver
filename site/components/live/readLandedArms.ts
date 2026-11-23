/**
 * The three arms of one landed change — the owner's words or why there are none, the rule it landed under, and the proof its
 * description carried — with their readers and the field readers `./readLanded.ts` shares. A sibling of
 * `./readLanded.ts`, under every rule its module doc states.
 */
import { type Bag, bags, nullableStr, str, sub } from "../../lib/bag";
import type { BoardRowQuote, HisWordsCut, HisWordsWhere } from "./readHisWords";

/** The owner's words behind a landed change, or why there are none — the verb's six endings. */
export type LandedWordsView =
  | ({ readonly kind: "asked" } & BoardRowQuote)
  | ({
      readonly kind: "ruling";
      /** The ruling as the session that heard it wrote it down — that session's words, never quoted as the owner's. */
      readonly recorded: string;
      readonly decidedIso: string | undefined;
    } & BoardRowQuote)
  | { readonly kind: "unread"; readonly why: string }
  | { readonly kind: "elsewhere"; readonly anchor: string }
  | { readonly kind: "unasked"; readonly why: string }
  | { readonly kind: "not-joined"; readonly why: string };

/** The standing rule a change was merged under — a licence to merge, never the owner's words on the change. */
export type LandedUnderView =
  | {
      readonly kind: "rule";
      readonly actKind: string;
      readonly classId: string;
      readonly words: string;
      readonly anchor: string;
    }
  | { readonly kind: "none" }
  | { readonly kind: "unread"; readonly why: string };

/** One side of a description's before-and-after. */
export interface LandedSideView {
  readonly where: string;
  readonly evidence: string;
}

/** One claim a description made, and how it stood. */
export interface LandedClaimView {
  readonly claim: string;
  readonly verdict: "proven" | "gap" | "failed";
  readonly detail: string;
}

/** The proof a change's description carried, or why there is none to show. */
export type LandedProofView =
  | {
      readonly kind: "recorded";
      /** A description publishes no grade, so the view carries none and never infers one. */
      readonly problem: string;
      readonly before: LandedSideView | undefined;
      readonly after: LandedSideView | undefined;
      readonly claims: readonly LandedClaimView[];
    }
  | { readonly kind: "unrecorded"; readonly why: string };

const WHERES: readonly HisWordsWhere[] = ["console-typed", "console-voice", "call", "call-landing", "session"];
const CUTS: readonly HisWordsCut[] = ["none", "start", "end"];
const VERDICTS: readonly LandedClaimView["verdict"][] = ["proven", "gap", "failed"];

/** The marker a refused field reads as, so a caller can tell it from a legitimate `undefined`. */
export const REFUSED = Symbol("refused");

/**
 * A string the verb writes as `null` when absent; a missing or mistyped field is {@link REFUSED}.
 *
 * @returns the string, `undefined` for the verb's `null`, or {@link REFUSED}
 */
export function orNull({ bag, key }: { bag: Bag; key: string }): string | undefined | typeof REFUSED {
  const value = nullableStr({ bag, key });
  if (value === false) {
    return REFUSED;
  }
  return value;
}

/**
 * An ISO instant field.
 *
 * @returns the instant, or `undefined` when it is absent or does not parse
 */
export function instant({ bag, key }: { bag: Bag; key: string }): string | undefined {
  const value = str({ bag, key });
  if (value === undefined || Number.isNaN(Date.parse(value))) {
    return undefined;
  }
  return value;
}

/**
 * The verb's reason, on an arm that carries only one.
 *
 * @returns the reason a `why`-only arm carries, or `undefined` when it is absent
 */
export function why({ bag }: { bag: Bag }): string | undefined {
  return str({ bag, key: "why" });
}

/** @returns the owner's words as a record holds them, or `undefined` when any field will not read */
function readQuote({ bag }: { bag: Bag }): BoardRowQuote | undefined {
  const words = str({ bag, key: "words" });
  const atIso = instant({ bag, key: "atIso" });
  const anchor = str({ bag, key: "anchor" });
  const where = WHERES.find((one) => one === bag["where"]);
  const cut = CUTS.find((one) => one === bag["cut"]);
  if (words === undefined || atIso === undefined || anchor === undefined || where === undefined || cut === undefined) {
    return undefined;
  }
  return { anchor, atIso, cut, where, words };
}

/**
 * The words arm of one landing.
 *
 * @returns the owner's words or their absence, or `undefined` when the arm will not read
 */
export function readWords({ bag }: { bag: Bag }): LandedWordsView | undefined {
  const kind = str({ bag, key: "kind" });
  if (kind === "asked") {
    const quote = readQuote({ bag });
    if (quote === undefined) {
      return undefined;
    }
    return { ...quote, kind };
  }
  if (kind === "ruling") {
    const quote = readQuote({ bag });
    const recorded = str({ bag, key: "recorded" });
    const decidedIso = orNull({ bag, key: "decidedIso" });
    if (quote === undefined || recorded === undefined || decidedIso === REFUSED) {
      return undefined;
    }
    return { ...quote, decidedIso, kind, recorded };
  }
  if (kind === "elsewhere") {
    const anchor = str({ bag, key: "anchor" });
    if (anchor === undefined) {
      return undefined;
    }
    return { anchor, kind };
  }
  if (kind === "unread" || kind === "unasked" || kind === "not-joined") {
    const reason = why({ bag });
    if (reason === undefined) {
      return undefined;
    }
    return { kind, why: reason };
  }
  return undefined;
}

/**
 * The standing-rule arm of one landing.
 *
 * @returns the rule a change landed under, or `undefined` when the arm will not read
 */
export function readUnder({ bag }: { bag: Bag }): LandedUnderView | undefined {
  const kind = str({ bag, key: "kind" });
  if (kind === "none") {
    return { kind };
  }
  if (kind === "unread") {
    const reason = why({ bag });
    if (reason === undefined) {
      return undefined;
    }
    return { kind, why: reason };
  }
  if (kind !== "rule") {
    return undefined;
  }
  const actKind = str({ bag, key: "actKind" });
  const classId = str({ bag, key: "classId" });
  const words = str({ bag, key: "words" });
  const anchor = str({ bag, key: "anchor" });
  if (actKind === undefined || classId === undefined || words === undefined || anchor === undefined) {
    return undefined;
  }
  return { actKind, anchor, classId, kind, words };
}

/** @returns one side, `undefined` for the verb's `null`, or {@link REFUSED} */
function readSide({ bag, key }: { bag: Bag; key: string }): LandedSideView | undefined | typeof REFUSED {
  if (bag[key] === null) {
    return undefined;
  }
  const side = sub({ bag, key });
  if (side === undefined) {
    return REFUSED;
  }
  const where = str({ bag: side, key: "where" });
  const evidence = str({ bag: side, key: "evidence" });
  if (where === undefined || evidence === undefined) {
    return REFUSED;
  }
  return { evidence, where };
}

/** @returns one claim, or `undefined` when it will not read */
function readClaim({ bag }: { bag: Bag }): LandedClaimView | undefined {
  const claim = str({ bag, key: "claim" });
  const detail = str({ bag, key: "detail" });
  const verdict = VERDICTS.find((one) => one === bag["verdict"]);
  if (claim === undefined || detail === undefined || verdict === undefined) {
    return undefined;
  }
  return { claim, detail, verdict };
}

/**
 * The proof arm of one landing.
 *
 * @returns the proof, or `undefined` when the arm will not read
 */
export function readProof({ bag }: { bag: Bag }): LandedProofView | undefined {
  const kind = str({ bag, key: "kind" });
  if (kind === "unrecorded") {
    const reason = why({ bag });
    if (reason === undefined) {
      return undefined;
    }
    return { kind, why: reason };
  }
  if (kind !== "recorded") {
    return undefined;
  }
  const problem = str({ bag, key: "problem" });
  const before = readSide({ bag, key: "before" });
  const after = readSide({ bag, key: "after" });
  const claimBags = bags({ bag, key: "claims" });
  if (problem === undefined || before === REFUSED || after === REFUSED || claimBags === undefined) {
    return undefined;
  }
  const claims: LandedClaimView[] = [];
  for (const one of claimBags) {
    const claim = readClaim({ bag: one });
    if (claim === undefined) {
      return undefined;
    }
    claims.push(claim);
  }
  return { after, before, claims, kind, problem };
}
