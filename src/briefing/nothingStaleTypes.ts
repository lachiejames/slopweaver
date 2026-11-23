/**
 * The vocabulary of the Fleet Briefing's "Nothing stale" section — five surfaces, four lanes, and the narrow
 * validated views of the documents the section reads.
 *
 * Pure types, no I/O. The views are deliberately NARROW: each holds only the fields the classification
 * consumes, validated by `./nothingStaleDocuments.ts`, so a stored producer document is never cast to its
 * producer's much larger interface and a field the section never reads can change without breaking it.
 *
 * The design it answers to covers all five surfaces: everything the owner owns is
 * moving, waiting on a named person, or asking them one word, and anything that is none of those is stale.
 */
import type { RunPhase } from "../handover/ledger.js";
import type { SlackOwedDocument } from "../live/slack/owedDocument.js";
import type { BriefingContent } from "../outbound/briefing/types.js";
import type { SweepBoardCensus } from "../sweep/census.js";

/** The five surfaces the section reports on, in the order it names them. */
type NothingStaleSurface = "pull-requests" | "linear-tickets" | "linear-projects" | "followed-threads" | "board";

/**
 * What the section may fail to see: one of the five surfaces, or the board's unproven COUNT — its own gap,
 * because the count is read from its own document and a board whose findings read cleanly may still have a
 * census that did not.
 */
export type NothingStaleGap = NothingStaleSurface | "board-unproven";

/**
 * Which note an item lands in: the three states the rule allows — moving, waiting on a named person, asking
 * the owner one word — and `stale`, the row seen in none of them, which is what the leading count counts.
 */
export type NothingStaleLane = "stale" | "moving" | "waiting" | "needs-word";

/**
 * What one run journal said when the section read it: the phase its whole journal folds to, or why it could
 * not be read. A journal that does not exist is never a receipt, so it has no entry at all.
 */
export type RunReceipt =
  { readonly kind: "phase"; readonly phase: RunPhase } | { readonly kind: "unreadable"; readonly reason: string };

/** One document as it was read, with the instant its freshness is judged from and the cadence it is judged by. */
interface TimedDocument<T> {
  readonly document: T;
  /** When the document's producer last succeeded — a hygiene file's mtime, or a document's own instant. */
  readonly observedAtIso: string;
  /** The producing standing row's cron cadence, resolved from its declaration. */
  readonly cadence: string;
}

/** A document that was read, or the one sentence saying why it could not be. Never an empty document. */
export type DocumentInput<T> =
  | { readonly kind: "available"; readonly value: TimedDocument<T> }
  | { readonly kind: "could-not-see"; readonly reason: string };

/** One press the landing read recorded — only `pressed` proves a press completed. */
interface LandingPressView {
  readonly repoSlug: string;
  readonly number: number;
  readonly url: string;
  readonly outcome: "pressed" | "would-press" | "failed";
  readonly detail: string;
}

/** The dispatch decision a landing row carries — `../review/landingDispatch.ts`'s `DispatchDecision`. */
type LandingDispatchView =
  | { readonly kind: "act"; readonly verdict: string; readonly why: string }
  | { readonly kind: "waiting" | "outside-the-set" | "unread"; readonly why: string };

/** One open pull request as the section reads it. */
export interface LandingRowView {
  readonly repoSlug: string;
  readonly number: number;
  readonly title: string;
  readonly url: string;
  /** The head the read saw — what its landing registration's slug is minted from. */
  readonly headOid: string;
  /** The landing read's own action for the row — `queued` and `stacked` are receipts by themselves. */
  readonly action: string;
  /** The board row that declares its branch, when the read found one — a second place a receipt can live. */
  readonly boardRowSlug: string | undefined;
  /** `@`-prefixed people and `@org/team`s holding it, as CODEOWNERS spells them. */
  readonly blockedOn: readonly string[];
  readonly queueKind: string;
  readonly dispatch: LandingDispatchView;
  /** The newest certified ask's recipients, as Slack ids — empty when nobody was asked. */
  readonly latestAskRecipients: readonly string[];
}

