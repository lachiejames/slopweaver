/**
 * The vocabulary of `slopweaver briefing render` — its injected dependency contract, the three shapes the
 * projection stages hand each other, and the two helpers every stage uses.
 *
 * Depth 0 of the family: it imports nothing else the verb owns.
 */
import type { AutonomyAction } from "../../../autonomy/types.js";
import type { PagesOpened } from "../../../briefing/composedCardDrift.js";
import { type SupervisorNarrativeProjection } from "../../../briefing/narrative.js";
import { type TypedOpenPage } from "../../../briefing/openPageCards.js";
import { type HeldBackPullRequest } from "../../../briefing/openPrCards.js";
import type { PrefetchPublishedPages } from "../../../briefing/publishedPageRead.js";
import { type StaleSnapshot } from "../../../briefing/snapshotAge.js";
import { type Result } from "../../../lib/result.js";
import type { Organisation } from "../../../organisation/core.js";
import type {
  BriefingAutonomy,
  BriefingCard,
  BriefingHandSteps,
  BriefingOpenArtifact,
  BriefingOwnerBeliefs,
  BriefingQuiz,
  BriefingReactNow,
  BriefingYourList,
} from "../../../outbound/briefing/types.js";
import type { ExactVoiceRule } from "../../../outbound/voice/exactRules.js";
import type { ProfileReadError } from "../../../profileStore.js";
import type { SupervisorTickWindow } from "../../../supervisor/tickStore.js";
import { EXIT_USAGE } from "../../exitCodes.js";
import { type ReadCardPremises } from "../../prPremiseDoor.js";
import { BRIEFING_RENDER_USAGE } from "./usage.js";

/**
 * A document read off the edge, beside the instant the edge could date it at.
 *
 * `writtenIso` is absent when there is nothing to date — a stream rather than a file. It is the filesystem's
 * answer rather than the document's, which is why only the `--open-artifacts` reader hands one back: the
 * session-start document states its own instant inside itself and needs no help from the edge.
 */
export interface DatedDocument {
  readonly text: string;
  readonly writtenIso: string | undefined;
}

/** Everything `briefing render` touches outside itself, injected so a test drives the whole verb. */
export interface BriefingRenderDeps {
  /** Reads the form: `-` means stdin, anything else IS the JSON. */
  readonly readForm: (args: { source: string }) => string;
  /** Reads the `session-start --json` document feeding the owner's list: `-` means stdin, anything else is a PATH. */
  readonly readYourList: (args: { source: string }) => Result<string>;
  /**
   * Reads the organisation from the store (`../../../organisation/read.ts`), whose repositories name the checkout a
   * row's bare `#<number>` belongs to. Read only when the run renders the owner's list; a refusal is lines, like every read here.
   */
  readonly readOrganisation: (args: { home: string }) => Promise<Result<Organisation>>;
  /**
   * Reads the sweep's open-artifact document: `-` means stdin, anything else is a PATH.
   *
   * Hands back WHEN the document was written as well as what it says, because the document itself carries
   * no instant — see `./renderReaders.ts` for why the filesystem is the clock for this one input alone.
   */
  readonly readOpenArtifacts: (args: { source: string }) => Result<DatedDocument>;
  /** Reads the lock-in ledger's raw text out of the state home — the only source of a validity mark. */
  readonly readLockIns: (args: { home: string }) => string;
  /** Fetches the pages a run reads from the store, answering the reader a projected card reads its question and lean through. */
  readonly prefetchPublishedPages: PrefetchPublishedPages;
  /** The seam onto the files a path opens, so a composed card is held to the page it opens however it is spelled. */
  readonly pagesOpened: PagesOpened;
  /** Reads and folds the store's autonomy ledger, newest act first, each with the owner's latest word on it. */
  readonly readAutonomy: (args: { home: string }) => Promise<Result<readonly AutonomyAction[]>>;
  /**
   * Reads the supervisor tick ledger's bounded window: `-` means stdin, anything else is a PATH.
   *
   * ASYNC, alone among these reads, and the ledger is why: it is append-only with no ceiling, so it may
   * never pass through one JS string (`.claude/rules/typescript-patterns.md`'s `whole-file-json`). A path is
   * streamed line by line and stdin is fed through `node:readline`, which cannot be done synchronously.
   */
  readonly readTicks: (args: {
    source: string;
    priorDays: number | undefined;
  }) => Promise<Result<SupervisorTickWindow>>;
  /** Reads one image `path` an image block carried, returning the `data:` URI to embed it as. */
  readonly readImageDataUri: (args: { path: string }) => Result<string>;
  /** Writes the rendered page to a path. */
  readonly writePage: (args: { path: string; html: string }) => void;
  /** The operator's exact voice rules, or why `profile.json` is there but cannot be trusted. */
  readonly voiceRules: (args: { home: string }) => Result<readonly ExactVoiceRule[], ProfileReadError>;
  /** Whether the packing and voice pass runs at all, asked of the resolved home's grant journal. */
  readonly applyVoice: (args: { home: string }) => boolean;
  /** Whether the bare-reference scan runs at all, asked of the resolved home's grant journal. */
  readonly applyBareRefs: (args: { home: string }) => boolean;
  /** Whether the four card-framing rules run at all, read from their own break-glass at the edge. */
  readonly applyFraming: boolean;
  /** Whether each card's pull request is re-read live, asked of the resolved home's grant journal. */
  readonly applyPrPremise: (args: { home: string }) => boolean;
  /**
   * Why this run will not publish a stale half, and nothing when it may — `../../staleSnapshotDoor.ts`'s
   * `staleSnapshotRefusal`, which reads the hatch itself.
   *
   * A function rather than a flag because opening that hatch takes the resolved home and this render's own
   * instant: the row is outbound, so a `hatch open` grant is scoped to a home and expires, and neither value
   * exists when the verb builds its dependencies. Answering empty does not turn the CHECK off — the page then
   * states each stale half's age above the fold in red. A hatch that hid the staleness would rebuild the
   * defect it exists beside.
   */
  readonly snapshotAgeRefusal: (args: {
    stale: readonly StaleSnapshot[];
    home: string;
    nowIso: string;
  }) => readonly string[];
  /** Reads what GitHub currently says about each pull request the rendered page's cards name. */
  readonly readPrPremises: ReadCardPremises;
  /** The instant this page became ready for review. */
  readonly now: () => string;
  /** The data channel: the page itself when no `--out` was given. */
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
  readonly defaultHome: () => string;
}

