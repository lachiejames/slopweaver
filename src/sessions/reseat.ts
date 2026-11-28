/**
 * `cmux reseat`'s judgement, pure: which live Claude session a workspace is running, what it must be relaunched
 * with, and what it must never be done to. The socket, the kill, the routing gate and the send are
 * `../cli/commands/cmux/reseatEffects.ts`, and the verb `../cli/commands/cmux/reseat.ts`.
 *
 * ## Why this exists beside `session re-seat`
 *
 * `session re-seat` (`./seatRecovery.ts`) CLOSES a walled workspace and fresh-spawns its ledger row's slug, which
 * is right for a seat with nothing to resume and wrong for every other one: the conversation is lost. MEASURED
 * in one macOS-update restart: cmux restored every workspace and re-ran `claude --resume <id>` with no setup-token
 * descriptor and no store, so each seat in that restart came up `Not logged in`, the seat gate refused the owner's
 * own turns in the chair, and its remedy named a spawn that cannot resume anything. The owner wants a no-cost
 * recovery that resumes with context. This relaunches the SAME session id in the SAME surface, on a routed plan.
 *
 * ## What a restored seat still carries, measured
 *
 * A worker's restored argv kept `--plugin-dir`, `--model`, `--effort` and `--permission-mode` and lost only its
 * credential; the chair's (pid 57713) kept only cmux's `--settings` and `--resume`. So every piece is read from
 * the argv first and falls back to what is known without it: the chair is Fable, a worker's model is its ledger
 * row's pinned `bootModel`, and the plugin dir is what `cmux spawn` would have passed.
 *
 * ## A seat booted on no plan is walled, whatever its screen shows
 *
 * The screen banners are not the only wall. MEASURED: the chair came back
 * on an unbound store, so `claude seat`'s prompt hook refused EVERY turn — three recovery nudges included — while
 * its screen drew no `Not logged in` banner, and neither `fleet resume` nor `cmux reseat --all` relaunched it. So a
 * session whose boot credential reads `off-plan` (`../claude/seatBoot.ts`, the same reading the hook refuses on) is
 * a wall here too ({@link bootReseatWall}). Never `unresolved`: a credential that could not be read is not walled.
 */
import { err, ok, type Result } from "#lib/result.js";
import type { SeatBootPlan } from "../claude/seatBoot.js";
import type { CmuxWorkspaceSummary } from "../cmux/client.js";
import { claudeTemplateSuffix, defaultTemplateForRole } from "../cmux/launchTemplate.js";
import { fableOverrideOpen, isFableModel, namedTiers, opusSpawnEffort } from "../cmux/modelPin.js";
import type { ReseatLaunch } from "../cmux/reseatLine.js";
import { FABLE_MODEL_ALIAS } from "../supervisor/chairModel.js";
import { pairRowsToWorkspaces } from "./closeDone.js";
import type { SessionRecord } from "./liveSessions.js";
import { type ReseatError, ReseatErrors } from "./reseatErrors.js";
import type { SeatWall } from "./seatRecovery.js";
import type { SessionItem } from "./session.js";

/**
 * What stops a live seat from answering, as a reseat sees it: a screen banner, or a boot credential no plan names —
 * where `claude seat` refuses every prompt and the screen draws no banner at all.
 */
export type ReseatWall = SeatWall | { readonly kind: "off-plan"; readonly why: string };

/**
 * The wall a session's boot credential raises, read the way `claude seat` reads it.
 *
 * @param plan what the session booted on
 * @returns the off-plan wall carrying the reading's own words, or `undefined` for a plan or an unread credential
 */
export function bootReseatWall({ plan }: { plan: SeatBootPlan }): ReseatWall | undefined {
  if (plan.kind !== "off-plan") {
    return undefined;
  }
  return { kind: "off-plan", why: plan.why };
}

