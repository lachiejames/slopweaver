/**
 * `slopweaver briefing render --form <json|->` — emit the fleet-briefing page from a typed form
 * (`skills/supervisor/reference/fleet-briefing-shape.md`).
 *
 * A typed form is the right shape for this. `briefing check` stays as the READER for a
 * page a session hand-wrote; this is the writer, and the difference is that a wall of text has no
 * representation in the form at all. Every cap lives in `src/briefing/caps.ts` and is enforced by
 * `src/outbound/briefing/schema.ts`, so a refusal happens before any bytes exist rather than after.
 *
 * ## Why this edge loads a profile
 *
 * Same split as `./run.ts`: the caps are public and ship here, while the operator's banned characters and
 * words are private `profile.json` configuration under the state home. So the verb takes `--home`, and
 * a `voice-rules` grant lifts exactly the packing and voice findings and never a cap.
 *
 * ## Why the render happens before the check, in two steps
 *
 * One half of the gate re-reads, from GitHub, every pull request the page's cards rest on
 * (`../../../briefing/prPremise.ts`). Which pull requests those are is only knowable from the RENDERED
 * markup — a card composed by hand carries its subject as a link and nothing in the form says "this is a
 * pull request" — so the verb renders, reads what the page named, and only then checks. The read honours
 * a `stale-cards` grant as its one journalled way past, exactly like the other two halves.
 *
 * ## Why the snapshot age is judged before anything is composed
 *
 * A page can look stale: the publish chain had stopped regenerating the
 * session-start document `--your-list` reads, so the owner's list rendered out of a fifteen-hour-old file under a
 * page whose other half was minutes old. Nothing refused, because nothing looked. So both snapshot halves
 * are dated against this render's own clock before a form is built, and a half past
 * `../../../briefing/snapshotAge.ts`'s ceiling stops the run. A `stale-snapshot` grant publishes
 * anyway and the page then STATES each stale half's age above the fold in red — a hatch that merely
 * silenced the check would rebuild the defect.
 */
import { readFileSync } from "node:fs";
import { type AutonomyLedgerPort, autonomyLedgerPort } from "../../../autonomy/port.js";
import { composedCardDrift, composedPageAddresses, pinPagesOpened } from "../../../briefing/composedCardDrift.js";
import { narrativeReceiptLines } from "../../../briefing/narrative.js";
import { type TypedOpenPage, typedPageLines } from "../../../briefing/openPageCards.js";
import { type FoldedPage, foldedPageLines } from "../../../briefing/openPageFold.js";
import { type HeldBackPullRequest } from "../../../briefing/openPrCards.js";
import { hatchOpenNow } from "../../../hatch/open.js";
import { slopweaverHome } from "../../../homeDir.js";
import { logger } from "../../../lib/logger.js";
import { err, type Result } from "../../../lib/result.js";
import { writeFileAtomic } from "../../../lib/writeAtomic.js";
import { readOrganisation } from "../../../organisation/read.js";
import type { BriefingForm } from "../../../outbound/briefing/types.js";
import { BARE_REFS_HATCH } from "../../../outbound/linkify/bareRefsHatch.js";
import { type ExactVoiceRule, VOICE_RULES_HATCH } from "../../../outbound/voice/exactRules.js";
import { readExactVoiceRules } from "../../../profileStore.js";
import { readLockInLedger } from "../../../sessionStart/lockIn.js";
import { stateHomePaths } from "../../../stateHome.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK } from "../../exitCodes.js";
import { productionReadCardPremises, STALE_CARDS_HATCH } from "../../prPremiseDoor.js";
import { refuseRunnerOnStandingRuling } from "../../rulingGateDoor.js";
import { staleSnapshotRefusal } from "../../staleSnapshotDoor.js";
import { organisationForList, projectAndDate } from "./briefingRenderList.js";
import { buildForm, readPremises } from "./briefingRenderProjections.js";
import {
  type BriefingRenderDeps,
  type GatheredProjections,
  type ProjectedRun,
  refuse,
  resolvedHome,
} from "./briefingRenderTypes.js";
import { type BriefingRenderArgs, parseBriefingRenderArgs, VERB_ARG_OFFSET } from "./core.js";
import { type BriefingCommandError, briefingCommandErrorLines } from "./errors.js";
import { pagesOpenedOnDisk, prefetchPublishedPages } from "./publishedPageReader.js";
import { readImageDataUri } from "./readImageDataUri.js";
import { refusalLines } from "./refusedPage.js";
import { checkRenderedBriefing, type ParsedBriefingForm, renderBriefingPage } from "./renderCore.js";
import { heldBackLines, renderSummaryLines } from "./renderDiagnostics.js";
import {
  readFoldedAutonomy,
  readOpenArtifactsDocument,
  readTickWindow,
  readYourListDocument,
} from "./renderReaders.js";

