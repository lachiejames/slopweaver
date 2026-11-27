/**
 * Start one session's worker — the only place the desktop app starts a process that will run a model, and only
 * with a {@link VisibleSessionLease}: the card is on screen first, always (`visibleSessionLease.ts`).
 *
 * The worker is this app's own executable run as Node (`ELECTRON_RUN_AS_NODE`), so the installed app carries
 * everything it needs and no system Node is assumed. It leads its own process group (`detached`), so a card's Stop
 * ends it and the vendor processes under it in one signal (`sessionProcessGroup.ts`); and it keeps an IPC channel to
 * this process, whose loss it treats as the app gone — it closes its session and exits (`sessionWorker/codexAcpWorker.ts`,
 * `sessionWorker/claudeAgentWorker.ts`). Its environment is scrubbed HERE by the vendor's own policy, so no caller can
 * hand a worker a credential or another plan's home.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { claudeWorkerEnvironment } from "./sessionWorker/claudeEnvironmentPolicy";
import { codexSessionEnvironment } from "./sessionWorker/codexEnvironmentPolicy";
import { confineToStateHome, WORKER_CONFIG_ENV, type WorkerLaunchConfig } from "./sessionWorker/workerWire";
import { type VisibleSessionLease, visibleWorkerArgv } from "./visibleSessionLease";

/**
 * The environment one worker runs in: the vendor's scrub of the app's own, then the state home a confined launch
 * names, then the worker's own two variables.
 *
 * @param config the worker's launch configuration, whose vendor picks the scrub
 * @param inherited the app's environment, unscrubbed: credentials are dropped and the config's CODEX_HOME set here
 * @returns the environment to start the worker with
 */
export function workerEnvironment({
  config,
  inherited,
}: {
  config: WorkerLaunchConfig;
  inherited: Readonly<Record<string, string | undefined>>;
}): Record<string, string> {
  // Set on the scrubbed object itself, never spread into a fresh `{}`: that object's prototype is null on purpose.
  const environment =
    config.vendor === "codex"
      ? codexSessionEnvironment({ codexHome: config.codexHome, inherited })
      : claudeWorkerEnvironment({ inherited });
  // After the scrub, so the vendor policy can neither drop nor keep the app's own home in its place: a seat spawned
  // with --home runs every verb against that home, never the one the app itself was started with.
  confineToStateHome({ config, environment });
  environment["ELECTRON_RUN_AS_NODE"] = "1";
  environment[WORKER_CONFIG_ENV] = JSON.stringify(config);
  return environment;
}

/**
 * Start the worker a lease clears.
 *
 * @param lease the visible lease for the session
 * @param inherited the app's environment, unscrubbed: credentials are dropped and the lease's CODEX_HOME set here
 * @returns the worker process
 */
export function launchSessionWorker({
  lease,
  inherited,
}: {
  lease: VisibleSessionLease;
  inherited: Readonly<Record<string, string | undefined>>;
}): ChildProcess {
  const { config } = lease;
  const environment = workerEnvironment({ config, inherited });
  return spawn(process.execPath, visibleWorkerArgv({ lease }), {
    cwd: config.directory,
    detached: true,
    env: environment,
    stdio: ["ignore", "ignore", "pipe", "ipc"],
  });
}
