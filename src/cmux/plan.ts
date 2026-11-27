/**
 * Deciding WHERE and WHAT to spawn, without doing any of it.
 *
 * Pure: every input a caller could only get by reading something (the doc's fields, its run journal, the
 * repository's current worktrees) is passed in already-read, so this can be tested against literal fixtures
 * with no filesystem, no git and no cmux involved. The one thing this module does NOT decide is whether to
 * reuse or create the worktree at `cwd` — that is exactly the git-visible fact {@link worktreeExists} states
 * (decided by `./spawnTree.ts` from the already-read worktree list), and the effectful caller in
 * `spawn.ts` acts on it.
 */

import { branchCandidates } from "../handover/evaluate.js";
import type { RunEvent } from "../handover/ledger.js";
import { latestParkedCheckpoint } from "../handover/parked.js";
import type { SessionPlanChoice } from "../sessions/planChoice.js";
import type { VisibleSessionHost } from "../supervisor/session.js";
import { worktreePath } from "../worktree/location.js";
import type { LaunchTemplate } from "./launchTemplate.js";
import { newTreeBranch } from "./newTreeBranch.js";
import { type CmuxDriver, resolveSpawnPickupCommand, type SpawnPickupLocation } from "./pickupCommand.js";
import {
  deriveWorkspaceTitle,
  dispatchSessionName,
  dispatchWorkspaceName,
  SESSION_NAME_MAX_LENGTH,
  safeNameSegment,
  WORKSPACE_TITLE_MAX_LENGTH,
} from "./planNames.js";
import type { SessionRole } from "./role.js";
import { existingSpawnTree } from "./spawnTree.js";
import { reusedTreeBranch, type WorktreeInfo } from "./worktreeList.js";

/**
 * Everything decided about one visible-session spawn, before anything on disk or in cmux has been touched —
 * the reusable shape every tier-3 launch shares, whether it is opening a handover's own worktree or a fresh
 * session for one Slack ask.
 */
export interface VisibleSessionPlan {
  /**
   * Which model-backed driver boots this workspace, in the live-turn vocabulary — decides `spawn.ts`'s boot
   * line. Always derived from {@link driver}, never an independent choice: the two fields name the same real
   * decision in two vocabularies that predate each other's features (`host` for ask-driven dispatch, `driver`
   * for `spawn.ts`'s boot line), and a caller constructing a plan must keep both in agreement — see
   * `planSpawn`, `planAskSession` and their siblings below, the only constructors.
   */
  readonly host: VisibleSessionHost;
  /** The doc's or checkout's declared `repo:` — the main checkout a new worktree would be created FROM. */
  readonly repoRoot: string;
  /** The branch the worktree at {@link cwd} holds, or will hold once created. */
  readonly branch: string;
  /**
   * The branch a brand-new {@link branch} should fork from, or `undefined` to let `createWorktree` resolve
   * trunk as before. Meaningless once {@link worktreeExists} is true — nothing is being forked from anything.
   */
  readonly baseBranch: string | undefined;
  /** The directory cmux should open the new workspace in — an existing worktree, or one still to create. */
  readonly cwd: string;
  /**
   * Whether {@link cwd} already exists as a registered worktree — found by {@link branch} anywhere, or by
   * being the worktree already AT the conventional path, whatever branch that one holds. False means it
   * must be created.
   */
  readonly worktreeExists: boolean;
  /** The raw dispatch id cmux addresses this workspace by — unchanged by {@link workspaceTitle}'s display concerns. */
  readonly workspaceName: string;
  /**
   * A short, human-readable title for the workspace — derived from the ask's question for
   * `planAskSession`, or the handover slug for `planSpawn`. What the cmux `--name` flag should actually
   * carry, with {@link workspaceName}'s raw id kept out of it and surfaced via the workspace description
   * instead — see `deriveWorkspaceTitle` and `bootCmuxWorkspace`.
   */
  readonly workspaceTitle: string;
  /**
   * The display name the HARNESS should register this session under — `claude --name`'s value, and what
   * `ListAgents` shows a peer session as. `undefined` leaves the harness deriving it from the working
   * directory, which is correct only when that directory is already unique to this session.
   *
   * It is not for a spawn that opens its own worktree (`planSpawn`, both recipe planners): the directory
   * basename is already one-per-slug there, and naming it twice would only be a second place to drift. It IS
   * for {@link planAskSession} and {@link planReviewSession}, which deliberately reuse the CURRENT checkout —
   * measured: six live sessions (one listener, two workers, three answer reviewers) all answered
   * to the SAME name — the checkout's directory, plus a two-character suffix nothing derives from the ask —
   * so a message addressed by bare name could land on a reviewer mid-verdict. See
   * {@link dispatchSessionName} for the shape and why it is bounded and sanitised.
   */
  readonly sessionName: string | undefined;
  /** When this workspace was spawned, ISO 8601 — an already-captured wall-clock, never computed here. */
  readonly spawnedAt: string;
  /**
   * Who this workspace is responding to, resolved to a display handle (`@name`, or the raw Slack id when
   * unresolvable) via the identity roster — `undefined` when there is no single addressed user, as for a
   * handover's own spawn.
   */
  readonly respondingToHandle: string | undefined;
  /** The exact line to send once the session has booted. */
  readonly pickupCommand: string;
  /**
   * The `--dir` and `--home` the spawn was EXPLICITLY given, absolute — the location {@link pickupCommand} carries
   * onto the lifecycle verb, and the one the delivery re-read carries too, so the line previewed is the line sent.
   * Absent when it was given neither, and on every spawn that is not a handover's own.
   */
  readonly pickupLocation?: SpawnPickupLocation;
  /** Which real, interactive CLI to boot, in `pickupCommand.ts`'s vocabulary — see {@link host}. */
  readonly driver: CmuxDriver;
  /**
   * The credential store this session boots against, when its seat is PINNED to one account.
   *
   * Undefined for an ordinary worker, which follows the rotating active slot, so a worker's boot line stays
   * byte-identical to the one this repo sent before pinning existed. The CALLER decides the seat, because
   * only it reads configuration and knows the role. Set for the publishing seat
   * and the supervisor chair, because artifacts are per-account: measured: rotating the fleet
   * made every page published under the previous account unreadable, and the owner's react-now surface
   * lives in exactly one account's gallery. See `src/claude/seatPinning.ts` for the whole reasoning.
   */
  readonly credentialStoreDir?: string;