/** What one landing read was taken over — `../cli/commands/github/landingReport.ts`'s `LandingSelection`. */
interface LandingSelectionView {
  readonly repos: readonly string[];
  /** The `--author` qualifier as typed — `@me` or a login — or `undefined` for every author. */
  readonly author: string | undefined;
  readonly includeDrafts: boolean;
}

/** One repository's open list as the landing read carried it — `../live/github/openCensus.ts`'s `RepoCensus`. */
export type LandingCensusView =
  | {
      readonly kind: "read";
      readonly repo: string;
      /** The login the token read as — what `@me` resolved to. */
      readonly viewer: string;
      readonly pullRequests: readonly {
        readonly number: number;
        readonly isDraft: boolean;
        readonly author: string | undefined;
      }[];
    }
  | { readonly kind: "unread"; readonly repo: string; readonly why: string };

/** The landing read, narrowed. */
export interface LandingBriefingDocument {
  readonly rows: readonly LandingRowView[];
  readonly presses: readonly LandingPressView[];
  /** The roster's name for every Slack id some row's ask trail asked. */
  readonly people: Readonly<Record<string, string>>;
  /** What the read states about its own bounds and every row's, each line once — a caveat, never a gap. */
  readonly residue: readonly string[];
  readonly selection: LandingSelectionView;
  /** GitHub's own open list per selected repository, read beside the rows — what proves none went unplaced. */
  readonly census: readonly LandingCensusView[];
}

/** One cycle proposal as the section reads it. */
export interface CycleProposalView {
  readonly action: "close-with-comment" | "trace" | "project-update";
  readonly subject: string;
  readonly title?: string | undefined;
  readonly url: string;
  readonly headline: string;
  readonly evidence: readonly { readonly fact: string; readonly url?: string | undefined }[];
  readonly oneWordReplies: readonly string[];
  readonly draft?: string | undefined;
}

/** The cycle report, narrowed. */
export interface CycleBriefingDocument {
  readonly proposals: readonly CycleProposalView[];
  readonly couldNotSee: readonly string[];
}

/** One board candidate as the section reads it. */
export interface SweepBriefingCandidate {
  readonly slug: string;
  readonly verdict: string;
  readonly witness: string;
  readonly act: "close" | "settle" | "none";
}

/** Everything the section reads, each half already resolved to a document or a named gap. */
export interface NothingStaleInputs {
  readonly pullRequests: DocumentInput<LandingBriefingDocument>;
  readonly linearCycle: DocumentInput<CycleBriefingDocument>;
  readonly followedThreads: DocumentInput<SlackOwedDocument>;
  readonly board: DocumentInput<readonly SweepBriefingCandidate[]>;
  readonly boardCensus: DocumentInput<SweepBoardCensus>;
  /**
   * Every run journal a pull request's receipt could live in, keyed by slug, read NOW rather than off any
   * document — whether a run is open is a fact about this instant, not about the morning's read.
   */
  readonly runs: ReadonlyMap<string, RunReceipt>;
}

/** One classified row. */
export interface NothingStaleItem {
  readonly surface: NothingStaleSurface;
  /** The row's stable identity — every source row appears at most once. */
  readonly identity: string;
  readonly lane: NothingStaleLane;
  /** The one list line the row renders as, every piece of its evidence included. */
  readonly line: BriefingContent;
}

/** The whole classification, before any rendering. */
export interface NothingStaleProjection {
  readonly items: readonly NothingStaleItem[];
  /** Every gap, with the reasons behind it, in surface order. */
  readonly couldNotSee: ReadonlyMap<NothingStaleGap, readonly string[]>;
  /** Each document's stated bounds, keyed by the words naming that document, shown as caveats and never as gaps. */
  readonly caveats: ReadonlyMap<string, readonly string[]>;
  /** The board's UNWITNESSED count, absent when the census could not be seen. */
  readonly unproven: number | undefined;
}
