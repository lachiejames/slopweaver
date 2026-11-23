/**
 * `slopweaver talk meeting-due` — which of the owner's meetings is starting now with a link to join it, for the console.
 *
 * The console's `meeting-due` route runs this while the owner is on a call, so the voice can tell the owner once and put the join
 * link in front of the owner (`site/app/api/talk/call/[id]/meeting-due/route.ts`). One read of the owner's primary calendar over the
 * window {@link meetingDueWindow} names, under the `events` grant `calendar list` uses; nothing written. Each meeting
 * carries the published page `page tag` tied to it, so the pill can open the owner's briefing beside the join link. The rules
 * are `src/talk/meetingDue.ts`'s. An incomplete listing is a failure, never "no meeting": a meeting the read did not
 * reach is exactly the one the owner would be late for.
 */

import { err, ok, type Result } from "#lib/result.js";

import { logger } from "../../../lib/logger.js";
import { makeCalendarApi } from "../../../live/calendar/api.js";
import { resolveCalendarClient } from "../../../live/calendar/client.js";
import type { CalendarListing } from "../../../live/calendar/read.js";
import { MAX_LIST_LIMIT, PRIMARY_CALENDAR, readCalendarListing } from "../../../live/calendar/read.js";
import type { MeetingTagError } from "../../../pages/meetingTag.js";
import { type MeetingTagRead, readMeetingTags } from "../../../pages/meetingTagStore.js";
import { type PublishedAmong, publishedAmongInStore } from "../../../pages/published.js";
import {
  briefingCandidates,
  type JoinableMeeting,
  joinableMeetings,
  type MeetingDueAnswer,
  meetingDueWindow,
  withBriefings,
} from "../../../talk/meetingDue.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { TALK_MEETING_DUE_USAGE } from "./knowUsage.js";
import { parseMeetingDueArgs } from "./meetingDueArgs.js";

/** How many argv entries precede the verb's own flags: `[node, bin, "talk", "meeting-due", ...]`. */
const VERB_ARG_OFFSET = 4;

/** The seams the verb performs its effects through. */
export interface MeetingDueDeps {
  /** One listing of the owner's primary calendar over a window, with its completeness, or why it could not be read. */
  readonly list: (input: {
    home: string | undefined;
    timeMinIso: string;
    timeMaxIso: string;
  }) => Promise<Result<CalendarListing>>;
  /** Every row of the page-to-meeting tag ledger (`page tag`), or why it could not be read. */
  readonly readTags: (input: { home: string | undefined }) => Result<MeetingTagRead, MeetingTagError>;
  /** Which of the named pages the store publishes, or why it could not say — `publishedAmongInStore` in production. */
  readonly publishedAmong: (input: {
    home: string | undefined;
    slugs: readonly string[];
  }) => ReturnType<PublishedAmong>;
  readonly nowMs: () => number;
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
}

/**
 * Run `talk meeting-due` against injected edges.
 *
 * @param rest argv after `talk meeting-due`
 * @param deps the read and output seams
 * @returns the process exit code
 */
export async function runMeetingDue({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: MeetingDueDeps;
}): Promise<number> {
  if (rest.includes("--help") || rest.includes("-h")) {
    deps.writeOut(TALK_MEETING_DUE_USAGE);
    return EXIT_OK;
  }
  const parsed = parseMeetingDueArgs({ rest });
  if (parsed.isErr()) {
    for (const problem of [parsed.error.message, TALK_MEETING_DUE_USAGE]) {
      deps.writeDiagnostic(problem);
    }
    return EXIT_USAGE;
  }
  const { home, json } = parsed.value;
  const nowMs = instantNow({ deps, given: parsed.value.nowMs });
  const listed = await deps.list({ home, ...meetingDueWindow({ nowMs }) });
  if (listed.isErr()) {
    for (const problem of listed.error) {
      deps.writeDiagnostic(`talk meeting-due: ${problem}`);
    }
    return EXIT_ERROR;
  }
  if (!listed.value.complete) {
    deps.writeDiagnostic(
      "talk meeting-due: the calendar read did not reach every event in the window, so no answer is given",
    );
    return EXIT_ERROR;
  }
  // Judged when the read finished, not when it began, so a meeting that ended during the read is not named.
  // One that came due during the read is outside the window opened before it, and waits for the next poll.
  const judgedAtMs = instantNow({ deps, given: parsed.value.nowMs });
  const joinable = joinableMeetings({ account: listed.value.account, events: listed.value.events, nowMs: judgedAtMs });
  const answer: MeetingDueAnswer = {
    meetings: await briefed({ deps, home, meetings: joinable }),
    readAtIso: new Date(judgedAtMs).toISOString(),
  };
  printMeetingDue({ answer, deps, json });
  return EXIT_OK;
}

