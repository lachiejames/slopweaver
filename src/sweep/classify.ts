/**
 * Deciding which board rows no longer earn their keep — the pure half of `slopweaver sweep board`.
 *
 * ## The rule
 *
 * When work is done or certain things happen, detectives sweep to update skills and prune whatever is
 * irrelevant or superseded, and the sweep is aggressive about deleting what provides no value. That is the
 * whole hook: delete by default, with one rail: every act is journalled with its witness, so what the sweep took can be
 * FOUND afterwards (`slopweaver sweep list`).
 *
 * ## Why this file classifies rather than reads
 *
 * Every fact it needs is already composed. `composeBoardModels` (`../handover/boardState.ts`) returns one
 * {@link BoardModel} per doc carrying the section, the evaluated probes, the run disposition and the
 * dependency closure, and that precedence engine has been argued over at length. A second reader would be a
 * second opinion about the same rows, and the two would drift. So this is a pure
 * `readonly BoardModel[] -> readonly SweepCandidate[]` — no clock, no filesystem, no git — mirroring
 * `../worktree/pruneClassify.ts`, which is this repository's shape for the pure half of a destructive verb.
 *
 * ## The one rule that must survive every later edit
 *
 * **Nothing is ever a delete candidate for being merely OLD.** Age is the proxy that `actions/stale` and
 * Linear's auto-close judge by, and it is wrong about exactly the rows nobody has touched *because* they are
 * hard. Every verdict below is carried by a WITNESS — a probe that ran, a journal event that happened, a
 * dependency that died — and {@link UNWITNESSED} exists precisely so that "we cannot check this one" has a
 * name instead of being rounded down to "delete it".
 *
 * MEASURED by the shipped verb — `slopweaver sweep board` — against the live board: **798 live
 * rows, 641 of them UNWITNESSED.** A classifier willing to delete on age would have proposed 641 deletions on
 * its first run, and every one would have been a row nobody could check rather than a row nobody wanted. On
 * the p0 cohort this verb was built for (`slopweaver sweep board --priority p0`): 33 live rows, 27
 * UNWITNESSED, and exactly ZERO that any pure-code verdict can act on. **That is the finding, not a
 * shortfall** — the automatic half cannot trim what carries no claim, and the detective half is what the rest
 * of the hook is for.
 */
import type { BoardModel } from "../handover/boardTypes.js";
import { shellCommandLine } from "../lib/shellCommandLine.js";
import type { PrClosure } from "../live/github/prClosure.js";

import { endedPullRequestWitness } from "./endedPullRequest.js";
import { pauseDischargedBy, type SupersessionEdge } from "./supersession.js";

/**
 * Which board was classified: the state home and the resolved handovers directory. A command a witness prints
 * carries both, so pasting it acts on the board that produced the verdict and never the default one.
 */
export interface SweepBoardContext {
  readonly home: string;
  readonly handoverDir: string;
}

/**
 * What a swept board row turned out to be.
 *
 * Ordered most-actionable first, which is also the order {@link classifyBoardRow} tests them in. The first
 * match wins, exactly as the prune classifier's hold list does, so a row that is both contradicted and
 * orphaned reports the contradiction — the one a reader acts on.
 *
 * `UNCARDED` is the one verdict {@link classifyBoardRow} never returns: it is about a TERMINAL row whose page never
 * reached the owner's Queue, and `./uncarded.ts` decides it over the rows this classifier calls already terminal.
 */
export type SweepVerdict =
  | "CONTRADICTED"
  | "SHIPPED"
  | "PR_ENDED"
  | "UNCARDED"
  | "ORPHANED"
  | "SUPERSEDED"
  | "OVERTAKEN"
  | "UNWITNESSED"
  | "KEEP";

/**
 * What acting on a candidate does, named as the REGISTER verb it routes to rather than as a word of its own.
 *
 * `none` is a finding, not a timid act: a CONTRADICTED row needs somebody to look at why its own probes
 * disagree with its declared state, and there is no verb that makes that true. The state is derived and the
 * second copy deleted, which is why the two real acts are `handover close` and
 * `handover settle` rather than an edit to the row: **nothing in this repository writes a `status:` line**,
 * and a sweep that started would have minted the second copy the board spent a release deleting.
 *
 * `settle` names the ROUTE, not authority to take it: it settles `declined`, which is the owner's alone, so
 * `sweep apply` performs it only with the owner's reason and the anchor to where they gave it.
 */
