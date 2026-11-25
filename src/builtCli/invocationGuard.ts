/**
 * What one invocation of a built CLI does before any verb: run; restart on its checkout's source; for a console child
 * that met a rebuild in flight, restart on the fresh build; or refuse. The staleness judgement is `./guard.ts`'s; the
 * wait is `./consoleRebuildWait.ts`'s; the source restart is `./sourceRestart.ts`'s; this module is the order between
 * them, which is the part a test has to pin.
 *
 * The order is load-bearing:
 *
 * 1. An open `SLOPWEAVER_ALLOW_STALE_BUILD` is honoured inside `guardBuiltTree`, before anything here, so neither the
 *    console marker nor the source restart can close or delay the hatch.
 * 2. Only a refusal carrying `staleSource` — a valid manifest over a checkout that is there — goes anywhere but a
 *    refusal. An unreadable manifest or a vanished checkout refuses as it stands.
 * 3. A process already running source (`runsFromSource`, `./guard.ts`) refuses as it stands, console child or not:
 *    it neither restarts on source nor waits to restart on a build, so no restart can loop.
 * 4. A console child waits that refusal out, exactly as before, and only a rebuild of THAT checkout ends the wait.
 * 5. A verb that needs the built tree itself (`./sourceFallbackPolicy.ts`) refuses as it stands.
 * 6. Every other caller restarts on the checkout's source when that source can run there, and refuses as it stands
 *    when it cannot — the refusal's lines never change, so the remedy it names is the same either way.
 */
import { closeSync, constants, existsSync, fstatSync, openSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Result } from "#lib/result.js";
import {
  CONSOLE_CHILD_ENV,
  CONSOLE_REBUILD_WAIT_MS,
  type RebuildWaitSeams,
  waitForFreshBuild,
} from "./consoleRebuildWait.js";
import { guardBuiltTree, hatchIsOpen, STALE_BUILD_ENV } from "./guard.js";
import { sourceFallbackAllowed } from "./sourceFallbackPolicy.js";
import type { SourceLaunch, SourceLaunchError } from "./sourceRestart.js";
import { scanSourceStamps } from "./sourceScan.js";
import { BUILD_MANIFEST_FILE, parseBuildManifest, stalenessOf } from "./staleness.js";

/**
 * The line a console child prints the moment it starts waiting, before the wait's first manifest read — so a rebuild
 * landing after it is one this wait sees, never one the first judgement already read as fresh.
 */
export const WAITING_LINE = `slopweaver: [stale-build] this build is stale; this console read waits up to ${String(CONSOLE_REBUILD_WAIT_MS / 1000)}s for a rebuild to land.`;

/**
 * The ONE line a source restart prints, to stderr, every time: which checkout, that its build is behind and why, that
 * its source is what runs, and what restores the fast path. Stdout is the verb's alone.
 *
 * @param root the checkout whose source runs
 * @param why the first difference, as the staleness judgement words it
 * @returns the line
 */
export function sourceFallbackLine({ root, why }: { root: string; why: string }): string {
  return `slopweaver: [stale-build] ${root}: the build is behind (${why}); running this checkout's source; \`slopweaver dev build\` restores the fast path.`;
}

/** The disposition, and the lines to print before acting on it. A source restart carries the checkout it runs. */
export type InvocationGuard =
  | { readonly disposition: "run" | "refuse" | "restart"; readonly lines: readonly string[] }
  | { readonly disposition: "source"; readonly lines: readonly [string]; readonly source: SourceLaunch };

/**
 * Wait seams that judge a replacement fresh only when it names the checkout the stale manifest named — one the
 * guard just found standing — so a replacement naming any other directory is never fresh: an existing non-checkout
 * scans empty and would match empty stamps.
 *
 * @param judgedText the stale manifest's text, which must parse
 * @param seams the seams to pin
 * @returns the pinned seams
 */
export function pinnedToJudgedRoot({
  judgedText,
  seams,
}: {
  judgedText: string;
  seams: RebuildWaitSeams;
}): RebuildWaitSeams {
  const judgedRoot = parseBuildManifest({ text: judgedText })!.root;
  return {
    ...seams,
    isFresh: ({ text }) => parseBuildManifest({ text })?.root === judgedRoot && seams.isFresh({ text }),
  };
}

/**
 * Judge one invocation: run a fresh build, restart a stale one on its checkout's source, wait out a rebuild in flight
 * when, and only when, a console child met one, or refuse.
 *
 * @param announce prints {@link WAITING_LINE} BEFORE a console child waits, so a wait of up to 30s is never silent
 *   and a watcher can tell a wait from a hang
 * @param argv the canonical process argv, whose noun and verb say whether the verb needs the built tree itself
 * @param builtRoot the built tree's own directory, absolute
 * @param env the process environment — the hatch and the console marker are both read from it
 * @param fromSource whether THIS process already runs TypeScript source (`runsFromSource`, `./guard.ts`); a source run never
 *   restarts on source again nor waits to restart on a build, whatever manifest sits where it looks, so no restart
 *   can loop
 * @param sourceLaunch whether the stale manifest's checkout can run its own source; production passes
 *   `productionSourceLaunch`
 * @param waitSeams the wait's clock, pause, manifest read and judgement
 * @returns run, source, restart or refuse, with the lines that say so
 */
