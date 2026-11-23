/**
 * The grammar a memory's `name` must hold to, and the one function that judges it. Pure — a string in,
 * findings out, no corpus and no filesystem.
 *
 * ## Why this is a check rather than a convention
 *
 * `name` is the identity a `[[wikilink]]` types, so its FORMAT is what decides whether a link written the
 * natural way resolves. Nothing examined it: `parse.ts`'s `requiredString` rejects a missing, non-string or
 * empty value and nothing else, so every malformed name a session invented was accepted and then linked to
 * in the one spelling that could never match. A corpus review found 226 of 295 names carrying
 * a redundant type prefix and 166 not kebab-case, with two dangling wikilinks as the direct consequence.
 *
 * ## The subject is the DECLARED NAME, never the filename stem
 *
 * `build_command.md` carrying `name: build-command` is Claude Code's own ordinary output, and `check.ts`'s
 * header records why `_` and `-` are both legitimate in a FILENAME: they are different fields, and folding
 * them would invent a `collision` that does not exist. So this grammar is applied to `declaredName` alone.
 * Applied to a stem it would fire on the tool's own correct behaviour.
 *
 * ## Why a leaf with no usable name produces nothing here
 *
 * A missing, non-string or empty `name` is already a `schema` finding. Reporting it twice under two ids
 * makes a reader chase one cause through two lines, so a leaf whose `declaredName` is `null` is this
 * check's silence rather than its finding.
 */

import { MEMORY_TYPES, type MemoryFinding, type MemoryLeaf } from "./types.js";

/**
 * The whole grammar: lowercase alphanumeric words joined by single hyphens. One expression rejects
 * uppercase, `_`, whitespace, a leading or trailing `-`, and `--`, which is the entire documented
 * convention — a dot, a slash and a `#` all fail it too, with nothing extra to state.
 */
const MEMORY_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * The longest a name may be.
 *
 * MEASURED: across all three auto-memory corpora on this machine, 72 declared names, the longest
 * legitimate one is 58 characters (`data-source-allowlist-acme-crm-and-phones-are-not-approved`). A ceiling
 * of 60 would sit two characters above real usage and fire on the next slightly-longer legitimate memory;
 * 64 leaves six characters of headroom and still refuses a sentence used as an identity. Raise it against a
 * fresh measurement rather than against one annoying refusal.
 *
 * Reproduce through the REAL parser. Two earlier spellings of this measurement were both wrong and in the
 * same direction: a `grep '^name: '` over the files reported 23 names, and a `find -name MEMORY.md` walk
 * reported the same 23 because it does not follow the symlink one corpus directory is. Glob the projects
 * root, the way `store.ts#discoverMemoryCorpora` does, and redirect stdin so the loop's own command cannot
 * eat the list:
 *
 * ```bash
 * for p in "$HOME"/.claude/projects/*; do
 *   [ -f "$p/memory/MEMORY.md" ] && slopweaver memory sweep --dir "$p/memory" --json < /dev/null
 * done | grep -o '"name": "[^"]*"' | cut -d'"' -f4 | awk '{ print length }' | sort -rn | head -1
 * ```
 */
export const MEMORY_NAME_MAX_LENGTH = 64;

/**
 * The prefixes a name must not open with — every declared {@link MEMORY_TYPES} value plus a hyphen.
 *
 * Derived rather than listed, so a fifth type cannot drift away from this rule. The defect it names is a
 * name restating what `metadata.type` already carries: `feedback-voice-and-response-shape` says `feedback`
 * twice and makes every wikilink to it longer than the fact it points at.
 *
 * MEASURED over the same 72 names and the same repro as {@link MEMORY_NAME_MAX_LENGTH}: exactly one
 * trips this rule (`project-local-deploy-stacks`), none trips the grammar, none trips the ceiling. It is
 * left standing rather than repaired — the corpus review recorded that the cheap instance fix is what
 * hid the class problem for months, so this reports the one that exists and refuses the next one.
 */
export const MEMORY_NAME_BANNED_PREFIXES: readonly string[] = MEMORY_TYPES.map((type) => `${type}-`);

/**
 * Whether a string is a well-formed memory identity — the grammar alone, without the prefix or length rules.
 *
 * Exported for the write-time gate, which asks the same question of a `[[wikilink]]`'s TARGET: a target that
 * is not a well-formed identity can never resolve to any memory, however many are written later.
 *
 * @param value the candidate identity
 * @returns whether it holds to {@link MEMORY_NAME_PATTERN}
 */
export function isWellFormedMemoryName({ value }: { value: string }): boolean {
  return MEMORY_NAME_PATTERN.test(value);
}

/** A compliant example, shown in every message so a correction is a rewrite rather than a guess. */
const EXAMPLE = "decisions-go-on-the-queue";

/**
 * Judge one declared name.
 *
 * The grammar is checked FIRST and short-circuits: until a name is kebab-case at all, the prefix and length
 * complaints are noise stacked on a name the author is about to rewrite anyway. Past that gate the other two
 * are orthogonal and both actionable, so both fire.
 *
 * @param name the declared frontmatter `name`
 * @param file the leaf's basename, carried into every finding
 * @returns the defects in this name, empty when it is well formed
 */
export function nameFormatFindingsForName({ name, file }: { name: string; file: string }): readonly MemoryFinding[] {
  if (!isWellFormedMemoryName({ value: name })) {
    return [
      {
        check: "name-format",
        file,
        line: null,
        message: `\`name: ${name}\` is not kebab-case — lowercase words joined by single hyphens, like \`${EXAMPLE}\`; a wikilink written the natural way will not match anything else`,
      },
    ];
  }
  const findings: MemoryFinding[] = [];
  const prefix = MEMORY_NAME_BANNED_PREFIXES.find((banned) => name.startsWith(banned));
  if (prefix !== undefined) {
    findings.push({
      check: "name-format",
      file,
      line: null,
      message: `\`name: ${name}\` opens with \`${prefix}\` — \`metadata.type\` already carries the kind, so drop the prefix and name the fact`,
    });
  }
  if (name.length > MEMORY_NAME_MAX_LENGTH) {
    findings.push({
      check: "name-format",
      file,
      line: null,
      message: `\`name: ${name}\` is ${name.length} characters — the ceiling is ${MEMORY_NAME_MAX_LENGTH}, because a name is an identity a wikilink types rather than a description`,
    });
  }
  return findings;
}

/**
 * Judge one leaf's declared name.
 *
 * @param leaf the parsed leaf
 * @returns its name-format defects; empty when the name is well formed OR when there is no usable name at
 *   all, which `schema` already reports
 */
export function nameFormatFindings({ leaf }: { leaf: MemoryLeaf }): readonly MemoryFinding[] {
  if (leaf.declaredName === null) {
    return [];
  }
  return nameFormatFindingsForName({ file: leaf.file, name: leaf.declaredName });
}
