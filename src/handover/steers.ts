/**
 * Every steer the owner gave on a call and whether it has been applied — the pure half of `slopweaver handover
 * steers`, which the console's Alignment page draws in its steers section.
 *
 * The page shows the different steers the owner gives over time, so the same steer is never given twice and the
 * context is seen carried forward and applied. Every field is
 * DERIVED from the board and main's history; nothing here is a list somebody keeps.
 *
 * **What a steer is.** A board row a session registered from the owner's words on a call. Three exact shapes, in order:
 *
 * - `cut` — the row's `anchor:` is a call turn, `talk-call:<callId>#<turn>`: the chair read the owner's speech off the call
 *   and cut a row for it (`skills/supervisor/reference/voice-unread.md`).
 * - `relay-taken-up` — the anchor is the voice's own relay (`talk:` or a card's `call:`) AND a session started a run
 *   on the row. The voice relays everything the owner says, small talk included — MEASURED: 1,451 relay-anchored
 *   rows on the board and 96 with a run started on them (`slopweaver handover list --json | jq '[.rows[] |
 *   select((.anchor//"")|test("^(talk|call):"))] | length'` against `slopweaver handover steers --json | jq
 *   '[.steers[] | select(.origin.kind=="relay-taken-up")] | length'`) — so a relay alone is intake rather than a
 *   steer; a run started on it is a session judging that it was one.
 * - `named-in-text` — the row carries no anchor at all but its own text names an exact call turn id. A row registered
 *   that way is a steer whose anchor was dropped (19 such rows, from `handover register --dispatch` relays
 *   that passed no `--anchor`), so it counts, flagged, rather than vanishing from the page or passing as anchored.
 *
 * **What applied means.** A pull request from the row's branch landed on its repository's main — the branch being the
 * row's declared `branch:`, the one its run recorded at `handover start`, or its slug, the three exact matches
 * `./findingGate.ts` names — or the row was settled with a pull-request URL that landed on that PR's own repository's
 * main, whichever repository that is and whether or not the PR ledger holds it. Nothing weaker counts:
 * a row settled `answered` in one line, or a run closed with nothing joined, says exactly that.
 *
 * Pure: rows, journals' run state and each repository's landings in; entries out.
 */
import { collapseWhitespace } from "#lib/oneLineSummary.js";
import type { HandoverDoc } from "./doc.js";
import { ownerWordsSchemeOf } from "./hisWords.js";
import type { RunState } from "./ledger.js";

/** An exact call-turn id as the realtime transcript names a segment: `turn_` and twenty-one letters or digits. */
const TURN_TOKEN = /\bturn_[A-Za-z0-9]{21}\b/u;

/** A GitHub pull-request URL, exactly — what a settlement witness carries when an ask ended in a pull request. */
const PR_URL = /^https:\/\/github\.com\/(?<repo>[^/\s]+\/[^/\s]+)\/pull\/(?<number>\d+)\/?$/u;

/** How a row came to be a steer. */
export type SteerOrigin =
  | { readonly kind: "cut"; readonly anchor: string }
  | { readonly kind: "relay-taken-up"; readonly anchor: string }
  | { readonly kind: "named-in-text"; readonly turn: string };

/** One pull request that landed on a repository's main. */
export interface SteerLanding {
  readonly number: number;
  readonly url: string;
  readonly mergedIso: string;
  readonly title: string;
  /** The head branch the PR ledger records it was opened from; `undefined` when the ledger holds no record of it. */
  readonly branch: string | undefined;
}

/** One repository's main, as read for the join — or why it could not be. */
export type RepoLandings =
  | {
      readonly kind: "read";
      /** `owner/name` of the checkout's origin. */
      readonly repo: string;
      readonly ref: string;
      readonly refSha: string;
      readonly byBranch: ReadonlyMap<string, SteerLanding>;
      readonly byNumber: ReadonlyMap<number, SteerLanding>;
    }
  | { readonly kind: "unread"; readonly why: string };

