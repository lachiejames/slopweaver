/**
 * The gate that stops the BOARD from rotting back into a register nobody trusts.
 *
 * ## The defect this exists for
 *
 * `docs/workstreams.md` says the board IS the register, and the board is only worth that if reading it costs
 * nothing. It stopped being worth it: the register had accumulated docs whose `status:` named a word the parser
 * does not accept — so they were silently unclassified rather than loudly wrong — alongside a `SUPERSEDED`
 * lineage of docs for one workstream, and dead rows outnumbering live ones. A board like that is read once and
 * then skipped, which is the same outcome as having no board at all.
 *
 * Collapsing it was a one-off sweep. This is the part that keeps it collapsed, because the sweep will not be
 * repeated by hand and a convention that needs repeating is not a mechanism.
 *
 * ## What it checks, and why the fourth one is the interesting one
 *
 * Three of the four rules are the front-matter checks {@link checkHandoverFrontMatter} already implements for
 * the single-doc `handover check` verb — an unparseable `status:`, a missing `artifact:`, a `blockedBy` naming
 * a slug no doc claims. They are REUSED rather than restated: two implementations of one rule is how the
 * doc-count claims drifted apart in the first place. What this adds is the register-WIDE reading of them, which
 * `check` cannot have — "no doc claims this slug" is a question about the whole board, and a per-doc verb
 * answering it can only ever guess.
 *
 * The fourth rule is new and it is the one that earns the gate: **a doc whose every declared probe passes while
 * its status is not `done`.** That is the state the board prints as LOOK SHIPPED, and it is how work lands
 * without the register being told — three docs sat in it, each traceable to a merged pull request, while the
 * board still offered them as runnable. Nothing flips a doc automatically (a probe proves a symptom is absent,
 * which is weaker than a scope having shipped — see {@link ../handover/probe}), so the bookkeeping has to be
 * owed to somebody, and this is what does the owing.
 *
 * A doc can opt out of that fourth rule by declaring `notDoneReason:` — see {@link HandoverDoc.notDoneReason} —
 * which says "these probes are a narrower slice than my real scope, on purpose." Measured incident: a doc whose
 * Slice-1 probes genuinely passed while its author and the owner had explicitly decided NOT to mark it done (a
 * six-slice "final handoff" the doc itself defines) had no way to say that, so the gate kept nagging it on
 * EVERY push, including ones with nothing to do with it. The field is the escape valve for the deliberate case;
 * scoping (below) is the escape valve for the "not deliberate, just not my business" case.
 *
 * ## Findings are BLOCKING only when they are about the push actually happening
 *
 * The register is one shared file across every repository and every worktree on the machine, but a `git push`
 * happens in exactly one of them. A `looksShipped` finding about a doc whose `repo:` names a completely
 * different repository — measured: a doc naming a repository other than this one blocked a one-line docs push
 * here that had nothing to do with it — has nothing to do with the push it stopped, and the same is true, one
 * level narrower, of a doc whose declared `branch:` names a different branch in the SAME repository. Both are
 * still printed (a real defect must never go silent), just not counted toward the exit code.
 *
 * The exemption requires POSITIVE evidence of irrelevance, never an absence of information: a doc naming no
 * `repo:` cannot reach `landedPaths` at all (see {@link landedDocs}) and stays blocking regardless of its
 * front-matter, a doc naming no `branch:` stays blocking within its own repository, and a push whose own
 * repository or branch could not be determined blocks everything, exactly as before this existed. Guessing
 * relevance from silence would recreate the fuzzy-match failure this codebase forbids everywhere else it
 * identifies a doc with a repository or a branch.
 *
 * The front-matter checks ({@link checkHandoverFrontMatter}) are scoped exactly the same way as `looksShipped`
 * findings, and this was a real incident rather than a symmetry preference: a supervisor-written doc missing
 * `artifact:`, five minutes old and naming a different repository, blocked an unrelated push here until a peer
 * hand-patched it. The register being shared is not, on its own, a reason for a doc about repository A to fail
 * a push happening in repository B — a real defect must still be REPORTED (see {@link looksShipped} for the
 * identical reasoning), just not counted toward that push's exit code.
 *
 * ## Deliberately NOT checked
 *
 * - **A duplicate slug.** It is a real register defect, but `blockerFor` already reports `duplicate-slug` on
 *   the board itself, so it is loud where it matters. Adding it here would be a second place to fix it.
 * - **`command:` probes.** No runner is supplied, so a command probe is `not-evaluated` and a doc carrying one
 *   can never reach `landed` here. That is the honest direction to err: this gate must not fan arbitrary shell
 *   out of every doc on the board on every push.
 * - **Whether a workstream deserves a doc at all.** That is judgement, and `docs/workstreams.md` owns it.
 *
 * Pure core / effectful shell: {@link checkRegister} takes already-read docs and a set of verdicts, so every
 * rule is testable without a filesystem; {@link runRegisterHygiene} is the thin edge that reads the register
 * and works out which repository and branch the push itself is on.
 */

