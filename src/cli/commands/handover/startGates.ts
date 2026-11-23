/**
 * What `handover start` says about a doc BEFORE it opens a run — two refusals and a warning.
 *
 * Split out of `./lifecycle.ts` rather than living beside `startRun`: that file carries the whole run
 * lifecycle and sits at this repo's module-size cap, and these are the half with no state of their own.
 * Both are pure over a resolved {@link RunContext} plus the logger, so their exact wording stays testable —
 * this repo bans `vi.spyOn`, and a refusal nobody can assert on is a refusal nobody maintains.
 *
 * The shared `RunContext` and probe printer live in `./runContextTypes.ts` rather than in `./lifecycle.ts`:
 * that file imports these gates, so reaching back into it for `printProbes` is a cycle `no-cycle` refuses.
 */

import { behaviouralProbeGap } from "../../../handover/behaviouralProbe.js";
import { runDisposition } from "../../../handover/boardTypes.js";
import { type Blocker, blockerFor, type HandoverDoc } from "../../../handover/doc.js";
import { blockingKind } from "./finishRefusals.js";
import { printProbes, type RunContext } from "./runContextTypes.js";

/**
 * Whether the board composer reads one `blockedBy` dependency as satisfied — its `satisfiesDependency`.
 *
 * A seam rather than a direct composition, so a unit test reaches both answers with a plain function; the verb
 * passes one built on `composeRow` (`./rowRun.ts`), the same composer `handover list` and `handover row` print.
 */
export type DependencyDone = (dependency: { readonly slug: string }) => boolean;

/**
 * Narrow a `waiting` blocker to the dependencies the board composer does NOT read as satisfied.
 *
 * `blockerFor` reads a dependency's AUTHORED `status:` and `settlement:` only, so a row ended by a journal event
 * — `handover close`, which promises every reader derives `done` while leaving `status:` alone — stayed
 * `waiting` here while the board placed it under `DONE` and its dependent under `RUN NOW`. This only ever
 * REMOVES slugs from a `waiting` list, and never asks the seam about any other blocker, so it cannot open a run
 * the authored reading would have refused for any other reason. The converse is not closed: an authored
 * `status: done` the composer would contradict is never re-asked, because that would ADD a blocker.
 *
 * @param blocker what `blockerFor` answered
 * @param dependencyDone the composer's verdict on one dependency
 * @returns the blocker with every composed-done dependency dropped, or `undefined` when none remain
 */
export function narrowWaiting({
  blocker,
  dependencyDone,
}: {
  blocker: Blocker | undefined;
  dependencyDone: DependencyDone;
}): Blocker | undefined {
  if (blocker?.kind !== "waiting") {
    return blocker;
  }
  const remaining = blocker.on.filter((slug) => !dependencyDone({ slug }));
  if (remaining.length === 0) {
    return undefined;
  }
  return { kind: "waiting", on: remaining };
}

/**
 * The board-level reason a doc must not start — its probe state, status and `blockedBy` edges — or none.
 *
 * A `waiting` refusal names the slugs it still waits on: "not startable — waiting" alone sends the session to
 * read the whole board to find which row holds it.
 *
 * @param context the resolved doc and its evaluated probes
 * @param all every doc on the board, for the dependency check
 * @param dependencyDone the board composer's verdict on one dependency
 * @returns the refusal to print, or `undefined` when nothing on the board blocks the start
 */
export function blockerRefusal({
  context,
  all,
  dependencyDone,
}: {
  context: RunContext;
  all: readonly HandoverDoc[];
  dependencyDone: DependencyDone;
}): string | undefined {
  const blocker = narrowWaiting({
    blocker: blockerFor({
      all,
      doc: context.doc,
      state: { commitsAhead: context.commitsAhead, computed: context.computed, results: context.results },
    }),
    dependencyDone,
  });
  if (blocker === undefined || !blockingKind({ blocker })) {
    return undefined;
  }
  const on = blocker.kind === "waiting" ? ` on ${blocker.on.join(", ")}` : "";
  return `handover start: ${context.doc.slug} is not startable — ${blocker.kind}${on}`;
}

