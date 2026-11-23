/**
 * `github repoint-plan`'s reads: every fact `./repointPlan.ts` decides from, gathered READ-ONLY. Nothing here
 * writes, loads a launch agent or opens an app; each surface that cannot be read becomes an `unreadable` fact,
 * which the planner turns into an unresolved item rather than a silent omission.
 *
 * The readers are injected so a test drives the whole gather over a fixture with no mock. The surfaces are read in
 * siblings over the injected edges — git in `./repointReadGit.ts`, the desktop state, Codex marketplace and launch
 * plists in `./repointReadSurfaces.ts`, the state home's links in `./repointReadLinks.ts` — and this module holds
 * the gather, the profile read, and the production edges at the bottom: strict UTF-8 file reads
 * (`#lib/presentFile.js`), the transport's bounded Git reader, `listAuthoredFiles` for the state home (it already
 * refuses credentials, derived corpora and scratch), and `/usr/bin/plutil -convert json` for a plist, exactly as
 * `src/store/backup/darwinVolume.ts` decodes one.
 *
 * The desktop app's state path is the conventional macOS one for the product name `Slopweaver`
 * (`desktop/package.json`); the desktop project's own `statePath()` needs Electron, so it is not importable here.
 * A customised user-data directory is therefore missed, and the observation says which path was read.
 */
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { errorMessage } from "#lib/errorMessage.js";
import { sha256Hex } from "#lib/hash.js";
import { readStrictFileIfPresent } from "#lib/presentFile.js";
import { err, ok, type Result } from "#lib/result.js";

import { readGit } from "../admit/gitTransport.js";
import { pushRootForRepository } from "../admit/pushRootRegistry.js";
import { readPushRootState } from "../admit/pushRootStore.js";
import { PERSONAL_MARKETPLACE_RELATIVE } from "../codexPlugin/plan.js";
import { stateHomePaths } from "../stateHome.js";
import { type AuthoredListing, listAuthoredFiles } from "../store/fleet/authoredFiles.js";
import type { RepositoryRepointFacts, RepositoryRepointRequest } from "./repointModel.js";
import { checkoutFactsOf, newCheckoutFactsOf } from "./repointReadGit.js";
import { linksOf } from "./repointReadLinks.js";
import { desktopPick, jsonFieldOf, launchAgentsOf, marketplacePick } from "./repointReadSurfaces.js";

/** The edges the gather touches. */
export interface RepointReadDeps {
  /** A strict UTF-8 read: the text, `null` when absent, or why it could not be read. */
  readonly readText: (input: { path: string }) => Result<string | null, string>;
  /**
   * The file's bytes, one character per byte (latin1), or `undefined` when it cannot be read: how a file that is not
   * UTF-8 is still searched for an ASCII link, since latin1 decodes every byte sequence.
   */
  readBytesAsLatin1: (input: { path: string }) => string | undefined;
  /** Bytes on disk, or `undefined` when the path cannot be stat'ed. */
  readonly sizeOf: (input: { path: string }) => number | undefined;
  readonly readGit: (input: { cwd: string; args: readonly string[] }) => string;
  readonly listAuthoredFiles: (input: { home: string }) => AuthoredListing;
  /** A directory's entry names, `null` when absent, or why it could not be listed. */
  readonly listDirectory: (input: { path: string }) => Result<readonly string[] | null, string>;
  /** A plist decoded to JSON, or why it could not be. */
  readonly convertPlist: (input: { path: string }) => Result<unknown, string>;
  /** The user's home directory, where the desktop state, the Codex marketplace and user launch agents live. */
  readonly userHome: string;
  readonly now: () => Date;
}

/** `profile.json`'s `mainCheckouts[].path`, in order, or why the document does not carry them. */
function profileMainCheckouts({ text }: { text: string }): readonly string[] | string {
  let document: unknown;
  try {
    document = JSON.parse(text);
  } catch (error: unknown) {
    return `not JSON: ${errorMessage({ error })}`;
  }
  if (typeof document !== "object" || document === null || !("mainCheckouts" in document)) {
    return [];
  }
  const list = document.mainCheckouts;
  if (!Array.isArray(list)) {
    return "mainCheckouts is not an array";
  }
  const paths: string[] = [];
  for (const entry of list as readonly unknown[]) {
    if (typeof entry !== "object" || entry === null || !("path" in entry) || typeof entry.path !== "string") {
      return "a mainCheckouts entry carries no path";
    }
    paths.push(entry.path);
  }
  return paths;
}

