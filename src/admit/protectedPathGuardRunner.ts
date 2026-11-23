/**
 * The protected-path tripwire's runner: read the `PreToolUse` payload and the owner's registry, decide, and print the
 * four-line refusal. The decisions are `./protectedPathGuard.ts` (file tools) and `./protectedPathBash.ts` (`Bash`);
 * nothing here judges anything.
 *
 * ## Which registries
 *
 * The environment's home and the account default, each once — the call-state guard's reason (`./callStateGuardRunner.ts`):
 * a process pointed at a throwaway home still keeps the owner's live protection. Each registry FILE is itself an
 * implicit `read-only` entry, so the owner's list is changed by `slopweaver protect` and by no tool call.
 *
 * ## Fails OPEN
 *
 * An unreadable payload, an unreadable or malformed registry, a field it cannot read: allowed. A tripwire that failed
 * closed would wedge every `Read` on the machine on one bad byte; `slopweaver protect list` is what reports a
 * malformed registry. Every reader is injected, so a test needs no mock.
 */
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { basename, dirname, join } from "node:path";

import { hatchFor } from "../hatch/lookup.js";
import { hatchRefusal } from "../hatch/render.js";
import { accountDefaultHome, slopweaverHomeOf } from "../homeDir.js";
import { isRecord } from "../lib/parsers.js";
import type { ProtectedPath } from "../protectedPaths/registry.js";
import { readProtectedPaths } from "../protectedPaths/registry.js";
import { stateHomePaths } from "../stateHome.js";
import { EXIT_ALLOW, EXIT_BLOCK } from "./preToolUseDispatch.js";
import { evaluateProtectedPathBash, PROTECTED_PATH_HATCH } from "./protectedPathBash.js";
import { evaluateProtectedPathTool } from "./protectedPathGuard.js";

/** What every refusal says to do instead, since the hatch is for the owner's own word and nothing else. */
const REMEDY =
  "A session never takes a path off this list to get past it. To reach one, ask the supervisor for the owner's " +
  "anchor — `slopweaver protect list` shows every protected path and why.";

/**
 * Every protected entry the given homes' registries hold, each registry file added as `read-only` — a registry that
 * cannot be read contributes only its own file.
 *
 * @param homes the Slopweaver homes whose registries apply
 * @param readText reads a file's text, `undefined` when there is none
 * @returns the entries, deduplicated by path
 */
