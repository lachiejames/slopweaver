/**
 * The ChatGPT app's browser and computer-use tools, switched off for every Codex this repository starts.
 *
 * AGENTS.md rule 3 bans a LAUNCHED browser. The ChatGPT desktop app writes `~/.codex/config.toml` itself and
 * enables three bundled plugins plus a `node_repl` MCP server there; the `unified-computer-use` plugin's own
 * `.mcp.json` adds a `cua_repl` server. A visible Codex seat booted on that home spawned `cua-repl`, which
 * launched a SECOND Google Chrome from the app bundle. The owner's own Chrome was already running, so every launch
 * aborted in `RegisterApplication` and macOS put a crash dialog in front of the owner — ten in one day
 * (`ls ~/Library/Logs/DiagnosticReports | grep 'Google Chrome-'`).
 *
 * **Why an override per launch, never an edit to `config.toml`.** That file is the app's: it rewrites the
 * `node_repl` entry on every update (the entry carries the app's own version), so a disable written into it
 * drifts back, and it would also take the tools off the app the owner uses directly. A `-c` override applies to the
 * one process that carries it and survives every rewrite.
 *
 * MEASURED on codex-cli 0.155.1, from `/` so no project config joins in — the spelling is the
 * finding, so read the list with and without it:
 * `codex -c plugins.unified-computer-use@openai-bundled.enabled=false -c mcp_servers.node_repl.command=/usr/bin/false -c mcp_servers.node_repl.enabled=false mcp list`
 * drops `cua_repl` and marks `node_repl` disabled while every other plugin's server stays. Two spellings that
 * look equivalent DO NOT work: the QUOTED key `plugins."unified-computer-use@openai-bundled".enabled` leaves
 * `cua_repl` enabled, and `--disable browser_use --disable computer_use --disable in_app_browser` leaves both
 * servers enabled. A pass hands the same strings to `@openai/codex-sdk`'s `configOverrides`, which passes
 * each through unchanged as a `--config` argument.
 *
 * A NEW plugin the app ships under another name is what this list cannot know; {@link browserCapableServers}
 * is the classifier that catches it on the effective server list, so a seat or a pass is refused rather than launched.
 *
 * The same crash reaches the owner by the SHELL route rather than an MCP server: a review pass that runs a
 * stock Electron. That route is `./electronSurface.ts`.
 */

/** The bundled plugins that carry a browser or computer-use surface, by the id `config.toml` keys them on. */
const CODEX_BROWSER_PLUGINS = [
  "browser@openai-bundled",
  "computer-use@openai-bundled",
  "unified-computer-use@openai-bundled",
] as const;

/** The MCP servers the app declares straight into `config.toml` (not through a plugin) that drive a browser. */
const CODEX_BROWSER_MCP_SERVERS = ["node_repl"] as const;

/**
 * The command a server override names so the entry is a VALID server on a home that never declared it.
 *
 * `enabled=false` alone creates a server with no transport on such a home, and Codex then refuses to start
 * at all (`invalid transport in mcp_servers.node_repl`) — every routed home is one. Measured:
 * `CODEX_HOME=$(mktemp -d) codex -c mcp_servers.node_repl.enabled=false mcp list` fails, and adding
 * `-c mcp_servers.node_repl.command=/usr/bin/false` lists it disabled. The command never runs: disabled.
 */
const INERT_COMMAND = "/usr/bin/false";

/**
 * The `-c` overrides that switch every declared browser surface off, one `key=value` per entry.
 *
 * @returns the overrides in a stable order, plugins first
 */
export function codexBrowserOffOverrides(): readonly string[] {
  return [
    ...CODEX_BROWSER_PLUGINS.map((plugin) => `plugins.${plugin}.enabled=false`),
    ...CODEX_BROWSER_MCP_SERVERS.flatMap((server) => [
      `mcp_servers.${server}.command=${INERT_COMMAND}`,
      `mcp_servers.${server}.enabled=false`,
    ]),
  ];
}

