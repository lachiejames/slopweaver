/**
 * The browser-off overrides an app-hosted Codex session carries, so it starts none of the ChatGPT app's browser
 * or computer-use surfaces — AGENTS.md rule 3, exactly as a cmux seat's boot line does with its `-c` flags.
 *
 * `src/codex/browserSurface.ts` is the authority, with the measurement of which spellings work and why the
 * overrides ride every launch rather than an edit to `config.toml`. The desktop builds apart from `src/` and
 * cannot import it, so the lists are restated here and `desktop/__tests__/unit/codexBrowserOff.test.ts` fails the
 * moment the two differ. The browser door the CLI reads before the app is asked for anything judges the server
 * list AS IF these overrides applied, so a launch that dropped them would be one the door never saw.
 *
 * MEASURED on the installed app: a trusted worktree declaring `mcp_servers.node_repl` with the command
 * `/bin/sleep 4242` opened as an app seat with no overrides, and `pgrep -fl "sleep 4242"` listed the server running.
 */

/** The bundled plugins that carry a browser or computer-use surface, by the id `config.toml` keys them on. */
export const CODEX_BROWSER_PLUGINS: readonly string[] = Object.freeze([
  "browser@openai-bundled",
  "computer-use@openai-bundled",
  "unified-computer-use@openai-bundled",
]);

/** The MCP servers the ChatGPT app declares straight into `config.toml` that drive a browser. */
export const CODEX_BROWSER_MCP_SERVERS: readonly string[] = Object.freeze(["node_repl"]);

/** A command that makes an override a VALID server on a home that never declared it; disabled, it never runs. */
const INERT_COMMAND = "/usr/bin/false";

/**
 * The overrides as the dotted key paths the Codex app-server's session config takes, the same keys a `-c` flag
 * names, in the CLI's order: plugins first.
 *
 * @returns a fresh map from each key path to its value
 */
export function codexBrowserOffConfig(): Record<string, string | boolean> {
  const config: Record<string, string | boolean> = {};
  for (const plugin of CODEX_BROWSER_PLUGINS) {
    config[`plugins.${plugin}.enabled`] = false;
  }
  for (const server of CODEX_BROWSER_MCP_SERVERS) {
    config[`mcp_servers.${server}.command`] = INERT_COMMAND;
    config[`mcp_servers.${server}.enabled`] = false;
  }
  return config;
}
