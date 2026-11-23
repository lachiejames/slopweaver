/**
 * Pure argument handling for `spend merchants show|set`. No filesystem, no store: `./merchantsRun.ts` is the shell.
 */
import { err, ok, type Result } from "../../../lib/result.js";
import { type FlagSpec, parseFlags } from "../../parseFlags.js";

/** `spend merchants`'s flags. */
const SPEND_MERCHANTS_FLAGS: FlagSpec = { boolean: ["json"], string: ["form", "home"] };

/** Every `spend merchants` flag NAME. */
export const SPEND_MERCHANTS_FLAG_NAMES: readonly string[] = ["--form", "--home", "--json"];

/** A parsed `spend merchants` invocation: print the register, or replace it with one document. */
export type SpendMerchantsOptions =
  | { readonly action: "show"; readonly home: string | undefined; readonly json: boolean }
  | { readonly action: "set"; readonly form: string; readonly home: string | undefined; readonly json: boolean };

/** A flag the parser refused — unknown, repeated, or missing its value. */
interface MerchantsFlagsInvalidError {
  readonly code: "MERCHANTS_FLAGS_INVALID";
  readonly message: string;
  readonly problems: readonly string[];
}

/** Not exactly one action, or one that is neither `show` nor `set`. */
interface MerchantsActionInvalidError {
  readonly code: "MERCHANTS_ACTION_INVALID";
  readonly message: string;
  readonly got: string;
}

/** `set` with no `--form`. */
interface MerchantsFormMissingError {
  readonly code: "MERCHANTS_FORM_MISSING";
  readonly message: string;
}

/** `show` with a `--form`, which only `set` reads. */
interface MerchantsFormForbiddenError {
  readonly code: "MERCHANTS_FORM_FORBIDDEN";
  readonly message: string;
}

/** Every way `spend merchants`'s argv is refused. */
export type SpendMerchantsArgsError =
  MerchantsActionInvalidError | MerchantsFlagsInvalidError | MerchantsFormForbiddenError | MerchantsFormMissingError;

/** Build one typed `spend merchants` argv refusal. */
const SpendMerchantsArgsErrors = {
  actionInvalid: ({ positionals }: { positionals: readonly string[] }): MerchantsActionInvalidError => {
    let got = "none";
    if (positionals.length > 0) {
      got = positionals.join(" ");
    }
    return {
      code: "MERCHANTS_ACTION_INVALID",
      got,
      message: `spend merchants takes exactly one action, show or set, got ${got}`,
    };
  },
  flagsInvalid: ({ problems }: { problems: readonly string[] }): MerchantsFlagsInvalidError => ({
    code: "MERCHANTS_FLAGS_INVALID",
    message: problems.join("\n"),
    problems,
  }),
  formForbidden: (): MerchantsFormForbiddenError => ({
    code: "MERCHANTS_FORM_FORBIDDEN",
    message: "spend merchants show takes no --form — `spend merchants set --form <path|->` replaces the register",
  }),
  formMissing: (): MerchantsFormMissingError => ({
    code: "MERCHANTS_FORM_MISSING",
    message: "spend merchants set needs --form <path|-> — the whole register, as one JSON document",
  }),
} as const;

/**
 * Parse `spend merchants`'s argv tail.
 *
 * @param rest the argv after `spend merchants`
 * @returns the resolved options, or the typed refusal
 */
export function parseSpendMerchantsArgs({
  rest,
}: {
  rest: readonly string[];
}): Result<SpendMerchantsOptions, SpendMerchantsArgsError> {
  const parsed = parseFlags({ allowPositionals: true, args: rest, spec: SPEND_MERCHANTS_FLAGS });
  if (parsed.isErr()) {
    return err(SpendMerchantsArgsErrors.flagsInvalid({ problems: parsed.error }));
  }
  const { positionals, values } = parsed.value;
  const action = positionals[0];
  if (positionals.length !== 1 || (action !== "show" && action !== "set")) {
    return err(SpendMerchantsArgsErrors.actionInvalid({ positionals }));
  }
  let home: string | undefined;
  if (typeof values["home"] === "string") {
    home = values["home"];
  }
  const json = values["json"] === true;
  const form = values["form"];
  if (action === "show") {
    if (form !== undefined) {
      return err(SpendMerchantsArgsErrors.formForbidden());
    }
    return ok({ action, home, json });
  }
  if (typeof form !== "string") {
    return err(SpendMerchantsArgsErrors.formMissing());
  }
  return ok({ action, form, home, json });
}
