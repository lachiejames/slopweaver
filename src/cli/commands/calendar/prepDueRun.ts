/**
 * The effectful shell for `calendar prep-due`: read the coming hours of the owner's calendar, select every meeting the owner will
 * talk in that has no brief yet (`../../../live/calendar/prepDue.ts`), and register ONE board row per meeting for a
 * visible session to brief it.
 *
 * No model runs here (`AGENTS.md` rule 2). The row is `--dispatch` work a seat picks up, exactly as `github
 * bump-drive` registers a seated bump: the seat writes the page, publishes it and `page tag`s it to the meeting,
 * and the `meeting-prep-due` monitor floats it before the meeting starts. The hourly standing row
 * `meeting-prep-hourly` (`../../../live/automation/standingMeetingPrepRows.ts`) is what runs this.
 *
 * A meeting is skipped once a row claims its instance's slug — live, archived or journalled — or a page is currently
 * tagged to it, so the hourly pass registers each meeting at most once and never over a brief a session cut by hand.
 * Every input that could hide a meeting or a claim fails the pass rather than reading as empty: a tag ledger with a
 * line it cannot parse (the line may be the very tag), a board doc that will not read, no declared checkout, and a
 * listing that is not every event in the window (`CalendarListing.complete`).
 */
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { safeJsonStringify } from "../../../lib/safeJson.js";
import { type PrepDueMeeting, prepRowSlug, selectPrepDue } from "../../../live/calendar/prepDue.js";
import { type CalendarListing, MAX_LIST_LIMIT, PRIMARY_CALENDAR } from "../../../live/calendar/read.js";
import { checkoutForRunningRepo } from "../../../live/checkout/checkoutForRepo.js";
import type { Organisation } from "../../../organisation/core.js";
import { readOrganisation } from "../../../organisation/read.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { registerAskRow } from "../handover/askRowRun.js";
import { calendarErrorLines } from "./errors.js";
import { type CalendarPrepDueArgs, parseCalendarPrepDueArgs } from "./prepDueArgs.js";
import { readClaimedSlugs, readTaggedEventIds } from "./prepDueLedgers.js";
import { type PrepOutcome, prepDueLines, prepExitCode } from "./prepDueReport.js";
import { prepRegisterArgv } from "./prepRegisterArgv.js";
import { type CalendarReadDeps, productionCalendarReadDeps } from "./readRun.js";

const VERB_ARG_OFFSET = 4;

/** The seams `calendar prep-due` performs its effects through. */
export interface CalendarPrepDueDeps {
  readonly list: CalendarReadDeps["list"];
  readonly now: () => Date;
  /** Every primary-calendar event instance a page is CURRENTLY tagged to, or why the ledger cannot be trusted. */
  readonly taggedEventIds: (args: { home: string }) => Result<ReadonlySet<string>, string>;
  /**
   * Every slug a row already claims — a live or archived doc by its declared `slug:` as well as its filename, or a
   * run journal — or why the board could not be read whole.
   */
  readonly claimedSlugs: (args: { home: string }) => Result<ReadonlySet<string>, string>;
  /**
   * The declared main checkout of the repository this process runs from — the row's `--repo`, without which
   * `cmux spawn` cannot seat it (`handover register --help`).
   */
  readonly checkout: (args: { home: string }) => Result<string>;
  /** The organisation the store holds (`../../../organisation/read.ts`), whose Google domain places the row. */
  readonly organisation: (args: { home: string }) => Promise<Result<Organisation>>;
  /** Register one row through `handover register`, in process. Returns its exit code. */
  readonly registerRow: (args: { argv: readonly string[]; quiet: boolean }) => Promise<number>;
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
}

/**
 * Run one `calendar prep-due` invocation against injected edges.
 *
 * Exits 3 when no meeting in the window is owed a new brief, so the scheduled row stamps an empty hour rather than
 * reporting it as a fault, and 1 when any input could not be trusted or any registration failed.
 *
 * @param rest argv after `calendar prep-due`
 * @param deps the calendar read, the two ledgers, the checkout, the register and the output seams
 * @returns the process exit code
 */