/**
 * Run `briefing render` against injected seams.
 *
 * @param rest the argv tail after `briefing render`
 * @param deps everything the verb touches outside itself
 * @returns the process exit code
 */
export async function runBriefingRender({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: BriefingRenderDeps;
}): Promise<number> {
  const execution = await runBriefingRenderDetailed({ deps, rest });
  return execution.exitCode;
}

/**
 * What one in-process render ended in: its exit code, and which typed refusal stopped it.
 *
 * @internal — the shape {@link runBriefingRenderDetailed} returns and `supervisor tick close` reads.
 */
export interface BriefingRenderExecution {
  readonly exitCode: number;
  /**
   * The typed refusal's code, so a caller can act on ONE kind of refusal without parsing the lines it printed.
   * Absent on success, and on a refusal that only ever existed as lines (a voice-rules read, a stale snapshot, a
   * drifted card).
   */
  readonly refusalCode: BriefingCommandError["code"] | undefined;
}

/**
 * Run `briefing render` against injected seams, returning which typed refusal stopped it beside the exit code.
 *
 * `supervisor tick close` archives more notes on a page refused as too large and on nothing else, and the gate
 * checks the page's voice and framing BEFORE its bytes, so neither the exit code nor the presence of a refused
 * page can tell the two apart. The code can.
 *
 * @param rest the argv tail after `briefing render`
 * @param deps everything the verb touches outside itself
 * @returns the exit code and the refusal's code
 */
export async function runBriefingRenderDetailed({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: BriefingRenderDeps;
}): Promise<BriefingRenderExecution> {
  // A ruling refusal is lines only, never one of the typed codes `supervisor tick close` acts on.
  const gated = refuseRunnerOnStandingRuling({ noun: "briefing", rest, verb: "render" });
  if (gated !== undefined) {
    return { exitCode: gated, refusalCode: undefined };
  }
  const args = parseBriefingRenderArgs({ rest });
  if (args.isErr()) {
    const exitCode = refuse({ deps, lines: briefingCommandErrorLines({ error: args.error }), usage: true });
    return { exitCode, refusalCode: args.error.code };
  }
  // The clock is read BEFORE the first projection, not after it: both snapshot halves are judged against
  // this instant and the eyebrow stamps it, so a second read here would let the door and the page disagree
  // about how old the same file is.
  const readyIso = deps.now();
  const home = resolvedHome({ deps, named: args.value.home });
  // Read before any projection, since those reach GitHub: a page the voice pass could not judge is refused
  // whole, not rendered and checked against no rules.
  const rules = deps.voiceRules({ home });
  if (rules.isErr()) {
    deps.writeDiagnostic(`refused: ${rules.error.message}. nothing was rendered.`);
    return { exitCode: EXIT_ERROR, refusalCode: undefined };
  }
  // A failed read, never the caller's mistake, so it exits as the voice rules' read does.
  const organisation = await organisationForList({ args: args.value, deps, home });
  if (organisation.isErr()) {
    deps.writeDiagnostic(`refused: ${organisation.error.join("; ")}. nothing was rendered.`);
    return { exitCode: EXIT_ERROR, refusalCode: undefined };
  }
  const inputs = await projectAndDate({ args: args.value, deps, home, organisation: organisation.value, readyIso });
  if (inputs.isErr()) {
    return refusedWith({ deps, lines: inputs.error, refusalCode: undefined });
  }
  const { gathered, projected, stale } = inputs.value;
  const form = await buildForm({ args: args.value, deps, gathered, home, projected, readyIso, stale });
  if (form.isErr()) {
    const lines = refusalLines({ deps, error: form.error, out: args.value.out });
    return refusedWith({ deps, lines, refusalCode: form.error.code });
  }
  const drift = await pageDrift({ deps, form: form.value.form, home });
  if (drift.length > 0) {
    return refusedWith({ deps, lines: drift, refusalCode: undefined });
  }
  return checkThenEmit({ args: args.value, deps, form: form.value, gathered, home, projected, rules: rules.value });
}

