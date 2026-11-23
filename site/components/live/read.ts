/**
 * Narrow readers for the verb payloads the console shows.
 *
 * Every one of these returns `undefined` rather than throwing, and — just as deliberately — rather than
 * substituting a plausible value. That answers a real, unclosed risk: no vitest lane reaches `site/components/`,
 * so a verb changing its `--json` shape cannot fail a test. It can only break a page. A reader that REFUSES
 * turns that into one tile saying its shape changed, instead of a console quietly showing a zero.
 *
 * The line between refusing and carrying an absence is drawn per field, not per reader: a field the tile's
 * claim depends on makes the whole reading refuse; one the verb genuinely may omit is typed
 * `| undefined` and rendered as the absence it is.
 *
 * **A row is never DROPPED.** An earlier draft of three of these readers skipped a malformed row and returned
 * the rest, on the reasoning that one unreadable plan is a normal state of the world. It is not: every one of
 * these payloads is generated from a typed manifest or a typed store, so a row that will not parse means the
 * verb's shape moved — and a row silently missing from a table is exactly the confident-looking wrong answer
 * the whole console is built to make impossible. Dropping also hides itself: the catalog page would have
 * printed "N of M commands" where M was already the post-drop count. So a malformed row refuses the whole
 * reading, and the tile says the shape changed.
 *
 * **A SELECTION is not a drop, and the difference is whether the reader can see it.** `readAgents` keeps
 * only the open sessions, because a tile asking what the agents are doing is not asking about the
 * thousands of closed ones. That is legitimate exactly because it carries `tracked` alongside, so the page prints the
 * denominator it selected from. A filter whose denominator is invisible is the dropping above wearing a
 * different name.
 *
 * **Two registers are read next door**, and every rule above governs both unchanged. `slopweaver github
 * landing` is in `readLanding.ts`: the largest reader of the set, and no other page reads that register, so
 * it went out when this file reached the 1000-line ceiling `oxlint` holds it to rather than being trimmed to
 * fit. `slopweaver autonomy list` is in `readAutonomy.ts` for the same reason and one more — an act row
 * carries a `said` the card LEADS with, so its reader and the card's own fold budget have to move together.
 * `slopweaver hand list` is in `readHandSteps.ts`, re-exported below, for the first reason.
 */

import { type Bag, bags, isBag, num, str, strings } from "../../lib/bag";
import { type HandShotView, readHandShotView } from "../../lib/handShot";
import { isWorkspace, type Workspace } from "../../lib/workspacePlacement";
import { type BoardRowActionRead, rowAction } from "./readAction";
import {
  type DetachedAsk,
  detachedAsksOf,
  type LinearReferences,
  linearReferencesOf,
  unreadableOf,
} from "./readBoardDocument";
import { contextUnreadOf, listOf, prUrlsOf, prUrlsUnread } from "./readBoardFields";
import { type BoardTag, boardTagOf, tagsIncompleteOf } from "./readBoardTags";
import { type AskSettlement, type OwnerWait, ownerWaitOf, settlementOf } from "./readBoardWaits";
import {
  type BoardRowHisWords,
  type BoardRowPrSteer,
  type BoardRowSteer,
  readRowHisWords,
  readRowPrSteers,
  readRowSteers,
} from "./readHisWords";
import {
  type BoardParkedCheckpoint,
  type BoardParkedWake,
  parkedAtIsoOf,
  parkedCheckpointOf,
  parkedWakeOf,
  parkIndexOf,
} from "./readParkedWake";
import { type RecordReferences, recordReferencesOf } from "./readRecords";

export { type HandStep, readHandSteps } from "./readHandSteps";

