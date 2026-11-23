/**
 * Rendering the orchestration-doc board. Pure.
 *
 * One question, answered first and in full: **what can I start right now?** Everything below that line is
 * context. The owner's friction was not a missing list — it was opening a list and still not knowing which
 * item to pick up, days after writing them.
 *
 * ## Consumes `BoardModel`, never recomputes placement
 *
 * Every doc's section, reason, and dependency closures are already decided by `boardState.ts`'s single
 * precedence engine — this module's whole job is turning that decision into readable lines, not
 * re-deriving it. A renderer that computed its own blocker logic is exactly how the board and `handover
 * start` used to disagree.
 *
 * ## Default visibility hides only what is genuinely closed
 *
 * `DONE` and `CLOSED — NOT SHIPPED` are hidden unless the caller asks for them, so the default view stays a
 * small, deliberate working set rather than a growing archive. A `CONTRADICTION` — including a
 * terminal-status doc with an unexpectedly live run — is NEVER filtered by this rule, because it is live,
 * unresolved work regardless of what its authored status claims.
 */

import { absentAs } from "#lib/absent.js";
import { collapseWhitespace } from "#lib/oneLineSummary.js";
import { findingRulingState } from "./askRow.js";
import { isClosedBoardSection } from "./boardRefusal.js";
import { contradictionDetail } from "./boardState.js";
import { type BoardModel } from "./boardTypes.js";
import { type Collision, renderCollisions } from "./collide.js";
import type { DerivedRowState } from "./derivedRowState.js";
import { declaredConditions, type HandoverDoc } from "./doc.js";
import { type RulingEvidence, rulingAnchor, rulingWords } from "./ruling.js";
import { matchesTagFilter, type TagFilter } from "./tagFilter.js";

/** Column width for a slug, so summaries line up without a table. */
const SLUG_WIDTH = 28;

/** How much of a `statusSummary` a board row shows before truncating, in Unicode code points. */
const STATUS_SUMMARY_PREVIEW_CODE_POINTS = 160;

/**
 * Render the whole board.
 *
 * @param models every doc's composed board model, in scan order
 * @param unreadable files that looked like docs but could not be read
 * @param staleRepos commits-behind-upstream per repository, so a verdict read off a stale checkout is labelled
 *   rather than trusted
 * @param collisions live docs naming the same files — a heuristic warning, printed last because it is the
 *   weakest signal on the board
 * @param showAll whether to include `DONE` and `CLOSED — NOT SHIPPED` rows
 * @param filter a `--tag` filter narrowing which rows PRINT; the hidden-terminal count and the verifiability line
 *   stay facts about the whole board, so a filter can never change them
 * @returns the lines to print
 */
export function renderBoard({
  models,
  unreadable,
  staleRepos,
  collisions,
  showAll = false,
  filter,
}: {
  models: readonly BoardModel[];
  unreadable: readonly string[];
  staleRepos?: ReadonlyMap<string, number>;
  collisions?: readonly Collision[];
  showAll?: boolean;
  filter?: TagFilter;
}): readonly string[] {
  const visible = showAll ? models : models.filter((model) => !isClosedBoardSection({ section: model.section }));
  const printed =
    filter === undefined ? visible : visible.filter((model) => matchesTagFilter({ filter, tags: model.tags }));
  const bySection = ({ section }: { section: BoardModel["section"] }): readonly BoardModel[] =>
    printed.filter((model) => model.section === section);

  const lines: string[] = [...unreadableWarning({ unreadable })];
  lines.push(...contradictionSection({ models: bySection({ section: "CONTRADICTION" }) }));
  lines.push(...shippedSection({ models: bySection({ section: "LOOKS SHIPPED" }) }));
  lines.push(...runnableSection({ models: bySection({ section: "RUN NOW" }) }));
  lines.push(...labelledSection({ models: bySection({ section: "WAITING ON OWNER" }), title: "WAITING ON OWNER:" }));
  lines.push(...labelledSection({ models: bySection({ section: "IN FLIGHT" }), title: "IN FLIGHT:" }));
  lines.push(...pausedSection({ models: bySection({ section: "PAUSED" }) }));
  lines.push(...labelledSection({ models: bySection({ section: "AWAITING SHIP" }), title: "AWAITING SHIP:" }));
  lines.push(...labelledSection({ models: bySection({ section: "NOT YET" }), title: "NOT YET:" }));
  lines.push(...closedNotShippedSection({ models: bySection({ section: "CLOSED — NOT SHIPPED" }), showAll }));
  lines.push(...doneSection({ models: bySection({ section: "DONE" }), showAll }));
  const hidden = models.length - visible.length;
  if (!showAll && hidden > 0) {
    lines.push("", `${String(hidden)} terminal doc(s) hidden; use --all.`);
  }
  lines.push(...staleRepoWarning({ staleRepos }));
  lines.push(...verifiabilityLine({ models: visible }));
  if (collisions !== undefined && collisions.length > 0) {
    lines.push("", ...renderCollisions({ collisions }));
  }
  return lines;
}

