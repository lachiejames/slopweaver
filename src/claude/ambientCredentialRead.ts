/**
 * The effectful edge of {@link classifyAmbientCredential}: read the two places Claude Code takes a
 * credential from ahead of a store, and hand the pure classifier what it found.
 *
 * One copy, shared by every verb that has to know whether a store override means anything at all — a second
 * copy of a safety check is how one caller ends up with it and the other without.
 *
 * `~/.claude` is read directly rather than through `homeDir.ts`: that resolves the WORLD-MODEL home, and
 * this is Claude Code's own config, which stays shared across every credential store
 * (`CLAUDE_SECURESTORAGE_CONFIG_DIR` splits the keychain and leaves `~/.claude` alone — measured against
 * v2.1.259). `CLAUDE_CONFIG_DIR` moves it, so it is honoured when set.
 */
import { homedir } from "node:os";
import { join } from "node:path";

import { readJsonFile } from "../lib/jsonFile.js";
import { isRecord } from "../lib/parsers.js";
import { type ClaudeAmbientCredential, classifyAmbientCredential } from "./ambientCredential.js";

/**
 * The `apiKeyHelper` command Claude Code's settings configure, when they configure one.
 *
 * @param env every environment variable visible to the process, which may relocate the config directory
 * @returns the configured command, or undefined when the file is missing, unparseable or carries no helper
 */
function settingsApiKeyHelper({ env }: { env: Readonly<Record<string, string | undefined>> }): string | undefined {
  const configured = env["CLAUDE_CONFIG_DIR"];
  const root = configured != null && configured.trim() !== "" ? configured.trim() : join(homedir(), ".claude");
  const settings = readJsonFile({ path: join(root, "settings.json") });
  if (!isRecord(settings)) {
    return undefined;
  }
  const helper = settings["apiKeyHelper"];
  return typeof helper === "string" ? helper : undefined;
}

/**
 * Classify the environment this process was launched in.
 *
 * @param env every environment variable visible to the process; defaulted so no caller can forget it
 * @returns which credential a Claude Code session launched here would present, and what named it
 */
export function resolveAmbientCredential({
  env = process.env,
}: {
  env?: Readonly<Record<string, string | undefined>>;
} = {}): ClaudeAmbientCredential {
  const helper = settingsApiKeyHelper({ env });
  return classifyAmbientCredential({ env, ...(helper === undefined ? {} : { apiKeyHelper: helper }) });
}