/** One board row, as the workstreams tile shows it. */
export interface BoardRow {
  readonly slug: string;
  readonly section: string;
  readonly reason: string;
  readonly kind: string;
  readonly priority: string | undefined;
  /**
   * `default` when {@link BoardRow.priority} is the row kind's default that `handover set-priority --backfill` wrote
   * down, never a band anybody chose — so a card says "default" rather than presenting it as a judgement. Absent on
   * a chosen band, on a row declaring none, and on a board cut before the verb published it.
   */
  readonly priorityFrom?: string;
  /**
   * What the row's closed seat waits on, when it was parked on a clock or on CI (`./readParkedWake.ts`). Absent on a
   * row with no park, on a park that waits on the owner, and on a board cut before the verb published `parked`.
   */
  readonly parkedWake?: BoardParkedWake;
  /** Whether the row carries a parked checkpoint and whether it names a wake; absent when it carries none. */
  readonly parkedCheckpoint?: BoardParkedCheckpoint;
  /**
   * When the row's standing park was journalled — checked beside {@link BoardRow.parkIndex}, so a reading taken of an
   * earlier park on the same row is never read as this one's (`./readParkedWake.ts`). Absent with no park.
   */
  readonly parkedAtIso?: string;
  /** Where that standing park sits in the row's decoded journal — with the slug, the park's identity. Absent with no park. */
  readonly parkIndex?: number;
  /** Present only while the run is parked on the owner. */
  readonly question: string | undefined;
  /**
   * What the row is REALLY waiting on. Every surface that says "waiting on your word" reads THIS.
   *
   * Reading `question !== undefined` instead is the defect this field closes, and it was spelled four
   * separate times across the console's pages, twice of them in `console/Queue.tsx`, each calling the
   * result the owner's.
   */
  readonly ownerWait: OwnerWait;
  /** When the open question was ASKED, so a 22-day-old ask stops looking like a three-minute-old one. */
  readonly questionAskedIso: string | undefined;
  /** On an `already-ruled` row, when the owner decided. */
  readonly ruledSinceQuestionIso: string | undefined;
  /** The row's status as the register derives it — not the authored `status:` line. */
  readonly status: string;
  /**
   * The doc's own summary, where a board row most often carries its Slack anchor. MEASURED:
   * 142 of 2656 rows held a Slack permalink here against 48 in question or reason —
   * `slopweaver handover list --json` and count the rows whose `summary` matches `slack.com/archives`.
   */
  readonly summary: string | undefined;
  /**
   * The first Slack permalink in the row's summary BEFORE the verb capped it at 320 characters.
   *
   * The panel has to prefer this over anything it can parse out of `summary`: MEASURED 106 of
   * the 129 board summaries carrying a permalink held it past character 320, so reading the capped text
   * alone loses the thread on five rows in six that have one — a cut the reader would have no way to see.
   */
  readonly summaryAnchor: string | undefined;
  /**
   * Where the row's answer was published, as `handover list --json` derives it (an `artifact` event supersedes the
   * front-matter line). The card draws it as a citation chip (`../../lib/cardPages.ts`); absent on a
   * row with none, or on a board cut before the field existed.
   */
  readonly artifact: string | undefined;
  /**
   * The concrete Slack ACTION this ask offers, when it offers one — `./readAction.ts`.
   *
   * Three states rather than two, and the third is what makes the panel honest: a row with no draft is the
   * ordinary ask and says so in one line, while a row whose draft will not READ is a defect between the
   * verb and this page. Drawing "this ask offers no draft" over the second would report a bug as a fact.
   */
  readonly action: BoardRowActionRead;
  /**
   * Every GitHub pull-request URL in the row's FULL summary, question and reason, before the cap.
   *
   * A published field rather than a parse of the capped `summary`, for the reason {@link
   * BoardRow.summaryAnchor} carries above: a link is rarely near the front, so scraping the capped text
   * loses most of them. The owner should not have to go and find the pull request themself.
   */
  readonly prUrls: readonly string[];
  /**
   * Whether the row published a `prUrls` field that did not read as a list of pull-request links, so a link naming a
   * workspace may be hidden: its placement is then a finding.
   */
  readonly prUrlsPartial: boolean;
  /**
   * Whether the row published no `prUrls` field at all. `prUrls` then reads empty, which is right for a register
   * placement, but a count of pull requests no seat is on cannot tell it from a row naming none.
   */
  readonly prUrlsAbsent: boolean;
  /** The row's own `anchor:` — where the ask came from, so a card can link back to what the owner actually said. */
  readonly anchor: string | undefined;
  /** What the owner said at {@link BoardRow.anchor}, stored on the row — the words a queue card leads with (`./readHisWords.ts`). */
  readonly hisWords: BoardRowHisWords;
  /** The owner's further steers on the row, each quoted off its own anchor — drawn in time order under the owner's words. */
  readonly hisWordsSteers: readonly BoardRowSteer[];
  /** The owner's words stored on OTHER rows naming a pull request this row names — drawn under the owner's own steers. */
  readonly prSteers: readonly BoardRowPrSteer[];
  /**
   * Every pull request the row names now, as `owner/repo#n` — what a proof verdict is checked against before it joins
   * this row by slug. `undefined` when the board published none that reads, which joins no verdict by slug.
   */
  readonly prNamed: readonly string[] | undefined;
  /**
   * `bearsOn:` — one line saying how {@link BoardRow.hisWords} bear on the question, drawn after the owner's words as why the
   * card is in front of the owner. The registering session's framing, never the owner's; withheld by the board while a run asks its
   * own question.
   */
  readonly bearsOn: string | undefined;
  /** `origin:` — `finding` on a row a session registered from what it observed rather than from the owner's words. */
  readonly origin: string | undefined;
  /** `observedBy:` — the session a finding row names as its observer. */
  readonly observedBy: string | undefined;
  /** `registeredBy:` — the session `handover register` ran in, so a card with no anchor names where it came from. */
  readonly registeredBy: string | undefined;
  /** `registeredRun:` — the run that session held when it registered the row. */
  readonly registeredRun: string | undefined;
  /**
   * How a settled ask ended — `filed`, `answered` or `declined` — with its witness and the instant `handover settle`
   * wrote it, which is when the ask left the owner's Queue. What lets the voice still find an ask after it leaves, and say
   * when and why (`../../lib/recentQueueDepartures.ts`). `settledIso` is absent on a row settled before it was written.
   */
  readonly settlement: AskSettlement | undefined;
  readonly settlementWitness: string | undefined;
  readonly settledIso: string | undefined;
  /** On a settled ask the owner ruled on first, when and in what words — the instant it really left the owner's Queue. */
  readonly ruledBeforeSettleIso: string | undefined;
  readonly ruledBeforeSettleWords: string | undefined;
  /**
   * `problem` — one line saying what is actually wrong or undecided, on a row that carries the SHAPE.
   *
   * A recorded ask the owner has to parse is a defect, so every ask waiting on the owner's
   * word carries a problem, two to four options with their trade-offs, and a lean. The three are whole or
   * absent together — `src/handover/askShape.ts` refuses a partial one at the verb — so a card draws its
   * "needs rewriting" mark off this field being absent while {@link BoardRow.question} is not. Never off a
   * heuristic over the prose: composing the owner's voice out of a paragraph is what `AGENTS.md` rule 2 bans.
   */
  readonly problem: string | undefined;
  /** `options` — the two to four things the owner could decide, each with its trade-off. Empty when unshaped. */
  readonly options: readonly BoardRowOption[];
  /**
   * `lean` — what the SESSION recommends the owner would most likely pick with infinite time and attention.
   *
   * In the owner's voice, which is a register and never a claim about who spoke. A surface rendering this says whose
   * it is; the row's `ruling` is the field that carries what the owner actually said.
   */
  readonly lean: string | undefined;
  /** `examples` — the concrete scenes the card leads with (`src/handover/askExamples.ts`); empty for none or a gap. */
  readonly examples: readonly string[];
  /** `exampleGap` — the one line saying the row cannot support a truthful scene, recorded instead of examples. */
  readonly exampleGap: string | undefined;
  /**
   * `shot` — the picture the ask's card shows, boxed where the owner is meant to look (`handover shot`,
   * `src/handover/askShot.ts`), read whole or not at all by the hand register's own reader. Absent on a row with none.
   */
  readonly shot: HandShotView | undefined;
  /**
   * The row published a `shot` this reader could not read whole. The card says so rather than drawing the ask as one
   * that never had a picture — a box read past its picture would point the owner at the wrong part of it.
   */
  readonly shotUnreadable: boolean;
  /**
   * `risk`, `blastRadius`, `stillReal` — the STAKES the owner reads at a glance (`src/handover/askShape.ts`).
   * Whole or absent together; absent on a row shaped before they were required, which the card says aloud.
   */
  readonly risk: string | undefined;
  readonly blastRadius: string | undefined;
  readonly stillReal: string | undefined;
  /** When the still-real check was last confirmed — what the card ages, rather than the ask's own date. */
  readonly stillRealIso: string | undefined;
  /**
   * `repo` — the checkout a seat for this row runs in. NOT where the row belongs: every fleet session runs in the
   * Slopweaver checkout, so an Acme ISO ask carried it and was drawn on the Slopweaver page.
   * {@link BoardRow.workspace} and the row's pull requests place it (`site/lib/workspacePlacement.ts`).
   */
  readonly repo: string | undefined;
  /**
   * `repoSlug` — {@link BoardRow.repo}'s `origin` as `owner/repo`, which the verb reads because a page cannot:
   * the repository a card resolves a pull-request number its sentences name bare against
   * (`site/lib/cardReferences.ts`). Absent when the path has no GitHub origin, or on a board cut before it existed.
   */
  readonly repoSlug: string | undefined;
  /**
   * The slugs this row's doc names in `blockedBy:`. The workstream band counts a row blocked by another row as
   * on the fleet rather than on a person.
   */
  readonly blockedBy: readonly string[];
  /** The current run cycle's disposition kind as the verb publishes it: `active`, `orphaned`, `never-started`. */
  readonly run: string | undefined;
  /**
   * When the row last MOVED, which is its run journal's last event. It is absent with no journal, or on a board cut
   * before the verb published it. The workstream band reads it to call an in-flight row slipping.
   */
  readonly movedIso: string | undefined;
  /**
   * Who a PAUSED row waits on, exactly as whoever paused it wrote it. It is absent on every other row and on a board
   * cut before the verb published it. The band reads this and never splits `reason`, whose phrase joins it to a
   * free-text `pausedSince` no reader could split back off.
   */
  readonly pausedOn: string | undefined;
  /**
   * The row's key=value tags a filter or card may act on, `declared` or `derived`. It is read from `row.tags` ONLY:
   * the contract (`src/handover/rowTags.ts`) carries a tag its registry refuses
   * separately, as `unrecognisedTags`, read only for a refused `context=` ({@link BoardRow.contextUnread}), never
   * acted on. A board built before `handover list --json` published
   * `tags` reads `absent` on every row.
   */
  readonly tags: readonly BoardTag[];
  /**
   * How much of `tags` read: `whole`; `partial` when the field is not a list, a member was dropped, or the row says
   * `tagsIncomplete: true` (its journal did not wholly read, so a declared tag may be missing); `absent` when
   * the row publishes no `tags` at all. Only a `whole` read says a row with no workstream tag is untagged.
   */
  readonly tagsRead: BoardTagsRead;
  /**
   * Whether the producer read the row's run journal only in part, so a DECLARED tag may be missing or stale. It is
   * `undefined` when the row does not publish the field, or publishes something other than a boolean, which reads as
   * unknown rather than complete: only `false` lets a declared tag act.
   */
  readonly tagsIncomplete: boolean | undefined;
  /**
   * `workspace` — whose work the row is, as its writer STATED it (`handover set-workspace`). Absent when the doc
   * states none. A value this reader does not know is absent here and carried as {@link BoardRow.workspaceUnread}. Read by `site/lib/workspacePlacement.ts` beside the row's pull requests and destinations.
   */
  readonly workspace: Workspace | undefined;
  /**
   * A `workspace:` line naming no workspace, as the verb published it (`workspaceUnread`): the row's placement is
   * then a finding, never the absence it would otherwise read as.
   */
  readonly workspaceUnread: string | undefined;
  /**
   * A `context=` the tag registry refused (published under `unrecognisedTags`, a misspelt value say), or a list
   * that would not read so one may be hidden: a statement that did not read, so the row's placement is a finding,
   * never the absence it would otherwise read as. No other refused tag places a row.
   */
  readonly contextUnread: string | undefined;
}

