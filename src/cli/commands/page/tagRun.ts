/**
 * `slopweaver page tag <slug> --meeting <event-id>` — tie a published page to the one meeting it prepares them for,
 * so the `meeting-prep-due` monitor floats it in front of them in the hour before (`../../../pages/meetingTag.ts`).
 *
 * The one live read is the event, through the calendar verbs' own reader (`calendar read`'s seam), so the start the
 * tag records is the calendar's and never a session's arithmetic. Everything after it is local: the page must
 * already be published, and the tag is one appended ledger row. Re-running it re-reads the meeting — the way a
 * moved meeting's tag is brought up to date.
 */
import { pathToFileURL } from "node:url";

import { logger } from "#lib/logger.js";
import type { Result } from "#lib/result.js";

import type { CalendarError } from "../../../live/calendar/errors.js";
import type { CalendarEventResult } from "../../../live/calendar/read.js";
import { type MeetingTag, MeetingTagErrors, meetingTagFromEvent } from "../../../pages/meetingTag.js";
import { appendMeetingTag } from "../../../pages/meetingTagStore.js";
import { pagePath } from "../../../pages/publish.js";
import { type PagePublished, pagePublishedInStore } from "../../../pages/published.js";
import { isValidPageSlug } from "../../../pages/url.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { productionCalendarReadDeps } from "../calendar/readRun.js";
import { pageTagOptions, VERB_ARG_OFFSET } from "./core.js";
import { PAGE_TAG_USAGE } from "./usage.js";

/** The seams `page tag` performs its effects through. */
export interface PageTagDeps {
  /** Reads one event in full — `calendar read`'s own reader in production. */
  readonly readEvent: (args: {
    home: string;
    calendarId: string;
    eventId: string;
  }) => Promise<Result<CalendarEventResult, CalendarError>>;
  /** Whether the store holds a current document for the page — `pagePublishedInStore` in production. */
  readonly pagePublished: PagePublished;
  readonly now: () => string;
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
}

/**
 * What one tag prints: the page's address and the meeting it is now due before.
 *
 * @param tag the tag recorded
 * @param url the page's own address
 * @param json whether the caller asked for one object instead
 * @returns the lines to write, in order
 */
export function taggedLines({ tag, url, json }: { tag: MeetingTag; url: string; json: boolean }): readonly string[] {
  if (json) {
    return [JSON.stringify({ ...tag, url })];
  }
  const title = tag.summary === undefined ? "an untitled meeting" : `"${tag.summary}"`;
  return [
    url,
    `  tagged to ${title} (${tag.calendarId}/${tag.eventId}), starting ${tag.startIso} — ${tag.startWall} on its calendar`,
    "  `meeting-prep-due` floats this page as a note in the hour before it starts",
  ];
}

/**
 * Run `page tag` against injected seams.
 *
 * @param rest the argv tail after `page tag`
 * @param deps the event reader, the clock and the two sinks
 * @returns the process exit code
 */
export async function runPageTag({ rest, deps }: { rest: readonly string[]; deps: PageTagDeps }): Promise<number> {
  const options = pageTagOptions({ rest });
  if (options.isErr()) {
    for (const line of [...options.error, PAGE_TAG_USAGE]) {
      deps.writeDiagnostic(line);
    }
    return EXIT_USAGE;
  }
  const { calendarId, eventId, json, slug } = options.value;
  if (!isValidPageSlug({ slug })) {
    deps.writeDiagnostic(MeetingTagErrors.slugInvalid({ slug }).message);
    return EXIT_USAGE;
  }
  const home = resolveHome({ named: options.value.home });
  const path = pagePath({ home, slug });
  // Checked before the live read: a tag on a page that is not there would float a note whose Open button opens nothing.
  const published = await deps.pagePublished({ home, slug });
  if (published.isErr()) {
    deps.writeDiagnostic(MeetingTagErrors.pageUnchecked({ message: published.error.message, slug }).message);
    return EXIT_ERROR;
  }
  if (!published.value) {
    deps.writeDiagnostic(MeetingTagErrors.pageMissing({ slug }).message);
    return EXIT_ERROR;
  }
  const read = await deps.readEvent({ calendarId, eventId, home });
  if (read.isErr()) {
    deps.writeDiagnostic(MeetingTagErrors.calendarRead({ message: read.error.message }).message);
    return EXIT_ERROR;
  }
  const taggedIso = options.value.now.from === "flag" ? options.value.now.iso : deps.now();
  const tag = meetingTagFromEvent({ event: read.value.payload.event, slug, taggedIso });
  if (tag.isErr()) {
    deps.writeDiagnostic(tag.error.message);
    return EXIT_ERROR;
  }
  const appended = appendMeetingTag({ home, tag: tag.value });
  if (appended.isErr()) {
    deps.writeDiagnostic(appended.error.message);
    return EXIT_ERROR;
  }
  for (const line of taggedLines({ json, tag: tag.value, url: pathToFileURL(path).href })) {
    deps.writeOut(line);
  }
  return EXIT_OK;
}

/**
 * The production seams: `calendar read`'s grant-aware reader, the machine clock, and the two output channels.
 *
 * @returns the dependencies `page tag` runs on
 */
export function productionPageTagDeps(): PageTagDeps {
  const calendar = productionCalendarReadDeps();
  return {
    now: () => new Date().toISOString(),
    pagePublished: pagePublishedInStore,
    readEvent: ({ home, calendarId, eventId }) => calendar.read({ calendarId, eventId, home }),
    writeDiagnostic: (line) => {
      logger.error({ msg: line });
    },
    writeOut: (line) => {
      logger.out({ line });
    },
  };
}

/** `slopweaver page tag`. */
export const pageTagCommand = defineCommand({
  run: (argv) => runPageTag({ deps: productionPageTagDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});
