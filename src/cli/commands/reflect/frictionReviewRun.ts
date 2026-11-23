/**
 * `slopweaver reflect friction-review [--republish | --mark-published] [--home <dir>] [--json]` — is the
 * Friction Review page behind the newest self-improvement report, and close the gap.
 *
 * The recipe writes a dated report and never publishes it (see
 * `reflect/frictionReviewGap.ts`'s header); the supervisor's sweep does, at step 11 of its contract. Two ways
 * to close the gap, and the first is the one the step names:
 *
 * - **`--republish`** renders the newest report as its page (`reflect/frictionReviewPage.ts`), publishes it
 *   through `publishPage` under `friction-review-<day><mon>`, and only then writes the stamp. The page and
 *   the stamp are one act, so the stamp can no longer claim a republish nobody did — the gap four chairs
 *   carried in their shift state rather than stamp by hand.
 * - **`--mark-published`** writes the stamp alone, for a page a session published itself.
 *
 * It answers two independent questions, and the clock is what buys the second one: whether the hand-off was
 * missed (`hasGap`), and whether anything is still writing reports at all (`isStale`). See
 * `reflect/frictionReviewGap.ts`'s header for the reading that added the latter.
 *
 * ## The exit-code contract
 *
 * | situation | code | why |
 * | --- | --- | --- |
 * | a bad flag, or both closing flags | `2` | refused before anything is read |
 * | `$home/morning` exists but cannot be listed | `1` | named, never read as "no report" |
 * | `--republish`/`--mark-published` with no report ever written | `1` | nothing to publish or stamp |
 * | `--republish` whose report cannot be read, rendered or published | `1` | nothing stamped |
 * | the stamp itself cannot be written | `1` | the gap stays open on the old stamp; a page it published is named |
 * | `--republish` on a stale report | `3` | refused, nothing written: the producer stopped |
 * | neither a gap nor stale (with or without a closing flag) | `0` | the page is current |
 * | a gap, or a stale report | `3` | ran fine; the non-zero exit IS the signal |
 *
 * Stale reuses `3` rather than minting a fourth code: `EXIT_EXPECTED_EMPTY` already means "ran fine, and the
 * non-zero exit is the signal", so a new code would change a documented surface for every consumer to carry
 * a distinction the printed line and `--json` already make. A stale report exits non-zero even when
 * `--mark-published` stamped it, because stamping a long-dead report is the one path that could report
 * success about a producer that has stopped — and `--republish` refuses it outright, because the sweep step
 * says the fix for a stale report is the standing row, never a page.
 */
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { yyyyMmDdTodayPlus } from "../../../lib/date.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { productionPublishPage } from "../../../pages/productionPublish.js";
import type { PagePublisher, PublishedPage } from "../../../pages/publish.js";
import { briefReportFilename } from "../../../reflect/briefMarkdown.js";
import {
  computeFrictionReviewGap,
  type FrictionReviewGap,
  latestReportDate,
  renderFrictionReviewLine,
} from "../../../reflect/frictionReviewGap.js";
import { frictionReviewPageSlug, renderFrictionReviewFragment } from "../../../reflect/frictionReviewPage.js";
import { publishedReportDate, writeFrictionReviewPublishStamp } from "../../../reflect/frictionReviewPublish.js";
import { stateHomePaths } from "../../../stateHome.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome, verbTail } from "../../optionParsers.js";
import { parseReflectFrictionReviewOptions, type ReflectFrictionReviewOptions } from "./frictionReviewCore.js";
import { type FrictionReviewRunError, FrictionReviewRunErrors } from "./frictionReviewErrors.js";
import { REFLECT_FRICTION_REVIEW_USAGE } from "./usage.js";

/** Whether anything at all — a dangling symlink included — sits at `path`. */
function hasEntry({ path }: { path: string }): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * `$home/morning`'s listing, empty when the directory has never been created — absence by design, like every
 * other reader of a not-yet-scaffolded home subtree. Any other failure is named, never read as "no report".
 */