export async function runCalendarPrepDue({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: CalendarPrepDueDeps;
}): Promise<number> {
  const now = deps.now();
  const parsed = parseCalendarPrepDueArgs({ now, rest });
  if (parsed.isErr()) {
    for (const problem of calendarErrorLines({ error: parsed.error })) {
      deps.writeDiagnostic(problem);
    }
    return EXIT_USAGE;
  }
  const args = parsed.value;
  const home = resolveHome({ named: args.home });
  const inputs = await gatherInputs({ args, deps, home });
  if (inputs.isErr()) {
    for (const problem of inputs.error) {
      deps.writeDiagnostic(problem);
    }
    return EXIT_ERROR;
  }
  const { account, checkout, claimed, events, organisation, tagged } = inputs.value;
  const selection = selectPrepDue({
    account,
    briefed: ({ eventId }) => tagged.has(eventId) || claimed.has(prepRowSlug({ eventId })),
    events,
    horizonMs: args.horizonMs,
    nowMs: now.getTime(),
  });
  const outcomes: PrepOutcome[] = [];
  for (const meeting of selection.due) {
    outcomes.push(await prepOne({ account, args, checkout, deps, home, meeting, now, organisation }));
  }
  writeReport({ args, deps, now, outcomes, skipped: selection.skipped });
  return prepExitCode({ outcomes });
}

/** Everything a pass reads before it selects, each read whole. */
interface PrepInputs {
  readonly tagged: ReadonlySet<string>;
  readonly checkout: string;
  readonly account: string;
  readonly events: CalendarListing["events"];
  readonly claimed: ReadonlySet<string>;
  readonly organisation: Organisation;
}

/**
 * Read every input a pass selects over, failing on the first that cannot be trusted — never an empty stand-in.
 *
 * @param args the parsed flags, whose window bounds the listing
 * @param home the state home the ledgers live under
 * @param deps the calendar read, the two ledgers and the checkout seam
 * @returns the inputs, or the diagnostic lines that name what could not be read
 */
async function gatherInputs({
  args,
  home,
  deps,
}: {
  args: CalendarPrepDueArgs;
  home: string;
  deps: CalendarPrepDueDeps;
}): Promise<Result<PrepInputs>> {
  const tagged = deps.taggedEventIds({ home });
  if (tagged.isErr()) {
    return err([tagged.error]);
  }
  // Resolved before the listing, not only when a meeting is due: an install with no checkout would otherwise stamp
  // every empty hour as done and fail only in the hour a meeting needed a row.
  const checkout = deps.checkout({ home });
  if (checkout.isErr()) {
    return err(checkout.error);
  }
  // Read before the listing for the same reason: a row placed by the team's domain needs the organisation, and an
  // install with none would otherwise fail only in the hour a meeting needed a row.
  const organisation = await deps.organisation({ home });
  if (organisation.isErr()) {
    return err(organisation.error);
  }
  const listing = await deps.list({
    calendarIds: [PRIMARY_CALENDAR],
    home: args.home,
    limit: MAX_LIST_LIMIT,
    timeMaxIso: args.timeMaxIso,
    timeMinIso: args.timeMinIso,
  });
  if (listing.isErr()) {
    return err([listing.error.message]);
  }
  if (!listing.value.listing.complete) {
    return err([
      `calendar prep-due: the listing is not every event in the window — it stopped at its ${String(MAX_LIST_LIMIT)}` +
        "-event cap, or an event Google returned would not parse — so a meeting it missed would read as absent",
    ]);
  }
  const claimed = deps.claimedSlugs({ home });
  if (claimed.isErr()) {
    return err([claimed.error]);
  }
  const { account, events } = listing.value.listing;
  return ok({
    account,
    checkout: checkout.value,
    claimed: claimed.value,
    events,
    organisation: organisation.value,
    tagged: tagged.value,
  });
}

/**
 * Print what the pass did — one `--json` document, or one line per meeting.
 *
 * @param args the parsed flags; `json` picks the shape
 * @param now this pass's instant
 * @param outcomes what each qualifying meeting's pass did
 * @param skipped every other event, with why
 * @param deps the output seam
 */
function writeReport({
  args,
  now,
  outcomes,
  skipped,
  deps,
}: {
  args: CalendarPrepDueArgs;
  now: Date;
  outcomes: readonly PrepOutcome[];
  skipped: ReturnType<typeof selectPrepDue>["skipped"];
  deps: CalendarPrepDueDeps;
}): void {
  if (!args.json) {
    for (const line of prepDueLines({ outcomes, skipped })) {
      deps.writeOut(line);
    }
    return;
  }
  deps.writeOut(
    safeJsonStringify({
      label: "calendar prep-due document",
      value: {
        dryRun: args.dryRun,
        outcomes,
        readIso: now.toISOString(),
        skipped: skipped.map((skip) => ({ eventId: skip.event.id, summary: skip.event.summary, why: skip.why })),
        timeMaxIso: args.timeMaxIso,
      },
    }),
  );
}

