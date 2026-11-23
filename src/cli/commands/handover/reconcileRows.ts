/**
 * How `handover reconcile` builds the two lists it compares: every live board ROW, and everything the fleet
 * is actually WORKING. `./reconcileRun.ts` is the verb around this — flags, the emit, the exit code.
 *
 * ## A retired supervisor chair is not READY, and that is one cmux read rather than a board rule
 *
 * `ready` is what `../../../supervisor/outcomes/coverage.ts` filters `unspawned` on, so anything wrongly
 * called ready becomes work a fill offers to take. A `role: supervisor` doc seated before the chair currently
 * holding the pin is exactly that: nothing ever recorded its ending, so it sits in `RUN NOW` for ever. The
 * predicate itself lives in `../../../handover/supervisorSupersession.ts` — which carries the measurement and
 * the duplicate-chair incident — and is applied HERE rather than in `../../../handover/boardEvidence.ts`,
 * because it needs the LIVE cmux pin and that layer is pure over one doc's own status, probes and journal.
 *
 * ## Why this is its own module
 *
 * The supersession PREDICATE is pure and belongs in `src/handover/`; the READ around it is not — it opens the
 * session ledger and takes a workspace listing — so it cannot go there, and keeping it in the verb module
 * pushed that file past the `file-size-ratchet` cap. The seam that answered both is this one: everything that
 * decides what a row IS and whether anyone is on it, with the verb left holding only its own surface.
 */

import { shellCommandLine } from "#lib/shellCommandLine.js";

import type { CmuxWorkspaceSummary } from "../../../cmux/client.js";
import { settledAskOf } from "../../../handover/askRow.js";
import { isClosedBoardSection } from "../../../handover/boardRefusal.js";
import { type BoardModel } from "../../../handover/boardTypes.js";
import { type HandoverDoc } from "../../../handover/doc.js";
import { disconnectedLines } from "../../../handover/integrationNeeds.js";
import { boardQueueFacts } from "../../../handover/queueFacts.js";
import { type BoardRow, rankRows, rowOfDoc, rowOfTag } from "../../../handover/rank.js";
import { type WorkedItem } from "../../../handover/reconcile.js";
import { effectivePriority, priorityIndex } from "../../../handover/rowKind.js";
import { standingOf } from "../../../handover/rowStanding.js";
import { isSafeSlug } from "../../../handover/runStore.js";
import {
  firstSeatedInstants,
  pinnedSupervisorSlug,
  type SupervisorSupersession,
  supersededSupervisorDocs,
} from "../../../handover/supervisorSupersession.js";
import { trunkMovedLines } from "../../../handover/trunkMoved.js";
import { activeAsks } from "../../../live/ask/burst.js";
import { currentlyIgnoredConversations } from "../../../live/ask/ignoredConversationStore.js";
import { currentlyIgnoredAsks } from "../../../live/ask/ignoreStore.js";
import { askLifecycleKey, foldAskLifecycle, parseAskLifecycleLog } from "../../../live/ask/lifecycle.js";
import { readAskLifecycleText } from "../../../live/ask/store.js";
import { foldSessions, parseSessionLog, type SessionItem } from "../../../sessions/session.js";
import { readSessionLogText } from "../../../sessions/sessionStore.js";
import { type DisconnectedRead, readDisconnected } from "./disconnectedRead.js";
import { duplicateRecipeFailureSlugs } from "./recipeFailureSeats.js";
import { rankedSectionOf } from "./reconcileStanding.js";
import { seatRowOf } from "./seatBinding.js";
import { readTrunkMoved, type TrunkMovedRead } from "./trunkMovedRead.js";

/**
 * Which supervisor chairs the pinned one has already replaced.
 *
 * Read ONCE from the same workspace listing the fleet picture comes from, before the board is ranked, because
 * the answer decides a row's `ready`. When cmux could not be read this reports an empty set with a named
 * `unresolved` reason rather than inventing one — a failed read is not evidence, exactly as
 * `./reconcileRun.ts`'s own fleet-source fallback already argues. What that unknown MEANS for a row is
 * {@link supersededFor}'s decision, and it is not "nothing is superseded".
 *
 * @param docs every doc the board scan found
 * @param sessions the folded session ledger, {@link ledgerSessions}
 * @param workspaces the workspace listing, or `undefined` when cmux could not be read
 * @returns the superseded slugs, or an empty set naming why none could be judged
 */
