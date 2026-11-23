/**
 * Pure option parsing for `slopweaver page publish`, `page find` and `page tag`. No I/O, no clock — everything here is decided from
 * argv alone, so a parse rejection costs nothing and nothing is written before the arguments are known good.
 */

import { parseIsoMs } from "../../../lib/date.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { positiveIntFlag } from "../../optionParsers.js";
import { type FlagSpec, type ParsedFlags, parseFlags } from "../../parseFlags.js";

/**
 * The flags `page publish` accepts.
 *
 * @internal exported for its own tests until a consumer outside this module reads it.
 */
export const PAGE_PUBLISH_FLAGS: FlagSpec = {
  boolean: ["json"],
  string: ["page", "assets-from", "review", "review-changed", "home", "now"],
};

/** Every flag this verb accepts, so `--help`'s advertised usage is checked against the parser. */
export const PAGE_PUBLISH_FLAG_NAMES: readonly string[] = [
  "--page",
  "--assets-from",
  "--review",
  "--review-changed",
  "--json",
  "--now",
  "--home",
];

/** What one `page publish` invocation was asked to do. */
export interface PagePublishOptions {
  /** The page's slug, which becomes its directory and its ledger identity. */
  readonly slug: string;
  /** The authored fragment to publish. */
  readonly pagePath: string;
  /** The directory every file the page loads is read from, as passed; undefined when the page loads none. */
  readonly assetsFrom: string | undefined;
  /** Every review id `--review` cites, in order; empty when none was passed. */
  readonly reviewIds: readonly string[];
  /** What the author changed after the review, as passed. */
  readonly reviewChanged: string | undefined;
  readonly json: boolean;
  /** Where the freeze instant comes from: the `--now` override when passed, else the run's own clock. */
  readonly now: { readonly from: "flag"; readonly iso: string } | { readonly from: "clock" };
  readonly home: string | undefined;
}

/**
 * A comma-separated flag value as its non-empty, distinct entries, with a refusal for a duplicate.
 *
 * @param value the flag's raw value, or undefined when it was not passed
 * @param flag the flag's name, for the refusal
 * @param problems where a refusal is pushed
 * @returns the entries, in the order given
 */
function commaList({
  value,
  flag,
  problems,
}: {
  value: string | undefined;
  flag: string;
  problems: string[];
}): readonly string[] {
  if (value === undefined) {
    return [];
  }
  const entries = value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (entries.length === 0) {
    problems.push(`${flag} was passed with no value`);
  }
  if (new Set(entries).size !== entries.length) {
    problems.push(`${flag} names the same entry twice`);
  }
  return entries;
}

/** One flag's value when it was given as a string, and undefined otherwise. */
function stringFlag({ name, parsed }: { name: string; parsed: ParsedFlags }): string | undefined {
  const value = parsed.values[name];
  return typeof value === "string" ? value : undefined;
}

/**
 * Read `page publish`'s own arguments into what the run needs from them.
 *
 * Exactly one positional is accepted. A second one is refused by name rather than ignored, because the two
 * most plausible mistakes — passing the html path positionally, and publishing two slugs at once — would both
 * otherwise write a page under the wrong name and print an address nobody can use.
 *
 * @param rest the argv tail after `page publish`
 * @returns the options, or every reason they were refused
 */
export function pagePublishOptions({ rest }: { rest: readonly string[] }): Result<PagePublishOptions> {
  const parsed = parseFlags({ allowPositionals: true, args: rest, spec: PAGE_PUBLISH_FLAGS });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const refusals: string[] = [];
  const slug = parsed.value.positionals[0];
  if (slug === undefined) {
    refusals.push("page publish needs a slug: it becomes the page's directory and its ledger identity");
  }
  if (parsed.value.positionals.length > 1) {
    refusals.push(`page publish takes one slug, got ${String(parsed.value.positionals.length)}`);
  }
  const pagePath = stringFlag({ name: "page", parsed: parsed.value });
  if (pagePath === undefined || pagePath.trim().length === 0) {
    refusals.push("--page is required — the file holding the page fragment to publish");
  }
  const reviewIds = commaList({
    flag: "--review",
    problems: refusals,
    value: stringFlag({ name: "review", parsed: parsed.value }),
  });
  const assetsFrom = stringFlag({ name: "assets-from", parsed: parsed.value });
  if (assetsFrom?.trim().length === 0) {
    refusals.push("--assets-from was passed with no value — name the directory the page's images are read from");
  }
  if (slug === undefined || pagePath === undefined || refusals.length > 0) {
    return err(refusals);
  }
  const nowFlag = stringFlag({ name: "now", parsed: parsed.value });
  return ok({
    assetsFrom,
    home: stringFlag({ name: "home", parsed: parsed.value }),
    json: parsed.value.values["json"] === true,
    now: nowFlag === undefined ? { from: "clock" } : { from: "flag", iso: nowFlag },
    pagePath,
    reviewChanged: stringFlag({ name: "review-changed", parsed: parsed.value }),
    reviewIds,
    slug,
  });
}