/** How much of a row's published `tags` field read. */
export type BoardTagsRead = "whole" | "partial" | "absent";

/**
 * A row's actionable tags, dropping any member that is not a `{ key, value, source }` with a `declared` or
 * `derived` source.
 *
 * A bad member is dropped rather than refusing the whole board, the same trade {@link prUrlsOf} makes: a queue
 * that rendered nothing is worse than a band missing one tag. A member whose source is `unrecognised` is exactly
 * such a drop, so a refused tag can never reach a fold even if a producer mislabels where it put one.
 *
 * @returns the tags that read, and how much of the field read
 */
export function boardTagsOf({ row }: { row: Bag }): {
  readonly tags: readonly BoardTag[];
  readonly read: BoardTagsRead;
} {
  const raw: unknown = row["tags"];
  // A row that says its journal did not wholly read is partial whatever it published, a missing `tags` included —
  // and so is one whose `tagsIncomplete` is present but no boolean: that is a completeness that did not read, never
  // one that was not said.
  const flag: unknown = row["tagsIncomplete"];
  const incomplete = flag === true || (flag !== undefined && typeof flag !== "boolean");
  if (raw === undefined) {
    return { read: incomplete ? "partial" : "absent", tags: [] };
  }
  if (!Array.isArray(raw)) {
    return { read: "partial", tags: [] };
  }
  const tags: BoardTag[] = [];
  for (const entry of raw as readonly unknown[]) {
    const tag = boardTagOf({ entry });
    if (tag !== undefined) {
      tags.push(tag);
    }
  }
  if (tags.length < raw.length || incomplete) {
    return { read: "partial", tags };
  }
  return { read: "whole", tags };
}