function morningFilenames({ home }: { home: string }): Result<readonly string[], FrictionReviewRunError> {
  const dir = stateHomePaths({ home }).morning;
  try {
    return ok(readdirSync(dir));
  } catch (cause) {
    // ENOENT through a dangling symlink is a broken path, not an unscaffolded one, so only an empty slot is absence.
    const absent = cause instanceof Error && "code" in cause && cause.code === "ENOENT" && !hasEntry({ path: dir });
    if (absent) {
      return ok([]);
    }
    return err(FrictionReviewRunErrors.reportsUnlistable({ cause, dir }));
  }
}

/** What one read of the home says: the newest report's day, the gap against the stamp, and today. */
interface GaugeRead {
  readonly latest: string | null;
  readonly gap: FrictionReviewGap;
  readonly todayDate: string;
}

/** Read the newest report and the stamp, and judge the gap between them on `now`'s day. */
function readGauge({ home, now }: { home: string; now: Date }): Result<GaugeRead, FrictionReviewRunError> {
  return morningFilenames({ home }).map((filenames) => {
    const latest = latestReportDate({ filenames });
    const todayDate = yyyyMmDdTodayPlus({ now, days: 0 });
    const gap = computeFrictionReviewGap({
      latestReportDate: latest,
      publishedDate: publishedReportDate({ home }),
      todayDate,
    });
    return { gap, latest, todayDate };
  });
}

/** Print each failure line the verb collected. */
function logLines({ lines }: { lines: readonly string[] }): void {
  lines.forEach((line) => {
    logger.error({ msg: line });
  });
}

/** The one page a republish produced, under the slug it was published as. */
interface RepublishedPage {
  readonly slug: string;
  readonly page: PublishedPage;
}

/**
 * Read one day's report, render it and publish it as that day's Friction Review page.
 *
 * @param date the report's day, which names both the file and the page
 * @param nowIso the instant the page's freeze is stamped with
 * @returns the published page, or every reason it was not published — in which case nothing was stamped
 */
async function republishReport({
  home,
  date,
  nowIso,
  publish,
}: {
  home: string;
  date: string;
  nowIso: string;
  publish: PagePublisher;
}): Promise<Result<RepublishedPage, FrictionReviewRunError>> {
  const path = join(stateHomePaths({ home }).morning, briefReportFilename({ date }));
  let markdown: string;
  try {
    markdown = readFileSync(path, "utf8");
  } catch (cause) {
    return err(FrictionReviewRunErrors.reportUnreadable({ cause, path }));
  }
  const slug = frictionReviewPageSlug({ date });
  if (slug.isErr()) {
    return err(FrictionReviewRunErrors.pageRefused({ path, refusal: slug.error }));
  }
  const fragment = renderFrictionReviewFragment({ date, markdown });
  if (fragment.isErr()) {
    return err(FrictionReviewRunErrors.pageRefused({ path, refusal: fragment.error }));
  }
  const published = await publish({ fragment: fragment.value, home, nowIso, slug: slug.value });
  return published
    .map((page) => ({ page, slug: slug.value }))
    .mapErr((issues) => FrictionReviewRunErrors.publishFailed({ issues }));
}

/**
 * What the verb prints once it knows its outcome: the page's address first when one was published, then the
 * gauge line (or its `--json` object, carrying the page beside the gap).
 */
function reportOutcome({
  reported,
  marked,
  republished,
  json,
}: {
  reported: FrictionReviewGap;
  marked: boolean;
  republished: RepublishedPage | undefined;
  json: boolean;
}): void {
  if (json) {
    const page = republished === undefined ? {} : { page: { slug: republished.slug, url: republished.page.url } };
    logger.out({ line: JSON.stringify({ ...reported, marked, ...page }) });
    return;
  }
  if (republished !== undefined) {
    logger.out({ line: republished.page.url });
  }
  logger.out({ line: renderFrictionReviewLine({ gap: reported, marked }) });
}

/** `3` while the page is behind or the producer stopped — the non-zero exit IS the signal — else `0`. */
function exitFor({ gap }: { gap: FrictionReviewGap }): number {
  return gap.hasGap || gap.isStale ? EXIT_EXPECTED_EMPTY : EXIT_OK;
}

