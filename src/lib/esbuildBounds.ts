/**
 * The Go soft memory limit every esbuild process this repository starts runs under.
 *
 * esbuild is a Go binary, so no V8 `--max-old-space-size` reaches it, and Go's collector by default lets the heap grow
 * to twice what survived the last collection. MEASURED with no limit (docs/toolchain/build.md § dev build): one
 * `dev build` esbuild peaked at 4,947,853,312 bytes resident and, on another seat the same day, at 14,902,345,728;
 * an unbounded esbuild later grew to about 28 GB and froze a machine running four seats. `GOMEMLIMIT` is the Go
 * runtime's own SOFT target: it collects harder as the heap nears it and exceeds it rather than fail, so a build
 * whose live heap really needs more slows down and still finishes. The hard bound is a separate, higher number
 * where one exists (`DEV_BUILD_RSS_CEILING_MIB`, src/cli/commands/dev/buildOwner.ts).
 *
 * 4,096 MiB sits under the smaller measured peak, so the limit does real work on every build rather than only on
 * the runaway one. It has not yet been measured under the limit: tighten or loosen it from a build measured with
 * it, e.g. `/usr/bin/time -l slopweaver dev build`.
 *
 * Two consumers, one number: `dev build` hands it to `scripts/tsc-owner.sh` as `--go-memory-limit-mib`, and the
 * `runtime-dependencies` lint gate sets it in its own environment, which the `esbuild --service` child its
 * JavaScript API starts inherits (src/devLint/gateGroups.ts).
 */

/** The soft limit, in MiB. */
export const ESBUILD_GO_MEMORY_LIMIT_MIB = 4096;

/**
 * The `GOMEMLIMIT` value for a limit in MiB, in the unit suffix the Go runtime parses.
 *
 * @param mib the limit, in MiB
 * @returns the environment value, e.g. `4096MiB`
 */
export function goMemoryLimit({ mib }: { mib: number }): string {
  return `${String(mib)}MiB`;
}