/**
 * Whether a landed doc is confirmed shipped and must refuse a fresh start — mirrors `boardState.ts`'s rules 4
 * and 6 exactly, so `list` and `start` never disagree again: a genuine FINISHED cycle is stronger evidence
 * than a pre-run `notDoneReason` and refuses unconditionally (rule 4); a landed PROXY with no finished cycle
 * refuses only when `notDoneReason` does not explain the gap (rule 6). `RunState.phase` alone cannot tell
 * finished from abandoned — both collapse to `closed` — so the disposition is re-derived from the same events
 * here rather than guessed at.
 *
 * @param context the resolved doc, its probe results and its journal
 * @returns the refusal to print, or `undefined` when the start may proceed
 */
export function landedRefusal({ context }: { context: RunContext }): string | undefined {
  if (context.computed !== "landed") {
    return undefined;
  }
  const disposition = runDisposition({ events: context.events, unreadableLines: context.unreadable });
  const confirmedShipped =
    disposition.kind === "finished" || disposition.kind === "closed" || context.doc.notDoneReason === undefined;
  if (!confirmedShipped) {
    return undefined;
  }
  printProbes({ results: context.results });
  return (
    `handover start: every probe ${context.doc.slug} declares ALREADY PASSES:\n` +
    "This work looks shipped. Confirm it rather than re-planning it:\n" +
    // Deliberately NOT `handover finish` — there is no run to close, and `finish` correctly refuses that.
    // `handover close` is the verb for this shape: no run needed, and the row's status is DERIVED from what
    // it records rather than hand-edited into the file this refusal just named.
    `  slopweaver handover close ${context.doc.slug} --summary "<what shipped>"`
  );
}

/**
 * The lines `handover start` prints when the doc it just opened declares no behavioural probe.
 *
 * ## It WARNS rather than refuses, and the number is why
 *
 * MEASURED over the whole board — 301 `ready` docs — with the very gate this warns from:
 * **158** of them would be refused at `start` the instant this landed. 88 declare no `doneWhen:` at all and
 * 70 declare only structural probes; a further 65 already carry a `probeWaiver:` and would pass. Reproduce
 * by walking `$SLOPWEAVER_HOME/handovers/*.md` through `parseHandoverDoc` and `behaviouralProbeGap`.
 * Refusing there does not enforce a rule, it stops a fleet mid-flight and demands 158 waivers written by
 * authors who have not yet investigated the work — the exact front-loaded judgement
 * `behaviouralProbe.ts`'s own scope note warns about, one phase earlier.
 *
 * **The rule itself is not weakened.** `handover finish` still REFUSES, unchanged, and that is the
 * transition the owner ruled on. What moves is WHEN the session is told: from the moment the work is done,
 * where a probe is a retrofit, to the moment it opens, where it costs almost nothing. That is the entire
 * content of `probe-missing-or-malformed-at-write-time` — a run opened with no probe, and the probe
 * registered later by amending the live brief.
 *
 * A waived doc prints too. A waiver nobody ever sees again is the silent `done` the whole rule exists to
 * make visible.
 *
 * Pure so the exact wording is testable without a logger — this repo bans `vi.spyOn`, and a warning nobody
 * can assert on is a warning that silently stops being printed.
 *
 * @param doc the doc a run was just opened for
 * @returns the lines to print, or none when the doc already declares a behavioural probe
 */
export function openRunProbeGapLines({ doc }: { doc: HandoverDoc }): readonly string[] {
  const gap = behaviouralProbeGap({
    doneWhen: doc.doneWhen,
    kind: doc.kind,
    probeWaiver: doc.probeWaiver,
    summary: doc.summary,
  });
  if (gap === undefined) {
    return [];
  }
  if (gap.waiver !== undefined) {
    return [`handover start: open-run-declares-no-probe — WAIVED: ${gap.waiver}`];
  }
  const subject =
    gap.marker === undefined
      ? "declares no probe that would fail if its claim were false"
      : `records an owner ask ("${gap.marker}") with no behavioural probe`;
  return [
    `handover start: open-run-declares-no-probe — ${doc.slug} ${subject}.`,
    "  WRITE IT NOW, while you still can. `handover finish` REFUSES this, and by then the probe is a",
    "  retrofit onto work already done rather than the thing that decided what to build.",
    "  add a `doneWhen: - command:` that RUNS what this doc claims and exits non-zero when the claim",
    `  stops being true, or record \`probeWaiver: "<why none can exist>"\` on ${doc.path}.`,
  ];
}
