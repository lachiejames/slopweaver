/**
 * `machine free-disk`'s argv parser and flag list. Pure but for the one injected read of the owner's bundle
 * ruling, made only for the `app` target, so every invalid invocation is refused before a single path is read,
 * and the help-truth ratchet reads the flag list without importing the command.
 */
import { err, ok, type Result } from "../../../lib/result.js";
import type { BundleRuling } from "../../../live/machine/freeDisk/bundleRuling.js";
import type { FreeDiskError } from "../../../live/machine/freeDisk/errors.js";
import type { FreeDiskTarget } from "../../../live/machine/freeDisk/registry.js";
import { resolveBundle, resolveTargetName } from "../../../live/machine/freeDisk/registry.js";
import { type FlagSpec, parseFlags } from "../../parseFlags.js";

/** argv positions before the verb's own arguments: `node`, `index.js`, `machine`, `free-disk`. */
export const VERB_ARG_OFFSET = 4;

const FREE_DISK_STRINGS = ["bundle"] as const;
const FREE_DISK_BOOLEANS = ["apply", "json"] as const;
const FREE_DISK_FLAGS: FlagSpec = { boolean: FREE_DISK_BOOLEANS, string: FREE_DISK_STRINGS };

/** `--`-prefixed `free-disk` flags, sorted, for the help-truth ratchet. */
export const MACHINE_FREE_DISK_FLAG_NAMES: readonly string[] = [...FREE_DISK_STRINGS, ...FREE_DISK_BOOLEANS]
  .map((name) => `--${name}`)
  .toSorted();

/** A parsed `free-disk` invocation. */
export interface FreeDiskArgs {
  readonly target: FreeDiskTarget;
  readonly apply: boolean;
  readonly json: boolean;
}

/**
 * Parse `machine free-disk`'s argv: exactly one target, `--bundle` with `app` and only with it.
 *
 * @param rest the argv after the verb
 * @param readRuling reads the state home's bundle ruling, called only for the `app` target
 * @returns the invocation, or every refusal as a message
 */
export function parseMachineFreeDiskArgs({
  rest,
  readRuling,
}: {
  rest: readonly string[];
  readRuling: () => Result<BundleRuling, FreeDiskError>;
}): Result<FreeDiskArgs> {
  const parsed = parseFlags({ allowPositionals: true, args: rest, spec: FREE_DISK_FLAGS });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { positionals, values } = parsed.value;
  if (positionals.length !== 1) {
    return err([`name exactly one target, got ${String(positionals.length)}`]);
  }
  const name = resolveTargetName({ named: positionals[0]! });
  if (name.isErr()) {
    return err([name.error.message]);
  }
  const bundleFlag = values["bundle"];
  const apply = values["apply"] === true;
  const json = values["json"] === true;
  if (name.value !== "app") {
    if (typeof bundleFlag === "string") {
      return err([`--bundle belongs to the app target, not ${name.value}`]);
    }
    return ok({ apply, json, target: { kind: name.value } });
  }
  if (typeof bundleFlag !== "string") {
    return err(["the app target needs --bundle <name>"]);
  }
  const ruling = readRuling();
  if (ruling.isErr()) {
    return err([ruling.error.message]);
  }
  const bundle = resolveBundle({ named: bundleFlag, ruling: ruling.value });
  if (bundle.isErr()) {
    return err([bundle.error.message]);
  }
  return ok({ apply, json, target: { bundle: bundle.value, kind: "app" } });
}
