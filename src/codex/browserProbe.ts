/**
 * Read one Codex home's EFFECTIVE MCP server list — the one a seat carrying the browser-off overrides would
 * start — and say which of those servers could still launch a browser.
 *
 * The effectful half of `./browserSurface.ts`: one blocking `codex mcp list --json`, which starts no model
 * and no server (it prints configuration and exits; measured 0.19s). Blocking by construction,
 * so `no-headless` NH001 has nothing to say about it. The binary is the CALLER's to name, and it must be the
 * one the launch will run: `codex` on PATH for a seat's boot line, the SDK's vendored CLI for a pass
 * (`./vendoredCli.ts`). Two builds can read one home into two different lists — Codex review r2 found a
 * pass door asking PATH's 0.155.1 about a thread the vendored 0.153.4 would start.
 */
import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { delimiter, resolve } from "node:path";

import { z } from "zod";

import { err, ok, type Result } from "#lib/result.js";
import { safeJsonParse } from "#lib/safeJson.js";

import { browserCapableServers, type CodexMcpServerRow, codexBrowserOffOverrides } from "./browserSurface.js";
import { codexClientEnvironment } from "./client.js";
import { type CodexCli, withCodexPathDirs } from "./vendoredCli.js";

/** How long the listing may take before the probe gives up; it answers in well under a second. */
const PROBE_TIMEOUT_MS = 15_000;

/** The listing's rows, narrowed to what the classifier reads; a remote server carries a URL, not a command. */
const McpListRows = z.array(
  z.object({
    enabled: z.boolean(),
    name: z.string(),
    transport: z.object({
      args: z.array(z.string()).optional(),
      command: z.string().optional(),
      env: z.record(z.string(), z.unknown()).nullable().optional(),
      env_vars: z.array(z.string()).nullable().optional(),
      url: z.string().optional(),
    }),
  }),
);

/** What a server runs: its command, a remote server's URL, or nothing when the listing names neither. */
function serverRuns({ command, url }: { command: string | undefined; url: string | undefined }): string {
  if (command !== undefined) {
    return command;
  }
  if (url !== undefined) {
    return url;
  }
  return "";
}

/**
 * Every path a launch could run for a command, a superset of any one platform's lookup: the command as a path
 * from the launch directory, then at each PATH entry in order (an empty entry, or an empty PATH, being the
 * launch directory), each also with every executable extension appended.
 */
function commandCandidates({
  command,
  cwd,
  searchPath,
  extensions,
}: {
  command: string;
  cwd: string;
  searchPath: string;
  extensions: readonly string[];
}): readonly string[] {
  const bases = [resolve(cwd, command), ...searchPath.split(delimiter).map((dir) => resolve(cwd, dir, command))];
  return bases.flatMap((base) => [base, ...extensions.map((extension) => `${base}${extension}`)]);
}

/**
 * Every file a server's command could run, symlinks resolved, so a link into the app bundle is judged as the
 * bundle. It OVER-checks rather than mirror any platform's lookup: every command is tried both as a path and
 * at EVERY match on the launch's PATH (Codex review r7), never only the first — which one a launch runs turns
 * on rules (an execute bit, a directory of that name, a Windows `.\` path or PATHEXT) this need not mirror to be
 * safe (r12, r17). A relative PATH entry is taken from the launch's own directory (r9) and an EMPTY one
 * means that directory itself, as a shell reads it (r11). A URL, or a name or path with nothing on disk
 * behind it, resolves to nothing and is judged as written.
 *
 * @param command the command the listing printed
 * @param cwd the directory the launch runs in, which a relative command or PATH entry is resolved against
 * @param searchPath the launch environment's PATH, which a command is looked up on
 * @param extensions the executable extensions a launch may append (Windows' PATHEXT), none elsewhere
 * @returns each existing candidate's resolved path, in lookup order — empty when nothing on disk backs the command
 */
export function resolvedCommandPaths({
  command,
  cwd,
  searchPath,
  extensions,
}: {
  command: string;
  cwd: string;
  searchPath: string;
  extensions: readonly string[];
}): readonly string[] {
  const resolved = commandCandidates({ command, cwd, extensions, searchPath }).flatMap((candidate) => {
    try {
      return [realpathSync(candidate)];
    } catch {
      return [];
    }
  });
  return [...new Set(resolved)];
}

