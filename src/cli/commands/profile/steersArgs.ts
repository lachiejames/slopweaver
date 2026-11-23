/**
 * What `slopweaver profile steers`' flags mean — pure, so every refusal is decidable in a unit test.
 *
 * Three modes: the READING, the UNREAD turns, and one JUDGE write. A flag that belongs to another mode is refused
 * rather than ignored, because `profile steers unread --kind proof` asks a question this verb would not answer.
 */
import { err, ok, type Result } from "#lib/result.js";

import { SLACK_STEER_KIND_IDS, type SteerSays } from "../../../profile/steerKinds.js";
import { type FlagSpec, parseFlags } from "../../parseFlags.js";
import { foreignFlagsOf, type ModeFlagValues, stringFlag } from "./modeFlags.js";

const STEERS_FLAGS = {
  boolean: ["json", "nothing", "withdraw"],
  string: ["since", "until", "limit", "home", "now", "kind", "says", "quote"],
} satisfies FlagSpec;

/** `--`-prefixed, for the help-truth ratchet. */
export const PROFILE_STEERS_FLAG_NAMES: readonly string[] = [...STEERS_FLAGS.string, ...STEERS_FLAGS.boolean]
  .map((name) => `--${name}`)
  .toSorted();

/** How far back a reading looks when `--since` is not given: the chart's window. */
const DEFAULT_SINCE = "60d";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 500;

/** Why `profile steers`' flags were refused: one per way they can fail to make one invocation. */
type ProfileSteersArgsError =
  | { readonly code: "FLAGS_UNPARSED"; readonly message: string }
  | { readonly code: "FOREIGN_FLAGS"; readonly message: string; readonly flags: readonly string[] }
  | { readonly code: "UNKNOWN_MODE"; readonly message: string; readonly mode: string }
  | { readonly code: "BAD_OPERANDS"; readonly message: string }
  | { readonly code: "BAD_LIMIT"; readonly message: string; readonly raw: string }
  | { readonly code: "UNKNOWN_KIND"; readonly message: string; readonly kind: string }
  | { readonly code: "NOTHING_TAKES_NO_KIND"; readonly message: string }
  | { readonly code: "WITHDRAW_NEEDS_KIND"; readonly message: string }
  | { readonly code: "JUDGEMENT_INCOMPLETE"; readonly message: string }
  | { readonly code: "EMPTY_QUOTE"; readonly message: string };

const ProfileSteersArgsErrors = {
  badLimit: ({ raw }: { raw: string }): ProfileSteersArgsError => ({
    code: "BAD_LIMIT",
    message: `--limit ${raw} is not a whole number from 1 to ${String(MAX_LIMIT)}`,
    raw,
  }),
  badOperands: ({ mode }: { mode: "unread" | "judge" }): ProfileSteersArgsError => ({
    code: "BAD_OPERANDS",
    message: mode === "judge" ? "judge takes exactly one anchor — the turn read" : "unread takes no operand",
  }),
  emptyQuote: (): ProfileSteersArgsError => ({
    code: "EMPTY_QUOTE",
    message: "--quote is empty — quote the words about the kind",
  }),
  flagsUnparsed: ({ problems }: { problems: readonly string[] }): ProfileSteersArgsError => ({
    code: "FLAGS_UNPARSED",
    message: problems.join("; "),
  }),
  foreignFlags: ({ flags, mode }: { flags: readonly string[]; mode: string }): ProfileSteersArgsError => ({
    code: "FOREIGN_FLAGS",
    flags,
    message: `${flags.map((name) => `--${name}`).join(", ")} is not a flag ${mode} takes`,
  }),
  judgementIncomplete: (): ProfileSteersArgsError => ({
    code: "JUDGEMENT_INCOMPLETE",
    message: "judge needs --kind, --says corrects|stopped and --quote, or --nothing, or --kind with --withdraw",
  }),
  nothingTakesNoKind: (): ProfileSteersArgsError => ({
    code: "NOTHING_TAKES_NO_KIND",
    message: "--nothing says the turn names no kind, so it takes no --kind, --says, --quote or --withdraw",
  }),
  unknownKind: ({ kind }: { kind: string }): ProfileSteersArgsError => ({
    code: "UNKNOWN_KIND",
    kind,
    message: `--kind ${kind} is not one of ${SLACK_STEER_KIND_IDS.join(", ")}`,
  }),
  unknownMode: ({ mode }: { mode: string }): ProfileSteersArgsError => ({
    code: "UNKNOWN_MODE",
    message: `${mode} is not a mode — leave it off for the reading, or say unread or judge`,
    mode,
  }),
  withdrawNeedsKind: (): ProfileSteersArgsError => ({
    code: "WITHDRAW_NEEDS_KIND",
    message: "--withdraw takes back one kind's read: --kind, and no --says or --quote",
  }),
} as const;

/** The judge's one write. */
type SteerJudgement =
  | { readonly mode: "names"; readonly kind: string; readonly says: SteerSays; readonly quote: string }
  | { readonly mode: "nothing" }
  | { readonly mode: "withdraw"; readonly kind: string };

/** A parsed `profile steers`. */
export type ProfileSteersArgs =
  | { readonly mode: "reading"; readonly since: string; readonly until: string | undefined; readonly json: boolean }
  | {
      readonly mode: "unread";
      readonly since: string;
      readonly until: string | undefined;
      readonly limit: number;
      readonly json: boolean;
    }
  | { readonly mode: "judge"; readonly anchor: string; readonly judgement: SteerJudgement };

