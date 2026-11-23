/**
 * The durable record of which calls a sync has already made, so a restart is not a restart.
 *
 * ## Why this exists at all
 *
 * A full sync is at least one request per system times the 75 per-system operations, plus 180 Directory
 * Insights day partitions — before pagination, other fan-out or a single retry. Every restart repeats the
 * whole system slice against a provider that documents blocking what it takes for abuse rather than
 * publishing an allowance. A sync that had to start over on any interruption
 * would therefore be a sync that could not reliably finish, and a publication that refuses until every
 * mandatory family completes needs a way to GET there.
 *
 * ## Append-only, and it holds the PROJECTED RECORDS rather than finished entities
 *
 * Each completed call appends one line carrying the records that call produced, already through the
 * field-denial projection and already past the sensitivity gate — the same admission the whole generation
 * faces at publish, applied per call. So the journal can never hold material a kind file would be refused
 * for holding, which matters because it is written long before the publish that checks the document whole.
 *
 * Records rather than entities, and the difference is not cosmetic. An entity carries an IDENTITY, and the
 * identity rule is a decision this atlas may need to correct — it was corrected once already, when the
 * first full walk of this tenancy read every fan-out call and then refused to merge because one
 * surface had returned the same record under two parents. A journal of entities would have made that
 * correction cost the whole walk again. A journal of records survives it: identities are derived on the
 * way out, so a fixed rule applies to work already done.
 *
 * A line carrying `entities` instead is READ, not discarded — its projected details are exactly the
 * records, and its root-ness is recovered by comparing its endpoint against the registry row's own path.
 *
 * ## A clearably-incomplete walk is NEVER journalled, and is skipped if an older build wrote one
 *
 * A walk that answered but did not finish returns SUCCESS — it has records — so it was journalled like any
 * other call. MEASURED: System Insights tables abandoned at 500 pages of 100 records were
 * journalled that way, and every later run replayed the stale entry instead of re-walking. A paging fix
 * that raised the page size to 1,000 therefore could not take effect at all, and the same shortfall at the
 * page cap reappeared on consecutive runs while a single-threaded probe of the same surface paged
 * correctly. The journal was caching the defect.
 *
 * So the rule matches the one already applied to failures. A SETTLED outcome is journalled, because
 * re-asking cannot change it. A clearable one is not, because re-asking is the entire point.
 *
 * A malformed line is SKIPPED rather than fatal: a journal is a cache of work already done, and the honest
 * response to one unreadable line is to redo that one call, not to abandon every other call it holds.
 *
 * ## It is read a LINE at a time, and the run that proved why is the one this file was written for
 *
 * MEASURED on the live tenancy. `readJumpcloudResume` used to `readFileSync(path, "utf8")` the
 * whole journal, and the journal had grown past what one string can hold — so V8 refused to build the string
 * at all (`Cannot create a string longer than 0x1fffffe8 characters`, the 536,870,888-character wall), the
 * `catch` around it returned **zero** entries, and every sync therefore resumed NOTHING. It re-walked every
 * call it had already made and appended every one of them again. The journal held more lines than distinct
 * keys, the excess all redundant re-appends, the System Insights families carrying a copy per doomed sync,
 * and the atlas had never once published a generation. The whole-file read WAS
 * the loop that fed itself — it made the journal too big to read, and being unreadable is what made it grow.
 *
 * The fix reads that journal. MEASURED the same day against a settled copy of it — the file had grown
 * further under one more doomed sync before this landed, and every added line was a re-append of a key
 * already present, which is the loop above stating itself one last time: reading each distinct completed
 * call once took less time and a lower peak RSS than the same streaming read over every line-entry with no
 * deduplication. The ceiling both sit under is a quarter of physical memory
 * (`bin/slopweaver`). Reproduce with a script that calls `readJumpcloudResume({ directory })` against the
 * live atlas directory under `/usr/bin/time -l`.
 *
 * So the read goes through `readJsonlLines` (`src/corpus/corpusStore.ts`), which is what AGENTS.md's
 * never-let-a-data-sized-payload-through-one-JS-string rule already required of every `.jsonl` in this
 * repository. The `whole-file-json` gate did not catch this one, and its own header names the reason: the
 * path was parked in a local (`const path = jumpcloudResumePath(...)`) before the read, which a syntax-only
 * pass cannot follow. That blind spot is now closed — see `src/devLint/wholeFileJson.ts`.
 *
 * Reproduce the size shape on any install that still holds a journal:
 * `wc -l ~/.slopweaver/atlas/jumpcloud/_resume.jsonl && stat -f %z ~/.slopweaver/atlas/jumpcloud/_resume.jsonl`.
 *
 * One LINE is still data-sized, and that is a stated limit rather than a discovery: the largest line this
 * journal held was one `v2-systeminsights-list-launchd` call carrying every launchd record the fleet
 * reported, read against V8's 512 MiB ceiling. Streaming the file does not split a line, so a single call
 * whose records outgrow that ceiling would still be unreadable. Nothing here splits one call across lines
 * yet; the headroom is the largest line's measured size against that ceiling, never an assumption.
 *
 * ## It is deleted on a successful publish
 *
 * A journal outliving its generation is a journal that would resume a sync against a store that has already
 * moved on. `dropJumpcloudResume` is called by the publish path, not by the walk.
 */
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";

