/**
 * Which `role: supervisor` handover docs a LATER chair has already superseded — the reason a retired
 * supervisor's doc stops being work anybody can pick up.
 *
 * ## The defect this closes
 *
 * A supervisor chair is booted from a one-time `fresh-supervisor-handoff-N` doc, and nothing ever recorded
 * that doc's ending. `handover settle` refuses a DOC row outright (`../cli/commands/handover/settleRowRun.ts`
 * — "only an ask row is settled this way"), and `cmux takeover` closed the predecessor's WORKSPACE while
 * writing nothing to its board row. So a retired chair's doc kept `status: ready`, its reaped cycle read as a
 * closed historical one, and `../cli/commands/handover/reconcileRun.ts` placed it in `RUN NOW` — which is
 * exactly `ready`. MEASURED on the live board: **177** such docs, fresh-handoff slugs numbered from 99 up
 * through 291, against 33 already `done`. Repro:
 *
 * ```bash
 * cd "$SLOPWEAVER_HOME/handovers" && for f in fresh-supervisor-handoff*.md; do \
 *   echo "$(grep -m1 '^status:' "$f")|$(grep -m1 '^role:' "$f")"; done | sort | uniq -c
 * ```
 *
 * A fill read that `ready` list and SPAWNED a superseded chair's doc on Opus into
 * `workspace:150` — a second supervisor chair, which the real chair closed 45 seconds later. That is the
 * harm: not a stale row, a duplicate chair.
 *
 * ## Why "older than the PINNED one" rather than "seated and not pinned"
 *
 * The simpler rule needs no ordering at all and is wrong. A chair that dies ten minutes into its shift leaves
 * a doc that is seated and unpinned — and that doc MUST stay runnable, because re-seating it is precisely
 * what has to happen next. Ordering against the chair that currently holds the pin keeps that row available
 * while retiring every genuine predecessor.
 *
 * ## The seating instant comes from the SESSION ledger, and it is the FIRST spawn
 *
 * `../sessions/session.ts`'s `spawned` event carries the handover `slug` explicitly and is written by `cmux
 * spawn` at the moment a chair is seated, so it is the fact rather than a filename convention — and it is one
 * file read for the whole board, where a run journal would be one open per doc.
 *
 * Taking the LAST spawn instead of the first would exonerate the very row this module exists for.
 * That doc carries TWO `spawned` rows in the live ledger — one
 * for the real chair on `workspace:106`, and one for the errant fill on
 * `workspace:150` — and the second is LATER than the then-current chair's own seating. `foldSessions` deliberately
 * returns one row per spawn, so the minimum over rows sharing a slug is the seating that counts.
 *
 * ## What this deliberately does not do
 *
 * It does not reach `../handover/boardEvidence.ts`, so `handover list` and `cmux spawn` still read a
 * superseded chair's doc the old way. Two reasons: `ownEvidence` is pure over one doc's own status, probes
 * and journal, and this predicate needs the LIVE cmux pin, which that layer has no way to read; and every
 * standing doc is swept with a real `closed` row event in the same change, so the board readers are correct
 * without a second derivation. This is the tripwire for a chair that retires WITHOUT a takeover, not the
 * primary mechanism — see doctrine rule 3 on why one well-placed tripwire beats two half-placed ones.
 *
 * Pure: docs, a slug and instants in, a set out. No filesystem, no socket, no clock.
 */

import { basename } from "node:path";

import type { SessionRole } from "../cmux/role.js";
import { isPinnedSupervisorWorkspace } from "../cmux/supervisorWorkspace.js";
import type { SessionItem } from "../sessions/session.js";

/** The two fields of a board doc this decision reads — never the whole {@link ../handover/doc.js} shape. */
export interface SupervisorDocRow {
  readonly slug: string;
  /** The doc's declared `role:`, which is what makes it a chair's doc rather than ordinary work. */
  readonly role: SessionRole | undefined;
}

/** The shape of a cmux workspace this module reads, so a test needs no live socket to build one. */
export interface PinCandidate {
  readonly pinned: boolean;
  readonly title: string | undefined;
  readonly currentDirectory: string;
}