export type SweepAct = "close" | "settle" | "none";

/** One row's verdict, with the evidence that produced it and what acting would do. */
export interface SweepCandidate {
  readonly slug: string;
  readonly path: string;
  readonly verdict: SweepVerdict;
  /**
   * The evidence that condemned this row, in one printable phrase.
   *
   * Never a restatement of the verdict. A reader has to be able to check it without opening the row, which is
   * what makes a wrong verdict visible rather than merely arguable.
   */
  readonly witness: string;
  readonly act: SweepAct;
  /**
   * The question a `PR_ENDED` row was judged on, byte for byte — the settle refuses a row whose question reads
   * otherwise at the write, since the pull requests GitHub was asked about are then not the ones it names.
   */
  readonly question?: string;
}

/**
 * A row's evaluated probe results, or an empty list when the board composed none for it.
 *
 * Written as a function rather than a `??` because the absent case is a real one — a row with no `doneWhen`
 * gets no probe state at all — and `no-silent-fallback` is the rule that says so out loud.
 *
 * @param model the composed row
 * @returns the results, possibly empty
 */
function probeResults({ model }: { model: BoardModel }): NonNullable<BoardModel["probe"]>["results"] {
  const probe = model.probe;
  if (probe === undefined) {
    return [];
  }
  return probe.results;
}

/**
 * Whether a section means the row is still live enough to sweep.
 *
 * `DONE` and the closed sections are already terminal — sweeping them would propose closing what is closed.
 *
 * @param section the composed board section
 * @returns true when the row is a sweep subject
 */
function isSweepable({ section }: { section: BoardModel["section"] }): boolean {
  return section !== "DONE" && section !== "CLOSED — NOT SHIPPED";
}

/**
 * How many of a row's declared probes passed, and how many were evaluated at all.
 *
 * `not-evaluated` is counted apart from `fail` on purpose: a command probe the caller declined to run is
 * "nothing looked", and a sweep that read it as a failure would contradict rows it never checked.
 *
 * @param model the composed row
 * @returns the pass, fail and unevaluated counts
 */
function probeTally({ model }: { model: BoardModel }): {
  readonly passed: number;
  readonly failed: number;
  readonly unevaluated: number;
} {
  const results = probeResults({ model });
  return {
    failed: results.filter((result) => result.outcome === "fail").length,
    passed: results.filter((result) => result.outcome === "pass").length,
    unevaluated: results.filter((result) => result.outcome === "not-evaluated").length,
  };
}

/**
 * The dependency leaf that makes a row unrunnable, or nothing when none does.
 *
 * @param model the composed row
 * @returns the first closure, which is the one the board itself reports
 */
function deadDependency({ model }: { model: BoardModel }): BoardModel["dependencyClosures"][number] | undefined {
  return model.dependencyClosures[0];
}

/**
 * The verdict for a row whose composed model carries no probe results at all.
 *
 * **Two very different rows land here and conflating them was a real defect.** MEASURED on the
 * live board: a bare `sweep board` reported 645 UNWITNESSED, and adding `--probe` reported 745 — the sweep
 * had not discovered a hundred more unwitnessed rows, it had run out of its deadline and left them
 * unevaluated, and the first cut of this function called that "nothing here can check it". Reproduce with
 * `slopweaver sweep board` against `slopweaver sweep board --probe` and compare the two censuses.
 *
 * So the DOC is asked what it declares, rather than the probe state being asked what it holds: a row that
 * declares nothing is UNWITNESSED and needs a detective; a row that declares probes nobody ran is KEEP, and
 * the witness says to run them.
 *
 * @param model the composed row
 * @param base the slug and path every verdict carries
 * @returns the candidate
 */
function unevaluated({
  model,
  base,
}: {
  model: BoardModel;
  base: { readonly slug: string; readonly path: string };
}): SweepCandidate {
  const declared = model.doc.doneWhen.length + model.doc.outputs.length;
  if (declared === 0) {
    return {
      ...base,
      act: "none",
      verdict: "UNWITNESSED",
      witness: "declares no doneWhen probe, so nothing here can check it — needs a witness or a detective",
    };
  }
  return {
    ...base,
    act: "none",
    verdict: "KEEP",
    witness: `declares ${String(declared)} probe(s) that this sweep did not evaluate — re-run with --probe and a longer --deadline`,
  };
}

