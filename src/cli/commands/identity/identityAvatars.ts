/**
 * `slopweaver identity avatars` — print every member's profile picture, keyed by the platform's own id.
 *
 * The work console's pull-request rows draw an author's picture beside the login,
 * and the picture was on disk in member bronze with no verb printing it. Like `org-domains`, this verb
 * imports {@link ./identityShared} and nothing else in the family: it prints a URL per member, never a
 * resolved person, so it has no business near the emitters.
 */

import { avatarRoster } from "../../../corpus/members/avatars.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { IDENTITY_SOURCES, type IdentitySource } from "../../../silver/identity.js";
import { EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { parseFlags } from "../../parseFlags.js";
import { homeFor, type IdentityDeps, strFlag, verbTail } from "./identityShared.js";

/** Hand-copied into `src/cli/manifests/identity.ts`; `manifestUsagePairs.test.ts` keeps the two equal. */
export const IDENTITY_AVATARS_USAGE =
  "usage: slopweaver identity avatars [--source github|slack|linear|notion] [--ids <id,id>] [--home <dir>] [--json]";

/** The flag spec `identity avatars` parses. */
const AVATARS_FLAGS = { boolean: ["json"], string: ["home", "ids", "source"] } as const;

/** A platform id as a roster prints one: letters, digits, dot, underscore, hyphen, never a leading hyphen. */
const ID_SHAPE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** `--`-prefixed, so the help-truth ratchet can compare the usage string against the parser both ways. */
export const IDENTITY_AVATARS_FLAG_NAMES: readonly string[] = [...AVATARS_FLAGS.string, ...AVATARS_FLAGS.boolean]
  .map((name) => `--${name}`)
  .toSorted();

/**
 * Parse `identity avatars` flags. Exported so the help-truth ratchet probes the REAL parser rather than a
 * copy of it that could drift.
 *
 * @param rest the argv after the noun and verb
 * @returns the parsed flags
 */
export function parseIdentityAvatarsArgs({ rest }: { rest: readonly string[] }): ReturnType<typeof parseFlags> {
  return parseFlags({ allowPositionals: false, args: rest, spec: AVATARS_FLAGS });
}

/**
 * The two narrowing flags, `--source` and `--ids`, resolved into what `avatarRoster` takes — each present
 * only when named, so an absent flag stays absent rather than becoming `undefined`.
 *
 * @returns the narrowing, or the one usage sentence to print
 */
function narrowingOf({
  values,
}: {
  values: Readonly<Record<string, string | boolean>>;
}): Result<{ readonly source?: IdentitySource; readonly ids?: ReadonlySet<string> }, string> {
  const named = strFlag({ key: "source", values });
  let source: IdentitySource | undefined;
  if (named !== undefined) {
    source = sourceOf({ value: named });
    if (source === undefined) {
      return err(`--source ${named} is not one of ${IDENTITY_SOURCES.join(", ")}`);
    }
  }
  const namedIds = strFlag({ key: "ids", values });
  let ids: ReadonlySet<string> | undefined;
  if (namedIds !== undefined) {
    const list = namedIds.split(",").map((id) => id.trim());
    const bad = list.find((id) => !ID_SHAPE.test(id));
    if (bad !== undefined) {
      return err(`--ids carries "${bad}", which is not a platform id (letters, digits, dot, underscore, hyphen)`);
    }
    ids = new Set(list);
  }
  return ok({ ...(source !== undefined ? { source } : {}), ...(ids !== undefined ? { ids } : {}) });
}

/**
 * Narrow a `--source` value to a source this install hydrates.
 *
 * @returns the source, or `undefined` for a word that is not one
 */
function sourceOf({ value }: { value: string }): IdentitySource | undefined {
  return IDENTITY_SOURCES.find((source) => source === value);
}

/**
 * Run `identity avatars` — one line, or one JSON entry, per member with a picture.
 *
 * @param argv the full process argv
 * @param deps the effectful seams
 * @returns the process exit code — `EXIT_EXPECTED_EMPTY` when no member carries a picture
 */
export function runIdentityAvatarsWithDeps({ argv, deps }: { argv: readonly string[]; deps: IdentityDeps }): number {
  const rest = verbTail({ argv, verb: "avatars" });
  if (rest.includes("--help") || rest.includes("-h")) {
    deps.logger.out({ line: IDENTITY_AVATARS_USAGE });
    return EXIT_OK;
  }
  const parsed = parseIdentityAvatarsArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((e) => {
      deps.logger.error({ msg: e });
    });
    deps.logger.error({ msg: IDENTITY_AVATARS_USAGE });
    return EXIT_USAGE;
  }
  const narrowed = narrowingOf({ values: parsed.value.values });
  if (narrowed.isErr()) {
    deps.logger.error({ msg: narrowed.error });
    deps.logger.error({ msg: IDENTITY_AVATARS_USAGE });
    return EXIT_USAGE;
  }
  const home = homeFor({ deps, values: parsed.value.values });
  const members = deps.loadMembers({ home });
  const people = avatarRoster({ rows: members.rows, ...narrowed.value });
  if (parsed.value.values["json"] === true) {
    deps.logger.out({ line: JSON.stringify({ people, warnings: members.warnings }, null, 2) });
  } else {
    members.warnings.forEach((w) => {
      deps.logger.warn({ msg: w });
    });
    people.forEach((person) => {
      deps.logger.out({ line: `${person.source} ${person.nativeId} ${person.avatarUrl}` });
    });
  }
  return people.length > 0 ? EXIT_OK : EXIT_EXPECTED_EMPTY;
}
