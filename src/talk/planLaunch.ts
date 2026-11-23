/**
 * The EFFECTFUL half of a plan call's launch: which Codex binary the console runs, and which MCP servers its
 * config declares, so `./planSession.ts` can stub every one of them out.
 *
 * The binary is the SDK's vendored CLI, resolved exactly as the live account read resolves it
 * (`resolveAppServerExecutable`) — never a `codex` on PATH, which on the owner's machine is a cmux wrapper, and
 * never a version this repository has not pinned: the realtime v3 protocol and the chatgpt.com voices first
 * shipped in 0.157.1. Every test lane points `SLOPWEAVER_CODEX_APP_SERVER` at a path that does not exist, so a
 * test reaching the production reader gets `the vendored Codex CLI is not at …` rather than the owner's real config.
 *
 * `codex mcp list --json` is one blocking `spawnSync` that reads config and starts no model, run with the same
 * credential scrub and the same routed `$CODEX_HOME` the app-server child gets. It fails the plan mint CLOSED: a
 * server this cannot name is a server that would start inside the owner's call.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

import { resolveAppServerExecutable } from "../codex/accountLive.js";
import { CREDENTIAL_KEYS, codexClientEnvironment } from "../codex/client.js";
import { err, ok, type Result } from "../lib/result.js";
import { type PlanLaunchError, PlanLaunchErrors } from "./planLaunchErrors.js";
import { mcpServerNamesOf } from "./planSession.js";

/** How long `codex mcp list --json` may take: it reads config only, measured well under a second. */
const MCP_LIST_TIMEOUT_MS = 10_000;

/** What the plan composition needs from this machine. */
export interface PlanLaunchFacts {
  readonly executable: string;
  readonly mcpServers: readonly string[];
  readonly unsetEnv: readonly string[];
}

/**
 * Runs `<executable> mcp list --json` under the routed `$CODEX_HOME` and hands back what it printed, or why it
 * could not. The home is required: the servers stubbed must be the ones the CHILD's home declares, and the child
 * runs on the routed row's home, so a list read off the ambient home would leave that row's servers live.
 */
export type ReadMcpList = (input: {
  readonly executable: string;
  readonly codexHome: string;
}) => Result<string, PlanLaunchError>;

/**
 * Resolve the binary and the MCP servers a plan call must stub, failing closed on either.
 *
 * @param codexHome the routed register row's `$CODEX_HOME`, whose config the MCP list is read from
 * @param env the environment the binary override is read from
 * @param readMcpList how the configured MCP servers are listed — the production reader, or a test's fake
 * @returns the launch facts, or why this machine cannot launch a plan call
 */
export function planLaunchFacts({
  codexHome,
  env,
  readMcpList,
}: {
  codexHome: string;
  env: Readonly<Record<string, string | undefined>>;
  readMcpList: ReadMcpList;
}): Result<PlanLaunchFacts, PlanLaunchError> {
  const resolved = resolveAppServerExecutable({ env });
  if ("reason" in resolved) {
    return err(PlanLaunchErrors.cliUnresolved({ reason: resolved.reason }));
  }
  const listed = readMcpList({ codexHome, executable: resolved.path });
  if (listed.isErr()) {
    return err(listed.error);
  }
  const names = mcpServerNamesOf({ json: listed.value });
  if (names.isErr()) {
    return err(names.error);
  }
  return ok({ executable: resolved.path, mcpServers: names.value, unsetEnv: [...CREDENTIAL_KEYS] });
}

/**
 * The production {@link ReadMcpList}: one blocking `codex mcp list --json` under the credential scrub, on the
 * routed home.
 *
 * @param executable the vendored Codex CLI
 * @param codexHome the routed register row's `$CODEX_HOME`
 * @returns what it printed, or why it could not be run
 */
export const readMcpListLive: ReadMcpList = ({ codexHome, executable }) => {
  if (!existsSync(executable)) {
    return err(PlanLaunchErrors.cliAbsent({ path: executable }));
  }
  const run = spawnSync(executable, ["mcp", "list", "--json"], {
    encoding: "utf8",
    env: codexClientEnvironment({ codexHome, env: process.env }),
    timeout: MCP_LIST_TIMEOUT_MS,
  });
  if (run.error !== undefined) {
    return err(PlanLaunchErrors.mcpListUnrunnable({ cause: run.error }));
  }
  if (run.status !== 0) {
    return err(PlanLaunchErrors.mcpListExited({ status: run.status, stderr: run.stderr }));
  }
  return ok(run.stdout);
};