  /**
   * The setup token file this session opens on a file descriptor, when the plan routing chose has one.
   *
   * Set only by the pre-spawn gate, and always beside a {@link credentialStoreDir} naming the seat's own UNBOUND
   * store rather than the plan's — `src/claude/seatToken.ts` carries why the two travel together.
   */
  readonly credentialTokenPath?: string;

  /**
   * The `$CODEX_HOME` a `codex`-host session boots against, when routing picked one for it.
   *
   * The Codex half of {@link credentialStoreDir}, and undefined for the same reason: a seat with no routed
   * destination follows the ambient home and its boot line stays byte-identical to the one this repo sent
   * before routing existed. Meaningless on a `claude-code` host, which addresses its account by credential
   * store instead — `cmux/seatRoute.ts` carries which destination a seat gets and why.
   */
  readonly codexHome?: string;

  /**
   * The model tier or id to boot the session onto, passed verbatim to `claude --model` — undefined leaves the
   * boot line as today's bare `claude --plugin-dir <dir>`, which inherits the launching user's saved default.
   * Only ever set at spawn time (see `spawn.ts`'s `sendBootLine`): the owner's own ruling is that a live
   * session must never receive a mid-run `/model` switch, so this is the one lever the supervisor gets.
   */
  readonly model: string | undefined;

  /**
   * How hard this session should think, passed verbatim to `claude --effort` — absent leaves the boot line
   * without the flag at all, inheriting Claude Code's own default, which is what every session in this tree
   * got before the flag existed.
   *
   * A Claude-only lever, the same way {@link sessionName} is: `codex`'s boot line has no equivalent, so
   * `cmux spawn` REFUSES `--effort` on that driver rather than accepting a level it would silently drop.
   * Optional rather than `string | undefined`, so under `exactOptionalPropertyTypes` "this plan pins no
   * effort" is one state rather than two.
   */
  readonly effort?: string;

  /**
   * The launch template this seat boots from — what its Claude Code session loads at launch
   * (`./launchTemplate.ts`). Required, so a new launcher cannot silently boot one-size: every constructor names
   * it. `code` loads every standing rule and leaves the boot line byte-identical to the one this repo sent
   * before templates existed. Ignored on a `codex` host, which expands no import.
   */
  readonly template: LaunchTemplate;