import { readFileSync } from "node:fs";
import { runDisposition } from "../handover/boardTypes.js";
import { checkHandoverFrontMatter } from "../handover/check.js";
import { type HandoverDoc, isTerminalDocStatus } from "../handover/doc.js";
import { repoProbeSeams } from "../handover/evaluate.js";
import { preApprovedStopLine, preApprovedStopOf } from "../handover/preApprovedStop.js";
import { computeState, evaluateProbes } from "../handover/probe.js";
import { readRunJournal } from "../handover/runStore.js";
import { scanBoard } from "../handover/store.js";
import { currentBranchOf, repoRootOf } from "../lib/gitRepo.js";
import { stateHomePaths } from "../stateHome.js";
import { lintDeclarationFor } from "./refusal/registry.js";
import { gateOutcome, lintGateRefusal } from "./refusal/render.js";
import { pushExemptPaths } from "./registerPushScope.js";

/** One thing wrong with the register, named against the doc that carries it. */
export interface RegisterFinding {
  readonly slug: string;
  readonly path: string;
  readonly message: string;
  /** The front-matter key whose line the fix touches, so the report can point at it. */
  readonly field: "status" | "artifact" | "blockedBy" | "doneWhen" | "statusSummary" | undefined;
  /** The exact value that key should end up with, when there is a single right answer. */
  readonly fix: string | undefined;
  /**
   * Whether this finding should fail THIS push. `false` for a `looksShipped` finding about a doc whose
   * repository or branch is not the one being pushed — still printed, never counted toward the exit code. See
   * the module header's "Findings are BLOCKING only when..." section.
   */
  readonly blocking: boolean;
}

/**
 * Why a doc that looks shipped is a finding rather than a fact the gate could act on.
 *
 * Stated as a sentence the reader can act on in one edit, because the action is genuinely one edit — and the
 * board already prints the same instruction, so the two must not describe different fixes.
 *
 * @param doc the doc under consideration
 * @param landedPaths the paths of docs whose every declared probe was checked and passed
 * @param nonBlockingPaths the paths of docs whose finding must not fail this particular push
 * @returns the finding, or none when the doc is not shipped-looking or has explained the gap itself
 */
