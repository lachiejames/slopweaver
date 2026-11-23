/**
 * What `slopweaver profile standing`'s flags mean — pure, so every refusal is decidable in a unit test.
 *
 * Three modes: the LIST, one ADD and one WITHDRAW. There is deliberately no `--words`: their words are read off the
 * anchor, so a session can never type or paraphrase the quote a card will show as their. A flag that belongs to
 * another mode is refused rather than ignored.
 */
import { err, ok, type Result } from "#lib/result.js";

import { isStandingCoverage, STANDING_ASK_ID } from "../../../profile/standingAsks.js";
import { type FlagSpec, parseFlags } from "../../parseFlags.js";
import { foreignFlagsOf, type ModeFlagValues, stringFlag } from "./modeFlags.js";

const STANDING_FLAGS = {
  boolean: ["json"],
  string: ["anchor", "covers", "reason", "home", "now"],
} satisfies FlagSpec;

/** `--`-prefixed, for the help-truth ratchet. */
export const PROFILE_STANDING_FLAG_NAMES: readonly string[] = [...STANDING_FLAGS.string, ...STANDING_FLAGS.boolean]
  .map((name) => `--${name}`)
  .toSorted();

/** Why `profile standing`'s flags were refused. */
type ProfileStandingArgsError =
  | { readonly code: "FLAGS_UNPARSED"; readonly message: string }
  | { readonly code: "FOREIGN_FLAGS"; readonly message: string; readonly flags: readonly string[] }
  | { readonly code: "UNKNOWN_MODE"; readonly message: string; readonly mode: string }
  | { readonly code: "BAD_ID"; readonly message: string }
  | { readonly code: "MISSING_FLAG"; readonly message: string; readonly flag: string }
  | { readonly code: "BAD_COVERAGE"; readonly message: string; readonly coverage: string };

const ProfileStandingArgsErrors = {
  badCoverage: ({ coverage }: { coverage: string }): ProfileStandingArgsError => ({
    code: "BAD_COVERAGE",
    coverage,
    message: `--covers ${coverage} is not one of findings, registered-rows, bot-replies, unlinked-cards or act:<kind>`,
  }),
  badId: ({ mode }: { mode: string }): ProfileStandingArgsError => ({
    code: "BAD_ID",
    message: `${mode} takes exactly one id: lowercase words joined by single hyphens`,
  }),
  flagsUnparsed: ({ problems }: { problems: readonly string[] }): ProfileStandingArgsError => ({
    code: "FLAGS_UNPARSED",
    message: problems.join("; "),
  }),
  foreignFlags: ({ flags, mode }: { flags: readonly string[]; mode: string }): ProfileStandingArgsError => ({
    code: "FOREIGN_FLAGS",
    flags,
    message: `${flags.map((name) => `--${name}`).join(", ")} is not a flag ${mode} takes`,
  }),
  missingFlag: ({ flag, mode }: { flag: string; mode: string }): ProfileStandingArgsError => ({
    code: "MISSING_FLAG",
    flag,
    message: `${mode} needs --${flag}`,
  }),
  unknownMode: ({ mode }: { mode: string }): ProfileStandingArgsError => ({
    code: "UNKNOWN_MODE",
    message: `${mode} is not a mode — leave it off for the list, or say add or withdraw`,
    mode,
  }),
} as const;

/** A parsed `profile standing`. */
export type ProfileStandingArgs =
  | { readonly mode: "list"; readonly json: boolean }
  | { readonly mode: "add"; readonly id: string; readonly anchor: string; readonly covers: readonly string[] }
  | { readonly mode: "withdraw"; readonly id: string; readonly reason: string };

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
}): Result<true, ProfileStandingArgsError> {
  const flags = foreignFlagsOf({ allowed, values });
  if (flags.length > 0) {
    return err(ProfileStandingArgsErrors.foreignFlags({ flags, mode }));
  }
  return ok(true);
}