  /**
   * What KIND of session this is, which decides the row's colour — see `./role.ts`.
   *
   * Set here rather than derived at spawn time because the planner is the only place that knows: an ask
   * worker and a handover run open the same way and differ only in who asked for them. `undefined` means
   * nothing knew, and the classifier falls back to the repository the plan names, which is right for most
   * rows and deliberately allowed to be wrong for a couple — a doc can say `role:` when it is.
   */
  readonly role?: SessionRole | undefined;

  /**
   * Which plan the session starts on and every reading that choice used (`../sessions/planChoice.ts`). A Codex
   * seat's is set where its seat route is decided; a Claude seat's by the pre-spawn credential gate, on the plan it
   * returns. Absent when nothing decided one — the spawn then records none.
   */
  readonly planChoice?: SessionPlanChoice;
}

/**
 * A {@link VisibleSessionPlan} for a HANDOVER'S own spawn specifically — the shape `planSpawn` has always
 * produced, kept as its own type only because `slug`-keyed callers (`cli/commands/cmux/run.ts`) still read
 * `plan.slug` directly. Every field {@link VisibleSessionPlan} declares means the same thing here.
 */
export interface SpawnPlan extends VisibleSessionPlan {
  /** The handover slug this spawn is for. */
  readonly slug: string;
}

/**
 * The conventional worktree path for a handover slug: `<repo>/.claude/worktrees.noindex/<slug>`, inside
 * the main checkout itself (`worktree/location.ts` says why the directory is named that). Only ever created
 * as a fallback — `./spawnTree.ts`'s `findExistingWorktree` is checked first, because the convention is not where every
 * worktree in this repository actually lives.
 *
 * @param repoRoot the main checkout's absolute path
 * @param slug the handover slug
 * @returns the conventional worktree path
 */
export function conventionalWorktreePath({ repoRoot, slug }: { repoRoot: string; slug: string }): string {
  return worktreePath({ name: slug, repoRoot });
}

/**
 * Where a spawn's worktree is, and whether it already exists.
 *
 * Split out of {@link planSpawn} so the plan builder stays a shape rather than a shape plus a search — the
 * three answers here are one question ("which checkout does this slug open?") and they were the only
 * derived values in an otherwise declarative return.
 *
 * @param declaredBranch the branch the doc names, when it names one
 * @param repoRoot the repository this spawn belongs to
 * @param runEvents the run journal, whose parked checkpoint — facts the journal recorded — outranks every guess,
 *   so the reseat reopens the tree the seat left
 * @param slug the handover slug, which is also the conventional branch and directory name
 * @param worktrees every worktree currently on disk
 * @returns the branch to use, the directory to open, and whether that directory already exists
 */
function spawnWorktree({
  declaredBranch,
  repoRoot,
  runEvents,
  slug,
  worktrees,
}: {
  declaredBranch: string | undefined;
  repoRoot: string;
  runEvents: readonly RunEvent[];
  slug: string;
  worktrees: readonly WorktreeInfo[];
}): { readonly branch: string; readonly cwd: string; readonly worktreeExists: boolean } {
  const candidates = branchCandidates({ declaredBranch, recordedBranch: undefined, slug });
  const conventionalPath = conventionalWorktreePath({ repoRoot, slug });
  const parked = latestParkedCheckpoint({ events: runEvents });
  const existing = existingSpawnTree({ candidates, conventionalPath, parked, repoRoot, worktrees });
  return {
    branch: reusedTreeBranch({
      candidates,
      existing,
      whenAbsent: newTreeBranch({ declaredBranch, parked, slug, worktrees }),
    }),
    // No tree to reuse is the case `conventionalWorktreePath` exists for: the spawn creates one there.
    cwd: existing === undefined ? conventionalPath : existing.path,
    worktreeExists: existing !== undefined,
  };
}

/**
 * The plan fields a handover spawn derives from its DOC, and the two it deliberately leaves unset.
 *
 * Grouped rather than inlined because every one of them answers the same question — what does this doc say
 * this session is — while the fields around them come from the worktree and from the routed seat. The two
 * `undefined`s carry their reasons here for the same reason: an absence with no note beside it reads as an
 * oversight to the next person holding the shape in their head.
 *
 * @param docRole the role the caller already classified out of the doc
 * @param runEvents the run journal, which decides whether the pickup starts or resumes
 * @returns the doc-derived half of a {@link SpawnPlan}
 */