function looksShipped({
  doc,
  landedPaths,
  nonBlockingPaths,
  shippedSlugs,
}: {
  doc: HandoverDoc;
  landedPaths: ReadonlySet<string>;
  nonBlockingPaths: ReadonlySet<string>;
  shippedSlugs: ReadonlySet<string>;
}): readonly Omit<RegisterFinding, "slug" | "path">[] {
  // `shippedSlugs` is the DERIVED half of the same question `status: done` answers by hand: a row whose
  // journal carries a `closed` event has already been confirmed shipped, by a verb, and nagging its author to
  // edit `status:` afterwards would make `handover close` a step that changes nothing anyone can see. See
  // `../handover/derivedRowState.ts` for why the line itself is deliberately left alone.
  if (
    !landedPaths.has(doc.path) ||
    doc.status === "done" ||
    shippedSlugs.has(doc.slug) ||
    doc.notDoneReason !== undefined
  ) {
    return [];
  }
  const blocking = !nonBlockingPaths.has(doc.path);
  const wrongToAdvise = notAdviceToCloseIt({ blocking, doc });
  if (wrongToAdvise !== undefined) {
    return [wrongToAdvise];
  }
  return [
    {
      blocking,
      field: "status",
      fix: "done",
      message:
        `every declared probe passes but it still says \`status: ${doc.status}\` — ` +
        `confirm the work landed with \`slopweaver handover close ${doc.slug} --summary "<what shipped>"\`, ` +
        "or make the probes distinguish built from unbuilt, " +
        "or declare `notDoneReason:` if the gap is deliberate",
    },
  ];
}

/**
 * The two statuses where "every probe passes" is NOT advice to record a shipment, and what to say instead.
 *
 * @param doc the doc whose probes all pass
 * @param blocking whether a finding about this doc counts toward this push's exit code
 * @returns the finding to report instead, or `undefined` when the ordinary advice is right
 */
function notAdviceToCloseIt({
  doc,
  blocking,
}: {
  doc: HandoverDoc;
  blocking: boolean;
}): Omit<RegisterFinding, "slug" | "path"> | undefined {
  // A DRAFT whose probes already pass is a different defect, and telling its author to confirm the work
  // landed is advice that would mark UNSTARTED work as finished. A draft has by definition not run, so a
  // passing probe there proves only that the probe names something which already existed — the "too weak to
  // distinguish built from unbuilt" case. Caught on this gate's first real run, on a finding-doc whose sole
  // probe named the very function the work was going to change.
  if (doc.status === "draft") {
    return {
      blocking,
      field: "doneWhen",
      fix: undefined,
      message:
        "every declared probe already passes while this is still a draft, so the probes cannot tell built " +
        "from unbuilt — point them at something that will only exist once the work lands",
    };
  }
  // A CANCELLED/REJECTED doc whose probes now land is a genuine contradiction — the board's own precedence
  // treats it as one (`boardState.ts` rule 2) — never advice to record a shipment, which would silently
  // reverse a deliberate terminal-not-shipped call.
  if (doc.status === "cancelled" || doc.status === "rejected") {
    return {
      blocking,
      field: "status",
      fix: undefined,
      message:
        `declared ${doc.status}, but every declared probe now passes — the work appears to have shipped ` +
        "anyway (independently, or despite the rejection). This is a contradiction the board should surface, " +
        "not advice to close it; resolve which fact is stale.",
    };
  }
  return undefined;
}

/**
 * A run parked on a question the owner has already answered as standing doctrine.
 *
 * The board is the one place this stop is visible at all — `handover question` records it and the run ends
 * legitimately, so nothing else ever objects. `../handover/preApprovedStop.ts` carries the criterion and the
 * ruling behind it. Reported, never fixed: the question is already written, and only the session that asked
 * it can answer it by going and recording the cassette.
 *
 * @param question the doc's currently open recorded question, or `undefined` when the run is not waiting
 * @param blocking whether a finding about this doc counts toward this push's exit code
 * @returns the finding, or none when the question is an ordinary one
 */
function preApprovedStopFinding({
  question,
  blocking,
}: {
  question: string | undefined;
  blocking: boolean;
}): readonly Omit<RegisterFinding, "slug" | "path">[] {
  if (question === undefined) {
    return [];
  }
  const stop = preApprovedStopOf({ question });
  if (stop === undefined) {
    return [];
  }
  return [{ blocking, field: undefined, fix: undefined, message: preApprovedStopLine({ stop }) }];
}

