/**
 * The environment the worker hands the ACP adapter it starts, and the adapter hands the Codex app-server under it.
 * Pure: the worker's own environment and its launch configuration in, the adapter's environment out.
 *
 * The control plane scrubbed credentials and set `CODEX_HOME` when it launched the worker, and this runs the same
 * scrub again (`codexEnvironmentPolicy.ts`) rather than trusting the worker's mutable `process.env` to still be what
 * was launched; then it adds what the adapter reads and drops the worker's own configuration.
 */
import { APP_SESSION_ID_ENV } from "../sessionControlProtocol";
import { codexBrowserOffConfig } from "./codexBrowserOff";
import { codexSessionEnvironment } from "./codexEnvironmentPolicy";
import { GUARDIAN_PID_ENV, GUARDIAN_START_ENV, type ProcessGuardian } from "./processGuardian";
import { type CodexWorkerLaunchConfig, WORKER_CONFIG_ENV } from "./workerWire";

/**
 * The approval and sandbox preset the adapter opens every session in: edit the workspace, ask before anything wider.
 * A permission request is declined by the worker until a card can ask the owner (`codexAcpWorker.ts`), so a wider
 * preset would be granted by nobody.
 */
export const ADAPTER_AGENT_MODE = "workspace-write";

/**
 * The adapter's environment.
 *
 * The worker's guardian identity (`processGuardian.ts`) rides two fields every command the model runs inherits: the
 * adapter spawns the Codex app-server with its own environment, and Codex's default shell policy inherits it whole —
 * measured on the app's bundled codex, `codex sandbox -c 'sandbox_mode="workspace-write"' -- /usr/bin/printenv
 * SLOPWEAVER_SESSION_GUARDIAN_START` prints the stamp, double-spaced day intact. An inherited pair is always dropped
 * first, so the only guardian a session ever carries is the worker that started its adapter.
 *
 * The session's app id ({@link APP_SESSION_ID_ENV}) rides the same way, so a `slopweaver` verb the model runs can claim
 * the session it is in; an inherited one is dropped first, so the only id a session carries is its own.
 *
 * @param inherited the worker's own environment
 * @param config the worker's launch configuration
 * @param guardian the worker's own pid and exact start stamp, read once before the adapter starts, when `ps` gave one
 * @returns the environment to start the adapter under
 */
export function adapterEnvironment({
  inherited,
  config,
  guardian,
}: {
  inherited: Readonly<Record<string, string | undefined>>;
  config: CodexWorkerLaunchConfig;
  guardian: ProcessGuardian | undefined;
}): Record<string, string> {
  const environment = codexSessionEnvironment({ codexHome: config.codexHome, inherited });
  delete environment[WORKER_CONFIG_ENV];
  delete environment[GUARDIAN_PID_ENV];
  delete environment[GUARDIAN_START_ENV];
  delete environment[APP_SESSION_ID_ENV];
  environment[APP_SESSION_ID_ENV] = config.sessionId;
  if (guardian !== undefined) {
    environment[GUARDIAN_PID_ENV] = String(guardian.pid);
    environment[GUARDIAN_START_ENV] = guardian.start;
  }
  environment["CODEX_PATH"] = config.codexPath;
  environment["INITIAL_AGENT_MODE"] = ADAPTER_AGENT_MODE;
  environment["ELECTRON_RUN_AS_NODE"] = "1";
  // The browser-off overrides ride every session, whether or not a model is named (`codexBrowserOff.ts`).
  const sessionConfig: Record<string, string | boolean> = codexBrowserOffConfig();
  if (config.model !== undefined) {
    sessionConfig["model"] = config.model;
  }
  environment["CODEX_CONFIG"] = JSON.stringify(sessionConfig);
  return environment;
}