/** Where a steer stands. */
export type SteerState =
  | { readonly kind: "applied"; readonly via: "branch" | "witness"; readonly landing: SteerLanding }
  | { readonly kind: "landing-unknown"; readonly why: string }
  | {
      readonly kind: "settled";
      readonly settlement: string;
      readonly witness: string | undefined;
      /** The pull request the witness names when it is one — settled on it, but not on main as read. */
      readonly witnessPr: { readonly repo: string; readonly number: number } | undefined;
    }
  | { readonly kind: "ended"; readonly status: string }
  | { readonly kind: "in-flight"; readonly branch: string | undefined }
  | { readonly kind: "run-closed"; readonly branch: string | undefined }
  | { readonly kind: "waiting" };

/**
 * The owner's words as the row stores them beside its anchor.
 *
 * @internal — the shape of {@link SteerEntry}'s `words`; callers read it through the entry.
 */
export interface SteerWords {
  readonly words: string;
  readonly atIso: string;
  readonly anchor: string;
  readonly where: string;
  readonly cut: string;
}

/** One steer as the page draws it. */
export interface SteerEntry {
  readonly slug: string;
  /** What the row says the work is — its summary, else its slug. */
  readonly title: string;
  /** When the owner said it, as the row recorded; `undefined` when the row recorded no instant. */
  readonly askedIso: string | undefined;
  readonly origin: SteerOrigin;
  /** The owner's words as the row stores them, `undefined` when it stores none readable. */
  readonly words: SteerWords | undefined;
  /** How many times the row holds the owner giving it: once, plus every further steer folded onto the row. */
  readonly timesGiven: number;
  /**
   * When the owner gave each further steer folded onto the row, in the row's order — one per steer, so its length is always
   * `timesGiven - 1`; `undefined` for a steer whose stored words do not read, which carries no instant. The Steers
   * page's chart places each one on the week the owner said it again.
   */
  readonly againIsos: readonly (string | undefined)[];
  /** The checkout the row names, `undefined` when it names none. */
  readonly repo: string | undefined;
  readonly state: SteerState;
}

/**
 * The exact call-turn id a text names, if any.
 *
 * @param text a row's own text
 * @returns the first `turn_…` token, or `undefined` when there is none
 */
export function turnTokenIn({ text }: { text: string | undefined }): string | undefined {
  if (text === undefined) {
    return undefined;
  }
  return TURN_TOKEN.exec(text)?.[0];
}

/**
 * Whether a row is a steer, and how — see the module header for the three shapes.
 *
 * @param doc the row
 * @param run its run state, read off its journal
 * @returns the origin, or `undefined` when the row is not a steer
 */
export function steerOriginOf({ doc, run }: { doc: HandoverDoc; run: RunState }): SteerOrigin | undefined {
  const scheme = ownerWordsSchemeOf({ anchor: doc.anchor });
  if (doc.anchor !== undefined && scheme === "talk-call") {
    return { anchor: doc.anchor, kind: "cut" };
  }
  const started = run.branch !== undefined;
  if (doc.anchor !== undefined && (scheme === "talk" || scheme === "call") && started) {
    return { anchor: doc.anchor, kind: "relay-taken-up" };
  }
  if (doc.anchor !== undefined) {
    return undefined;
  }
  const turn = turnTokenIn({ text: doc.summary });
  if (turn === undefined) {
    return undefined;
  }
  return { kind: "named-in-text", turn };
}

/**
 * The repository and number a settlement witness names, when it is a pull-request URL.
 *
 * @param witness the row's `settlementWitness:`
 * @returns the PR, or `undefined` when the witness is anything else
 */
export function witnessPrOf({
  witness,
}: {
  witness: string | undefined;
}): { repo: string; number: number } | undefined {
  if (witness === undefined) {
    return undefined;
  }
  const groups = PR_URL.exec(witness.trim())?.groups;
  if (groups === undefined) {
    return undefined;
  }
  return { number: Number(groups["number"]), repo: groups["repo"]! };
}

/**
 * The landing a row joins by one of its three exact branches, in the order a declared branch beats a recorded one
 * beats the slug.
 */
