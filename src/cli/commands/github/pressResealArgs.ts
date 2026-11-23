/**
 * `slopweaver github press-reseal`'s argv, parsed purely. A preview needs only `--repo`; an apply needs the
 * preview's digest and a reason as well, and the apply-only flags are refused on a preview by name, so an
 * invocation that meant to apply is never silently downgraded to a preview.
 */
import { err, ok, type Result } from "#lib/result.js";

import type { FlagSpec } from "../../parseFlags.js";
import { booleanFlagsOf, parseFlags, repeatedFlagValues, stringFlagsOf } from "../../parseFlags.js";
import { parseRepoSlug } from "./core.js";

/**
 * The flags `github press-reseal` accepts.
 *
 * @internal
 */
export const GITHUB_PRESS_RESEAL_FLAGS: FlagSpec = {
  boolean: ["apply", "json"],
  repeatable: ["repo"],
  string: ["repo", "source-sha256", "reason", "home"],
};

/** Every flag `github press-reseal` advertises, WITH the `--`, for the help-truth ratchet. */
export const GITHUB_PRESS_RESEAL_FLAG_NAMES: readonly string[] = [
  ...stringFlagsOf({ spec: GITHUB_PRESS_RESEAL_FLAGS }),
  ...booleanFlagsOf({ spec: GITHUB_PRESS_RESEAL_FLAGS }),
].map((name) => `--${name}`);

/** One `github press-reseal` invocation: a preview, or an apply carrying what the preview printed. */
export type GithubPressResealArgs =
  | {
      readonly mode: "preview";
      readonly repos: readonly string[];
      readonly asJson: boolean;
      readonly home: string | undefined;
    }
  | {
      readonly mode: "apply";
      readonly repos: readonly string[];
      readonly sourceSha256: string;
      readonly reason: string;
      readonly asJson: boolean;
      readonly home: string | undefined;
    };

/** A lower-case hex sha-256, the only spelling the preview prints. */
const SHA256_HEX = /^[0-9a-f]{64}$/u;

/** One declared string flag, or `undefined`. */
function stringFlag({
  values,
  name,
}: {
  values: Readonly<Record<string, string | boolean>>;
  name: string;
}): string | undefined {
  const value = values[name];
  return typeof value === "string" ? value : undefined;
}

/**
 * Every `--repo`, each validated as `owner/name`, deduplicated in first-seen order.
 *
 * @param rest the verb's own argv tail
 * @param errors where a refusal is accumulated
 * @returns the slugs
 */
function reposFrom({ rest, errors }: { rest: readonly string[]; errors: string[] }): readonly string[] {
  const raw = repeatedFlagValues({ name: "repo", rest });
  if (raw.length === 0) {
    errors.push("--repo owner/name is required: name every repository whose rows may be re-keyed");
    return [];
  }
  const repos: string[] = [];
  for (const each of raw) {
    const slug = parseRepoSlug({ slug: each });
    if (slug === undefined) {
      errors.push(`--repo must be owner/name; "${each}" is not`);
    } else if (!repos.includes(`${slug.owner}/${slug.repo}`)) {
      repos.push(`${slug.owner}/${slug.repo}`);
    }
  }
  return repos;
}

/**
 * Parse a `github press-reseal` invocation.
 *
 * @param rest argv after `github press-reseal`
 * @returns the parsed invocation, or every usage error at once
 */
export function parseGithubPressResealArgs({ rest }: { rest: readonly string[] }): Result<GithubPressResealArgs> {
  const parsed = parseFlags({ allowPositionals: false, args: rest, spec: GITHUB_PRESS_RESEAL_FLAGS });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { values } = parsed.value;
  const errors: string[] = [];
  const repos = reposFrom({ errors, rest });
  const asJson = values["json"] === true;
  const home = stringFlag({ name: "home", values });
  const sourceSha256 = stringFlag({ name: "source-sha256", values });
  const reason = stringFlag({ name: "reason", values });
  if (values["apply"] !== true) {
    for (const flag of ["source-sha256", "reason"]) {
      if (stringFlag({ name: flag, values }) !== undefined) {
        errors.push(`--${flag} belongs to --apply; without --apply this is a preview and writes nothing`);
      }
    }
    return errors.length > 0 ? err(errors) : ok({ asJson, home, mode: "preview", repos });
  }
  if (sourceSha256 === undefined || !SHA256_HEX.test(sourceSha256)) {
    errors.push("--apply needs --source-sha256 <hex>: the 64-character sourceSha256 the preview printed");
  }
  if (reason === undefined || reason.trim() === "") {
    errors.push('--apply needs --reason "<why>": it is recorded on the receipt');
  }
  if (errors.length > 0 || sourceSha256 === undefined || reason === undefined) {
    return err(errors);
  }
  return ok({ asJson, home, mode: "apply", reason, repos, sourceSha256 });
}
