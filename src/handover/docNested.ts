/**
 * The front-matter keys whose values NEST, and the real YAML parser they alone are handed.
 *
 * Split out of {@link ./doc.ts} under the file-size ratchet when `options:` became the third of them. The
 * seam is the one that file's own header already draws: the flat reader walks lines and never parses YAML,
 * this one parses YAML and never sees a flat scalar. Keeping them in one file made that boundary a
 * convention; two files make it the import graph.
 *
 * Pure: no filesystem, no clock. The caller supplies the front-matter lines.
 */

import { parseDocument } from "yaml";

import type { HandShot } from "../hand/shot.js";

import { askExampleSetOf, type PublishedExamples, publishedExamples } from "./askExamples.js";
import { type AskOption, askOptionsFrom } from "./askShape.js";
import { askShotOf, askShotProblems } from "./askShot.js";
import { type Probe, parseProbes } from "./probe.js";

/** The keys whose values may nest, and which therefore need a real YAML parser. */
export const NESTED_KEYS = ["doneWhen", "examples", "options", "outputs", "shot"] as const;

/**
 * Whether a line begins a top-level front-matter key, rather than continuing the previous one.
 *
 * @returns true when the line opens a key of its own
 */
export function isTopLevelKey({ line }: { line: string }): boolean {
  return /^[A-Za-z_][\w-]*\s*:/.test(line);
}

/** A YAML collection node as plain JSON; a scalar unchanged. Keeps the rest of this file node-agnostic. */
function plainValue({ value }: { value: unknown }): unknown {
  if (value === null || typeof value !== "object" || !("toJSON" in value)) {
    return value;
  }
  const node: unknown = value.toJSON;
  return typeof node === "function" ? node.call(value) : value;
}

/** A list of strings, tolerating the bare-scalar spelling. Empty when the field was absent. */
function asStringList({ value }: { value: unknown }): readonly string[] {
  if (typeof value === "string") {
    return value.trim().length === 0 ? [] : [value.trim()];
  }
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item: unknown): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.trim());
}

/**
 * Just the `doneWhen:`/`options:`/`outputs:` blocks, lifted out of the surrounding front-matter.
 *
 * The extraction is the point. Handing YAML the WHOLE front-matter meant an unrelated sibling line could break
 * the probe read — and it did: `distil-latest-collapse`'s summary begins with a backtick, which is a reserved
 * character in a YAML plain scalar, so adding probes to that doc made them silently unloadable and the doc
 * malformed. A flat scalar this reader never looks at must not be able to do that.
 *
 * Taken line-wise rather than by parsing, because the thing being avoided IS parsing the rest of the block.
 */
function nestedBlock({ lines }: { lines: readonly string[] }): readonly string[] {
  const kept: string[] = [];
  let inside = false;
  for (const line of lines) {
    if (isTopLevelKey({ line })) {
      inside = NESTED_KEYS.some((key) => new RegExp(`^${key}\\s*:`).test(line));
      if (inside) {
        kept.push(line);
      }
      continue;
    }
    // A continuation line: an indented list item, or blank. Kept only while inside a nested key's block.
    if (inside) {
      kept.push(line);
    }
  }
  return kept;
}

/**
 * The nested `doneWhen:` block, the `options:`, `examples:` and `outputs:` lists and the `shot:` mapping, read with a
 * real YAML parser over JUST those blocks.
 *
 * A YAML failure is reported ONLY when the front-matter actually declares one of them. That asymmetry is the
 * whole point: a doc that declares no probes is unaffected by whether its prose happens to be YAML-clean, and
 * reporting a parse error it has no stake in is what regressed three docs. A doc that DOES declare probes gets
 * the error loudly, because there the parse is load-bearing — computing `landed` off a subset of a doc's
 * conditions is the overclaim this whole feature removes.
 *
 * @param lines the whole front-matter, from which this reads only its own keys' blocks
 * @returns the nested fields, and one sentence per way the block could not be read
 */
