/**
 * The reader for `handover steers --json` — every steer the owner gave on a call and whether it has been applied
 * (`src/handover/steers.ts`), which the Alignment page's steers section draws.
 *
 * A sibling of `./read.ts`, and every rule that file's module doc states governs this one: refuse rather than
 * substitute, never DROP a row. One steer that does not read refuses the whole report, because a page quietly missing
 * one of the owner's steers reads exactly like one the owner never gave.
 */

import { type Bag, bags, isBag, nullableStr, num, str, strings, sub } from "../../lib/bag";
import { type BoardRowQuote, quoteOf } from "./readHisWords";

/** How a row came to be a steer — the three shapes `src/handover/steers.ts` names. */
export type SteerOriginView =
  | { readonly kind: "cut"; readonly anchor: string }
  | { readonly kind: "relay-taken-up"; readonly anchor: string }
  | { readonly kind: "named-in-text"; readonly turn: string };

/** A pull request that landed on main. */
export interface SteerLandingView {
  readonly number: number;
  readonly url: string;
  readonly mergedIso: string;
  readonly title: string;
  /** `undefined` when the PR ledger holds no record of it. */
  readonly branch: string | undefined;
}

/** Where a steer stands. */
export type SteerStateView =
  | { readonly kind: "applied"; readonly via: "branch" | "witness"; readonly landing: SteerLandingView }
  | { readonly kind: "landing-unknown"; readonly why: string }
  | {
      readonly kind: "settled";
      readonly settlement: string;
      readonly witness: string | undefined;
      readonly witnessPr: { readonly repo: string; readonly number: number } | undefined;
    }
  | { readonly kind: "ended"; readonly status: string }
  | { readonly kind: "in-flight"; readonly branch: string | undefined }
  | { readonly kind: "run-closed"; readonly branch: string | undefined }
  | { readonly kind: "waiting" };

/** One steer. */
export interface SteerView {
  readonly slug: string;
  /** What the row says the work is. */
  readonly title: string;
  readonly askedIso: string | undefined;
  readonly origin: SteerOriginView;
  /** The owner's words as the row stores them, the same quote a board row carries; `undefined` when it stores none. */
  readonly words: BoardRowQuote | undefined;
  readonly timesGiven: number;
  /** When the owner said it again, one per further steer — always `timesGiven - 1` long; `undefined` where none was kept. */
  readonly againIsos: readonly (string | undefined)[];
  readonly repo: string | undefined;
  readonly state: SteerStateView;
}

/** One repository's main as the verb read it. */
export type SteersRepoView =
  | {
      readonly kind: "read";
      readonly dir: string;
      readonly repo: string;
      readonly ref: string;
      readonly refSha: string;
      /** PR-ledger files that would not read, so a steer drawn as not landed may have missed its record. */
      readonly ledgerUnread: number;
      /** Landed PRs the ledger holds no record of, so no steer's branch can join to them. */
      readonly unjoined: number;
    }
  | { readonly kind: "unread"; readonly dir: string; readonly why: string };

/** What the page draws. */
export interface SteersView {
  readonly observedAtIso: string;
  readonly steers: readonly SteerView[];
  readonly repos: readonly SteersRepoView[];
  readonly unreadableDocs: number;
  readonly unreadableJournals: readonly string[];
}

/** A steer's origin off the wire. */
function originOf({ bag }: { bag: Bag }): SteerOriginView | undefined {
  const kind = str({ bag, key: "kind" });
  if (kind === "cut" || kind === "relay-taken-up") {
    const anchor = str({ bag, key: "anchor" });
    return anchor === undefined ? undefined : { anchor, kind };
  }
  if (kind === "named-in-text") {
    const turn = str({ bag, key: "turn" });
    return turn === undefined ? undefined : { kind, turn };
  }
  return undefined;
}

/** A landing off the wire. */
function landingOf({ bag }: { bag: Bag }): SteerLandingView | undefined {
  const number = num({ bag, key: "number" });
  const url = str({ bag, key: "url" });
  const mergedIso = str({ bag, key: "mergedIso" });
  const title = str({ bag, key: "title" });
  const branch = nullableStr({ bag, key: "branch" });
  if (number === undefined || url === undefined || mergedIso === undefined || title === undefined) {
    return undefined;
  }
  if (branch === false) {
    return undefined;
  }
  return { branch, mergedIso, number, title, url };
}

/** The `settled` state off the wire. */
function settledOf({ bag }: { bag: Bag }): SteerStateView | undefined {
  const settlement = str({ bag, key: "settlement" });
  const witness = nullableStr({ bag, key: "witness" });
  if (settlement === undefined || witness === false || !("witnessPr" in bag)) {
    return undefined;
  }
  const raw = bag["witnessPr"];
  if (raw === null) {
    return { kind: "settled", settlement, witness, witnessPr: undefined };
  }
  if (!isBag(raw)) {
    return undefined;
  }
  const repo = str({ bag: raw, key: "repo" });
  const number = num({ bag: raw, key: "number" });
  if (repo === undefined || number === undefined) {
    return undefined;
  }
  return { kind: "settled", settlement, witness, witnessPr: { number, repo } };
}

