/**
 * The effectful edge that reads a private capability-profile overlay out of `$SLOPWEAVER_HOME`. The
 * decision itself lives in `./sourcePlan.ts` and `./profile.ts` and is pure; this file only turns bytes
 * into one of its states.
 *
 * ## Why `turn brief` needs this at all
 *
 * `route plan` has always accepted `--profile <path>` and planned from it. `turn brief` — the verb every
 * live Slack tag actually runs through — never did: it called `buildSourcePlan` with no profile, which
 * means the live path could route to nothing beyond the nine generic, slopweaver-only rows in
 * `GENERIC_SOURCE_CAPABILITIES`, no matter what a private installation's own live-read verbs could answer.
 * A verb built and merged an hour before a tag arrives is invisible to that tag forever, because nothing
 * ever told the router it existed. This loader is what lets an installation's own capability table reach
 * the live path at all, the same way `responders.json` lets it reach the identity gate.
 *
 * ## Absent vs unreadable, and why the difference is reported
 *
 * Absent is the ordinary state for every installation that has not written one — `turn brief` then plans
 * from the generic table alone, which is correct, not degraded. UNREADABLE is a different fact and is
 * reported rather than silently treated the same as absent: a profile that exists and fails to parse would
 * otherwise fall back to the generic table with nothing said, and a turn that silently lost every live
 * capability it was meant to know about is exactly the class of failure this whole feature exists to catch.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

import { parseJson } from "../lib/jsonParse.js";
import { safeFs } from "../lib/safeBoundary.js";
import { stateHomePaths } from "../stateHome.js";
import { type CapabilityProfile, parseCapabilityProfileRows, type SkippedCapability } from "./profile.js";

/** Where a loaded capability-profile overlay ended up. */
export type CapabilityProfileOutcome =
  | { readonly kind: "absent" }
  | { readonly kind: "unreadable"; readonly why: string }
  | {
      readonly kind: "profile";
      readonly profile: CapabilityProfile;
      /** Rows the overlay declared that could not be used. A caller MUST report these rather than swallow them. */
      readonly skipped: readonly SkippedCapability[];
    };

/**
 * Load the private capability-profile overlay for a state home, when the installation has one.
 *
 * Never throws — the three outcomes are the profile itself, `absent` (no file at all — plan from the
 * generic table), and `unreadable` (the file exists and is broken — also plan from the generic table, but
 * the caller must say so). Loaded once per process; a file edited while `turn brief` is already running
 * takes effect only on the next invocation.
 *
 * @param home the Slopweaver home holding `capability-profile.json`
 * @returns the profile, its absence, or why it could not be read
 */
export function loadCapabilityProfile({ home }: { home: string }): CapabilityProfileOutcome {
  const path = stateHomePaths({ home }).capabilityProfileJson;
  if (!existsSync(path)) {
    return { kind: "absent" };
  }
  const read = safeFs({ execute: () => readFileSync(path, "utf8"), operation: "readCapabilityProfile", path });
  if (read.isErr()) {
    return { kind: "unreadable", why: `capability-profile.json exists but could not be read: ${read.error.message}` };
  }
  const decoded = parseJson({ text: read.value });
  if (decoded.isErr()) {
    return { kind: "unreadable", why: "capability-profile.json is not valid JSON" };
  }
  const parsed = parseCapabilityProfileRows({ value: decoded.value });
  if (parsed.isErr()) {
    return { kind: "unreadable", why: `capability-profile.json could not be used — ${parsed.error.join("; ")}` };
  }
  return { kind: "profile", profile: parsed.value.profile, skipped: parsed.value.skipped };
}

/**
 * Persist a validated capability-profile overlay, overwriting whatever this state home already had.
 *
 * The caller decides what "whatever this state home already had" should become — typically the result of
 * {@link "./profile.js".mergeCapabilityProfiles}, never a raw incoming file, so an installation's own
 * hand-tuned rows are never silently lost to this write.
 *
 * @param home the Slopweaver home to write `capability-profile.json` under
 * @param profile the validated profile to write
 */
export function writeCapabilityProfile({ home, profile }: { home: string; profile: CapabilityProfile }): void {
  const path = stateHomePaths({ home }).capabilityProfileJson;
  mkdirSync(home, { recursive: true });
  writeFileSync(path, `${JSON.stringify(profile, null, 2)}\n`, "utf8");
}
