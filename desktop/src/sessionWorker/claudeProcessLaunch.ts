/**
 * The native Claude Code process an app-hosted Claude session runs: started by this worker, inside its process group,
 * only after the Agent SDK's request is checked against the launch configuration.
 *
 * The SDK would start the process itself; the worker does instead for ONE reason: a setup-token seat reads its token
 * from descriptor 3, which only the spawner can attach, and the token must never enter an environment, an argument
 * or the IPC channel. A store seat goes through the same path so there is one launch shape, which the no-headless
 * gate recognises exactly (`src/devLint/noHeadlessCapability.ts`). The check is pure ({@link claudeSpawnPlanOf}); the
 * effect below opens the token, spawns, and closes the worker's own copy of the descriptor.
 */
import { spawn } from "node:child_process";
import { closeSync, openSync } from "node:fs";

import type { SpawnedProcess, SpawnOptions } from "@anthropic-ai/claude-agent-sdk";
import { err, ok, type Result } from "neverthrow";

import { CLAUDE_TOKEN_FD, claudeNativeEnvironment } from "./claudeEnvironmentPolicy";
import { type ClaudeWorkerError, ClaudeWorkerErrors } from "./claudeWorkerErrors";
import type { ClaudeWorkerLaunchConfig } from "./workerWire";

/** The process the SDK's request clears: the packaged binary, the session's directory, and the token file if any. */
export interface ClaudeSpawnPlan {
  readonly claudePath: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly environment: Record<string, string>;
  /** The setup token's file, opened on descriptor 3; absent for a store seat. */
  readonly tokenFilePath?: string;
}

/**
 * Check the SDK's request and decide the process.
 *
 * @param request what the Agent SDK asked to start
 * @param config the worker's launch configuration
 * @returns the plan, or the refusal when the SDK asked for another program or directory
 */
export function claudeSpawnPlanOf({
  request,
  config,
}: {
  request: Pick<SpawnOptions, "command" | "args" | "cwd" | "env">;
  config: ClaudeWorkerLaunchConfig;
}): Result<ClaudeSpawnPlan, ClaudeWorkerError> {
  if (request.command !== config.claudePath) {
    return err(ClaudeWorkerErrors.executableMismatch({ asked: request.command, launched: config.claudePath }));
  }
  if (request.cwd === undefined) {
    return err(
      ClaudeWorkerErrors.directoryMismatch({ asked: "the worker's own directory", launched: config.directory }),
    );
  }
  if (request.cwd !== config.directory) {
    return err(ClaudeWorkerErrors.directoryMismatch({ asked: request.cwd, launched: config.directory }));
  }
  const environment = claudeNativeEnvironment({ config, inherited: request.env });
  const token = config.credential.kind === "setup-token" ? { tokenFilePath: config.credential.tokenFilePath } : {};
  return ok({ args: [...request.args], claudePath: config.claudePath, cwd: config.directory, environment, ...token });
}

/**
 * Start the native process the SDK asked for, or throw the refusal for the SDK to surface as the session's failure.
 *
 * @param request what the Agent SDK asked to start
 * @param config the worker's launch configuration
 * @returns the running process
 */
export function spawnClaudeNative({
  request,
  config,
}: {
  request: SpawnOptions;
  config: ClaudeWorkerLaunchConfig;
}): SpawnedProcess {
  const plan = claudeSpawnPlanOf({ config, request });
  if (plan.isErr()) {
    throw new Error(plan.error.message);
  }
  const validated = plan.value;
  // Slot CLAUDE_TOKEN_FD is the token on a setup-token seat and closed on a store seat, so nothing else sits there.
  const stdio: ("pipe" | "inherit" | "ignore" | number)[] = ["pipe", "pipe", "inherit"];
  stdio[CLAUDE_TOKEN_FD] = "ignore";
  let tokenFd: number | undefined;
  if (validated.tokenFilePath !== undefined) {
    try {
      tokenFd = openSync(validated.tokenFilePath, "r");
    } catch (cause: unknown) {
      throw new Error(ClaudeWorkerErrors.tokenUnreadable({ cause, path: validated.tokenFilePath }).message, { cause });
    }
    stdio[CLAUDE_TOKEN_FD] = tokenFd;
  }
  try {
    const child = spawn(validated.claudePath, validated.args, {
      cwd: validated.cwd,
      env: validated.environment,
      stdio,
    });
    if (child.stdin === null || child.stdout === null) {
      throw new Error("Claude Code started without its stdio pipes");
    }
    // The pipes were just checked, which a ChildProcess's nullable stream fields cannot record in its type.
    // oxlint-disable-next-line no-unsafe-type-assertion -- stdin and stdout are non-null, checked above
    return child as SpawnedProcess;
  } finally {
    if (tokenFd !== undefined) {
      closeSync(tokenFd);
    }
  }
}