import { z } from "zod";

import { readJsonlLines } from "../../corpus/corpusStore.js";
import { appendLines } from "../../lib/appendSeparator.js";
import { err, ok, type Result } from "../../lib/result.js";
import type { AtlasDroppedField } from "../kit/projection.js";
import { JumpcloudAtlasErrors, jumpcloudAtlasErrorLines } from "./atlasErrors.js";
import { findJumpcloudSurface } from "./client.js";
import { jumpcloudContractFingerprint } from "./requestContracts.js";

/** One completed call, as the journal holds it. */
export interface JumpcloudResumeEntry {
  /**
   * `<surface>|<bound path>`, plus the pinned request contract's fingerprint when the operation has one —
   * unique per call, and stable across runs because every part of it is. See {@link resumeKey}.
   */
  readonly key: string;
  readonly kind: string;
  readonly surface: string;
  readonly endpoint: string;
  /** When this call was made. A resumed generation's read epoch spans the journal, not just this run. */
  readonly at: string;
  /** The projected records this call produced. Identities are derived from these, never stored here. */
  readonly records: readonly unknown[];
  /**
   * What the projection removed on the way to those records, so coverage can still say it.
   *
   * The records above are projected BEFORE they are journalled, which is what keeps secret material out of
   * a file written long before any publish checks it. The cost is that re-projecting a journalled record
   * finds nothing left to remove, so without this field a withholding is invisible for every call whose
   * records were read fresh — the family reports "nothing was withheld at the boundary" while a credential
   * was in fact dropped. Optional because a journal written by an older build has no such field, and a
   * missing one is read as an empty list rather than as a claim that nothing was dropped.
   */
  readonly dropped?: readonly AtlasDroppedField[];
  /** Whether this was a root collection, which decides how its records are identified. */
  readonly isRoot: boolean;
  /**
   * A failure that is SETTLED — one no later run clears without a code change, such as an operation the
   * provider will not serve as this atlas constructs it. Journalling it is what stops the next sync
   * re-attempting every settled call to be told the same thing again. A clearable failure is never journalled,
   * because re-attempting one is exactly what the next run is for.
   */
  readonly settledFailure?: { readonly code: string; readonly message: string };
  readonly complete: boolean;
  /** Whether an incomplete walk is incomplete for a reason a later run could clear. */
  readonly incompleteIsClearable: boolean;
  readonly empty: boolean;
  readonly declaredTotal: number | null;
  readonly pagesExhausted: boolean;
  readonly reason: string;
}

/**
 * The key one call is journalled under.
 *
 * The surface and the bound path alone do not describe the REQUEST — a query parameter appears in neither,
 * and this journal replays a settled failure rather than re-attempting it. So the operation's pinned request
 * contract is part of the key, which makes a contract change invalidate exactly the entries it affects and
 * nothing else: `requestContracts.ts`'s {@link jumpcloudContractFingerprint} has the measurement, and an
 * operation with no contract keeps a key that is unchanged byte for byte.
 *
 * @param surface the operation that was called
 * @param endpoint the BOUND path it was called at, which is what makes one fan-out call distinct
 * @returns the key, stable across runs because every part of it is
 */
export function resumeKey({ surface, endpoint }: { surface: string; endpoint: string }): string {
  const contract = jumpcloudContractFingerprint({ operation: surface });
  if (contract === null) {
    return `${surface}|${endpoint}`;
  }
  return `${surface}|${endpoint}|${contract}`;
}

/**
 * Where the journal lives, beside the generation it is building.
 *
 * @param directory the atlas directory
 * @returns the journal's absolute path
 */
