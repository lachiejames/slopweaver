/**
 * Read/write/clear the per-destination record of the last Codex exhaustion a post-boot check observed.
 *
 * ## One file per DESTINATION, addressed by its alias
 *
 * `$SLOPWEAVER_HOME/codex-quota/<alias>.json`, one per registered Codex destination. A single file per
 * machine cannot say WHICH destination was capped, and with more than one home registered that is not a
 * cosmetic gap: a cap detected on one would refuse a spawn routed to another, and clearing it on the second
 * would erase the first's evidence. Nothing about "Codex is capped" is true of the machine — it is true of
 * an account.
 *
 * The key is the register's ALIAS rather than the store path, for two reasons that both matter. A path
 * holding a separator or a space cannot produce a filename nobody intended; and a destination that is
 * re-signed-in, or whose directory moves, keeps its own history instead of starting a fresh one under a new
 * name. The alias is re-checked here with `isPlanAlias` rather than trusted, because this module does not
 * get to assume its caller came through the register.
 *
 * ## Still a BACKSTOP, not the primary source
 *
 * `quotaLog.ts` reads Codex's own rollout log fresh every time and `quotaGate.ts` lets whichever source is
 * more recent win. This file only matters when the rollout log has not caught up — a session that hit
 * exhaustion before Codex wrote its own structured event.
 *
 * ## The clear MARK beside it
 *
 * `$SLOPWEAVER_HOME/codex-quota/cleared/<alias>.clear-mark.json` holds `{ clearedAtIso }`, the instant `slopweaver codex
 * quota clear` last ran for that destination. Deleting a cached record could never lift a cap read out of
 * Codex's own rollout log, which Slopweaver never writes, so the decision drops every non-live candidate
 * observed in a millisecond before this instant instead (`quotaGate.ts`'s `evidenceAfterClear`), and the clear deletes
 * nothing at all ({@link codexQuotaCacheStanding} says why). A subdirectory, so
 * {@link listCodexQuotaCaches} — which reads only the `.json` entries directly inside the root — never lists
 * a mark as an alias holding a cap.
 *
 * Not sensitive (unlike `judgement/miningStore.ts`'s private profile), so this goes through the generic
 * `lib/jsonFile.ts` writer rather than the owner-only `0600` treatment — there is nothing here an attacker
 * could use that the rollout log it summarises does not already carry.
 */
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { readJsonFile, writeJsonFile } from "../lib/jsonFile.js";
import { isRecord } from "../lib/parsers.js";
import { isPlanAlias } from "../plans/register.js";
import { stateHomePaths } from "../stateHome.js";

import { evidenceAfterClear } from "./quotaGate.js";
import {
  type CodexQuotaEvidence,
  type CodexQuotaKind,
  isCodexQuotaKind,
  PRIOR_WINDOW_LIMIT_KIND,
} from "./quotaTypes.js";

/** The extension every cache file carries, and the suffix a listing strips to recover an alias. */
const CACHE_SUFFIX = ".json";

/** Structurally validate an already-decoded cache value, or undefined if malformed. Pure. */
function parseCachedEvidence({ value }: { value: unknown }): CodexQuotaEvidence | undefined {
  // A row written before the `weekly-limit` → `window-limit` rename still decodes, mapped to the new kind.
  // The rename is in `quotaTypes.ts` and records why; dropping the old spelling here would silently discard a
  // real cached cap, which is the one thing a decoder of a refusal record must never do.
  if (!isRecord(value) || typeof value["observedAtIso"] !== "string") {
    return undefined;
  }
  const raw = value["kind"];
  const renamed = raw === PRIOR_WINDOW_LIMIT_KIND ? "window-limit" : raw;
  if (!isCodexQuotaKind(renamed)) {
    return undefined;
  }
  const kind: CodexQuotaKind = renamed;
  const resetAtIso = typeof value["resetAtIso"] === "string" ? value["resetAtIso"] : undefined;
  const limitId = typeof value["limitId"] === "string" ? value["limitId"] : undefined;
  const windowMinutes = typeof value["windowMinutes"] === "number" ? value["windowMinutes"] : undefined;
  return {
    kind,
    observedAtIso: value["observedAtIso"],
    ...(limitId === undefined ? {} : { limitId }),
    ...(resetAtIso === undefined ? {} : { resetAtIso }),
    ...(windowMinutes === undefined ? {} : { windowMinutes }),
  };
}