/**
 * Re-read both ledgers at the write, not only at selection: a seat may have tagged a page, or another pass registered
 * the row, since. Without a lock this narrows the race to this instant rather than closing it, and the ask tells a seat
 * that finds a tag already there to settle declined.
 *
 * @returns `existing` when the meeting is tagged or its slug claimed, `failed` when a ledger could not be read, else
 *   nothing
 */
function takenSince({
  deps,
  eventId,
  home,
  slug,
}: {
  deps: CalendarPrepDueDeps;
  eventId: string;
  home: string;
  slug: string;
}): "existing" | "failed" | undefined {
  const tagged = deps.taggedEventIds({ home });
  if (tagged.isErr()) {
    deps.writeDiagnostic(tagged.error);
    return "failed";
  }
  const claimed = deps.claimedSlugs({ home });
  if (claimed.isErr()) {
    deps.writeDiagnostic(claimed.error);
    return "failed";
  }
  if (tagged.value.has(eventId) || claimed.value.has(slug)) {
    return "existing";
  }
  return undefined;
}

/**
 * Register one meeting's row, or say a dry run would. A meeting that has started since selection reads as `started`,
 * one tagged or registered since as `existing`, and so does a failed registration whose slug exists afterwards: it lost a race to another pass, and
 * `handover register` refuses a taken slug.
 *
 * @param meeting the meeting owed a brief
 * @param args the parsed flags
 * @param checkout the row's `--repo`
 * @param home the state home the board lives under
 * @param now this pass's instant, the row's `--asked-iso`
 * @param deps the register, tag-ledger, row-ledger and clock seams
 * @param organisation the organisation whose Google domain says whether the meeting is the team's
 * @returns what the pass did for this meeting
 */
async function prepOne({
  meeting,
  account,
  args,
  checkout,
  home,
  now,
  organisation,
  deps,
}: {
  meeting: PrepDueMeeting;
  account: string;
  args: { dryRun: boolean; json: boolean };
  checkout: string;
  home: string;
  now: Date;
  organisation: Organisation;
  deps: CalendarPrepDueDeps;
}): Promise<PrepOutcome> {
  const slug = prepRowSlug({ eventId: meeting.event.id });
  const base = {
    eventId: meeting.event.id,
    reason: meeting.reason,
    slug,
    startIso: meeting.startIso,
    summary: meeting.event.summary,
  };
  if (args.dryRun) {
    return { ...base, outcome: "would-register" };
  }
  const taken = takenSince({ deps, eventId: meeting.event.id, home, slug });
  if (taken !== undefined) {
    return { ...base, outcome: taken };
  }
  // The pass's own instant is the one selection judged "already started" by, and the reads since take time: a meeting
  // starting during them would otherwise be put on the board after it began.
  if (Date.parse(meeting.startIso) <= deps.now().getTime()) {
    return { ...base, outcome: "started" };
  }
  const code = await deps.registerRow({
    argv: prepRegisterArgv({ account, askedIso: now.toISOString(), home, meeting, organisation, repo: checkout }),
    quiet: args.json,
  });
  if (code === EXIT_OK) {
    return { ...base, outcome: "registered" };
  }
  const after = deps.claimedSlugs({ home });
  if (after.isOk() && after.value.has(slug)) {
    return { ...base, outcome: "existing" };
  }
  return { ...base, outcome: "failed" };
}

/**
 * Production edges: the calendar read `calendar list` uses, the two local ledgers, the running checkout and
 * `handover register`.
 *
 * @returns the seams
 */
export function productionCalendarPrepDueDeps(): CalendarPrepDueDeps {
  const read = productionCalendarReadDeps();
  return {
    checkout: ({ home }) => checkoutForRunningRepo({ home, verb: "calendar prep-due" }),
    organisation: async ({ home }) =>
      (await readOrganisation({ home })).mapErr((error): readonly string[] => [`calendar prep-due: ${error.message}`]),
    claimedSlugs: readClaimedSlugs,
    list: read.list,
    now: () => new Date(),
    registerRow: ({ argv, quiet }) =>
      registerAskRow({
        argv,
        origin: "automation",
        out: quiet
          ? ({ line }) => {
              logger.warn({ msg: line });
            }
          : logger.out,
      }),
    taggedEventIds: readTaggedEventIds,
    writeDiagnostic: read.writeDiagnostic,
    writeOut: read.writeOut,
  };
}

/** `slopweaver calendar prep-due`. */
export const calendarPrepDueCommand = defineCommand({
  run: (argv) => runCalendarPrepDue({ deps: productionCalendarPrepDueDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});
