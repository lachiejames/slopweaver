/**
 * Claude Code versions, read and compared: what a transcript was written by, what `claude --version` prints and
 * which installed version is newest. A strict dotted shape or UNMEASURED — a version is never compared as text,
 * because `2.1.99` sorts after `2.1.283` that way. The chair hand-off cadence (`../supervisor/chairCadence.ts`)
 * is the first reader.
 */

/** A strict dotted Claude Code version — `2.1.283`. Anything else is unmeasured, never compared as text. */
const VERSION_SHAPE = /^\d+\.\d+\.\d+$/;

/** A Claude Code version, or why one could not be read. */
export type ClaudeCodeVersionReading =
  { readonly kind: "measured"; readonly version: string } | { readonly kind: "unmeasured"; readonly why: string };

/**
 * Read the Claude Code version a transcript's newest record was written by.
 *
 * File order decides, as it does for the model (`./chairModel.ts`): a transcript is append-only. A tail read
 * starts mid-line, so only its FIRST line may fail to parse and be skipped; any later line that does not parse is a
 * record torn mid-write, and it or a newest record naming a version outside the strict shape is UNMEASURED, never
 * replaced by an older one.
 *
 * @param text the transcript, whole or a tail of it
 * @returns the newest record's version, or why none was found
 */
export function readClaudeCodeVersion({ text }: { text: string }): ClaudeCodeVersionReading {
  let newest: ClaudeCodeVersionReading = {
    kind: "unmeasured",
    why: "no transcript record in what was read names a Claude Code version",
  };
  for (const [index, line] of text.split("\n").entries()) {
    const reading = versionOfLine({ first: index === 0, line });
    if (reading !== undefined) {
      newest = reading;
    }
  }
  return newest;
}

/**
 * The top-level `version` one transcript line carries, when it parses and names one.
 *
 * @param line one transcript line
 * @param first whether it is the read's first line, the one a tail read may start mid-record
 * @returns the version, unmeasured when it is outside the strict shape or the line is torn, or undefined when the
 *   line names none
 */
function versionOfLine({ line, first }: { line: string; first: boolean }): ClaudeCodeVersionReading | undefined {
  if (line.trim() === "") {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    if (first) {
      return undefined;
    }
    return {
      kind: "unmeasured",
      why: "the newest transcript record is torn mid-write, so its Claude Code version is unread",
    };
  }
  if (typeof parsed !== "object" || parsed === null || !("version" in parsed)) {
    return undefined;
  }
  const { version } = parsed;
  if (typeof version !== "string" || !VERSION_SHAPE.test(version)) {
    return {
      kind: "unmeasured",
      why: `the newest transcript record names Claude Code ${JSON.stringify(version)}, outside the strict dotted shape`,
    };
  }
  return { kind: "measured", version };
}

/**
 * Compare two Claude Code versions numerically, part by part.
 *
 * @param left the version on the left of the comparison
 * @param right the version on the right of the comparison
 * @returns whether `left` is before, equal to or after `right`, or unmeasured when either is malformed
 */
export function compareClaudeCodeVersions({
  left,
  right,
}: {
  left: string;
  right: string;
}): "before" | "equal" | "after" | "unmeasured" {
  if (!VERSION_SHAPE.test(left) || !VERSION_SHAPE.test(right)) {
    return "unmeasured";
  }
  // BigInt, not Number: a part past 2^53 must not round into its neighbour and read as equal.
  const a = left.split(".").map((part) => BigInt(part));
  const b = right.split(".").map((part) => BigInt(part));
  for (const [index, part] of a.entries()) {
    const other = b[index]!;
    if (part < other) {
      return "before";
    }
    if (part > other) {
      return "after";
    }
  }
  return "equal";
}

/**
 * The highest well-formed version among a directory's entry names.
 *
 * @param names the entry names, in any order; anything not a version is ignored
 * @returns the highest version, or undefined when none is well formed
 */
export function newestClaudeCodeVersion({ names }: { names: readonly string[] }): string | undefined {
  let newest: string | undefined;
  for (const name of names) {
    if (!VERSION_SHAPE.test(name)) {
      continue;
    }
    if (newest === undefined || compareClaudeCodeVersions({ left: name, right: newest }) === "after") {
      newest = name;
    }
  }
  return newest;
}

/**
 * The version `claude --version` printed — `2.1.283 (Claude Code)`.
 *
 * @param output the command's stdout
 * @returns the version, or why the output names none
 */
export function parseClaudeVersionOutput({ output }: { output: string }): ClaudeCodeVersionReading {
  const [first] = output.trim().split(/\s+/);
  if (first === undefined || !VERSION_SHAPE.test(first)) {
    return { kind: "unmeasured", why: `\`claude --version\` printed no version (${JSON.stringify(output.trim())})` };
  }
  return { kind: "measured", version: first };
}