export async function guardInvocation({
  announce,
  argv,
  builtRoot,
  env,
  fromSource,
  sourceLaunch,
  waitSeams,
}: {
  announce: (line: string) => void;
  argv: readonly string[];
  builtRoot: string;
  env: NodeJS.ProcessEnv;
  fromSource: boolean;
  sourceLaunch: (options: { root: string }) => Result<SourceLaunch, SourceLaunchError>;
  waitSeams: RebuildWaitSeams;
}): Promise<InvocationGuard> {
  const outcome = guardBuiltTree({ builtRoot, hatchOpen: hatchIsOpen({ value: env[STALE_BUILD_ENV] }) });
  if (!outcome.refuse) {
    return { disposition: "run", lines: outcome.lines };
  }
  const stale = outcome.staleSource;
  // A source run neither restarts on source nor waits to restart on a build: a stale manifest where it looks (beside
  // `src/`, only ever written by an `--out` naming that directory) draws the plain refusal, console child or not.
  if (stale === undefined || fromSource) {
    return { disposition: "refuse", lines: outcome.lines };
  }
  if (!hatchIsOpen({ value: env[CONSOLE_CHILD_ENV] })) {
    if (!sourceFallbackAllowed({ argv })) {
      return { disposition: "refuse", lines: outcome.lines };
    }
    const launch = sourceLaunch({ root: stale.root });
    if (launch.isErr()) {
      return { disposition: "refuse", lines: outcome.lines };
    }
    return {
      disposition: "source",
      lines: [sourceFallbackLine({ root: stale.root, why: stale.why })],
      source: launch.value,
    };
  }
  const judgedText = stale.manifestText;
  announce(WAITING_LINE);
  const waited = await waitForFreshBuild({ judgedText, seams: pinnedToJudgedRoot({ judgedText, seams: waitSeams }) });
  if (waited.kind === "fresh") {
    return {
      disposition: "restart",
      lines: [
        `slopweaver: [stale-build] a rebuild landed ${String(waited.waitedMs)}ms into this console read — restarting on the fresh build.`,
      ],
    };
  }
  return {
    disposition: "refuse",
    lines: [
      `slopweaver: [stale-build] this console read waited ${String(CONSOLE_REBUILD_WAIT_MS / 1000)}s for a rebuild, and no fresh build landed.`,
      ...outcome.lines,
    ],
  };
}

/**
 * Whether a manifest's text describes a finished build of the source as it stands now: it parses, its checkout is
 * there, and not one stamp differs.
 *
 * @param text the manifest's text
 * @returns true for a fresh build
 */
function manifestIsFresh({ text }: { text: string }): boolean {
  const manifest = parseBuildManifest({ text });
  if (manifest === undefined || !existsSync(manifest.root)) {
    return false;
  }
  try {
    // `stalenessOf` reads a path recorded more than once as stale, for this judgement and the first guard's alike.
    return !stalenessOf({ current: scanSourceStamps({ root: manifest.root }), manifest }).stale;
  } catch {
    // A root gone between the check above and the scan, or one that is no directory, is NOT YET like an unreadable
    // manifest: the wait's own deadline ends it, never a throw out of the poll.
    return false;
  }
}

/**
 * The real wait: the wall clock, a timer, and the manifest beside the built tree.
 *
 * A manifest that cannot be read is NOT YET, never a verdict: `dev build` deletes it before it emits, so a read
 * racing that delete is the build in progress, and the wait's own deadline is what ends a wait that never sees one.
 *
 * @param builtRoot the built tree's own directory, absolute
 * @returns the seams {@link guardInvocation} waits with
 */
export function productionWaitSeams({ builtRoot }: { builtRoot: string }): RebuildWaitSeams {
  const manifestPath = join(builtRoot, BUILD_MANIFEST_FILE);
  return {
    isFresh: manifestIsFresh,
    // Monotonic, so a wall-clock correction mid-wait can neither stretch nor cut the 30s bound.
    nowMs: () => performance.now(),
    pause: ({ ms }) =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, ms);
      }),
    readManifest: () => {
      // Only a regular file is read, and the check is on the descriptor that is read: a FIFO or a device would block
      // a synchronous read past the wait's deadline, so the open never blocks and a swap after it reads nothing new.
      let fd: number | undefined;
      try {
        fd = openSync(manifestPath, constants.O_RDONLY | constants.O_NONBLOCK);
        if (!fstatSync(fd).isFile()) {
          return undefined;
        }
        return readFileSync(fd, "utf8");
      } catch {
        return undefined;
      } finally {
        if (fd !== undefined) {
          closeSync(fd);
        }
      }
    },
  };
}
