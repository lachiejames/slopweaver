/**
 * `slopweaver handover list --json` — the board as one machine-readable document.
 *
 * The human board is rendered prose: sections, banners, a truncation caveat, a typo'd-slug footnote. Every
 * one of those is right for a reader and wrong for a caller, and until this lane existed the only way to
 * get the board into a program was to parse that prose — a shape no test covers, breaking silently the
 * first time a heading is reworded.
 *
 * It projects {@link BoardModel}, the same composition the rendered board reads, so the two can disagree
 * about PRESENTATION and can never disagree about placement. `docs/console.md`'s rule is the one being
 * kept here: a surface may choose what to SHOW; none of them may choose what is TRUE.
 *
 * Deliberately NOT the whole `HandoverDoc`. A doc carries its own body and every front-matter field it was
 * written with, and a caller that wanted those already has the `path` to read them; what this emits is the
 * board's own answer — where a row sits, why, and enough identity to go and look.
 *
 * ## The summary cap, and why the document reports it
 *
 * One front-matter field breaks that contract from the OTHER side: `summary:` is authored, so nothing bounds
 * it, and five `fresh-supervisor-handoff-*` docs on this machine carry a whole handoff brief in theirs —
 * 535 to 570 KB EACH. MEASURED with `./bin/slopweaver handover list --json | wc -c`: the document
 * was **28.34 MB over 2,671 rows, of which `summary` alone was 27.18 MB — 96%**, and everything else 1.15 MB.
 * Through the console's own route (`GET /api/live/board`) that was **28.35 MB in 31.5 seconds**, for a page
 * whose queue consumes the 40 rows carrying a question. A half-megabyte string is not "enough identity to go
 * and look"; it is the doc, and the caller already has the `path`.
 *
 * So the field is capped at {@link BOARD_SUMMARY_CHARS} — 1.98 MB at that cap, a 93% cut, with 2,424 of the
 * 2,671 rows truncated. Reproduce the distribution at any cap with:
 * `./bin/slopweaver handover list --json | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{const l=JSON.parse(s).rows.map(r=>(r.summary??"").length);for(const c of [320,600])console.log(c,l.reduce((a,x)=>a+Math.min(x,c),0));})'`
 *
 * **The cap is REPORTED, never silent.** `src/lib/truncation.ts` is the repo's shape for exactly this and
 * states the reason in its own header: a thin answer from a silent cap has two indistinguishable
 * explanations. `summaryTruncation` carries `longest`, so the 570,555-character row stays visible as a fact
 * about the board rather than being quietly trimmed out of sight.
 */

import type { HandShot } from "../../../hand/shot.js";
import type { AskAction } from "../../../handover/askAction.js";
import type { AskOption } from "../../../handover/askShape.js";
import type { BoardModel } from "../../../handover/boardTypes.js";
import { publishedArtifactOf } from "../../../handover/derivedRowState.js";
import type { DetachedAsk, UnreadJournal } from "../../../handover/detachedAsk.js";
import type { HisWords } from "../../../handover/hisWords.js";
import type { MailPreview } from "../../../handover/mailActionPreview.js";
import type { OwnerWaitKind } from "../../../handover/ownerWait.js";
import { pauseSubjectFor } from "../../../handover/pauseSubject.js";
import { type PrSteer, prIdentitiesIn, prSteersByRow } from "../../../handover/prSteers.js";
import type { RowTag } from "../../../handover/rowTags.js";
import type { SettledThenAsked } from "../../../handover/settledAsk.js";
import { matchesTagFilter, type TagFilter } from "../../../handover/tagFilter.js";
import type { Workspace } from "../../../handover/workspace.js";
import { safeJsonStringify } from "../../../lib/safeJson.js";
import { type Truncation, truncationAtCap } from "../../../lib/truncation.js";
import type { LinearReferenceFacts } from "../../linearReferenceFacts.js";
import type { RecordReferenceFact } from "../../recordReferenceFacts.js";
import { actionOf, examplesOf, mailPreviewFor, optionsFor, publishedStillRealOf, shapeOf } from "./listJsonAsk.js";
import { boardPrSteerRows, prSteerRowOf } from "./listJsonPrSteers.js";
import {
  BOARD_SUMMARY_CHARS,
  type BoardJsonSteer,
  cappedSummary,
  cardSourceFields,
  prUrlsIn,
  summaryAnchorOf,
} from "./listJsonRowText.js";
import { type PublishedSettlement, publishedSettlementOf } from "./listJsonSettlement.js";
import { type PublishedParked, publishedParkedOf, publishedWaitOf, ruledSinceQuestionIsoOf } from "./listJsonWait.js";
import { referenceContextOf } from "./referenceContext.js";