function supersessionOf({
  docs,
  sessions,
  workspaces,
}: {
  docs: readonly HandoverDoc[];
  sessions: readonly SessionItem[];
  workspaces: readonly CmuxWorkspaceSummary[] | undefined;
}): SupervisorSupersession {
  if (workspaces === undefined) {
    return { superseded: new Set(), unresolved: "cmux could not be read, so the pinned chair is unknown" };
  }
  return supersededSupervisorDocs({
    docs: docs.map((doc) => ({ role: doc.role, slug: doc.slug })),
    pinnedSlug: pinnedSupervisorSlug({ workspaces }),
    seatedIso: firstSeatedInstants({ sessions }),
  });
}

/**
 * The session ledger under `home`, folded — read ONCE per reconcile and handed to every step that needs it: the
 * supervisor supersession hold, the recipe-failure filter and {@link workedFromCmux}'s seat binding.
 *
 * @param home the state home holding the session ledger
 * @returns one item per session row, most recently opened first
 */
export function ledgerSessions({ home }: { home: string }): readonly SessionItem[] {
  return foldSessions({ events: parseSessionLog({ text: readSessionLogText({ home }) }).events });
}

/**
 * Whether this doc must be treated as a chair a later one replaced.
 *
 * An UNRESOLVED read is not a no. When cmux could not be read, WHICH chairs are retired is unknown — and a
 * `role: supervisor` doc sits in `RUN NOW` for ever whether it is the current chair or a retired one, so
 * answering "not superseded" offers a possibly-dead chair as the most urgent startable row on the board.
 * Found by an adversarial review pass: a superseded chair reached both `top` and `starving` on a tick where
 * the cmux read failed. Every chair is held for that tick instead, which costs one row's availability and
 * cannot spawn a second chair (`../../../handover/supervisorSupersession.ts` carries that incident).
 *
 * @param doc the row's own doc, read for its `role`
 * @param supersession what {@link supersessionOf} decided
 * @returns true when the row may not be offered as startable
 */
function supersededFor({ doc, supersession }: { doc: HandoverDoc; supersession: SupervisorSupersession }): boolean {
  if (supersession.superseded.has(doc.slug)) {
    return true;
  }
  return supersession.unresolved !== undefined && doc.role === "supervisor";
}

/**
 * The one line that says what the supervisor-supersession read did, so neither of its two zeros is silent.
 *
 * @param supersession what {@link supersessionOf} decided
 * @returns the line to print, or `undefined` when there is nothing to say
 */
export function supersessionLine({ supersession }: { supersession: SupervisorSupersession }): string | undefined {
  if (supersession.unresolved !== undefined) {
    return `(EVERY supervisor chair doc is held rather than ready — ${supersession.unresolved}, so which of them a later chair retired cannot be judged.)`;
  }
  if (supersession.superseded.size === 0) {
    return undefined;
  }
  return `(${String(supersession.superseded.size)} retired supervisor chair doc(s) excluded from ready — a later chair holds the pin.)`;
}

/**
 * The live `RUN NOW` rows that name no `repo:` — held rather than ready, because `cmux spawn` cannot seat one.
 *
 * The same filters {@link rankedRows} applies before a row is built — a closed section and a settled ask are
 * not live — so this is exactly the set `standingOf`'s `repoless` arm demoted, sorted so two reads diff.
 *
 * @param models the composed board
 * @returns the slugs, sorted
 */
export function repolessRowIds({ models }: { models: readonly BoardModel[] }): readonly string[] {
  return models
    .filter((model) => isLiveRepoless({ model }))
    .map((model) => model.doc.slug)
    .toSorted();
}

/**
 * Whether ONE model is a live `RUN NOW` row naming no `repo:` — asked of the model itself, because two docs can
 * share a slug and a slug-keyed set would let a ruled sibling that names a repo borrow the repoless one's place.
 *
 * @param model one composed row
 * @returns true when it is in `RUN NOW`, names no repo and is not a settled ask
 */
function isLiveRepoless({ model }: { model: BoardModel }): boolean {
  return model.section === "RUN NOW" && model.doc.repo === undefined && settledAskOf({ doc: model.doc }) === undefined;
}