/**
 * The flags `page review-prepare` accepts.
 *
 * @internal exported for its own tests until a consumer outside this module reads it.
 */
export const PAGE_REVIEW_PREPARE_FLAGS: FlagSpec = {
  boolean: ["json"],
  string: ["page", "inputs", "home"],
};

/** Every flag `page review-prepare` accepts, so `--help`'s advertised usage is checked against the parser. */
export const PAGE_REVIEW_PREPARE_FLAG_NAMES: readonly string[] = ["--page", "--inputs", "--json", "--home"];

/** What one `page review-prepare` invocation was asked to do. */
export interface PageReviewPrepareOptions {
  /** The page the review is for — the slug it will publish under. */
  readonly slug: string;
  /** The authored fragment to review. */
  readonly pagePath: string;
  /** What the page answers to: their words, the run's doc, any measurement it cites. */
  readonly inputPaths: readonly string[];
  readonly json: boolean;
  readonly home: string | undefined;
}

/**
 * Read `page review-prepare`'s own arguments. `--inputs` is required: a review that never
 * saw their full words missed the very question the briefing had dropped.
 *
 * @param rest the argv tail after `page review-prepare`
 * @returns the options, or every reason they were refused
 */
export function pageReviewPrepareOptions({ rest }: { rest: readonly string[] }): Result<PageReviewPrepareOptions> {
  const parsed = parseFlags({ allowPositionals: true, args: rest, spec: PAGE_REVIEW_PREPARE_FLAGS });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const refusals: string[] = [];
  const slug = parsed.value.positionals[0];
  if (slug === undefined) {
    refusals.push("page review-prepare needs the slug the page will publish under");
  }
  if (parsed.value.positionals.length > 1) {
    refusals.push(`page review-prepare takes one slug, got ${String(parsed.value.positionals.length)}`);
  }
  const pagePath = stringFlag({ name: "page", parsed: parsed.value });
  if (pagePath === undefined || pagePath.trim().length === 0) {
    refusals.push("--page is required — the file holding the page fragment to review");
  }
  const inputsFlag = stringFlag({ name: "inputs", parsed: parsed.value });
  if (inputsFlag === undefined) {
    refusals.push("--inputs is required — their own words and the run's doc, the things the page must answer to");
  }
  const inputPaths = commaList({ flag: "--inputs", problems: refusals, value: inputsFlag });
  if (slug === undefined || pagePath === undefined || refusals.length > 0) {
    return err(refusals);
  }
  return ok({
    home: stringFlag({ name: "home", parsed: parsed.value }),
    inputPaths,
    json: parsed.value.values["json"] === true,
    pagePath,
    slug,
  });
}

/**
 * The flags `page tag` accepts.
 *
 * @internal exported for its own tests until a consumer outside this module reads it.
 */
export const PAGE_TAG_FLAGS: FlagSpec = {
  boolean: ["json"],
  string: ["meeting", "calendar", "home", "now"],
};

/** Every flag `page tag` accepts, so `--help`'s advertised usage is checked against the parser. */
export const PAGE_TAG_FLAG_NAMES: readonly string[] = ["--meeting", "--calendar", "--json", "--now", "--home"];

/** The calendar a tag reads its event from when `--calendar` is not passed — the one `calendar read` defaults to. */
const DEFAULT_TAG_CALENDAR = "primary";

/** What one `page tag` invocation was asked to do. */
export interface PageTagOptions {
  /** The published page being tagged. */
  readonly slug: string;
  /** The event INSTANCE the page prepares them for. */
  readonly eventId: string;
  /** The calendar holding that event. */
  readonly calendarId: string;
  readonly json: boolean;
  /** The instant the tag is taken at: the `--now` override when passed, else the run's own clock. */
  readonly now: { readonly from: "flag"; readonly iso: string } | { readonly from: "clock" };
  readonly home: string | undefined;
}