/**
 * Every register-hygiene finding across the whole board. Pure.
 *
 * @param docs every doc the register holds, already parsed
 * @param landedPaths the paths of docs whose every declared probe was checked and passed
 * @param openQuestions each doc's currently open recorded question, keyed by slug; a caller with no journals
 *   passes none and gets exactly the behaviour this had before pre-approved stops were classified
 * @param nonBlockingPaths the paths of docs whose `looksShipped` finding must not fail this push — defaults to
 *   none, which is the original register-wide-blocking behaviour for a caller with no push context
 * @returns one finding per defect, grouped by doc in board order
 */
export function checkRegister({
  docs,
  landedPaths,
  shippedSlugs = new Set(),
  openQuestions = new Map(),
  nonBlockingPaths = new Set(),
}: {
  docs: readonly HandoverDoc[];
  landedPaths: ReadonlySet<string>;
  shippedSlugs?: ReadonlySet<string>;
  openQuestions?: ReadonlyMap<string, string>;
  nonBlockingPaths?: ReadonlySet<string>;
}): readonly RegisterFinding[] {
  // Computed once over the whole register, which is the thing a per-doc check cannot do: a dependency is
  // unknown only relative to every OTHER doc, so the single-doc verb has to be handed this answer.
  const claimed = new Set(docs.map((doc) => doc.slug));
  return docs.flatMap((doc) => {
    const blocking = !nonBlockingPaths.has(doc.path);
    return [
      ...checkHandoverFrontMatter({
        artifact: doc.artifact,
        problems: doc.problems,
        requireStatusSummary: false,
        status: doc.status,
        statusSummary: doc.statusSummary,
        unknownDependencies: doc.blockedBy.filter((slug) => !claimed.has(slug)),
      }).map((finding) => ({ blocking, field: finding.field, fix: undefined, message: finding.message })),
      ...preApprovedStopFinding({ blocking, question: openQuestions.get(doc.slug) }),
      ...looksShipped({ doc, landedPaths, nonBlockingPaths, shippedSlugs }),
    ].map((finding) => ({ ...finding, path: doc.path, slug: doc.slug }));
  });
}

/**
 * The 1-indexed line where a front-matter key is declared, and what it currently says.
 *
 * Pure, and deliberately front-matter-only: it stops at the closing fence, so a `status:` written in the PROSE
 * of a doc that forgot to declare one cannot be reported as the line to edit.
 *
 * @param text the whole doc
 * @param field the front-matter key to locate
 * @returns the line number and its current text, or `undefined` when the key is not declared
 */
export function frontMatterLineOf({
  text,
  field,
}: {
  text: string;
  field: string;
}): { line: number; current: string } | undefined {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  if (lines[0] !== "---") {
    return undefined;
  }
  const key = new RegExp(`^${field}\\s*:`);
  for (let i = 1; i < lines.length; i += 1) {
    const raw = lines[i]!;
    if (raw === "---") {
      return undefined;
    }
    if (key.test(raw)) {
      return { current: raw, line: i + 1 };
    }
  }
  return undefined;
}

/**
 * Which docs' probes ALL passed, keyed by doc path.
 *
 * `commitsAhead` is passed as zero deliberately rather than measured. {@link computeState} consults it only to
 * separate `not-started` from `in-flight`, and neither is `landed` — so a git call per doc would buy this gate
 * nothing while making every push pay for a `rev-list` per row.
 *
 * A doc naming no repo, or declaring no probes, is absent from the result: there is nothing to resolve its
 * paths against, and answering against the process's cwd would report about whichever tree happened to run the
 * gate.
 */
function landedDocs({ docs }: { docs: readonly HandoverDoc[] }): ReadonlySet<string> {
  const landed = new Set<string>();
  for (const doc of docs) {
    if (doc.doneWhen.length === 0 || doc.repo === undefined) {
      continue;
    }
    const results = evaluateProbes({
      probes: doc.doneWhen,
      // No command runner: see the module header. A declined command probe is `not-evaluated`, which can never
      // compute `landed`, so a doc carrying one is never accused of looking shipped on a check nothing ran.
      seams: repoProbeSeams({ repo: doc.repo, runCommand: undefined }),
    });
    if (computeState({ commitsAhead: 0, results }) === "landed") {
      landed.add(doc.path);
    }
  }
  return landed;
}