/**
 * Where one destination's cached exhaustion lives, or undefined when the alias is not one.
 *
 * `undefined` rather than a thrown error or a sanitised name: a caller holding a malformed alias has a bug
 * upstream, and inventing a filename for it would write real evidence somewhere nothing will ever read.
 *
 * @param alias the destination's register alias
 * @param home the Slopweaver home (defaults to the resolved home)
 * @returns the file path, or undefined for an alias no register would accept
 */
function cachePath({ alias, home }: { alias: string; home?: string }): string | undefined {
  if (!isPlanAlias({ alias })) {
    return undefined;
  }
  return join(stateHomePaths(home === undefined ? {} : { home }).codexQuotaDir, `${alias}${CACHE_SUFFIX}`);
}

/**
 * Read one destination's cached exhaustion record, if any.
 *
 * @param alias the destination's register alias
 * @param home the Slopweaver home (defaults to the resolved home)
 * @returns the cached evidence, or undefined when none has been written, it is unparseable, or the alias is
 *   not a well-formed one
 */
export function readCodexQuotaCache({ alias, home }: { alias: string; home?: string }): CodexQuotaEvidence | undefined {
  const path = cachePath({ alias, ...(home === undefined ? {} : { home }) });
  if (path === undefined) {
    return undefined;
  }
  return parseCachedEvidence({ value: readJsonFile({ path }) });
}

/**
 * Persist a detected exhaustion against the destination it was detected on.
 *
 * @param alias the destination's register alias
 * @param evidence the exhaustion a post-boot check just observed
 * @param home the Slopweaver home (defaults to the resolved home)
 * @returns whether the record was written — false only for an alias no register would accept
 */
export function writeCodexQuotaCache({
  alias,
  evidence,
  home,
}: {
  alias: string;
  evidence: CodexQuotaEvidence;
  home?: string;
}): boolean {
  const path = cachePath({ alias, ...(home === undefined ? {} : { home }) });
  if (path === undefined) {
    return false;
  }
  writeJsonFile({ path, value: evidence });
  return true;
}

/**
 * Whether one destination's cached exhaustion record still refuses once its clear mark is read.
 *
 * **`codex quota clear` deletes nothing; the mark IS the clear.** Every deletion order met a Codex review
 * counterexample: a delete before the mark lost an uncovered cap on a crash between them, an unconditional
 * delete after it dropped a cap another process cached in between, and moving the record aside to judge it
 * stranded such a cap on a crash before it was put back. Both decision readers already drop a covered
 * record, so leaving the file costs nothing a reader can see, and no interleaving or crash can lose a cap
 * observed after the clear. {@link listCodexQuotaCaches} hides a covered record for the same reason.
 *
 * @param alias the destination's register alias
 * @param home the Slopweaver home (defaults to the resolved home)
 * @returns `absent` with no record, `covered` when the mark disregards it, `standing` when it still refuses
 */
export function codexQuotaCacheStanding({
  alias,
  home,
}: {
  alias: string;
  home?: string;
}): "absent" | "covered" | "standing" {
  const homeArg = home === undefined ? {} : { home };
  const cached = readCodexQuotaCache({ alias, ...homeArg });
  if (cached === undefined) {
    return "absent";
  }
  const clearedAtIso = readCodexQuotaClearMark({ alias, ...homeArg });
  if (evidenceAfterClear({ candidates: [cached], clearedAtIso }).length > 0) {
    return "standing";
  }
  return "covered";
}

