/**
 * PURE argument handling for `outlook connect` — the Outlook door's consent verb, parsed here and nowhere else.
 *
 * Its own file for the reason Gmail's `connectCore.ts` is: the grant table is the door's scope policy written
 * as flag names, read and argued about on its own.
 */
import { err, ok, type Result } from "../../../lib/result.js";
import {
  DEFAULT_OUTLOOK_GRANT,
  OUTLOOK_CALENDAR_CAPABILITY,
  OUTLOOK_GRANTS,
  type OutlookCapability,
} from "../../../live/outlook/scopes.js";
import { parseFlagTail } from "../../optionParsers.js";
import { type OutlookArgsError, OutlookArgsErrors } from "./errors.js";
import { OUTLOOK_CONNECT_USAGE } from "./outlookUsage.js";

/**
 * What one `outlook connect` invocation does.
 *
 * @internal — the declared type of `OutlookConnectArgs.mode`; callers read the field, never name the type.
 */
export type OutlookConnectMode = "consent" | "status" | "disconnect";

/** A parsed `outlook connect` invocation. */
export interface OutlookConnectArgs {
  readonly home: string | undefined;
  readonly capabilities: readonly OutlookCapability[];
  readonly json: boolean;
  readonly mode: OutlookConnectMode;
}

/**
 * Parse the `outlook connect` tail. `--status` and `--disconnect` are separate modes, so both together is a
 * refusal rather than one silently winning.
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
  const parsed = parseFlagTail({
    rest,
    spec: { boolean: ["calendar", "disconnect", "json", "status"], value: ["grant", "home"] },
  });
  if (parsed.isErr()) {
    return err(OutlookArgsErrors.flagsInvalid({ reasons: parsed.error, usage }));
  }
  const { flags, values } = parsed.value;
  if (flags.has("status") && flags.has("disconnect")) {
    return err(OutlookArgsErrors.modesConflict({ flags: ["--status", "--disconnect"], usage }));
  }
  // A destructured default rather than an operator: which grant an unflagged `connect` asks for is a policy
  // choice, and `no-silent-fallback` keeps it spelled as one.
  const { grant = DEFAULT_OUTLOOK_GRANT } = values;
  const mailCapabilities = OUTLOOK_GRANTS[grant];
  if (mailCapabilities === undefined) {
    return err(
      OutlookArgsErrors.invalidValue({
        flag: "--grant",
        got: grant,
        message: `unknown --grant: ${grant} (expected ${Object.keys(OUTLOOK_GRANTS).join(" | ")})`,
        usage,
      }),
    );
  }
  // `--calendar` is the ONLY way the calendar's permission is asked for: no mail grant carries it, so a mail-only
  // consent stays as narrow as it was before the calendar door existed.
  const capabilities = flags.has("calendar") ? [...mailCapabilities, OUTLOOK_CALENDAR_CAPABILITY] : mailCapabilities;
  let mode: OutlookConnectMode = "consent";
  if (flags.has("status")) {
    mode = "status";
  } else if (flags.has("disconnect")) {
    mode = "disconnect";
  }
  return ok({ capabilities, home: values["home"], json: flags.has("json"), mode });
}