function docDerivedPlanFields({
  docPath,
  docRole,
  pickupLocation,
  runEvents,
  slug,
}: {
  docPath: string;
  docRole: SessionRole | undefined;
  pickupLocation: SpawnPickupLocation;
  runEvents: readonly RunEvent[];
  slug: string;
}): Pick<SpawnPlan, "pickupCommand" | "pickupLocation" | "respondingToHandle" | "role" | "sessionName"> {
  const located = pickupLocation.dir !== undefined || pickupLocation.home !== undefined;
  return {
    pickupCommand: resolveSpawnPickupCommand({ docPath, location: pickupLocation, runEvents, slug }),
    ...(located ? { pickupLocation } : {}),
    // No single addressed user for a handover's own spawn — it is purely slug-driven.
    respondingToHandle: undefined,
    // A handover's own spawn is classified from its doc: an explicit `role:` when it declares one, else the
    // repository it names. Neither is knowable here, so the caller passes the already-decided role through.
    role: docRole,
    // The harness's own cwd-derived name is already one-per-slug here: a handover spawn opens the worktree
    // AT `.claude/worktrees/<slug>`. Naming it again would be a second source for the same fact.
    sessionName: undefined,
  };
}

/**
 * Decide the worktree, workspace name and pickup command for one spawn.
 *
 * @param slug the handover slug being spawned
 * @param repoRoot the doc's declared `repo:`, i.e. the main checkout
 * @param declaredBranch the doc's own `branch:` field, when it named one
 * @param baseBranch the doc's own `baseBranch:` field, when it named one
 * @param docPath the doc's absolute path, named explicitly in the lifecycle pickup instruction — the doc's
 *   TEXT is never an input, because `pickupCommand.ts` composes the line from the path, the slug and the run
 *   phase alone
 * @param runEvents the doc's already-read run journal, for choosing start versus resume
 * @param worktrees the repository's current worktrees, already read
 * @param spawnedAt the already-captured wall-clock time of this spawn, ISO 8601
 * @param codexHome the routed `$CODEX_HOME` a `codex`-driver spawn boots against, or undefined to follow
 *   the ambient one — resolved by the caller, the only half that reads the register
 * @param driver which real CLI this spawn should boot, defaulting to `claude`
 * @param model the model tier or id to boot the session onto, or undefined for today's saved default
 * @param effort how hard the session should think, or absent for Claude Code's own default
 * @param docRole the role this spawn's row wears, already classified from the doc by the caller
 * @param template the launch template this seat boots from, already resolved by the caller
 * @param pickupLocation the `--dir` and `--home` the spawn was explicitly given, absolute; empty when neither
 * @returns the complete plan
 */
export function planSpawn({
  slug,
  repoRoot,
  declaredBranch,
  baseBranch,
  codexHome,
  docPath,
  docRole,
  runEvents,
  worktrees,
  spawnedAt,
  credentialStoreDir,
  driver = "claude",
  effort,
  model,
  template,
  pickupLocation = {},
}: {
  pickupLocation?: SpawnPickupLocation;
  codexHome?: string | undefined;
  credentialStoreDir?: string | undefined;
  effort?: string;
  slug: string;
  repoRoot: string;
  declaredBranch: string | undefined;
  baseBranch: string | undefined;
  docPath: string;
  docRole?: SessionRole | undefined;
  runEvents: readonly RunEvent[];
  worktrees: readonly WorktreeInfo[];
  spawnedAt: string;
  driver?: CmuxDriver;
  model?: string | undefined;
  template: LaunchTemplate;
}): SpawnPlan {
  const { branch, cwd, worktreeExists } = spawnWorktree({ declaredBranch, repoRoot, runEvents, slug, worktrees });
  return {
    baseBranch,
    branch,
    ...(codexHome === undefined ? {} : { codexHome }),
    ...(credentialStoreDir === undefined ? {} : { credentialStoreDir }),
    cwd,
    driver,
    // Spread rather than assigned, so a plan that pins no effort carries no key.
    ...(effort === undefined ? {} : { effort }),
    // Derived from `driver`, never a second independent choice — see the field's own doc comment.
    host: driver === "codex" ? "codex" : "claude-code",
    model,
    repoRoot,
    ...docDerivedPlanFields({ docPath, docRole, pickupLocation, runEvents, slug }),
    slug,
    spawnedAt,
    template,
    workspaceName: slug,
    workspaceTitle: slug,
    worktreeExists,
  };
}

