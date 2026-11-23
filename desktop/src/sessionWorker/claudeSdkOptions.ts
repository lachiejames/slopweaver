/**
 * The Agent SDK options an app-hosted Claude session opens with, from its launch configuration alone. Pure.
 *
 * Every setting source loads, so the owner's hooks, skills and rules run exactly as in a cmux seat; the flag-settings
 * tier, which outranks them, blanks `apiKeyHelper` (a helper would hand the session a metered key the plan never
 * named), blanks every credential and pins the routing in its `env` (a settings file's `env` lands after the spawn's
 * scrub) and carries the seat template's rule exclusions (`src/cmux/launchTemplate.ts` `claudeMdExcludesFor`).
 * Nobody answers a permission prompt: the card has no approval form, so a request nobody saw is denied, while the
 * permission mode, rules and hooks still decide everything they decide in a terminal.
 */
import type { Options, SpawnedProcess, SpawnOptions } from "@anthropic-ai/claude-agent-sdk";

import { claudeSettingsEnvironment } from "./claudeEnvironmentPolicy";
import type { ClaudeWorkerLaunchConfig } from "./workerWire";

// The SDK's process shape, for this module's tests: the root manifest does not list the SDK the desktop depends on.
export type { SpawnedProcess };

/**
 * The options for the session's one `query`.
 *
 * @param config the worker's launch configuration
 * @param spawnClaudeCodeProcess the worker's own spawner, which attaches the token descriptor the SDK cannot
 * @returns the options, with no field the configuration did not decide
 */
export function claudeSdkOptions({
  config,
  spawnClaudeCodeProcess,
}: {
  config: ClaudeWorkerLaunchConfig;
  spawnClaudeCodeProcess: (options: SpawnOptions) => SpawnedProcess;
}): Options {
  // A new transcript is named by the app; a resumed one is named by the journal, and the SDK takes one or the other.
  const transcript =
    config.resumeVendorSessionId === undefined
      ? { sessionId: config.vendorSessionId }
      : { resume: config.resumeVendorSessionId };
  return {
    cwd: config.directory,
    pathToClaudeCodeExecutable: config.claudePath,
    permissionPrompts: "none",
    ...transcript,
    settingSources: ["user", "project", "local"],
    settings: {
      apiKeyHelper: "",
      claudeMdExcludes: [...config.claudeMdExcludes],
      env: claudeSettingsEnvironment({ config }),
    },
    spawnClaudeCodeProcess,
    ...(config.model === undefined ? {} : { model: config.model }),
    ...(config.effort === undefined ? {} : { effort: config.effort }),
    ...(config.pluginDir === undefined ? {} : { plugins: [{ path: config.pluginDir, type: "local" }] }),
  };
}
