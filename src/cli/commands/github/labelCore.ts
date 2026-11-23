/** Pure parser and door request for `slopweaver github label`. */

import type { DoorRequest } from "../../../admit/types.js";
import { err, ok, type Result } from "../../../lib/result.js";
import type { FlagSpec } from "../../parseFlags.js";
import { booleanFlagsOf, parseFlags, stringFlagsOf } from "../../parseFlags.js";
import { parseRepoSlug } from "./core.js";

const GITHUB_LABEL_FLAGS: FlagSpec = {
  boolean: ["dry-run", "json"],
  string: ["repo", "number", "add", "home"],
};

/** Every accepted flag for the help-truth ratchet. */
export const GITHUB_LABEL_FLAG_NAMES: readonly string[] = [
  ...stringFlagsOf({ spec: GITHUB_LABEL_FLAGS }),
  ...booleanFlagsOf({ spec: GITHUB_LABEL_FLAGS }),
].map((name) => `--${name}`);

/** The resolved label addition. */
export interface GithubLabelArgs {
  readonly owner: string;
  readonly repo: string;
  readonly number: number;
  readonly add: readonly string[];
  readonly dryRun: boolean;
  readonly json: boolean;
  readonly home: string | undefined;
}

/** Split `--add` on commas, dropping the empty fragments a trailing or doubled comma leaves behind. */
function labelsOf({ value }: { value: string }): readonly string[] {
  return value
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
}

/**
 * Parse the label addition before resolving a credential.
 *
 * @param rest argv after `github label`
 * @returns the resolved address and labels, or every usage problem
 */
export function parseGithubLabelArgs({ rest }: { rest: readonly string[] }): Result<GithubLabelArgs> {
  const parsed = parseFlags({ allowPositionals: false, args: rest, spec: GITHUB_LABEL_FLAGS });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const errors: string[] = [];
  const repoValue = parsed.value.values["repo"];
  const repo = typeof repoValue === "string" ? parseRepoSlug({ slug: repoValue }) : undefined;
  if (repo === undefined) {
    errors.push("--repo owner/name is required");
  }
  const numberValue = parsed.value.values["number"];
  const number = typeof numberValue === "string" ? Number(numberValue) : Number.NaN;
  if (!Number.isInteger(number) || number <= 0) {
    errors.push("--number must be a positive whole number");
  }
  const addValue = parsed.value.values["add"];
  const add = typeof addValue === "string" ? labelsOf({ value: addValue }) : [];
  if (add.length === 0) {
    errors.push("--add needs at least one label name");
  }
  if (errors.length > 0 || repo === undefined) {
    return err(errors);
  }
  const home = parsed.value.values["home"];
  return ok({
    add,
    dryRun: parsed.value.values["dry-run"] === true,
    home: typeof home === "string" ? home : undefined,
    json: parsed.value.values["json"] === true,
    number,
    owner: repo.owner,
    repo: repo.repo,
  });
}

/**
 * The external-write door request for one exact issue or pull-request number.
 *
 * @param args the parsed repository, number and labels
 * @param home the Slopweaver state home whose door records the write
 * @returns the exact external-write request admitted by the door
 */
export function labelDoorRequest({ args, home }: { args: GithubLabelArgs; home: string }): DoorRequest {
  return {
    action: { kind: "verb", noun: "github", verb: "label" },
    artifact: { id: `${args.owner}/${args.repo}#${String(args.number)}` },
    meta: { createsWorkItem: false, effect: "external-write", home, requiresApproval: false },
  };
}