/**
 * Render and check a form that passed every earlier door, then write the page — the tail of
 * {@link runBriefingRenderDetailed}, split for the line cap.
 *
 * @param form the parsed form and what its one-card-per-page fold removed
 * @param gathered the projections the run read, the narrative and open artifacts among them
 * @param projected the projected run, for what `--open-prs` held back
 * @returns the execution the verb ends in
 */
async function checkThenEmit({
  args,
  deps,
  form,
  gathered,
  home,
  projected,
  rules,
}: {
  args: BriefingRenderArgs;
  deps: BriefingRenderDeps;
  form: ParsedBriefingForm;
  gathered: GatheredProjections;
  home: string;
  projected: ProjectedRun;
  rules: readonly ExactVoiceRule[];
}): Promise<BriefingRenderExecution> {
  const projection = gathered.narrative;
  const page = await renderThenCheck({ deps, form: form.form, home, projected: projection !== undefined, rules });
  if (page.isErr()) {
    const lines = refusalLines({ deps, error: page.error, out: args.out });
    return refusedWith({ deps, lines, refusalCode: page.error.code });
  }
  const exitCode = emit({
    args,
    deps,
    foldedPages: form.foldedPages,
    form: form.form,
    heldBack: projected.heldBack,
    html: page.value,
    typedPages: gathered.openArtifacts.typedPages,
    // The receipt is emitted only on a WRITE. A projection that refused wrote no page, and printing what it
    // would have accounted for would read as a success line under a failure.
    receipt: projection === undefined ? [] : narrativeReceiptLines({ receipt: projection.receipt }),
  });
  return { exitCode, refusalCode: undefined };
}

/**
 * A refusal past the argument parse: its lines printed, and the typed code it carried, if any.
 *
 * @param lines what the refusal prints
 * @param refusalCode the typed refusal's code, absent for one that only ever existed as lines
 * @returns the execution the verb ends in
 */
function refusedWith({
  deps,
  lines,
  refusalCode,
}: {
  deps: BriefingRenderDeps;
  lines: readonly string[];
  refusalCode: BriefingCommandError["code"] | undefined;
}): BriefingRenderExecution {
  return { exitCode: refuse({ deps, lines, usage: false }), refusalCode };
}

/**
 * Every composed card that contradicts the page it names, listed in any document or not — `composedCardDrift`
 * carries why. Split from {@link runBriefingRender} for the line cap. Every page a card names is fetched from the
 * store first, over one connection.
 *
 * @returns one refusal line per drifted card, or the one line naming a page the store could not give; empty when
 *   none drifts
 */
async function pageDrift({
  deps,
  form,
  home,
}: {
  deps: BriefingRenderDeps;
  form: BriefingForm;
  home: string;
}): Promise<readonly string[]> {
  const pagesDirectory = stateHomePaths({ home }).pages;
  const pagesOpened = pinPagesOpened({ pagesOpened: deps.pagesOpened });
  const urls = composedPageAddresses({ block: form.reactNow, pagesDirectory, pagesOpened });
  const readPage = await deps.prefetchPublishedPages({ home, urls });
  if (readPage.isErr()) {
    return [readPage.error.message];
  }
  return composedCardDrift({
    block: form.reactNow,
    pagesDirectory,
    pagesOpened,
    readPage: readPage.value,
  });
}

