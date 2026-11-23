/**
 * WHAT THE BOARD HOLDS when nothing is seatable — the reading a chair must name before it may say "no work".
 *
 * ## The sentence this exists to stop
 *
 * A chair told the owner "there is nothing to seat" and that capacity went unused because the queue was empty. The
 * reading under it, a tick's `reconcile.json`, carried 116 ranked rows: 2 ready, and 113 HELD — 84 of them
 * dependency-bump landing asks blocked only because they name no `repo:` (`../handover/rowStanding.ts`
 * demotes a repoless `RUN NOW` row), 18 parked on the owner, 4 paused, 4 in flight. `supervisor tick open` printed
 * `seatable: NONE of 2 ready row(s)` and nothing about the 113, so the chair read "two" as the whole board.
 *
 * Reproduce over a tick's kept reading:
 * `node -e 'const d=require(process.argv[1]);console.log(d.rankedCount,d.ready.length,d.held.length,d.repolessRows.length)' "$SLOPWEAVER_HOME/supervisor-scratch/<seat>/<tick>/reconcile.json"`
 * printed `116 2 113 84`.
 *
 * So this module turns a reconciliation into the counts a reader needs to see that a small ready set is not an
 * empty board: how many rows are open, how many are ready, and what holds the rest, with the two holds the
 * fleet can lift itself (no `repo:`, a moved trunk) named apart. `./noWorkClaimGate.ts` refuses a "no work"
 * sentence over it, and `./digestActFirst.ts` prints its line beside `seatable:`.
 *
 * Pure — a parsed `handover reconcile --json` document in, a reading out.
 */
import { isRecord } from "../lib/parsers.js";
import { disconnectedSlugsOf, slugNotHeldBlocked } from "./disconnectedRows.js";
import type { ListReading } from "./idleCapacityGate.js";

/** What the board held at one reconciliation, counted. */
export interface HeldWork {
  /** Every live row the reconciliation ranked — the store's open rows. */
  readonly ranked: number;
  /** Rows in `ready`: the board's `RUN NOW`, before seats and prior holds. */
  readonly ready: number;
  /** Rows in `held`, by their `standing` (`blocked`, `waiting-on-owner`, `paused`, `in-flight`, …). */
  readonly heldByStanding: ReadonlyMap<string, number>;
  /** Rows held only because they name no `repo:` — `handover set-repo` lifts each. */
  readonly repoless: number;
  /** Ready findings held because the trunk moved under their evidence — a session's read lifts each. */
  readonly trunkMoved: number;
  /** Rows held because they need an integration this install is not connected to — connecting it lifts each. */
  readonly disconnected: number;
}

/** The array a reconciliation carries under `key`, or `undefined` when it carries none. */
function arrayAt({
  document,
  key,
}: {
  document: Record<string, unknown>;
  key: string;
}): readonly unknown[] | undefined {
  const value = document[key];
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value;
}

/** Count `held` by each entry's `standing`, or `undefined` when an entry carries none. */
function standingsOf({ held }: { held: readonly unknown[] }): ReadonlyMap<string, number> | undefined {
  const counts = new Map<string, number>();
  for (const entry of held) {
    if (!isRecord(entry) || typeof entry["standing"] !== "string") {
      return undefined;
    }
    const standing = entry["standing"];
    const before = counts.get(standing);
    counts.set(standing, before === undefined ? 1 : before + 1);
  }
  return counts;
}

/**
 * Read what the board held off one reconciliation.
 *
 * Every field is required: a reading missing one cannot say the board is empty, so it is `unreadable` rather
 * than a zero.
 *
 * @param reconciliation the parsed `handover reconcile --json` document
 * @returns the counts, or why they could not be read
 */
