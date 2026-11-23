/**
 * Argument parsing for the proposal register's read and diagnostic verbs: `list`, `show` and `drift`.
 * The effectful shells live in `./registerRunRead.ts` and `./driftRun.ts`; the shared parsing helpers in
 * `./registerCore.ts`.
 */
import { err, ok } from "../../../lib/result.js";
import { isRegisterStatus, type RegisterStatus } from "../../../outbound/proposal/register/events.js";
import { type FlagSpec, parseFlags } from "../../parseFlags.js";
import { ProposalErrors } from "./errors.js";
import { flagNames, type Parsed, requireSlug, text } from "./registerCore.js";

/** A parsed `proposal list` invocation. */
export interface ProposalListArgs {
  readonly status: RegisterStatus | undefined;
  readonly json: boolean;
  readonly home: string | undefined;
}

/** A parsed `proposal show` invocation. */
export interface ProposalShowArgs {
  readonly slug: string;
  readonly history: boolean;
  readonly json: boolean;
  readonly home: string | undefined;
}

/** A parsed `proposal drift` invocation. */
export interface ProposalDriftArgs {
  readonly slug: string | undefined;
  readonly json: boolean;
  readonly home: string | undefined;
}

const LIST_FLAGS: FlagSpec = { boolean: ["json"], string: ["status", "home"] };
const SHOW_FLAGS: FlagSpec = { boolean: ["json", "history"], string: ["home"] };
const DRIFT_FLAGS: FlagSpec = { boolean: ["json"], string: ["slug", "home"] };

/** Every `proposal list` flag, WITH the `--`, for the help-truth ratchet. */
export const PROPOSAL_LIST_FLAG_NAMES: readonly string[] = flagNames({ spec: LIST_FLAGS });
/** Every `proposal show` flag, WITH the `--`, for the help-truth ratchet. */
export const PROPOSAL_SHOW_FLAG_NAMES: readonly string[] = flagNames({ spec: SHOW_FLAGS });
/** Every `proposal drift` flag, WITH the `--`, for the help-truth ratchet. */
export const PROPOSAL_DRIFT_FLAG_NAMES: readonly string[] = flagNames({ spec: DRIFT_FLAGS });

/**
 * Parse `proposal list [--status <s>]`.
 *
 * @param rest the verb's arguments
 * @returns the parsed arguments, or the operator-facing errors
 */
export function parseProposalListArgs({ rest }: { rest: readonly string[] }): Parsed<ProposalListArgs> {
  const parsed = parseFlags({ args: rest, spec: LIST_FLAGS });
  if (parsed.isErr()) {
    return err(ProposalErrors.flagsInvalid({ reasons: parsed.error }));
  }
  const { values } = parsed.value;
  const status = text({ name: "status", values });
  // An unknown status is REFUSED rather than filtered on. A silent empty list reads exactly like "nothing is
  // at that status", so a typo would answer a real question with a wrong answer.
  if (status !== undefined && !isRegisterStatus(status)) {
    return err(ProposalErrors.registerStatusUnknown({ status }));
  }
  return ok({ home: text({ name: "home", values }), json: values["json"] === true, status });
}

/**
 * Parse `proposal show <slug>`.
 *
 * @param rest the verb's arguments
 * @returns the parsed arguments, or the operator-facing errors
 */
export function parseProposalShowArgs({ rest }: { rest: readonly string[] }): Parsed<ProposalShowArgs> {
  const head = requireSlug({
    rest,
    usage: "usage: slopweaver proposal show <slug> [--history] [--json] [--home <dir>]",
  });
  if ("error" in head) {
    return err(head.error);
  }
  const parsed = parseFlags({ args: head.flags, spec: SHOW_FLAGS });
  if (parsed.isErr()) {
    return err(ProposalErrors.flagsInvalid({ reasons: parsed.error }));
  }
  const { values } = parsed.value;
  return ok({
    history: values["history"] === true,
    home: text({ name: "home", values }),
    json: values["json"] === true,
    slug: head.slug,
  });
}

/**
 * Parse `proposal drift [--slug <s>]`.
 *
 * @param rest the verb's arguments
 * @returns the parsed arguments, or the operator-facing errors
 */
export function parseProposalDriftArgs({ rest }: { rest: readonly string[] }): Parsed<ProposalDriftArgs> {
  const parsed = parseFlags({ args: rest, spec: DRIFT_FLAGS });
  if (parsed.isErr()) {
    return err(ProposalErrors.flagsInvalid({ reasons: parsed.error }));
  }
  const { values } = parsed.value;
  return ok({
    home: text({ name: "home", values }),
    json: values["json"] === true,
    slug: text({ name: "slug", values }),
  });
}
