/**
 * The pure half of the shared debt-list ratchet (`./countRatchet.ts` carries why it is shared, and the IO edge):
 * decoding a committed debt list, the two comparisons against it, and which way the edge goes once a scope has
 * been scanned. Nothing here reads a file or prints, so every property the ratchet enforces is unit-tested here.
 */

import { z } from "zod";
import { parseJson } from "../lib/jsonParse.js";
import { err, ok, type Result } from "../lib/result.js";

/**
 * One counted path — a file or a directory — and how many refused sites stand under it. A gate counting several
 * classes of site in one file names the class as `kind`, and `(path, kind)` is then the entry's identity, so a site
 * of one class removed never pays for a site of another class added in the same file.
 */
export interface CountEntry {
  readonly path: string;
  readonly kind?: string | undefined;
  readonly count: number;
}

/** One counted entry that is new against the debt list, or whose count grew. */
export interface CountRegression {
  readonly path: string;
  readonly kind?: string | undefined;
  readonly count: number;
  readonly baselineCount: number | undefined;
}

/** A path-only entry: any other field is stripped, so a stray `kind` can never change a path-only gate's identity. */
const pathEntriesSchema = z.array(z.object({ count: z.number().int().nonnegative(), path: z.string().min(1) }));

/** A kinded entry, for a gate whose identity is `(path, kind)`; a row with no kind is still read as path-only. */
const kindedEntriesSchema = z.array(
  z.object({ count: z.number().int().nonnegative(), kind: z.string().min(1).optional(), path: z.string().min(1) }),
);

/**
 * An entry's identity: its path, or its path and kind. A NUL joins them, since no path carries one.
 *
 * @param entry the entry, or a hit's path and kind spelled as one
 * @returns the string two entries share exactly when they are the same entry
 */
export function countEntryKey({ entry }: { entry: { path: string; kind?: string | undefined } }): string {
  return entry.kind === undefined ? entry.path : `${entry.path}\u0000${entry.kind}`;
}

/** An entry's kind as a field to spread, absent for a path-only entry so its row keeps its old shape exactly. */
const kindOf = ({ entry }: { entry: CountEntry }): { kind?: string } =>
  entry.kind === undefined ? {} : { kind: entry.kind };

/**
 * How a report names an entry: its path, then its kind in brackets when it has one.
 *
 * @param entry a debt row or regression, path-only or kinded
 * @returns the label a refusal line prints
 */
export function countEntryLabel({ entry }: { entry: { path: string; kind?: string | undefined } }): string {
  return entry.kind === undefined ? entry.path : `${entry.path} [${entry.kind}]`;
}

/** The debt list named a path nothing could read it from. */
export interface BaselineUnreadableError {
  readonly code: "BASELINE_UNREADABLE";
  readonly message: string;
  readonly path: string;
}

/** The debt list was read and is not a list of counted paths. */
export interface BaselineMalformedError {
  readonly code: "BASELINE_MALFORMED";
  readonly message: string;
  readonly gate: string;
}

/**
 * Why a committed debt list could not be turned into entries. A typed union rather than two plain strings
 * BECAUSE of the gate next door: `src/devLint` is long past `error-shape-threshold`'s four-shape threshold,
 * so a new module there authoring plain messages fails it. That is the rule working rather than a
 * workaround — a domain past the line declares its union (`error-handling.md`), and this module measured
 * that refusal on its own first lap.
 */
export type CountBaselineError = BaselineUnreadableError | BaselineMalformedError;

/** The factory every failure here is built through, so a test constructs one the way the code does. */
export const CountBaselineErrors = {
  malformed: ({ gate, detail }: { gate: string; detail: string }): BaselineMalformedError => ({
    code: "BASELINE_MALFORMED",
    gate,
    message: `${gate} debt list: ${detail}`,
  }),
  unreadable: ({ path }: { path: string }): BaselineUnreadableError => ({
    code: "BASELINE_UNREADABLE",
    message: `debt list missing or unreadable at ${path}`,
    path,
  }),
} as const;

/**
 * Decode a committed debt list, whose entries sit under one named array key. Pure.
 *
 * @param text the debt list's file text
 * @param gate the gate's own name, so a reader of the error knows whose list would not parse
 * @param key the array key the gate's list uses — `sites`, `directories`
 * @param kinded whether the gate's identity is `(path, kind)`; a path-only gate strips any `kind` it meets
 * @returns the decoded entries, or why they could not be read
 */
