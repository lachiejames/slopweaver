/**
 * What a `profile voice` invocation asks for: a read of the register, an import from a file, or a measurement from
 * their sent Slack. Pure, so every shape is decidable in a unit test.
 */
import { err, ok, type Result } from "../../../lib/result.js";
import { type FlagSpec, parseFlags } from "../../parseFlags.js";

import { parseProfileWriteArgs } from "./core.js";

/** The flags a read or an import takes. */
const READ_FLAGS: FlagSpec = { boolean: ["json"], string: ["file"] };

/** The flags `profile voice measure` takes. */
const MEASURE_FLAGS: FlagSpec = { boolean: ["dry-run", "json"], string: ["home"] };

/** Every flag `profile voice` advertises across its three shapes, as a usage line names them. */
export const PROFILE_VOICE_FLAG_NAMES: readonly string[] = ["--dry-run", "--file", "--home", "--json"];

/** A parsed `profile voice` invocation. */
export type ProfileVoiceArgs =
  | { readonly kind: "read"; readonly json: boolean }
  | { readonly kind: "import"; readonly file: string; readonly json: boolean }
  | {
      readonly kind: "measure";
      readonly dryRun: boolean;
      readonly json: boolean;
      /** The home named by `--home`, absent when the environment's is meant. */
      readonly home: string | undefined;
    };

/** One string flag's value, or `undefined` when it was not given. */
function stringValue({
  values,
  name,
}: {
  values: Readonly<Record<string, unknown>>;
  name: string;
}): string | undefined {
  const value = values[name];
  if (typeof value !== "string") {
    return undefined;
  }
  return value;
}

/** Parse `profile voice measure`'s own tail. */
function parseMeasure({ rest }: { rest: readonly string[] }): Result<ProfileVoiceArgs> {
  const parsed = parseFlags({ args: rest, spec: MEASURE_FLAGS });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  return ok({
    dryRun: parsed.value.values["dry-run"] === true,
    home: stringValue({ name: "home", values: parsed.value.values }),
    json: parsed.value.values["json"] === true,
    kind: "measure",
  });
}

/**
 * Parse a `profile voice` tail into the one shape it asks for.
 *
 * @param rest everything after `slopweaver profile voice`
 * @returns the invocation, or every reason it was refused
 */
export function parseProfileVoiceArgs({ rest }: { rest: readonly string[] }): Result<ProfileVoiceArgs> {
  const [first, ...after] = rest;
  if (first === "measure") {
    return parseMeasure({ rest: after });
  }
  const parsed = parseFlags({ args: rest, spec: READ_FLAGS });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  if (stringValue({ name: "file", values: parsed.value.values }) === undefined) {
    return ok({ json: parsed.value.values["json"] === true, kind: "read" });
  }
  // The import is `profile set`'s file write, so it refuses exactly as that does.
  const write = parseProfileWriteArgs({ rest });
  if (write.isErr()) {
    return err(write.error);
  }
  return ok({ file: write.value.file, json: write.value.json, kind: "import" });
}
