/**
 * PURE argument handling for the two Microsoft consent verbs — `outlook connect` (mail) and
 * `outlook-calendar connect` (calendar) — parsed here and nowhere else.
 *
 * Its own file for the reason Gmail's `connectCore.ts` is: a grant table is the door's scope policy written as
 * flag names, read and argued about on its own. Both verbs live here because they share the same three modes
 * and differ only in what they ask Microsoft for: mail a `--grant` tier of mail permissions, calendar one fixed
 * consent of `User.Read` and `Calendars.Read`. Neither asks for the other product's permission.
 */
import { err, ok, type Result } from "../../../lib/result.js";
import {
  DEFAULT_OUTLOOK_GRANT,
  OUTLOOK_CALENDAR_GRANT,
  OUTLOOK_GRANTS,
  type OutlookCapability,
} from "../../../live/outlook/scopes.js";
import { parseFlagTail } from "../../optionParsers.js";
import { OUTLOOK_CALENDAR_CONNECT_USAGE } from "../outlookCalendar/outlookCalendarUsage.js";
import { type OutlookArgsError, OutlookArgsErrors } from "./errors.js";
import { OUTLOOK_CONNECT_USAGE } from "./outlookUsage.js";

/**
 * What one connect invocation does.
 *
 * @internal — the declared type of `OutlookConnectArgs.mode`; callers read the field, never name the type.
 */
export type OutlookConnectMode = "consent" | "status" | "disconnect";

/** A parsed `outlook connect` or `outlook-calendar connect` invocation. */
export interface OutlookConnectArgs {
  readonly home: string | undefined;
  readonly capabilities: readonly OutlookCapability[];
  readonly json: boolean;
  readonly mode: OutlookConnectMode;
}

/**
 * What `outlook connect --calendar` is told: the calendar is not a mail permission, and has its own consent.
 * A plain unknown-flag refusal would leave the reader guessing where the calendar's consent went.
 */
const MAIL_CALENDAR_FLAG_REFUSAL =
  "--calendar is not an `outlook connect` option: the calendar is its own integration with its own consent — " +
  "run `slopweaver outlook-calendar connect`";

/** The mode both verbs share: `--status` and `--disconnect` together are a refusal, never one silently winning. */
function connectModeOf({
  flags,
  usage,
}: {
  flags: ReadonlySet<string>;
  usage: string;
}): Result<OutlookConnectMode, OutlookArgsError> {
  if (flags.has("status") && flags.has("disconnect")) {
    return err(OutlookArgsErrors.modesConflict({ flags: ["--status", "--disconnect"], usage }));
  }
  if (flags.has("status")) {
    return ok("status");
  }
  if (flags.has("disconnect")) {
    return ok("disconnect");
  }
  return ok("consent");
}

/**
 * Parse the `outlook connect` tail — the MAIL consent. It asks for a `--grant` tier of mail permissions and
 * nothing else; `--calendar` is refused with the calendar's own verb named.
 *
 * @param rest the argv tail after `outlook connect`
 * @returns the validated request, or the reason it was refused
 */
export function parseOutlookConnectArgs({
  rest,
}: {
  rest: readonly string[];
}): Result<OutlookConnectArgs, OutlookArgsError> {
  const usage = OUTLOOK_CONNECT_USAGE;
  if (rest.includes("--calendar")) {
    return err(OutlookArgsErrors.flagsInvalid({ reasons: [MAIL_CALENDAR_FLAG_REFUSAL], usage }));
  }
  const parsed = parseFlagTail({
    rest,
    spec: { boolean: ["disconnect", "json", "status"], value: ["grant", "home"] },
  });
  if (parsed.isErr()) {
    return err(OutlookArgsErrors.flagsInvalid({ reasons: parsed.error, usage }));
  }
  const { flags, values } = parsed.value;
  const mode = connectModeOf({ flags, usage });
  if (mode.isErr()) {
    return err(mode.error);
  }
  // A destructured default rather than an operator: which grant an unflagged `connect` asks for is a policy
  // choice, and `no-silent-fallback` keeps it spelled as one.
  const { grant = DEFAULT_OUTLOOK_GRANT } = values;
  const capabilities = OUTLOOK_GRANTS[grant];
  if (capabilities === undefined) {
    return err(
      OutlookArgsErrors.invalidValue({
        flag: "--grant",
        got: grant,
        message: `unknown --grant: ${grant} (expected ${Object.keys(OUTLOOK_GRANTS).join(" | ")})`,
        usage,
      }),
    );
  }
  return ok({ capabilities, home: values["home"], json: flags.has("json"), mode: mode.value });
}

/**
 * Parse the `outlook-calendar connect` tail — the CALENDAR consent. There is no tier to choose: it always asks
 * for `User.Read` and `Calendars.Read`, nothing of the mailbox.
 *
 * @param rest the argv tail after `outlook-calendar connect`
 * @returns the validated request, or the reason it was refused
 */
export function parseOutlookCalendarConnectArgs({
  rest,
}: {
  rest: readonly string[];
}): Result<OutlookConnectArgs, OutlookArgsError> {
  const usage = OUTLOOK_CALENDAR_CONNECT_USAGE;
  const parsed = parseFlagTail({ rest, spec: { boolean: ["disconnect", "json", "status"], value: ["home"] } });
  if (parsed.isErr()) {
    return err(OutlookArgsErrors.flagsInvalid({ reasons: parsed.error, usage }));
  }
  const { flags, values } = parsed.value;
  const mode = connectModeOf({ flags, usage });
  if (mode.isErr()) {
    return err(mode.error);
  }
  return ok({ capabilities: OUTLOOK_CALENDAR_GRANT, home: values["home"], json: flags.has("json"), mode: mode.value });
}