/** The one id a write names. */
function idOf({
  operands,
  mode,
}: {
  operands: readonly string[];
  mode: string;
}): Result<string, ProfileStandingArgsError> {
  const [id, ...extra] = operands;
  if (id === undefined || extra.length > 0 || !STANDING_ASK_ID.test(id)) {
    return err(ProfileStandingArgsErrors.badId({ mode }));
  }
  return ok(id);
}

/** A flag a mode cannot run without. */
function required({
  values,
  name,
  mode,
}: {
  values: Values;
  name: string;
  mode: string;
}): Result<string, ProfileStandingArgsError> {
  const value = stringFlag({ name, values });
  if (value === undefined || value.trim() === "") {
    return err(ProfileStandingArgsErrors.missingFlag({ flag: name, mode }));
  }
  return ok(value);
}

/** `--covers` as its entries, each one the register knows. */
function coversOf({ raw }: { raw: string }): Result<readonly string[], ProfileStandingArgsError> {
  const covers = raw.split(",").map((one) => one.trim());
  const bad = covers.find((coverage) => !isStandingCoverage({ coverage }));
  if (bad !== undefined) {
    return err(ProfileStandingArgsErrors.badCoverage({ coverage: bad }));
  }
  return ok(covers);
}

/** `add`'s operand and flags. */
function addArgs({
  values,
  operands,
}: {
  values: Values;
  operands: readonly string[];
}): Result<ProfileStandingArgs, ProfileStandingArgsError> {
  return ownFlagsOnly({ allowed: ["anchor", "covers"], mode: "add", values })
    .andThen(() => idOf({ mode: "add", operands }))
    .andThen((id) =>
      required({ mode: "add", name: "anchor", values }).andThen((anchor) =>
        required({ mode: "add", name: "covers", values })
          .andThen((raw) => coversOf({ raw }))
          .map((covers) => ({ anchor, covers, id, mode: "add" as const })),
      ),
    );
}

/** `withdraw`'s operand and flags. */
function withdrawArgs({
  values,
  operands,
}: {
  values: Values;
  operands: readonly string[];
}): Result<ProfileStandingArgs, ProfileStandingArgsError> {
  return ownFlagsOnly({ allowed: ["reason"], mode: "withdraw", values })
    .andThen(() => idOf({ mode: "withdraw", operands }))
    .andThen((id) =>
      required({ mode: "withdraw", name: "reason", values }).map((reason) => ({
        id,
        mode: "withdraw" as const,
        reason,
      })),
    );
}

/**
 * Parse `profile standing`'s tail.
 *
 * @param rest the argv after `profile standing`
 * @returns the arguments with the home and clock every mode takes, or the reason they were refused
 */
export function parseProfileStandingArgs({
  rest,
}: {
  rest: readonly string[];
}): Result<ProfileStandingArgs & Shared, ProfileStandingArgsError> {
  const parsed = parseFlags({ allowPositionals: true, args: rest, spec: STANDING_FLAGS });
  if (parsed.isErr()) {
    return err(ProfileStandingArgsErrors.flagsUnparsed({ problems: parsed.error }));
  }
  const { positionals, values } = parsed.value;
  const shared: Shared = { home: stringFlag({ name: "home", values }), now: stringFlag({ name: "now", values }) };
  const [mode, ...operands] = positionals;
  let args: Result<ProfileStandingArgs, ProfileStandingArgsError>;
  if (mode === undefined) {
    args = ownFlagsOnly({ allowed: ["json"], mode: "the list", values }).map(() => ({
      json: values["json"] === true,
      mode: "list" as const,
    }));
  } else if (mode === "add") {
    args = addArgs({ operands, values });
  } else if (mode === "withdraw") {
    args = withdrawArgs({ operands, values });
  } else {
    args = err(ProfileStandingArgsErrors.unknownMode({ mode }));
  }
  return args.map((one) => ({ ...one, ...shared }));
}