/**
 * What the board's cards resolve a reference their sentences name WITHOUT its address against — each row's
 * repository as `owner/repo`, and the install's Linear workspace. Read at the effectful edge
 * (`./boardReferences.ts`), handed in here so the projection stays pure.
 */
export interface BoardReferences {
  /** A doc's `repo:` path to its `origin` repository, `owner/repo` — a path with no origin is simply absent. */
  readonly repoSlugs: ReadonlyMap<string, string>;
  readonly linear: LinearReferenceFacts;
  readonly records: readonly RecordReferenceFact[];
  /** The names only the owner answers to, case-folded, so a `pausedOn:` naming the owner publishes as the owner's role word. */
  readonly ownerNames: ReadonlySet<string>;
}

/** No references at all — an empty board, or a caller with no home to read them from. */
export const NO_BOARD_REFERENCES: BoardReferences = {
  linear: { teamKeys: [], workspaceSlug: undefined },
  ownerNames: new Set(),
  records: [],
  repoSlugs: new Map(),
};

/**
 * One row of the board, as a caller reads it.
 *
 * It is the element type of {@link BoardJsonDocument}'s `rows`, and the whole of what `handover row --json`
 * prints for one slug (`boardRowJsonText`, `./rowJson.ts`) — there with that one row's summary left whole.
 */