export function parseCountBaseline({
  text,
  gate,
  key,
  kinded,
}: {
  text: string;
  gate: string;
  key: string;
  kinded: boolean;
}): Result<readonly CountEntry[], CountBaselineError> {
  const parsed = parseJson({ text });
  if (parsed.isErr()) {
    return err(CountBaselineErrors.malformed({ detail: parsed.error.message, gate }));
  }
  const unexpected = CountBaselineErrors.malformed({
    detail: `unexpected shape (expected { ${key}: [{ path, count }] })`,
    gate,
  });
  const envelope = z.record(z.string(), z.unknown()).safeParse(parsed.value);
  if (!envelope.success) {
    return err(unexpected);
  }
  const decoded = (kinded ? kindedEntriesSchema : pathEntriesSchema).safeParse(envelope.data[key]);
  if (!decoded.success) {
    return err(unexpected);
  }
  return ok(decoded.data);
}

/**
 * Every current entry that is NEW (absent from the debt list) or WORSE (a higher count than its entry).
 * Pure — the property every gate built on this module actually enforces.
 *
 * @param current every counted path standing now
 * @param baseline the committed debt list's entries
 * @returns each regression, in `current`'s order (empty when the ratchet holds)
 */
export function countRegressionsOf({
  current,
  baseline,
}: {
  current: readonly CountEntry[];
  baseline: readonly CountEntry[];
}): readonly CountRegression[] {
  const floor = new Map(baseline.map((entry) => [countEntryKey({ entry }), entry.count]));
  const regressions: CountRegression[] = [];
  for (const entry of current) {
    const baselineCount = floor.get(countEntryKey({ entry }));
    if (baselineCount === undefined || entry.count > baselineCount) {
      regressions.push({ baselineCount, count: entry.count, ...kindOf({ entry }), path: entry.path });
    }
  }
  return regressions;
}

/**
 * Every regression that already had an entry and got WORSE. Pure — what `--rebaseline` refuses,
 * deliberately narrower than {@link countRegressionsOf}: a brand-new entry is a legitimate addition to a
 * widening list, never a reason to refuse tightening the ones that grew.
 *
 * @param regressions the full regression list
 * @returns only the entries that had a count on the debt list and exceeded it
 */
export function countWorseningsOf({
  regressions,
}: {
  regressions: readonly CountRegression[];
}): readonly CountRegression[] {
  return regressions.filter((one) => one.baselineCount !== undefined);
}

/**
 * Every debt entry whose count stands ABOVE what the scan found now, an entry the scan no longer counts reading as
 * zero. Pure — what an exact-debt gate refuses, because a floor left above the truth is room a later change can
 * spend on new hits while the gate still reads clean: remove ten, skip the rebaseline, and ten new ones pass. An
 * entry's second and later rows are slack too, so a list with a repeat is never exact.
 *
 * @param current every counted path standing now
 * @param baseline the committed debt list's entries
 * @param unread paths the scan could not read, whose count is unknown rather than zero, so never called slack
 * @returns each slack entry, as a regression-shaped row whose `count` is what stands now, in the debt list's order
 */
export function countSlackOf({
  current,
  baseline,
  unread,
}: {
  current: readonly CountEntry[];
  baseline: readonly CountEntry[];
  unread: readonly string[];
}): readonly CountRegression[] {
  // Every debt entry starts at zero, then what the scan counted overwrites it: an entry it no longer counts stays 0.
  const standing = new Map(baseline.map((entry) => [countEntryKey({ entry }), 0]));
  for (const entry of current) {
    standing.set(countEntryKey({ entry }), entry.count);
  }
  // Unread is a PATH: a file nobody could read leaves every kind under it unknown.
  const unknown = new Set(unread);
  const seen = new Set<string>();
  const slack: CountRegression[] = [];
  for (const entry of baseline.filter((one) => !unknown.has(one.path))) {
    const key = countEntryKey({ entry });
    const now = standing.get(key)!;
    // A second row for one entry is never what `--rebaseline` writes, so the list is not exact: refuse the repeat.
    const repeat = seen.has(key);
    seen.add(key);
    if (repeat || now < entry.count) {
      slack.push({ baselineCount: entry.count, count: now, ...kindOf({ entry }), path: entry.path });
    }
  }
  return slack;
}

/** What the IO edge does once a scope has been scanned and judged. */
export type CountRatchetAction = "refuse-incomplete" | "rebaseline" | "compare";

/**
 * Which way the ratchet goes. An incomplete scan never writes the debt list: the files it could not read may hold
 * the very sites — or, for a resolving gate, the very exports another file's sites resolve through — that would
 * keep an entry on it. Pure.
 *
 * @param complete whether every file in scope was read
 * @param rebaseline whether `--rebaseline` was asked for
 * @param regressions how many entries are new or grew against the committed list
 * @returns refuse on an unreadable file (once the regressions are printed, when there are any), otherwise rebaseline
 *   or compare as asked
 */
export function countRatchetAction({
  complete,
  rebaseline,
  regressions,
}: {
  complete: boolean;
  rebaseline: boolean;
  regressions: number;
}): CountRatchetAction {
  if (!complete && (rebaseline || regressions === 0)) {
    return "refuse-incomplete";
  }
  if (rebaseline) {
    return "rebaseline";
  }
  return "compare";
}