/**
 * The meetings with their tagged briefing pages attached. A briefing is the extra link and the join link is the one
 * that gets the owner in, so a ledger that cannot be read leaves every meeting with no briefing — said on stderr, never an
 * exit that loses the join link. A ledger with a line that is not a tag gives no briefing either, and says so: the bad
 * line may be a slug's latest re-tag, and skipping it would hand that slug's older meeting the page.
 * `meeting-prep-due` reads past such a line because a missed prep row costs nothing; a wrong link does.
 *
 * Whether a tagged page is published is the store's answer, asked once for every candidate before the match, and a
 * store that cannot say leaves every meeting with no briefing the same way: a page the store could not be asked about
 * is never linked, and never costs the join link.
 *
 * @param meetings the meetings starting now
 * @param home the `--home` named, when one was
 * @returns the meetings, each carrying its briefing's slug or `null`
 */
async function briefed({
  deps,
  home,
  meetings,
}: {
  deps: MeetingDueDeps;
  home: string | undefined;
  meetings: readonly JoinableMeeting[];
}): Promise<readonly JoinableMeeting[]> {
  if (meetings.length === 0) {
    return meetings;
  }
  const read = deps.readTags({ home });
  if (read.isErr()) {
    deps.writeDiagnostic(`talk meeting-due: no briefing links, the join links still stand: ${read.error.message}`);
    return meetings;
  }
  for (const problem of read.value.unparsed) {
    deps.writeDiagnostic(
      `talk meeting-due: no briefing links, the join links still stand: the tag ledger's ${problem}`,
    );
  }
  if (read.value.unparsed.length > 0) {
    return meetings;
  }
  const slugs = briefingCandidates({ meetings, tags: read.value.tags });
  if (slugs.length === 0) {
    return meetings;
  }
  const published = await deps.publishedAmong({ home, slugs });
  if (published.isErr()) {
    deps.writeDiagnostic(`talk meeting-due: no briefing links, the join links still stand: ${published.error.message}`);
    return meetings;
  }
  return withBriefings({
    meetings,
    published: ({ slug }) => published.value.has(slug),
    tags: read.value.tags,
  });
}

/**
 * The instant to judge at: `--now` when given, else the clock read at this call.
 *
 * @param given the `--now` instant in ms, when passed
 * @returns ms since epoch
 */
function instantNow({ deps, given }: { deps: MeetingDueDeps; given: number | undefined }): number {
  if (given !== undefined) {
    return given;
  }
  return deps.nowMs();
}

/**
 * Print the answer: one JSON document, or one line per meeting a person reads.
 *
 * @param answer the meetings named and when they were judged
 * @param json whether `--json` was passed
 */
function printMeetingDue({
  answer,
  deps,
  json,
}: {
  answer: MeetingDueAnswer;
  deps: MeetingDueDeps;
  json: boolean;
}): void {
  if (json) {
    deps.writeOut(JSON.stringify(answer));
    return;
  }
  if (answer.meetings.length === 0) {
    deps.writeOut(`no meeting to join at ${answer.readAtIso}`);
    return;
  }
  for (const meeting of answer.meetings) {
    let line = `${meeting.startIso}  ${meeting.title}  ${meeting.joinUrl}`;
    if (meeting.briefingSlug !== null) {
      line += `  briefing ${meeting.briefingSlug}`;
    }
    deps.writeOut(line);
  }
}

/**
 * The production seams: the owner's primary calendar under the `events` grant, the wall clock, the logger.
 *
 * @returns the seams
 */
export function productionMeetingDueDeps(): MeetingDueDeps {
  return {
    list: async ({ home, timeMinIso, timeMaxIso }) => {
      const bound = resolveCalendarClient({ capabilities: ["events"], home: resolveHome({ named: home }) });
      if (bound.isErr()) {
        return err([bound.error.message]);
      }
      const read = await readCalendarListing({
        account: bound.value.account,
        api: makeCalendarApi({ account: bound.value.account, client: bound.value.client }),
        calendarIds: [PRIMARY_CALENDAR],
        limit: MAX_LIST_LIMIT,
        nowIso: () => new Date().toISOString(),
        timeMaxIso,
        timeMinIso,
      });
      if (read.isErr()) {
        return err([read.error.message]);
      }
      return ok(read.value.listing);
    },
    nowMs: () => Date.now(),
    publishedAmong: ({ home, slugs }) => publishedAmongInStore({ home: resolveHome({ named: home }), slugs }),
    readTags: ({ home }) => readMeetingTags({ home: resolveHome({ named: home }) }),
    writeDiagnostic: (line) => {
      logger.warn({ msg: line });
    },
    writeOut: (line) => {
      logger.out({ line });
    },
  };
}

/**
 * `slopweaver talk meeting-due` on the owner's real calendar and clock.
 *
 * @param argv the whole argv, noun and verb first
 * @returns the exit code
 */
async function runTalkMeetingDue(argv: readonly string[]): Promise<number> {
  return runMeetingDue({ deps: productionMeetingDueDeps(), rest: argv.slice(VERB_ARG_OFFSET) });
}

/** `slopweaver talk meeting-due`. */
export const talkMeetingDueCommand = defineCommand({ run: runTalkMeetingDue });