/**
 * A {@link VisibleSessionPlan} for one Slack ask's `fresh-visible-session` dispatch.
 *
 * Deliberately reuses the CURRENT checkout rather than creating a new worktree per ask: a `fresh-visible-
 * session` tier is investigation depth for one live question, not a code-authoring task with its own
 * branch, so there is no per-ask git state to isolate. `worktreeExists: true` accordingly — the current
 * checkout always exists, and `spawnCmuxSession` never calls `ensureWorktree` for this plan.
 *
 * @param askChannel the ask's channel, for the workspace's addressing id only
 * @param askMessageTs the ask's addressing message ts, for the workspace's addressing id only
 * @param askQuestion the ask's raw question text, for deriving the workspace's human-readable title
 * @param branch the current checkout's own branch, for the plan's own record
 * @param effort how hard the worker should think — `modelPin.ts`'s `opusSpawnEffort` decides it — or absent
 *   for Claude Code's own default
 * @param host which model CLI boots this workspace
 * @param model the model tier or id to pin the worker to at boot — always named by the caller
 *   (`live/turn/workerModel.ts` decides it), never left to the launching user's drifting saved default
 * @param pickupCommand the exact line to send once the session has booted — the caller's own instructions,
 *   never guessed here
 * @param repoRoot the current checkout's absolute path — both `repoRoot` and `cwd`, since nothing is created
 * @param respondingToHandle the asking Slack user, already resolved to a display handle by the caller —
 *   `planAskSession` stays pure, so it never reads the identity roster itself
 * @param spawnedAt the already-captured wall-clock time of this spawn, ISO 8601
 * @returns the plan
 */
export function planAskSession({
  askChannel,
  askMessageTs,
  askQuestion,
  branch,
  effort,
  host,
  model,
  pickupCommand,
  repoRoot,
  respondingToHandle,
  spawnedAt,
}: {
  askChannel: string;
  askMessageTs: string;
  askQuestion: string;
  branch: string;
  effort?: string;
  host: VisibleSessionHost;
  model: string;
  pickupCommand: string;
  repoRoot: string;
  respondingToHandle: string | undefined;
  spawnedAt: string;
}): VisibleSessionPlan {
  return {
    // Never forking anything — `worktreeExists: true` below means `createWorktree` is never called for this plan.
    baseBranch: undefined,
    branch,
    cwd: repoRoot,
    // Derived from `host`, never a second independent choice — see the field's own doc comment.
    driver: host === "codex" ? "codex" : "claude",
    ...(effort === undefined ? {} : { effort }),
    host,
    model,
    pickupCommand,
    repoRoot,
    respondingToHandle,
    sessionName: dispatchSessionName({ askChannel, askMessageTs, role: "ask" }),
    spawnedAt,
    // A Slack turn answers in-thread; it opens the code rules on demand if it turns out to write code.
    template: "bot",
    workspaceName: dispatchWorkspaceName({ askChannel, askMessageTs, role: "ask" }),
    workspaceTitle: deriveWorkspaceTitle({ askQuestion }),
    worktreeExists: true,
  };
}

/**
 * A {@link VisibleSessionPlan} for an unprompted PLAN-DRAWDOWN INVESTIGATION — the session the watch opens
 * when a plan is being drawn down far faster than its own baseline (`claude/drawdownTick.ts`).
 *
 * The same shape as {@link planAskSession}: the current checkout, no worktree, nothing forked. An
 * investigation reads gauges, transcripts and a journal, so it needs no branch of its own, and giving it one
 * would leave an empty worktree behind every time the fleet had a busy hour.
 *
 * It is deliberately VISIBLE, which is rule 2's requirement and the whole point of the feature: the owner
 * asked for a session they can watch looking into a spike, so that they do not have to notice the spike
 * themselves and ask afterwards what happened.
 *
 * @param incidentId the episode's stable id — the workspace's addressing id, so a second spawn for the same
 *   episode would collide visibly rather than quietly opening a duplicate
 * @param branch the current checkout's own branch, for the plan's own record
 * @param effort how hard the investigation should think, or absent for Claude Code's own default
 * @param model the model tier to pin the investigation to
 * @param pickupCommand the exact line to send once the session has booted
 * @param repoRoot the current checkout's absolute path — both `repoRoot` and `cwd`, since nothing is created
 * @param spawnedAt the already-captured wall-clock time of this spawn, ISO 8601
 * @param subject what is drawing down, for the workspace title — `Claude plan` unless a caller says
 *   otherwise. Parameterised when the Codex burn watch landed, because a Codex account burning through its
 *   rate-limit window opening a workspace titled "Plan drawdown anomaly" names the wrong system entirely,
 *   and the title is the one line the owner reads in the sidebar before deciding whether to look
 * @returns the plan
 */
