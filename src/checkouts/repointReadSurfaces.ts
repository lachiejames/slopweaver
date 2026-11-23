/**
 * `github repoint-plan`'s machine-surface reads: the desktop app's remembered checkout, Slopweaver's source in the
 * personal Codex marketplace, and every launch agent and daemon plist's path-bearing strings — all through the
 * injected edges, READ-ONLY. A surface that cannot be read becomes an `unreadable` fact; `./repointReaders.ts`
 * composes these into the whole gather.
 */
import { join, resolve } from "node:path";

import { errorMessage } from "#lib/errorMessage.js";
import { sha256Hex } from "#lib/hash.js";

import { CODEX_PLUGIN_NAME } from "../codexPlugin/plan.js";
import type { RepositoryRepointFacts } from "./repointModel.js";
import type { RepointReadDeps } from "./repointReaders.js";

/** The directories launchd reads agents and daemons from, user first. `~` is the user's home. */
const LAUNCH_DIRECTORIES = ["~/Library/LaunchAgents", "/Library/LaunchAgents", "/Library/LaunchDaemons"] as const;

/** The plist keys whose strings can name a checkout path. Description-like keys are not paths, so not read. */
const LAUNCH_PATH_KEYS = ["Program", "ProgramArguments", "WorkingDirectory", "EnvironmentVariables"] as const;

/** One launch agent or daemon, read or not. */
type LaunchAgentFact = RepositoryRepointFacts["launchAgents"][number];

/**
 * A JSON file's one string field at `pointer`, as a planner surface.
 *
 * @param pick finds the field in the parsed document, or says why it is not there
 * @returns `absent`, `unreadable` (unread, not JSON, or no field), or the field with the whole file's sha-256
 */
export function jsonFieldOf({
  deps,
  path,
  pick,
}: {
  deps: RepointReadDeps;
  path: string;
  pick: (input: { document: unknown }) => { readonly pointer: string; readonly value: string } | string;
}): RepositoryRepointFacts["desktop"] {
  const read = deps.readText({ path });
  if (read.isErr()) {
    return { kind: "unreadable", path, why: read.error };
  }
  if (read.value === null) {
    return { kind: "absent", path };
  }
  let document: unknown;
  try {
    document = JSON.parse(read.value);
  } catch (error: unknown) {
    return { kind: "unreadable", path, why: `not JSON: ${errorMessage({ error })}` };
  }
  const picked = pick({ document });
  if (typeof picked === "string") {
    return { kind: "unreadable", path, why: picked };
  }
  return { kind: "read", path, pointer: picked.pointer, sha256: sha256Hex({ bytes: read.value }), value: picked.value };
}

/**
 * The desktop app's remembered checkout.
 *
 * @returns the `/checkout` pointer and its string value, or why the state names none
 */
export function desktopPick({
  document,
}: {
  document: unknown;
}): { readonly pointer: string; readonly value: string } | string {
  if (typeof document !== "object" || document === null || !("checkout" in document)) {
    return "the desktop state names no checkout";
  }
  const checkout = document.checkout;
  return typeof checkout === "string" ? { pointer: "/checkout", value: checkout } : "its checkout is not a string";
}

/**
 * Slopweaver's local source in the personal Codex marketplace, resolved against the user's home.
 *
 * @returns the source path's pointer and its absolute value, or why the marketplace carries no local source
 */
export function marketplacePick({
  document,
  userHome,
}: {
  document: unknown;
  userHome: string;
}): { readonly pointer: string; readonly value: string } | string {
  if (
    typeof document !== "object" ||
    document === null ||
    !("plugins" in document) ||
    !Array.isArray(document.plugins)
  ) {
    return "the marketplace lists no plugins array";
  }
  const plugins: readonly unknown[] = document.plugins;
  const index = plugins.findIndex(
    (plugin) => typeof plugin === "object" && plugin !== null && "name" in plugin && plugin.name === CODEX_PLUGIN_NAME,
  );
  const entry = plugins[index];
  if (index < 0 || typeof entry !== "object" || entry === null || !("source" in entry)) {
    return `the marketplace lists no ${CODEX_PLUGIN_NAME} plugin`;
  }
  const source = entry.source;
  if (typeof source !== "object" || source === null || !("path" in source) || typeof source.path !== "string") {
    return `its ${CODEX_PLUGIN_NAME} source is not a local path`;
  }
  return { pointer: `/plugins/${String(index)}/source/path`, value: resolve(userHome, source.path) };
}

/** Every string under the path keys of one decoded plist, with the key path that reaches it. */
function plistStrings({
  document,
}: {
  document: unknown;
}): readonly { readonly keyPath: readonly string[]; readonly value: string }[] {
  const found: { keyPath: readonly string[]; value: string }[] = [];
  const visit = ({ value, keyPath }: { value: unknown; keyPath: readonly string[] }): void => {
    if (typeof value === "string") {
      found.push({ keyPath, value });
    } else if (Array.isArray(value)) {
      const items: readonly unknown[] = value;
      for (const [index, item] of items.entries()) {
        visit({ keyPath: [...keyPath, String(index)], value: item });
      }
    } else if (typeof value === "object" && value !== null) {
      for (const [key, item] of Object.entries(value)) visit({ keyPath: [...keyPath, key], value: item });
    }
  };
  if (typeof document === "object" && document !== null) {
    // Read in LAUNCH_PATH_KEYS order, never the document's, so the plan lists a plist's strings the same way each run.
    const entries = new Map<string, unknown>(Object.entries(document));
    for (const key of LAUNCH_PATH_KEYS) {
      if (entries.has(key)) {
        visit({ keyPath: [key], value: entries.get(key) });
      }
    }
  }
  return found;
}

/** One plist decoded, its digest and its path strings, or why plutil could not decode it. */
function launchAgentOf({ deps, path }: { deps: RepointReadDeps; path: string }): LaunchAgentFact {
  const decoded = deps.convertPlist({ path });
  const bytes = deps.readText({ path });
  if (decoded.isErr()) {
    return { kind: "unreadable", path, why: decoded.error };
  }
  // A binary plist is not UTF-8, so its digest is taken over what plutil decoded; an apply step re-decodes it.
  const digestSource = bytes.isOk() && bytes.value !== null ? bytes.value : JSON.stringify(decoded.value);
  return {
    kind: "read",
    path,
    sha256: sha256Hex({ bytes: digestSource }),
    strings: plistStrings({ document: decoded.value }),
  };
}

/** Every plist in one launch directory, sorted by name, or the directory as unreadable. */
function launchDirectoryAgents({
  deps,
  directory,
}: {
  deps: RepointReadDeps;
  directory: string;
}): readonly LaunchAgentFact[] {
  const names = deps.listDirectory({ path: directory });
  if (names.isErr()) {
    return [{ kind: "unreadable", path: directory, why: names.error }];
  }
  if (names.value === null) {
    return [];
  }
  return names.value
    .filter((entry) => entry.endsWith(".plist"))
    .toSorted()
    .map((name) => launchAgentOf({ deps, path: join(directory, name) }));
}

/**
 * Every launch agent and daemon plist, decoded, or why one could not be.
 *
 * @returns each directory's plists in `LAUNCH_DIRECTORIES` order, user directory first
 */
export function launchAgentsOf({ deps }: { deps: RepointReadDeps }): RepositoryRepointFacts["launchAgents"] {
  return LAUNCH_DIRECTORIES.flatMap((spelled) =>
    launchDirectoryAgents({
      deps,
      directory: spelled.startsWith("~/") ? join(deps.userHome, spelled.slice(2)) : spelled,
    }),
  );
}
