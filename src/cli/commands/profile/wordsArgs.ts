/**
 * What `slopweaver profile words`' flags mean — pure, so every refusal and every window is decidable in a unit test.
 *
 * Two modes: a LIST over a window, or one ANCHOR read whole. The anchor mode refuses every list flag rather than
 * ignoring it, because `profile words talk:… --phrase x` asks two questions and would answer only one.
 */
import { err, ok, type Result } from "#lib/result.js";

import type { OwnerWordsHow } from "../../../profile/ownerWords.js";
import { phraseWords } from "../../../talk/supervisorHistory.js";
import { type FlagSpec, parseFlags } from "../../parseFlags.js";

/** The flags `profile words` takes. */
const WORDS_FLAGS = {
  boolean: ["full", "json"],
  string: ["phrase", "since", "until", "how", "limit", "home", "now"],
} satisfies FlagSpec;

/** `--`-prefixed, for the help-truth ratchet. */
export const PROFILE_WORDS_FLAG_NAMES: readonly string[] = [...WORDS_FLAGS.string, ...WORDS_FLAGS.boolean]
  .map((name) => `--${name}`)
  .toSorted();

/** The flags only a list takes. */
const LIST_ONLY = ["phrase", "since", "until", "how", "limit", "full", "now"] as const;

/** How far back a list reads when `--since` is not given. */
const DEFAULT_SINCE = "7d";

/** How many turns a list shows when `--limit` is not given. */
const DEFAULT_LIMIT = 20;

/** The most a list shows: past this a reader wants `--phrase` or a narrower window, not a longer page. */
const MAX_WORDS_LIMIT = 500;

/** `--since` as a span back from now: a whole number of days or hours. */
const RELATIVE = /^(\d+)([dh])$/u;

/** Milliseconds in an hour and in a day. */
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** A parsed `profile words`. */
export interface ProfileWordsArgs {
  readonly anchor: string | undefined;
  readonly phrase: string | undefined;
  readonly since: string;
  readonly until: string | undefined;
  readonly how: OwnerWordsHow | undefined;
  readonly limit: number;
  readonly full: boolean;
  readonly json: boolean;
  readonly home: string | undefined;
  readonly now: string | undefined;
}

/** A string flag's value, or `undefined` when it was not typed. */
function stringFlag({ values, name }: { values: Readonly<Record<string, unknown>>; name: string }): string | undefined {
  const value = values[name];
  if (typeof value === "string") {
    return value;
  }
  return undefined;
}

/** `--how`, or the sentence refusing it. */
function howOf({ raw }: { raw: string | undefined }): { readonly how: OwnerWordsHow | undefined } | string {
  if (raw === undefined) {
    return { how: undefined };
  }
  if (raw === "spoken" || raw === "written") {
    return { how: raw };
  }
  return `--how ${raw} is neither spoken nor written`;
}

/** `--limit`, or the sentence refusing it. */
function limitOf({ raw }: { raw: string | undefined }): { readonly limit: number } | string {
  if (raw === undefined) {
    return { limit: DEFAULT_LIMIT };
  }
  const limit = Number(raw);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_WORDS_LIMIT) {
    return `--limit ${raw} is not a whole number from 1 to ${String(MAX_WORDS_LIMIT)}`;
  }
  return { limit };
}

/**
 * Parse `profile words`' flag tail.
 *
 * @param rest the argv after `profile words`
 * @returns the arguments, or every reason they were refused
 */
export function parseProfileWordsArgs({ rest }: { rest: readonly string[] }): Result<ProfileWordsArgs> {
  const parsed = parseFlags({ allowPositionals: true, args: rest, spec: WORDS_FLAGS });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { positionals, values } = parsed.value;
  const problems: string[] = [];
  if (positionals.length > 1) {
    problems.push(`one anchor at a time — got ${String(positionals.length)}`);
  }
  const anchor = positionals[0];
  const listFlags = LIST_ONLY.filter((name) => values[name] !== undefined);
  if (anchor !== undefined && listFlags.length > 0) {
    const named = listFlags.map((name) => `--${name}`).join(", ");
    problems.push(`an anchor is read whole, so ${named} cannot be given with it`);
  }
  const how = howOf({ raw: stringFlag({ name: "how", values }) });
  const limit = limitOf({ raw: stringFlag({ name: "limit", values }) });
  const now = stringFlag({ name: "now", values });
  if (now !== undefined && !isIsoInstant({ value: now })) {
    problems.push(`--now ${now} is not an instant`);
  }
  [how, limit].forEach((one) => {
    if (typeof one === "string") {
      problems.push(one);
    }
  });
  const phrase = stringFlag({ name: "phrase", values });
  let since = DEFAULT_SINCE;
  const sinceFlag = stringFlag({ name: "since", values });
  if (sinceFlag !== undefined) {
    since = sinceFlag;
  }
  const until = stringFlag({ name: "until", values });
  problems.push(...phraseProblems({ phrase }), ...boundProblems({ since, until }));
  if (problems.length > 0 || typeof how === "string" || typeof limit === "string") {
    return err(problems);
  }
  return ok({
    anchor,
    full: values["full"] === true,
    home: stringFlag({ name: "home", values }),
    how: how.how,
    json: values["json"] === true,
    limit: limit.limit,
    now,
    phrase,
    since,
    until,
  });
}