/**
 * The repository and branch this actual push is on, or both `undefined` when they could not be determined.
 *
 * Failure here must never crash the gate, and must never be read as "no doc is related" either — an
 * indeterminate push degrades to the ORIGINAL register-wide blocking (see `relevantToPush` in
 * {@link ./registerPushScope.js}), not to skipping the check.
 */
function currentPush(): { currentRepo: string | undefined; currentBranch: string | undefined } {
  try {
    return {
      currentBranch: currentBranchOf({ importMetaUrl: import.meta.url }),
      currentRepo: repoRootOf({ importMetaUrl: import.meta.url }),
    };
  } catch {
    return { currentBranch: undefined, currentRepo: undefined };
  }
}

/**
 * One finding, rendered as `path:line` plus the exact edit.
 *
 * The location is the whole point of this function. A gate that reports only "a doc looks shipped" makes its
 * reader open the register and hunt for which one, and that hunt is what gets a gate switched off — so the
 * output leads with a path a terminal can jump to, shows the line as it currently reads, and shows what it
 * should read instead. The doc is re-read here rather than carried through the pure core: only a failing doc
 * pays for it, and in the normal case there are none.
 */
function reportFinding({ finding }: { finding: RegisterFinding }): string {
  // Destructured so `field` NARROWS across the branches below. Reading `finding.field` inside them keeps the
  // optional type and forces a coalesce, which the fail-loud rule bans outright.
  const { field, fix, path, slug, message } = finding;
  const located = field === undefined ? undefined : frontMatterLineOf({ field, text: readDocText({ path }) });
  const head = located === undefined ? path : `${path}:${String(located.line)}`;
  const lines = [`  ${head}   (${slug})`];
  if (located !== undefined) {
    lines.push(`      now:  ${located.current}`);
    if (fix !== undefined && field !== undefined) {
      lines.push(`      fix:  ${field}: ${fix}`);
    }
  } else if (field !== undefined) {
    // The key is not there at all, so there is no line to point at — say which key to ADD rather than
    // printing a bare path and leaving the reader to work out what is missing.
    lines.push(`      add:  \`${field}:\` to the front matter`);
  }
  lines.push(`      why:  ${message}`);
  if (!finding.blocking) {
    lines.push("      note: a different repo/branch than this push — reported, not blocking it");
  }
  return `${lines.join("\n")}\n`;
}

/** A doc's text, or empty when it cannot be re-read — the finding still prints, just without a line. */
function readDocText({ path }: { path: string }): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

/**
 * Every slug among these docs whose run journal records that its work SHIPPED.
 *
 * The one filesystem read this gate makes outside the board scan, and it is scoped to the docs whose probes
 * already pass — a handful, not the whole register — because it exists only to stop {@link looksShipped}
 * nagging about a row `handover close` has already confirmed. A journal that cannot be read answers "not
 * shipped", which leaves the finding standing: the safe direction for a gate is to report, never to go quiet
 * because a file was missing.
 *
 * @param docs the docs to ask about, already narrowed to the landed ones
 * @returns the slugs whose journals carry a `closed` event
 */
function shippedSlugsOf({ docs }: { docs: readonly HandoverDoc[] }): ReadonlySet<string> {
  const runsDir = stateHomePaths().runs;
  const shipped = new Set<string>();
  for (const doc of docs) {
    const journal = readRunJournal({ runsDir, slug: doc.slug });
    if (journal.isOk() && journal.value.events.some((event) => event.kind === "closed")) {
      shipped.add(doc.slug);
    }
  }
  return shipped;
}

/**
 * Each doc's currently OPEN recorded question, keyed by slug — the input the pre-approved-stop rule needs.
 *
 * Scoped to docs whose own status is not terminal, which is the whole cost control: the register holds a few
 * thousand rows and most of them are settled, while a stop can only be live on a row that is not. A journal
 * that cannot be read contributes nothing rather than failing the gate — an unreadable journal is already
 * `unreadable` to the board, and reporting the same file twice under two names helps nobody.
 *
 * @param docs every doc the register holds
 * @returns slug to open question, for the rows that have one
 */