/** The first 160 code points of a `statusSummary`, with an explicit count of what was withheld. */
function previewSummary({ summary }: { summary: string }): string {
  // Iterating by Unicode CODE POINT is the stated design (see the module header), not a mistake to guard
  // against — a multi-code-point emoji splitting across the boundary is an accepted cosmetic edge case.
  // oxlint-disable-next-line no-misused-spread
  const points = [...summary];
  if (points.length <= STATUS_SUMMARY_PREVIEW_CODE_POINTS) {
    return summary;
  }
  const omitted = points.length - STATUS_SUMMARY_PREVIEW_CODE_POINTS;
  return `${points.slice(0, STATUS_SUMMARY_PREVIEW_CODE_POINTS).join("")}… [${String(omitted)} characters omitted; full: slopweaver handover resume <slug>]`;
}

/**
 * Repositories whose checkout is behind their upstream, and therefore whose probe verdicts are stale.
 *
 * Printed near the bottom but before the verifiability count, because it changes how every verdict above should
 * be read. Measured on a real merge: four probes that all passed on `origin/<branch>` reported as failing,
 * because that checkout was 68 commits behind and nothing said so.
 */
function staleRepoWarning({
  staleRepos = new Map<string, number>(),
}: {
  staleRepos: ReadonlyMap<string, number> | undefined;
}): readonly string[] {
  const behind = [...staleRepos].filter(([, n]) => n > 0);
  if (behind.length === 0) {
    return [];
  }
  const lines = ["", "⚠ A probe reads the WORKING TREE, and these checkouts are behind their upstream:"];
  for (const [repo, n] of behind) {
    lines.push(`  ${repo} — ${String(n)} commit(s) behind. Pull before trusting any verdict above.`);
  }
  return lines;
}

/**
 * How much of the board the repository can actually speak for.
 *
 * Stated as a COUNT at the bottom, because the per-doc "no probes" note is easy to read past when most docs
 * carry it. The number is the honest headline: a board where few docs declare `doneWhen:` is a board that mostly
 * still repeats what it was told, which is the condition this whole feature exists to end. Without this line a
 * reader has to count 37 docs by hand to discover that.
 */
function verifiabilityLine({ models }: { models: readonly BoardModel[] }): readonly string[] {
  if (models.length === 0) {
    return [];
  }
  const verifiable = models.filter((model) => declaredConditions({ doc: model.doc }) > 0).length;
  if (verifiable === models.length) {
    return ["", `All ${String(models.length)} live doc(s) declare conditions the repository can be asked about.`];
  }
  return [
    "",
    `⚠ ${String(verifiable)} of ${String(models.length)} live doc(s) declare \`doneWhen:\`/\`outputs:\`.`,
    `  The other ${String(models.length - verifiable)} report the status they were TOLD — the board cannot check them.`,
    "  Add probes when you next run one: `slopweaver handover start <slug>` asks for them.",
  ];
}

