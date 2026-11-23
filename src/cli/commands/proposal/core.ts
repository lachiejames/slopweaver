/**
 * The PURE core of `proposal draft` and `proposal lint` — argument parsing, form validation, and the
 * operator-facing report. No I/O, so all of it is unit-testable without a mock.
 */
import { err, ok, type Result } from "../../../lib/result.js";
import { proposalFormSchema } from "../../../outbound/proposal/schema.js";
import type { ProposalForm } from "../../../outbound/proposal/types.js";
import { booleanFlagsOf, type FlagSpec, parseFlags, stringFlagsOf } from "../../parseFlags.js";
import { type ProposalError, ProposalErrors } from "./errors.js";

/**
 * A parsed `proposal draft` invocation.
 *
 * `formExample` is its own arm rather than a flag alongside `formSource`, because the two are exclusive:
 * printing the example reads nothing and writes nothing, so requiring `--form` beside it would be a refusal
 * of the one invocation someone reaches for when they do not yet know what `--form` wants.
 */
export type ProposalDraftArgs =
  | { readonly kind: "example" }
  | {
      readonly kind: "render";
      readonly formSource: string;
      readonly out: string | undefined;
      readonly json: boolean;
      readonly home: string | undefined;
    };

/** A parsed `proposal lint` invocation. */
export interface ProposalLintArgs {
  readonly path: string;
  readonly json: boolean;
  readonly home: string | undefined;
}

/** The flags `proposal draft` accepts; `helpTruth.test.ts` compares the names derived below both ways. */
const PROPOSAL_DRAFT_FLAGS: FlagSpec = {
  boolean: ["json", "form-example"],
  string: ["form", "out", "home"],
};

/** The flags `proposal lint` accepts. */
const PROPOSAL_LINT_FLAGS: FlagSpec = { boolean: ["json"], string: ["home"] };

/** Every `proposal draft` flag, WITH the `--`, for the help-truth ratchet. */
export const PROPOSAL_DRAFT_FLAG_NAMES: readonly string[] = [
  ...stringFlagsOf({ spec: PROPOSAL_DRAFT_FLAGS }),
  ...booleanFlagsOf({ spec: PROPOSAL_DRAFT_FLAGS }),
].map((name) => `--${name}`);

/** Every `proposal lint` flag, WITH the `--`, for the help-truth ratchet. */
export const PROPOSAL_LINT_FLAG_NAMES: readonly string[] = [
  ...stringFlagsOf({ spec: PROPOSAL_LINT_FLAGS }),
  ...booleanFlagsOf({ spec: PROPOSAL_LINT_FLAGS }),
].map((name) => `--${name}`);

/**
 * Parse `proposal draft --form <json|-> [--out <md>]`.
 *
 * @param rest the verb's arguments, excluding the noun and the verb
 * @returns the parsed arguments, or the operator-facing errors
 */
export function parseProposalDraftArgs({
  rest,
}: {
  rest: readonly string[];
}): Result<ProposalDraftArgs, ProposalError> {
  const parsed = parseFlags({ args: rest, spec: PROPOSAL_DRAFT_FLAGS });
  if (parsed.isErr()) {
    return err(ProposalErrors.flagsInvalid({ reasons: parsed.error }));
  }
  const { values } = parsed.value;
  if (values["form-example"] === true) {
    return ok({ kind: "example" });
  }
  const text = ({ name }: { name: string }): string | undefined =>
    typeof values[name] === "string" ? values[name] : undefined;
  const formSource = text({ name: "form" });
  if (formSource === undefined) {
    return err(ProposalErrors.draftFormRequired());
  }
  return ok({
    formSource,
    home: text({ name: "home" }),
    json: values["json"] === true,
    kind: "render",
    out: text({ name: "out" }),
  });
}

/**
 * Parse `proposal lint <path>`.
 *
 * @param rest the verb's arguments, excluding the noun and the verb
 * @returns the parsed arguments, or the operator-facing errors
 */
export function parseProposalLintArgs({ rest }: { rest: readonly string[] }): Result<ProposalLintArgs, ProposalError> {
  const [path, ...flags] = rest;
  if (path === undefined || path.startsWith("-")) {
    return err(
      ProposalErrors.usage({ usage: "usage: slopweaver proposal lint <path-to-draft.md> [--json] [--home <dir>]" }),
    );
  }
  const parsed = parseFlags({ args: flags, spec: PROPOSAL_LINT_FLAGS });
  if (parsed.isErr()) {
    return err(ProposalErrors.flagsInvalid({ reasons: parsed.error }));
  }
  const { values } = parsed.value;
  return ok({
    home: typeof values["home"] === "string" ? values["home"] : undefined,
    json: values["json"] === true,
    path,
  });
}

/**
 * Validate a filled proposal form.
 *
 * @param raw the JSON text of the form
 * @returns the typed form, or one line per rejection naming its path
 */
export function parseProposalForm({ raw }: { raw: string }): Result<ProposalForm, ProposalError> {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (error: unknown) {
    return err(ProposalErrors.formNotJson({ detail: error instanceof Error ? error.message : "unknown" }));
  }
  const parsed = proposalFormSchema.safeParse(json);
  if (parsed.success) {
    return ok(parsed.data);
  }
  return err(
    ProposalErrors.formInvalid({
      reasons: parsed.error.issues.flatMap((issue) =>
        issue.message.split("\n").map((line) => `${issue.path.join(".")}: ${line}`),
      ),
    }),
  );
}
