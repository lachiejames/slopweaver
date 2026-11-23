/**
 * The flag handling `github ci-runs` and `github ci-timing` share.
 *
 * The two verbs ask two halves of one question — how long a window of runs took, and how long each job of
 * one run took — so they accept overlapping flags, and copy-adjacent helpers for them were a near-duplicate
 * pair `duplicate-windows` refused. This module is deliberately the SHAPE of a flag rather than any verb's
 * meaning: a default run window or an event allowlist stays with the verb that owns it.
 *
 * Nothing here authors an error string. Every refusal is built by `./ciRunsErrors.ts`'s factories, because
 * `src/cli/commands/github` is a standing directory on the `error-shape-threshold` debt list.
 */

import { err, ok, type Result } from "../../../lib/result.js";
import { type GithubCiRunsUsageIssue, GithubCiRunsUsageIssues } from "./ciRunsErrors.js";

/** A parse problem list, the shape every usage refusal in these verbs returns. */
export type CiUsageIssues = readonly GithubCiRunsUsageIssue[];

/**
 * Render every accepted flag with the `--` callers actually type.
 *
 * @param strings the string-valued flag names, without dashes
 * @param booleans the boolean flag names, without dashes
 * @returns one list a help-truth check can compare against the parser
 */
export function ciFlagNames({
  strings,
  booleans,
}: {
  strings: readonly string[];
  booleans: readonly string[];
}): readonly string[] {
  return [...strings, ...booleans].map((name) => `--${name}`);
}

/**
 * Take a string flag's value, or the default when it was not typed.
 *
 * A flag typed with an EMPTY value is a mistake rather than a request for the default, so it refuses
 * instead of silently falling back — which is the same reasoning `no-silent-fallback` encodes.
 *
 * **What it accepts is exactly what it can RE-EMIT**, which is why the trimmed value is checked for a
 * leading `--` as well. `parseFlags` refuses any string value starting `--`, so a value that only reaches
 * this function because trimming removed a leading space could be typed once and never written back into a
 * printed command line. Measured by a review pass: `--baseline ' --baseline.json'` was accepted here and
 * produced a printed command that exits 2.
 *
 * @param value whatever the shared flag parser bound
 * @param fallback what an absent flag means
 * @param flag the name to quote in a refusal
 * @returns the trimmed value, the fallback, or the issue naming which rule it broke
 */
export function ciTextFlag({
  value,
  fallback,
  flag,
}: {
  value: string | boolean | undefined;
  fallback: string;
  flag: string;
}): Result<string, CiUsageIssues> {
  if (value === undefined) {
    return ok(fallback);
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    return err([GithubCiRunsUsageIssues.blankFlagValue({ flag })]);
  }
  const trimmed = value.trim();
  if (trimmed.startsWith("--")) {
    return err([GithubCiRunsUsageIssues.flagValueLooksLikeFlag({ flag, value: trimmed })]);
  }
  return ok(trimmed);
}

/**
 * What {@link ciPositiveInteger} found, kept separate from any one verb's wording.
 *
 * Absent and invalid are DIFFERENT outcomes because the verbs disagree about the first: `--runs` has a
 * default, `--run-id` and `--job-id` refuse. Collapsing them would force that decision in here.
 */
export type IntegerFlagOutcome =
  { readonly kind: "absent" } | { readonly kind: "invalid" } | { readonly kind: "present"; readonly value: number };

/**
 * Read a flag that must be a positive integer, without deciding what an absent one means.
 *
 * @param value whatever the shared flag parser bound
 * @param max the inclusive ceiling, for a flag that has one
 * @returns which of the three cases holds, and the number when there is one
 */
export function ciPositiveInteger({
  value,
  max,
}: {
  value: string | boolean | undefined;
  max: number | undefined;
}): IntegerFlagOutcome {
  if (value === undefined) {
    return { kind: "absent" };
  }
  const parsed = typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return { kind: "invalid" };
  }
  if (max !== undefined && parsed > max) {
    return { kind: "invalid" };
  }
  return { kind: "present", value: parsed };
}