/** The slug and path every verdict carries, whichever arm produces it. */
type CandidateBase = { readonly slug: string; readonly path: string };

/**
 * The two arms that end the classification before any evidence is weighed: a row already terminal, and a row
 * the board itself calls a contradiction.
 *
 * @param model the composed row
 * @param base the slug and path every verdict carries
 * @param tally the row's probe counts, quoted in the contradiction's witness
 * @returns the candidate, or nothing when neither arm fires
 */
function terminalOrContradicted({
  model,
  base,
  tally,
}: {
  model: BoardModel;
  base: CandidateBase;
  tally: { readonly passed: number; readonly failed: number };
}): SweepCandidate | undefined {
  if (!isSweepable({ section: model.section })) {
    return { ...base, act: "none", verdict: "KEEP", witness: `already terminal — section ${model.section}` };
  }
  if (model.section === "CONTRADICTION") {
    return {
      ...base,
      act: "none",
      verdict: "CONTRADICTED",
      witness: `${model.reason} — ${String(tally.failed)} probe(s) failing, ${String(tally.passed)} passing`,
    };
  }
  return undefined;
}

/**
 * The two ways a live row turns out to have shipped anyway.
 *
 * The journal is asked first and the probes second, because a `closed` event is the verb SAYING the work is
 * in, while passing probes are a reading that happens to agree.
 *
 * @param model the composed row
 * @param base the slug and path every verdict carries
 * @param tally the row's probe counts
 * @returns the candidate, or nothing when the row has not shipped
 */
function shipped({
  model,
  base,
  tally,
}: {
  model: BoardModel;
  base: CandidateBase;
  tally: { readonly passed: number; readonly failed: number };
}): SweepCandidate | undefined {
  if (model.run.kind === "closed") {
    return {
      ...base,
      act: "close",
      verdict: "SHIPPED",
      witness: `journal records a closed event at ${model.run.atIso}: ${model.run.summary}`,
    };
  }
  if (model.section === "LOOKS SHIPPED" && tally.passed > 0 && tally.failed === 0) {
    return {
      ...base,
      act: "close",
      verdict: "SHIPPED",
      witness: `all ${String(tally.passed)} declared probe(s) pass against the tree — the work is in`,
    };
  }
  return undefined;
}

/**
 * The two ways a live row can no longer earn its keep without having shipped — it can never run, or something
 * newer has replaced it. A dead dependency and a declared supersession route to `handover settle --as
 * declined`, which waits on the owner's word: the witness here is the evidence the owner decides on, never their decline. A
 * top-up row with a later lookalike — a row matching its generation slug and batch brief with a larger slug
 * epoch — reads OVERTAKEN, never SUPERSEDED, and carries no act: it is an attention signal, its witness says
 * what matched and where to look, and whether the row is still owed, and how it ends if not, is a person's read.
 *
 * Why never SUPERSEDED: the match proves neither provenance nor replacement. A planner's batch is
 * gap-limited — only alerts with no open pull request — so it may carry none of this row's packages, and a hand
 * `handover register --slug` can write the same shape with no planner at all; this row may still hold work
 * nobody raised. Why never an act: `sweep apply` would have to prove nobody holds the row at the instant it
 * writes, and the board cannot. A seat `cmux spawn` opened reads RUN NOW until its `handover
 * start`, and a spawn can open one without ever journalling its dispatch; a generation row records no
 * invocation, so a hand `vulnerability-fix topup` reads byte for byte like a firing.
 *
 * A generation edge is reported only for a row in RUN NOW, or PAUSED on exactly the recipe's next firing before
 * the newer generation came — a positive rule, so a row waiting on the owner, in flight, awaiting ship, a draft, one
 * waiting on a live dependency and any section added later read as before. Nor a row declaring any probe: one
 * that `--probe` read SHIPPED would read OVERTAKEN unprobed, and a minted top-up declares none. A
 * declared edge keeps its existing reach, because it is a newer live row's own statement rather than an inference.
 *
 * @param model the composed row
 * @param base the slug and path every verdict carries
 * @param supersession why a newer row replaced this one, when the caller found one
 * @param board the board classified, which the witness names for a hand settle
 * @returns the candidate, or nothing when neither arm fires
 */
