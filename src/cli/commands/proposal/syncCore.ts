/** Argument parsing for `proposal sync`. The effectful shell lives in `./syncRun.ts`. */
import { err, ok, type Result } from "../../../lib/result.js";
import { booleanFlagsOf, type FlagSpec, parseFlags, stringFlagsOf } from "../../parseFlags.js";
import { type ProposalError, ProposalErrors } from "./errors.js";

/** The cap `notion read`'s own `--limit` uses; reused here so a Notion page-size request never exceeds the API's own maximum. */
const MAX_SYNC_LIMIT = 100;

/** The default when `--limit` is omitted — as wide as a single bounded request can go. */
const DEFAULT_SYNC_LIMIT = 100;

/** A parsed `proposal sync` invocation. */
export interface ProposalSyncArgs {
  readonly sources: readonly string[];
  readonly limit: number;
  readonly json: boolean;
  readonly home: string | undefined;
}

const SYNC_FLAGS: FlagSpec = { boolean: ["json"], string: ["source", "limit", "home"] };

/** Every `proposal sync` flag, WITH the `--`, for the help-truth ratchet. */
export const PROPOSAL_SYNC_FLAG_NAMES: readonly string[] = [
  ...stringFlagsOf({ spec: SYNC_FLAGS }).map((name) => `--${name}`),
  ...booleanFlagsOf({ spec: SYNC_FLAGS }).map((name) => `--${name}`),
];

/**
 * Parse `proposal sync --source <id-or-url>[,<id-or-url>,...] [--limit <1..100>]`.
 *
 * @param rest the verb's arguments
 * @returns the parsed arguments, or the operator-facing errors
 */
export function parseProposalSyncArgs({ rest }: { rest: readonly string[] }): Result<ProposalSyncArgs, ProposalError> {
  const parsed = parseFlags({ args: rest, spec: SYNC_FLAGS });
  if (parsed.isErr()) {
    return err(ProposalErrors.flagsInvalid({ reasons: parsed.error }));
  }
  const { values } = parsed.value;
  const sourceFlag = values["source"];
  if (typeof sourceFlag !== "string") {
    return err(ProposalErrors.syncSourceRequired());
  }
  const sources = sourceFlag
    .split(",")
    .map((source) => source.trim())
    .filter((source) => source.length > 0);
  if (sources.length === 0) {
    return err(ProposalErrors.syncSourceEmpty());
  }
  const limitFlag = values["limit"];
  const limit = typeof limitFlag === "string" ? Number(limitFlag) : DEFAULT_SYNC_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_SYNC_LIMIT) {
    return err(ProposalErrors.syncLimitInvalid({ max: MAX_SYNC_LIMIT }));
  }
  const home = typeof values["home"] === "string" ? values["home"] : undefined;
  return ok({ home, json: values["json"] === true, limit, sources });
}
