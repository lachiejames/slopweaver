/**
 * The composed board model: authored status, repository probe evidence, and the run journal, combined once
 * by explicit precedence rather than three independent readers each interpreting a slice of the truth.
 *
 * ## Why one composer, not three
 *
 * Before this module, `doc.ts`'s `blockerFor` decided a doc's placement from status and probes alone,
 * `handover start` separately re-derived a landed-probe refusal, and `handover list` never read the run
 * journal at all — so an abandoned run's doc could sit forever showing whatever it last declared, and the
 * board could say `RUN NOW` for work `start` itself refused. Composing once, here, is what removes the
 * disagreement rather than papering over it per caller.
 *
 * ## Precedence is a single ordered list, not three independent trees
 *
 * `composeBoardModels` applies {@link boardSectionOf}'s rules in order and stops at the first match. Anywhere
 * this module needs to know whether authored status and the run journal genuinely disagree, it asks
 * {@link consistencyOf} rather than re-deriving an equivalent check — a second hand-rolled version of the
 * same question is exactly how the matrix and the composer could quietly drift apart.
 *
 * ## Dependency satisfaction never needs a fixed point
 *
 * Whether a doc reaches `DONE` never depends on ITS OWN `blockedBy` — a doc that shipped is done regardless
 * of whether its own prerequisites were ever satisfied. That means every root's own-evidence section (rules
 * that do not mention dependencies) can be computed in one pass, independent of every other root, and a
 * second pass can then resolve `blockedBy` edges purely by asking "is that other doc's own-evidence section
 * `DONE`?" — no topological sort, no repeated passes to a fixed point.
 *
 * Pure throughout: every function here takes already-parsed docs, already-evaluated probes, and an
 * already-derived run disposition. No filesystem, no clock.
 */

import { absentAsEmpty } from "#lib/absent.js";
import { dependencyClosures, type IntrinsicModel, resolveDependencyPending } from "./boardDependencies.js";
import { ownEvidence } from "./boardEvidence.js";
import { type BoardModel, type RunDisposition, runDisposition } from "./boardTypes.js";
import { consistencyOf } from "./consistency.js";
import { derivedRowState } from "./derivedRowState.js";
import { type DocProbeState, type HandoverDoc } from "./doc.js";
import { type RunEvent } from "./ledger.js";
import { type ProbeOutcome, probeMark } from "./probe.js";
import { fieldsOfDoc, rowTagsOf } from "./rowTagFold.js";

export type { DocProbeState } from "./doc.js";

/**
 * Compose every root doc into a {@link BoardModel}.
 *
 * @param roots the top-level docs eligible for rendering or hygiene findings
 * @param resolutionDocs `roots` plus any exact archived docs loaded solely to resolve named dependencies —
 *   never themselves returned as models
 * @param probeStates each root's evaluated probes, keyed by doc path
 * @param journals each root's run-journal evidence, keyed by slug
 * @returns one composed model per root, in the same order
 */
export function composeBoardModels({
  roots,
  resolutionDocs,
  probeStates,
  journals,
}: {
  roots: readonly HandoverDoc[];
  resolutionDocs: readonly HandoverDoc[];
  probeStates: ReadonlyMap<string, DocProbeState>;
  journals: ReadonlyMap<string, { readonly events: readonly RunEvent[]; readonly unreadableLines: readonly number[] }>;
}): readonly BoardModel[] {
  const resolutionBySlug = new Map(resolutionDocs.map((candidate) => [candidate.slug, candidate]));

  const intrinsic: readonly IntrinsicModel[] = roots.map((doc) =>
    intrinsicModel({ doc, journal: journals.get(doc.slug), probe: probeStates.get(doc.path) }),
  );

  // Composed for every ROOT; for a resolution-only doc (an archived dependency, never itself composed with
  // probe/journal evidence), the authored `done` status is trusted directly. Archival happens only once work
  // is settled, so this is not a weaker check than composition would give — there is no live evidence left to
  // compose it against.
  const rootSlugs = new Set(roots.map((doc) => doc.slug));
  const doneSlugs = new Set([
    ...intrinsic.filter((entry) => entry.evidence.section === "DONE").map((entry) => entry.doc.slug),
    ...resolutionDocs.filter((doc) => !rootSlugs.has(doc.slug) && doc.status === "done").map((doc) => doc.slug),
  ]);

  return intrinsic.map((entry): BoardModel => {
    if (entry.evidence.section !== "dependency-pending") {
      return {
        consistency: entry.consistency,
        dependencyClosures: dependencyClosures({ all: resolutionBySlug, doc: entry.doc }),
        derived: entry.derived,
        doc: entry.doc,
        movedIso: entry.movedIso,
        probe: entry.probe,
        reason: entry.evidence.reason,
        run: entry.run,
        satisfiesDependency: entry.evidence.section === "DONE",
        section: entry.evidence.section,
        tags: entry.tags,
        tagsIncomplete: entry.tagsIncomplete,
      };
    }
    return resolveDependencyPending({ doneSlugs, intrinsic: entry, resolutionBySlug });
  });
}

/** One root's own evidence, tags and journal-derived state, before the `blockedBy` pass places it. */
function intrinsicModel({
  doc,
  journal,
  probe,
}: {
  doc: HandoverDoc;
  journal: { readonly events: readonly RunEvent[]; readonly unreadableLines: readonly number[] } | undefined;
  probe: DocProbeState | undefined;
}): IntrinsicModel {
  const run: RunDisposition = journal === undefined ? { kind: "never-started" } : runDisposition(journal);
  // A journal this composition was never handed derives no `reply` or `run` rather than a guessed `none`.
  const journalRun = journal === undefined ? undefined : run;
  const events = absentAsEmpty({ value: journal?.events });
  const derived = derivedRowState({ doc, events });
  const consistency = consistencyOf({ run, status: derived.status });
  return {
    consistency,
    derived,
    doc,
    evidence: ownEvidence({ consistency, derived, doc, events, probe, run }),
    movedIso: journal?.events.at(-1)?.atIso,
    probe,
    run,
    tags: rowTagsOf({ events, fields: fieldsOfDoc({ doc, run: journalRun }) }),
    tagsIncomplete: journal !== undefined && journal.unreadableLines.length > 0,
  };
}