function orphanedOrSuperseded({
  model,
  base,
  supersession,
  board,
}: {
  model: BoardModel;
  base: CandidateBase;
  supersession: SupersessionEdge | undefined;
  board: SweepBoardContext;
}): SweepCandidate | undefined {
  const dead = deadDependency({ model });
  if (dead !== undefined) {
    return {
      ...base,
      act: "settle",
      verdict: "ORPHANED",
      witness: `blockedBy reaches ${dead.leaf} (${dead.status}) via ${dead.via.join(" -> ")} — it can never run`,
    };
  }
  if (supersession === undefined) {
    return undefined;
  }
  if (supersession.kind === "declared") {
    return {
      ...base,
      act: "settle",
      verdict: "SUPERSEDED",
      witness: `${supersession.newerSlug} declares this slug superseded, is newer, and is itself still live`,
    };
  }
  return overtaken({ base, board, model, supersession });
}

/**
 * The generation arm of {@link orphanedOrSuperseded}: OVERTAKEN with no act, or nothing when the row's section,
 * probes or pause keep it out of reach.
 *
 * @param model the composed row
 * @param base the slug and path every verdict carries
 * @param supersession the inferred generation edge
 * @param board the board classified, which the witness names for a hand settle
 * @returns the candidate, or nothing when the row is out of the edge's reach
 */
function overtaken({
  model,
  base,
  supersession,
  board,
}: {
  model: BoardModel;
  base: CandidateBase;
  supersession: Extract<SupersessionEdge, { kind: "generation" }>;
  board: SweepBoardContext;
}): SweepCandidate | undefined {
  if (model.doc.doneWhen.length + model.doc.outputs.length > 0) {
    return undefined;
  }
  // The witness states only what the board checked: the slug convention, the epoch suffix and a brief
  // parsing as the family's batch. None of that proves a planner made the row — `handover register --slug` can
  // write the same shape — so nothing here says the row was minted, planned or fired, and the epoch is named as
  // the slug's, never as a registration instant.
  const later = `${supersession.newerSlug} matches this row's top-up slug and batch brief with a later slug epoch, ${supersession.registeredIso}`;
  // No outcome and no ending is prescribed: whatever made that batch, this row may still hold work
  // nobody raised, and what became of its packages is what picks `filed`, `answered` or the owner's `declined`, each
  // with its own witness. So no settle command is printed — only the board it must name, so it lands on this one.
  const where = shellCommandLine({ command: ["--home", board.home, "--dir", board.handoverDir] });
  const settle = `its batch may carry none of this row's packages, so read where they stand: if one is still owed, keep this row; if none is, settle it once nobody holds it, with whichever ending and witness the facts support (\`slopweaver handover settle --help\`; a decline is the owner's alone), naming this board: \`${where}\``;
  if (model.section === "RUN NOW") {
    return {
      ...base,
      act: "none",
      verdict: "OVERTAKEN",
      witness: `${later} — ${settle}`,
    };
  }
  // The measured dead row was PAUSED on "the vulnfix-topup-acme-admin recipe's next firing", and the later generation
  // was registered by an investigation run, not that firing: whether it ends the pause is the pauser's
  // call, which is one more reason the act is a person's.
  if (
    model.section === "PAUSED" &&
    pauseDischargedBy({ doc: model.doc, newerSlug: supersession.newerSlug, recipe: supersession.recipe })
  ) {
    return {
      ...base,
      act: "none",
      verdict: "OVERTAKEN",
      witness: `${later}, past this row's pause on that recipe's next firing — the board does not check whether the recipe made it, and ${settle}`,
    };
  }
  return undefined;
}

/**
 * Classify ONE composed board row.
 *
 * The arms are tried in verdict order and the first match wins. Each names the witness it found rather than
 * the rule that fired, so a reader can re-check the claim without re-running the classifier.
 *
 * @param model the row as `composeBoardModels` composed it
 * @param supersession a newer row declaring this one replaced, or a later top-up generation, when found
 * @param board the home and handovers directory this row was read from, named by any command a witness prints
 * @returns the candidate, or `KEEP` when nothing condemns it
 */