export interface BoardJsonRow extends PublishedSettlement {
  readonly slug: string;
  readonly kind: string;
  readonly section: string;
  /** Why the board put it in that section — the same sentence the rendered row carries. */
  readonly reason: string;
  /**
   * The row's status as the REGISTER gives it — {@link ../../../handover/derivedRowState.ts}'s answer, not
   * the `status:` line.
   *
   * It is derived rather than the authored line, because a filter on a field "never written by anything" is
   * wrong (`derivedRowState.ts`'s own header names four readers that did it), and this document — which the
   * console reads — would be the fifth. MEASURED: four rows carried a front-matter `settlement:`
   * beside `status: ready` and the console read every one of them as an open ask.
   */
  readonly status: string;
  /** The `status:` line as authored, kept so the change above loses nothing a caller had before. */
  readonly authoredStatus: string;
  /** What decided {@link BoardJsonRow.status} — `settlement`, `closed-event`, `abandoned-event`, `authored`. */
  readonly statusFrom: string;
  readonly priority: string | undefined;
  /** `default` when {@link BoardJsonRow.priority} is the kind default a backfill wrote down, never a band chosen. */
  readonly priorityFrom: string | undefined;
  /**
   * Who a PAUSED row waits on, in the words whoever paused it used, and absent on every other row. Published apart
   * from `reason` because the phrase there joins it to a free-text `pausedSince`, so no reader can split them back.
   */
  readonly pausedOn: string | undefined;
  /** The tags a filter matches and a card reads: declared in the row's journal, then derived from its fields. */
  readonly tags: readonly RowTag[];
  /** Journalled tags the running registry refuses — shown so they can be fixed, never matched. */
  readonly unrecognisedTags: readonly { readonly key: string; readonly value: string }[];
  /** The row's journal could not be completely read, so its declared tags and `reply` may be incomplete. */
  readonly tagsIncomplete: boolean;
  readonly summary: string | undefined;
  /**
   * The first Slack permalink in the row's FULL summary, before {@link BOARD_SUMMARY_CHARS} cut it.
   *
   * It is a separate field rather than a wider cap because the summary is where a board row most often
   * carries its Slack anchor and the anchor is rarely near the front. MEASURED over the 2,677
   * docs on one machine: 129 summaries carried a permalink and **106 of them sat past character 320**, so
   * capping alone would have silently removed the thread from five rows in six that had one. Reproduce:
   * count the docs whose `summary:` matches `slack.com/archives` against those whose first 320
   * characters still do.
   */
  readonly summaryAnchor: string | undefined;
  /**
   * Where the row's answer was published — the DERIVED artifact ({@link ../../../handover/derivedRowState.ts}), so an
   * `artifact` event supersedes the front-matter line, exactly as `handover resume` prints it.
   *
   * Published so the Queue card draws it as a citation chip: a link the owner can open in a browser belongs on the
   * card. A row had carried that artifact for two days while a document that never published it left no card able to
   * draw it.
   *
   * Absent for the `artifact: null` line a doc declares before it has one (`src/handover/frontmatter.ts`), which the
   * parser keeps as the STRING `null`. MEASURED: 6,118 board rows carried it, so publishing it raw draws a
   * chip named "null" on every such card. Repro, on a build that does not skip it:
   * `slopweaver handover list --json | jq -r '.rows[].artifact // empty' | grep -c '^null$'`
   */
  readonly artifact: string | undefined;
  readonly repo: string | undefined;
  /**
   * The `origin` repository of {@link BoardJsonRow.repo}, as `owner/repo` — what a card resolves a number its
   * sentences name bare against. An ask names its pull requests by number alone, and `repo:` is the
   * one field saying whose numbers they are — as a local path the console cannot read a remote from.
   */
  readonly repoSlug: string | undefined;
  /**
   * The doc's stated `workspace:` (`src/handover/workspace.ts`) — whose work the row is, which {@link BoardJsonRow.repo}
   * cannot say: that is only where its session runs. What the console's workspace selector reads for a board row.
   */
  readonly workspace: Workspace | undefined;
  /**
   * A `workspace:` line naming no workspace, as written, so the console makes the row a finding rather than
   * reading it as one stating nothing.
   */
  readonly workspaceUnread: string | undefined;
  readonly path: string;
  readonly blockedBy: readonly string[];
  /** The current run cycle's disposition kind — `active`, `waiting-on-owner`, `closed`, and the rest. */
  readonly run: string;
  /** When the row last moved: its run journal's last event instant, absent with no journal. */
  readonly movedIso: string | undefined;
  /**
   * Present only while the row waits on the owner: the question a run recorded, or — with no run behind it —
   * the summary of a registered ask the board parked on the owner off its whole shape (`handover/registeredAsk.ts`).
   */
  readonly question: string | undefined;
  /**
   * When that question was ASKED — the `question` event's own instant, carried through a correction.
   *
   * The field whose absence makes every ask look the same age. MEASURED across a board's 41
   * open questions: 26 were older than four days and the oldest was 22.5 days, and no surface
   * could say so without an instant on {@link BoardJsonRow}.
   */
  readonly questionAskedIso: string | undefined;
  /**
   * What the row is REALLY waiting on — `not-waiting`, `settled`, `already-ruled`, `not-runnable`, or the kind that means the owner's turn.
   *
   * Computed by {@link ../../../handover/ownerWait.ts}, which carries the measurement: 21 of 41 open
   * questions were not the owner's. A surface that renders "waiting on your word" reads THIS, never `question`.
   */
  readonly ownerWait: OwnerWaitKind;
  /** On an `already-ruled` row, when the owner decided — so a reader can check the ruling came after the question. */
  readonly ruledSinceQuestionIso: string | undefined;
  /** The seat parked on this row and closed ({@link PublishedParked}); absent unless one is now. */
  readonly parked: PublishedParked | undefined;
  /**
   * `problem` — one line saying what is actually wrong or undecided, on a row that carries the SHAPE.
   *
   * A recorded ask the owner has to parse is a defect. The three fields are whole
   * or absent together ({@link ../../../handover/askShape.ts}), so a surface draws its "needs rewriting"
   * mark off this one being absent while {@link question} is not — never off a heuristic over the prose.
   */
  readonly problem: string | undefined;
  /** `options` — the two to four things the owner could decide, each with its trade-off. Empty when unshaped. */
  readonly options: readonly AskOption[];
  /**
   * `lean` — what the SESSION recommends the owner would most likely pick with infinite time and attention.
   *
   * In the owner's voice, which is a register and never a claim about who spoke. A surface rendering this says so;
   * `ruling` is the field that carries what the owner actually said.
   */
  readonly lean: string | undefined;
  /**
   * The CONCRETE EXAMPLES the card leads with — one to three second-person scenes, each ending on the question
   * (`../../../handover/askExamples.ts`). Empty on a row that carries none or a gap instead.
   */
  readonly examples: readonly string[];
  /** Why the row cannot support a truthful scene — present exactly when it recorded that instead of examples. */
  readonly exampleGap: string | undefined;
  /**
   * `risk`, `blastRadius` and `stillReal` — the STAKES the owner reads at a glance (`../../../handover/askShape.ts`),
   * whole or absent together, and absent on a row shaped before they were required.
   */
  readonly risk: string | undefined;
  readonly blastRadius: string | undefined;
  readonly stillReal: string | undefined;
  /**
   * When the still-real check was last CONFIRMED — the instant the shape was recorded: the run's `question`
   * or `question-offered` event, or `handover register`'s own clock. Present exactly when the stakes are,
   * so a card can say how old the check is instead of how old the ask is.
   */
  readonly stillRealIso: string | undefined;
  /**
   * The picture the card shows, boxed where the owner should read (`../../../handover/askShot.ts`) —
   * the RUN's when a run is parked on the owner, otherwise the doc's own, for the reason {@link examples} picks one source.
   * The PNG is served by its hash from the hand-shot store; the boxes are in image pixels.
   */
  readonly shot: HandShot | undefined;
  /**
   * The concrete Slack ACTION the ask offers — the drafted message, who it tags and where it could go.
   *
   * Published only off the RUN's open question, never off front-matter: a registered row acquires an offer
   * when a visible session records one with `handover ask --action` or `handover offer`, and there is no
   * front-matter key for it precisely so a doc cannot claim a draft nobody authored (`../../../handover/askAction.ts`).
   */
  readonly action: AskAction | undefined;
  /**
   * True when the run's ask DID offer a draft and the journal's copy of it would not read.
   *
   * The third state, and the reason it is published rather than folded into the absence above: a row with
   * no draft legitimately shows the options its doc's front matter carries, and a row with a broken one
   * must not, because those options describe the destinations that just failed to decode. The console
   * names the defect off this rather than drawing "this ask offers no draft" over it
   * (`site/components/live/readAction.ts`).
   */
  readonly actionUnreadable: boolean;
  /**
   * Where the console draws the row's MAIL action, and the digest a press from it carries — present
   * exactly when {@link BoardJsonRow.action} is a mail action. Published here rather than computed by the
   * console so the address on the card and the digest `gmail draft --board` checks are one computation.
   */
  readonly mailPreview: MailPreview | undefined;
  /**
   * Every GitHub pull-request URL the row's own text names, read off the FULL summary before
   * {@link BOARD_SUMMARY_CHARS} can reach it, and off the question and reason beside it.
   *
   * A published field rather than something the console scrapes, for the reason
   * {@link BoardJsonRow.summaryAnchor} already records one field over: the capped summary is the wrong 320
   * characters for finding a link, and the owner should not have to navigate to one.
   */
  readonly prUrls: readonly string[];
  /** The doc's own `anchor:` — where the ask came from, when the row declares one. */
  readonly anchor: string | undefined;
  /** The owner's words at {@link BoardJsonRow.anchor}, stored on the row (`../../../handover/hisWords.ts`), when it reads. */
  readonly ownerWords: HisWords | undefined;
  /** Why the owner's words at the anchor would not read when last tried — the card says so rather than refusing. */
  readonly ownerWordsUnread: string | undefined;
  /** Why a stored quote does not read — never drawn; `handover quote --apply` rewrites it. */
  readonly ownerWordsDefect: string | undefined;
  /** The owner's further steers on the row, each quoted off its own anchor (`../../../handover/hisWordsSteers.ts`). */
  readonly ownerWordsSteers: readonly BoardJsonSteer[];
  /**
   * The owner's words about each pull request this row names, recorded on the OTHER rows naming it exactly
   * (`../../../handover/prSteers.ts`), folded over the whole board before `--tag` narrows it. Absent on a read of one
   * row (`handover row --json`), which has no board to fold over — never an empty list standing for "none".
   */
  readonly prSteers: readonly PrSteer[] | undefined;
  /**
   * Every pull request this row names NOW, exactly as the fold reads it — what a reader checks a recorded proof
   * verdict against before joining it to this row by slug, since a reading is a tick old and a slug can be reused.
   */
  readonly prNamed: readonly string[];
  /** `bearsOn:` — how the owner's words bear on the REGISTERED question, the line the card draws after them. */
  readonly bearsOn: string | undefined;
  /** `origin:` — `finding` on a row a session registered from what it observed, so a card can say so. */
  readonly origin: string | undefined;
  /** `observedBy:` — the session a finding row names as its observer. */
  readonly observedBy: string | undefined;
  /** `registeredBy:` — the session `handover register` ran in, so a card with no anchor names where it came from. */
  readonly registeredBy: string | undefined;
  /** `registeredRun:` — the run that session held when it registered the row. */
  readonly registeredRun: string | undefined;
}

