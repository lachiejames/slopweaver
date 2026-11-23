/**
 * The effectful edge for the private judgement/voice profile under `$SLOPWEAVER_HOME/judgement`.
 *
 * Mirrors `./profileStore.ts`'s absent/unreadable/valid loader shape — a profile that has not been mined
 * yet is `absent` (ordinary, not degraded: routing judgement falls back to no persona/voice overlay), while
 * a profile that exists and fails to parse is `unreadable` and MUST be reported, not silently treated the
 * same as absent, for the reason `profileStore.ts`'s own header gives: a turn that silently lost the persona
 * it was meant to load is exactly the class of failure this file exists to catch.
 *
 * Writing is the other half this file owns, and it is stricter than `profileStore.ts` needs to be: the
 * profile is mined from first-person material (voice dictation transcripts, a prior bot's decision history)
 * that nothing else on the machine may read, so the directory and file are tightened to `0700`/`0600` on
 * every write — `mkdirSync`'s own `mode` option is umask-masked and never tightens an existing directory, so
 * an unconditional `chmodSync` is what actually closes that gap (see `docs/routing-judgement-profile-contract`
 * proof, and P3 finding #7 this fixes: the generic JSON writer other cache precedents use leaves a private
 * profile world-readable under a normal `0022` umask).
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

import { parseJson } from "../../lib/jsonParse.js";
import { safeFs } from "../../lib/safeBoundary.js";
import { stateHomePaths } from "../../stateHome.js";
import { type JudgementProfile, parseJudgementProfile } from "./judgementProfile.js";

/** Owner-only permissions: the profile is mined from first-person material nothing else may read. */
const JUDGEMENT_DIR_MODE = 0o700;
const JUDGEMENT_FILE_MODE = 0o600;

/** Where a loaded judgement profile ended up. */
export type JudgementProfileOutcome =
  | { readonly kind: "absent" }
  | { readonly kind: "unreadable"; readonly why: string }
  | { readonly kind: "profile"; readonly profile: JudgementProfile };

/**
 * Load the private judgement/voice profile for a state home, when one has been mined.
 *
 * Never throws — the three outcomes are the profile itself, `absent` (never mined — routing judgement
 * proceeds with no persona/voice overlay), and `unreadable` (the file exists and is broken — also proceeds
 * with no overlay, but the caller must say so).
 *
 * @param home the Slopweaver home holding `judgement/profile.json`
 * @returns the profile, its absence, or why it could not be read
 */
export function loadJudgementProfile({ home }: { home?: string } = {}): JudgementProfileOutcome {
  const path = stateHomePaths(home === undefined ? {} : { home }).judgement.profileJson;
  if (!existsSync(path)) {
    return { kind: "absent" };
  }
  const read = safeFs({ execute: () => readFileSync(path, "utf8"), operation: "readJudgementProfile", path });
  if (read.isErr()) {
    return { kind: "unreadable", why: `judgement/profile.json exists but could not be read: ${read.error.message}` };
  }
  const decoded = parseJson({ text: read.value });
  if (decoded.isErr()) {
    return { kind: "unreadable", why: "judgement/profile.json is not valid JSON" };
  }
  const parsed = parseJudgementProfile({ value: decoded.value });
  if (parsed.isErr()) {
    return { kind: "unreadable", why: parsed.error.join("; ") };
  }
  return { kind: "profile", profile: parsed.value };
}

/**
 * Persist a validated judgement profile, tightening the directory and file to owner-only on every call —
 * on first write AND on an already-existing, previously-permissive path.
 *
 * @param profile the validated profile to write
 * @param home the Slopweaver home to write under
 */
export function writeJudgementProfile({ profile, home }: { profile: JudgementProfile; home?: string }): void {
  const paths = stateHomePaths(home === undefined ? {} : { home });
  mkdirSync(paths.judgement.root, { mode: JUDGEMENT_DIR_MODE, recursive: true });
  chmodSync(paths.judgement.root, JUDGEMENT_DIR_MODE);
  writeFileSync(paths.judgement.profileJson, `${JSON.stringify(profile, null, 2)}\n`, {
    encoding: "utf8",
    mode: JUDGEMENT_FILE_MODE,
  });
  chmodSync(paths.judgement.profileJson, JUDGEMENT_FILE_MODE);
}