/**
 * Render the page, re-read every pull request its cards rest on, and run the whole gate over the bytes.
 *
 * One step rather than three inline, because the ORDER is the contract and it is easy to lose: the page has
 * to exist before the premises can be read, since which pull requests the page names is only knowable from
 * the rendered markup, and the check needs both.
 *
 * @param deps everything the verb touches outside itself
 * @param form the validated form
 * @param home the state home whose credential the premise read resolves from
 * @param rules the operator's exact voice rules, read once before any projection ran
 * @returns the checked page's bytes, or the gate's refusal
 */
async function renderThenCheck({
  deps,
  form,
  home,
  projected,
  rules,
}: {
  deps: BriefingRenderDeps;
  form: BriefingForm;
  home: string;
  projected: boolean;
  rules: readonly ExactVoiceRule[];
}): Promise<Result<string, BriefingCommandError>> {
  const html = renderBriefingPage({ form });
  const premises = await readPremises({ deps, home, html });
  if (premises.isErr()) {
    return err(premises.error);
  }
  return checkRenderedBriefing({
    applyBareRefs: deps.applyBareRefs({ home }),
    applyFraming: deps.applyFraming,
    applyVoice: deps.applyVoice({ home }),
    html,
    // This render's own instant, not a fresh clock read: the page renders each card's age from exactly this,
    // so reading the clock again would let the gate and the page disagree by the milliseconds between them.
    // Never `refreshedIso` either — a premise read after the newest recorded pass is not a future one.
    nowIso: form.header.readyIso,
    projected,
    rules,
    ...(premises.value === undefined ? {} : { prStates: premises.value }),
  });
}

/**
 * What the summary lines call this run's destination when no `--out` was given.
 *
 * A destructured default rather than a coalesce: `emit` has already branched on the same absence one
 * statement above, to choose between writing a file and writing stdout, and this is that branch's NAME.
 */
function emitDestination({ out = "stdout" }: { out: string | undefined }): string {
  return out;
}

/**
 * Write the page where the caller asked for it, then say what the gate measured — and which pull requests
 * `--open-prs` held back, one line each, so a card that is absent because the owner already ruled on it is a fact
 * the operator can read rather than a card that silently vanished.
 *
 * A folded open-page card is the same contract one flag over: `--open-page-cards` dropping a second card
 * for a page the block already cards is a decision this run made about the owner's page, and a decision nothing
 * prints is indistinguishable from one nothing took. A card whose question and lean were TYPED because its
 * page predates the marks is printed for the same reason: it is the one card left that can drift from its page.
 */
function emit({
  args,
  deps,
  foldedPages,
  form,
  heldBack,
  html,
  receipt,
  typedPages,
}: {
  args: { readonly out: string | undefined };
  deps: BriefingRenderDeps;
  /** What the one-card-per-page fold removed, empty when no page was carded twice. */
  foldedPages: readonly FoldedPage[];
  form: Parameters<typeof renderSummaryLines>[0]["form"];
  heldBack: readonly HeldBackPullRequest[];
  html: string;
  /** What the tick projection accounted for, empty when the run was given no `--ticks`. */
  receipt: readonly string[];
  /** Every carded page whose question and lean were typed, absent when the run projected no page cards. */
  typedPages: readonly TypedOpenPage[] | undefined;
}): number {
  if (args.out === undefined) {
    deps.writeOut(html);
  } else {
    deps.writePage({ html, path: args.out });
  }
  for (const line of renderSummaryLines({ destination: emitDestination({ out: args.out }), form })) {
    deps.writeDiagnostic(line);
  }
  for (const line of heldBackLines({ heldBack })) {
    deps.writeDiagnostic(line);
  }
  for (const line of foldedPageLines({ folded: foldedPages })) {
    deps.writeDiagnostic(line);
  }
  if (typedPages !== undefined) {
    // Folded pages included: a typed page has no marks, so the composed card that won the fold is checked by
    // nothing, and the notice is the only place the unmarked page still shows.
    for (const line of typedPageLines({ typed: typedPages })) {
      deps.writeDiagnostic(line);
    }
  }
  for (const line of receipt) {
    deps.writeDiagnostic(line);
  }
  return EXIT_OK;
}