/** The whole board, plus what the sweep could not answer. */
export interface BoardJsonDocument {
  readonly observedAtIso: string;
  /** When the scan began: the one instant every doc written before it is certain to be on the board. */
  readonly scanStartedIso: string;
  readonly handoverDir: string;
  /** How many of the sweep's docs went unresolved before the deadline cut it — 0 on a complete board. */
  readonly unresolved: number;
  /** Doc files the scan could not read at all. */
  readonly unreadable: readonly string[];
  readonly rows: readonly BoardJsonRow[];
  /**
   * Runs waiting on the owner's word whose doc no board row carries (`../../../handover/detachedAsk.ts`). Outside `rows`
   * because there is no doc to derive a status, workspace or tag from, and never narrowed by `--tag` for the
   * same reason: a question with no tags cannot honestly match or miss a filter.
   */
  readonly detachedAsks: readonly DetachedAsk[];
  /** Journals no board doc claims that would not read whole, so a question one holds is unseen. */
  readonly unreadJournals: readonly UnreadJournal[];
  /**
   * Settled ask rows whose run holds a question asked AFTER the settlement (`../../../handover/settledAsk.ts`) — on no
   * other surface, so drawn over every model and never narrowed by `--tag`, exactly as {@link detachedAsks} is.
   */
  readonly settledThenAsked: readonly SettledThenAsked[];
  /** The `--tag` terms `rows` was narrowed by, each once, as written — empty when the board is whole. */
  readonly tagFilter: readonly string[];
  /** Every composed row before the filter, closed sections included: the population `tagFilter` narrowed. */
  readonly rowsBeforeFilter: number;
  /**
   * What {@link BOARD_SUMMARY_CHARS} cut across the rows that carried a summary at all.
   *
   * On the board this was written against, `longest` is 570,555 — a whole supervisor handoff brief in one
   * doc's front matter. That number is the point of publishing the tally: the cap keeps the document
   * readable and this field keeps the reason it had to exist from disappearing with it.
   */
  readonly summaryTruncation: Truncation;
  /**
   * The install's Linear workspace, so a card links a bare `QQQQ-134` whose team is one of these keys. Once per
   * document rather than per row: it is a fact about the install, never about a doc.
   */
  readonly referenceContext: {
    readonly linearWorkspaceSlug: string | undefined;
    readonly linearTeamKeys: readonly string[];
    /** Every monitor, control and risk a card may name by a bare id (`../../recordReferenceFacts.ts`). */
    readonly records: readonly RecordReferenceFact[];
  };
}