export function protectedEntries({
  homes,
  readText,
}: {
  homes: readonly string[];
  readText: (args: { path: string }) => string | undefined;
}): readonly ProtectedPath[] {
  const entries = [...new Set(homes)].flatMap((home) => {
    const file = stateHomePaths({ home }).protectedPathsJson;
    const self: ProtectedPath = {
      addedIso: "",
      mode: "read-only",
      path: file,
      why: "the protected-path registry itself — only `slopweaver protect` changes it",
    };
    const registry = readProtectedPaths({ file, readText });
    return registry.isOk() ? [self, ...registry.value.paths] : [self];
  });
  const seen = new Set<string>();
  return entries.filter((entry) => {
    const key = `${entry.path.toLowerCase()}\u0000${entry.mode}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

/**
 * A path's resolved spelling, following a symlink — the nearest existing ancestor's real path with the rest appended
 * when the path itself does not exist yet (a `Write` creating a file). None when nothing resolves.
 *
 * @param target the absolute path as asked
 * @returns its real spelling, when it differs
 */
function realSpellings({ target }: { target: string }): readonly string[] {
  let probe = target;
  const tail: string[] = [];
  while (!existsSync(probe)) {
    const parent = dirname(probe);
    if (parent === probe) {
      return [];
    }
    tail.unshift(basename(probe));
    probe = parent;
  }
  try {
    const real = join(realpathSync(probe), ...tail);
    return real === target ? [] : [real];
  } catch {
    return [];
  }
}

/** A file's text, `undefined` when there is no file there; any other failure throws. */
function readTextOrAbsent({ path }: { path: string }): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch (cause) {
    if (isRecord(cause) && cause["code"] === "ENOENT") {
      return undefined;
    }
    throw cause;
  }
}

/** The homes whose registries apply: the environment's and the account default's. */
function liveHomes({ env }: { env: Readonly<Record<string, string | undefined>> }): readonly string[] {
  const homes = [slopweaverHomeOf({ env })];
  try {
    homes.push(accountDefaultHome());
  } catch {
    // An account with no resolvable home still applies the environment's registry.
  }
  return homes;
}

/**
 * The refusal for one hit.
 *
 * @param what what the call would have done, and where
 * @param entry the protected entry it reaches
 * @returns the four-line refusal followed by the remedy
 */
function protectedPathRefusal({ what, entry }: { what: string; entry: ProtectedPath }): string {
  const detail = `${what}, inside ${entry.path}, protected ${entry.mode}: ${entry.why}`;
  return [hatchRefusal({ detail, hatch: hatchFor({ id: "protected-path" }) }), REMEDY].join("\n");
}

/**
 * The homes whose registries apply: the injected ones when a test gives them, else the live ones.
 *
 * @param env the hook process's environment, which names the live homes
 * @param homes the injected homes, when a test gives them
 * @returns the homes to read
 */
function homesOf({
  env,
  homes,
}: {
  env: Readonly<Record<string, string | undefined>>;
  homes: readonly string[] | undefined;
}): readonly string[] {
  if (homes !== undefined) {
    return homes;
  }
  return liveHomes({ env });
}

/**
 * The registry reader: the injected one when a test gives it, else the filesystem.
 *
 * @param readText the injected reader, when a test gives one
 * @returns the reader to use
 */
function readerOf({
  readText,
}: {
  readText: ((args: { path: string }) => string | undefined) | undefined;
}): (args: { path: string }) => string | undefined {
  if (readText !== undefined) {
    return readText;
  }
  return readTextOrAbsent;
}

/**
 * Run the tripwire over one `PreToolUse` payload.
 *
 * @param readStdin reads the raw payload
 * @param writeError writes the refusal (stderr in production)
 * @param env the hook process's environment, for the hatch and the homes whose registries apply
 * @param homes the homes, given so a test reads a throwaway registry; absent, the environment's and the account's
 * @param readText reads a registry's text, given so a test needs no file; absent, the filesystem
 * @returns the exit code (2 refuse, 0 allow)
 */
export async function runProtectedPathGuard({
  readStdin,
  writeError,
  env,
  homes,
  readText,
}: {
  readStdin: () => Promise<string>;
  writeError: (line: string) => void;
  env: Readonly<Record<string, string | undefined>>;
  homes?: readonly string[];
  readText?: (args: { path: string }) => string | undefined;
}): Promise<number> {
  if (env[PROTECTED_PATH_HATCH] === "1") {
    return EXIT_ALLOW;
  }
  let payload: unknown;
  try {
    payload = JSON.parse(await readStdin());
  } catch {
    return EXIT_ALLOW;
  }
  if (!isRecord(payload) || typeof payload["tool_name"] !== "string" || !isRecord(payload["tool_input"])) {
    return EXIT_ALLOW;
  }
  const toolName = payload["tool_name"];
  const toolInput = payload["tool_input"];
  const cwd = typeof payload["cwd"] === "string" ? payload["cwd"] : undefined;
  const entries = protectedEntries({ homes: homesOf({ env, homes }), readText: readerOf({ readText }) });
  const refusal = refusalFor({ cwd, entries, env, toolInput, toolName });
  if (refusal === undefined) {
    return EXIT_ALLOW;
  }
  writeError(`${refusal}\n`);
  return EXIT_BLOCK;
}

/** The refusal one parsed call earns, or `undefined` to allow. */
function refusalFor({
  toolName,
  toolInput,
  cwd,
  entries,
  env,
}: {
  toolName: string;
  toolInput: Record<string, unknown>;
  cwd: string | undefined;
  entries: readonly ProtectedPath[];
  env: Readonly<Record<string, string | undefined>>;
}): string | undefined {
  if (toolName === "Bash") {
    const command = toolInput["command"];
    if (typeof command !== "string" || cwd === undefined) {
      return undefined;
    }
    const hit = evaluateProtectedPathBash({ command, cwd, entries, env });
    if (hit === undefined) {
      return undefined;
    }
    const verb = hit.access === "write" ? "would write" : "names";
    return protectedPathRefusal({ entry: hit.entry, what: `\`${hit.segment}\` ${verb} ${hit.operand}` });
  }
  const hit = evaluateProtectedPathTool({ cwd, entries, spellings: realSpellings, toolInput, toolName });
  if (hit === undefined) {
    return undefined;
  }
  return protectedPathRefusal({ entry: hit.entry, what: `a ${toolName} call would ${hit.access} ${hit.target}` });
}