/** The directory under the quota root that holds the clear marks — its own, so a listing never reads one. */
const CLEAR_MARK_DIR = "cleared";

/**
 * The suffix a clear mark carries, and no cache file ever does: whatever `cleared/` resolves to, a mark's path
 * can never name a cache record, so writing a mark can never replace one (a Codex review's counterexample linked
 * `cleared` to its own parent).
 */
const CLEAR_MARK_SUFFIX = ".clear-mark.json";

/**
 * Where one destination's clear mark lives, or undefined when the alias is not one — the same refusal
 * {@link cachePath} makes, for the same reason.
 *
 * @param alias the destination's register alias
 * @param home the Slopweaver home (defaults to the resolved home)
 * @returns the file path, or undefined for an alias no register would accept
 */
function clearMarkPath({ alias, home }: { alias: string; home?: string }): string | undefined {
  if (!isPlanAlias({ alias })) {
    return undefined;
  }
  const root = stateHomePaths(home === undefined ? {} : { home }).codexQuotaDir;
  return join(root, CLEAR_MARK_DIR, `${alias}${CLEAR_MARK_SUFFIX}`);
}

/**
 * Record the instant one destination was explicitly cleared, replacing any earlier mark.
 *
 * @param alias the destination's register alias
 * @param clearedAtIso the clear instant, ISO-8601; evidence observed in an earlier millisecond stops counting
 * @param home the Slopweaver home (defaults to the resolved home)
 * @returns whether the mark was written — false only for an alias no register would accept
 */
export function writeCodexQuotaClearMark({
  alias,
  clearedAtIso,
  home,
}: {
  alias: string;
  clearedAtIso: string;
  home?: string;
}): boolean {
  const path = clearMarkPath({ alias, ...(home === undefined ? {} : { home }) });
  if (path === undefined) {
    return false;
  }
  writeJsonFile({ path, value: { clearedAtIso } });
  return true;
}

/**
 * Read the instant one destination was last explicitly cleared, if it ever was.
 *
 * The string is returned unvalidated: an unparseable one reaches `evidenceAfterClear`, which clears nothing
 * on it — the fail-closed direction — rather than this reader deciding what a malformed instant means.
 *
 * @param alias the destination's register alias
 * @param home the Slopweaver home (defaults to the resolved home)
 * @returns the recorded instant, or undefined when no mark exists, it is malformed, or the alias is not one
 */
export function readCodexQuotaClearMark({ alias, home }: { alias: string; home?: string }): string | undefined {
  const path = clearMarkPath({ alias, ...(home === undefined ? {} : { home }) });
  if (path === undefined) {
    return undefined;
  }
  const value = readJsonFile({ path });
  if (!isRecord(value) || typeof value["clearedAtIso"] !== "string") {
    return undefined;
  }
  return value["clearedAtIso"];
}

/**
 * Every destination this install holds a cached exhaustion for, by alias, bar one its clear mark covers.
 *
 * Read from the DIRECTORY rather than from the register on purpose: a row removed from the register leaves
 * its cache behind, and a listing that only reported registered aliases would make that leftover invisible
 * to the one verb that could clear it. A covered record is left on disk ({@link codexQuotaCacheStanding}
 * says why) and refuses nothing, so listing it would name a cap that is not there.
 *
 * @param home the Slopweaver home (defaults to the resolved home)
 * @returns each alias with a cache file no clear mark covers, sorted, empty when the directory does not exist
 */
export function listCodexQuotaCaches({ home }: { home?: string } = {}): readonly string[] {
  const homeArg = home === undefined ? {} : { home };
  const dir = stateHomePaths(homeArg).codexQuotaDir;
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir)
    .filter((name) => name.endsWith(CACHE_SUFFIX))
    .map((name) => name.slice(0, -CACHE_SUFFIX.length))
    .filter((alias) => isPlanAlias({ alias }) && codexQuotaCacheStanding({ alias, ...homeArg }) !== "covered")
    .toSorted();
}
