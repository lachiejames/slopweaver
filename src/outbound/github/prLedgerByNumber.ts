/**
 * The PR ledger read by pull-request NUMBER — what `fleet landed` needs to join a squash commit on main to the form
 * its description was rendered from.
 *
 * Records are named by a digest of their branch locus (`./prLedger.ts`), so nothing addresses one by number: each
 * file is read and its own `locus` and `number` compared. MEASURED: 2,392 records, 11.3 MB, 0.80s to read
 * whole — repro `time cat ~/.slopweaver/ledgers/github-prs/*.json | wc -c`. Only a record that matches is decoded
 * against the form schema, so the cost is the read, never 2,392 schema evaluations.
 *
 * **The repository is part of the key, never the number alone.** The same ledger holds this checkout's `origin` and
 * its personal remote, and their numbers collide. Two records claiming one number in one repository are reported
 * as AMBIGUOUS rather than one picked, because a guess here puts the wrong proof beside a change.
 *
 * **A form that will not decode is said, never read as absent.** `parsePrRecord` drops such a form, which is right
 * for a cache and wrong for a page saying what proof a change carried: "no proof recorded" and "a proof that no
 * longer reads" are different claims.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { isRecord } from "../../lib/parsers.js";
import { ledgerDir } from "./prLedger.js";
import { storedPrFormSchema } from "./schema.js";
import type { PrForm } from "./types.js";

/** What the ledger holds of one record's form. */
export type LedgerForm =
  | { readonly kind: "decoded"; readonly form: PrForm }
  | { readonly kind: "absent" }
  | { readonly kind: "undecodable"; readonly why: string };

/** One number's record, or the count of records that claimed it. */
export type PrLedgerHit =
  | { readonly kind: "one"; readonly locus: string; readonly form: LedgerForm }
  | { readonly kind: "ambiguous"; readonly count: number };

/** The decoded fields a match needs, read before any schema runs. */
export interface RawRecord {
  readonly locus: string;
  readonly number: number;
  readonly form: unknown;
}

/** A ledger file that would not read as a record, and why — any one of them may be the record a number wanted. */
export interface LedgerFileUnread {
  readonly file: string;
  readonly why: string;
}

/** One file as read: a numbered record, a reservation that has no number yet, or why it would not read. */
export type RawRecordRead =
  | { readonly kind: "record"; readonly record: RawRecord }
  | { readonly kind: "reservation" }
  | { readonly kind: "unread"; readonly why: string };

/** The ledger read for some numbers, or why its directory would not list. */
export type PrLedgerRead =
  | {
      readonly kind: "read";
      readonly hits: ReadonlyMap<number, PrLedgerHit>;
      readonly unread: readonly LedgerFileUnread[];
    }
  | { readonly kind: "unreadable"; readonly why: string };

/**
 * One file's locus, number and raw form. A record with no `number` is a reservation — the create is not yet confirmed
 * (`./prLedger.ts`) — and is legitimately unnumbered; anything else that does not carry both is unread, never skipped.
 *
 * @param raw the file's text
 * @returns the record, that it is a reservation, or why it would not read
 */