/**
 * The same overrides as the suffix a shell boot line carries, each a ` -c <override>` word pair.
 *
 * No quoting is needed and none is added: every character here is a letter, a digit, `-`, `_`, `.`, `/`,
 * `=` or `@`, none of which a POSIX shell treats specially outside the first word.
 *
 * @returns the suffix, starting with a space
 */
export function codexBrowserOffFlags(): string {
  return codexBrowserOffOverrides()
    .map((override) => ` -c ${override}`)
    .join("");
}

/** One row of `codex mcp list --json`, narrowed to what the classifier reads. */
export interface CodexMcpServerRow {
  readonly name: string;
  readonly enabled: boolean;
  readonly command: string;
  /** Every file {@link command} could run once symlinks resolve — each PATH match for a bare name — or none. */
  readonly resolvedCommands: readonly string[];
  readonly args: readonly string[];
  readonly envKeys: readonly string[];
}

/**
 * Paths and names that mark a server as the ChatGPT app's browser or computer-use runtime — lower case, and
 * compared against lower-cased text: macOS's default volume is case-insensitive, so
 * `/APPLICATIONS/CHATGPT.APP/…/CUA_NODE/…` runs the same file.
 */
const BROWSER_RUNTIME_MARKERS = ["cua_node", "cua-repl", "node_repl", "skycomputeruse", "browser-service"] as const;

/** Environment keys only a browser-driving server is handed, compared against the upper-cased key. */
const BROWSER_ENV_PREFIXES = ["BROWSER_USE_", "SKY_CUA_", "CUA_REPL_"] as const;

/**
 * Which ENABLED servers in a Codex home's effective list can still launch a browser.
 *
 * Judged on what the server RUNS, never on its name alone: a renamed plugin shipping the same runtime is the
 * case this exists for. A disabled server is never a hit — disabled is the state the overrides produce.
 *
 * Case never matters, and a command is judged at its symlink-resolved path as well as as written.
 *
 * **Its blind spot, stated:** it reads the listing, never through it. A server whose command is a wrapper
 * script that execs the app's runtime lists only the wrapper, and passes. That is a server somebody AUTHORED
 * to launch a browser — which any MCP server can do with or without the ChatGPT app — not the app's own
 * config naming its own bundle, which is what crashed in front of the owner; no reading of the list closes it.
 * The second: the door reads the environment the process that RUNS it
 * holds. A seat's interactive shell starts after the door has answered, and its own startup files may set
 * any variable again — a PATH a bare command name then resolves on differently, or a CODEX_HOME an unrouted
 * seat then reads (r10, r14) — as may a server naming its own `cwd`. Only a routed seat's home is pinned
 * on the boot line itself. The `-c` overrides ride that boot line whichever home it lands on, so the app's
 * own plugins and `node_repl` stay off there; what the door cannot see is a SECOND server that shell's
 * environment adds. A bare name is judged at EVERY match on the PATH the door sees, from the launch's
 * directory, and the app names its bundle by absolute path, which no environment changes. The third is
 * TIME: the door answers before the launch, so a config the app rewrites in between is read by the launch
 * and not by the door (r15). The overrides are read AT launch, so a rewrite that re-enables the app's own
 * plugins or `node_repl` still lands switched off; only a new server added in that window gets past.
 *
 * @param servers the effective list, after every override the launch will carry
 * @returns the names of the servers that would still start a browser runtime, in list order
 */
export function browserCapableServers({ servers }: { servers: readonly CodexMcpServerRow[] }): readonly string[] {
  return servers
    .filter((server) => server.enabled)
    .filter((server) => {
      const runs = [server.name, server.command, ...server.resolvedCommands, ...server.args].map((part) =>
        part.toLowerCase(),
      );
      const byRuntime = runs.some((part) => BROWSER_RUNTIME_MARKERS.some((marker) => part.includes(marker)));
      const byEnv = server.envKeys.some((key) =>
        BROWSER_ENV_PREFIXES.some((prefix) => key.toUpperCase().startsWith(prefix)),
      );
      return byRuntime || byEnv;
    })
    .map((server) => server.name);
}
