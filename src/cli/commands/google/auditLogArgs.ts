/**
 * `google audit-log`'s flags and its I/O-free parser — the half the help-truth ratchet probes, apart from the
 * verb's network and store flow in `./auditLog.ts`.
 */
import { err, ok, type Result } from "#lib/result.js";

import { type FlagSpec, parseFlags, repeatedFlagValues } from "../../parseFlags.js";

/** `google audit-log`'s own flags. */
const STRING_FLAGS: readonly string[] = [
  "org",
  "quota-project",
  "since",
  "principal",
  "role",
  "generation",
  "plan",
  "home",
];
const BOOLEAN_FLAGS: readonly string[] = ["all-principals", "json"];
const FLAGS: FlagSpec = { boolean: BOOLEAN_FLAGS, repeatable: ["principal", "role"], string: STRING_FLAGS };

/** `--`-prefixed, for the help-truth ratchet. */
export const GOOGLE_AUDIT_LOG_FLAG_NAMES: readonly string[] = [...BOOLEAN_FLAGS, ...STRING_FLAGS]
  .map((name) => `--${name}`)
  .toSorted();

/** A parsed `pull`. */
export interface GoogleAuditLogPullArgs {
  readonly action: "pull";
  readonly org: string;
  readonly quotaProject: string;
  readonly since: string;
  readonly principals: readonly string[] | "all";
  readonly roles: readonly string[];
  readonly home: string | undefined;
}

/** A parsed `summary`. */
export interface GoogleAuditLogSummaryArgs {
  readonly action: "summary";
  readonly generation: string | undefined;
  readonly plan: string | undefined;
  readonly json: boolean;
  readonly home: string | undefined;
}

/** A parsed invocation. */
export type GoogleAuditLogArgs = GoogleAuditLogPullArgs | GoogleAuditLogSummaryArgs;

/** The flags each action accepts; another action's flag is a caller mistake, refused by name. */
const ACTION_FLAGS: Readonly<Record<"pull" | "summary", ReadonlySet<string>>> = {
  pull: new Set(["org", "quota-project", "since", "principal", "role", "all-principals", "home"]),
  summary: new Set(["generation", "plan", "json", "home"]),
};

/** The parsed flag values, as `parseFlags` answers them. */
type FlagValues = Readonly<Record<string, string | boolean>>;

/**
 * A string flag's value, absent when the flag was not passed.
 *
 * @param values every parsed flag
 * @param name the flag, without its dashes
 * @returns the value, or undefined
 */
function stringFlag({ values, name }: { values: FlagValues; name: string }): string | undefined {
  const value = values[name];
  return typeof value === "string" ? value : undefined;
}

/**
 * Parse a `pull`'s flags, naming every missing or malformed one at once.
 *
 * @param values every parsed flag
 * @param tail the argv after the action, read again for the repeatable flags
 * @returns the pull, or every problem found
 */
function parsePull({ values, tail }: { values: FlagValues; tail: readonly string[] }): Result<GoogleAuditLogPullArgs> {
  const problems: string[] = [];
  const org = stringFlag({ name: "org", values });
  const quotaProject = stringFlag({ name: "quota-project", values });
  const since = stringFlag({ name: "since", values });
  if (org === undefined || !/^\d{1,20}$/.test(org)) {
    problems.push("--org must be the organisation's number");
  }
  if (quotaProject === undefined) {
    problems.push("--quota-project is required: the project every call's quota and billing land on");
  }
  if (since === undefined) {
    problems.push("--since is required, an RFC 3339 UTC instant like 2025-08-29T00:00:00Z");
  }
  const named = repeatedFlagValues({ name: "principal", rest: tail });
  const all = values["all-principals"] === true;
  if (all === named.length > 0) {
    problems.push("pass --principal <email> (repeatable) or --all-principals, exactly one of the two");
  }
  if (problems.length > 0 || org === undefined || quotaProject === undefined || since === undefined) {
    return err(problems);
  }
  return ok({
    action: "pull",
    home: stringFlag({ name: "home", values }),
    org,
    principals: all ? "all" : named,
    quotaProject,
    roles: repeatedFlagValues({ name: "role", rest: tail }),
    since,
  });
}

/**
 * Parse one `google audit-log` invocation. I/O-free; exported so the help-truth ratchet probes the REAL parser.
 *
 * @param rest the argv tail after `google audit-log`
 * @returns the invocation, or every problem found
 */
export function parseGoogleAuditLogArgs({ rest }: { rest: readonly string[] }): Result<GoogleAuditLogArgs> {
  const [action, ...tail] = rest;
  if (action !== "pull" && action !== "summary") {
    return err([`name an action: pull or summary${action === undefined ? "" : `, not ${action}`}`]);
  }
  const parsed = parseFlags({ args: tail, spec: FLAGS });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { values } = parsed.value;
  const foreign = Object.keys(values).filter((name) => !ACTION_FLAGS[action].has(name));
  if (foreign.length > 0) {
    return err(foreign.map((name) => `--${name} is not a ${action} flag`));
  }
  if (action === "pull") {
    return parsePull({ tail, values });
  }
  return ok({
    action,
    generation: stringFlag({ name: "generation", values }),
    home: stringFlag({ name: "home", values }),
    json: values["json"] === true,
    plan: stringFlag({ name: "plan", values }),
  });
}