/**
 * One option on a shaped ask, as the verb publishes it.
 *
 * Restated structurally rather than imported: `site/` never imports from `src/`, so
 * `src/handover/askShape.ts`'s `AskOption` and this are two declarations of one wire shape, kept honest by
 * `readBoard` refusing a member missing either half.
 */
export interface BoardRowOption {
  /** `A`, `B`, `C` or `D`, assigned by the verb from POSITION so two options can never claim one letter. */
  readonly letter: string;
  readonly option: string;
  /** What taking it costs — one line, never "none". */
  readonly tradeoff: string;
}

/** The board, and what its sweep could not finish. */
export interface Board {
  readonly rows: readonly BoardRow[];
  readonly unresolved: number;
  readonly linear: LinearReferences;
  /** The monitors, controls and risks a card may name by a bare id — lenient, never a reason to refuse the board. */
  readonly records: RecordReferences;
  /** When the scan began, the instant every doc written before it is on the board; absent on a board cut before the field. */
  readonly scanStartedIso: string | undefined;
  /** The doc files the scan could not read — an ask in one of them is unknown here, not absent. */
  readonly unreadable: readonly string[];
  /** Runs waiting on the owner's word whose doc no board row carries — `src/handover/detachedAsk.ts`. */
  readonly detachedAsks: readonly DetachedAsk[];
}

