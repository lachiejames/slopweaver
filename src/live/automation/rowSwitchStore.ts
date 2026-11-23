/**
 * The effectful half of a SWITCH: writing one definition's `enabled`, and appending the journal line that says who
 * asked for it. The rules are `./rowSwitch.ts`; the verb that composes them under the definition hold lock is
 * `../../cli/commands/automation/switch.ts`.
 *
 * ## Only the `enabled` key is ever written
 *
 * A definition file is shared by every checkout on the machine and by both registrars, so this reads the file as raw
 * JSON and sets ONE key, exactly as a hold write does (`./failureHoldStore.ts`). Re-serialising a parsed definition
 * would drop any field this build does not know, and would write back the defaults the parse filled in. The raw object
 * is still re-serialised, so every other key keeps the value `JSON.parse` read, not its bytes: the file is re-indented.
 * A value JSON cannot write back as it parsed (`-0` comes back `0`, a number past double range parses to `Infinity`
 * and comes back `null`) is REFUSED, the file left byte for byte as it was: the text about to be written is parsed
 * back and compared with the object, numbers by `Object.is`, before anything lands.
 *
 * ## The journal is append-only and nothing ever edits a line
 *
 * `$SLOPWEAVER_HOME/live/recipe/switches.jsonl`, one line per switch that changed a row. The definition is the
 * state; the journal is who asked for it and on what words, so a wrong switch is findable afterwards.
 */
import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

import { appendLines } from "#lib/appendSeparator.js";
import { errorMessage } from "#lib/errorMessage.js";
import { isRecord } from "#lib/parsers.js";
import { err, ok, type Result } from "#lib/result.js";
import { safeJsonParse, safeJsonStringify } from "#lib/safeJson.js";
import { writeFileAtomic } from "#lib/writeAtomic.js";
import { stateHomePaths } from "../../stateHome.js";
import { parseRecipeDefinition, type RecipeDefinition } from "./definition.js";
import { type AutomationSwitch, AutomationSwitchRuleErrors, type SwitchStoreError } from "./rowSwitch.js";

/** Owner-only, like every register beside it. */
const DIR_MODE = 0o700;

/** One definition file, read raw and parsed: the object to write back, and the row it describes. */
export interface RawDefinitionRead {
  readonly raw: Record<string, unknown>;
  readonly definition: RecipeDefinition;
}

/**
 * Read one definition file as the raw JSON object it holds and the row it parses to.
 *
 * @param path the canonical `<recipeId>.json`
 * @param recipeId the row the file must carry
 * @returns both views, or why the file cannot be switched
 */
export function readDefinitionForSwitch({
  path,
  recipeId,
}: {
  readonly path: string;
  readonly recipeId: string;
}): Result<RawDefinitionRead, SwitchStoreError> {
  const refuse = ({ detail }: { readonly detail: string }): Result<RawDefinitionRead, SwitchStoreError> =>
    err(AutomationSwitchRuleErrors.definitionNotWritten({ detail, path }));
  let decoded: unknown;
  try {
    decoded = safeJsonParse({ label: path, text: readFileSync(path, "utf8") });
  } catch (cause) {
    return refuse({ detail: `the file did not read as JSON: ${errorMessage({ error: cause })}` });
  }
  if (!isRecord(decoded)) {
    return refuse({ detail: "the file is not a JSON object" });
  }
  const parsed = parseRecipeDefinition({ value: decoded });
  if (parsed.isErr()) {
    return refuse({ detail: `it does not parse: ${parsed.error.message}` });
  }
  if (parsed.value.recipeId !== recipeId) {
    return refuse({ detail: `the file carries recipe '${parsed.value.recipeId}', not '${recipeId}'` });
  }
  return ok({ definition: parsed.value, raw: decoded });
}

/** Whether two decoded JSON values are the same value, every number compared with `Object.is`. */
function sameJsonValue({ left, right }: { readonly left: unknown; readonly right: unknown }): boolean {
  if (Array.isArray(left)) {
    return (
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((item, index) => sameJsonValue({ left: item, right: right[index] }))
    );
  }
  if (isRecord(left)) {
    if (!isRecord(right)) {
      return false;
    }
    const keys = Object.keys(left);
    return (
      keys.length === Object.keys(right).length &&
      keys.every((key) => Object.hasOwn(right, key) && sameJsonValue({ left: left[key], right: right[key] }))
    );
  }
  return Object.is(left, right);
}

/**
 * Write `enabled` onto the raw object a definition file holds, every other key carried as it parsed, or refuse with
 * the file untouched when a value in it would not survive being written back.
 *
 * @param path the canonical `<recipeId>.json`
 * @param raw the object the file held when it was read, under the same lock
 * @param enabled the state to write
 * @returns ok, or why the write failed or was refused
 */
export function writeDefinitionEnabled({
  path,
  raw,
  enabled,
}: {
  readonly path: string;
  readonly raw: Record<string, unknown>;
  readonly enabled: boolean;
}): Result<void, SwitchStoreError> {
  const next = { ...raw, enabled };
  try {
    const text = JSON.stringify(next, null, 2);
    if (!sameJsonValue({ left: next, right: safeJsonParse({ label: path, text }) })) {
      return err(
        AutomationSwitchRuleErrors.definitionNotWritten({
          detail: "a value in the file would not survive being written back (`-0`, or a number past double range)",
          path,
        }),
      );
    }
    writeFileAtomic({ contents: `${text}\n`, path });
  } catch (cause) {
    return err(AutomationSwitchRuleErrors.definitionNotWritten({ detail: errorMessage({ error: cause }), path }));
  }
  return ok(undefined);
}

/**
 * Append one switch to the journal.
 *
 * @param home the state home the journal lives under
 * @param entry the switch to record
 * @returns ok, or why the append failed
 */
export function appendAutomationSwitch({
  home,
  entry,
}: {
  readonly home: string;
  readonly entry: AutomationSwitch;
}): Result<void, SwitchStoreError> {
  const path = stateHomePaths({ home }).live.recipe.switchesJsonl;
  try {
    mkdirSync(dirname(path), { mode: DIR_MODE, recursive: true });
    appendLines({ path, text: `${safeJsonStringify({ label: "an automation switch", value: entry })}\n` });
  } catch (cause) {
    return err(AutomationSwitchRuleErrors.journalUnwritable({ detail: errorMessage({ error: cause }), path }));
  }
  return ok(undefined);
}
