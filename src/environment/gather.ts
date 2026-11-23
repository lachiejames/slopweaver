/**
 * Gather the facts `./probes.ts` grades — the effectful shell around a pure core.
 *
 * **What each probe costs, and which run by default.** `doctor` is the verb every other surface reaches for
 * to see the machine, so its default run has to stay free; the costed probes run only under `--deep`, which
 * onboarding passes because it runs once.
 *
 * | Probe                            | How                                                    | Default |
 * | -------------------------------- | ------------------------------------------------------ | ------- |
 * | every binary on `PATH`           | a `PATH` walk: `access(X_OK)` + `stat` per entry       | on      |
 * | the dangling `slopweaver` link   | one `lstat` + `readlink` per entry, only on a miss     | on      |
 * | Node version and floor           | `process.version`, `package.json`, `.nvmrc` reads      | on      |
 * | the pinned Supabase CLI          | `package.json` and `node_modules/supabase` reads       | on      |
 * | the Node manager                 | `realpath` of each `PATH` entry's `node`               | on      |
 * | GitHub fallback                  | two env reads and one `stat`                           | on      |
 * | `~/.zshrc` defines `slopweaver`  | one file read                                          | on      |
 * | Docker Desktop, Datadog agent    | `existsSync` on their install paths                    | on      |
 * | `gh auth token`                  | a subprocess (`gh` reads its keychain)                 | --deep  |
 * | cmux control socket              | one knock (`cmux revive`'s), 3s bound                  | --deep  |
 * | interactive zsh startup          | `zsh -i -c exit`, 10s bound — runs the whole profile   | --deep  |
 *
 * MEASURED on the owner's machine: 1.54s wall for the free run, 1.45s with `--deep` — both are
 * CLI startup, the difference noise, and a clean profile's `zsh -i` is quick. A slow profile is the one real
 * cost, and the 10s bound caps it. Repro: `/usr/bin/time -p slopweaver doctor` and the same with `--deep`.
 */
import { spawnSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readSync,
  realpathSync,
  rmSync,
  statSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { danglingLinkOnPath, hostPathEntries, isExecutableFile, resolveOnPath } from "#lib/executableOnPath.js";
import { isRecord } from "#lib/parsers.js";
import { safeFs } from "#lib/safeBoundary.js";

import { cmuxSocketPath, knockOnSocket } from "../cmux/reviveEffects.js";
import { stateHomePaths } from "../stateHome.js";

import {
  type DeepFacts,
  type EnvironmentFacts,
  type NodeManager,
  PROBED_BINARIES,
  type ProbedBinary,
} from "./facts.js";

/** How long the costed probes may each take before they are reported as not answering. */
const CMUX_KNOCK_TIMEOUT_MS = 3_000;
const GH_AUTH_TIMEOUT_MS = 10_000;
// A zsh startup slower than this IS the finding, not a probe failure: every terminal and agent shell pays it.
const ZSH_STARTUP_TIMEOUT_MS = 10_000;

/** How much of zsh's startup stderr is read: its first error line sits at the top, so the head is enough. */
const ZSH_STDERR_READ_BYTES = 64 * 1024;

/** The path fragment each manager installs Node under, checked against a resolved (real) path. */
const MANAGER_MARKERS: readonly { readonly manager: NodeManager; readonly fragment: string }[] = [
  { fragment: `${sep}.proto${sep}`, manager: "proto" },
  { fragment: `${sep}.nvm${sep}`, manager: "nvm" },
  { fragment: `${sep}.volta${sep}`, manager: "volta" },
  { fragment: `${sep}fnm`, manager: "fnm" },
  { fragment: `${sep}.asdf${sep}`, manager: "asdf" },
  { fragment: `${sep}mise${sep}`, manager: "mise" },
  { fragment: `${sep}homebrew${sep}`, manager: "homebrew" },
  { fragment: `${sep}Cellar${sep}`, manager: "homebrew" },
];

/**
 * Which manager a Node path belongs to, judged by the path itself and the path its links resolve to.
 *
 * Both are read because a proto shim is a FILE at `~/.proto/shims/node` (the unresolved path names proto)
 * while Homebrew's `/usr/local/bin/node` is a LINK into `Cellar` (only the resolved one does).
 *
 * @param nodePath an executable `node` found on `PATH`
 * @returns the manager, or `null` when neither path carries a recognised fragment
 */
export function managerOfNodePath({ nodePath, resolved }: { nodePath: string; resolved: string }): NodeManager | null {
  for (const candidate of [nodePath, resolved]) {
    const marker = MANAGER_MARKERS.find(({ fragment }) => candidate.includes(fragment));
    if (marker !== undefined) {
      return marker.manager;
    }
  }
  return null;
}

/** A path with its symlinks resolved, or the path itself when it cannot be. */
function realPath({ path }: { path: string }): string {
  return safeFs({ execute: () => realpathSync(path), operation: "environment.realPath", path }).unwrapOr(path);
}

/** A small text file's trimmed contents, or `null` when it is absent or unreadable. */
function readText({ path }: { path: string }): string | null {
  return safeFs({ execute: () => readFileSync(path, "utf8").trim(), operation: "environment.readText", path }).unwrapOr(
    null,
  );
}

/** The checkout this code runs from — the one whose pins apply to it. */
const CHECKOUT_ROOT = fileURLToPath(new URL("../../", import.meta.url));

/** A small JSON file parsed, or `null` when it is absent, unreadable or not JSON. */
function readJson({ path }: { path: string }): unknown {
  const text = readText({ path });
  if (text === null) {
    return null;
  }
  return safeFs({ execute: (): unknown => JSON.parse(text), operation: "environment.parseJson", path }).unwrapOr(null);
}

/** One string field two levels down a parsed JSON value (`engines.node`), or `null` when it is not a string. */
function stringAt({ value, group, key }: { value: unknown; group: string; key: string }): string | null {
  const inner = isRecord(value) ? value[group] : undefined;
  const field = isRecord(inner) ? inner[key] : undefined;
  return typeof field === "string" ? field : null;
}

/** `engines.node` and the Supabase CLI pin from this checkout's `package.json`, and `.nvmrc`'s exact pin. */
function readPins(): EnvironmentFacts["pins"] {
  const manifest = readJson({ path: join(CHECKOUT_ROOT, "package.json") });
  const nvmrc = readText({ path: join(CHECKOUT_ROOT, ".nvmrc") });
  return {
    engineFloor: stringAt({ group: "engines", key: "node", value: manifest }),
    nvmrc: nvmrc === null || nvmrc.length === 0 ? null : nvmrc.replace(/^v/u, ""),
    supabaseCli: stringAt({ group: "dependencies", key: "supabase", value: manifest }),
  };
}

/**
 * The `supabase` on `PATH` when it is a different install from this checkout's own — compared by resolved
 * path, because `node_modules/.bin/supabase` is a link into `node_modules/supabase` — else `null`.
 */
function ambientSupabase({ pathEntries }: { pathEntries: readonly string[] }): string | null {
  const found = resolveOnPath({ name: "supabase", pathEntries });
  if (found === null) {
    return null;
  }
  const own = realPath({ path: join(CHECKOUT_ROOT, "node_modules", "supabase") });
  return realPath({ path: found }).startsWith(`${own}${sep}`) ? null : found;
}

/** A package's `version` under `node_modules`, or `null` when its manifest is absent or carries none. */
function packageVersion({ root, name }: { root: string; name: string }): string | null {
  const manifest = readJson({ path: join(root, "node_modules", name, "package.json") });
  const version = isRecord(manifest) ? manifest["version"] : undefined;
  return typeof version === "string" ? version : null;
}

/**
 * The binary packages `supabase/dist/supabase.js` tries for one platform, in its own order: the `supabase`
 * package is a launcher, and the CLI itself arrives as the optional `@supabase/cli-<os>-<arch>` dependency.
 */
function supabaseBinaryPackages({ platform, arch }: { platform: string; arch: string }): readonly string[] {
  const os = platform === "win32" ? "windows" : platform;
  const names = [`@supabase/cli-${os}-${arch}`];
  if (platform === "linux") {
    names.push(`@supabase/cli-${os}-${arch}-musl`);
  }
  return names;
}

/**
 * The Supabase CLI version `yarn install` put in a checkout, or `null` when the CLI there cannot run.
 *
 * The launcher's version alone is not an install: an install that skipped optional dependencies leaves
 * `node_modules/supabase` in place with no binary behind it, and `yarn store:start` then throws. So the
 * version counts only when a platform binary package the launcher would pick holds an executable
 * `bin/supabase` at that same version.
 *
 * @param root the checkout whose `node_modules` is read
 * @param platform `process.platform`'s value, which picks the binary package
 * @param arch `process.arch`'s value, which picks the binary package
 * @returns the installed version, or `null` when the launcher or a matching binary is missing
 */
export function installedSupabaseCli({
  root,
  platform,
  arch,
}: {
  root: string;
  platform: string;
  arch: string;
}): string | null {
  const launcher = packageVersion({ name: "supabase", root });
  if (launcher === null) {
    return null;
  }
  const ext = platform === "win32" ? ".exe" : "";
  const runnable = supabaseBinaryPackages({ arch, platform }).some(
    (name) =>
      packageVersion({ name, root }) === launcher &&
      isExecutableFile({ path: join(root, "node_modules", name, "bin", `supabase${ext}`) }),
  );
  return runnable ? launcher : null;
}

/** Every manager whose `PATH` entry holds an executable `node`, in `PATH` order, each once. */
function managersOnPath({ pathEntries }: { pathEntries: readonly string[] }): readonly NodeManager[] {
  const found: NodeManager[] = [];
  for (const entry of pathEntries) {
    const nodePath = join(entry, "node");
    if (!isExecutableFile({ path: nodePath })) {
      continue;
    }
    const manager = managerOfNodePath({ nodePath, resolved: realPath({ path: nodePath }) });
    if (manager !== null && !found.includes(manager)) {
      found.push(manager);
    }
  }
  return found;
}

/** Which GitHub token tier ahead of `gh` is ready: an environment token, then the secrets file. */
function githubFallback({
  env,
  home,
}: {
  env: Readonly<Record<string, string | undefined>>;
  home: string;
}): EnvironmentFacts["githubFallback"] {
  const fromEnv = ["GITHUB_TOKEN", "GH_TOKEN"].some((name) => {
    const value = env[name];
    return value !== undefined && value.trim().length > 0;
  });
  if (fromEnv) {
    return "env";
  }
  const file = join(stateHomePaths({ home }).secrets, "github-token");
  const size = safeFs({ execute: () => statSync(file).size, operation: "environment.githubSecret", path: file });
  return size.isOk() && size.value > 0 ? "secrets-file" : null;
}

/** Whether `~/.zshrc` defines a `slopweaver` shell function, by either of zsh's two spellings. */
function zshrcDefinesSlopweaver({ userHome }: { userHome: string }): boolean {
  const zshrc = readText({ path: join(userHome, ".zshrc") });
  return zshrc !== null && /^\s*(?:function\s+slopweaver\b|slopweaver\s*\(\s*\))/mu.test(zshrc);
}

/**
 * Gather every free fact. No subprocess, no socket, no network: a `PATH` walk, `stat`s and small reads.
 *
 * @param home the Slopweaver state home, for the GitHub secrets file
 * @param env the environment to read `PATH` and the token variables from
 * @param userHome the OS user's home, for `~/.zshrc` and `~/.local/bin`
 * @returns the facts, with `deep` left `null`
 */
export function gatherFreeFacts({
  home,
  env,
  userHome,
}: {
  home: string;
  env: Readonly<Record<string, string | undefined>>;
  userHome: string;
}): EnvironmentFacts {
  const pathEntries = hostPathEntries({ env });
  const resolved = PROBED_BINARIES.map((name) => [name, resolveOnPath({ name, pathEntries })] as const);
  // `as`: Object.fromEntries widens keys to string; the entries are built from the exhaustive PROBED_BINARIES.
  // oxlint-disable-next-line no-unsafe-type-assertion
  const onPath = Object.fromEntries(resolved) as Record<ProbedBinary, string | null>;
  const localBin = join(userHome, ".local", "bin", "slopweaver");
  const besideNode = join(dirname(process.execPath), "corepack");
  const nodePath = onPath.node;
  return {
    ambientSupabase: ambientSupabase({ pathEntries }),
    corepackBesideNode: onPath.corepack === null && isExecutableFile({ path: besideNode }) ? besideNode : null,
    danglingSlopweaver: onPath.slopweaver === null ? danglingLinkOnPath({ name: "slopweaver", pathEntries }) : null,
    datadogAgent: existsSync("/opt/datadog-agent") || existsSync("/Applications/Datadog Agent.app"),
    deep: null,
    // The APP, not the CLI: a `docker` binary alone (colima, a stale symlink) is not Docker Desktop.
    dockerApp: existsSync("/Applications/Docker.app") || existsSync(join(userHome, "Applications", "Docker.app")),
    githubFallback: githubFallback({ env, home }),
    installedSupabaseCli: installedSupabaseCli({ arch: process.arch, platform: process.platform, root: CHECKOUT_ROOT }),
    localBinSlopweaver: isExecutableFile({ path: localBin }) ? localBin : null,
    managersOnPath: managersOnPath({ pathEntries }),
    nodeManager: nodePath === null ? null : managerOfNodePath({ nodePath, resolved: realPath({ path: nodePath }) }),
    onPath,
    pins: readPins(),
    runningNode: { execPath: process.execPath, version: process.version },
    zshrcDefinesSlopweaver: zshrcDefinesSlopweaver({ userHome }),
  };
}

/** `gh auth token`'s exit status only — its stdout (the token) is discarded at the pipe, never read. */
function ghAuth({ gh }: { gh: string | null }): DeepFacts["ghAuth"] {
  if (gh === null) {
    return "no-gh";
  }
  const run = spawnSync(gh, ["auth", "token"], { stdio: ["ignore", "ignore", "ignore"], timeout: GH_AUTH_TIMEOUT_MS });
  return run.status === 0 ? "ok" : "failed";
}

/**
 * Whether the live cmux control socket answers one knock — the same knock `cmux revive` judges a hung app by,
 * so the two can never disagree about whether cmux is up.
 */
async function cmuxSocket(): Promise<DeepFacts["cmuxSocket"]> {
  const knock = await knockOnSocket({ socketPath: cmuxSocketPath(), timeoutMs: CMUX_KNOCK_TIMEOUT_MS });
  if (knock.replied) {
    return { answered: true };
  }
  return { answered: false, detail: knock.detail };
}

/**
 * The files zsh itself reads when a terminal opens — the only file names `doctor` will ever echo back.
 *
 * @param zdotdir `$ZDOTDIR`, or the user's home when it is unset — where zsh looks for the per-user files
 * @returns the system and per-user startup files, in the order zsh reads them
 */
export function zshStartupFiles({ zdotdir }: { zdotdir: string }): readonly string[] {
  return ["zshenv", "zprofile", "zshrc", "zlogin"].flatMap((name) => [`/etc/${name}`, join(zdotdir, `.${name}`)]);
}

/** zsh's own error prefix: `<file>:<line>:` for a sourced file, `(eval):<line>:` for an `eval`'d string. */
const ZSH_ERROR_LINE = /^(?<file>\/[^:]+|\(eval\)):(?<line>\d{1,6}):/u;

/**
 * Whether zsh itself reported an error while starting — a stderr line in its own error shape.
 *
 * Plain stderr is NOT an error: a healthy profile's `stty -ixon` writes `stty: stdin isn't a terminal`
 * because this probe has no TTY, and a tool may print a notice. A broken line
 * in a profile, or in anything it sources, is reported by zsh with the file and line prefixed.
 *
 * The one residue, stated rather than discovered: ANY line in that exact shape on the startup's stderr reads
 * as an error, because stderr text alone cannot say who wrote it. The profile may print one
 * (`print -u2 '/tmp/x:12: note'`), zsh's trace may (`PS4='%N:%i: '` with `set -x`),
 * or a `zsh` wrapper on PATH may before it hands over. It costs a dev-environment warning, never a
 * fatal, and only a startup file's path and line are ever echoed.
 *
 * @param stderr everything the interactive startup wrote to stderr
 * @returns whether any line carries zsh's error prefix
 */
export function zshReportedError({ stderr }: { stderr: string }): boolean {
  return stderr.split("\n").some((line) => ZSH_ERROR_LINE.test(line.trim()));
}

/**
 * Where a zsh startup error came from, and nothing of what it said.
 *
 * zsh prefixes a profile error with `<file>:<line>:`, which is the whole fix-it signal. Nothing a profile
 * prints is echoed, though, because a profile can print ANYTHING to stderr in that shape: an earlier
 * version leaked `print -u2 "$GH_TOKEN:12:"`, and another leaked a token embedded in a real file's path
 * (`/tmp/$GH_TOKEN:12:`). So a location survives only when its file is one of zsh's own startup files — a
 * name this code built, never one read out of stderr — and its line is a plain number.
 *
 * @param stderr everything the interactive startup wrote to stderr
 * @param startupFiles the names that may be echoed, from {@link zshStartupFiles}
 * @returns the first error's `file:line` that is in a startup file, else `null`
 */
export function zshErrorLocation({
  stderr,
  startupFiles,
}: {
  stderr: string;
  startupFiles: readonly string[];
}): string | null {
  for (const text of stderr.split("\n")) {
    const located = ZSH_ERROR_LINE.exec(text.trim());
    const file = startupFiles.find((candidate) => candidate === located?.groups?.["file"]);
    const line = located?.groups?.["line"];
    if (file !== undefined && line !== undefined) {
      return `${file}:${line}`;
    }
  }
  return null;
}

/**
 * Start an interactive zsh the way a new terminal does and report how it went.
 *
 * This RUNS the user's whole profile, side effects included, which is why it is `--deep` only. Its stdout is
 * discarded and its stderr is reduced to whether zsh reported an error ({@link zshReportedError}) and a
 * `file:line` ({@link zshErrorLocation}).
 *
 * The exit status is deliberately NOT read. The profile owns the shell the command runs in, so it decides the
 * status: a bare `exit` inherits its last command's, and an `exit` alias, an `exit` or `builtin` function or an
 * EXIT trap rewrites `exit 0` itself. zsh's own error lines are
 * the signal it cannot fake by accident.
 *
 * It runs WITHOUT a terminal on purpose: that is how every agent shell starts zsh. So a profile line that needs
 * one (`exec </dev/tty`) makes zsh report an error here, and that warning is true — the line fails in each of
 * those shells, though not in the owner's own terminal.
 *
 * The time limit covers the shell's EXIT too, so a slow EXIT trap times out here as well as a slow startup.
 * That warning is true for the same reason: every agent shell exits after each command and pays the trap.
 * The probe's text names both rather than blaming startup.
 *
 * stderr goes to a FILE, never a pipe, and only its first {@link ZSH_STDERR_READ_BYTES} are read. A pipe is
 * held open by any child the profile backgrounds (`ssh-agent`, `sleep 30 &!`), so the wait ran to the time
 * limit after zsh had exited cleanly; and a pipe past Node's buffer killed the shell (2 MiB of
 * harmless stderr). A spawn that still fails for a reason other than the time limit is `unreadable`.
 */
function zshStartup({ zsh, zdotdir }: { zsh: string | null; zdotdir: string }): DeepFacts["zshStartup"] {
  if (zsh === null) {
    return "no-zsh";
  }
  const captured = safeFs({
    execute: () => runWithStderrFile({ zsh }),
    operation: "environment.zshStartup",
    path: tmpdir(),
  });
  if (captured.isErr() || captured.value === "unreadable") {
    return "unreadable";
  }
  const { stderr, timedOut } = captured.value;
  const errorAt = zshErrorLocation({ startupFiles: zshStartupFiles({ zdotdir }), stderr });
  return { errorAt, timedOut, zshReportedError: zshReportedError({ stderr }) };
}

/** Run `zsh -i -c 'exit 0'` with stderr in a throwaway file, and read back that file's head. Throws on I/O. */
function runWithStderrFile({ zsh }: { zsh: string }): "unreadable" | { stderr: string; timedOut: boolean } {
  const dir = mkdtempSync(join(tmpdir(), "sw-zsh-startup-"));
  try {
    const fd = openSync(join(dir, "stderr"), "w+");
    try {
      const run = spawnSync(zsh, ["-i", "-c", "exit 0"], {
        stdio: ["ignore", "ignore", fd],
        timeout: ZSH_STARTUP_TIMEOUT_MS,
      });
      const timedOut = run.error !== undefined && "code" in run.error && run.error.code === "ETIMEDOUT";
      if (run.error !== undefined && !timedOut) {
        return "unreadable";
      }
      const head = Buffer.alloc(ZSH_STDERR_READ_BYTES);
      const read = readSync(fd, head, { length: ZSH_STDERR_READ_BYTES, position: 0 });
      return { stderr: head.subarray(0, read).toString("utf8"), timedOut };
    } finally {
      closeSync(fd);
    }
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
}

/**
 * Run the three costed probes over facts already gathered.
 *
 * @param facts the free facts, whose resolved `gh` and `cmux` paths decide what to run
 * @param env the environment to resolve `zsh` on
 * @returns the same facts with `deep` filled in
 */
async function withDeepFacts({
  facts,
  env,
}: {
  facts: EnvironmentFacts;
  env: Readonly<Record<string, string | undefined>>;
}): Promise<EnvironmentFacts> {
  const zsh = resolveOnPath({ name: "zsh", pathEntries: hostPathEntries({ env }) });
  const deep: DeepFacts = {
    cmuxSocket: facts.onPath.cmux === null ? { answered: false, detail: "cmux is not installed" } : await cmuxSocket(),
    ghAuth: ghAuth({ gh: facts.onPath.gh }),
    zshStartup: zshStartup({ zdotdir: zdotdirOf({ env }), zsh }),
  };
  return { ...facts, deep };
}

/** Where zsh reads the per-user startup files: `$ZDOTDIR` when it is set, else home — zsh's own rule. */
function zdotdirOf({ env }: { env: Readonly<Record<string, string | undefined>> }): string {
  const zdotdir = env["ZDOTDIR"];
  if (zdotdir === undefined || zdotdir === "") {
    return homedir();
  }
  return zdotdir;
}

/**
 * The production gather: this process's environment, the real home, and the costed probes when asked.
 *
 * @param deep whether to run the costed probes
 * @returns the facts for this machine
 */
export async function gatherEnvironmentFacts({ deep }: { deep: boolean }): Promise<EnvironmentFacts> {
  const free = gatherFreeFacts({ env: process.env, home: stateHomePaths().root, userHome: homedir() });
  return deep ? withDeepFacts({ env: process.env, facts: free }) : free;
}