function landingByBranch({
  doc,
  run,
  landings,
}: {
  doc: HandoverDoc;
  run: RunState;
  landings: Extract<RepoLandings, { kind: "read" }>;
}): SteerLanding | undefined {
  for (const branch of [doc.branch, run.branch, doc.slug]) {
    if (branch === undefined) {
      continue;
    }
    const hit = landings.byBranch.get(branch);
    if (hit !== undefined) {
      return hit;
    }
  }
  return undefined;
}

/** The landing a settlement witness names, looked up on whichever main read is that PR's repository. */
function landingByWitness({
  witness,
  readMains,
}: {
  witness: { repo: string; number: number } | undefined;
  readMains: readonly Extract<RepoLandings, { kind: "read" }>[];
}): SteerLanding | undefined {
  if (witness === undefined) {
    return undefined;
  }
  const main = readMains.find((one) => one.repo.toLowerCase() === witness.repo.toLowerCase());
  return main?.byNumber.get(witness.number);
}

/**
 * Where one steer stands. Applied first, because a landing is the fact the page exists to show; then anything that
 * would not read — the row's main, or its journal, which holds the branch its run recorded — since neither may pass
 * as "not applied"; then the row's own ending, its run, and nothing.
 *
 * @param doc the row
 * @param run its run state
 * @param runUnread whether its journal would not read, so `run` is a stand-in rather than what the journal holds
 * @param landings its repository's main as read, `undefined` when the row names no repository
 * @param readMains every main that was read, so a settlement witness on another repository is still found
 * @returns the state
 */
export function steerStateOf({
  doc,
  run,
  runUnread,
  landings,
  readMains,
}: {
  doc: HandoverDoc;
  run: RunState;
  runUnread: boolean;
  landings: RepoLandings | undefined;
  readMains: readonly Extract<RepoLandings, { kind: "read" }>[];
}): SteerState {
  if (landings?.kind === "read") {
    const byBranch = landingByBranch({ doc, landings, run });
    if (byBranch !== undefined) {
      return { kind: "applied", landing: byBranch, via: "branch" };
    }
  }
  const witness = witnessPrOf({ witness: doc.settlementWitness });
  const byWitness = landingByWitness({ readMains, witness });
  if (byWitness !== undefined) {
    return { kind: "applied", landing: byWitness, via: "witness" };
  }
  if (landings === undefined) {
    return { kind: "landing-unknown", why: "the row names no repository, so no main could be read for it" };
  }
  if (landings.kind === "unread") {
    return { kind: "landing-unknown", why: landings.why };
  }
  if (runUnread) {
    return {
      kind: "landing-unknown",
      why: "its run journal would not read, so neither the branch its run recorded nor how far it got is known",
    };
  }
  if (doc.settlement !== undefined) {
    return { kind: "settled", settlement: doc.settlement, witness: doc.settlementWitness, witnessPr: witness };
  }
  if (doc.status === "done" || doc.status === "cancelled" || doc.status === "rejected") {
    return { kind: "ended", status: doc.status };
  }
  if (run.phase === "open" || run.phase === "waiting-on-owner") {
    return { branch: run.branch, kind: "in-flight" };
  }
  if (run.entries > 0) {
    return { branch: run.branch, kind: "run-closed" };
  }
  return { kind: "waiting" };
}

/** The owner's words as the row stores them, or `undefined` when the row stores none that reads. */
function steerWordsOf({ doc }: { doc: HandoverDoc }): SteerWords | undefined {
  if (doc.hisWords.kind !== "held") {
    return undefined;
  }
  const held = doc.hisWords.hisWords;
  return { anchor: held.anchor, atIso: held.atIso, cut: held.cut, where: held.where, words: held.words };
}

/** When each further steer on a row was given: a held record's instant, nothing for one that does not read. */
function againIsosOf({ doc }: { doc: HandoverDoc }): readonly (string | undefined)[] {
  return doc.hisWordsSteers.map((steer) => {
    if (steer.group.kind !== "held") {
      return undefined;
    }
    return steer.group.hisWords.atIso;
  });
}