/** The launch flags a running `claude`'s argv names, each absent when it does not. */
export interface LaunchFlags {
  readonly pluginDir?: string;
  readonly model?: string;
  readonly effort?: string;
}

/** The value of the LAST `--<name> <value>` (or `--<name>=<value>`) in an argv line, or `undefined`. */
function lastFlagValue({ argv, name }: { argv: string; name: string }): string | undefined {
  const pattern = new RegExp(String.raw`(?:^|\s)--${name}(?:=|\s+)(\S+)`, "gu");
  const values = [...argv.matchAll(pattern)].map((match) => match[1]!);
  return values.at(-1);
}

/**
 * The launch flags in one process's argv, as `ps -o args=` prints it.
 *
 * The LAST occurrence wins, because cmux's shim puts its `--settings '<hooks json>'` first and our own flags
 * follow it; a JSON blob that happened to spell `--model` would sit before the real one.
 *
 * @param argv the whole argv line
 * @returns the plugin dir, model and effort it names
 */
export function parseLaunchFlags({ argv }: { argv: string }): LaunchFlags {
  const pluginDir = lastFlagValue({ argv, name: "plugin-dir" });
  const model = lastFlagValue({ argv, name: "model" });
  const effort = lastFlagValue({ argv, name: "effort" });
  return {
    ...(pluginDir === undefined ? {} : { pluginDir }),
    ...(model === undefined ? {} : { model }),
    ...(effort === undefined ? {} : { effort }),
  };
}

/** Claude Code's session ids are UUIDs, and the relaunch line interpolates one unquoted. */
export const SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

/**
 * The one live Claude session in a workspace: the registry record whose pid sits in its process tree.
 *
 * A pid in the cmux tree is a live process, so a registry file left behind by a dead one never matches.
 *
 * @param records Claude Code's live-session registry
 * @param treePids every pid in the workspace's process tree
 * @param workspaceRef the workspace, for the refusal
 * @returns the session, or why there is not exactly one
 */
export function sessionInTree({
  records,
  treePids,
  workspaceRef,
}: {
  records: readonly SessionRecord[];
  treePids: readonly number[];
  workspaceRef: string;
}): Result<SessionRecord, ReseatError> {
  const pids = new Set(treePids);
  const inTree = records.filter((record) => pids.has(record.pid));
  const [only] = inTree;
  if (only === undefined) {
    return err(ReseatErrors.noLiveSession({ workspaceRef }));
  }
  if (inTree.length > 1) {
    return err(ReseatErrors.ambiguousSession({ sessionIds: inTree.map((record) => record.sessionId) }));
  }
  return ok(only);
}

/** Where the relaunch's model came from, printed so a reader can see which arm decided it. */
type ReseatModelSource = "flag" | "argv" | "chair" | "ledger";

/**
 * What runs in the workspace before the relaunch: a LIVE claude the pass stops first, or nothing — a COLD tab
 * whose pane is a bare shell, where the line is typed straight in.
 */
export type ReseatPrior = { readonly kind: "live"; readonly pid: number } | { readonly kind: "cold" };

/** One workspace's relaunch, every piece decided. */
export interface ReseatPlan {
  readonly workspace: CmuxWorkspaceSummary;
  readonly chair: boolean;
  readonly sessionId: string;
  /**
   * Resume `sessionId`, or boot FRESH because no transcript stands for it: a session that never took a prompt
   * has nothing to resume, and `--resume` on it prints "No conversation found" and drops to the shell.
   */
  readonly launch: ReseatLaunch;
  readonly prior: ReseatPrior;
  readonly cwd: string;
  readonly model: string;
  readonly modelSource: ReseatModelSource;
  readonly effort: string | undefined;
  readonly pluginDir: string | undefined;
  readonly envPrefix: string;
  readonly templateSuffix: string;
}

