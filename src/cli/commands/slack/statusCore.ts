/**
 * `slack status` — parsing and the write plan, pure. What the verb SAYS about a write is `./statusReport.ts`;
 * the shell that touches Slack is `./statusRun.ts`.
 *
 * ## The gap this closes
 *
 * The owner rule: "pls update my calendar and slack status accordingly, and if
 * you dont have the verbs for that, then write those verbs". Nothing in this repo could set a Slack status.
 *
 * ## Why presence is its own sub-command
 *
 * A status expires; a manual away does not. Slack documents that `users.setPresence away` persists across
 * connections until it is set back to `auto`, whatever the status's expiry says. Folding it into `set` would
 * let `set --until end-of-day` read as if the away expired too, and would leave two writes with a partial
 * failure between them. So `presence --to away` is separate, and prints its own reversal.
 *
 * Always the USER token: a status is their, and the bot has no profile of their to set.
 */
import { err, ok, type Result } from "#lib/result.js";
import { parseFlagTail } from "../../optionParsers.js";
import { type SlackStatusError, SlackStatusErrors, type StatusSubcommand } from "./statusErrors.js";

/** Slack's own ceiling on `status_text`. Refused above it, never cut. */
const SLACK_STATUS_TEXT_MAX = 100;

/** The flag tokens `slack status` accepts. Exported so `helpTruth` compares the usage against the SPEC. */
export const SLACK_STATUS_FLAG_SPEC = {
  boolean: ["dry-run", "json"],
  value: ["text", "emoji", "until", "zone", "to", "home"],
} as const;

/** Which flags each sub-command takes; any other flag is refused rather than ignored. */
const FLAGS_OF: Readonly<Record<StatusSubcommand, readonly string[]>> = {
  clear: ["dry-run", "json", "home"],
  presence: ["to", "dry-run", "json", "home"],
  set: ["text", "emoji", "until", "zone", "dry-run", "json", "home"],
  show: ["zone", "json", "home"],
};

/** What a `set` asked the expiry to be. */
export type StatusExpiryRequest =
  | { readonly kind: "never" }
  | { readonly kind: "instant"; readonly atMs: number }
  | { readonly kind: "end-of-day"; readonly zone: string };

/** The fields every sub-command carries. */
interface StatusCommon {
  readonly json: boolean;
  readonly home: string;
}

/** `slack status …`, parsed. */
export type StatusInvocation =
  | (StatusCommon & {
      readonly sub: "set";
      readonly text: string;
      readonly emoji: string;
      readonly until: StatusExpiryRequest;
      readonly zone: string | undefined;
      readonly dryRun: boolean;
    })
  | (StatusCommon & { readonly sub: "clear"; readonly dryRun: boolean })
  | (StatusCommon & { readonly sub: "show"; readonly zone: string | undefined })
  | (StatusCommon & { readonly sub: "presence"; readonly presence: "away" | "auto"; readonly dryRun: boolean });

/** One status write, fully decided — the dry run and the real write both consume this. */
export interface StatusProfilePlan {
  readonly operation: "set" | "clear";
  readonly statusText: string;
  readonly statusEmoji: string;
  /** Epoch seconds; 0 is "never expires". */
  readonly expirationSeconds: number;
}

