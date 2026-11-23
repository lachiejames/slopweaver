/**
 * WHERE EACH ROW ALREADY STANDS — ruled, in flight, stacked, or untouched — judged before anything is put in
 * front of the owner.
 *
 * ## The failure this is for
 *
 * The fleet briefing's ranked list showed items the owner had already answered in the previous supervisor:
 * four acme-admin pull requests reading *get the codeowner approvals … still owes*,
 * every one of them already ruled on. The list ranked on live GitHub state and nothing else, so a ruling the owner
 * gave one supervisor never cleared the row for the next — and `briefing render --open-prs`
 * projected a card per open pull request from the same document, and seven of the eight cards the owner ruled on in
 * a row were stack members or things already ruled or deferred. A scratchpad script hard-
 * coding thirty-six pull-request numbers was the stopgap. This module is the class fix, and it reads three things that
 * already exist rather than authoring a fourth register:
 *
 * - **the lock-in ledger** — a ruling the owner gave, recorded by identity OR by the row's anchor URL, holding until
 *   the item moves ({@link ../sessionStart/lockIn});
 * - **the open runs on the board, and the live session ledger** — a session already inside this work, joined
 *   on the branch the run opened on, or on an anchor its doc or note names;
 * - **the stack** — a pull request whose base is a sibling's head, whose next step is the sibling's.
 *
 * ## What each standing does to a row
 *
 * A row nobody has touched ranks as it always did. A row a session is already working, or one stacked on
 * another, is not the owner's move and is HELD BACK with a reason that names the session or the base — a stacked
 * pull request never becomes an ask of its own. A row the owner has ruled on keeps whatever the ruling said:
 * `dropped`, `rejected` and `deferred` already hold it off the list, and an `approved`, `edited` or `noted`
 * ruling keeps it ON the list but DEMOTED below every untouched row and labelled with the ruling's date, so
 * "you already answered this" is on the row rather than in the owner's memory. A ruling on a base pull request
 * governs every pull request stacked on it, until the base moves.
 *
 * Pure — no I/O, no clock. The caller reads the ledgers and supplies `nowIso`.
 */

import { absentAs } from "#lib/absent.js";
import type { Item } from "./item.js";
import { itemIdentity } from "./item.js";
import type { LockInOutcome, LockInReason, LockInState } from "./lockIn.js";
import { resolutionFor, resolutionHolds } from "./lockIn.js";
import type { DroppedItem, RankedItem, Ranking } from "./rank.js";

/** Where one row already stands, before it is ranked. */
export type Standing =
  /** Nothing on record touches it: rank it as it always was. */
  | { readonly kind: "untouched" }
  /** The owner ruled on it, and the ruling still holds. */
  | {
      readonly kind: "ruled";
      readonly atIso: string;
      readonly outcome: LockInOutcome;
      readonly reason?: LockInReason;
    }
  /**
   * A session is already inside this work. `joinedBy` says which fact made the join — the run's own branch,
   * or an anchor its doc or note names — so a wrong join is arguable rather than mysterious.
   */
  | {
      readonly kind: "in-flight";
      readonly slug: string;
      readonly joinedBy: "branch" | "anchor";
      readonly sessionKey?: string;
    };

/**
 * One run a session is inside right now, reduced to what a join needs.
 *
 * Built from the handover board (an open or waiting run's journal `branch`, plus every anchor its doc names)
 * and from the session ledger (an open session's branch and the anchors in its latest note). `sessionKey`
 * is present only for the second, because a board run is named by its slug.
 */
export interface InFlightRun {
  readonly slug: string;
  readonly branch: string | undefined;
  /** Every URL and `owner/repo#number` the run's doc or note names, from {@link anchorsIn}. */
  readonly anchors: readonly string[];
  /**
   * The repository the run works in, as the last segment of its doc's `repo:` path, when the doc names one.
   *
   * MEASURED on the first live run of this module: the doc for THIS fix names four acme-admin pull requests
   * in its summary as the incident, and the anchor join read that as the run being inside one of them — a doc
   * working in one repository is not inside a pull request of another, however many it mentions. So a run
   * that names its repository only joins rows in that repository; a run naming none joins on the anchor
   * alone, as a session-ledger row does.
   */
  readonly repo?: string;
  readonly sessionKey?: string;
}

/**
 * A URL, or an `owner/repo#number` reference, wherever it sits in prose.
 *
 * The `file:` arm is here because every page the owner reacts to is a local file:
 * a note saying where the live version of a page went now names a `file://` address, and a pattern reading
 * only `http` would extract no anchor from it at all.
 *
 * It spells a local page's WHOLE shape rather than matching the scheme loosely and discarding the misses,
 * for this reason: a loose `(?:https?|file)` CONSUMES a non-page address, so
 * `file:///tmp/run.log,https://claude.ai/code/artifact/<id>` matched as one token, was discarded whole,
 * and the http anchor this function used to return went with it. A match that is thrown away has already
 * eaten its characters — the only safe narrowing is one that never matches.
 */