/**
 * The shaped options one row carries, dropping any member that does not carry both halves.
 *
 * Dropping rather than refusing the whole board: a card showing two of three options is recoverable and a
 * queue that rendered nothing is not. The letter is the verb's, read off the wire rather than re-derived
 * here, so the console and the doc's own markdown label the same option the same way.
 *
 * @param row the row's raw bag
 * @returns the options in the order the verb wrote them, empty on an unshaped row
 */
function rowOptions({ row }: { row: Bag }): readonly BoardRowOption[] {
  const raw = bags({ bag: row, key: "options" });
  if (raw === undefined) {
    return [];
  }
  const out: BoardRowOption[] = [];
  for (const one of raw) {
    const letter = str({ bag: one, key: "letter" });
    const option = str({ bag: one, key: "option" });
    const tradeoff = str({ bag: one, key: "tradeoff" });
    if (letter === undefined || option === undefined || tradeoff === undefined) {
      continue;
    }
    out.push({ letter, option, tradeoff });
  }
  return out;
}

/**
 * A row's stated workspace as the verb published it, and the value it would not read as one. A `workspace` field
 * that is present but names no workspace this page knows is carried as `workspaceUnread` even when the verb did
 * not say so, so the row is a finding rather than a row stating nothing.
 *
 * @param row the published board row
 * @returns the two fields
 */