export function rawRecordOf({ raw }: { raw: string }): RawRecordRead {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error: unknown) {
    return { kind: "unread", why: `not JSON: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (!isRecord(parsed)) {
    return { kind: "unread", why: "not a JSON object" };
  }
  const locus = parsed["locus"];
  const number = parsed["number"];
  if (typeof locus !== "string") {
    return { kind: "unread", why: "carries no locus" };
  }
  if (number === undefined) {
    return { kind: "reservation" };
  }
  if (typeof number !== "number") {
    return { kind: "unread", why: `its number is not a number (${locus})` };
  }
  return { kind: "record", record: { form: parsed["form"], locus, number } };
}

/**
 * Decode a stored form, saying which of the three states it is in.
 *
 * @param form the record's raw `form` value
 * @returns the decoded form, its absence, or why it does not decode
 */
export function ledgerFormOf({ form }: { form: unknown }): LedgerForm {
  if (form === undefined) {
    return { kind: "absent" };
  }
  const parsed = storedPrFormSchema.safeParse(form);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    let why = "the stored form does not match the form schema";
    if (first !== undefined) {
      why = `the stored form does not decode at ${first.path.join(".")}: ${first.message}`;
    }
    return { kind: "undecodable", why };
  }
  return { form: parsed.data, kind: "decoded" };
}

/**
 * Index raw records by number for one repository — the pure half, so the ambiguity rule is testable without files.
 *
 * @param records every record read, in any order
 * @param repo `owner/name`, compared case-insensitively as the locus stores it
 * @param numbers the numbers wanted
 * @returns one hit per wanted number the ledger holds
 */
export function indexLedgerByNumber({
  records,
  repo,
  numbers,
}: {
  records: readonly RawRecord[];
  repo: string;
  numbers: ReadonlySet<number>;
}): ReadonlyMap<number, PrLedgerHit> {
  const prefix = `${repo.toLowerCase()}#`;
  const matches = new Map<number, RawRecord[]>();
  for (const record of records) {
    if (!record.locus.toLowerCase().startsWith(prefix) || !numbers.has(record.number)) {
      continue;
    }
    const same = matches.get(record.number);
    if (same === undefined) {
      matches.set(record.number, [record]);
    } else {
      same.push(record);
    }
  }
  const hits = new Map<number, PrLedgerHit>();
  for (const [number, same] of matches) {
    const only = same[0]!;
    if (same.length > 1) {
      hits.set(number, { count: same.length, kind: "ambiguous" });
    } else {
      hits.set(number, { form: ledgerFormOf({ form: only.form }), kind: "one", locus: only.locus });
    }
  }
  return hits;
}

/** A thrown value's message, or the value itself as text. */
function causeText({ cause }: { cause: unknown }): string {
  if (cause instanceof Error) {
    return cause.message;
  }
  return String(cause);
}

/** Every named ledger file read: the records it holds, and each file that would not read with why. */
function readLedgerFiles({ dir, names }: { dir: string; names: readonly string[] }): {
  records: RawRecord[];
  unread: LedgerFileUnread[];
} {
  const records: RawRecord[] = [];
  const unread: LedgerFileUnread[] = [];
  for (const name of names) {
    let raw: string;
    try {
      raw = readFileSync(join(dir, name), "utf8");
    } catch (error: unknown) {
      unread.push({ file: name, why: causeText({ cause: error }) });
      continue;
    }
    const read = rawRecordOf({ raw });
    if (read.kind === "record") {
      records.push(read.record);
    } else if (read.kind === "unread") {
      unread.push({ file: name, why: read.why });
    }
  }
  return { records, unread };
}

/**
 * The ledger's records for some numbers in one repository.
 *
 * An absent ledger directory is an empty ledger: a home where slopweaver never opened a pull request holds no
 * proof for any, which is what every entry then says. A directory that exists and will not list is NOT that, and
 * neither is a file that will not read: each is returned as unread, because a record that could not be read is one
 * whose number nobody knows, and "the ledger holds no record" would then name the wrong step.
 *
 * @param home the state home
 * @param repo `owner/name`
 * @param numbers the pull-request numbers wanted
 * @returns one hit per number the ledger holds and every file that would not read, or why the directory would not
 */
export function readPrRecordsFor({
  home,
  repo,
  numbers,
}: {
  home: string;
  repo: string;
  numbers: ReadonlySet<number>;
}): PrLedgerRead {
  const dir = ledgerDir({ home });
  let names: readonly string[];
  try {
    names = readdirSync(dir).filter((name) => name.endsWith(".json"));
  } catch (error: unknown) {
    if (isRecord(error) && error["code"] === "ENOENT") {
      return { hits: new Map(), kind: "read", unread: [] };
    }
    return { kind: "unreadable", why: causeText({ cause: error }) };
  }
  const { records, unread } = readLedgerFiles({ dir, names });
  return { hits: indexLedgerByNumber({ numbers, records, repo }), kind: "read", unread };
}