export function classifyBoardRow({
  model,
  supersession,
  board,
}: {
  model: BoardModel;
  supersession: SupersessionEdge | undefined;
  board: SweepBoardContext;
}): SweepCandidate {
  const base = { path: model.doc.path, slug: model.doc.slug };
  const tally = probeTally({ model });

  // Each arm answers `undefined` for "not my case", and the FIRST one that speaks wins. Written as three ifs
  // rather than a `??` chain because `no-silent-fallback` reads that chain as a substitution being made
  // quietly, and here the absent case is the whole control flow.
  const terminal = terminalOrContradicted({ base, model, tally });
  if (terminal !== undefined) {
    return terminal;
  }
  const landed = shipped({ base, model, tally });
  if (landed !== undefined) {
    return landed;
  }
  const unrunnable = orphanedOrSuperseded({ base, board, model, supersession });
  if (unrunnable !== undefined) {
    return unrunnable;
  }

  if (probeResults({ model }).length === 0) {
    return unevaluated({ base, model });
  }

  return {
    ...base,
    act: "none",
    verdict: "KEEP",
    witness: `${String(tally.passed)} probe(s) pass, ${String(tally.failed)} fail, ${String(tally.unevaluated)} not evaluated`,
  };
}

/**
 * A row nothing else condemned, re-read against GitHub: `PR_ENDED` when every pull request its question names has
 * ended (`./endedPullRequest.ts`), else the verdict it already had.
 *
 * Only an UNWITNESSED row, or a live KEEP, is re-read. Every other verdict is stronger evidence or a decision of its
 * own — a contradiction to investigate, a shipped close, a decline of the owner's — and stays as it was.
 *
 * @param model the composed row
 * @param candidate what {@link classifyBoardRow} made of it
 * @param closures what GitHub said about each pull request this pass read
 * @returns the candidate, `PR_ENDED` when its question's pull requests have all ended
 */
function withEndedPullRequests({
  model,
  candidate,
  closures,
}: {
  model: BoardModel;
  candidate: SweepCandidate;
  closures: ReadonlyMap<string, PrClosure>;
}): SweepCandidate {
  const unjudged = candidate.verdict === "UNWITNESSED" || candidate.verdict === "KEEP";
  if (!unjudged || !isSweepable({ section: model.section })) {
    return candidate;
  }
  const witness = endedPullRequestWitness({ closures, model });
  if (witness === undefined) {
    return candidate;
  }
  return {
    act: "settle",
    path: candidate.path,
    // A witness exists only for a row whose question named a pull request, so the question is there.
    question: model.doc.summary!,
    slug: candidate.slug,
    verdict: "PR_ENDED",
    witness: `every pull request its question names has ended: ${witness}`,
  };
}

/**
 * Classify every composed row.
 *
 * @param models every row `composeBoardModels` returned
 * @param supersessions slug of the superseded row to why, and by which newer row
 * @param board the home and handovers directory the models were read from
 * @param closures what GitHub said about each pull request a live ask's question names, keyed by
 *   `pullRequestKey` — empty when the caller read none, which leaves every row as the board alone judges it
 * @returns one candidate per model, in the same order
 */
export function classifyBoard({
  models,
  supersessions,
  board,
  closures,
}: {
  models: readonly BoardModel[];
  supersessions: ReadonlyMap<string, SupersessionEdge>;
  board: SweepBoardContext;
  closures: ReadonlyMap<string, PrClosure>;
}): readonly SweepCandidate[] {
  return models.map((model) =>
    withEndedPullRequests({
      candidate: classifyBoardRow({ board, model, supersession: supersessions.get(model.doc.slug) }),
      closures,
      model,
    }),
  );
}

/**
 * How many candidates fell into each verdict.
 *
 * The census is what `sweep board` prints instead of 121 UNWITNESSED lines — rule 7's shape, and the reason
 * the verb's output stays readable on a board this size.
 *
 * @param candidates the classified rows
 * @returns a count per verdict, including the zeroes, so a missing class is visible as zero rather than absent
 */
export function verdictCensus({
  candidates,
}: {
  candidates: readonly SweepCandidate[];
}): Readonly<Record<SweepVerdict, number>> {
  const census: Record<SweepVerdict, number> = {
    CONTRADICTED: 0,
    KEEP: 0,
    ORPHANED: 0,
    OVERTAKEN: 0,
    PR_ENDED: 0,
    SHIPPED: 0,
    SUPERSEDED: 0,
    UNCARDED: 0,
    UNWITNESSED: 0,
  };
  candidates.forEach((candidate) => {
    census[candidate.verdict] += 1;
  });
  return census;
}