/**
 * Read `page tag`'s own arguments. One positional, the slug, and `--meeting` is required: a tag with no meeting
 * names nothing to be due before.
 *
 * @param rest the argv tail after `page tag`
 * @returns the options, or every reason they were refused
 */
export function pageTagOptions({ rest }: { rest: readonly string[] }): Result<PageTagOptions> {
  const parsed = parseFlags({ allowPositionals: true, args: rest, spec: PAGE_TAG_FLAGS });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const refusals: string[] = [];
  const slug = parsed.value.positionals[0];
  if (slug === undefined) {
    refusals.push("page tag needs the slug of a published page");
  }
  if (parsed.value.positionals.length > 1) {
    refusals.push(`page tag takes one slug, got ${String(parsed.value.positionals.length)}`);
  }
  const eventId = stringFlag({ name: "meeting", parsed: parsed.value });
  if (eventId === undefined || eventId.trim().length === 0) {
    refusals.push("--meeting is required — the event id `slopweaver calendar list` prints for the meeting");
  }
  const nowFlag = stringFlag({ name: "now", parsed: parsed.value });
  if (nowFlag !== undefined && parseIsoMs({ tsIso: nowFlag }) === undefined) {
    refusals.push(`--now ${nowFlag} is not an ISO-8601 instant`);
  }
  if (slug === undefined || eventId === undefined || refusals.length > 0) {
    return err(refusals);
  }
  let calendarId = DEFAULT_TAG_CALENDAR;
  const calendarFlag = stringFlag({ name: "calendar", parsed: parsed.value });
  if (calendarFlag !== undefined) {
    calendarId = calendarFlag;
  }
  return ok({
    calendarId,
    eventId: eventId.trim(),
    home: stringFlag({ name: "home", parsed: parsed.value }),
    json: parsed.value.values["json"] === true,
    now: nowFlag === undefined ? { from: "clock" } : { from: "flag", iso: nowFlag },
    slug,
  });
}

/**
 * The flags `page find` accepts.
 *
 * @internal exported for its own tests until a consumer outside this module reads it.
 */
export const PAGE_FIND_FLAGS: FlagSpec = {
  boolean: ["json"],
  string: ["limit", "home"],
};

/** Every flag `page find` accepts, so `--help`'s advertised usage is checked against the parser. */
export const PAGE_FIND_FLAG_NAMES: readonly string[] = ["--limit", "--json", "--home"];

/** How many pages `page find` offers when `--limit` is not passed: a voice reads them aloud, so a handful. */
const DEFAULT_FIND_LIMIT = 15;

/** The most pages one `page find` returns, so a voice's verb budget never truncates the answer mid-row. */
const MAX_FIND_LIMIT = 50;

/** What one `page find` invocation was asked to do. */
export interface PageFindOptions {
  /** What they said, one element per positional; empty for the newest pages. */
  readonly words: readonly string[];
  readonly limit: number;
  readonly json: boolean;
  readonly home: string | undefined;
}

/**
 * Read `page find`'s own arguments. Every positional is a word of theirs, so `page find twenty potential icons` and
 * `page find "twenty potential icons"` ask the same thing.
 *
 * @param rest the argv tail after `page find`
 * @returns the options, or every reason they were refused
 */
export function pageFindOptions({ rest }: { rest: readonly string[] }): Result<PageFindOptions> {
  const parsed = parseFlags({ allowPositionals: true, args: rest, spec: PAGE_FIND_FLAGS });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const problems: string[] = [];
  const limit = positiveIntFlag({ fallback: DEFAULT_FIND_LIMIT, name: "limit", problems, values: parsed.value.values });
  if (limit > MAX_FIND_LIMIT) {
    problems.push(`--limit is at most ${String(MAX_FIND_LIMIT)}`);
  }
  if (problems.length > 0) {
    return err(problems);
  }
  return ok({
    home: stringFlag({ name: "home", parsed: parsed.value }),
    json: parsed.value.values["json"] === true,
    limit,
    words: parsed.value.positionals,
  });
}

/** How many argv entries precede the verb's own arguments. Four: `[node, cli, noun, verb, …]`. */
export const VERB_ARG_OFFSET = 4;