/**
 * A row's repository and pull-request fields: its `repo:` and that path's `origin`, the pull-request links its prose
 * names, and the owner's words about its pull requests from the rest of the board.
 *
 * @param model the doc's composed placement
 * @param question the question the row publishes, which may name a pull request
 * @param repoSlugs each doc `repo:` path's `origin` repository
 * @param prSteers the owner's words about this row's pull requests from the rest of the board
 * @returns the fields
 */
function pullRequestFieldsOf({
  model,
  question,
  repoSlugs,
  prSteers,
}: {
  model: BoardModel;
  question: string | undefined;
  repoSlugs: ReadonlyMap<string, string>;
  prSteers: readonly PrSteer[] | undefined;
}): Pick<BoardJsonRow, "prNamed" | "prSteers" | "prUrls" | "repo" | "repoSlug"> {
  const steerRow = prSteerRowOf({ model, repoSlugs });
  return {
    prNamed: prIdentitiesIn({ repoSlug: steerRow.repoSlug, texts: steerRow.texts }),
    prSteers,
    prUrls: prUrlsIn({ parts: [model.doc.summary, question, model.reason] }),
    repo: model.doc.repo,
    repoSlug: model.doc.repo === undefined ? undefined : repoSlugs.get(model.doc.repo),
  };
}

/**
 * Who a PAUSED row waits on, as published: the owner's role word when the doc names the owner by a name only the owner answers
 * to, so a row paused under the owner's name still reads as the owner's; any other subject as
 * written. A PAUSED placement is only ever `pausedStateOf`'s, so this is the subject its phrase prints.
 */
