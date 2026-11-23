/**
 * What one invocation of a built CLI does before any verb: run, refuse, or — for a console child that met a rebuild
 * in flight — restart on the fresh build. The staleness judgement is `./guard.ts`'s; the wait is
 * `./consoleRebuildWait.ts`'s; this module is the order between them, which is the part a test has to pin.
 *
 * The order is load-bearing: an open `SLOPWEAVER_ALLOW_STALE_BUILD` is honoured inside `guardBuiltTree`, before
 * anything here can wait, so the console marker can neither close nor delay the hatch. Only a refusal carrying
 * `staleManifestText` — a valid manifest over a checkout that is there — is ever waited out, and only a rebuild of
 * THAT checkout ends the wait.
 */
import { closeSync, constants, existsSync, fstatSync, openSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  CONSOLE_CHILD_ENV,
  CONSOLE_REBUILD_WAIT_MS,
  type RebuildWaitSeams,
  waitForFreshBuild,
} from "./consoleRebuildWait.js";
import { guardBuiltTree, hatchIsOpen, STALE_BUILD_ENV } from "./guard.js";
import { scanSourceStamps } from "./sourceScan.js";
import { BUILD_MANIFEST_FILE, parseBuildManifest, stalenessOf } from "./staleness.js";

/**
 * The line a console child prints the moment it starts waiting, before the wait's first manifest read — so a rebuild
 * landing after it is one this wait sees, never one the first judgement already read as fresh.
 */
export const WAITING_LINE = `slopweaver: [stale-build] this build is stale; this console read waits up to ${String(CONSOLE_REBUILD_WAIT_MS / 1000)}s for a rebuild to land.`;

/** What the process does next. */
type GuardDisposition = "run" | "refuse" | "restart";

/** The disposition, and the lines to print before acting on it. */
export interface InvocationGuard {
  readonly disposition: GuardDisposition;
  readonly lines: readonly string[];
}

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
 * Judge one invocation, waiting out a rebuild in flight when, and only when, a console child met one.
 *
 * @param builtRoot the built tree's own directory, absolute
 * @param env the process environment — the hatch and the console marker are both read from it
 * @param waitSeams the wait's clock, pause, manifest read and judgement
 * @param announce prints {@link WAITING_LINE} BEFORE a console child waits, so a wait of up to 30s is never silent
 *   and a watcher can tell a wait from a hang
 * @returns run, refuse or restart, with the lines that say so
 */
export async function guardInvocation({
  announce,
  builtRoot,
  env,
  waitSeams,
}: {
  announce: (line: string) => void;
  builtRoot: string;
  env: NodeJS.ProcessEnv;
  waitSeams: RebuildWaitSeams;
}): Promise<InvocationGuard> {
  const outcome = guardBuiltTree({ builtRoot, hatchOpen: hatchIsOpen({ value: env[STALE_BUILD_ENV] }) });
  if (!outcome.refuse) {
    return { disposition: "run", lines: outcome.lines };
  }
  const judgedText = outcome.staleManifestText;
  if (judgedText === undefined || !hatchIsOpen({ value: env[CONSOLE_CHILD_ENV] })) {
    return { disposition: "refuse", lines: outcome.lines };
  }
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
