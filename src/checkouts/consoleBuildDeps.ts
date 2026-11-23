/**
 * The seams `checkout console`'s reader stands on (`./consoleBuildRead.ts`): git, `ps`, and the files beside the
 * console's run record — the fetch claims and the `fetched` stamp. Every one answers `undefined` or `false` rather
 * than throwing, so a failed read reaches the reader as evidence it names, never as a crash.
 */
import { execFileSync } from "node:child_process";
import {
  closeSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

import { INSTALLED_BUNDLE } from "../desktop/installPlan.js";
import { gitEnv } from "../lib/gitRepo.js";
import { claimBucketOf } from "./consoleBuild.js";
import { type CheckoutInspectDeps, productionInspectDeps } from "./inspect.js";
import type { InstalledPlistRead } from "./installedApp.js";

/**
 * How long the fetch may block. The console's fast lane gives the whole verb twenty seconds, so a hung remote
 * must give up well inside that and leave the reading to the refs already on disk.
 */
const FETCH_TIMEOUT_MS = 10_000;

/** How long a `ps` of one pid may take. */
const PS_TIMEOUT_MS = 5_000;

/** The seams a reading needs, injected so a test drives the reader without a network or a process table. */
export interface ConsoleBuildDeps extends CheckoutInspectDeps {
  /** One file's text, or `undefined` when it cannot be read. */
  readonly readText: (args: { path: string }) => string | undefined;
  /** A process's argument line, or `undefined` when no such process is running. */
  readonly processArgs: (args: { pid: number }) => string | undefined;
  /** Fetch one refspec from one remote; `undefined` on success, else why it failed. */
  readonly fetch: (args: { cwd: string; remote: string; refspec: string }) => string | undefined;
  /** Create a claim file exclusively, making its directory first; true when this caller created it. */
  readonly claim: (args: { path: string }) => boolean;
  /** Write the decision into a claim this caller holds. */
  readonly markClaim: (args: { path: string; decision: string }) => void;
  /** Remove every claim in a directory whose minute bucket is below `below`. */
  readonly sweepClaims: (args: { dir: string; below: number }) => void;
  /** Stamp a successful fetch of `upstream`: its modification time becomes the instant that upstream was fetched. */
  readonly stampFetched: (args: { path: string; upstream: string }) => void;
  /** The installed desktop app's `Info.plist`: absent when no app is installed, failed when one is but will not read. */
  readonly installedPlist: () => InstalledPlistRead;
}

/**
 * The first line of why a `git fetch` failed. A failure must never read as success, and `undefined` IS success
 * to the reader — so an empty first line is named rather than passed on.
 *
 * @param cause what `execFileSync` threw
 * @returns a non-empty sentence
 */
function fetchFailure({ cause }: { cause: unknown }): string {
  const [first] = (cause instanceof Error ? cause.message : String(cause)).split("\n");
  if (first === undefined || first.trim() === "") {
    return "git fetch failed and printed nothing";
  }
  return first;
}

/**
 * Whether a throw is "no such file or directory".
 *
 * @returns true for `ENOENT`
 */
function isMissing({ cause }: { cause: unknown }): boolean {
  return cause instanceof Error && "code" in cause && cause.code === "ENOENT";
}

/**
 * Read an app bundle's `Info.plist`, keeping no app apart from one that is there and will not read — only the first
 * is a normal machine; the second is evidence the sidebar names.
 *
 * @param bundle the `.app` directory
 * @returns absent, its text, or why it failed
 */
export function readInstalledPlist({ bundle }: { bundle: string }): InstalledPlistRead {
  try {
    return { kind: "read", text: readFileSync(join(bundle, "Contents", "Info.plist"), "utf8") };
  } catch (cause) {
    // Only "no such file" is absence: `existsSync` answers false for a parent it may not search, too, which would
    // read an app that is there and will not read as no app at all.
    if (!isMissing({ cause })) {
      return { kind: "failed", why: cause instanceof Error ? cause.message : String(cause) };
    }
  }
  // And only of the whole bundle: one that is there with no plist is a broken app, never none.
  try {
    statSync(bundle);
    return { kind: "failed", why: `${bundle} has no Contents/Info.plist` };
  } catch (cause) {
    if (isMissing({ cause })) {
      return { kind: "absent" };
    }
    return { kind: "failed", why: cause instanceof Error ? cause.message : String(cause) };
  }
}

/**
 * The claim-and-stamp seams alone — every file the reader writes beside the run record. Split from the process
 * seams so a test round-trips them in a temp directory.
 *
 * @returns the file half of {@link ConsoleBuildDeps}
 */
export function consoleBuildFileDeps(): Pick<
  ConsoleBuildDeps,
  "readText" | "claim" | "markClaim" | "sweepClaims" | "stampFetched"
> {
  return {
    claim: ({ path }) => {
      try {
        mkdirSync(dirname(path), { recursive: true });
        closeSync(openSync(path, "wx"));
        return true;
      } catch {
        return false;
      }
    },
    markClaim: ({ path, decision }) => {
      try {
        writeFileSync(path, decision);
      } catch {
        // An unmarked claim reads as undecided, which holds the next minute off once and no longer.
      }
    },
    readText: ({ path }) => {
      try {
        return readFileSync(path, "utf8");
      } catch {
        return undefined;
      }
    },
    stampFetched: ({ path, upstream }) => {
      try {
        writeFileSync(path, upstream);
      } catch {
        // An unwritten stamp leaves the last one standing: the fetch is due again, and "latest" ages out.
      }
    },
    sweepClaims: ({ dir, below }) => {
      let names: string[];
      try {
        names = readdirSync(dir);
      } catch {
        return;
      }
      for (const name of names) {
        const bucket = claimBucketOf({ name });
        if (bucket === undefined || bucket >= below) {
          continue;
        }
        try {
          unlinkSync(join(dir, name));
        } catch {
          // Another reading swept it first: the same outcome.
        }
      }
    },
  };
}

/**
 * The real seams: git, `ps`, the filesystem.
 *
 * @returns the production {@link ConsoleBuildDeps}
 */
export function productionConsoleBuildDeps(): ConsoleBuildDeps {
  return {
    ...productionInspectDeps(),
    ...consoleBuildFileDeps(),
    fetch: ({ cwd, remote, refspec }) => {
      try {
        // `--no-write-fetch-head`: the reader never reads FETCH_HEAD, and a checkout's own tools might.
        execFileSync("git", ["fetch", "--quiet", "--no-write-fetch-head", remote, refspec], {
          cwd,
          env: gitEnv(),
          stdio: ["ignore", "pipe", "pipe"],
          timeout: FETCH_TIMEOUT_MS,
        });
        return undefined;
      } catch (cause) {
        return fetchFailure({ cause });
      }
    },
    installedPlist: () => readInstalledPlist({ bundle: INSTALLED_BUNDLE }),
    processArgs: ({ pid }) => {
      try {
        const args = execFileSync("ps", ["-o", "args=", "-p", String(pid)], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
          timeout: PS_TIMEOUT_MS,
        }).trim();
        return args === "" ? undefined : args;
      } catch {
        return undefined;
      }
    },
  };
}