/** A state off the wire. */
function stateOf({ bag }: { bag: Bag }): SteerStateView | undefined {
  const kind = str({ bag, key: "kind" });
  if (kind === undefined) {
    return undefined;
  }
  switch (kind) {
    case "applied": {
      const via = str({ bag, key: "via" });
      const landing = sub({ bag, key: "landing" });
      if ((via !== "branch" && via !== "witness") || landing === undefined) {
        return undefined;
      }
      const read = landingOf({ bag: landing });
      return read === undefined ? undefined : { kind, landing: read, via };
    }
    case "landing-unknown": {
      const why = str({ bag, key: "why" });
      return why === undefined ? undefined : { kind, why };
    }
    case "settled": {
      return settledOf({ bag });
    }
    case "ended": {
      const status = str({ bag, key: "status" });
      return status === undefined ? undefined : { kind, status };
    }
    case "in-flight":
    case "run-closed": {
      const branch = nullableStr({ bag, key: "branch" });
      return branch === false ? undefined : { branch, kind };
    }
    case "waiting": {
      return { kind };
    }
    default: {
      return undefined;
    }
  }
}

/** A steer's words field: `null` is a row that stores none, a bag is a quote; anything else does not read. */
function nullableWordsOf({ bag }: { bag: Bag }): BoardRowQuote | undefined | false {
  const raw = bag["words"];
  if (raw === null) {
    return undefined;
  }
  if (!isBag(raw)) {
    return false;
  }
  const read = quoteOf({ value: raw });
  if (read === undefined) {
    return false;
  }
  return read;
}

/**
 * When each further steer was given: a list of strings or `null`s, one per steer, read by index so a hole or a
 * shadowed array refuses rather than shortening the list (`bags`, `../../lib/bag.ts`, says why).
 */
function againIsosOf({ bag }: { bag: Bag }): readonly (string | undefined)[] | undefined {
  const raw = bag["againIsos"];
  if (!Array.isArray(raw)) {
    return undefined;
  }
  const isos: (string | undefined)[] = [];
  try {
    for (let index = 0; index < raw.length; index += 1) {
      const one: unknown = raw[index];
      if (one === null) {
        isos.push(undefined);
      } else if (typeof one === "string") {
        isos.push(one);
      } else {
        return undefined;
      }
    }
  } catch {
    return undefined;
  }
  return isos;
}

/** One steer off the wire. */
function steerOf({ bag }: { bag: Bag }): SteerView | undefined {
  const slug = str({ bag, key: "slug" });
  const title = str({ bag, key: "title" });
  const askedIso = nullableStr({ bag, key: "askedIso" });
  const repo = nullableStr({ bag, key: "repo" });
  const timesGiven = num({ bag, key: "timesGiven" });
  const origin = sub({ bag, key: "origin" });
  const state = sub({ bag, key: "state" });
  if (slug === undefined || title === undefined || askedIso === false || repo === false) {
    return undefined;
  }
  if (timesGiven === undefined || origin === undefined || state === undefined) {
    return undefined;
  }
  const readOrigin = originOf({ bag: origin });
  const readWords = nullableWordsOf({ bag });
  const readState = stateOf({ bag: state });
  if (readOrigin === undefined || readWords === false || readState === undefined) {
    return undefined;
  }
  // The chart counts each further steer and the list prints "said N times": a list whose length is not N - 1 would
  // have the two disagree about one row, so it refuses rather than drawing either.
  const againIsos = againIsosOf({ bag });
  if (againIsos === undefined || !Number.isInteger(timesGiven) || timesGiven < 1) {
    return undefined;
  }
  if (againIsos.length !== timesGiven - 1) {
    return undefined;
  }
  return {
    againIsos,
    askedIso,
    origin: readOrigin,
    repo,
    slug,
    state: readState,
    timesGiven,
    title,
    words: readWords,
  };
}

/** One repository off the wire. */
function repoOf({ bag }: { bag: Bag }): SteersRepoView | undefined {
  const kind = str({ bag, key: "kind" });
  const dir = str({ bag, key: "dir" });
  if (dir === undefined) {
    return undefined;
  }
  if (kind === "unread") {
    const why = str({ bag, key: "why" });
    return why === undefined ? undefined : { dir, kind, why };
  }
  if (kind !== "read") {
    return undefined;
  }
  const repo = str({ bag, key: "repo" });
  const ref = str({ bag, key: "ref" });
  const refSha = str({ bag, key: "refSha" });
  const ledgerUnread = num({ bag, key: "ledgerUnread" });
  const unjoined = num({ bag, key: "unjoined" });
  if (repo === undefined || ref === undefined || refSha === undefined || ledgerUnread === undefined) {
    return undefined;
  }
  if (unjoined === undefined) {
    return undefined;
  }
  return { dir, kind, ledgerUnread, ref, refSha, repo, unjoined };
}

/**
 * Project `handover steers --json` into the Alignment page's steers section.
 *
 * @returns every steer newest first, in the verb's own order, or `undefined` when any part does not read
 */
export function readSteers(payload: unknown): SteersView | undefined {
  if (!isBag(payload)) {
    return undefined;
  }
  const observedAtIso = str({ bag: payload, key: "observedAtIso" });
  const wireSteers = bags({ bag: payload, key: "steers" });
  const wireRepos = bags({ bag: payload, key: "repos" });
  const unreadableDocs = num({ bag: payload, key: "unreadableDocs" });
  const unreadableJournals = strings({ bag: payload, key: "unreadableJournals" });
  if (observedAtIso === undefined || wireSteers === undefined || wireRepos === undefined) {
    return undefined;
  }
  if (unreadableDocs === undefined || unreadableJournals === undefined) {
    return undefined;
  }
  const steers: SteerView[] = [];
  for (const bag of wireSteers) {
    const steer = steerOf({ bag });
    if (steer === undefined) {
      return undefined;
    }
    steers.push(steer);
  }
  const repos: SteersRepoView[] = [];
  for (const bag of wireRepos) {
    const repo = repoOf({ bag });
    if (repo === undefined) {
      return undefined;
    }
    repos.push(repo);
  }
  return { observedAtIso, repos, steers, unreadableDocs, unreadableJournals };
}