/**
 * Everything ONE read of the session-start document yields, projected.
 *
 * The block that stood here until this file was split described `projectRun` instead — it opened "Read and
 * project THE OWNER'S list" and carried an `@param args`, an `@param deps` and an `@returns`, none of which an
 * interface has. It read perfectly and was about a different declaration, which is the failure mode the
 * `jsdoc-tags` gate exists for and could not see here, since nothing exported this shape.
 */
export interface ProjectedRun {
  readonly yourList: BriefingYourList | undefined;
  /** The two CARD groupings the pull-request leg projected — see {@link OpenPrProjection.groupings}. */
  readonly openPrs: Pick<BriefingReactNow, "meFacing" | "teamFacing"> | undefined;
  /** Every pull request `--open-prs` deliberately left off the page, with the run's own reason. */
  readonly heldBack: readonly HeldBackPullRequest[];
  /** The verdict when that instant was past the ceiling, absent when it was fresh or no document was read. */
  readonly stale: StaleSnapshot | undefined;
}

/**
 * What one `--open-artifacts` document yields: the ranked index the band renders, and one card per page.
 *
 * Both halves come from ONE read of ONE document, which is the property worth keeping. The owner wants
 * the cards and the ranked list together, and a card whose rank disagreed with the band beside it would
 * be the page contradicting itself about which page is freshest. Empty when the run named no document.
 */
export interface OpenArtifactProjection {
  readonly ranked?: readonly BriefingOpenArtifact[] | undefined;
  readonly cards?: readonly BriefingCard[] | undefined;
  /** Every carded page whose question and lean were typed rather than read from it, absent without cards. */
  readonly typedPages?: readonly TypedOpenPage[] | undefined;
  /** The verdict when the document's file was last written past the ceiling, absent when it was fresh. */
  readonly stale?: StaleSnapshot | undefined;
}

/** Every block this run projects rather than reads out of the form, gathered in one place. */
export interface GatheredProjections {
  readonly openArtifacts: OpenArtifactProjection;
  readonly autonomy: BriefingAutonomy | undefined;
  readonly beliefs: BriefingOwnerBeliefs | undefined;
  readonly handSteps: BriefingHandSteps | undefined;
  readonly quiz: BriefingQuiz | undefined;
  readonly narrative: SupervisorNarrativeProjection | undefined;
}

/**
 * The instant the eyebrow claims the page was refreshed at: the newest recorded pass behind it, else this
 * render.
 *
 * A page whose narrative came out of a ledger last written at noon is a page describing noon, and stamping it
 * with the render's own clock would be exactly the current-looking instant on stale content, which the owner must never have to question.
 *
 * The owner's list's run is deliberately NOT a candidate. It is a snapshot one half of the page was built from, and
 * when session-start failed on GitHub for a day the eyebrow took that day as the page's own: the cards read
 * minutes before the render then sat "in the future" of it and were refused. A snapshot's age is stated
 * where it applies — the list's section summary, and past the ceiling the eyebrow's red clause
 * (`../../../briefing/snapshotAge.ts`).
 *
 * @param narrativeIso the newest recorded pass's own finalisation instant, absent with no `--ticks`
 * @param readyIso this render's clock, which is the stamp when there is no narrative or it cannot be parsed
 * @returns the instant to stamp
 */
export function refreshedStamp({
  narrativeIso,
  readyIso,
}: {
  narrativeIso: string | undefined;
  readyIso: string;
}): string {
  if (narrativeIso === undefined || Number.isNaN(Date.parse(narrativeIso))) {
    return readyIso;
  }
  return narrativeIso;
}

/**
 * The state home this run reads: the one `--home` named, or the seam's default.
 *
 * An `if` that returns rather than `args.home ?? deps.defaultHome()`, which matters beyond the gate here:
 * `defaultHome` is an injected seam, and a coalesce evaluates its right operand only when the left is
 * absent, so spelling the branch keeps that laziness visible instead of leaving it to an operator.
 *
 * @param named what `--home` carried, absent when the invocation named none
 * @returns the state home every read in this run resolves against
 */
export function resolvedHome({ deps, named }: { deps: BriefingRenderDeps; named: string | undefined }): string {
  if (named !== undefined) {
    return named;
  }
  return deps.defaultHome();
}

/**
 * Print every line of a refusal, then the usage line when the refusal was about the invocation.
 *
 * @returns the exit code the verb refuses with
 */
export function refuse({
  deps,
  lines,
  usage,
}: {
  deps: BriefingRenderDeps;
  lines: readonly string[];
  usage: boolean;
}): number {
  for (const line of lines) {
    deps.writeDiagnostic(line);
  }
  if (usage) {
    deps.writeDiagnostic(BRIEFING_RENDER_USAGE);
  }
  return EXIT_USAGE;
}
