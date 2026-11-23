/**
 * The projection pipeline of `slopweaver briefing render`: the projected run (`./briefingRenderList.ts`) to
 * every gathered section, and those to the form the page is rendered from.
 *
 * Depth 1 — it stands on the vocabulary and on the three direct-reading sections, and on nothing else the
 * verb owns. `gatherProjections` and `buildForm` are separate from each other and from the entry point
 * because stacking them put the entry point past `max-function-lines`; keep them that way.
 */
import { NO_AUTONOMY, projectAutonomy } from "../../../briefing/autonomy.js";
import { briefingErrorLines } from "../../../briefing/errors.js";
import { projectSupervisorNarrative, type SupervisorNarrativeProjection } from "../../../briefing/narrative.js";
import { narrativeErrorLines } from "../../../briefing/narrativeErrors.js";
import { projectOpenArtifacts } from "../../../briefing/openArtifacts.js";
import { openPageUrls, projectOpenPageCards } from "../../../briefing/openPageCards.js";
import { cardPrRefs } from "../../../briefing/prPremise.js";
import { judgeSnapshotAge, OPEN_PAGES_LABEL, type StaleSnapshot } from "../../../briefing/snapshotAge.js";
import { err, ok, type Result } from "../../../lib/result.js";
import type { PrPremise } from "../../../live/github/prPremise.js";
import type { BriefingAutonomy, BriefingOpenArtifact } from "../../../outbound/briefing/types.js";
import { stateHomePaths } from "../../../stateHome.js";
import {
  freshnessSection,
  handStepsBlock,
  nothingStaleSection,
  ownerBeliefsBlock,
  quizBlock,
} from "./briefingRenderSections.js";
import {
  type BriefingRenderDeps,
  type GatheredProjections,
  type OpenArtifactProjection,
  type ProjectedRun,
  refreshedStamp,
} from "./briefingRenderTypes.js";
import { type BriefingRenderArgs } from "./core.js";
import { type BriefingCommandError, BriefingCommandErrors } from "./errors.js";
import { type ParsedBriefingForm, parseBriefingForm } from "./renderCore.js";

/**
 * Read the sweep's open-artifact document and mark every page in it against the lock-in ledger.
 *
 * The two reads happen HERE rather than in the projector, which is the same shell/core split the rest of
 * this verb keeps: `../../../briefing/openArtifacts.ts` never touches the filesystem, so its whole mapping —
 * including every validity mark — is driven by a test holding a ledger as a value.
 *
 * @param args the parsed invocation
 * @param deps everything the verb touches outside itself
 * @param home the state home whose lock-in ledger the marks are derived from
 * @param nowIso the run's own instant, which is what expires a deferred ruling
 * @returns the ranked index, absent when the run named no document, or the refusal
 */
async function projectRunOpenArtifacts({
  args,
  deps,
  home,
  nowIso,
}: {
  args: BriefingRenderArgs;
  deps: BriefingRenderDeps;
  home: string;
  nowIso: string;
}): Promise<Result<OpenArtifactProjection, BriefingCommandError>> {
  if (args.openArtifactsSource === undefined) {
    return ok({});
  }
  const raw = deps.readOpenArtifacts({ source: args.openArtifactsSource });
  if (raw.isErr()) {
    return err(BriefingCommandErrors.upstreamRefused({ reasons: raw.error }));
  }
  let document: unknown;
  try {
    document = JSON.parse(raw.value.text);
  } catch (error: unknown) {
    return err(BriefingCommandErrors.documentNotJson({ cause: error, document: "--open-artifacts" }));
  }
  // The FILE's instant, not the document's — this one carries none. On stdin there is neither, so
  // `judgeSnapshotAge` has nothing to judge and answers fresh; `./renderReaders.ts` is where that limit and
  // what it costs are written down.
  const stale = judgeSnapshotAge({
    flag: "--open-artifacts",
    label: OPEN_PAGES_LABEL,
    nowIso,
    source: args.openArtifactsSource,
    takenIso: raw.value.writtenIso,
  });
  const ranked = projectOpenArtifacts({ document, ledgerText: deps.readLockIns({ home }), nowIso });
  if (ranked.isErr()) {
    return err(BriefingCommandErrors.upstreamRefused({ reasons: briefingErrorLines({ error: ranked.error }) }));
  }
  if (!args.openPageCards) {
    return ok({ ranked: ranked.value, stale });
  }
  const cards = await projectRunPageCards({ deps, document, home, ranked: ranked.value });
  return cards.map((projected) => ({ ...projected, ranked: ranked.value, stale }));
}

/**
 * Fetch every ranked local page from the store over one connection, then project one card per page from it.
 *
 * @param document the parsed `--open-artifacts` file
 * @param ranked the ranked index the cards follow
 * @param home the state home whose store and `pages/` directory are read
 * @returns the cards beside every page whose pair is still typed, or the refusal — a store that could not be read
 *   names the page and stops the render, never reading as a page with no freeze
 */