function publishedPausedOn({
  model,
  ownerNames,
}: {
  model: BoardModel;
  ownerNames: ReadonlySet<string>;
}): string | undefined {
  const subject = model.doc.pausedOn;
  if (model.section !== "PAUSED" || subject === undefined) {
    return undefined;
  }
  return pauseSubjectFor({ names: ownerNames, who: subject });
}

/**
 * One composed placement as the row `--json` prints, with every derived field resolved once. Its `shot` is the RUN's
 * when a run is parked on the owner, as its examples are: a run asking its own question never shows a picture boxed for the
 * registered one.
 *
 * @param model the doc's composed placement
 * @param repoSlugs each doc `repo:` path's `origin` repository ({@link BoardReferences.repoSlugs})
 * @param prSteers the owner's words about this row's pull requests from the rest of the board, `undefined` with no board
 * @param ownerNames the names only the owner answers to ({@link BoardReferences.ownerNames})
 * @returns the row, its summary capped at {@link BOARD_SUMMARY_CHARS}
 */
export function boardJsonRow({
  model,
  repoSlugs,
  prSteers,
  ownerNames,
}: {
  model: BoardModel;
  repoSlugs: ReadonlyMap<string, string>;
  prSteers: readonly PrSteer[] | undefined;
  ownerNames: ReadonlySet<string>;
}): BoardJsonRow {
  const { wait, question, questionAskedIso } = publishedWaitOf({ model });
  const recorded = shapeOf({ model });
  const stakes = recorded?.shape.stakes;
  return {
    action: actionOf({ run: model.run }),
    // Beside the action, not in it: "offers no draft" is not "this draft is broken", as `shapeOf` above holds.
    actionUnreadable: model.run.kind === "waiting-on-owner" && model.run.actionUnreadable,
    anchor: model.doc.anchor,
    artifact: publishedArtifactOf({ derived: model.derived, doc: model.doc }),
    authoredStatus: model.doc.status,
    blastRadius: stakes?.blastRadius,
    blockedBy: model.doc.blockedBy,
    ...cardSourceFields({ model }),
    ...examplesOf({ model }),
    kind: model.doc.kind,
    lean: recorded?.shape.lean,
    mailPreview: mailPreviewFor({ action: actionOf({ run: model.run }), slug: model.doc.slug }),
    movedIso: model.movedIso,
    options: optionsFor({ model, shape: recorded?.shape }),
    ownerWait: wait.kind,
    parked: publishedParkedOf({ model }),
    problem: recorded?.shape.problem,
    path: model.doc.path,
    pausedOn: publishedPausedOn({ model, ownerNames }),
    ...pullRequestFieldsOf({ model, prSteers, question, repoSlugs }),
    priority: model.doc.priority,
    priorityFrom: model.doc.priorityFrom,
    question,
    questionAskedIso,
    reason: model.reason,
    risk: stakes?.risk,
    ruledSinceQuestionIso: ruledSinceQuestionIsoOf({ wait }),
    run: model.run.kind,
    section: model.section,
    ...publishedSettlementOf({ model }),
    shot: model.run.kind === "waiting-on-owner" ? model.run.shot : model.doc.shot,
    slug: model.doc.slug,
    status: model.derived.status,
    statusFrom: model.derived.statusFrom,
    ...publishedStillRealOf({ doc: model.doc, run: model.run }),
    summary: cappedSummary({ summary: model.doc.summary }),
    summaryAnchor: summaryAnchorOf({ summary: model.doc.summary }),
    tags: model.tags.tags,
    tagsIncomplete: model.tagsIncomplete,
    unrecognisedTags: model.tags.unrecognised.map(({ key, value }) => ({ key, value })),
    workspace: model.doc.workspace,
    workspaceUnread: model.doc.workspaceUnread,
  };
}

/**
 * Project the composed board into the JSON document `--json` prints.
 *
 * @param models every doc's composed placement, in board order
 * @param handoverDir where the docs were scanned from, so a caller can tell two boards apart
 * @param unresolved how many docs the probe sweep did not finish
 * @param unreadable the doc files the scan could not read
 * @param observedAtIso when the board was composed — stamped by the caller so a test can pin it
 * @param scanStartedIso when the doc scan began, the bound a reader proves a doc was seen against
 * @param references what a card resolves a reference named without its address against
 * @param filter the `--tag` filter narrowing `rows`; every other field stays a fact about the whole board
 * @param detached what `handover list`'s journal sweep found waiting with no doc on the board
 * @returns the document, ready to serialise
 */