/**
 * The p0 and p1 rows among {@link repolessRowIds}, p0 first, then every OTHER one carrying the owner's ruling — the ones
 * a chair must not read as a count.
 *
 * MEASURED: the p1 finding `recipe-failing-resync-corpus-notion-<slot-instant>-a1` was
 * one of 1666 repoless rows, and the line naming that count named none of them, so a broken Notion sync sat
 * unseatable until the owner saw it on their sidebar the next day.
 *
 * A ruled row of any band joins them because a ruling is a decision the owner already made and nothing but a seat
 * applies it: `approve-proj-dependencies-channel-for-nightly-bump-posts` carried the owner's ruling, named no
 * `repo:`, and sat unseatable and unnamed for 19 days (`../../../handover/rank.ts`, `BoardRow.ruled`). Its band
 * stays the owner's: the ruled tail comes after every p0 and p1 row, band by band, and names a slug only once. The band
 * is the EFFECTIVE one `rank.ts` ranks in, so an ask declaring none is p1 here too.
 *
 * @param models the composed board
 * @returns the slugs, p0 before p1 before the other ruled rows, each band sorted by slug
 */
export function repolessUrgentRowIds({ models }: { models: readonly BoardModel[] }): readonly string[] {
  const named = models
    .filter((model) => isLiveRepoless({ model }))
    .map((model) => ({
      band: priorityIndex({ priority: effectivePriority({ declared: model.doc.priority, kind: model.doc.kind }) }),
      ruled: model.derived.ruling !== undefined,
      slug: model.doc.slug,
    }))
    .filter((row) => row.band <= priorityIndex({ priority: "p1" }) || row.ruled)
    .toSorted((a, b) => a.band - b.band || a.slug.localeCompare(b.slug))
    .map((row) => row.slug);
  return [...new Set(named)];
}

/**
 * The slugs more than one doc claims. `handover set-repo` and `cmux spawn` each refuse a slug unless exactly one
 * doc claims it, so a line printing either command for one of these prints a command that cannot run.
 *
 * @param docs every doc the board scan found
 * @returns the shared slugs, sorted
 */
export function sharedSlugs({ docs }: { docs: readonly HandoverDoc[] }): readonly string[] {
  const seen = new Set<string>();
  const shared = new Set<string>();
  for (const { slug } of docs) {
    if (seen.has(slug)) {
      shared.add(slug);
    }
    seen.add(slug);
  }
  return [...shared].toSorted();
}

/** How many urgent repoless rows the line names before counting the rest. */
const URGENT_REPOLESS_NAMED = 5;

/**
 * The one line that says how many rows the board lists as `RUN NOW` and no verb can seat, and the verb that
 * fixes one — so a fill reading the ready count is not left wondering where they went. The p0, p1 and ruled
 * rows among them are named FIRST, each with its own fix, because a count of 1666 hides the one that matters.
 *
 * @param repoless what {@link repolessRowIds} found
 * @param urgent what {@link repolessUrgentRowIds} found
 * @param shared what {@link sharedSlugs} found — never the slug the line's commands name
 * @param scopeFlags the `--dir` and `--home` reconcile was given, carried by every command the line prints so
 *   it acts on the board the line read
 * @returns the line to print, or `undefined` when there is nothing to say
 */
export function repolessLine({
  repoless,
  urgent,
  shared,
  scopeFlags,
}: {
  repoless: readonly string[];
  urgent: readonly string[];
  shared: readonly string[];
  scopeFlags: readonly string[];
}): string | undefined {
  if (repoless.length === 0) {
    return undefined;
  }
  const scope = scopeFlags.length === 0 ? "" : ` ${shellCommandLine({ command: scopeFlags })}`;
  const named = urgent.slice(0, URGENT_REPOLESS_NAMED).join(", ");
  const more =
    urgent.length > URGENT_REPOLESS_NAMED ? ` and ${String(urgent.length - URGENT_REPOLESS_NAMED)} more` : "";
  // The fix names the row and the model (a bare `then cmux spawn it` names neither); a slug two docs claim is one both
  // verbs refuse, so is one the run journal refuses, and the slug is quoted as one argument.
  const target = urgent.find((slug) => !shared.includes(slug) && isSafeSlug({ slug }));
  const ambiguous = urgent.filter((slug) => shared.includes(slug)).length;
  const fix =
    target === undefined
      ? "each shares its slug with another doc or carries one cmux spawn refuses, so no command can name one"
      : `${shellCommandLine({ command: ["slopweaver", "handover", "set-repo", target] })} --repo <path>${scope}, then ` +
        `${shellCommandLine({ command: ["slopweaver", "cmux", "spawn", target, "--model", "opus"] })}${scope}`;
  const sharedNote =
    target !== undefined && ambiguous > 0 ? `; ${String(ambiguous)} share a slug with another doc` : "";
  const lead =
    urgent.length === 0
      ? ""
      : `${String(urgent.length)} p0/p1 or ruled row(s) cannot be seated: ${named}${more} — ${fix}${sharedNote}. `;
  return (
    `(${lead}${String(repoless.length)} RUN NOW row(s) name no \`repo:\`, so \`cmux spawn\` cannot seat them — held ` +
    `rather than ready. Give one a checkout with: slopweaver handover set-repo <slug> --repo <path>${scope})`
  );
}