/**
 * The render's autonomy reader over one ledger: folded newest first, a refusal rendered as its lines.
 *
 * @param autonomy the autonomy ledger the "done for you, without asking" section reads
 * @returns the `readAutonomy` seam
 */
export function briefingAutonomyReader({
  autonomy,
}: {
  autonomy: AutonomyLedgerPort;
}): BriefingRenderDeps["readAutonomy"] {
  return async ({ home }) =>
    (await readFoldedAutonomy({ autonomy, home })).mapErr((error) => briefingCommandErrorLines({ error }));
}

/**
 * The real seams: stdin or the argument itself, the filesystem, and the operator's own state home.
 *
 * @returns the production dependencies for {@link runBriefingRender}
 */
export function productionBriefingRenderDeps(): BriefingRenderDeps {
  return {
    applyBareRefs: ({ home }) => !hatchOpenNow({ home, id: BARE_REFS_HATCH }),
    // ALWAYS ON at this door. `SLOPWEAVER_ALLOW_CARD_FRAMING` exists so `briefing check` can read an archive
    // rendered before these rules landed; render is the door that PUBLISHES, and a badly-framed page reaching
    // the owner under an ambient, traceless variable is the failure the four rules exist to stop.
    applyFraming: true,
    now: () => new Date().toISOString(),
    applyPrPremise: ({ home }) => !hatchOpenNow({ home, id: STALE_CARDS_HATCH }),
    snapshotAgeRefusal: ({ stale, home, nowIso }) => staleSnapshotRefusal({ env: process.env, home, nowIso, stale }),
    applyVoice: ({ home }) => !hatchOpenNow({ home, id: VOICE_RULES_HATCH }),
    defaultHome: slopweaverHome,
    readForm: ({ source }) => (source === "-" ? readFileSync(0, "utf8") : source),
    readImageDataUri: ({ path }) => readImageDataUri({ path }).mapErr((error) => briefingCommandErrorLines({ error })),
    readAutonomy: briefingAutonomyReader({ autonomy: autonomyLedgerPort() }),
    readLockIns: ({ home }) => readLockInLedger({ home }),
    readOpenArtifacts: ({ source }) =>
      readOpenArtifactsDocument({ source }).mapErr((error) => briefingCommandErrorLines({ error })),
    readPrPremises: productionReadCardPremises,
    prefetchPublishedPages,
    pagesOpened: pagesOpenedOnDisk,
    readTicks: readTickWindow,
    readYourList: ({ source }) =>
      readYourListDocument({ source }).mapErr((error) => briefingCommandErrorLines({ error })),
    readOrganisation: async ({ home }) =>
      (await readOrganisation({ home })).mapErr((error): readonly string[] => [error.message]),
    voiceRules: ({ home }) => readExactVoiceRules({ home }),
    writeDiagnostic: (line) => {
      logger.error({ msg: line });
    },
    writeOut: (line) => {
      logger.out({ line });
    },
    // A rename replaces the NAME, never the file behind it: a refused page lands at `<out>.refused.html`, and
    // one written through that name would reach `--out` itself when the two are a hard link or a symlink.
    writePage: ({ path, html }) => {
      writeFileAtomic({ contents: html, path });
    },
  };
}

/** `slopweaver briefing render`. */
export const briefingRenderCommand = defineCommand({
  run: (argv) => runBriefingRender({ deps: productionBriefingRenderDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});