/** What a row says its work is: its summary on one line (a `--keep-lines` one holds breaks), else its slug. */
function titleOf({ doc }: { doc: HandoverDoc }): string {
  if (doc.summary === undefined) {
    return doc.slug;
  }
  return collapseWhitespace({ text: doc.summary });
}

/** When a steer was given, for ordering: the row's asked instant, else the instant its quote carries. */
function givenIso({ entry }: { entry: SteerEntry }): string | undefined {
  if (entry.askedIso !== undefined) {
    return entry.askedIso;
  }
  return entry.words?.atIso;
}

/** Newest first; a steer with no instant sorts last, then by slug so the order is stable. */
function newestFirst(a: SteerEntry, b: SteerEntry): number {
  const at = givenIso({ entry: a });
  const bt = givenIso({ entry: b });
  if (at !== undefined && bt !== undefined && at !== bt) {
    return Date.parse(bt) - Date.parse(at);
  }
  if (at === undefined && bt !== undefined) {
    return 1;
  }
  if (at !== undefined && bt === undefined) {
    return -1;
  }
  return a.slug.localeCompare(b.slug);
}

/** A row's run state, or the never-run state when its journal holds no run — absence by design, not a fallback. */
function runOf({
  runs,
  slug,
  noRun,
}: {
  runs: ReadonlyMap<string, RunState>;
  slug: string;
  noRun: RunState;
}): RunState {
  const run = runs.get(slug);
  if (run !== undefined) {
    return run;
  }
  return noRun;
}

/**
 * Every steer on the board, newest first.
 *
 * @param docs every row the board scan read
 * @param runs each row's run state by slug; a row with no entry has never been run
 * @param unreadRuns the rows whose journal would not read
 * @param landings each repository's main as read, keyed by the checkout path a row's `repo:` names
 * @param noRun the state a row with no journal has
 * @returns the steers
 */
export function steersOf({
  docs,
  runs,
  unreadRuns,
  landings,
  noRun,
}: {
  docs: readonly HandoverDoc[];
  runs: ReadonlyMap<string, RunState>;
  unreadRuns: ReadonlySet<string>;
  landings: ReadonlyMap<string, RepoLandings>;
  noRun: RunState;
}): readonly SteerEntry[] {
  const readMains = [...landings.values()].filter(
    (one): one is Extract<RepoLandings, { kind: "read" }> => one.kind === "read",
  );
  const entries: SteerEntry[] = [];
  for (const doc of docs) {
    const run = runOf({ noRun, runs, slug: doc.slug });
    const runUnread = unreadRuns.has(doc.slug);
    // A relay row is a steer only once a run started on it, which an unreadable journal cannot say — so it is
    // counted, rather than dropped, and its state says the journal would not read.
    let origin = steerOriginOf({ doc, run });
    if (origin === undefined && runUnread) {
      origin = steerOriginOf({ doc, run: { ...run, branch: doc.slug } });
    }
    if (origin === undefined) {
      continue;
    }
    let repoLandings: RepoLandings | undefined;
    if (doc.repo !== undefined) {
      repoLandings = landings.get(doc.repo);
    }
    entries.push({
      againIsos: againIsosOf({ doc }),
      askedIso: doc.askedIso,
      origin,
      repo: doc.repo,
      slug: doc.slug,
      state: steerStateOf({ doc, landings: repoLandings, readMains, run, runUnread }),
      timesGiven: 1 + doc.hisWordsSteers.length,
      title: titleOf({ doc }),
      words: steerWordsOf({ doc }),
    });
  }
  return entries.toSorted(newestFirst);
}

/**
 * Whether a row could be a steer before its journal is read — the cheap filter that keeps the reader from opening
 * every journal on the board. A relay row still needs its journal to decide; a row with any other anchor never can be.
 *
 * @param doc the row
 * @returns whether its journal is worth reading
 */
export function mayBeSteer({ doc }: { doc: HandoverDoc }): boolean {
  if (doc.anchor === undefined) {
    return turnTokenIn({ text: doc.summary }) !== undefined;
  }
  const scheme = ownerWordsSchemeOf({ anchor: doc.anchor });
  return scheme === "talk-call" || scheme === "talk" || scheme === "call";
}
