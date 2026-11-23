/**
 * `rehearsal/last.json` under the staging root — the record of the most recent restore rehearsal, and the file
 * the `store-rehearsal-failed` monitor reads to decide whether the owner needs to hear about one.
 *
 * **A refused TARGET writes nothing.** Passing the live database's name, port or container is a caller's
 * mistake refused before anything ran; recording it as a failed rehearsal would put a card in front of the owner
 * about a backup that was never tested. Every other stop — no backup found, a container name already taken, a
 * download or restore that failed — is the rehearsal not happening, and IS recorded as `failed`.
 *
 * Freshness is the monitor's question, not this record's: a record that says `passed` three months ago is a
 * rehearsal that stopped running, and `src/monitor/evaluate.ts` fires on its age.
 */
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import { z } from "zod";

import { readJsonFile, writeJsonFile } from "#lib/jsonFile.js";

import { stagingRoot } from "./staging.js";

/** The most recent rehearsal, and whether it proved the backup restores. */
export interface RehearsalRecord {
  readonly status: "passed" | "failed";
  readonly atIso: string;
  /** The backup prefix it rehearsed, or `null` when it stopped before choosing one. */
  readonly prefix: string | null;
  /** Why it did not pass, one line each — empty when it passed. */
  readonly failures: readonly string[];
}

/** What a read of the record found: the record, no file at all, or a file that is not one. */
export type RehearsalRecordRead = RehearsalRecord | "absent" | "unreadable";

const rehearsalRecordSchema = z
  .object({
    atIso: z.iso.datetime(),
    failures: z.array(z.string()),
    prefix: z.string().min(1).nullable(),
    status: z.enum(["passed", "failed"]),
  })
  .strict();

/**
 * Where the record lives.
 *
 * @param home the Slopweaver home
 * @returns the path of `rehearsal/last.json`
 */
export function rehearsalRecordPath({ home }: { home: string }): string {
  return join(stagingRoot({ home }), "rehearsal", "last.json");
}

/**
 * Record the most recent rehearsal.
 *
 * @param home the Slopweaver home
 * @param record what happened
 */
export function writeRehearsalRecord({ home, record }: { home: string; record: RehearsalRecord }): void {
  const path = rehearsalRecordPath({ home });
  mkdirSync(join(path, ".."), { mode: 0o700, recursive: true });
  writeJsonFile({ path, value: record });
}

/**
 * Read the most recent rehearsal, or say which way the read failed.
 *
 * @param home the Slopweaver home
 * @returns the record, `"absent"` when none has ever run here, `"unreadable"` when the file is not a record
 */
export function readRehearsalRecord({ home }: { home: string }): RehearsalRecordRead {
  const path = rehearsalRecordPath({ home });
  if (!existsSync(path)) {
    return "absent";
  }
  const parsed = rehearsalRecordSchema.safeParse(readJsonFile({ path }));
  if (!parsed.success) {
    return "unreadable";
  }
  return parsed.data;
}