export function jumpcloudResumePath({ directory }: { directory: string }): string {
  return join(directory, "_resume.jsonl");
}

/**
 * Read every call a previous run completed, at most once per call.
 *
 * A key seen twice keeps the LATER line and drops the earlier one AS IT READS, which is the same last-wins
 * the walk's own index computes — so nothing changes about which entry is used, and a superseded one is
 * never retained. That is not a micro-optimisation on this file: MEASURED on the live journal, a minority
 * of lines were re-appends of a key already present, yet because the System Insights families carried
 * repeated copies, those re-appends were most of the file's bytes rather than their share of its lines.
 * Deduplicating at
 * the read is what keeps peak heap proportional to the calls made rather than to the times they were
 * journalled.
 *
 * @param directory the atlas directory
 * @returns one entry per call, in first-seen key order, carrying the last line written for that key
 */
export function readJumpcloudResume({ directory }: { directory: string }): readonly JumpcloudResumeEntry[] {
  const path = jumpcloudResumePath({ directory });
  if (!existsSync(path)) {
    return [];
  }
  const entries = new Map<string, JumpcloudResumeEntry>();
  try {
    readJsonlLines({
      onLine: ({ line }) => {
        if (line.trim().length === 0) {
          return;
        }
        const parsed = parseResumeLine({ line });
        // An older build journalled clearably-incomplete walks. Skipping them here is what lets a paging
        // fix reach work a previous run cached, without throwing away the whole journal to get it.
        if (parsed !== null && !parsed.incompleteIsClearable) {
          entries.set(parsed.key, parsed);
        }
      },
      path,
    });
  } catch {
    // Whatever was delivered before the read failed is still work already done. Returning it is the same
    // judgement a malformed line gets one level down: redo the calls this journal could not describe, not
    // the tens of thousands it could.
    return [...entries.values()];
  }
  return [...entries.values()];
}

/**
 * The strict shape of one journal line.
 *
 * A schema rather than a cast: the journal is a file on disk, so a line is untrusted input even though this
 * module wrote it — an interrupted append leaves a truncated one, and a build that changes the shape leaves
 * an older one. Decoding is what turns either into "redo that one call" instead of a confident lie.
 */
const resumeEntrySchema = z
  .object({
    at: z.string().min(1),
    complete: z.boolean(),
    declaredTotal: z.number().nullable(),
    empty: z.boolean(),
    endpoint: z.string().min(1),
    incompleteIsClearable: z.boolean(),
    isRoot: z.boolean(),
    key: z.string().min(1),
    kind: z.string().min(1),
    pagesExhausted: z.boolean(),
    reason: z.string(),
    dropped: z
      .array(
        z
          .object({ pointer: z.string(), reason: z.enum(["secret-material", "ephemeral-token", "depth-limit"]) })
          .strict(),
      )
      .optional(),
    records: z.array(z.unknown()),
    settledFailure: z
      .object({ code: z.string().min(1), message: z.string() })
      .strict()
      .optional(),
    surface: z.string().min(1),
  })
  .strict();

/**
 * Parse one journal line, tolerating one that cannot be read.
 *
 * @param line the raw line
 * @returns the entry, or `null` when the line is unusable — that one call is simply redone
 */
function parseResumeLine({ line }: { line: string }): JumpcloudResumeEntry | null {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const parsed = resumeEntrySchema.safeParse(migrateLine({ fields: { ...value } }));
  if (!parsed.success) {
    return null;
  }
  // Spread rather than returned whole: `exactOptionalPropertyTypes` distinguishes an absent optional field
  // from one present and undefined, and Zod's inferred type carries the second. Both optional fields are
  // rebuilt the same way for that reason.
  const { settledFailure, dropped, ...rest } = parsed.data;
  const withFailure = settledFailure === undefined ? rest : { ...rest, settledFailure };
  return dropped === undefined ? withFailure : { ...withFailure, dropped };
}

/**
 * Whether a line an older build wrote read its surface's ROOT, recovered by comparing its endpoint to the
 * registry row's own path. A line naming no surface, or one the registry no longer holds, has no row to compare
 * against, so it is not recoverable as a root read — the same answer the migration gave such a line before.
 */
function olderBuildLineIsRoot({ surface, endpoint }: { surface: unknown; endpoint: unknown }): boolean {
  if (typeof surface !== "string") {
    return false;
  }
  const row = findJumpcloudSurface({ surface });
  if (row.isErr()) {
    return false;
  }
  return row.value.path === endpoint;
}