/** The reasons a `RUN NOW` row is held rather than ready that no board section records. */
export interface BoardHolds {
  /** Which supervisor chairs a later one already retired. */
  readonly supersession: SupervisorSupersession;
  /** Which live `RUN NOW` rows name no `repo:` — {@link repolessRowIds}. */
  readonly repoless: readonly string[];
  /** The p0, p1 and ruled rows among them — {@link repolessUrgentRowIds}. */
  readonly repolessUrgent: readonly string[];
  /** Which slugs more than one doc claims — {@link sharedSlugs}. */
  readonly sharedSlugs: readonly string[];
  /** Which ready findings the trunk has moved under since they were asked — `./trunkMovedRead.ts`. */
  readonly trunkMoved: TrunkMovedRead;
  /** Which rows ranking in `RUN NOW` need an integration this install is not connected to — `./disconnectedRead.ts`. */
  readonly disconnected: DisconnectedRead;
  /** Which recipe failure finding slugs two live docs claim — `./recipeFailureSeats.ts`. */
  readonly duplicateRecipeFailures: readonly string[];
}

/**
 * Every hold, read once before the board is ranked — each decides a row's `ready`, so it has to.
 *
 * @param docs every doc the board scan found
 * @param home the state home holding the secrets store
 * @param sessions the folded session ledger, {@link ledgerSessions}
 * @param workspaces the workspace listing, or `undefined` when cmux could not be read
 * @param models the composed board
 * @param nowIso the instant the board is ranked at, which decides which parked seats rank as `RUN NOW`
 * @returns what the board held, and why
 */
export function boardHolds({
  docs,
  home,
  sessions,
  workspaces,
  models,
  nowIso,
}: {
  docs: readonly HandoverDoc[];
  home: string;
  sessions: readonly SessionItem[];
  workspaces: readonly CmuxWorkspaceSummary[] | undefined;
  models: readonly BoardModel[];
  nowIso: string;
}): BoardHolds {
  return {
    disconnected: readDisconnected({ home, models, nowIso }),
    duplicateRecipeFailures: duplicateRecipeFailureSlugs({ docs }),
    repoless: repolessRowIds({ models }),
    repolessUrgent: repolessUrgentRowIds({ models }),
    sharedSlugs: sharedSlugs({ docs }),
    supersession: supersessionOf({ docs, sessions, workspaces }),
    trunkMoved: readTrunkMoved({ models }),
  };
}

/**
 * The lines that say what each hold did, so none is a silent drop in the ready count.
 *
 * @param holds what the reconciliation held
 * @param scopeFlags the `--dir` and `--home` reconcile was given, for each command a line prints
 * @param maxTrunkRows how many trunk-moved held rows to name before counting the rest; `undefined` names all
 * @returns zero or more lines to print
 */
export function heldLines({
  holds,
  scopeFlags,
  maxTrunkRows,
}: {
  holds: BoardHolds;
  scopeFlags: readonly string[];
  maxTrunkRows: number | undefined;
}): readonly string[] {
  return [
    supersessionLine({ supersession: holds.supersession }),
    repolessLine({
      repoless: holds.repoless,
      scopeFlags,
      shared: holds.sharedSlugs,
      urgent: holds.repolessUrgent,
    }),
    ...trunkMovedLines({
      held: holds.trunkMoved.held,
      maxRows: maxTrunkRows,
      pullsUnchecked: holds.trunkMoved.pullsUnchecked,
      unread: holds.trunkMoved.unread,
    }),
    ...disconnectedLines({ held: holds.disconnected.held, unread: holds.disconnected.unread }),
  ].filter((line): line is string => line !== undefined);
}

/**
 * The Slack tags still waiting, projected from the ask-lifecycle stream.
 *
 * A read failure yields no rows rather than throwing: a machine with no listener has never written the file,
 * and a board that refuses to rank because nobody has ever tagged the bot would be useless on a fresh
 * install. The corresponding risk — a real read error reading as "no tags" — is why the ONLY thing consulted
 * here is the same stream every other tag surface reads, rather than a second store this verb maintains.
 *
 * @param home the state home holding the ask-lifecycle stream and both ignore lists
 * @param nowIso the instant a tag's age is measured against
 * @returns one row per tag still waiting
 */
