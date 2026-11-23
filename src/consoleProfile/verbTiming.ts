/**
 * The verbs behind the reads, each timed alone through the console's own route, and the launcher's start-up floor
 * every one of them pays before it does any work.
 */
import { spawnSync } from "node:child_process";
import { join } from "node:path";

import { installedTreeRoot } from "../lib/pluginRoot.js";
import { nowEpoch } from "./pageProbe.js";
import { SETTLE_CAP_MS } from "./readLedger.js";
import { type VerbSample, verbSampleOf } from "./report.js";

/**
 * How long the launcher-floor probe (`perf console --help`) may run before it is killed. The same `bin/slopweaver`
 * launch took 35.6s on a loaded machine (`hooks/lib/seat-pass.sh`, load1 45–55 on 15 cores), node boot being
 * the cost; two minutes is over three times that, and a killed probe reads as no floor, exactly as a non-zero
 * exit does. SIGKILL, because a child that traps the default SIGTERM would outlive the bound.
 */
const LAUNCHER_FLOOR_TIMEOUT_MS = 2 * 60_000;

/**
 * The verb slug a live read names: `/api/live/board` is `board`.
 *
 * @param path the read's path
 * @returns the slug, or the path unchanged when it is not a live read
 */
export function liveSlugOf({ path }: { path: string }): string {
  return path.replace(/^\/api\/live\//u, "");
}

/**
 * Time each read the walk saw, one request at a time, each in its own child process, through the console's own
 * route — so the number is the verb exactly as the console runs it, minus the contention of a page asking for seven
 * at once. Not minus everything: the machine's own load stands (the report prints it), and a child the route keeps
 * running past {@link SETTLE_CAP_MS} — the route has no abort wiring, and a verb's own timeout can be longer — runs on
 * beside the rows timed after it. That read is printed late, never as a duration, so a late row in the table marks
 * the rows after it as possibly contended.
 *
 * @param base the console's origin
 * @param paths every `/api/live/*` path the walk saw
 * @returns one sample per path
 */
export async function timeVerbs({
  base,
  paths,
}: {
  base: string;
  paths: readonly string[];
}): Promise<readonly VerbSample[]> {
  const samples: VerbSample[] = [];
  for (const path of paths) {
    samples.push(await timeVerb({ base, path }));
  }
  return samples;
}

/**
 * Time one read alone through the route: its duration, or why there is none. The body is judged by the same strict
 * `LiveResult` boundary as a page's reads (`liveReadFailure`, `./report.ts`), so the two never disagree on a reading.
 */
async function timeVerb({ base, path }: { base: string; path: string }): Promise<VerbSample> {
  const started = nowEpoch();
  const slug = liveSlugOf({ path });
  // Held to the same cap as a page's reads: an answer after it is no answer, never a time.
  const late = `no answer within the ${String(SETTLE_CAP_MS)} ms settle cap`;
  try {
    // `fresh=1` so the route starts this read's own child rather than riding one still under way from the walk
    // (`site/lib/liveFlights.ts`). A route without flights ignores the parameter.
    const response = await fetch(`${base}${path}?fresh=1`, { signal: AbortSignal.timeout(SETTLE_CAP_MS) });
    const text = await response.text();
    const ms = nowEpoch() - started;
    if (ms > SETTLE_CAP_MS) {
      return { failed: late, ms: undefined, slug };
    }
    return verbSampleOf({ ms, slug, status: response.status, text });
  } catch (error) {
    return { failed: fetchFailure({ error, late }), ms: undefined, slug };
  }
}

/** Why a timed read threw: the settle cap's own sentence for its timeout, else what was thrown. */
function fetchFailure({ error, late }: { error: unknown; late: string }): string {
  if (!(error instanceof Error)) {
    return String(error);
  }
  return error.name === "TimeoutError" ? late : error.message;
}

/**
 * Process start-up with no verb module loaded: this checkout's own launcher answering `--help`, quiet, as the
 * console's route spawns it. The floor every read in the verbs table pays before it does any work.
 *
 * @returns the wall time, or `undefined` when the launcher did not exit cleanly
 */
export function launcherFloorMs(): number | undefined {
  // The tree this build lives in, not git's answer for it: an installed mirror carries no `.git` (`running-checkout-root`).
  const root = installedTreeRoot({ importMetaUrl: import.meta.url });
  const started = nowEpoch();
  const ran = spawnSync(join(root, "bin", "slopweaver"), ["perf", "console", "--help"], {
    encoding: "utf8",
    env: { ...process.env, SLOPWEAVER_LAUNCHER_QUIET: "1" },
    killSignal: "SIGKILL",
    timeout: LAUNCHER_FLOOR_TIMEOUT_MS,
  });
  if (ran.status !== 0) {
    return undefined;
  }
  return nowEpoch() - started;
}