/**
 * FIRST, before anything that looks like an answer. An unreadable doc cannot take part in duplicate or
 * dependency resolution, so it may be the very thing that should have blocked something printed below — and a
 * caveat placed after a RUN NOW list is a caveat nobody reads. Blanking the board instead would be worse: one
 * corrupt file must not hide the whole queue.
 */
function unreadableWarning({ unreadable }: { unreadable: readonly string[] }): readonly string[] {
  if (unreadable.length === 0) {
    return [];
  }
  return [
    `⚠ ${String(unreadable.length)} doc(s) could not be read: ${unreadable.join(", ")}`,
    "  Anything below may be incomplete — an unreadable doc cannot block what it should.",
    "",
  ];
}

/**
 * Live, unresolved contradictions — printed FIRST and above LOOKS SHIPPED, because a doc whose authored
 * status and repository evidence disagree is the one case this whole redesign exists to surface loudly.
 *
 * Each row carries {@link contradictionDetail} beneath it. The reason line alone was the defect: thirty-odd
 * rows printed one identical sentence about probes "failing or partial", and a reader could neither tell a
 * failing probe from an unevaluated one nor discover that some of those rows had no probe behind them at
 * all. That function's header carries the measurement.
 */
function contradictionSection({ models }: { models: readonly BoardModel[] }): readonly string[] {
  if (models.length === 0) {
    return [];
  }
  const lines = [
    `⚠ ${String(models.length)} doc(s) are in CONTRADICTION — authored status disagrees with the repository:`,
    "",
  ];
  for (const model of models) {
    lines.push(`  ${model.doc.slug.padEnd(SLUG_WIDTH)}  ${model.reason}`);
    lines.push(...contradictionDetail({ model }));
    lines.push(...originLines({ derived: model.derived, doc: model.doc }));
  }
  lines.push("");
  return lines;
}

/**
 * A row's head line: its slug, then its summary on the SAME line. The reader hands a summary back with any line
 * break it was written with (`./flatScalarCodec.ts`), so the break is collapsed here, at the one-line boundary,
 * where a raw one would print a second line that reads as another row.
 */
function rowHead({ doc }: { doc: HandoverDoc }): string {
  return `  ${doc.slug}${doc.summary === undefined ? "" : ` — ${collapseWhitespace({ text: doc.summary })}`}`;
}

/** The docs whose probes all pass with no finished run. Loud, because reading past one costs a whole session. */
function shippedSection({ models }: { models: readonly BoardModel[] }): readonly string[] {
  if (models.length === 0) {
    return [];
  }
  const lines = [`✔ ${String(models.length)} doc(s) LOOK SHIPPED — every declared probe already passes:`, ""];
  for (const model of models) {
    lines.push(rowHead({ doc: model.doc }));
    lines.push(`      declared: ${model.derived.status}`);
    // NOT `handover finish` — there is no run to close for a doc that was never started, and `finish`
    // correctly refuses that. `handover close` is the verb that exists for exactly this shape: it needs no
    // open run, records the judgement in the row's own register, and every reader then DERIVES `done` from
    // it. Until it did, this line asked a human to edit the file the board had just rendered.
    lines.push(`      confirm:  slopweaver handover close ${model.doc.slug} --summary "<what shipped>"`);
    lines.push(...originLines({ derived: model.derived, doc: model.doc }));
  }
  lines.push("");
  return lines;
}

/**
 * What a runnable row's `why:` line points the owner at. A doc links its artifact only once one has been written, so
 * a doc with none yet sends the owner to the doc itself, and the board says so rather than leaving the line blank.
 */
function linkedArtifact({ doc }: { doc: HandoverDoc }): string {
  const { artifact } = doc;
  if (artifact === undefined) {
    return "(no artifact linked — you will be reading the doc itself)";
  }
  return artifact;
}