export function workspaceFieldsOf({ row }: { row: Bag }): Pick<BoardRow, "workspace" | "workspaceUnread"> {
  const published = str({ bag: row, key: "workspaceUnread" });
  const value = row["workspace"];
  if (isWorkspace(value)) {
    return { workspace: value, workspaceUnread: published };
  }
  if (value === undefined || published !== undefined) {
    return { workspace: undefined, workspaceUnread: published };
  }
  if (typeof value === "string") {
    return { workspace: undefined, workspaceUnread: value };
  }
  return { workspace: undefined, workspaceUnread: JSON.stringify(value) };
}

/**
 * Project `handover list --json` into the workstreams tile's shape.
 *
 * The board is the only register of what is in flight, so a row this cannot read refuses the tile. A
 * workstream missing from a board that still looks complete is the one failure this surface cannot have.
 *
 * @returns the board, or `undefined` when the payload is not one, or one of its rows will not read
 */
export function readBoard(payload: unknown): Board | undefined {
  if (!isBag(payload)) {
    return undefined;
  }
  const rows = bags({ bag: payload, key: "rows" });
  const unresolved = num({ bag: payload, key: "unresolved" });
  if (rows === undefined || unresolved === undefined) {
    return undefined;
  }
  const out: BoardRow[] = [];
  for (const row of rows) {
    const read = readBoardRow({ row });
    if (read === undefined) {
      return undefined;
    }
    out.push(read);
  }
  const linear = linearReferencesOf({ payload });
  const unreadable = unreadableOf({ payload });
  const scanStartedIso = str({ bag: payload, key: "scanStartedIso" });
  // A present field that will not read refuses the board: read as absent, it would fall back to the end stamp and
  // judge a board that missed an ask as current.
  const scanStartMalformed = Object.hasOwn(payload, "scanStartedIso") && scanStartedIso === undefined;
  const detachedAsks = detachedAsksOf({ payload });
  if (linear === undefined || unreadable === undefined || scanStartMalformed || detachedAsks === undefined) {
    return undefined;
  }
  const records = recordReferencesOf({ payload });
  return { detachedAsks, linear, records, rows: out, scanStartedIso, unreadable, unresolved };
}

/**
 * One published board row, exactly as `readBoard` reads every row of the document — exported so a row the Queue
 * stands up for a detached ask (`../../lib/detachedAskRow.ts`) goes through the same reader, every field it does
 * not carry absent rather than invented.
 *
 * @param row the raw row
 * @returns the row, or `undefined` when a required field will not read
 */
