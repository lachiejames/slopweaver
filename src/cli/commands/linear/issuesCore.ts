/** Pure argument handling for `slopweaver linear issues`. */

import { err, ok, type Result } from "../../../lib/result.js";
import type { LinearIssuesCreator, LinearIssuesSelection } from "../../../live/linear/issues.js";
import { booleanFlagsOf, type FlagSpec, parseFlags, stringFlagsOf } from "../../parseFlags.js";
import { type LinearVerbError, LinearVerbErrors } from "./errors.js";
import { parseUpdatedSince } from "./queryCore.js";

const ISSUES_FLAGS: FlagSpec = {
  boolean: ["json"],
  string: ["created-since", "creator", "home", "project", "team"],
};

/** Every accepted flag, WITH the `--`, derived from the exact spec passed to the parser. */
export const LINEAR_ISSUES_FLAG_NAMES: readonly string[] = [
  ...stringFlagsOf({ spec: ISSUES_FLAGS }),
  ...booleanFlagsOf({ spec: ISSUES_FLAGS }),
].map((name) => `--${name}`);

/** A parsed, credential-free `linear issues` invocation. */
export interface LinearIssuesOptions {
  readonly selection: LinearIssuesSelection;
  readonly home: string | undefined;
  readonly json: boolean;
}

/** A string flag's value, or undefined when it was not given. Pure. */
function stringValue({ values, key }: { values: Readonly<Record<string, unknown>>; key: string }): string | undefined {
  const value = values[key];
  if (typeof value === "string") {
    return value;
  }
  return undefined;
}

/** `--creator`, which accepts `me` alone: any other person is a roster question this verb does not answer. */
function parseCreator({ value }: { value: string | undefined }): Result<LinearIssuesCreator, string> {
  if (value === undefined) {
    return ok("any");
  }
  if (value === "me") {
    return ok("me");
  }
  return err(`--creator accepts only \`me\`, got "${value}"`);
}

/**
 * Parse one `linear issues` invocation before any credential or network is touched.
 *
 * @param rest the argv tail after `linear issues`
 * @param nowMs the clock a relative `--created-since` window is measured back from
 * @returns the resolved options, or every usage problem found
 */
export function parseLinearIssuesArgs({
  rest,
  nowMs,
}: {
  rest: readonly string[];
  nowMs: number;
}): Result<LinearIssuesOptions, LinearVerbError> {
  const parsed = parseFlags({ args: rest, spec: ISSUES_FLAGS });
  if (parsed.isErr()) {
    return err(LinearVerbErrors.flagsRefused({ reasons: parsed.error }));
  }
  const { values } = parsed.value;
  const problems: string[] = [];
  const teamKey = stringValue({ key: "team", values });
  const project = stringValue({ key: "project", values });
  if (teamKey === undefined && project === undefined) {
    problems.push("name --team <team-key>, --project <uuid|url>, or both; a whole-workspace list is not offered");
  }
  const creator = parseCreator({ value: stringValue({ key: "creator", values }) });
  if (creator.isErr()) {
    problems.push(creator.error);
  }
  const sinceRaw = stringValue({ key: "created-since", values });
  let createdSinceIso: string | undefined;
  if (sinceRaw !== undefined) {
    const since = parseUpdatedSince({ nowMs, value: sinceRaw });
    if (since.isErr()) {
      problems.push(`--created-since takes an ISO date such as 2026-09-01 or a window such as 14d, got "${sinceRaw}"`);
    } else {
      createdSinceIso = since.value;
    }
  }
  if (problems.length > 0 || creator.isErr()) {
    return err(LinearVerbErrors.argumentsRefused({ reasons: problems }));
  }
  return ok({
    home: stringValue({ key: "home", values }),
    json: values["json"] === true,
    selection: {
      createdSinceIso,
      creator: creator.value,
      project,
      teamKey,
    },
  });
}
