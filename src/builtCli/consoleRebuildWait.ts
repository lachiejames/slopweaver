/**
 * A console read that meets a stale build WAITS for the rebuild a pull starts, then restarts on the fresh one.
 *
 * MEASURED: the main checkout fast-forwarded, and 27 s later the owner opened a briefing from its
 * Queue card. Every console page's root layout reads `org show --json` (`site/lib/placementOrganisationLive.ts`); the
 * built CLI's staleness guard refused it because the pull had moved the source and the post-merge `dev build` had not
 * finished, so the whole console drew "Organisation required" and "Its command stopped with a technical error" — and
 * kept drawing it until they reloaded. Repro in any built checkout: `slopweaver dev build`, `touch src/cli/index.ts`,
 * `SLOPWEAVER_LAUNCHER_QUIET=1 ./bin/slopweaver org show --json` exits 1 with the `[stale-build]` refusal.
 *
 * The guard's rule stands: no verb is ever DISPATCHED from a stale build, and an ordinary
 * invocation still refuses at once. What changes is one caller. A child the console launched carries
 * {@link CONSOLE_CHILD_ENV} (`site/lib/launcherQuiet.ts` sets it), and for that child alone a valid-but-stale build is
 * read as a rebuild in flight: it polls the manifest — cheap, one small read — and judges a manifest only once its text
 * changes. `dev build` deletes the manifest before it emits and writes it only after the emitted tree's smoke run
 * passed (`src/cli/commands/dev/build.ts`), so a new manifest that judges fresh is a finished build. Then the process
 * restarts on it (`./restart.ts`) instead of resuming: its own modules were loaded from the tree the rebuild has just
 * overwritten. No fresh build inside the bound, and it refuses exactly as before, one line longer.
 *
 * The marker opens nothing: it is not a hatch and never runs stale code. `SLOPWEAVER_ALLOW_STALE_BUILD` remains the
 * only way to do that, and an open hatch is honoured before any wait.
 */

/** The marker a console child carries — restated in `site/lib/launcherQuiet.ts`, which `site/` cannot import from here. */
export const CONSOLE_CHILD_ENV = "SLOPWEAVER_CONSOLE_CHILD";

/**
 * How long a console child waits for a fresh build before refusing. MEASURED on this machine, unloaded:
 * `slopweaver dev build` emitted 8,420 files in 9.1 s and then ran its smoke run; a pull's hook installs first, and
 * a loaded machine is slower, so the bound is about three of those. Every console row that reads through it has a
 * timeout of its own of at least 10 s (`site/lib/actVerbs.ts`); the organisation read's is 90 s.
 */
export const CONSOLE_REBUILD_WAIT_MS = 30_000;

/** How often the manifest is read while waiting. One small file read, never a source scan. */
export const CONSOLE_REBUILD_POLL_MS = 250;

/** What a waiting child does next: pause and read again, or stop. */
export type RebuildPollStep = { readonly kind: "poll"; readonly delayMs: number } | { readonly kind: "timed-out" };

/**
 * The next step of a wait, from how long it has run. Pure: one fixed deadline, measured from the wait's start, and
 * a pause never reaching past it.
 *
 * @param elapsedMs how long the wait has run so far
 * @returns pause for the next read, or stop
 */
export function rebuildPollStep({ elapsedMs }: { elapsedMs: number }): RebuildPollStep {
  const remaining = CONSOLE_REBUILD_WAIT_MS - elapsedMs;
  if (remaining <= 0) {
    return { kind: "timed-out" };
  }
  return { delayMs: Math.min(CONSOLE_REBUILD_POLL_MS, remaining), kind: "poll" };
}

/** How a wait ended, and how long it took. */
export interface RebuildWaitOutcome {
  readonly kind: "fresh" | "timed-out";
  readonly waitedMs: number;
}

/** The effects a wait needs, each a plain function so a test drives the whole loop without a clock or a build. */
export interface RebuildWaitSeams {
  readonly nowMs: () => number;
  readonly pause: (options: { readonly ms: number }) => Promise<void>;
  /** The manifest's text as it stands, or `undefined` while there is none — mid-emit. */
  readonly readManifest: () => string | undefined;
  /** Whether a manifest's text describes a finished build of the source as it stands now. */
  readonly isFresh: (options: { readonly text: string }) => boolean;
}

/**
 * Wait for a manifest that judges fresh, reading the text each poll and judging only a text not judged before.
 *
 * A replacement that is itself stale — the source moved again under the rebuild — becomes the text judged, and the
 * wait goes on to the SAME deadline.
 *
 * @param judgedText the stale manifest's text the guard already judged, so it is not judged again
 * @param seams the clock, the pause, the read and the judgement
 * @returns fresh once a finished build lands, or timed-out at the bound
 */
export async function waitForFreshBuild({
  judgedText,
  seams,
}: {
  judgedText: string;
  seams: RebuildWaitSeams;
}): Promise<RebuildWaitOutcome> {
  const startedMs = seams.nowMs();
  const elapsedMs = (): number => seams.nowMs() - startedMs;
  const pastDeadline = (): boolean => rebuildPollStep({ elapsedMs: elapsedMs() }).kind === "timed-out";
  let judged = judgedText;
  // One read after a pause. A timer fires late under a blocked event loop, and a read can cross the deadline, so
  // the deadline is read again before each of the read and the judgement starts.
  const readOnce = (): "fresh" | "timed-out" | "continue" => {
    if (pastDeadline()) {
      return "timed-out";
    }
    const text = seams.readManifest();
    if (text === undefined || text === judged) {
      return "continue";
    }
    if (pastDeadline()) {
      return "timed-out";
    }
    judged = text;
    return seams.isFresh({ text }) ? "fresh" : "continue";
  };
  for (;;) {
    const step = rebuildPollStep({ elapsedMs: elapsedMs() });
    if (step.kind === "timed-out") {
      return { kind: "timed-out", waitedMs: elapsedMs() };
    }
    await seams.pause({ ms: step.delayMs });
    const verdict = readOnce();
    if (verdict !== "continue") {
      return { kind: verdict, waitedMs: elapsedMs() };
    }
  }
}