async function projectRunPageCards({
  deps,
  document,
  home,
  ranked,
}: {
  deps: BriefingRenderDeps;
  document: unknown;
  home: string;
  ranked: readonly BriefingOpenArtifact[];
}): Promise<Result<Pick<OpenArtifactProjection, "cards" | "typedPages">, BriefingCommandError>> {
  const readPage = await deps.prefetchPublishedPages({ home, urls: openPageUrls({ ranked }) });
  if (readPage.isErr()) {
    return err(BriefingCommandErrors.upstreamRefused({ reasons: [readPage.error.message] }));
  }
  const cards = projectOpenPageCards({
    document,
    pagesDirectory: stateHomePaths({ home }).pages,
    ranked,
    readPage: readPage.value,
  });
  if (cards.isErr()) {
    return err(BriefingCommandErrors.upstreamRefused({ reasons: briefingErrorLines({ error: cards.error }) }));
  }
  return ok({ cards: cards.value.cards, typedPages: cards.value.typed });
}

/**
 * Read the autonomy register and project it, or nothing at all when the run did not ask for it.
 *
 * The register's own fold decides the order and folds the owner's latest word onto each act, so this edge does the
 * READ and `../../../briefing/autonomy.ts` does the mapping — the same shell/core split every other leg of
 * this verb keeps, which is what lets the whole projection be driven by a test holding records as values.
 *
 * An EMPTY register renders an empty section rather than nothing, which is deliberate: the run asked for the
 * ledger, so "nothing has been done autonomously" is the honest answer and the page states it by omitting
 * the section. A register that could not be READ is the opposite and refuses, because a page silently
 * claiming the fleet did nothing is the confident wrong answer this whole section exists to prevent.
 *
 * @param args the parsed invocation
 * @param deps everything the verb touches outside itself
 * @param home the state home the ledger answers for
 * @returns the projected section, absent when the run asked for no register, or the refusal
 */
async function projectRunAutonomy({
  args,
  deps,
  home,
}: {
  args: BriefingRenderArgs;
  deps: BriefingRenderDeps;
  home: string;
}): Promise<Result<BriefingAutonomy | undefined, BriefingCommandError>> {
  if (!args.autonomyLedger) {
    return ok(undefined);
  }
  const read = await deps.readAutonomy({ home });
  if (read.isErr()) {
    return err(BriefingCommandErrors.upstreamRefused({ reasons: read.error }));
  }
  if (read.value.length === 0) {
    return ok(NO_AUTONOMY);
  }
  return ok(projectAutonomy({ actions: read.value }));
}

/**
 * Read the tick ledger and project the three narrative sections, or nothing when the run asked for none.
 *
 * The READ is here and the PROJECTION is pure (`../../../briefing/narrative.ts`), which is the same
 * shell/core split every other leg of this verb keeps — so the whole mapping, including the conservation
 * check that proves nothing the owner said was dropped, is driven by a test holding a window as a value.
 *
 * @param args the parsed invocation
 * @param deps everything the verb touches outside itself
 * @returns the sections and their receipt, absent when the run was given no `--ticks`, or the refusal
 */
async function projectRunNarrative({
  args,
  deps,
}: {
  args: BriefingRenderArgs;
  deps: BriefingRenderDeps;
}): Promise<Result<SupervisorNarrativeProjection | undefined, BriefingCommandError>> {
  if (args.ticksSource === undefined) {
    return ok(undefined);
  }
  const window = await deps.readTicks({ priorDays: args.ticksPriorDays, source: args.ticksSource });
  if (window.isErr()) {
    return err(BriefingCommandErrors.upstreamRefused({ reasons: window.error }));
  }
  const projected = projectSupervisorNarrative({ window: window.value });
  if (projected.isErr()) {
    // The projection's own typed refusal, rendered by the module that owns it — this verb prints lines and
    // never re-words a refusal, so a new arm reaches the operator without this file learning about it.
    return err(BriefingCommandErrors.upstreamRefused({ reasons: narrativeErrorLines({ error: projected.error }) }));
  }
  return ok(projected.value);
}

/**
 * Run every projection the invocation asked for, stopping at the first that refuses.
 *
 * One step rather than five inline, because each is the same shape — ask, and hand the refusal straight back
 * — and stacking them put the shell’s `runBriefingRender` past the length the `max-function-lines` gate keeps. The
 * ORDER is not load-bearing between them; what is load-bearing is that they all run before anything is
 * written, so a refusal costs no output.
 *
 * @param args the parsed invocation
 * @param deps everything the verb touches outside itself
 * @param home the state home this run reads
 * @param readyIso this render's own instant, which the open-artifact marks are judged against
 * @returns every projected block, or the first refusal
 */