function tagRows({ home, nowIso }: { home: string; nowIso: string }): readonly BoardRow[] {
  const parsed = parseAskLifecycleLog({ text: readAskLifecycleText({ home }) });
  const folded = foldAskLifecycle({ events: parsed.events });
  const active = activeAsks({
    events: parsed.events,
    ignored: currentlyIgnoredAsks({ home }),
    ignoredConversations: currentlyIgnoredConversations({ home }),
    nowIso,
  });
  return active.map((ask) => {
    const key = askLifecycleKey({ askIdentity: ask });
    return rowOfTag({
      nowIso,
      tag: { capturedIso: folded.get(key)?.capturedIso, id: key, state: ask.state, userId: ask.userId },
    });
  });
}

/**
 * Every live board row, ranked — tags and asks projected in beside the docs.
 *
 * @param models the composed board
 * @param home the state home the projected tag rows are read from
 * @param nowIso the instant every row's age is measured against
 * @param supersession which supervisor chairs a later one already retired
 * @param trunkMoved the doc PATHS of ready findings the trunk has moved under since they were asked — a path, since
 * two docs may share a slug and only the one whose evidence moved is held
 * @param disconnected the doc PATHS of `RUN NOW` rows needing an integration this install is not connected to
 *   (`../../../handover/integrationNeeds.ts`)
 * @param priorities the owner's priorities' `workstream=` values, the first priority first, which lead the ranking as they
 *   lead the owner's Queue (`../../../handover/queueFacts.ts`); none ranks by the board's own order alone
 * @param deferred when each ask the owner put off on the Queue was put off, by slug: never their priority there or here, and
 *   last in both unless it blocks one
 * @returns the ranked board
 */
export function rankedRows({
  deferred,
  disconnected,
  models,
  home,
  nowIso,
  priorities,
  supersession,
  trunkMoved,
}: {
  deferred: ReadonlyMap<string, string>;
  disconnected: ReadonlySet<string>;
  models: readonly BoardModel[];
  home: string;
  nowIso: string;
  priorities: readonly string[];
  supersession: SupervisorSupersession;
  trunkMoved: ReadonlySet<string>;
}): readonly BoardRow[] {
  return rankRows({
    deferred,
    facts: boardQueueFacts({ deferred: new Set(deferred.keys()), models, priorities }),
    rows: [...tagRows({ home, nowIso }), ...liveDocRows({ disconnected, models, nowIso, supersession, trunkMoved })],
  });
}

/**
 * Whether a composed board doc is live work at all: its section is open, and it is not a SETTLED ask.
 *
 * A settled ask is not work, whatever its run journal says. Its section can be `CONTRADICTION` — a settlement
 * beside a cycle that was abandoned or never ended — and ranking it makes the fill scan offer work that is
 * already done. `../../../handover/askRow.ts`'s `settledAskOf` is the same read `cmux spawn` refuses on, so the
 * two doors cannot disagree about which rows are live.
 *
 * RESIDUE, named by an adversarial review pass: a DUPLICATE slug is still read differently by the two. `cmux
 * spawn` refuses any slug more than one doc claims, before it reaches the settlement check, while this ranks
 * each model independently — so a duplicate pairing one settled ask with one open doc ranks here and is
 * refused there. That is the board's existing duplicate-slug defect (`docClaimOf` in
 * `../../../handover/hookShell.ts` carries the same shape) rather than anything the settlement read decides,
 * and it wants one resolution shared by every door instead of a second copy in this filter. The same holds
 * ACROSS kinds: a projected Slack-tag row carries its own id, `settledAskOf` answers only for an ask DOC, and
 * nothing here dedupes an id a tag and a doc both carry.
 *
 * @returns true when the doc is open and not a settled ask
 */
function isLiveDoc({ model }: { model: BoardModel }): boolean {
  return !isClosedBoardSection({ section: model.section }) && settledAskOf({ doc: model.doc }) === undefined;
}

/**
 * Every live, unsettled board doc as a row, its standing read off its composed section.
 *
 * @param models the composed board
 * @param nowIso the instant every row's age is measured against
 * @param supersession which supervisor chairs a later one already retired
 * @param trunkMoved the doc PATHS of ready findings the trunk has moved under since they were asked
 * @param disconnected the doc PATHS of `RUN NOW` rows needing an integration this install is not connected to
 * @returns the doc rows, unranked
 */
