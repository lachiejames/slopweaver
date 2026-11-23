/**
 * The environment the worker hands the ACP adapter it starts, and the adapter hands the Codex app-server under it.
 * Pure: the worker's own environment and its launch configuration in, the adapter's environment out.
 *
 * The control plane scrubbed credentials and set `CODEX_HOME` when it launched the worker, and this runs the same
 * scrub again (`codexEnvironmentPolicy.ts`) rather than trusting the worker's mutable `process.env` to still be what
 * was launched; then it adds what the adapter reads and drops the worker's own configuration.
 */
import { codexBrowserOffConfig } from "./codexBrowserOff";
import { codexSessionEnvironment } from "./codexEnvironmentPolicy";
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
 * @param inherited the worker's own environment
 * @param config the worker's launch configuration
 * @returns the environment to start the adapter under
 */
export function adapterEnvironment({
  inherited,
  config,
}: {
  inherited: Readonly<Record<string, string | undefined>>;
  config: CodexWorkerLaunchConfig;
}): Record<string, string> {
  const environment = codexSessionEnvironment({ codexHome: config.codexHome, inherited });
  delete environment[WORKER_CONFIG_ENV];
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
