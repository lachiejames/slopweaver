/**
 * The PURE parse of `slack correct` — strike one claim in a message the bot posted and put a bold Correction line
 * under it, in place. `./correctRun.ts` is the shell that reads, guards and writes.
 *
 * Its own verb rather than a flag on `slack edit`, because the two answer different questions: `edit` re-renders a
 * card from a NEW form the caller wrote, and `correct` rewrites the STORED message, keeping every word but the
 * one claim (`../../../outbound/slack/claimCorrection.ts`). The edit rides the original send's approval — the claim
 * is struck where readers already saw it, never deleted and never answered with a bare reply (handover
 * `a-slack-send-re-reads-its-thread-first`, check 5).
 */
import { err, ok } from "../../../lib/result.js";
import { isSlackTs } from "../../../lib/slackTs.js";
import type { SlackActor } from "../../../outbound/slack/types.js";
import { flagValueOr, parseFlagTail } from "../../optionParsers.js";
import { SlackArgumentErrors, type SlackParsed } from "./argumentErrors.js";

/** `slack correct`'s flag spec, exported for the help/flag ratchet exactly as `SLACK_EDIT_FLAG_SPEC` is. */
export const SLACK_CORRECT_FLAG_SPEC = {
  boolean: ["dry-run", "json", "urgent"],
  value: ["as", "channel", "correction", "home", "magnitude-seen", "notify-draft", "ts", "wrong"],
} as const;

/** A parsed `slack correct`. */
export interface CorrectOptions {
  /**
   * Whose message it is: `bot` (the default), proven by its `bot_id` and card metadata, or `me`, a message
   * Slopweaver sent under the owner's name, proven by a released row in the as-me draft register and edited with the owner's token.
   */
  readonly actor: SlackActor;
  readonly channel: string;
  readonly ts: string;
  /** The claim's exact words, as the message states them once. */
  readonly wrong: string;
  /** What is true now: the line that follows the bold `Correction:` label. */
  readonly correction: string;
  /**
   * Where the owner said they saw an order-of-magnitude correction before it went out — the anchor of
   * their answer on the Queue. Absent on every same-order correction, which goes out without them.
   */
  readonly magnitudeSeen?: string | undefined;
  /** The held DM row (`slack draft record`) parked for the people the wrong claim reached, on an urgent correction. */
  readonly notifyDraft?: string | undefined;
  readonly urgent: boolean;
  readonly dryRun: boolean;
  readonly json: boolean;
  readonly home: string;
}

/** The refusals between flags: `--urgent` and `--notify-draft` require each other, and `--as` names a lane. */
function pairingRefusals({
  as,
  notifyDraft,
  urgent,
}: {
  as: string | undefined;
  notifyDraft: string | undefined;
  urgent: boolean;
}): readonly string[] {
  const errors: string[] = [];
  if (urgent && notifyDraft === undefined) {
    errors.push(
      "--urgent needs --notify-draft <id>: park the direct message first with `slopweaver slack draft record`, " +
        "then name its row here. This verb never sends a DM itself.",
    );
  }
  if (!urgent && notifyDraft !== undefined) {
    errors.push("--notify-draft is only for an --urgent correction, which is the edit plus a parked DM");
  }
  if (as !== undefined && as !== "bot" && as !== "me") {
    errors.push(SlackArgumentErrors.actorInvalid({ got: as }).message);
  }
  return errors;
}

/**
 * Parse `slack correct`, pooling every rejection in one pass.
 *
 * `--urgent` and `--notify-draft` require each other: an urgent correction is the edit PLUS a direct message parked
 * for the owner's approval, and the verb only checks that parked row — it never sends a DM itself, so an `--urgent` naming
 * no row would promise a notice nobody parked.
 *
 * @param rest the argv tail after the verb
 * @param defaultHome the resolved state home
 * @returns the parsed options, or every rejection
 */
export function parseCorrectArgs({
  rest,
  defaultHome,
}: {
  rest: readonly string[];
  defaultHome: string;
}): SlackParsed<CorrectOptions> {
  const parsed = parseFlagTail({ rest, spec: SLACK_CORRECT_FLAG_SPEC });
  if (parsed.isErr()) {
    return err(SlackArgumentErrors.flagsInvalid({ reasons: parsed.error }));
  }
  const { flags, values } = parsed.value;
  const { channel, correction, ts, wrong } = values;
  const errors: string[] = [];
  for (const [flag, value] of [
    ["--channel", channel],
    ["--ts", ts],
    ["--wrong", wrong],
    ["--correction", correction],
  ] as const) {
    if (value === undefined || value.length === 0) {
      errors.push(SlackArgumentErrors.flagRequired({ flag }).message);
    }
  }
  if (ts !== undefined && ts.length > 0 && !isSlackTs({ ts })) {
    errors.push(`--ts must be a Slack message ts such as 1712345678.000100, got ${JSON.stringify(ts)}`);
  }
  const urgent = flags.has("urgent");
  const notifyDraft = values["notify-draft"];
  const as = values["as"];
  errors.push(...pairingRefusals({ as, notifyDraft, urgent }));
  const actor: SlackActor = as === "me" ? "me" : "bot";
  if (errors.length > 0) {
    return err(SlackArgumentErrors.argumentsRefused({ reasons: errors }));
  }
  if (channel === undefined || ts === undefined || wrong === undefined || correction === undefined) {
    return err(SlackArgumentErrors.invocationIncoherent({ verb: "correct" })); // unreachable: no errors ⇒ all present
  }
  return ok({
    actor,
    channel,
    correction,
    dryRun: flags.has("dry-run"),
    home: flagValueOr({ fallback: defaultHome, name: "home", parsed: parsed.value }),
    json: flags.has("json"),
    magnitudeSeen: values["magnitude-seen"],
    notifyDraft,
    ts,
    urgent,
    wrong,
  });
}
