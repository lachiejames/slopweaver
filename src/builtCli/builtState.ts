/**
 * Where a built tree stands against its source, as a caller that LAUNCHES built-CLI children reads it — the pure
 * half. The effectful read and wait are `./builtStateRead.ts`.
 *
 * `./invocationGuard.ts` judges one invocation from inside the child. A parent that launches many children in a row
 * needs the same judgement from outside, before each launch, so that a rebuild in flight is waited out ONCE by the
 * parent rather than refused by every child: MEASURED, one `supervisor tick open` lost 39 of its 50 readings to the
 * `[stale-build]` refusal after a landing fast-forwarded the main checkout mid-capture. Repro in any built checkout: `slopweaver dev build`, `touch src/cli/index.ts`, then
 * `slopweaver supervisor tick-capture --dir <scratch> --tick 1` refuses every reading.
 *
 * No I/O.
 */
import { dirname, join } from "node:path";

import { DEFAULT_OUT } from "./layout.js";

/**
 * A built tree's standing.
 *
 * - `unbuilt` — no manifest: a checkout running from source, or a build mid-emit (`dev build` deletes the manifest
 *   first); the launcher then runs the source, so there is nothing to wait for.
 * - `unjudgeable` — a manifest that does not parse, or names a checkout that is gone: no rebuild is provably in
 *   flight, so waiting buys nothing, exactly as `./guard.ts` carries no manifest text on that arm.
 * - `fresh` / `stale` — a valid manifest over a checkout that is there; `stale` is the shape a rebuild in flight
 *   leaves, and the only one worth waiting out.
 */
export type BuiltState =
  | { readonly kind: "unbuilt" }
  | { readonly kind: "unjudgeable" }
  | { readonly kind: "fresh"; readonly manifestText: string }
  | { readonly kind: "stale"; readonly manifestText: string };

/**
 * The built tree a `slopweaver` launcher runs: `<checkout>/bin/slopweaver` runs `<checkout>/dist-cli`.
 *
 * @param bin the launcher's path
 * @returns the built tree's directory beside it
 */
export function builtRootOfBin({ bin }: { bin: string }): string {
  return join(dirname(dirname(bin)), DEFAULT_OUT);
}

/**
 * Whether a rebuild could explain a child's failure: the source moved under it (the tree reads stale after it), or
 * a build landed while it ran (a fresh manifest whose text differs from the one judged before it launched).
 *
 * @param before the standing the child launched against
 * @param after the standing once it ended
 * @returns true when the failure may be the rebuild's rather than the verb's own
 */
export function rebuildCrossed({ before, after }: { before: BuiltState; after: BuiltState }): boolean {
  if (after.kind === "stale") {
    return true;
  }
  if (after.kind !== "fresh") {
    return false;
  }
  return before.kind !== "fresh" || before.manifestText !== after.manifestText;
}