export function boardJsonDocument({
  detached,
  filter,
  models,
  handoverDir,
  unresolved,
  unreadable,
  observedAtIso,
  references,
  scanStartedIso,
}: {
  detached: DetachedFindings;
  models: readonly BoardModel[];
  handoverDir: string;
  unresolved: number;
  unreadable: readonly string[];
  observedAtIso: string;
  filter: TagFilter;
  references: BoardReferences;
  scanStartedIso: string;
}): BoardJsonDocument {
  // Measured BEFORE anything is cut, per `truncation.ts`'s own contract: a tally taken off the capped
  // strings would report zero dropped characters on every board and be worse than no tally at all.
  const summaryTruncation = truncationAtCap({
    cap: BOARD_SUMMARY_CHARS,
    lengths: models.flatMap((model) => (model.doc.summary === undefined ? [] : [model.doc.summary.length])),
  });
  // Over every model, before the tag filter: a quote on a row the filter hides still belongs on its pull request's card.
  const prSteers = prSteersByRow({ rows: boardPrSteerRows({ models, repoSlugs: references.repoSlugs }) });
  return {
    detachedAsks: detached.detachedAsks,
    handoverDir,
    observedAtIso,
    referenceContext: referenceContextOf(references),
    rows: models
      .map((model, index) => ({ model, steers: prSteers[index]! }))
      .filter(({ model }) => matchesTagFilter({ filter, tags: model.tags }))
      .map(({ model, steers }) =>
        boardJsonRow({ model, ownerNames: references.ownerNames, prSteers: steers, repoSlugs: references.repoSlugs }),
      ),
    rowsBeforeFilter: models.length,
    scanStartedIso,
    settledThenAsked: detached.settledThenAsked,
    summaryTruncation,
    tagFilter: filter.terms.map((term) => term.text),
    unreadJournals: detached.unreadJournals,
    unreadable,
    unresolved,
  };
}

/** What the journal sweep publishes beside the rows — `../../../handover/detachedAsk.ts`. */
export interface DetachedFindings {
  readonly detachedAsks: readonly DetachedAsk[];
  readonly unreadJournals: readonly UnreadJournal[];
  /**
   * `../../../handover/settledAsk.ts`'s finding over the board's rows AND the archived settled rows the sweep
   * recovered, which the rows leave out — computed by the caller that composed both.
   */
  readonly settledThenAsked: readonly SettledThenAsked[];
}

/** A board read by a caller that runs no journal sweep — every reader but `handover list` itself. */
export const NO_DETACHED_FINDINGS: DetachedFindings = { detachedAsks: [], settledThenAsked: [], unreadJournals: [] };

/**
 * The board as the exact text `--json` prints, stamped with when it was composed.
 *
 * The timestamp is taken here rather than passed in because this is the only moment that is true of the
 * WHOLE board: the scan, the journal read and the probe sweep each finished at a different instant, and a
 * consumer showing an age needs one number it can trust to be no older than the slowest of them.
 *
 * @param models every doc's composed placement, closed sections included
 * @param unresolved how many docs the probe sweep did not finish inside its deadline
 * @param references what a card resolves a reference named without its address against
 * @param scanStartedIso when the doc scan began, which the caller takes before scanning
 * @param filter the `--tag` filter narrowing the rows printed
 * @param detached what the journal sweep found waiting with no doc on the board
 * @returns the JSON text to print
 */
export function boardJsonText({
  detached,
  filter,
  models,
  handoverDir,
  unresolved,
  unreadable,
  references,
  scanStartedIso,
}: {
  detached: DetachedFindings;
  models: readonly BoardModel[];
  handoverDir: string;
  unresolved: number;
  unreadable: readonly string[];
  filter: TagFilter;
  references: BoardReferences;
  scanStartedIso: string;
}): string {
  return safeJsonStringify({
    label: "handover list --json",
    space: 2,
    value: boardJsonDocument({
      detached,
      filter,
      handoverDir,
      models,
      observedAtIso: new Date().toISOString(),
      references,
      scanStartedIso,
      unreadable,
      unresolved,
    }),
  });
}
