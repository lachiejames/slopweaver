/**
 * The pure half of `slopweaver dev baseline-bump`: from what a change loosened against main, the bump record
 * that declares it. The landing verbs refuse a loosening no witnessed record covers; this is the one way to write
 * a declaration, so a hand-typed row cannot drift from what the landing read computes.
 *
 * A row's cause is DERIVED, never chosen: `widening` exactly when it names a file this change leaves
 * byte-identical to main, which is the same test the landing read re-runs, and `growth` otherwise. A rise the
 * change's own code caused can therefore never be filed as the good kind.
 */

import {
  type BumpCause,
  type BumpManifest,
  type BumpRow,
  digestOf,
  provenUnchanged,
} from "../../../devLint/baselineBump.js";
import { type Loosening } from "../../../devLint/baselineRegistry.js";
import type { Result } from "../../../lib/result.js";
import { type FlagTailSpec, parseFlagTail, requiredFlagValue } from "../../optionParsers.js";

/** What the verb advertises. */
export const DEV_BASELINE_BUMP_USAGE =
  'usage: slopweaver dev baseline-bump --reason "<why>" [--base <sha>] [--home <dir>] [--dry-run]';

/** Every flag it takes — exported so the `--help` truth test checks the usage against it. */
export const DEV_BASELINE_BUMP_FLAGS: FlagTailSpec = { boolean: ["dry-run"], value: ["reason", "base", "home"] };

/** The parsed tail. */
export interface BaselineBumpArgs {
  readonly reason: string;
  /** Main's commit; absent means the merge-base with `origin/main`. */
  readonly base: string | undefined;
  /** The state home the record is written into; absent means `$SLOPWEAVER_HOME`. */
  readonly home: string | undefined;
  readonly dryRun: boolean;
}

/**
 * Parse the verb's flag tail. A missing or blank `--reason` is refused: the reason is what the witness reads.
 *
 * @param rest the argv tail after `dev baseline-bump`
 * @returns the parsed flags, or every reason the tail was refused
 */
export function parseBaselineBumpArgs({ rest }: { rest: readonly string[] }): Result<BaselineBumpArgs> {
  return parseFlagTail({ rest, spec: DEV_BASELINE_BUMP_FLAGS }).andThen((parsed) =>
    requiredFlagValue({
      missing: "--reason is required: why each loosening is right, in words the witness will judge",
      name: "reason",
      parsed,
    }).map((reason) => ({
      // Absent is `undefined` by design: the verb resolves the base and the home itself when neither is passed.
      base: parsed.values["base"],
      dryRun: parsed.flags.has("dry-run"),
      home: parsed.values["home"],
      reason: reason.trim(),
    })),
  );
}

/**
 * The record declaring every loosening, or `undefined` when nothing loosened. Pure.
 *
 * @param loosened every loosening against main
 * @param changedPaths every path the change touched, which decides each row's cause
 * @param reason why, in the implementer's words — the witness judges it
 * @param base the full main commit the rows were measured against, which the digest binds
 * @returns the record to write, or `undefined`
 */
export function bumpManifestFor({
  base,
  loosened,
  changedPaths,
  reason,
}: {
  base: string;
  loosened: readonly Loosening[];
  changedPaths: ReadonlySet<string>;
  reason: string;
}): BumpManifest | undefined {
  const rows: BumpRow[] = loosened.map((row) => {
    const cause: BumpCause = provenUnchanged({ changedPaths, entry: row.entry }) ? "widening" : "growth";
    return { ...row, cause };
  });
  if (rows.length === 0) {
    return undefined;
  }
  return { base, digest: digestOf({ base, rows }), loosenings: rows, reason };
}