export function nestedFields({ lines: all }: { lines: readonly string[] }): {
  probes: readonly Probe[];
  outputs: readonly string[];
  options: readonly AskOption[];
  examples: readonly string[];
  shot: HandShot | undefined;
  problems: readonly string[];
} {
  const lines = nestedBlock({ lines: all });
  // ANY of the keys makes the parse load-bearing. `outputs:` becomes real `path:` probes, so losing it
  // silently is the same subset-overclaim as losing `doneWhen:` — the first version only guarded the latter.
  const declaresNested = lines.some((line) => NESTED_KEYS.some((key) => new RegExp(`^${key}\\s*:`).test(line)));
  // `uniqueKeys` is turned OFF explicitly — it DEFAULTS to true, and left on it records a duplicate as "Map
  // keys must be unique at line 3", which does not name the key. The flat reader already reports duplicates
  // by name, so leaving it on would give two problems for one defect and neither would say which.
  const parsed = parseDocument(lines.join("\n"), {
    logLevel: "silent",
    strict: true,
    uniqueKeys: false,
    version: "1.2",
  });
  if (parsed.errors.length > 0) {
    const first = parsed.errors[0]!.message.split("\n")[0]!;
    return {
      examples: [],
      options: [],
      outputs: [],
      probes: [],
      problems: declaresNested ? [`\`${NESTED_KEYS.join(":`/`")}:\` could not be read — not valid YAML: ${first}`] : [],
      shot: undefined,
    };
  }
  // `get`, never `toJS`: given a duplicate, `get` returns the FIRST value and `toJS` returns the last, so
  // `toJS` would re-erase a real value with a blank one exactly as the original defect did.
  const probes = parseProbes({ value: plainValue({ value: parsed.get("doneWhen") }) });
  // A `shot:` that is there and will not read is SAID, never dropped as if the row had no picture.
  const declaredShot: unknown = plainValue({ value: parsed.get("shot") });
  const shotProblems = declaredShot === undefined ? [] : askShotProblems({ value: declaredShot });
  return {
    // An ask row's concrete scenes (`./askExamples.ts`), in the order the card numbers them.
    examples: asStringList({ value: plainValue({ value: parsed.get("examples") }) }),
    // The letters come back from the POSITION, so an `options:` block hand-edited into the wrong order still
    // renders A, B, C — see `./askShape.ts`'s `askOptionsFrom`.
    options: askOptionsFrom({ value: plainValue({ value: parsed.get("options") }) }),
    outputs: asStringList({ value: plainValue({ value: parsed.get("outputs") }) }),
    probes: probes.probes,
    problems: [...probes.problems, ...shotProblems],
    // An ask row's boxed picture (`./askShot.ts`), whole or not at all — a box past its picture is never drawn.
    shot: askShotOf({ value: declaredShot }),
  };
}

/** A doc's example slot — `examples:` and `exampleGap:`, whichever it records — in the board row's own shape. */
export type DocExamples = PublishedExamples;

/**
 * An ask row's example slot off its front matter — the nested `examples:` list read above, and the flat
 * `exampleGap:` beside it — as the two fields a doc carries, read exactly as a journal line's are.
 *
 * @param examples the nested scenes, empty when none
 * @param gap the flat gap line, absent when none
 * @returns the scenes with no gap, the gap with no scenes, or neither
 */
export function docExamples({ examples, gap }: { examples: readonly string[]; gap: string | undefined }): DocExamples {
  return publishedExamples({ set: askExampleSetOf({ examples, gap }) });
}

/** A doc's picture slot — `shot:`, the picture an ask row's card shows, boxed where the owner should read. */
export interface DocShot {
  /**
   * `shot:` — written by `handover shot` (`./askShot.ts`). Whole or absent: one that does not read is dropped
   * rather than drawn wrong, and named in the doc's problems instead.
   */
  readonly shot?: HandShot;
}

/**
 * An ask row's picture slot off its front matter, absent rather than `undefined` when it carries none.
 *
 * @param shot the nested picture read above, when one read
 * @returns the slot, empty when there is no picture
 */
export function docShot({ shot }: { shot: HandShot | undefined }): DocShot {
  return shot === undefined ? {} : { shot };
}