/** The word for one probe outcome, spelled out — a glyph alone is what made `not-evaluated` invisible. */
function outcomeWord({ outcome }: { outcome: ProbeOutcome }): string {
  if (outcome === "pass") {
    return "pass";
  }
  return outcome === "fail" ? "fail" : "not evaluated";
}

/** Column width for the spelled-out outcome, so the notes beside them line up under a row. `not evaluated` is the longest, at 13. */
const OUTCOME_WIDTH = 14;

/**
 * Why a CONTRADICTION row contradicts, probe by probe — the affordance the board did not have.
 *
 * ## The measured defect
 *
 * A contradicting row printed one generic sentence and nothing else: *"declared done, but the repository
 * currently shows its probes failing or partial"*. Three different readings collapse into it. A probe that
 * was checked and FAILED, a probe that was never evaluated at all (`probe.ts`'s third
 * {@link ProbeOutcome}, kept deliberately because an unread file cannot testify a symbol is gone), and — the
 * case that started this — a row contradicting for a reason that is not about probes at all.
 *
 * Measured on this board: `slack-reply-count-oracle-implementation` was hand-checked against the main
 * checkout and BOTH its probes' symbols were present, while the board reported it
 * contradicting. Nothing in the tool reconciled those two readings. It could not have been
 * `probeStatusContradiction` (`./boardEvidence.ts`): two passing probes compute `landed`, which
 * `probesRegressed` excludes. The row was contradicting on its RUN JOURNAL, and the reader had no way to
 * learn that the probes were never the subject.
 *
 * ## Three rules, and why each line is there
 *
 * 1. A row nothing evaluated says so, and says what is left to disagree. Silence here reads as the tool
 *    having no answer.
 * 2. Every probe is listed in declaration order, with its glyph AND the outcome spelled as a word. The word
 *    is the requirement rather than decoration: `–` is what made "nothing looked" indistinguishable from a
 *    failure on every other surface. Passes are printed too — a reader reconciling "I checked both by hand
 *    and they pass" has to see the tool agreeing about the passes before the failures mean anything.
 * 3. When nothing FAILED, one line says so and POINTS at the reason already printed above it. It claims no
 *    origin at all, and the first draft of it did: *"the disagreement is with the authored status, not with
 *    a probe"* is false for a `cancelled`, `rejected` or `draft` row whose probes all pass, because
 *    `probeStatusContradiction`'s second and third rules make the PASSING PROBES that row's contradiction.
 *    A review pass caught it against a test that had already codified the false line. Distinguishing the
 *    two would mean re-deriving placement here, which is the drift this module's own header refuses — so
 *    the line reports what the probes observed and stops.
 *
 * Pure, like the rest of this module: it projects a {@link BoardModel} the composer already built and
 * decides nothing. `./render.ts` prints what it returns.
 *
 * @param model the composed model for a row already placed in `CONTRADICTION`
 * @returns the indented detail lines to print under that row, in probe declaration order
 */
export function contradictionDetail({ model }: { model: BoardModel }): readonly string[] {
  const state = model.probe;
  if (state === undefined || state.results.length === 0) {
    return ["      no probe was evaluated for this row — nothing in the repository was checked either way"];
  }
  const results = state.results;
  const lines = results.map(
    (result) =>
      `      ${probeMark({ outcome: result.outcome })} ${outcomeWord({ outcome: result.outcome }).padEnd(OUTCOME_WIDTH)}${result.note}`,
  );
  if (results.some((result) => result.outcome === "fail")) {
    return lines;
  }
  const unevaluated = results.filter((result) => result.outcome === "not-evaluated").length;
  if (unevaluated > 0) {
    return [...lines, `      no probe FAILED; ${String(unevaluated)} not evaluated — read the row's reason above`];
  }
  return [...lines, "      every probe PASSES — read the row's reason above for what disagrees"];
}

/** @internal Whether every scanned root reached the printed board — never trusted, always checked. */
export interface BoardCompleteness {
  readonly complete: boolean;
  /** Slugs the scan found that produced no model — the board silently dropping a doc, if this is ever non-empty. */
  readonly missing: readonly string[];
}

/**
 * Whether `composeBoardModels` accounted for every doc the scan found.
 *
 * `composeBoardModels` maps `roots` to `models` one-for-one by construction today, so this can never fail on
 * the current code — that is the point. A caller that renders `models` without asking this is trusting an
 * invariant nothing enforces; a future change to the composer that filters or early-returns would silently
 * make "a doc was on disk" and "a doc appeared on the board" stop meaning the same thing again, with no
 * signal anywhere. Checking it here turns that regression into a loud, printed line instead of a repeat of
 * this doc's own incident.
 *
 * @param roots every doc the board scan found
 * @param models what `composeBoardModels` returned for them
 * @returns whether every root is accounted for, and which slugs are not if it is not
 */
export function boardCompleteness({
  roots,
  models,
}: {
  roots: readonly HandoverDoc[];
  models: readonly BoardModel[];
}): BoardCompleteness {
  const modeled = new Set(models.map((model) => model.doc.slug));
  const missing = roots.map((doc) => doc.slug).filter((slug) => !modeled.has(slug));
  return { complete: missing.length === 0, missing };
}
