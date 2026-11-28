/**
 * The effectful half of the built-CLI half of the `post-merge` / `post-checkout` hooks: decide off the ref
 * move's own diff, then re-emit `dist-cli` when it brought in source the built tree was compiled from.
 *
 * It runs in whichever checkout the ref moved in, exactly as the install half does, and it is scoped by the
 * same kind of CONTENT predicate rather than by the hook's presence. The scope it adds is its own: a
 * checkout with no built tree is SKIPPED, because nothing there can be stale, and building one unasked
 * would hand every checkout a 2-second hook it never wanted.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { DEFAULT_OUT } from "../builtCli/layout.js";
import { BUILD_MANIFEST_FILE } from "../builtCli/staleness.js";
import type { CheckoutInspectDeps } from "./inspect.js";
import { type RefMoveBuildOutcome, refMoveBuildDecision } from "./refMoveBuild.js";
import type { RefMoveHook } from "./refMoveInstall.js";
import { changedPathsFor, planFor } from "./refMoveInstallRun.js";

/** Whether this checkout has a built CLI at all — the manifest, not the entrypoint, exactly as the launcher asks. */
function hasBuiltCli({ cwd }: { cwd: string }): boolean {
  return existsSync(join(cwd, DEFAULT_OUT, BUILD_MANIFEST_FILE));
}

/** What one `dev build` spawn returned, narrowed to the three fields the reading below needs. */
export interface RebuildRun {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * What one `dev build` spawn MEANS — the pure half, so every arm is reachable without spawning a build.
 *
 * A build that failed reports its first stderr line, because that is where esbuild and the smoke run both
 * say what went wrong; a failure that printed nothing there falls back to naming the exit code, since a
 * hook line reading only `failed` tells the next session nothing. A build that succeeded reports its LAST
 * stdout line, which is `dev build`'s own verdict line.
 *
 * @internal — exported for its own unit tests; {@link rebuildNow} is the only production caller
 * @param run what the spawn returned
 * @param why the decision that asked for this rebuild, carried through to the outcome
 * @returns the outcome the hook reports
 */
export function rebuildOutcomeOf({ run, why }: { run: RebuildRun; why: string }): RefMoveBuildOutcome {
  if (run.status !== 0) {
    const stderr = run.stderr.trim().split("\n")[0];
    if (stderr === undefined || stderr === "") {
      return { detail: `dev build exited ${String(run.status)}`, did: "failed", why };
    }
    return { detail: stderr, did: "failed", why };
  }
  const printed = run.stdout.trim();
  // `"".split("\n")` is `[""]`, never `[]`, so emptiness is tested on the STRING: an `at(-1) === undefined`
  // arm here would be a branch no input can reach, which reads as a handled case and is not one.
  if (printed === "") {
    return { detail: "dev build exited 0", did: "rebuilt", why };
  }
  return { detail: printed.split("\n").at(-1)!, did: "rebuilt", why };
}

/**
 * The argv after `tsx` the hook's rebuild runs. `--yield-to-lap`: a lap holds the compile lease for its whole run, so
 * a rebuild started outside one while it runs would wait 120 s for a refusal certain from the start, stalling the
 * pull it rides; with the flag it gives up after one second when the lease's holder is a live lap
 * (`src/cli/commands/dev/buildOwner.ts` § Yielding to a lap).
 *
 * @returns the source entrypoint, the verb, and its flag
 */
export function refMoveDevBuildArgv(): readonly string[] {
  return ["src/cli/index.ts", "dev", "build", "--yield-to-lap"];
}

/**
 * Re-emit the built tree by running the verb that owns the emit.
 *
 * Through `tsx` and the source rather than through `bin/slopweaver`, deliberately: the launcher would route
 * a built checkout's invocation to the built CLI, whose staleness guard is refusing at this exact moment —
 * the hook would be asking the stale artifact to fix itself.
 *
 * @internal — exported so a unit test can drive it with a plain fake spawn; production takes the default
 * @param cwd the checkout to rebuild
 * @param why the decision that asked for this rebuild
 * @param runBuild the emit seam, defaulted to the real `dev build` invocation
 * @returns the outcome the hook reports
 */
export function rebuildNow({
  cwd,
  why,
  runBuild = ({ cwd: dir }): RebuildRun =>
    spawnSync(join(dir, "node_modules/.bin/tsx"), refMoveDevBuildArgv(), {
      cwd: dir,
      encoding: "utf8",
    }),
}: {
  cwd: string;
  why: string;
  runBuild?: (args: { cwd: string }) => RebuildRun;
}): RefMoveBuildOutcome {
  return rebuildOutcomeOf({ run: runBuild({ cwd }), why });
}

/**
 * Decide and act for one hook invocation.
 *
 * @param hook which git hook is running
 * @param args the arguments git passed this hook, in order
 * @param cwd the checkout the ref moved in
 * @param deps the git read seam
 * @param rebuild the emit seam — {@link rebuildNow} in production, a plain fake in a unit test, which is
 *   what lets the routing above be proved without spawning a build
 * @returns what it did
 */
export function runRefMoveBuild({
  hook,
  args,
  cwd,
  deps,
  rebuild = rebuildNow,
}: {
  hook: RefMoveHook;
  args: readonly string[];
  cwd: string;
  deps: CheckoutInspectDeps;
  rebuild?: (args: { cwd: string; why: string }) => RefMoveBuildOutcome;
}): RefMoveBuildOutcome {
  if (!hasBuiltCli({ cwd })) {
    return { did: "skipped", why: `this checkout has no ${DEFAULT_OUT}, so nothing here can be stale` };
  }
  const plan = planFor({ args, cwd, deps, hook });
  if (plan.act === "skip") {
    return { did: "skipped", why: plan.why };
  }
  const changedPaths = changedPathsFor({ comparison: plan.comparison, cwd, deps });
  if (changedPaths === undefined) {
    return { did: "skipped", why: "git could not diff the move, so nothing here knows what it brought in" };
  }
  const decision = refMoveBuildDecision({ changedPaths });
  if (!decision.build) {
    return { did: "current", why: decision.why };
  }
  return rebuild({ cwd, why: decision.why });
}