/** The home and clock every mode takes. */
interface Shared {
  readonly home: string | undefined;
  readonly now: string | undefined;
}

type Values = ModeFlagValues;

/** Refuse every typed flag a mode does not take, naming them all at once. */
function ownFlagsOnly({
  values,
  allowed,
  mode,
}: {
  values: Values;
  allowed: readonly string[];
  mode: string;
}): Result<true, ProfileSteersArgsError> {
  const flags = foreignFlagsOf({ allowed, values });
  if (flags.length > 0) {
    return err(ProfileSteersArgsErrors.foreignFlags({ flags, mode }));
  }
  return ok(true);
}

/** The judge's flags as one judgement, or the reason they are not one. */
function judgementOf({ values }: { values: Values }): Result<SteerJudgement, ProfileSteersArgsError> {
  const kind = stringFlag({ name: "kind", values });
  const says = stringFlag({ name: "says", values });
  const quote = stringFlag({ name: "quote", values });
  const nothing = values["nothing"] === true;
  const withdraw = values["withdraw"] === true;
  if (kind !== undefined && !SLACK_STEER_KIND_IDS.includes(kind)) {
    return err(ProfileSteersArgsErrors.unknownKind({ kind }));
  }
  if (nothing) {
    const namesMore = kind !== undefined || says !== undefined || quote !== undefined || withdraw;
    return namesMore ? err(ProfileSteersArgsErrors.nothingTakesNoKind()) : ok({ mode: "nothing" });
  }
  if (withdraw) {
    const shaped = kind !== undefined && says === undefined && quote === undefined;
    return shaped ? ok({ kind, mode: "withdraw" }) : err(ProfileSteersArgsErrors.withdrawNeedsKind());
  }
  if (kind === undefined || quote === undefined || (says !== "corrects" && says !== "stopped")) {
    return err(ProfileSteersArgsErrors.judgementIncomplete());
  }
  if (quote.trim() === "") {
    return err(ProfileSteersArgsErrors.emptyQuote());
  }
  return ok({ kind, mode: "names", quote, says });
}

/** `--limit`, or the refusal. */
function limitOf({ raw }: { raw: string | undefined }): Result<number, ProfileSteersArgsError> {
  if (raw === undefined) {
    return ok(DEFAULT_LIMIT);
  }
  const limit = Number(raw);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    return err(ProfileSteersArgsErrors.badLimit({ raw }));
  }
  return ok(limit);
}

/** `unread`'s flags, or the first refusal. */
function unreadArgs({
  values,
  operands,
  window,
}: {
  values: Values;
  operands: readonly string[];
  window: { readonly since: string; readonly until: string | undefined; readonly json: boolean };
}): Result<ProfileSteersArgs, ProfileSteersArgsError> {
  if (operands.length > 0) {
    return err(ProfileSteersArgsErrors.badOperands({ mode: "unread" }));
  }
  return ownFlagsOnly({ allowed: ["since", "until", "json", "limit"], mode: "unread", values })
    .andThen(() => limitOf({ raw: stringFlag({ name: "limit", values }) }))
    .map((limit) => ({ ...window, limit, mode: "unread" as const }));
}

/** `judge`'s operand and flags, or the first refusal. */
function judgeArgs({
  values,
  operands,
}: {
  values: Values;
  operands: readonly string[];
}): Result<ProfileSteersArgs, ProfileSteersArgsError> {
  const [anchor, ...extra] = operands;
  if (anchor === undefined || extra.length > 0) {
    return err(ProfileSteersArgsErrors.badOperands({ mode: "judge" }));
  }
  return ownFlagsOnly({ allowed: ["kind", "says", "quote", "nothing", "withdraw"], mode: "judge", values })
    .andThen(() => judgementOf({ values }))
    .map((judgement) => ({ anchor, judgement, mode: "judge" as const }));
}

/**
 * Parse `profile steers`' tail.
 *
 * @param rest the argv after `profile steers`
 * @returns the arguments with the home and clock every mode takes, or the reason they were refused
 */
export function parseProfileSteersArgs({
  rest,
}: {
  rest: readonly string[];
}): Result<ProfileSteersArgs & Shared, ProfileSteersArgsError> {
  const parsed = parseFlags({ allowPositionals: true, args: rest, spec: STEERS_FLAGS });
  if (parsed.isErr()) {
    return err(ProfileSteersArgsErrors.flagsUnparsed({ problems: parsed.error }));
  }
  const { positionals, values } = parsed.value;
  const shared: Shared = { home: stringFlag({ name: "home", values }), now: stringFlag({ name: "now", values }) };
  const [mode, ...operands] = positionals;
  let since = DEFAULT_SINCE;
  const sinceFlag = stringFlag({ name: "since", values });
  if (sinceFlag !== undefined) {
    since = sinceFlag;
  }
  const window = { json: values["json"] === true, since, until: stringFlag({ name: "until", values }) };
  let args: Result<ProfileSteersArgs, ProfileSteersArgsError>;
  if (mode === undefined) {
    args = ownFlagsOnly({ allowed: ["since", "until", "json"], mode: "the reading", values }).map(() => ({
      ...window,
      mode: "reading" as const,
    }));
  } else if (mode === "unread") {
    args = unreadArgs({ operands, values, window });
  } else if (mode === "judge") {
    args = judgeArgs({ operands, values });
  } else {
    args = err(ProfileSteersArgsErrors.unknownMode({ mode }));
  }
  return args.map((one) => ({ ...one, ...shared }));
}