/**
 * Close the gap on `latest`: publish its page first when `republish`, then stamp it. A failed publish stamps
 * nothing.
 *
 * @param latest the newest report's day, read once; null when no report was ever written
 * @param republish publish the page before stamping, rather than stamp alone
 * @returns the page it published (none under `--mark-published`), or why it stopped
 */
async function closeGap({
  home,
  latest,
  now,
  publish,
  republish,
}: {
  home: string;
  latest: string | null;
  now: Date;
  publish: PagePublisher;
  republish: boolean;
}): Promise<Result<RepublishedPage | undefined, FrictionReviewRunError>> {
  if (latest === null) {
    return err(FrictionReviewRunErrors.noReport());
  }
  let republished: RepublishedPage | undefined;
  if (republish) {
    const outcome = await republishReport({ date: latest, home, nowIso: now.toISOString(), publish });
    if (outcome.isErr()) {
      return err(outcome.error);
    }
    republished = outcome.value;
  }
  // The stamp names the day this run PUBLISHED, read once above, never "whatever is newest now": a report
  // the recipe writes mid-run is newer than the stamp, so the next read reports its gap again.
  try {
    writeFrictionReviewPublishStamp({ home, stamp: { localDate: latest, publishedAtIso: now.toISOString() } });
  } catch (cause) {
    // The gap stays visible on the old stamp, which is the recovery: run it again.
    const pageUrl = republished === undefined ? null : republished.page.url;
    return err(FrictionReviewRunErrors.stampUnwritable({ cause, pageUrl }));
  }
  return ok(republished);
}

/** The verb once its flags parsed: read the gauge, close the gap when asked, and report. */
async function runParsed({
  options,
  now,
  publish,
}: {
  options: ReflectFrictionReviewOptions;
  now: Date;
  publish: PagePublisher;
}): Promise<number> {
  const home = resolveHome({ named: options.home });
  const read = readGauge({ home, now });
  if (read.isErr()) {
    logger.error({ msg: read.error.message });
    return EXIT_ERROR;
  }
  const { gap, latest, todayDate } = read.value;
  const closing = options.republish || options.markPublished;
  // The producer stopped: a page would dress a dead report as today's, so nothing is written.
  const refusedStale = options.republish && gap.isStale;
  if (!closing || refusedStale) {
    reportOutcome({ json: options.json, marked: false, reported: gap, republished: undefined });
    return exitFor({ gap });
  }
  const closed = await closeGap({ home, latest, now, publish, republish: options.republish });
  if (closed.isErr()) {
    logger.error({ msg: closed.error.message });
    return EXIT_ERROR;
  }
  const stamped = computeFrictionReviewGap({ latestReportDate: latest, publishedDate: latest, todayDate });
  reportOutcome({ json: options.json, marked: true, reported: stamped, republished: closed.value });
  return exitFor({ gap: stamped });
}

/**
 * Run `reflect friction-review` against a supplied clock — the whole verb but the instant it reads.
 *
 * @param rest the argv tail after `reflect friction-review`
 * @param now the instant that dates today and stamps the page and the mark
 * @param publish writes a `--republish` page to its folder, its freeze and the store
 * @returns the process exit code
 */
export async function runFrictionReviewAt({
  rest,
  now,
  publish,
}: {
  rest: readonly string[];
  now: Date;
  publish: PagePublisher;
}): Promise<number> {
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: REFLECT_FRICTION_REVIEW_USAGE });
    return EXIT_OK;
  }
  const parsed = parseReflectFrictionReviewOptions({ rest });
  if (parsed.isErr()) {
    logLines({ lines: [...parsed.error, REFLECT_FRICTION_REVIEW_USAGE] });
    return EXIT_USAGE;
  }
  return runParsed({ now, options: parsed.value, publish });
}

/**
 * Run the `reflect friction-review` verb.
 *
 * @param argv the full process argv (verb tail starts at index 3)
 * @returns the process exit code
 */
export async function runReflectFrictionReview(argv: readonly string[]): Promise<number> {
  return runFrictionReviewAt({
    now: new Date(),
    publish: productionPublishPage,
    rest: verbTail({ argv, verbs: ["friction-review"] }),
  });
}

export const reflectFrictionReviewCommand = defineCommand({ run: runReflectFrictionReview });
