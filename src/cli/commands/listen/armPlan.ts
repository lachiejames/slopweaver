/**
 * The plan `slopweaver listen arm` hands the visible session — which arm, where its output goes, and the exact
 * command line — and the refusal when an arm is already live.
 *
 * Split out of {@link ./supervise.js} when that file passed the size ratchet. Pure given its inputs: nothing
 * here starts a process or writes a record, because the session runs the command and the listener registers
 * itself once it does.
 */
import { bundledLauncherPath } from "../../../lib/pluginRoot.js";
import { err, ok, type Result } from "../../../lib/result.js";
import type { ListenScope } from "../../../live/listen/scope.js";
import { armCommandLine, listenerArgs } from "../../../live/listen/supervise/arm.js";
import { type ListenerArmError, ListenerArmErrors } from "../../../live/listen/supervise/errors.js";
import { listenerLogPath, listenerMentionsPath } from "../../../live/listen/supervise/store.js";

/** What a session needs in order to run one listener: which arm, where its log goes, and the exact line. */
export interface ArmPlan {
  readonly armId: string;
  /** Where the arm's STDOUT goes when backgrounded: pure JSONL, and the stream the loop watches. */
  readonly mentionsPath: string;
  /** Where the arm's STDERR goes when backgrounded: its narration, kept as evidence when it dies. */
  readonly logPath: string;
  readonly queuePath: string;
  readonly command: string;
  /** Whether `command` backgrounds and redirects, or is a plain foreground invocation. */
  readonly background: boolean;
}

/**
 * Compose the plan for one arm. Pure given its inputs — it neither starts a process nor writes a record;
 * the listener registers itself once the session runs the command.
 *
 * @param armId the fresh arm id
 * @param background whether to emit the backgrounded, log-redirected form instead of a foreground call
 * @param home the Slopweaver home the listener reads and writes under
 * @param queuePath where captured tags are durably appended
 * @param scope the conversations the armed listener acts on
 * @param threadReplyChannels the conversations a reply under one of the bot's own posts is an address in
 * @returns the plan the session acts on
 */
export function armPlan({
  armId,
  background = false,
  home,
  queuePath,
  scope,
  threadReplyChannels = [],
}: {
  armId: string;
  background?: boolean;
  home: string;
  queuePath: string;
  scope: ListenScope;
  threadReplyChannels?: readonly string[];
}): ArmPlan {
  const logPath = listenerLogPath({ armId, home });
  const mentionsPath = listenerMentionsPath({ armId, home });
  return {
    armId,
    background,
    command: armCommandLine({
      args: listenerArgs({ armId, home, queuePath, scope, threadReplyChannels }),
      background,
      command: bundledLauncherPath({ importMetaUrl: import.meta.url }),
      logPath,
      mentionsPath,
    }),
    logPath,
    mentionsPath,
    queuePath,
  };
}

/**
 * Plan an arm, or refuse because one is already live.
 *
 * @param armId the fresh arm id
 * @param background whether to emit the backgrounded form
 * @param existing the arm already recorded, or `undefined`
 * @param existingAlive whether that arm's pid is still in the process table
 * @param home the Slopweaver home
 * @param queuePath where captured tags are durably appended
 * @param scope the conversations the armed listener acts on
 * @returns the plan, or the refusal naming the live arm
 */
export function planArm({
  armId,
  background = false,
  existing,
  existingAlive,
  home,
  queuePath,
  scope,
  threadReplyChannels = [],
}: {
  armId: string;
  background?: boolean;
  existing: { readonly armId: string; readonly pid: number } | undefined;
  existingAlive: boolean;
  home: string;
  queuePath: string;
  scope: ListenScope;
  threadReplyChannels?: readonly string[];
}): Result<ArmPlan, ListenerArmError> {
  if (existing !== undefined && existingAlive) {
    return err(ListenerArmErrors.alreadyArmed({ armId: existing.armId, pid: existing.pid }));
  }
  return ok(armPlan({ armId, background, home, queuePath, scope, threadReplyChannels }));
}