/** The part that matters: what can be started, and exactly how. */
function runnableSection({ models }: { models: readonly BoardModel[] }): readonly string[] {
  if (models.length === 0) {
    return ["Nothing is runnable right now."];
  }
  const lines = [`RUN NOW — ${String(models.length)} ready:`, ""];
  for (const model of models) {
    const doc = model.doc;
    lines.push(rowHead({ doc }));
    lines.push(`      paste: ${doc.path}`);
    if (doc.repo !== undefined) {
      lines.push(`      repo:  ${doc.repo}`);
    }
    // Stated as an absence rather than omitted. The artifact is what the owner actually re-reads days later,
    // so a doc without one is a doc the owner will struggle to pick up — that is worth seeing on the board.
    lines.push(`      why:   ${linkedArtifact({ doc })}`);
    // Stated for the same reason: a doc with no probes is one the board can never verify, and hiding that
    // makes an unverifiable doc look identical to a checked one.
    lines.push(`      check: ${probeSummary({ doc })}`);
    lines.push(...originLines({ derived: model.derived, doc }));
    lines.push("");
  }
  return lines.slice(0, -1);
}

/**
 * Where a FINDING row came from, and whether the owner has ruled on it — printed on every section a finding can
 * sit in, because a row that ranks as the owner's ask and says nothing about its origin is the exact defect a
 * finding row exists to close. Empty for the owner's own asks and for ordinary docs.
 */
function originLines({ doc, derived }: { doc: HandoverDoc; derived: DerivedRowState }): readonly string[] {
  const recorded = rulingLines({ ruling: derived.ruling });
  const state = findingRulingState({ derived, doc });
  if (state === "not-a-finding") {
    return recorded;
  }
  // Both are decoded scalars that may carry a line break (`./flatScalarCodec.ts`), collapsed as {@link rowHead} does.
  const evidence = doc.evidence.length === 0 ? "unrecorded evidence" : doc.evidence.join(", ");
  const observedBy = absentAs({ value: doc.observedBy, whenAbsent: "an unrecorded session" });
  const origin = `      origin: a fleet finding, observed by ${collapseWhitespace({ text: observedBy })} from ${collapseWhitespace({ text: evidence })}`;
  if (state === "ruled") {
    return [origin, ...recorded];
  }
  if (state === "declined") {
    return [origin, ...recorded, "      doors:  declined by the owner — no team-facing action"];
  }
  // A row can legitimately print a recorded ruling AND still be shut to a teammate: a backfilled one is a
  // true record of a decision the owner made about something else, and never permission to send this finding out.
  return [
    origin,
    ...recorded,
    "      doors:  SHUT — a pull request on a team base or a review ask is refused until `handover rule` records the owner's word on this finding",
  ];
}

/**
 * The owner's ruling on a row, printed for EVERY row kind that has one.
 *
 * A ruling is a register event on any row, not only a finding, and the whole point is that the surfaces a
 * reader actually reads say what the owner decided. A backfilled one is
 * labelled as such, because it was reconstructed from an answer rather than recorded when the owner ruled — the
 * same distinction `../handover/askRow.ts` makes when deciding whether a door may open.
 */
function rulingLines({ ruling }: { ruling: RulingEvidence | undefined }): readonly string[] {
  if (ruling === undefined) {
    return [];
  }
  return [
    `      ruling: ${rulingWords({ evidence: ruling })} (${rulingAnchor({ evidence: ruling })})`,
    `              ${rulingProvenance({ ruling })}`,
  ];
}

/** Where a printed ruling came from, in one phrase — never left to the reader to infer from its wording. */
function rulingProvenance({ ruling }: { ruling: RulingEvidence }): string {
  if (ruling.from === "authored") {
    return "recorded in the row's own front-matter, before rulings became register events";
  }
  const backfilledFrom = ruling.event.backfilledFrom;
  if (backfilledFrom === undefined) {
    return `recorded when the owner ruled, decided ${ruling.decidedIso}`;
  }
  return `reconstructed from this row's answer of ${backfilledFrom} — a record, not a team-facing permission`;
}