/**
 * Bring a line written by an older build up to the shape this one reads.
 *
 * Two migrations, and both are cheaper than the call they save. A line that stored `entities` instead of
 * `records` carries the projected records inside them, and its root-ness is recovered by comparing its
 * endpoint against the registry row's own path. A line with no `incompleteIsClearable` defaults an
 * incomplete read to CLEARABLE, which refuses a publication — the conservative direction, because the
 * alternative is publishing a short generation on the strength of a field an older build never wrote.
 *
 * @param fields the parsed line
 * @returns the line, migrated in place
 */
function migrateLine({ fields }: { fields: Record<string, unknown> }): Record<string, unknown> {
  const migrated: Record<string, unknown> = { ...fields };
  if (!Array.isArray(migrated["records"])) {
    const storedEntityRecords = recordsFromStoredEntities({ fields: migrated });
    if (storedEntityRecords !== null) {
      migrated["records"] = storedEntityRecords;
      migrated["isRoot"] = olderBuildLineIsRoot({ endpoint: migrated["endpoint"], surface: migrated["surface"] });
    }
  }
  delete migrated["entities"];
  delete migrated["providerIds"];
  if (typeof migrated["incompleteIsClearable"] !== "boolean") {
    migrated["incompleteIsClearable"] = migrated["complete"] !== true;
  }
  return migrated;
}

/**
 * The records an entity-shaped line carries, recovered from the entities it stored instead.
 *
 * An entity's Directory API channel holds exactly the projected record, so nothing is lost and no call has
 * to be made again. See this file's header on why the journal stopped storing entities at all.
 *
 * An entity carrying no Directory API `detail` at all is a line this build cannot recover a record from —
 * a stored `detail` of `null` is a record, an absent one is not — so the whole line is left unmigrated, its
 * schema refuses it, and that one call is redone, the same as any other malformed line.
 *
 * @param fields the parsed line
 * @returns the records, or `null` when the line carries neither shape or an entity it cannot read
 */
function recordsFromStoredEntities({ fields }: { fields: Record<string, unknown> }): readonly unknown[] | null {
  const entities = fields["entities"];
  if (!Array.isArray(entities)) {
    return null;
  }
  const records: unknown[] = [];
  for (const entity of entities) {
    const detail = field({
      key: "detail",
      value: field({ key: "directory-api", value: field({ key: "channels", value: entity }) }),
    });
    if (detail === undefined) {
      return null;
    }
    records.push(detail);
  }
  return records;
}

/**
 * One property of a value that may not be an object at all.
 *
 * @param value the value to read from
 * @param key the property name
 * @returns the property, or `undefined` when the value is not a plain object or does not carry it
 */
function field({ value, key }: { value: unknown; key: string }): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const fields: Record<string, unknown> = { ...value };
  return fields[key];
}

/**
 * Append one completed call to the journal.
 *
 * @param directory the atlas directory
 * @param entry the completed call; one whose incompleteness a later run could clear is NOT written
 * @returns nothing on success, or why the journal could not be written — which is fatal, because a sync
 *   that cannot journal is a sync that cannot resume, and a whole walk is not a thing to redo silently
 */
export function appendJumpcloudResume({
  directory,
  entry,
}: {
  directory: string;
  entry: JumpcloudResumeEntry;
}): Result<null> {
  if (entry.incompleteIsClearable) {
    return ok(null);
  }
  const path = jumpcloudResumePath({ directory });
  try {
    mkdirSync(dirname(path), { recursive: true });
    appendLines({ mode: 0o600, path, text: `${JSON.stringify(entry)}\n` });
    return ok(null);
  } catch (error: unknown) {
    return err(jumpcloudAtlasErrorLines({ error: JumpcloudAtlasErrors.resumeUnwritable({ cause: error, path }) }));
  }
}

/**
 * Remove the journal, once the generation it was building has been published.
 *
 * @param directory the atlas directory
 * @returns nothing; a journal that cannot be removed is reported by the caller as a warning rather than a
 *   failure, because the generation it describes is already on disk
 */
export function dropJumpcloudResume({ directory }: { directory: string }): Result<null> {
  try {
    rmSync(jumpcloudResumePath({ directory }), { force: true });
    return ok(null);
  } catch (error: unknown) {
    return err(jumpcloudAtlasErrorLines({ error: JumpcloudAtlasErrors.resumeUnremovable({ cause: error }) }));
  }
}