/** The model a relaunch boots, and which arm named it, or `undefined` when none does. */
function resolveModel({
  flagModel,
  argvModel,
  chair,
  ledgerModel,
}: {
  flagModel: string | undefined;
  argvModel: string | undefined;
  chair: boolean;
  ledgerModel: string | undefined;
}): { readonly model: string; readonly source: ReseatModelSource } | undefined {
  if (flagModel !== undefined) {
    return { model: flagModel, source: "flag" };
  }
  if (argvModel !== undefined) {
    return { model: argvModel, source: "argv" };
  }
  if (chair) {
    return { model: FABLE_MODEL_ALIAS, source: "chair" };
  }
  if (ledgerModel !== undefined) {
    return { model: ledgerModel, source: "ledger" };
  }
  return undefined;
}

/** The relaunch's model and its arm, refusing when no arm names one or a worker's typed Fable lacks the override. */
function chooseModel({
  argvModel,
  chair,
  env,
  flagModel,
  ledgerModel,
  workspace,
}: {
  argvModel: string | undefined;
  chair: boolean;
  env: Readonly<Record<string, string | undefined>>;
  flagModel: string | undefined;
  ledgerModel: string | undefined;
  workspace: CmuxWorkspaceSummary;
}): Result<{ readonly model: string; readonly source: ReseatModelSource }, ReseatError> {
  const resolved = resolveModel({ argvModel, chair, flagModel, ledgerModel });
  if (resolved === undefined) {
    return err(ReseatErrors.noModel({ workspaceRef: workspace.workspaceRef }));
  }
  const typedFable = resolved.source === "flag" && isFableModel({ model: resolved.model });
  if (typedFable && !chair && !fableOverrideOpen({ env })) {
    return err(ReseatErrors.modelRefused({ model: resolved.model }));
  }
  return ok(resolved);
}

/** The effort and plugin dir a relaunch passes: the argv's own, else what `cmux spawn` would pass. */
function launchSettings({
  defaults,
  flags,
  model,
}: {
  defaults: { readonly pluginDir: string | undefined };
  flags: LaunchFlags;
  model: string;
}): { readonly effort: string | undefined; readonly pluginDir: string | undefined } {
  let effort = opusSpawnEffort({ host: "claude-code", model });
  if (flags.effort !== undefined) {
    effort = flags.effort;
  }
  let pluginDir = defaults.pluginDir;
  if (flags.pluginDir !== undefined) {
    pluginDir = flags.pluginDir;
  }
  return { effort, pluginDir };
}

/**
 * Decide one workspace's relaunch, or why it must not happen.
 *
 * The model: a `--model` the caller typed, else the argv's own, else Fable for the chair, else the ledger row's
 * pinned boot model, else a refusal — never the saved default. Only a TYPED Fable on a worker meets the override
 * `cmux spawn` asks for: one read back off the seat or its ledger row is a restore, not a new pick.
 *
 * @param workspace the workspace to relaunch in
 * @param ownWorkspaceId the caller's own workspace, never touched
 * @param callerAncestry this process's own parent chain: a session on it is the caller's, whatever
 *   `CMUX_WORKSPACE_ID` says — a tab whose environment lost that variable still never stops itself
 * @param chair whether this is the supervisor chair
 * @param session the one live session in the workspace
 * @param argv that session's process argv
 * @param ledgerModel the open ledger row's pinned boot model, when one pairs to the workspace
 * @param flagModel a `--model` the caller typed
 * @param wall the wall its screen or its boot credential shows, when one stands
 * @param force whether to stop a session that is mid-turn behind no wall
 * @param env the environment the Fable override is read from
 * @param defaults what `cmux spawn` would pass when the argv names nothing: the plugin dir and the env prefix
 * @param transcriptExists whether the session's transcript is on disk under its cwd — when it is not, the plan
 *   boots FRESH rather than typing a `--resume` that cannot work
 * @returns the plan, or the refusal
 */