function openQuestionsOf({ docs }: { docs: readonly HandoverDoc[] }): ReadonlyMap<string, string> {
  const runsDir = stateHomePaths().runs;
  const questions = new Map<string, string>();
  for (const doc of docs) {
    if (isTerminalDocStatus(doc.status)) {
      continue;
    }
    const journal = readRunJournal({ runsDir, slug: doc.slug });
    if (journal.isErr()) {
      continue;
    }
    const run = runDisposition({ events: journal.value.events, unreadableLines: journal.value.unreadable });
    if (run.kind === "waiting-on-owner") {
      questions.set(doc.slug, run.question);
    }
  }
  return questions;
}

/**
 * Check the register's hygiene, print every finding, and return an exit code.
 *
 * A register that is ABSENT is not a failure and is reported as examining nothing rather than as clean. The
 * docs live under `$SLOPWEAVER_HOME`, which is machine-local and deliberately outside this public repository,
 * so on a fresh checkout — and in CI — there is genuinely nothing to look at. Printing "clean" there would be
 * this repo's own silent-failure class: a green that means "nothing looked".
 *
 * @returns 0 when nothing BLOCKING was found (an advisory-only finding does not fail the build), 1 on any
 *   blocking finding or unreadable doc
 */
export function runRegisterHygiene(): number {
  const handoverDir = stateHomePaths().handovers;
  const scan = scanBoard({ handoverDir });
  if (scan.isErr()) {
    // devlint: not-a-refusal -- an input could not be read or parsed, so the gate reports the failure rather than a verdict
    process.stderr.write(`register-hygiene: ${scan.error.message}\n`);
    return 1;
  }
  const { docs, unreadable } = scan.value;
  if (docs.length === 0 && unreadable.length === 0) {
    process.stdout.write(`register-hygiene: no register at ${handoverDir} — nothing examined\n`);
    return 0;
  }
  const { currentBranch, currentRepo } = currentPush();
  const landedPaths = landedDocs({ docs });
  const findings = checkRegister({
    docs,
    landedPaths,
    nonBlockingPaths: pushExemptPaths({ currentBranch, currentRepo, docs }),
    openQuestions: openQuestionsOf({ docs }),
    shippedSlugs: shippedSlugsOf({ docs: docs.filter((doc) => landedPaths.has(doc.path)) }),
  });
  for (const finding of findings) {
    // devlint: not-a-refusal -- a per-finding diagnostic, indented inside reportFinding rather than at
    // this call, and printed on the advisory-only branch too, where nothing is refused
    process.stderr.write(reportFinding({ finding }));
  }
  for (const name of unreadable) {
    process.stderr.write(`  ${name}  (looks like a doc but could not be read — it is invisible on the board)\n`);
  }
  const blocking = findings.filter((finding) => finding.blocking).length;
  const outcome = gateOutcome({ refused: blocking, unseen: unreadable.length });
  if (outcome === "clean") {
    process.stdout.write(
      findings.length === 0
        ? `register-hygiene: clean (${String(docs.length)} doc(s) examined)\n`
        : `register-hygiene: ${String(findings.length)} advisory finding(s) about another repo/branch — not blocking this push\n`,
    );
    return 0;
  }
  if (outcome === "incomplete") {
    // devlint: not-a-refusal -- a doc that could not be read was not examined, so this reports the gap
    // rather than a policy verdict over a row nobody has seen
    process.stderr.write(
      `register-hygiene: ${String(unreadable.length)} doc(s) could not be read, so the board was not fully examined.\n`,
    );
    return 1;
  }
  process.stderr.write(
    `${lintGateRefusal({
      declaration: lintDeclarationFor({ id: "register-hygiene" }),
      detail: `${String(blocking)} blocking finding(s)`,
    })}\n`,
  );
  return 1;
}