/** An emoji name between colons, optionally with a skin tone — the shape Slack's own picker writes. */
const EMOJI_SHAPE = /^:[\w+'-]+(?:::skin-tone-[2-6])?:$/;

/**
 * An ISO instant that says which zone it is in, and nothing looser: `Date.parse` reads one without an offset
 * as MACHINE-local time, and takes shapes like `next Friday -05:00` that no one means as ISO. No
 * fractional seconds, because Slack holds whole seconds and rounding one would send an instant nobody wrote.
 */
const ISO_WITH_OFFSET = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(?:Z|([+-])(\d{2}):(\d{2}))$/;

/**
 * The instant an ISO `--until` names, or `undefined` when it is not strict ISO or names a wall clock that does
 * not exist. `Date.parse` rolls an impossible day of the month over into the next month; reading the fields back at the stated offset and
 * requiring them unchanged is what refuses it.
 */
function isoInstantMs({ raw }: { raw: string }): number | undefined {
  const match = ISO_WITH_OFFSET.exec(raw);
  const atMs = Date.parse(raw);
  if (match === null || !Number.isFinite(atMs)) {
    return undefined;
  }
  // An omitted seconds field is :00, exactly as `Date.parse` reads it.
  const [, year, month, day, hour, minute, second = "0", sign, offsetHours, offsetMinutes] = match;
  let offsetMs = 0;
  if (sign !== undefined) {
    offsetMs = (sign === "-" ? -1 : 1) * (Number(offsetHours) * 60 + Number(offsetMinutes)) * 60_000;
  }
  const wall = new Date(atMs + offsetMs);
  const written = [year, month, day, hour, minute, second].map((field) => Number(field));
  const held = [
    wall.getUTCFullYear(),
    wall.getUTCMonth() + 1,
    wall.getUTCDate(),
    wall.getUTCHours(),
    wall.getUTCMinutes(),
    wall.getUTCSeconds(),
  ];
  return written.every((value, index) => value === held[index]) ? atMs : undefined;
}

/**
 * Parse the `slack status` tail into a checked invocation.
 *
 * @param rest the argv tail, after `slopweaver slack status`
 * @param defaultHome the home to use when `--home` is absent
 * @returns the parsed invocation, or the first refusal
 */
export function parseStatusArgs({
  rest,
  defaultHome,
}: {
  rest: readonly string[];
  defaultHome: string;
}): Result<StatusInvocation, SlackStatusError> {
  const sub = rest[0];
  if (sub !== "set" && sub !== "clear" && sub !== "show" && sub !== "presence") {
    return err(SlackStatusErrors.subcommandUnknown({ got: sub }));
  }
  const parsed = parseFlagTail({ rest: rest.slice(1), spec: SLACK_STATUS_FLAG_SPEC });
  if (parsed.isErr()) {
    return err(SlackStatusErrors.flagsRejected({ problems: parsed.error }));
  }
  const { values, flags } = parsed.value;
  const stray = [...Object.keys(values), ...flags].find((flag) => !FLAGS_OF[sub].includes(flag));
  if (stray !== undefined) {
    return err(SlackStatusErrors.flagNotForSubcommand({ flag: stray, sub }));
  }
  const { home = defaultHome } = values;
  const zone = values["zone"];
  if (zone !== undefined && !isKnownZone({ zone })) {
    return err(SlackStatusErrors.zoneUnknown({ zone }));
  }
  const common = { home, json: flags.has("json") };
  const dryRun = flags.has("dry-run");
  if (sub === "clear") {
    return ok({ ...common, dryRun, sub });
  }
  if (sub === "show") {
    return ok({ ...common, sub, zone: values["zone"] });
  }
  if (sub === "presence") {
    return parsePresence({ common, dryRun, raw: values["to"] });
  }
  return parseSet({ common, dryRun, values });
}

/** `presence --to away|auto`. */
function parsePresence({
  common,
  dryRun,
  raw,
}: {
  common: StatusCommon;
  dryRun: boolean;
  raw: string | undefined;
}): Result<StatusInvocation, SlackStatusError> {
  if (raw !== "away" && raw !== "auto") {
    return err(SlackStatusErrors.presenceInvalid({ raw }));
  }
  return ok({ ...common, dryRun, presence: raw, sub: "presence" });
}

/** `set` — text and/or emoji, and an expiry. */
function parseSet({
  common,
  dryRun,
  values,
}: {
  common: StatusCommon;
  dryRun: boolean;
  values: Readonly<Record<string, string>>;
}): Result<StatusInvocation, SlackStatusError> {
  const { emoji = "", text = "" } = values;
  const zone = values["zone"];
  if (text === "" && emoji === "") {
    return err(SlackStatusErrors.statusEmpty());
  }
  const chars = Array.from(text).length;
  if (chars > SLACK_STATUS_TEXT_MAX) {
    return err(SlackStatusErrors.textTooLong({ chars, max: SLACK_STATUS_TEXT_MAX }));
  }
  if (emoji !== "" && !EMOJI_SHAPE.test(emoji)) {
    return err(SlackStatusErrors.emojiMalformed({ emoji }));
  }
  const until = parseUntil({ raw: values["until"], zone });
  if (until.isErr()) {
    return err(until.error);
  }
  return ok({ ...common, dryRun, emoji, sub: "set", text, until: until.value, zone });
}

/**
 * Whether this runtime knows `zone` as an IANA zone. Checked at parse, because a mistyped zone would otherwise
 * reach the renderer, which falls back to UTC and prints that instant beside the zone's name as if it were local.
 */
function isKnownZone({ zone }: { zone: string }): boolean {
  try {
    // The constructor throws a RangeError on a zone it does not know.
    return new Intl.DateTimeFormat("en-AU", { timeZone: zone }).resolvedOptions().timeZone !== "";
  } catch {
    return false;
  }
}

/** `--until`: absent (never), `end-of-day` (needs a zone), or an ISO instant that names its offset. */
function parseUntil({
  raw,
  zone,
}: {
  raw: string | undefined;
  zone: string | undefined;
}): Result<StatusExpiryRequest, SlackStatusError> {
  if (raw === undefined) {
    return ok({ kind: "never" });
  }
  if (raw === "end-of-day") {
    return zone === undefined ? err(SlackStatusErrors.untilNeedsZone()) : ok({ kind: "end-of-day", zone });
  }
  const atMs = isoInstantMs({ raw });
  if (atMs === undefined) {
    return err(SlackStatusErrors.untilUnparseable({ raw }));
  }
  return ok({ atMs, kind: "instant" });
}

/**
 * The profile write a `set` or `clear` makes. A clear sends all three fields empty together, because Slack
 * refuses to clear one of text and emoji without the other.
 *
 * @param invocation the parsed set or clear
 * @param expiresAtMs the resolved expiry, `undefined` for never; ignored by a clear
 * @returns the write both the dry run and the real path consume
 */
export function buildStatusProfilePlan({
  invocation,
  expiresAtMs,
}: {
  invocation: Extract<StatusInvocation, { sub: "set" | "clear" }>;
  expiresAtMs: number | undefined;
}): StatusProfilePlan {
  if (invocation.sub === "clear") {
    return { expirationSeconds: 0, operation: "clear", statusEmoji: "", statusText: "" };
  }
  return {
    expirationSeconds: expiresAtMs === undefined ? 0 : Math.floor(expiresAtMs / 1000),
    operation: "set",
    statusEmoji: invocation.emoji,
    statusText: invocation.text,
  };
}