/** How verifiable a doc is, in one phrase. Never silent — an unprobed doc must not look like a checked one. */
function probeSummary({ doc }: { doc: HandoverDoc }): string {
  const declared = declaredConditions({ doc });
  if (declared > 0) {
    return `${String(declared)} condition(s) declared, none passing yet`;
  }
  // Distinguished, because the previous single message claimed a doc had no `outputs:` while it plainly declared
  // one — a false statement in the board's own output. `outputs:` is provenance and never a condition, so a doc
  // with outputs and no probes is still unverifiable; what changes is WHY, and the reader deserves the real why.
  return doc.outputs.length > 0
    ? "no `doneWhen:` probes — `outputs:` is provenance, not a condition, so this cannot be verified"
    : "no `doneWhen:` probes and no `outputs:` — the board cannot tell whether this has landed";
}

/** A flat `slug  reason` list under a heading, showing every row's status summary preview when it has one. */
function labelledSection({ models, title }: { models: readonly BoardModel[]; title: string }): readonly string[] {
  if (models.length === 0) {
    return [];
  }
  const lines = ["", title];
  for (const model of models) {
    lines.push(`  ${model.doc.slug.padEnd(SLUG_WIDTH)}  ${model.reason}`);
    if (model.doc.statusSummary !== undefined) {
      lines.push(`      ${previewSummary({ summary: model.doc.statusSummary })}`);
    }
    lines.push(...originLines({ derived: model.derived, doc: model.doc }));
  }
  return lines;
}

/**
 * Rows parked on a person — visible by DEFAULT, and stated with no clock on them.
 *
 * Never filtered by the closed-section rule, because a paused row is live work: the owner's whole ask was
 * that a workstream waiting on somebody stays visible instead of being marked `done` to get it off the
 * board. It prints below `IN FLIGHT` and above `NOT YET` — nobody is pushing it, so it is not work to pick
 * up, but somebody IS the reason, which `NOT YET`'s dependency rows cannot say.
 *
 * The heading carries the ruling rather than assuming a reader remembers it. A paused row carries no
 * time limit and no deadline, so there is no age column here, no elapsed count and no nag, and
 * {@link ../handover/paused.pausedPhrase} is the single renderer that keeps it that way across this board
 * and the owner's briefing alike.
 */
function pausedSection({ models }: { models: readonly BoardModel[] }): readonly string[] {
  if (models.length === 0) {
    return [];
  }
  const lines = ["", `PAUSED — ${String(models.length)} waiting on someone, with no deadline and nothing overdue:`];
  for (const model of models) {
    lines.push(`  ${model.doc.slug.padEnd(SLUG_WIDTH)}  ${model.reason}`);
    lines.push(...originLines({ derived: model.derived, doc: model.doc }));
  }
  return lines;
}

/** Terminal-not-shipped docs — hidden by default, shown in full with `--all`. */
function closedNotShippedSection({
  models,
  showAll,
}: {
  models: readonly BoardModel[];
  showAll: boolean;
}): readonly string[] {
  if (models.length === 0 || !showAll) {
    return [];
  }
  const lines = ["", `CLOSED — NOT SHIPPED (${String(models.length)}):`];
  for (const model of models) {
    lines.push(`  ${model.doc.slug.padEnd(SLUG_WIDTH)}  ${model.doc.status}: ${model.reason}`);
  }
  return lines;
}

/** Shipped docs — hidden by default, shown as a flat slug list with `--all`. */
function doneSection({ models, showAll }: { models: readonly BoardModel[]; showAll: boolean }): readonly string[] {
  if (models.length === 0 || !showAll) {
    return [];
  }
  return ["", `DONE: ${models.map((model) => model.doc.slug).join(", ")}`];
}
