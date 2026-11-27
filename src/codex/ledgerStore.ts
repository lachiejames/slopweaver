/**
 * Reading the pass ledger off disk. The effectful half of {@link ./ledger}.
 *
 * A scan, not an index. Every run directory under `$SLOPWEAVER_HOME/orchestration` is immutable and written
 * by exactly one process, so reading them concurrently with other sessions writing new ones is safe by
 * construction: there is no shared mutable state to lock, merge, or lose an update from.
 *
 * A directory is only counted once `artifact.md` exists, matching the publication order in
 * {@link ./artifactStore} — the sidecar lands first, so an artifact implies a complete directory.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { IngestError } from "../lib/ingestError.js";
import { ok, type Result } from "../lib/result.js";
import { safeFs } from "../lib/safeBoundary.js";
import { RECORD_FILENAME } from "./artifactStore.js";
import { originRepositoryField } from "./originBinding.js";
import type { CodexArtifactRecord } from "./types.js";

/** What a scan found, including what it could not read. */
export interface LedgerScan {
  readonly records: readonly CodexArtifactRecord[];
  /**
   * Finished passes whose sidecar is present but will not parse.
   *
   * Alarming, and deliberately kept apart from {@link withoutSidecar}. Reported rather than skipped, because
   * silently dropping one makes a corrupt pass indistinguishable from a pass that never ran — and "no passes
   * ran" is precisely the false statement this ledger exists to prevent.
   */
  readonly unreadable: number;
  /**
   * Finished passes written before the sidecar existed, so there is nothing to read.
   *
   * Ordinary, not a fault. Folding these into {@link unreadable} would print an alarming count that never
   * goes down — 242 of the author's 247 historical passes predate this — and a permanent warning is one
   * nobody reads. Separating them keeps a genuinely corrupt record visible.
   */
  readonly withoutSidecar: number;
}

/**
 * Read every pass record under an orchestration root.
 *
 * @param orchestrationRoot `$SLOPWEAVER_HOME/orchestration`
 * @returns the records that parsed, plus a count of finished passes that did not; a root that was never
 *   created reads as an empty ledger (no record under this home), any other filesystem failure stays an error
 */
export function scanPassRecords({ orchestrationRoot }: { orchestrationRoot: string }): Result<LedgerScan, IngestError> {
  const scan = scanExistingRoot({ orchestrationRoot });
  if (scan.isErr() && scan.error.code === "ENOENT") {
    return ok({ records: [], unreadable: 0, withoutSidecar: 0 });
  }
  return scan;
}

/** The scan itself, failing with the root's own errno when it cannot be listed. */
function scanExistingRoot({ orchestrationRoot }: { orchestrationRoot: string }): Result<LedgerScan, IngestError> {
  return safeFs({
    execute: (): LedgerScan => {
      const records: CodexArtifactRecord[] = [];
      let unreadable = 0;
      let withoutSidecar = 0;
      for (const entry of readdirSync(orchestrationRoot, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.name.endsWith(".scratch")) {
          continue;
        }
        const runDir = join(orchestrationRoot, entry.name);
        if (!exists({ path: join(runDir, "artifact.md") })) {
          continue;
        }
        const recordPath = join(runDir, RECORD_FILENAME);
        if (!exists({ path: recordPath })) {
          withoutSidecar += 1;
          continue;
        }
        const record = readRecord({ path: recordPath });
        if (record === undefined) {
          unreadable += 1;
          continue;
        }
        records.push(record);
      }
      return { records, unreadable, withoutSidecar };
    },
    operation: "codex.scanPassRecords",
    path: orchestrationRoot,
  });
}

/**
 * Whether a string has the shape every pass's artifact id has: a directory name, never a path.
 *
 * @param artifactId the candidate id, from a flag or a stored row
 * @returns true when it is one bare name of letters, digits, `_` and `-`, starting with a letter or digit
 */
export function isArtifactIdShape({ artifactId }: { artifactId: string }): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(artifactId);
}

/**
 * Read ONE pass record by artifact id, with the same shallow decode the scan applies.
 *
 * An id is a directory name, never a path: anything carrying a separator or a dot-segment is refused before
 * the filesystem is touched, so a caller's flag cannot reach outside the orchestration root.
 *
 * @param orchestrationRoot `$SLOPWEAVER_HOME/orchestration`
 * @param artifactId the pass's id, as `codex status` and the artifact print it
 * @returns the record, or `undefined` when the id names no readable record
 */
export function readPassRecord({
  orchestrationRoot,
  artifactId,
}: {
  orchestrationRoot: string;
  artifactId: string;
}): CodexArtifactRecord | undefined {
  if (!isArtifactIdShape({ artifactId })) {
    return undefined;
  }
  return readRecord({ path: join(orchestrationRoot, artifactId, RECORD_FILENAME) });
}

/** Whether a path exists, without throwing on the ordinary "it does not" case. */
function exists({ path }: { path: string }): boolean {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Parse one sidecar, returning `undefined` rather than throwing.
 *
 * An unparseable record must not abort the scan: one corrupt directory out of hundreds would otherwise take
 * the whole ledger down, and a ledger that refuses to render is worse than one that says "3 unreadable".
 * The shape check is deliberately shallow — enough to know the fields the ledger reads are present, not a
 * full schema validation, because this reads files this same module wrote.
 */
function readRecord({ path }: { path: string }): CodexArtifactRecord | undefined {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    return isRecordShaped(parsed) ? withValidatedOrigin({ record: parsed }) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The record with its `originRepository` kept only when it is a well-formed `owner/name` slug, so a malformed
 * binding reads as ABSENT — unable to re-prove a deleted checkout — and never as a match (`./originBinding.ts`).
 */
function withValidatedOrigin({ record }: { record: CodexArtifactRecord }): CodexArtifactRecord {
  const { originRepository, ...rest } = record;
  return { ...rest, ...originRepositoryField({ value: originRepository }) };
}

/** The fields the ledger actually reads, present and of the right kind. */
function isRecordShaped(value: unknown): value is CodexArtifactRecord {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<Record<keyof CodexArtifactRecord, unknown>>;
  return (
    typeof candidate.artifactId === "string" &&
    typeof candidate.createdAtIso === "string" &&
    typeof candidate.scope === "object" &&
    candidate.scope !== null &&
    typeof candidate.outcome === "object" &&
    candidate.outcome !== null
  );
}