/** The profile as a surface: absent, unreadable, or read with its declared main checkouts. */
function profileFactsOf({ deps, home }: { deps: RepointReadDeps; home: string }): RepositoryRepointFacts["profile"] {
  const profilePath = stateHomePaths({ home }).profileJson;
  const profileText = deps.readText({ path: profilePath });
  if (profileText.isErr()) {
    return { kind: "unreadable", path: profilePath, why: profileText.error };
  }
  if (profileText.value === null) {
    return { kind: "absent", path: profilePath };
  }
  const parsed = profileMainCheckouts({ text: profileText.value });
  if (typeof parsed === "string") {
    return { kind: "unreadable", path: profilePath, why: parsed };
  }
  return { kind: "read", mainCheckouts: parsed, path: profilePath, sha256: sha256Hex({ bytes: profileText.value }) };
}

/**
 * Gather every fact the planner decides from, writing nothing.
 *
 * @param request the repository, the archive's name and the fresh checkout, when given
 * @param home the state home: its profile, push-root register and authored files
 * @param deps the read edges
 * @returns the facts, or why the push-root register or profile cannot be trusted at all
 */
export function readRepositoryRepointFacts({
  request,
  home,
  deps,
}: {
  request: RepositoryRepointRequest;
  home: string;
  deps: RepointReadDeps;
}): Result<RepositoryRepointFacts, string> {
  const roots = readPushRootState({ home });
  if (roots.isErr()) {
    return err(roots.error.message);
  }
  const binding =
    roots.value.kind === "absent"
      ? undefined
      : pushRootForRepository({ registry: roots.value.registry, repository: request.repository });
  const profile = profileFactsOf({ deps, home });
  const mainCheckouts: readonly string[] = profile.kind === "read" ? profile.mainCheckouts : [];
  return ok({
    checkouts: mainCheckouts.map((path) => checkoutFactsOf({ deps, path })),
    desktop: jsonFieldOf({
      deps,
      path: join(deps.userHome, "Library/Application Support/Slopweaver/state.json"),
      pick: desktopPick,
    }),
    generatedAtIso: deps.now().toISOString(),
    launchAgents: launchAgentsOf({ deps }),
    marketplace: jsonFieldOf({
      deps,
      path: join(deps.userHome, PERSONAL_MARKETPLACE_RELATIVE),
      pick: ({ document }) => marketplacePick({ document, userHome: deps.userHome }),
    }),
    newCheckout: newCheckoutFactsOf({ deps, path: request.newCheckout }),
    profile,
    pushRoot: binding === undefined ? null : binding.rootSha,
    ...linksOf({ deps, home, request }),
  });
}

/**
 * The production read edges.
 *
 * @returns strict file reads, the transport's Git reader, the authored-state walk, `plutil`, the user's home and the clock
 */
export function productionRepointReadDeps(): RepointReadDeps {
  return {
    convertPlist: ({ path }) => {
      try {
        const json = execFileSync("/usr/bin/plutil", ["-convert", "json", "-o", "-", "--", path], {
          encoding: "utf8",
          killSignal: "SIGKILL",
          stdio: ["ignore", "pipe", "pipe"],
          timeout: 30_000,
        });
        return ok(JSON.parse(json) as unknown);
      } catch (error: unknown) {
        return err(`plutil could not decode it: ${errorMessage({ error })}`);
      }
    },
    listAuthoredFiles,
    listDirectory: ({ path }) => {
      try {
        return ok(readdirSync(path));
      } catch (error: unknown) {
        const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
        return code === "ENOENT" ? ok(null) : err(`could not list it: ${errorMessage({ error })}`);
      }
    },
    now: () => new Date(),
    readBytesAsLatin1: ({ path }) => {
      try {
        // Bounded by the caller's size check: only a file under the link-scan bound reaches here.
        return readFileSync(path, "latin1");
      } catch {
        return undefined;
      }
    },
    readGit,
    readText: ({ path }) => {
      const read = readStrictFileIfPresent({ operation: "repointPlan", path });
      return read.isErr() ? err(read.error.message) : ok(read.value);
    },
    sizeOf: ({ path }) => {
      try {
        return statSync(path).size;
      } catch {
        return undefined;
      }
    },
    userHome: homedir(),
  };
}