function liveDocRows({
  disconnected,
  models,
  nowIso,
  supersession,
  trunkMoved,
}: {
  disconnected: ReadonlySet<string>;
  models: readonly BoardModel[];
  nowIso: string;
  supersession: SupervisorSupersession;
  trunkMoved: ReadonlySet<string>;
}): readonly BoardRow[] {
  return (
    models
      .filter((model) => isLiveDoc({ model }))
      // The row's STANDING is the board's own composed section, mapped by
      // `../../../handover/rowStanding.ts` — `ready` is `RUN NOW` and nothing else, the rows `slopweaver cmux
      // spawn` would accept, and every other live section says which OTHER thing the row is: in flight, parked
      // on the owner, paused on a person, or blocked. Counting any of those as unattended work would make
      // `../../../supervisor/outcomes/coverage.ts` wrong on every tick, and counting them as the TOP OF THE
      // BOARD is a known artefact (`../../../handover/reconcile.ts`'s header).
      //
      // A supervisor chair a LATER chair has already replaced is the one row whose standing is not its section:
      // its doc still sits in `RUN NOW` because nothing ever recorded its ending, and a fill reading it as
      // available work SPAWNED A SECOND CHAIR (`../../../handover/supervisorSupersession.ts` carries the
      // incident and the measurement), so it is blocked. So is a `RUN NOW` row naming no `repo:`, which `cmux
      // spawn` refuses outright: {@link repolessRowIds} names that set, and `standingOf` carries the measurement.
      // So is a ready finding whose evidence the trunk has moved since it was asked, until a session settles or
      // rechecks it — `../../../handover/trunkMoved.ts` carries the six rows seated in one hour.
      // So is a row declaring it needs an integration this install stores no credential for, kept on the board
      // until it is connected — `../../../handover/integrationNeeds.ts` carries the owner's ruling.
      // The one row LIFTED to ready is `./reconcileStanding.ts`'s `rankedSectionOf`'s.
      .map((model) =>
        rowOfDoc({
          doc: model.doc,
          nowIso,
          // What the row DISPLAYS the owner decided, a backfilled reconstruction included: ranking is attention, never
          // the permission `findingRuling` guards, so a true record of a decision must not stay buried.
          ruled: model.derived.ruling !== undefined,
          standing: standingOf({
            disconnected: disconnected.has(model.doc.path),
            repoless: model.doc.repo === undefined,
            superseded: supersededFor({ doc: model.doc, supersession }),
            ...rankedSectionOf({ model, nowIso, trunkMoved: trunkMoved.has(model.doc.path) }),
          }),
        }),
      )
  );
}

/**
 * Every live cmux workspace, as one worked item each, mapped to a board row by `./seatBinding.ts`'s `seatRowOf`: the
 * session ledger's recorded binding to the workspace id first, the worktree it stands in only where nothing is
 * bound — so a seat spawned into a reused, branch-named worktree is still its row's.
 *
 * @param rows the ranked board, used to decide whether a binding or a directory names a row at all
 * @param sessions the folded session ledger, most recently opened first
 * @param workspaces the workspace listing, or `undefined` when cmux could not be read
 * @returns one item per workspace, or `undefined` when cmux could not be read
 */
export function workedFromCmux({
  rows,
  sessions,
  workspaces,
}: {
  rows: readonly BoardRow[];
  sessions: readonly SessionItem[];
  workspaces: readonly CmuxWorkspaceSummary[] | undefined;
}): readonly WorkedItem[] | undefined {
  if (workspaces === undefined) {
    return undefined;
  }
  const ids = new Set(rows.map((row) => row.id));
  return workspaces.map((workspace) => ({
    rowId: seatRowOf({ rowIds: ids, sessions, workspace }),
    session: workspace.workspaceRef,
  }));
}

/**
 * The fallback picture: every doc the board itself believes has an open run.
 *
 * @param models the composed board
 * @returns one worked item per doc with an open run
 */
export function workedFromOpenRuns({ models }: { models: readonly BoardModel[] }): readonly WorkedItem[] {
  return models
    .filter((model) => model.run.kind === "active" || model.run.kind === "waiting-on-owner")
    .map((model) => ({ rowId: model.doc.slug, session: `run:${model.doc.slug}` }));
}