export function planReseat({
  workspace,
  ownWorkspaceId,
  callerAncestry,
  chair,
  session,
  argv,
  ledgerModel,
  flagModel,
  wall,
  force,
  env,
  defaults,
  transcriptExists,
}: {
  workspace: CmuxWorkspaceSummary;
  ownWorkspaceId: string | undefined;
  callerAncestry: ReadonlySet<number>;
  chair: boolean;
  session: SessionRecord;
  argv: string;
  ledgerModel: string | undefined;
  flagModel: string | undefined;
  wall: ReseatWall | undefined;
  force: boolean;
  env: Readonly<Record<string, string | undefined>>;
  defaults: { readonly pluginDir: string | undefined; readonly envPrefix: string };
  transcriptExists: boolean;
}): Result<ReseatPlan, ReseatError> {
  if (workspace.workspaceId === ownWorkspaceId || callerAncestry.has(session.pid)) {
    return err(ReseatErrors.ownWorkspace({ workspaceRef: workspace.workspaceRef }));
  }
  if (!SESSION_ID_PATTERN.test(session.sessionId)) {
    return err(ReseatErrors.unsafeSessionId({ sessionId: session.sessionId }));
  }
  if (session.status === "busy" && wall === undefined && !force) {
    return err(ReseatErrors.busy({ sessionId: session.sessionId }));
  }
  return planFor({
    argv,
    chair,
    cwd: session.cwd,
    defaults,
    env,
    flagModel,
    launch: transcriptExists ? { kind: "resume", sessionId: session.sessionId } : { kind: "fresh" },
    ledgerModel,
    prior: { kind: "live", pid: session.pid },
    sessionId: session.sessionId,
    workspace,
  });
}

/**
 * The tail both plans share — this file's live one and `./reseatCold.ts`'s — the model, effort, plugin dir and
 * template, once the session is settled.
 *
 * @param prior what runs in the workspace before the relaunch: a live pid to stop, or a bare shell
 * @param launch resume the session, or boot fresh because no transcript stands for it
 * @param cwd the directory the session ran in, which the template suffix is built for
 * @param argv the launch argv whose own flags win over the defaults
 * @param ledgerModel the open ledger row's pinned boot model, when one pairs to the workspace
 * @param flagModel a `--model` the caller typed
 * @param env the environment the Fable override is read from
 * @param defaults what `cmux spawn` would pass when the argv names nothing
 * @returns the plan, or the refusal when no model is named or a typed Fable lacks the override
 */
export function planFor({
  workspace,
  chair,
  sessionId,
  launch,
  prior,
  cwd,
  argv,
  ledgerModel,
  flagModel,
  env,
  defaults,
}: {
  workspace: CmuxWorkspaceSummary;
  chair: boolean;
  sessionId: string;
  launch: ReseatLaunch;
  prior: ReseatPrior;
  cwd: string;
  argv: string;
  ledgerModel: string | undefined;
  flagModel: string | undefined;
  env: Readonly<Record<string, string | undefined>>;
  defaults: { readonly pluginDir: string | undefined; readonly envPrefix: string };
}): Result<ReseatPlan, ReseatError> {
  const flags = parseLaunchFlags({ argv });
  const chosen = chooseModel({ argvModel: flags.model, chair, env, flagModel, ledgerModel, workspace });
  if (chosen.isErr()) {
    return err(chosen.error);
  }
  const { effort, pluginDir } = launchSettings({ defaults, flags, model: chosen.value.model });
  const template = defaultTemplateForRole({ role: chair ? "supervisor" : "session" });
  return ok({
    chair,
    cwd,
    effort,
    envPrefix: defaults.envPrefix,
    launch,
    model: chosen.value.model,
    modelSource: chosen.value.source,
    pluginDir,
    prior,
    sessionId,
    templateSuffix: claudeTemplateSuffix({ cwd, template }),
    workspace,
  });
}