const ANCHOR =
  /https?:\/\/[^\s<>()"'`]+|file:\/\/\/[^\s<>()"'`:,]*\/pages\/[A-Za-z0-9][A-Za-z0-9._-]*\/index\.html|\b[\w.-]+\/[\w.-]+#\d{1,7}\b/g;

/** Trailing punctuation prose leaves on a pasted URL, which is not part of the address. */
const TRAILING_PUNCTUATION = /[.,;:!?]+$/;

/**
 * Every anchor a piece of prose names — each URL and each `owner/repo#number` — deduplicated, in order.
 *
 * A URL is taken as written, less any sentence punctuation stuck to its end; a match is then EXACT against a
 * row's `where` or `nativeId`, never a substring, so a doc naming a short pull-request number cannot claim a longer one that starts with it.
 *
 * A `file:` anchor is a LOCAL PAGE and nothing else — `file:///tmp/run.log` is a path a doc is DISCUSSING,
 * never a subject a row can be about. {@link ANCHOR} decides that by shape rather than this loop discarding
 * a match afterwards, for the reason recorded there.
 *
 * @param text the doc or note to scan
 * @returns the anchors it names, empty when it names none
 */
export function anchorsIn({ text }: { text: string }): readonly string[] {
  const seen = new Set<string>();
  for (const match of text.matchAll(ANCHOR)) {
    const anchor = match[0].replace(TRAILING_PUNCTUATION, "");
    if (anchor.length > 0) {
      seen.add(anchor);
    }
  }
  return [...seen];
}

/**
 * Whether a run's repository, when it names one, is the item's.
 *
 * An item's `repo` is an `owner/name` slug and a run's is the last segment of a checkout path, so the join
 * is on the name alone. Either side unknown means the guard cannot speak and the join proceeds.
 *
 * @param item the row
 * @param run the run
 * @returns false only when both name a repository and they differ
 */
function sameRepository({ item, run }: { item: Item; run: InFlightRun }): boolean {
  if (run.repo === undefined || item.repo === undefined) {
    return true;
  }
  return item.repo.split("/").at(-1) === run.repo;
}

/**
 * The run already inside this item's work, if any.
 *
 * A branch join needs the run's branch and the item's to both be named and equal. An anchor join needs the
 * run to name the item's own permalink or its `nativeId` exactly. The branch is tried first because it is
 * the sharper fact: a doc may mention a pull request it is not working on, but a run opened on that pull
 * request's branch is working on it by definition. Both joins respect {@link InFlightRun.repo}.
 *
 * @param item the row
 * @param runs every run a session is inside
 * @returns the standing, or undefined when no run is inside this work
 */
export function inFlightUnder({
  item,
  runs,
}: {
  item: Item;
  runs: readonly InFlightRun[];
}): (Standing & { readonly kind: "in-flight" }) | undefined {
  const candidates = runs.filter((run) => sameRepository({ item, run }));
  const byBranch = candidates.find(
    (run) => item.branch !== undefined && item.branch.length > 0 && run.branch === item.branch,
  );
  if (byBranch !== undefined) {
    return {
      joinedBy: "branch",
      kind: "in-flight",
      slug: byBranch.slug,
      ...(byBranch.sessionKey === undefined ? {} : { sessionKey: byBranch.sessionKey }),
    };
  }
  const byAnchor = candidates.find((run) => run.anchors.includes(item.where) || run.anchors.includes(item.nativeId));
  if (byAnchor === undefined) {
    return undefined;
  }
  return {
    joinedBy: "anchor",
    kind: "in-flight",
    slug: byAnchor.slug,
    ...(byAnchor.sessionKey === undefined ? {} : { sessionKey: byAnchor.sessionKey }),
  };
}

/**
 * The ruling that still governs this item, if the owner gave one.
 *
 * @param item the row
 * @param states the folded lock-in ledger
 * @param nowIso the run's own instant
 * @returns the standing, or undefined when no held ruling names this item
 */
export function ruledBy({
  item,
  states,
  nowIso,
}: {
  item: Item;
  states: ReadonlyMap<string, LockInState>;
  nowIso: string;
}): (Standing & { readonly kind: "ruled" }) | undefined {
  const state = resolutionFor({ item, states });
  if (state === undefined || !resolutionHolds({ nowIso, state, whenIso: item.whenIso })) {
    return undefined;
  }
  return {
    atIso: state.resolvedAtIso,
    kind: "ruled",
    outcome: state.outcome,
    ...(state.reason === undefined ? {} : { reason: state.reason }),
  };
}

/**
 * Where one item stands.
 *
 * The order is deliberate: the owner's own ruling outranks a session's, because it is the owner's word. A STACKED pull
 * request is not judged here at all — `../review/stack.ts` tests the base against the repository's default
 * branch and the leg suppresses the row before ranking, which catches a stack member whose base is not even
 * in this read.
 *
 * @param item the row
 * @param runs every run a session is inside
 * @param states the folded lock-in ledger
 * @param nowIso the run's own instant
 * @returns the standing
 */
export function standingOf({
  item,
  runs,
  states,
  nowIso,
}: {
  item: Item;
  runs: readonly InFlightRun[];
  states: ReadonlyMap<string, LockInState>;
  nowIso: string;
}): Standing {
  const ruled = ruledBy({ item, nowIso, states });
  if (ruled !== undefined) {
    return ruled;
  }
  const present = inFlightUnder({ item, runs });
  if (present === undefined) {
    return { kind: "untouched" };
  }
  return present;
}

/**
 * Every item's standing, keyed by identity.
 *
 * @param items every item this run read, ranked and dropped alike
 * @param runs every run a session is inside
 * @param states the folded lock-in ledger
 * @param nowIso the run's own instant
 * @returns one standing per identity
 */
export function standingsOf({
  items,
  runs,
  states,
  nowIso,
}: {
  items: readonly Item[];
  runs: readonly InFlightRun[];
  states: ReadonlyMap<string, LockInState>;
  nowIso: string;
}): ReadonlyMap<string, Standing> {
  return new Map(items.map((item) => [itemIdentity({ item }), standingOf({ item, nowIso, runs, states })]));
}

/**
 * The one clause a row shows for its standing, or undefined for a row nobody has touched.
 *
 * @param standing where the row stands
 * @returns plain words a reader can act on, in the source's own terms
 */
export function standingLabel({ standing }: { standing: Standing }): string | undefined {
  switch (standing.kind) {
    case "untouched":
      return undefined;
    case "ruled": {
      const because = standing.reason === undefined ? "" : `, ${standing.reason}`;
      return `ruled ${standing.atIso.slice(0, 10)} (${standing.outcome}${because})`;
    }
    case "in-flight": {
      const who = standing.sessionKey === undefined ? `session ${standing.slug}` : `session ${standing.sessionKey}`;
      const how = standing.joinedBy === "branch" ? "it opened on this branch" : "its doc names this";
      return `in flight, ${who} — ${how}`;
    }
    default: {
      const unreachable: never = standing;
      return unreachable;
    }
  }
}

/**
 * Whether a standing keeps the row OFF the list rather than merely labelling it.
 *
 * In flight is held back outright — a run already inside the work is not the owner's move. A ruling is not: the
 * suppressing outcomes were already applied by {@link ../sessionStart/lockIn.applyResolutions}, and the rest
 * deliberately stay on the list, demoted, because absence is never done.
 *
 * @param standing where the row stands
 * @returns true when the row leaves the ranked list
 */
export function standingHoldsBack({ standing }: { standing: Standing }): boolean {
  return standing.kind === "in-flight";
}

/**
 * Apply every standing to a ranking: label each row, hold back what is not the owner's move, and demote what the owner has
 * already ruled on below everything they have not.
 *
 * Demotion keeps the ranker's own order within each half, so two runs over an unchanged world still agree.
 * A held-back row joins the drops with its label as the reason, so the drop count still says a leg found
 * it and the list chose not to show it.
 *
 * @param ranking what the ranker produced
 * @param standings every item's standing, from {@link standingsOf}
 * @returns the ranking with each row carrying its standing
 */
export function applyStandings({
  ranking,
  standings,
}: {
  ranking: Ranking;
  standings: ReadonlyMap<string, Standing>;
}): Ranking {
  const standingFor = ({ item }: { item: Item }): Standing =>
    standings.get(itemIdentity({ item })) ?? { kind: "untouched" };
  const kept: RankedItem[] = [];
  const held: DroppedItem[] = [];
  for (const row of ranking.ranked) {
    const standing = standingFor({ item: row.item });
    if (standingHoldsBack({ standing })) {
      held.push({
        item: row.item,
        reason: absentAs({ value: standingLabel({ standing }), whenAbsent: standing.kind }),
        standing,
      });
      continue;
    }
    kept.push({ ...row, standing });
  }
  const untouched = kept.filter((row) => row.standing?.kind !== "ruled");
  const ruled = kept.filter((row) => row.standing?.kind === "ruled");
  const dropped = ranking.dropped.map((row) => ({ ...row, standing: standingFor({ item: row.item }) }));
  return { dropped: [...dropped, ...held], ranked: [...untouched, ...ruled] };
}
