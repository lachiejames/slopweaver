/** Pure parser and door request for `slopweaver github ready`. */

import type { DoorRequest } from "../../../admit/types.js";
import { err, ok, type Result } from "../../../lib/result.js";
import type { FlagSpec } from "../../parseFlags.js";
import { booleanFlagsOf, parseFlags, stringFlagsOf } from "../../parseFlags.js";
import { parseRepoSlug } from "./core.js";

const GITHUB_READY_FLAGS: FlagSpec = {
  boolean: ["dry-run", "json", "undo"],
  string: ["repo", "number", "home"],
};

/** Every accepted flag for the help-truth ratchet. */
export const GITHUB_READY_FLAG_NAMES: readonly string[] = [
  ...stringFlagsOf({ spec: GITHUB_READY_FLAGS }),
  ...booleanFlagsOf({ spec: GITHUB_READY_FLAGS }),
].map((name) => `--${name}`);

/** The resolved ready transition. */
export interface GithubReadyArgs {
  readonly owner: string;
  readonly repo: string;
  readonly number: number;
  /** Run the transition backwards: open pull request to draft. */
  readonly undo: boolean;
  readonly dryRun: boolean;
  readonly json: boolean;
  readonly home: string | undefined;
}

/**
 * Parse the ready transition before resolving a credential.
 *
 * @param rest argv after `github ready`
 * @returns the resolved address and modes, or every usage problem
 */
export function parseGithubReadyArgs({ rest }: { rest: readonly string[] }): Result<GithubReadyArgs> {
  const parsed = parseFlags({ allowPositionals: false, args: rest, spec: GITHUB_READY_FLAGS });
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
  if (errors.length > 0 || repo === undefined) {
    return err(errors);
  }
  const home = parsed.value.values["home"];
  return ok({
    dryRun: parsed.value.values["dry-run"] === true,
    home: typeof home === "string" ? home : undefined,
    json: parsed.value.values["json"] === true,
    number,
    owner: repo.owner,
    repo: repo.repo,
    undo: parsed.value.values["undo"] === true,
  });
}

/**
 * The external-write door request for one exact pull-request number.
 *
 * @param args the parsed repository and pull-request identity
 * @param home the Slopweaver state home whose door records the transition
 * @returns the exact external-write request admitted by the door
 */
export function readyDoorRequest({ args, home }: { args: GithubReadyArgs; home: string }): DoorRequest {
  return {
    action: { kind: "verb", noun: "github", verb: args.undo ? "ready --undo" : "ready" },
    artifact: { id: `${args.owner}/${args.repo}#${String(args.number)}` },
    meta: { createsWorkItem: false, effect: "external-write", home, requiresApproval: false },
  };
}