/**
 * The workspaces `reseat --all` acts on: every walled one but the caller's own, the chair FIRST — every other
 * seat's supervisor is the one that must come back before anything else.
 *
 * @param workspaces the live cmux inventory
 * @param walls the wall each walled workspace's screen or boot credential showed
 * @param ownWorkspaceId the caller's own workspace, never touched
 * @param chairWorkspaceId the recorded supervisor pin's workspace
 * @returns the walled workspaces, chair first, then inventory order
 */
export function reseatAllTargets({
  workspaces,
  walls,
  ownWorkspaceId,
  chairWorkspaceId,
}: {
  workspaces: readonly CmuxWorkspaceSummary[];
  walls: ReadonlyMap<string, ReseatWall>;
  ownWorkspaceId: string | undefined;
  chairWorkspaceId: string | undefined;
}): readonly CmuxWorkspaceSummary[] {
  const walled = workspaces.filter(
    (workspace) => workspace.workspaceId !== ownWorkspaceId && walls.has(workspace.workspaceId),
  );
  const chairs = walled.filter((workspace) => workspace.workspaceId === chairWorkspaceId);
  const rest = walled.filter((workspace) => workspace.workspaceId !== chairWorkspaceId);
  return [...chairs, ...rest];
}

/**
 * Each live workspace's pinned boot model, read off the OPEN ledger row that pairs to it — the same pairing
 * `session re-seat` uses, so a workspace cmux renumbered on restart still finds its row by its worktree.
 *
 * A pinned model naming no Claude tier is skipped too: a Codex seat's row records the repository's Codex pin
 * (`../sessionHarness/spawnedEvent.ts`'s `bootModelForLaunch`), and this relaunches `claude`, which cannot boot
 * it — the relaunch refuses for want of a model rather than handing Claude a Codex id.
 *
 * @param rows the folded ledger, any status
 * @param workspaces the live cmux inventory
 * @returns the pinned model by workspace id; a workspace whose row inherited its model, has none, or pinned a model
 *   naming no Claude tier is absent
 */
export function pinnedModelsByWorkspace({
  rows,
  workspaces,
}: {
  rows: readonly SessionItem[];
  workspaces: readonly CmuxWorkspaceSummary[];
}): ReadonlyMap<string, string> {
  const paired = pairRowsToWorkspaces({ rows: rows.filter((row) => row.status === "open"), workspaces });
  const models = new Map<string, string>();
  for (const [row, workspace] of paired) {
    if (row.bootModel?.kind === "pinned" && namedTiers({ text: row.bootModel.model }).length > 0) {
      models.set(workspace.workspaceId, row.bootModel.model);
    }
  }
  return models;
}

/** The menu's two options as Claude Code draws them, each on a line of its own, a cursor glyph allowed. */
const RESUME_FROM_SUMMARY_LINE = /^\W*1\.\s+Resume from summary\b/u;
const RESUME_FULL_LINE = /^\W*2\.\s+Resume full session as-is\b/u;

/** How far up from the bottom the menu may sit: it is the live prompt, so it is drawn last. */
const RESUME_MENU_TAIL_LINES = 12;

/**
 * Whether a screen's LIVE bottom shows Claude Code's "resume from summary or in full" menu — the owner's standing answer
 * is option 2 (`skills/supervisor/reference/reboot.md`).
 *
 * Both options must be lines of their own in the screen's last {@link RESUME_MENU_TAIL_LINES} non-blank lines.
 * A resumed transcript that QUOTES the menu, as the chair's own discussion of `reboot.md` does, carries it inline
 * on one line; answering that would submit `2` as a prompt into a live composer.
 *
 * @param screen the surface text
 * @returns true when both options are drawn as menu lines at the bottom
 */
export function screenShowsResumeMenu({ screen }: { screen: string }): boolean {
  const tail = screen
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .slice(-RESUME_MENU_TAIL_LINES);
  return tail.some((line) => RESUME_FROM_SUMMARY_LINE.test(line)) && tail.some((line) => RESUME_FULL_LINE.test(line));
}