export async function gatherProjections({
  args,
  deps,
  home,
  readyIso,
}: {
  args: BriefingRenderArgs;
  deps: BriefingRenderDeps;
  home: string;
  readyIso: string;
}): Promise<Result<GatheredProjections, BriefingCommandError>> {
  const openArtifacts = await projectRunOpenArtifacts({ args, deps, home, nowIso: readyIso });
  if (openArtifacts.isErr()) {
    return err(openArtifacts.error);
  }
  const autonomy = await projectRunAutonomy({ args, deps, home });
  if (autonomy.isErr()) {
    return err(autonomy.error);
  }
  const beliefs = ownerBeliefsBlock({ home, wanted: args.ownerBeliefs });
  if (beliefs.isErr()) {
    return err(beliefs.error);
  }
  const hands = handStepsBlock({ home, wanted: args.handSteps });
  if (hands.isErr()) {
    return err(hands.error);
  }
  const quiz = quizBlock({ home, sweep: args.quizSweep });
  if (quiz.isErr()) {
    return err(quiz.error);
  }
  const narrative = await projectRunNarrative({ args, deps });
  if (narrative.isErr()) {
    return err(narrative.error);
  }
  return ok({
    autonomy: autonomy.value,
    beliefs: beliefs.value,
    handSteps: hands.value,
    narrative: narrative.value,
    openArtifacts: openArtifacts.value,
    quiz: quiz.value,
  });
}

/**
 * Fill the composed form with everything this run projected, and stamp its two instants.
 *
 * Its own step because the argument list IS the contract between the verb's two halves — what a form may not
 * write and what the run supplies instead — and reading it inline put the shell’s `runBriefingRender` past the
 * length the `max-function-lines` gate keeps.
 *
 * @param args the parsed invocation
 * @param deps everything the verb touches outside itself
 * @param gathered every block this run projected
 * @param projected what the one session-start read yielded
 * @param home the state home this run reads
 * @param readyIso the instant this page became ready
 * @param stale every half this run is publishing despite its age, empty on an ordinary page
 * @returns the validated form beside the pages whose second card folded, or the refusal
 */
export async function buildForm({
  args,
  deps,
  gathered,
  projected,
  home,
  readyIso,
  stale,
}: {
  args: BriefingRenderArgs;
  deps: BriefingRenderDeps;
  gathered: GatheredProjections;
  projected: ProjectedRun;
  home: string;
  readyIso: string;
  stale: readonly StaleSnapshot[];
}): Promise<Result<ParsedBriefingForm, BriefingCommandError>> {
  const projection = gathered.narrative;
  const nothingStale = nothingStaleSection({ home, nowIso: readyIso, wanted: args.nothingStale });
  if (nothingStale.isErr()) {
    return err(nothingStale.error);
  }
  return parseBriefingForm({
    autonomy: gathered.autonomy,
    freshness: await freshnessSection({ home, nowIso: readyIso, wanted: args.freshness }),
    narrative: projection,
    nothingStale: nothingStale.value,
    openArtifacts: gathered.openArtifacts.ranked,
    openPageCards: gathered.openArtifacts.cards,
    openPrs: projected.openPrs,
    handSteps: gathered.handSteps,
    ownerBeliefs: gathered.beliefs,
    quiz: gathered.quiz,
    raw: deps.readForm({ source: args.formSource }),
    readImageDataUri: deps.readImageDataUri,
    // With no `--ticks` there is no recorded pass older than this render to state, so the page says it was
    // refreshed when it was rendered. The owner's list's run is not a candidate: it states its own age.
    stamps: {
      readyIso,
      refreshedIso: refreshedStamp({
        narrativeIso: projection === undefined ? undefined : projection.newestFinalisedIso,
        readyIso,
      }),
      // Omitted rather than written as an empty array, so an ordinary page's header carries no key at all
      // and the strict form has nothing extra to read. Only the LABEL and the age cross into the page: the
      // flag and the path stay on the terminal side of the door.
      ...(stale.length === 0 ? {} : { staleSnapshots: stale.map((one) => ({ ageMs: one.ageMs, label: one.label })) }),
    },
    yourList: projected.yourList,
  });
}

/**
 * Read what GitHub currently says about every pull request the rendered page's cards rest on.
 *
 * The page has to exist before this can run — the addresses come from the rendered markup, not from the
 * form — which is why the verb renders first and checks second.
 *
 * @param deps everything the verb touches outside itself
 * @param home the state home whose credential the read resolves from
 * @param html the rendered page
 * @returns the premises, `undefined` when the break-glass switched the leg off, or the read's refusal
 */
export async function readPremises({
  deps,
  home,
  html,
}: {
  deps: BriefingRenderDeps;
  home: string;
  html: string;
}): Promise<Result<ReadonlyMap<string, PrPremise> | undefined, BriefingCommandError>> {
  if (!deps.applyPrPremise({ home })) {
    return ok(undefined);
  }
  const read = await deps.readPrPremises({ addresses: cardPrRefs({ html }).map((ref) => ref.address), home });
  if (read.isErr()) {
    return err(BriefingCommandErrors.premiseReadFailed({ cause: read.error.message, verb: "render" }));
  }
  return ok(read.value);
}