/**
 * The launch's PATH, every spelling of the key joined (Windows' `Path` is one); an unset one reads as empty,
 * which over-checks the launch directory and never under-checks.
 */
function pathOf({ env }: { env: Record<string, string> }): string {
  return Object.keys(env)
    .filter((key) => key.toLowerCase() === "path")
    .map((key) => env[key]!)
    .join(delimiter);
}

/** Windows' executable extensions — its PATHEXT, else the CLI default — and none on any other platform. */
function executableExtensions({
  env,
  platform,
}: {
  env: Record<string, string>;
  platform: NodeJS.Platform;
}): readonly string[] {
  if (platform !== "win32") {
    return [];
  }
  const pathExt = Object.keys(env)
    .filter((key) => key.toUpperCase() === "PATHEXT")
    .map((key) => env[key]!)
    .join(";");
  const listed = pathExt.split(";").filter((extension) => extension.length > 0);
  return [...new Set([...listed, ".COM", ".EXE", ".BAT", ".CMD"])];
}

/**
 * Turn the listing's JSON text into classifier rows.
 *
 * @param stdout what `codex mcp list --json` printed
 * @returns the rows, or why the text is not a listing
 */
export function parseCodexMcpList({ stdout }: { stdout: string }): Result<readonly CodexMcpServerRow[]> {
  let json: unknown;
  try {
    json = safeJsonParse({ label: "codex mcp list --json", text: stdout });
  } catch (cause) {
    return err([`codex mcp list printed no JSON: ${cause instanceof Error ? cause.message : String(cause)}`]);
  }
  const parsed = McpListRows.safeParse(json);
  if (!parsed.success) {
    return err([`codex mcp list printed an unexpected shape: ${parsed.error.message}`]);
  }
  return ok(
    parsed.data.map((row) => {
      const { args = [], command, env, env_vars: envVars, url } = row.transport;
      const keys: readonly string[] = env == null ? [] : Object.keys(env);
      const envKeys = envVars == null ? keys : keys.concat(envVars);
      const runs = serverRuns({ command, url });
      return { args, command: runs, enabled: row.enabled, envKeys, name: row.name, resolvedCommands: [] };
    }),
  );
}

/**
 * The servers a Codex launch on this home would start that can still launch a browser, after the overrides.
 *
 * @param codexHome the launch's routed home, or undefined for the ambient one
 * @param cwd the directory the launch runs in — Codex layers a trusted project's `.codex/config.toml` found from
 *   there, so a listing taken anywhere else can miss a server that launch starts (Codex review r3)
 * @param cli the Codex binary the launch runs — a bare `codex` resolves on PATH, a path is used as is — and the
 *   directories that launch puts in front of PATH
 * @returns the offending server names (empty is the clean answer), or why the listing could not be read
 */
export function probeCodexBrowserServers({
  codexHome,
  cwd,
  cli,
}: {
  codexHome: string | undefined;
  cwd: string;
  cli: CodexCli;
}): Result<readonly string[]> {
  const overrides = codexBrowserOffOverrides().flatMap((override) => ["-c", override]);
  const env = withCodexPathDirs({
    env: codexClientEnvironment({ codexHome, env: process.env }),
    pathDirs: cli.pathDirs,
  });
  const run = spawnSync(cli.path, [...overrides, "mcp", "list", "--json"], {
    cwd,
    encoding: "utf8",
    env,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: PROBE_TIMEOUT_MS,
  });
  if (run.error !== undefined) {
    return err([`codex mcp list could not run: ${run.error.message}`]);
  }
  if (run.status !== 0) {
    return err([`codex mcp list exited ${String(run.status)}: ${run.stderr.trim()}`]);
  }
  return parseCodexMcpList({ stdout: run.stdout }).map((servers) =>
    browserCapableServers({
      servers: servers.map((server) => ({
        ...server,
        resolvedCommands: resolvedCommandPaths({
          command: server.command,
          cwd,
          extensions: executableExtensions({ env, platform: process.platform }),
          searchPath: pathOf({ env }),
        }),
      })),
    }),
  );
}