export function planDrawdownInvestigation({
  incidentId,
  branch,
  effort,
  model,
  pickupCommand,
  repoRoot,
  spawnedAt,
  subject = "Plan",
}: {
  incidentId: string;
  branch: string;
  effort?: string;
  model: string;
  pickupCommand: string;
  repoRoot: string;
  spawnedAt: string;
  subject?: string;
}): VisibleSessionPlan {
  const id = safeNameSegment({ value: incidentId }).slice(0, WORKSPACE_TITLE_MAX_LENGTH);
  return {
    baseBranch: undefined,
    branch,
    cwd: repoRoot,
    driver: "claude",
    ...(effort === undefined ? {} : { effort }),
    host: "claude-code",
    model,
    pickupCommand,
    repoRoot,
    respondingToHandle: undefined,
    sessionName: `drawdown-${id}`.slice(0, SESSION_NAME_MAX_LENGTH),
    spawnedAt,
    // An investigation reads gauges, transcripts and a journal; it writes no code.
    template: "research",
    workspaceName: `drawdown-${id}`,
    workspaceTitle: `${subject} drawdown anomaly: ${incidentId}`.slice(0, WORKSPACE_TITLE_MAX_LENGTH),
    worktreeExists: true,
  };
}

/**
 * A {@link VisibleSessionPlan} for the REVIEWER of one ask's composed answer — the second visible session
 * the answer-quality gate needs, opened by `slopweaver turn review` from the worker's own session.
 *
 * The same shape as {@link planAskSession} for the same reasons: the current checkout and no worktree. What differs is the pickup: a reviewer's pickup line points at a packet file that
 * CODE composed from the answer's bytes (`live/turn/review.ts`), so neither the worker nor the loop ever
 * writes the reviewer's instructions — that is what keeps the review independent when the worker is the one
 * pressing the button.
 *
 * @param askChannel the ask's channel, for the workspace's addressing id only
 * @param askMessageTs the ask's addressing message ts, for the workspace's addressing id only
 * @param askQuestion the ask's raw question text, for the workspace's human-readable title
 * @param branch the current checkout's own branch, for the plan's own record
 * @param effort how hard the reviewer should think, or absent for Claude Code's own default
 * @param host which model CLI boots this workspace — the same host as the worker's
 * @param model the model tier or id to pin the reviewer to at boot
 * @param pickupCommand the exact line to send once the session has booted
 * @param repoRoot the current checkout's absolute path — both `repoRoot` and `cwd`, since nothing is created
 * @param spawnedAt the already-captured wall-clock time of this spawn, ISO 8601
 * @returns the plan
 */
export function planReviewSession({
  askChannel,
  askMessageTs,
  askQuestion,
  branch,
  effort,
  host,
  model,
  pickupCommand,
  repoRoot,
  spawnedAt,
}: {
  askChannel: string;
  askMessageTs: string;
  askQuestion: string;
  branch: string;
  effort?: string;
  host: VisibleSessionHost;
  model: string;
  pickupCommand: string;
  repoRoot: string;
  spawnedAt: string;
}): VisibleSessionPlan {
  return {
    baseBranch: undefined,
    branch,
    cwd: repoRoot,
    driver: host === "codex" ? "codex" : "claude",
    ...(effort === undefined ? {} : { effort }),
    host,
    model,
    pickupCommand,
    repoRoot,
    // A reviewer answers to nobody in Slack — it never posts, so there is no addressed user to show.
    respondingToHandle: undefined,
    sessionName: dispatchSessionName({ askChannel, askMessageTs, role: "review" }),
    spawnedAt,
    // A reviewer reads one composed answer and never writes code.
    template: "bot",
    workspaceName: dispatchWorkspaceName({ askChannel, askMessageTs, role: "review" }),
    workspaceTitle: `review: ${deriveWorkspaceTitle({ askQuestion })}`,
    worktreeExists: true,
  };
}
