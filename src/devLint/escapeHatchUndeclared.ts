/*
 * The escape-hatch gate's first two criteria (`./escapeHatch.ts` § The three criteria): an override variable,
 * or a door override token, that no register row declares. Split from the gate because both are judged per
 * LINE against the register, while the rest of the gate is about how a refusal is rendered.
 */

import { REGISTERED_DOOR_TOKENS, REGISTERED_ENV_VARIABLES } from "../hatch/lookup.js";
import type { EscapeHatchHit } from "./escapeHatch.js";
import type { ShapedName } from "./overrideNameReads.js";

/** The register itself, which necessarily spells every variable and token it declares. */
export const REGISTER_PATH = "src/hatch/registry.ts";

/** A `SLOPWEAVER_ALLOW_<SUFFIX>` mention ANYWHERE on a code line — the ruled shape, quoted or not. */
const ENV_HATCH = /SLOPWEAVER_ALLOW_[A-Z0-9_]+/g;

/** The characters a raw-text match can stop at mid-name: an escape, or the close of one literal in a chain. */
const FRAGMENT_ENDS: ReadonlySet<string> = new Set(["\\", '"', "'", "`"]);

/** The door's own list variable — an override by name, whose TOKENS are what the door criterion polices. */
const DOOR_LIST_VARIABLE = "SLOPWEAVER_DOOR_OVERRIDE";

/**
 * A door override token written as a literal — as its own constant
 * (`ANSWER_QUALITY_OVERRIDE = "answer.quality:v1"`) or inline on a finding (`override: "stub.warn:v1"`).
 * Both spellings are in the tree, and a criterion that saw only the first would have let the demonstration
 * verb's own token stay undeclared.
 */
const DOOR_TOKEN_CONST = /(?:_OVERRIDE\s*=|\boverride:)\s*"([^"]+)"/g;

/**
 * Every override-variable name one code line spells, deduplicated, in first-seen order.
 *
 * @param line the source line, comments already blanked
 * @param shaped the names the syntax tree found starting on this line (`./overrideNameReads.ts`) — a string
 *   literal shaped like an override, or a property key so shaped, in any key position, however it is wrapped —
 *   each with the columns its source node covers
 * @returns the `SLOPWEAVER_ALLOW_*` mentions plus every shaped name
 */
function overrideNamesOn({ line, shaped }: { line: string; shaped: readonly ShapedName[] }): readonly string[] {
  // The text match reads RAW source, so an escape (`"…_POLL"`) or the end of one literal in a chain
  // (`"…_ALLOW_" + "POLL"`) cuts it short. A match stopped at a backslash or a quote, lying INSIDE the very
  // node the syntax tree decoded or folded into a LONGER name it begins, is that fragment, not a second name.
  // One ending there with no such node around it (`"set …_X\n"`, or a longer name in another literal on the
  // same line) still counts.
  const family = [...line.matchAll(ENV_HATCH)]
    .filter((match) => {
      const cut = FRAGMENT_ENDS.has(line.charAt(match.index + match[0].length));
      const insideLonger = shaped.some(
        (span) =>
          span.name !== match[0] &&
          span.name.startsWith(match[0]) &&
          span.start <= match.index &&
          match.index < span.end,
      );
      return !cut || !insideLonger;
    })
    .map((match) => match[0]);
  const names = shaped.map((span) => span.name);
  return [...new Set([...family, ...names])].filter((name) => name !== DOOR_LIST_VARIABLE);
}

/**
 * Every undeclared override variable on one line — a `SLOPWEAVER_ALLOW_*` mention, or any other name shaped
 * like an override (`./overrideVariable.ts`), that no register row carries as its env key. A journalled row's
 * old variable fails here too: its key is a grant, so the name opens nothing and has no business in code.
 *
 * @param line the source line, comments already blanked
 * @param shaped the override names the syntax tree found starting on this line
 * @param at the 1-indexed line number
 * @param path the repo-relative path
 * @returns one hit per variable the register does not carry
 */
export function undeclaredEnvHatches({
  line,
  shaped,
  at,
  path,
}: {
  line: string;
  shaped: readonly ShapedName[];
  at: number;
  path: string;
}): readonly EscapeHatchHit[] {
  const declared = new Set(REGISTERED_ENV_VARIABLES);
  return overrideNamesOn({ line, shaped }).flatMap((variable) => {
    if (declared.has(variable)) {
      return [];
    }
    return [
      {
        line: at,
        criterion: "undeclared" as const,
        message: `${variable} has no row in ${REGISTER_PATH} — every escape hatch is declared once, with its command and its legitimate exceptions`,
        path,
      },
    ];
  });
}

/**
 * Every undeclared door override token written as a literal on one line.
 *
 * @param line the source line, comments already blanked
 * @param at the 1-indexed line number
 * @param path the repo-relative path
 * @returns one hit per token the register does not carry
 */
export function undeclaredDoorTokens({
  line,
  at,
  path,
}: {
  line: string;
  at: number;
  path: string;
}): readonly EscapeHatchHit[] {
  // A registered ENV name assigned to a `*_OVERRIDE` constant carries a row already — the criterion's shape
  // matches the assignment, not what kind of key the value is — so either register clears it, as does the
  // door's own list variable, whose tokens are what this criterion polices.
  const tokens = new Set([...REGISTERED_DOOR_TOKENS, ...REGISTERED_ENV_VARIABLES, DOOR_LIST_VARIABLE]);
  return [...line.matchAll(DOOR_TOKEN_CONST)].flatMap((match) => {
    const token = match[1]!;
    if (tokens.has(token)) {
      return [];
    }
    return [
      {
        line: at,
        criterion: "undeclared" as const,
        message: `door override token "${token}" has no row in ${REGISTER_PATH} — a warn an agent cannot read the exceptions for is a warn it cannot weigh`,
        path,
      },
    ];
  });
}