/** Which supervisor docs a later chair retired, and — when none could be judged — why not. */
export interface SupervisorSupersession {
  /** The slugs a later chair superseded. Never includes the pinned chair's own doc. */
  readonly superseded: ReadonlySet<string>;
  /**
   * Why nothing was judged, when nothing was.
   *
   * An empty set has two meanings a caller must be able to tell apart — "no chair is superseded" and "I could
   * not look" — and a silent zero reads as the first while being the second. `../cli/commands/handover/reconcileRun.ts`
   * makes the same argument about its own cmux fallback.
   */
  readonly unresolved: string | undefined;
}

/**
 * The handover slug of the workspace currently holding the supervisor pin.
 *
 * The slug is the basename of the workspace's own working directory — `slopweaver worktree create <slug>` is what
 * put it there. `../cli/commands/handover/reconcileRows.ts`'s `workedFromCmux` uses that directory reading only as
 * its FALLBACK, behind the session ledger's recorded workspace binding (`seatBinding.ts` beside it).
 *
 * cmux enforces no single-pin invariant of its own (`../cmux/client.ts`'s `CmuxWorkspaceSummary.pinned`
 * carries the measurement), so two chairs answering the pin test is AMBIGUOUS rather than a reason to pick
 * one: it yields `undefined`, and the caller reports that it could not look.
 *
 * @param workspaces every workspace cmux listed
 * @returns the pinned chair's slug, or `undefined` when none or more than one answers
 */
export function pinnedSupervisorSlug({ workspaces }: { workspaces: readonly PinCandidate[] }): string | undefined {
  const chairs = workspaces.filter((workspace) =>
    isPinnedSupervisorWorkspace({ pinned: workspace.pinned, title: workspace.title }),
  );
  if (chairs.length !== 1) {
    return undefined;
  }
  return basename(chairs[0]!.currentDirectory);
}

/**
 * When each handover slug's FIRST session was spawned — the instant a chair took its seat.
 *
 * @param sessions the folded session ledger, one item per spawn
 * @returns slug to earliest `spawnedIso`, omitting every session that names no slug or no instant
 */
export function firstSeatedInstants({ sessions }: { sessions: readonly SessionItem[] }): ReadonlyMap<string, string> {
  const seated = new Map<string, string>();
  for (const item of sessions) {
    const slug = item.slug;
    const spawnedIso = item.spawnedIso;
    if (slug === undefined || spawnedIso === undefined) {
      continue;
    }
    const earlier = seated.get(slug);
    if (earlier === undefined || spawnedIso < earlier) {
      seated.set(slug, spawnedIso);
    }
  }
  return seated;
}

/**
 * Decide which `role: supervisor` docs the pinned chair has superseded.
 *
 * A doc is superseded when it declares `role: supervisor`, is not the pinned chair's own doc, and was seated
 * STRICTLY before the pinned chair was. A supervisor doc with no recorded seating has never been a chair —
 * that is the successor doc written ahead of a handoff, and it stays runnable.
 *
 * @param docs every live board doc, as slug and declared role
 * @param pinnedSlug the pinned chair's slug, or `undefined` when cmux could not be read or was ambiguous
 * @param seatedIso each slug's first seating, from {@link firstSeatedInstants}
 * @returns the superseded slugs, or an empty set carrying why none could be judged
 */
export function supersededSupervisorDocs({
  docs,
  pinnedSlug,
  seatedIso,
}: {
  docs: readonly SupervisorDocRow[];
  pinnedSlug: string | undefined;
  seatedIso: ReadonlyMap<string, string>;
}): SupervisorSupersession {
  if (pinnedSlug === undefined) {
    return {
      superseded: new Set(),
      unresolved:
        "no single pinned /slopweaver:supervisor workspace resolved, so no chair could be ordered against one",
    };
  }
  const pinnedSeatedIso = seatedIso.get(pinnedSlug);
  if (pinnedSeatedIso === undefined) {
    return {
      superseded: new Set(),
      unresolved: `the pinned chair ${pinnedSlug} has no recorded seating, so nothing can be ordered against it`,
    };
  }
  const superseded = new Set(
    docs
      .filter((doc) => doc.role === "supervisor" && doc.slug !== pinnedSlug)
      .filter((doc) => {
        const seated = seatedIso.get(doc.slug);
        if (seated === undefined) {
          return false;
        }
        return seated < pinnedSeatedIso;
      })
      .map((doc) => doc.slug),
  );
  return { superseded, unresolved: undefined };
}