export function readBoardRow({ row }: { row: Bag }): BoardRow | undefined {
  const slug = str({ bag: row, key: "slug" });
  const section = str({ bag: row, key: "section" });
  const reason = str({ bag: row, key: "reason" });
  const kind = str({ bag: row, key: "kind" });
  const status = str({ bag: row, key: "status" });
  const ownerWait = ownerWaitOf({ value: str({ bag: row, key: "ownerWait" }) });
  const settlement = settlementOf({ row });
  if (
    slug === undefined ||
    section === undefined ||
    reason === undefined ||
    kind === undefined ||
    status === undefined ||
    ownerWait === undefined ||
    settlement === "unread"
  ) {
    return undefined;
  }
  const tagged = boardTagsOf({ row });
  const priorityFrom = str({ bag: row, key: "priorityFrom" });
  // A picture that will not read leaves the rest of the row standing: one bad box is no reason to lose the board.
  const pictured = readHandShotView({ unboxed: "refused", value: row["shot"] });
  const parkedWake = parkedWakeOf({ row });
  const parkedCheckpoint = parkedCheckpointOf({ row });
  const parkedAtIso = parkedAtIsoOf({ row });
  const parkIndex = parkIndexOf({ row });
  return {
    ...(priorityFrom === undefined ? {} : { priorityFrom }),
    ...(parkedWake === undefined ? {} : { parkedWake }),
    ...(parkedCheckpoint === undefined ? {} : { parkedCheckpoint }),
    ...(parkedAtIso === undefined ? {} : { parkedAtIso }),
    ...(parkIndex === undefined ? {} : { parkIndex }),
    action: rowAction({ row }),
    anchor: str({ bag: row, key: "anchor" }),
    artifact: str({ bag: row, key: "artifact" }),
    bearsOn: str({ bag: row, key: "bearsOn" }),
    blastRadius: str({ bag: row, key: "blastRadius" }),
    blockedBy: listOf({ key: "blockedBy", row }),
    contextUnread: contextUnreadOf({ row }),
    exampleGap: str({ bag: row, key: "exampleGap" }),
    examples: listOf({ key: "examples", row }),
    hisWords: readRowHisWords({ row }),
    hisWordsSteers: readRowSteers({ row }),
    kind,
    lean: str({ bag: row, key: "lean" }),
    movedIso: str({ bag: row, key: "movedIso" }),
    observedBy: str({ bag: row, key: "observedBy" }),
    options: rowOptions({ row }),
    origin: str({ bag: row, key: "origin" }),
    ownerWait,
    pausedOn: str({ bag: row, key: "pausedOn" }),
    prNamed: strings({ bag: row, key: "prNamed" }),
    prSteers: readRowPrSteers({ row }),
    priority: str({ bag: row, key: "priority" }),
    problem: str({ bag: row, key: "problem" }),
    prUrls: prUrlsOf({ row }),
    prUrlsAbsent: row["prUrls"] === undefined,
    prUrlsPartial: prUrlsUnread({ row }),
    question: str({ bag: row, key: "question" }),
    questionAskedIso: str({ bag: row, key: "questionAskedIso" }),
    reason,
    registeredBy: str({ bag: row, key: "registeredBy" }),
    registeredRun: str({ bag: row, key: "registeredRun" }),
    repo: str({ bag: row, key: "repo" }),
    repoSlug: str({ bag: row, key: "repoSlug" }),
    risk: str({ bag: row, key: "risk" }),
    ruledBeforeSettleIso: str({ bag: row, key: "ruledBeforeSettleIso" }),
    ruledBeforeSettleWords: str({ bag: row, key: "ruledBeforeSettleWords" }),
    ruledSinceQuestionIso: str({ bag: row, key: "ruledSinceQuestionIso" }),
    run: str({ bag: row, key: "run" }),
    section,
    settledIso: str({ bag: row, key: "settledIso" }),
    settlement,
    settlementWitness: str({ bag: row, key: "settlementWitness" }),
    shot: pictured?.shot,
    shotUnreadable: pictured === undefined,
    slug,
    status,
    stillReal: str({ bag: row, key: "stillReal" }),
    stillRealIso: str({ bag: row, key: "stillRealIso" }),
    summary: str({ bag: row, key: "summary" }),
    summaryAnchor: str({ bag: row, key: "summaryAnchor" }),
    tags: tagged.tags,
    tagsIncomplete: tagsIncompleteOf({ row }),
    tagsRead: tagged.read,
    ...workspaceFieldsOf({ row }),
  };
}
