/**
 * What an app-hosted Claude session presents to the provider, for the pre-spawn credential gate
 * (`cmux/spawnDeps.ts`). The gate judges the ambient credential a session launched here would ACTUALLY present, and an
 * app seat is not launched from this shell: its worker drops the whole `ANTHROPIC_` and `CLAUDE` namespaces bar the
 * owner's configuration, and its flag settings blank `apiKeyHelper` and every credential
 * (`desktop/src/sessionWorker/claudeEnvironmentPolicy.ts`). So the verdict is the classifier's own over that scrubbed
 * environment, never over the spawning shell's, which a cmux seat inherits and an app seat does not.
 *
 * The desktop restates the namespaces and the kept names, as it does the Codex credential keys, since it cannot import
 * `src/` at run time; a test holds the two copies equal.
 */
import { type ClaudeAmbientCredential, classifyAmbientCredential } from "../claude/ambientCredential.js";

/** The namespaces an app-hosted Claude session never inherits: any variable in them could outrank its routed login. */
export const APP_CLAUDE_DROPPED_PREFIXES: readonly string[] = ["ANTHROPIC_", "CLAUDE"];

/** The owner's configuration inside those namespaces, which the session still inherits and which routes no login. */
export const APP_CLAUDE_KEPT_VARIABLES: readonly string[] = ["CLAUDE_CONFIG_DIR"];

/**
 * The ambient verdict for an app-hosted Claude session: the classifier over the environment its worker really gets,
 * with the helper its flag settings blank.
 *
 * @param inherited the environment the spawn runs in, which the app's own differs from only by what is dropped
 * @returns the verdict the credential gate judges an app seat by
 */
export function appHarnessAmbientCredential({
  inherited,
}: {
  inherited: Readonly<Record<string, string | undefined>>;
}): ClaudeAmbientCredential {
  const scrubbed: Record<string, string | undefined> = Object.create(null);
  for (const [name, value] of Object.entries(inherited)) {
    const dropped = APP_CLAUDE_DROPPED_PREFIXES.some((prefix) => name.startsWith(prefix));
    if (APP_CLAUDE_KEPT_VARIABLES.includes(name) || !dropped) {
      scrubbed[name] = value;
    }
  }
  return classifyAmbientCredential({ apiKeyHelper: "", env: scrubbed });
}