export function heldWorkOf({ reconciliation }: { reconciliation: unknown }): ListReading<HeldWork> {
  if (!isRecord(reconciliation)) {
    return { kind: "unreadable", why: "the reconciliation is not a JSON object" };
  }
  const ranked = reconciliation["rankedCount"];
  if (typeof ranked !== "number") {
    return { kind: "unreadable", why: "the reconciliation carries no `rankedCount`" };
  }
  const ready = arrayAt({ document: reconciliation, key: "ready" });
  const held = arrayAt({ document: reconciliation, key: "held" });
  const repoless = arrayAt({ document: reconciliation, key: "repolessRows" });
  const trunkMoved = arrayAt({ document: reconciliation, key: "trunkMovedRows" });
  if (ready === undefined || held === undefined || repoless === undefined || trunkMoved === undefined) {
    return {
      kind: "unreadable",
      why: "the reconciliation is missing one of `ready`, `held`, `repolessRows` or `trunkMovedRows`",
    };
  }
  // A reading with no `disconnectedRows` comes from a build before that hold and held none for it; one that will
  // not decode, or names a row beside an unlistable store, is the shared decoder's refusal (`./disconnectedRows.ts`).
  const disconnected = disconnectedSlugsOf({ reconciliation });
  if (disconnected.kind === "unreadable") {
    return disconnected;
  }
  const unheld = slugNotHeldBlocked({ held, slugs: disconnected.value });
  if (unheld !== undefined) {
    return {
      kind: "unreadable",
      why: `the reconciliation holds ${unheld} for a disconnected integration but does not list it as held blocked`,
    };
  }
  const heldByStanding = standingsOf({ held });
  if (heldByStanding === undefined) {
    return { kind: "unreadable", why: "a `held` entry in the reconciliation carries no `standing`" };
  }
  return {
    kind: "read",
    value: {
      disconnected: disconnected.value.length,
      heldByStanding,
      ranked,
      ready: ready.length,
      repoless: repoless.length,
      trunkMoved: trunkMoved.length,
    },
  };
}

/** How each standing reads to the owner, in the order the line names them. */
const STANDING_WORDS: readonly (readonly [string, string])[] = [
  ["waiting-on-owner", "waiting on the owner"],
  ["paused", "paused on a person"],
  ["in-flight", "in flight"],
];

/** `<count> <words>` for each entry counting more than zero, in order. */
function countedPhrases({ entries }: { entries: readonly (readonly [number, string])[] }): readonly string[] {
  return entries.filter(([count]) => count > 0).map(([count, words]) => `${String(count)} ${words}`);
}

/** How many rows stand this way — a standing no row has carries no key at all, which is zero, not unknown. */
function standingCount({ held, standing }: { held: HeldWork; standing: string }): number {
  const count = held.heldByStanding.get(standing);
  if (count === undefined) {
    return 0;
  }
  return count;
}

/**
 * The one line that says what the board holds, naming the holds the fleet can lift itself first.
 *
 * `blocked` is split: the repoless and trunk-moved rows are counted inside it by the reconciliation, so the
 * line names them and reports only the remainder as "otherwise blocked".
 *
 * @param held the counts {@link heldWorkOf} read
 * @returns e.g. `116 open: 2 ready, 84 held only for naming no repo: (handover set-repo <slug> --repo <dir>), …`
 */
export function heldWorkLine({ held }: { held: HeldWork }): string {
  const parts = [
    `${String(held.ready)} ready`,
    ...countedPhrases({
      entries: [
        [held.repoless, "held only for naming no repo: (handover set-repo <slug> --repo <dir>)"],
        [held.trunkMoved, "held because the trunk moved under their evidence (a session re-reads)"],
        [held.disconnected, "held for an integration this install is not connected to (not to pick up)"],
      ],
    }),
    ...countedPhrases({
      entries: STANDING_WORDS.map(([standing, words]) => [standingCount({ held, standing }), words] as const),
    }),
  ];
  const otherwise = standingCount({ held, standing: "blocked" }) - held.repoless - held.trunkMoved - held.disconnected;
  if (otherwise > 0) {
    parts.push(`${String(otherwise)} otherwise blocked`);
  }
  const named = new Set(["blocked", ...STANDING_WORDS.map(([standing]) => standing)]);
  for (const [standing, count] of held.heldByStanding) {
    if (!named.has(standing) && count > 0) {
      parts.push(`${String(count)} ${standing}`);
    }
  }
  return `${String(held.ranked)} open: ${parts.join(", ")}`;
}
