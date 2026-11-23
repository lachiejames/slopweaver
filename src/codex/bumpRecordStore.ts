/**
 * The bump records in the state home: one write-once `<digest>.json` per ratchet bump, under
 * `stateHomePaths().baselineBumps`. A record has exactly the shape a committed manifest had
 * (`../devLint/baselineBump.ts`), so its digest, witness property id and claim are the same ones — only where it
 * is kept moved, by the owner's ruling: the rules and counts stay in the code, each allowed exception lives in the
 * home beside the Codex verdict on it.
 *
 * ## Fail closed
 *
 * An absent directory is no records — a home that never declared a bump, which can only refuse a loosening,
 * never clear one. Anything else that stops a read is an error for the WHOLE read, never a partial list: a
 * directory that will not list, a record that will not read, one that is not a manifest, one filed under a name
 * its own digest does not give, any entry not named `<64 hex>.json`. The landing read refuses on every one,
 * because a record it could not read may be the one that declares, or a BROKEN review contradicts, what the pull
 * request loosens. The one name passed over is a dot-prefixed staging file {@link writeBumpRecord} leaves if it
 * dies between staging and publishing: never published, so never a record.
 *
 * ## Write once
 *
 * A record is never replaced. Its digest covers the base and the rows but not the reason, so a second declaration
 * of the same rows against the same base in other words would otherwise rewrite the reason a witness already
 * judged. The write stages the bytes durably, then PUBLISHES them with a hard link, which fails when the name is
 * taken — atomic and exclusive at once, where a rename would silently replace the record.
 */

import { randomUUID } from "node:crypto";
import { existsSync, linkSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { err, ok, type Result } from "#lib/result.js";
import { writeFileAtomic } from "#lib/writeAtomic.js";
import { BUMP_RECORD_HOME_DIR, type BumpManifest, parseBumpManifest } from "../devLint/baselineBump.js";
import type { NewManifest } from "../devLint/baselineComparison.js";
import { stateHomePaths } from "../stateHome.js";

/**
 * One record read from the home: where it is kept relative to the home (`ledgers/baseline-bumps/<digest>.json`,
 * what a refusal prints) and the manifest. The same shape the comparison names, one definition, so the witness's
 * pure half (`./baselineBumpWitness.ts`) takes either without a policy-file edit.
 */
export type BumpRecord = NewManifest;

/** Why the bump records could not be read or one could not be written. */
export interface BumpRecordStoreError {
  readonly code: "BUMP_RECORDS_UNREADABLE" | "BUMP_RECORD_INVALID" | "BUMP_RECORD_EXISTS" | "BUMP_RECORD_UNWRITABLE";
  readonly message: string;
  readonly path: string;
}

/** The message a thrown cause carries. */
const causeText = ({ cause }: { cause: unknown }): string => (cause instanceof Error ? cause.message : String(cause));

/** The factory every store failure is built through. */
export const BumpRecordStoreErrors = {
  exists: ({ path }: { path: string }): BumpRecordStoreError => ({
    code: "BUMP_RECORD_EXISTS",
    message: `${path} already exists — the same rows are already declared against the same base`,
    path,
  }),
  invalid: ({ path, detail }: { path: string; detail: string }): BumpRecordStoreError => ({
    code: "BUMP_RECORD_INVALID",
    message: `${path}: ${detail}`,
    path,
  }),
  unreadable: ({ path, cause }: { path: string; cause: unknown }): BumpRecordStoreError => ({
    code: "BUMP_RECORDS_UNREADABLE",
    message: `${path} could not be read: ${causeText({ cause })}`,
    path,
  }),
  unwritable: ({ path, cause }: { path: string; cause: unknown }): BumpRecordStoreError => ({
    code: "BUMP_RECORD_UNWRITABLE",
    message: `${path} could not be written: ${causeText({ cause })}`,
    path,
  }),
} as const;

/** The one name a published record may carry. */
const RECORD_NAME = /^[0-9a-f]{64}\.json$/u;

/**
 * A record's path relative to the home, from its file name. Pure.
 *
 * @param name the record's file name
 * @returns `ledgers/baseline-bumps/<name>`
 */
export function bumpRecordPath({ name }: { name: string }): string {
  return `${BUMP_RECORD_HOME_DIR}${name}`;
}

/**
 * Every bump record in the home, each decoded and checked, in file-name order. IO edge.
 *
 * @param home the state home
 * @returns the records, or the first reason one could not be read — never a partial list
 */
export function readBumpRecords({ home }: { home: string }): Result<readonly BumpRecord[], BumpRecordStoreError> {
  const dir = stateHomePaths({ home }).baselineBumps;
  if (!existsSync(dir)) {
    return ok([]);
  }
  let names: readonly string[];
  try {
    names = readdirSync(dir).toSorted();
  } catch (cause) {
    return err(BumpRecordStoreErrors.unreadable({ cause, path: BUMP_RECORD_HOME_DIR }));
  }
  const out: BumpRecord[] = [];
  for (const name of names.filter((one) => !one.startsWith("."))) {
    const path = bumpRecordPath({ name });
    if (!RECORD_NAME.test(name)) {
      return err(BumpRecordStoreErrors.invalid({ detail: "not a bump record (every record is <digest>.json)", path }));
    }
    let text: string;
    try {
      text = readFileSync(join(dir, name), "utf8");
    } catch (cause) {
      return err(BumpRecordStoreErrors.unreadable({ cause, path }));
    }
    const manifest = parseBumpManifest({ name, path, text });
    if (manifest.isErr()) {
      return err(BumpRecordStoreErrors.invalid({ detail: manifest.error.message, path }));
    }
    out.push({ manifest: manifest.value, path });
  }
  return ok(out);
}

/**
 * Write one record under its own digest, refusing a name already taken. IO edge.
 *
 * @param home the state home
 * @param manifest the declaration; its digest names the file
 * @returns the record as written, or why it was not
 */
export function writeBumpRecord({
  home,
  manifest,
}: {
  home: string;
  manifest: BumpManifest;
}): Result<BumpRecord, BumpRecordStoreError> {
  const dir = stateHomePaths({ home }).baselineBumps;
  const name = `${manifest.digest}.json`;
  const path = bumpRecordPath({ name });
  const staged = join(dir, `.${manifest.digest}.${randomUUID()}.staging`);
  try {
    mkdirSync(dir, { recursive: true });
    writeFileAtomic({ contents: `${JSON.stringify(manifest, null, 2)}\n`, path: staged });
    linkSync(staged, join(dir, name));
  } catch (cause) {
    const taken = cause instanceof Error && "code" in cause && cause.code === "EEXIST";
    return err(taken ? BumpRecordStoreErrors.exists({ path }) : BumpRecordStoreErrors.unwritable({ cause, path }));
  } finally {
    rmSync(staged, { force: true });
  }
  return ok({ manifest, path });
}
