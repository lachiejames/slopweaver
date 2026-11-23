/**
 * Pure argument handling for `slopweaver atlas read` — the flag spec, the usage line and the parser. Separated
 * from the shell so the flag surface is unit-testable without a home directory, and so `helpTruth` can prove
 * `--help` names exactly what the parser accepts. The `--json` document and the human report are
 * `./readCore.ts`'s; this leaf imports nothing from it.
 */

import { err, ok, type Result } from "../../../lib/result.js";
import type { FlagSpec } from "../../parseFlags.js";
import { booleanFlagsOf, parseFlags, stringFlagsOf } from "../../parseFlags.js";
import { atlasCommandErrorLines } from "./errors.js";
import { parseReadLimit } from "./integerFlag.js";

/** Every flag this verb accepts. The spec is local; {@link ATLAS_READ_FLAG_NAMES} is what leaves. */
const ATLAS_READ_FLAGS: FlagSpec = {
  boolean: ["json", "include-stale", "accept-unproven-empty"],
  string: ["kind", "surface", "id", "query", "after", "limit", "home"],
};

/** Every flag NAME, derived from the spec rather than re-listed, so the two cannot drift. */
export const ATLAS_READ_FLAG_NAMES: readonly string[] = [
  ...booleanFlagsOf({ spec: ATLAS_READ_FLAGS }),
  ...stringFlagsOf({ spec: ATLAS_READ_FLAGS }),
]
  .map((name) => `--${name}`)
  .toSorted();

/** The usage line, shared by `--help` and the manifest so the two cannot drift. */
export const ATLAS_READ_USAGE =
  "usage: slopweaver atlas <platform> read [--kind <kind[,kind]>] [--surface <name>]\n" +
  "                                       [--id <id>] [--query <words>] [--include-stale]\n" +
  "                                       [--after <entity-id>] [--limit <1..1000>] [--json] [--home <dir>]\n" +
  "  <platform>        the atlas to read — run `slopweaver atlas` to list them\n" +
  "  --kind            one or more kinds, comma-separated; an unknown kind is refused, not empty\n" +
  "  --surface         only entities some surface actually observed, e.g. rest-api, browser\n" +
  "  --id              an exact match on the atlas's own id or the provider's\n" +
  "  --query           case-insensitive words, all of which must appear; NOT a regex\n" +
  "  --include-stale   include entities no surface has seen recently\n" +
  "  --after           resume after this entity id; pass back the nextAfter of the previous page\n" +
  "  --accept-unproven-empty  answer an empty selection the evidence cannot prove was ever measured\n" +
  "  counts are of STORED records, never the provider's own population; an empty selection whose\n" +
  "  evidence cannot establish a measured zero is refused rather than answered (exit 3)\n" +
  "  reads only what a sync already stored; it makes no network call";

/** The resolved invocation.
 * @internal
 */
export interface AtlasReadOptions {
  readonly kinds: readonly string[];
  readonly surface: string | undefined;
  readonly id: string | undefined;
  readonly query: string | undefined;
  readonly includeStale: boolean;
  readonly after: string | undefined;
  readonly limit: number | undefined;
  readonly json: boolean;
  readonly home: string | undefined;
  /** The named escape hatch: answer an unprovable empty selection anyway, with the refusal attached. */
  readonly acceptUnprovenEmpty: boolean;
}

/**
 * Parse the verb's arguments.
 *
 * @param rest the argv tail after `atlas <platform> read`
 * @returns the resolved options, or `err` with every usage problem found
 */
export function parseAtlasReadArgs({ rest }: { rest: readonly string[] }): Result<AtlasReadOptions> {
  const parsed = parseFlags({ args: rest, spec: ATLAS_READ_FLAGS });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { values } = parsed.value;
  const stringOf = ({ name }: { name: string }): string | undefined =>
    typeof values[name] === "string" ? values[name] : undefined;

  const errors: string[] = [];
  let limit: number | undefined;
  const rawLimit = stringOf({ name: "limit" });
  if (rawLimit !== undefined) {
    const parsedLimit = parseReadLimit({ raw: rawLimit });
    if (parsedLimit.isErr()) {
      errors.push(...atlasCommandErrorLines({ error: parsedLimit.error }));
    } else {
      limit = parsedLimit.value;
    }
  }
  const rawKinds = stringOf({ name: "kind" });
  const kinds =
    rawKinds === undefined
      ? []
      : rawKinds
          .split(",")
          .map((kind) => kind.trim())
          .filter((kind) => kind.length > 0);

  if (errors.length > 0) {
    return err(errors);
  }
  return ok({
    acceptUnprovenEmpty: values["accept-unproven-empty"] === true,
    after: stringOf({ name: "after" }),
    home: stringOf({ name: "home" }),
    id: stringOf({ name: "id" }),
    includeStale: values["include-stale"] === true,
    json: values["json"] === true,
    kinds,
    limit,
    query: stringOf({ name: "query" }),
    surface: stringOf({ name: "surface" }),
  });
}