/**
 * Why `--phrase` cannot narrow anything: blank, or only words `phraseWords` drops as too common to search on — every
 * word of an empty set is in every turn, so either would list them all as matches.
 */
function phraseProblems({ phrase }: { phrase: string | undefined }): readonly string[] {
  if (phrase === undefined || phraseWords({ phrase }).length > 0) {
    return [];
  }
  if (phrase.trim() === "") {
    return ["--phrase is empty — leave it off to list every turn"];
  }
  return [`--phrase ${phrase} holds only words too common to search on — name something they would have said`];
}

/** An ISO-8601 date-time with its zone: `YYYY-MM-DDTHH:MM[:SS[.fff]]` then `Z` or `±HH:MM`. */
const ISO_INSTANT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(?:Z|[+-](\d{2}):(\d{2}))$/u;

/**
 * Whether a flag's value is an ISO instant as the usage promises, every field in range. `Date.parse` alone takes `0`,
 * `10/05/2026` and rolls `1999-02-30` into March, so each would query a window nobody asked for.
 *
 * @param value the flag's value
 * @returns whether it names exactly one real instant
 */
function isIsoInstant({ value }: { value: string }): boolean {
  const parts = ISO_INSTANT.exec(value);
  if (parts === null) {
    return false;
  }
  const [year, month, day, hour, minute, second, zoneHour, zoneMinute] = parts.slice(1).map(Number);
  const calendar = new Date(Date.UTC(year!, month! - 1, day));
  const dayReal = calendar.getUTCMonth() === month! - 1 && calendar.getUTCDate() === day;
  const clockReal = hour! < 24 && minute! < 60 && (Number.isNaN(second) || second! < 60);
  const zoneReal = Number.isNaN(zoneHour) || (zoneHour! < 24 && zoneMinute! < 60);
  return dayReal && clockReal && zoneReal && !Number.isNaN(Date.parse(value));
}

/** Why `--since` or `--until` is not a bound at all — the parts of a window that need no clock to judge. */
function boundProblems({ since, until }: { since: string; until: string | undefined }): readonly string[] {
  const problems: string[] = [];
  if (until !== undefined && !isIsoInstant({ value: until })) {
    problems.push(`--until ${until} is not an instant`);
  }
  if (!RELATIVE.test(since) && !isIsoInstant({ value: since })) {
    problems.push(`--since ${since} is neither an instant nor a span like 7d or 12h`);
  }
  return problems;
}

/**
 * The window a list reads: `--since` as an instant or a span back from now, `--until` as an instant or now.
 *
 * @param since an ISO instant, or `<n>d` / `<n>h`
 * @param until an ISO instant, or `undefined` for now
 * @param nowIso the instant a span counts back from and a missing `--until` stands for
 * @returns the floor (inclusive) and ceiling (exclusive), or every reason the two do not make a window
 */
export function wordsWindow({
  since,
  until,
  nowIso,
}: {
  since: string;
  until: string | undefined;
  nowIso: string;
}): Result<{ readonly sinceIso: string; readonly untilIso: string }> {
  const now = Date.parse(nowIso);
  const problems: string[] = [];
  let ceiling = now;
  if (until !== undefined) {
    ceiling = Date.parse(until);
  }
  if (Number.isNaN(ceiling)) {
    problems.push(`--until ${String(until)} is not an instant`);
  }
  const relative = RELATIVE.exec(since);
  let floor = Date.parse(since);
  if (relative !== null) {
    const unit = relative[2] === "d" ? DAY_MS : HOUR_MS;
    floor = now - Number(relative[1]) * unit;
    // A span longer than a Date can hold would throw at `toISOString` below.
    if (!Number.isNaN(now) && Number.isNaN(new Date(floor).getTime())) {
      problems.push(`--since ${since} reaches back past any instant a date can hold`);
      floor = Number.NaN;
    }
  }
  if (Number.isNaN(floor) && relative === null) {
    problems.push(`--since ${since} is neither an instant nor a span like 7d or 12h`);
  }
  // NaN compares false, so an unreadable bound never also reports an empty window.
  if (floor >= ceiling) {
    problems.push(`--since ${since} is not before --until — the window holds nothing`);
  }
  if (problems.length > 0) {
    return err(problems);
  }
  return ok({ sinceIso: new Date(floor).toISOString(), untilIso: new Date(ceiling).toISOString() });
}
