/**
 * A question a run is holding for the owner after its doc has left the board — the pure half of `handover list`'s
 * journal sweep (`../cli/commands/handover/listRecovery.ts` is the effectful half).
 *
 * ## The defect this closes
 *
 * The board is built from `handovers/*.md` and nothing else; `scanBoard` never reads `handovers/archive/`. So
 * a run that recorded a question with `handover ask` and then had its doc moved to the archive, renamed or
 * deleted by hand had its `ownerWait` computed by nobody, and the console Queue — the one page the owner reads —
 * never listed it. No journal sweep DMs those orphans, and the SessionStart brief reads only the newest 24
 * journals and speaks to sessions, not to the owner. A question on no surface the owner looks at is the silent
 * stall `AGENTS.md` rule 6 forbids.
 *
 * MEASURED on the live home: 4,055 journals, 106 claimed by no board doc, reading all 106 took
 * 42ms, and none was waiting on the owner — so this is a structural gap with no instance to clean up, and the sweep
 * costs nothing worth naming. Reproduce with `slopweaver handover list --json` and read `detachedAsks` and
 * `unreadJournals`.
 *
 * ## Why the disposition, never `runStateOf`
 *
 * {@link runDisposition} answers `unreadable` for a journal with any undecodable line; `runStateOf` folds the
 * lines that did parse and can report a question that a lost `answered` line had already closed. A journal
 * that cannot be read whole is reported as one, never classified.
 *
 * Pure: no filesystem, no clock.
 */

import type { JournalEvidence } from "./assemble.js";
import { runDisposition } from "./boardTypes.js";
import { isSafeSlug } from "./runStore.js";

/** What is known about the doc a detached ask's run was started from. */
export type DetachedDoc =
  /** Neither `handovers/<slug>.md` nor `handovers/archive/<slug>.md` exists, and every board doc read. */
  | { readonly kind: "missing" }
  /** Something that may be its doc would not read, so its absence is not shown — never abandon on this. */
  | { readonly kind: "unreadable"; readonly why: string };

/** A run waiting on the owner's word whose doc no board row carries. */
export interface DetachedAsk {
  readonly slug: string;
  readonly question: string;
  readonly askedIso: string;
  /** The run journal the question lives in — the only record left of it. */
  readonly journal: string;
  readonly doc: DetachedDoc;
}

/** A journal no board doc claims that could not be read whole, so any question it holds is unseen. */
export interface UnreadJournal {
  readonly journal: string;
  readonly why: string;
}

/** The journal file suffix `runJournalPath` writes. */
const JOURNAL_SUFFIX = ".jsonl";

/**
 * The journal slugs in a `runs/` listing that no readable board doc claims, and the names no slug could have.
 *
 * Subtracting BEFORE any journal is opened is the performance property: a claimed journal is already read by
 * the board, so the sweep opens only what the board cannot see.
 *
 * @param names the `runs/` directory's entries
 * @param claimed every slug a readable board doc carries
 * @returns the unclaimed slugs in name order, and the `.jsonl` names that are not usable slugs
 */
export function unclaimedJournalSlugs({ names, claimed }: { names: readonly string[]; claimed: ReadonlySet<string> }): {
  readonly slugs: readonly string[];
  readonly unusable: readonly string[];
} {
  const slugs: string[] = [];
  const unusable: string[] = [];
  for (const name of names.filter((entry) => entry.endsWith(JOURNAL_SUFFIX)).toSorted()) {
    const slug = name.slice(0, -JOURNAL_SUFFIX.length);
    // Claimed first: a live doc carrying even an unsafe slug owns its journal, so it is never "unclaimable".
    if (claimed.has(slug)) {
      continue;
    }
    if (isSafeSlug({ slug })) {
      slugs.push(slug);
    } else {
      unusable.push(name);
    }
  }
  return { slugs, unusable };
}

/**
 * Whether a journal's current cycle holds a question for the owner.
 *
 * @param evidence the journal's decoded events and undecodable line numbers
 * @returns the question and when it was asked, `not-waiting`, or why the journal cannot say
 */
export function waitingAskOf({
  evidence,
}: {
  evidence: JournalEvidence;
}):
  | { readonly kind: "waiting"; readonly question: string; readonly askedIso: string }
  | { readonly kind: "not-waiting" }
  | { readonly kind: "unreadable"; readonly why: string } {
  const disposition = runDisposition({ events: evidence.events, unreadableLines: evidence.unreadableLines });
  if (disposition.kind === "unreadable") {
    return { kind: "unreadable", why: disposition.reason };
  }
  if (disposition.kind !== "waiting-on-owner") {
    return { kind: "not-waiting" };
  }
  return { askedIso: disposition.askedIso, kind: "waiting", question: disposition.question };
}

/**
 * What a waiting run with no doc on the board can say about that doc.
 *
 * `missing` needs every half: nothing at the run's exact live or archived path, no archived doc carrying the
 * slug under another file name, and a board AND archive that read whole. A doc that would not parse could be
 * the one carrying this slug, so its presence turns "missing" into ignorance — and only `missing` earns the
 * abandon remedy; a renamed archived doc never reads as proven gone.
 *
 * @param lookupError why a file at the exact path, or the archive listing, would not read, when one did not
 * @param unreadableDocs every board and archived doc file that would not read
 * @returns the doc's state
 */
export function detachedDocOf({
  lookupError,
  unreadableDocs,
}: {
  lookupError: string | undefined;
  unreadableDocs: readonly string[];
}): DetachedDoc {
  if (lookupError !== undefined) {
    return { kind: "unreadable", why: lookupError };
  }
  if (unreadableDocs.length > 0) {
    return {
      kind: "unreadable",
      why:
        `${String(unreadableDocs.length)} doc(s) on the board or in its archive would not read ` +
        `(${unreadableDocs.join(", ")}), so none can be shown not to carry this slug`,
    };
  }
  return { kind: "missing" };
}
