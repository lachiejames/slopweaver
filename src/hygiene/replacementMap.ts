/**
 * An install's ordered replacement map — the half of redaction that knows what a name BECOMES.
 *
 * The committed forbidden-identifier rules (`./forbiddenIdentifiers.ts`) are hashes, so they can say THAT a span
 * is a forbidden name and never what to write in its place. The map supplies that: one ordered rule per line in
 * `$SLOPWEAVER_HOME/hygiene-replacements.tsv`, applied before the hashed rules mask whatever it did not cover.
 * Its rows spell the very names they replace, so the file is install state and never enters git — this module is
 * the format, and every test of it uses the synthetic organisation.
 *
 * ## The format
 *
 * ```text
 * # a comment; blank lines are skipped; rules run top to bottom, most specific first
 * literal<TAB>old-host.example<TAB>new-host.example
 * literal,i<TAB>Old Name<TAB>New Name
 * regex,i<TAB>\b(api|staging)\.old\.example\b<TAB>\1.new.example
 * literal,preserve-case<TAB>oldco<TAB>acme
 * ```
 *
 * - Exactly three tab-separated columns: flags, pattern, replacement. The pattern is never empty; the replacement
 *   may be. Only the flags column is trimmed — the other two are taken byte for byte.
 * - Flags are comma-separated: exactly one of `literal` or `regex`, plus optionally `i` (case-insensitive) or, on
 *   a `literal` rule only, `preserve-case`, which matches any casing and writes the replacement in the casing it
 *   found (`oldco` → `acme`, `Oldco` → `Acme`, `OLDCO` → `ACME`). `preserve-case` already ignores case, so `i`
 *   beside it is refused as a contradiction rather than read as a no-op.
 * - A `regex` replacement names a group as `\1` … `\9` and a literal backslash as `\\`; a `$` is always literal.
 *   A group the pattern does not have is refused at load time, not discovered as a silent empty at apply time.
 *
 * Every refusal names the file and line and quotes neither column: `./replacementMapErrors.ts`.
 */
import { lstatSync, readFileSync } from "node:fs";

import { isRecord } from "../lib/parsers.js";
import { err, ok, type Result } from "../lib/result.js";
import { stateHomePaths } from "../stateHome.js";

import { type ReplacementMapError, ReplacementMapErrors } from "./replacementMapErrors.js";

/** How one rule matches and writes. */
type ReplacementMode = "literal" | "regex" | "preserve-case";

/** One parsed rule, ready to apply. */
export interface ReplacementRule {
  /** The 1-based line it came from, so a report can say which rule fired without quoting it. */
  readonly line: number;
  readonly mode: ReplacementMode;
  /** Global, and case-insensitive when the rule asked for it. */
  readonly re: RegExp;
  /**
   * What a match becomes. For `regex`, already in JavaScript's replacement syntax (`$1`, `$$`); for the other two
   * modes, the literal word.
   */
  readonly replacement: string;
}

/** The outcome of reading the map. An absent file is a normal state, so it is a success that carries no rule. */
export type ReplacementMapLoad =
  | { readonly kind: "absent"; readonly path: string; readonly rules: readonly ReplacementRule[] }
  | { readonly kind: "loaded"; readonly path: string; readonly rules: readonly ReplacementRule[] };

/** Every flag a rule may carry. */
const KNOWN_FLAGS: ReadonlySet<string> = new Set(["literal", "regex", "i", "preserve-case"]);

/** A bare ASCII word: what both sides of a `preserve-case` rule must be, so its three casings are well defined. */
const BARE_WORD = /^[A-Za-z]+$/;

/**
 * Pure: parse the map's text into its ordered rules, or the first line that cannot be one.
 *
 * @param text the whole file
 * @param path the file it came from, carried into every error
 * @returns the rules in file order, or the typed refusal naming the line
 */
export function parseReplacementMap({
  text,
  path,
}: {
  text: string;
  path: string;
}): Result<readonly ReplacementRule[], ReplacementMapError> {
  const rules: ReplacementRule[] = [];
  const lines = text.split(/\r?\n/);
  for (const [index, raw] of lines.entries()) {
    const trimmed = raw.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) {
      continue;
    }
    const parsed = parseRule({ line: index + 1, path, raw });
    if (parsed.isErr()) {
      return err(parsed.error);
    }
    rules.push(parsed.value);
  }
  return ok(rules);
}

/**
 * Parse one rule line.
 *
 * @param raw the line as written
 * @param line its 1-based number
 * @param path the file, for the errors
 * @returns the rule, or the refusal
 */
function parseRule({
  raw,
  line,
  path,
}: {
  raw: string;
  line: number;
  path: string;
}): Result<ReplacementRule, ReplacementMapError> {
  const columns = raw.split("\t");
  const [flagsColumn, pattern, replacement] = columns;
  if (columns.length !== 3 || flagsColumn === undefined || pattern === undefined || replacement === undefined) {
    return err(ReplacementMapErrors.columnsInvalid({ line, path }));
  }
  if (flagsColumn.trim().length === 0 || pattern.length === 0) {
    return err(ReplacementMapErrors.columnsInvalid({ line, path }));
  }
  const flags = parseFlags({ column: flagsColumn });
  if (flags === undefined) {
    return err(ReplacementMapErrors.flagsInvalid({ line, path }));
  }
  if (flags.mode === "regex") {
    return regexRule({ caseInsensitive: flags.caseInsensitive, line, path, pattern, replacement });
  }
  if (flags.mode === "preserve-case" && !(BARE_WORD.test(pattern) && BARE_WORD.test(replacement))) {
    return err(ReplacementMapErrors.patternInvalid({ line, path }));
  }
  const ignoreCase = flags.caseInsensitive || flags.mode === "preserve-case";
  return ok({
    line,
    mode: flags.mode,
    re: new RegExp(escapeRegExp({ text: pattern }), ignoreCase ? "gi" : "g"),
    replacement,
  });
}

/**
 * Pure: the flags column as a mode and a case switch, or `undefined` when it is outside the closed set.
 *
 * @param column the flags column, untrimmed
 * @returns the mode and whether `i` was given, or undefined for any unknown, repeated or contradictory flag
 */
function parseFlags({ column }: { column: string }): { mode: ReplacementMode; caseInsensitive: boolean } | undefined {
  const tokens = column.split(",").map((token) => token.trim());
  const set = new Set(tokens);
  if (set.size !== tokens.length || tokens.some((token) => !KNOWN_FLAGS.has(token))) {
    return undefined;
  }
  const literal = set.has("literal");
  const regex = set.has("regex");
  const caseInsensitive = set.has("i");
  const preserve = set.has("preserve-case");
  if (literal === regex || (preserve && (regex || caseInsensitive))) {
    return undefined;
  }
  if (preserve) {
    return { caseInsensitive: false, mode: "preserve-case" };
  }
  return { caseInsensitive, mode: literal ? "literal" : "regex" };
}

/**
 * Compile a `regex` rule and translate its replacement, refusing a pattern that does not compile or a
 * replacement naming a group the pattern lacks.
 *
 * @param pattern the pattern column
 * @param replacement the replacement column, in the map's `\1` spelling
 * @param caseInsensitive whether `i` was given
 * @param line the rule's line
 * @param path the file
 * @returns the rule, or the refusal
 */
function regexRule({
  pattern,
  replacement,
  caseInsensitive,
  line,
  path,
}: {
  pattern: string;
  replacement: string;
  caseInsensitive: boolean;
  line: number;
  path: string;
}): Result<ReplacementRule, ReplacementMapError> {
  const flags = caseInsensitive ? "gi" : "g";
  let re: RegExp;
  let groups: number;
  try {
    re = new RegExp(pattern, flags);
    // An alternation with the empty pattern always matches "", and its result has one slot per group.
    groups = new RegExp(`${pattern}|`, flags).exec("")!.length - 1;
  } catch {
    return err(ReplacementMapErrors.patternInvalid({ line, path }));
  }
  const translated = translateReplacement({ groups, replacement });
  if (translated === undefined) {
    return err(ReplacementMapErrors.backreferenceInvalid({ line, path }));
  }
  return ok({ line, mode: "regex", re, replacement: translated });
}

/**
 * Pure: a replacement in the map's spelling (`\1`, `\\`, literal `$`) rewritten into JavaScript's (`$1`, `\`,
 * `$$`), or `undefined` when a backslash escapes anything else or names a group past `groups`.
 *
 * @param replacement the replacement column
 * @param groups how many capture groups the pattern has
 * @returns the translated replacement, or undefined when it is malformed
 */
function translateReplacement({ replacement, groups }: { replacement: string; groups: number }): string | undefined {
  let out = "";
  for (let at = 0; at < replacement.length; at++) {
    const char = replacement.charAt(at);
    if (char === "$") {
      out += "$$";
      continue;
    }
    if (char !== "\\") {
      out += char;
      continue;
    }
    const next = replacement.charAt(at + 1);
    at += 1;
    if (next === "\\") {
      out += "\\";
      continue;
    }
    if (!/^[1-9]$/.test(next) || Number(next) > groups) {
      return undefined;
    }
    out += `$${next}`;
  }
  return out;
}

/** Pure: a literal string escaped for use inside a regular expression. */
function escapeRegExp({ text }: { text: string }): string {
  return text.replace(/[.*+?^${}()|[\]\\/-]/g, "\\$&");
}

/**
 * Pure: a word written in the casing of the text it replaces — all lower, all upper, or a leading capital.
 *
 * @param found the matched text
 * @param word the replacement word as the map wrote it
 * @returns the word in the found text's casing; a mixed casing that is none of the three takes lower case
 */
function inCasingOf({ found, word }: { found: string; word: string }): string {
  if (found === found.toUpperCase() && found.length > 1) {
    return word.toUpperCase();
  }
  const first = found.charAt(0);
  if (first === first.toUpperCase() && found.slice(1) === found.slice(1).toLowerCase()) {
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  }
  return word.toLowerCase();
}

/**
 * Pure: run every rule over one text, in order, each over the previous one's output.
 *
 * @param rules the parsed map, in file order
 * @param text the value to rewrite
 * @returns the rewritten value; the input unchanged when no rule matches
 */
export function applyReplacementMap({ rules, text }: { rules: readonly ReplacementRule[]; text: string }): string {
  return rules.reduce((current, rule) => {
    if (rule.mode === "regex") {
      return current.replace(rule.re, rule.replacement);
    }
    if (rule.mode === "preserve-case") {
      return current.replace(rule.re, (found) => inCasingOf({ found, word: rule.replacement }));
    }
    return current.replace(rule.re, () => rule.replacement);
  }, text);
}

/**
 * Whether a directory entry sits at `path` at all, a symlink whose target is gone included — `lstat` never follows
 * the link, which is the whole point.
 *
 * @param path the map's own location
 * @returns true when any entry is there
 */
function directoryEntryExists({ path }: { path: string }): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Read and parse this install's map, telling an absent file (normal) apart from one that cannot be read or
 * parsed (a refusal: redacting with half a map would report clean over names it never loaded).
 *
 * @param home the Slopweaver home whose map is read
 * @param readText the reader, injected so the unreadable branch is testable without chmod
 * @returns the load, or the typed refusal
 */
export function loadReplacementMap({
  home,
  readText = ({ path }) => readFileSync(path, "utf8"),
}: {
  home: string;
  readText?: (args: { path: string }) => string;
}): Result<ReplacementMapLoad, ReplacementMapError> {
  // OPTIONAL, and install state by construction: its rows spell the very names they replace, so never in git.
  const path = stateHomePaths({ home }).hygieneReplacementsTsv;
  let text: string;
  try {
    text = readText({ path });
  } catch (error) {
    const code = isRecord(error) ? error["code"] : undefined;
    // ENOENT alone is not absence: a dangling symlink answers it too, and a map that is THERE but unreadable is
    // the refusal, never an empty map that reports clean over every name it would have replaced.
    if (code === "ENOENT" && !directoryEntryExists({ path })) {
      return ok({ kind: "absent", path, rules: [] });
    }
    if (code === "ENOENT") {
      return err(ReplacementMapErrors.unreadable({ path, reason: "dangling symlink" }));
    }
    return err(ReplacementMapErrors.unreadable({ path, reason: typeof code === "string" ? code : "read failed" }));
  }
  return parseReplacementMap({ path, text }).map((rules): ReplacementMapLoad => ({ kind: "loaded", path, rules }));
}

/**
 * Pure: the one line every redacting verb prints saying whether the map ran, so a clean result over an absent
 * map is never mistaken for a clean result over a loaded one.
 *
 * @param load the map's load outcome
 * @returns the status line, without a trailing newline
 */
export function replacementMapStatusLine({ load }: { load: ReplacementMapLoad }): string {
  if (load.kind === "absent") {
    return (
      `redaction: replacement map NOT LOADED (no ${load.path}) — only the committed hashed rules ran, ` +
      "so every name they found was masked rather than replaced"
    );
  }
  if (load.rules.length === 0) {
    return `redaction: replacement map PRESENT BUT EMPTY at ${load.path} — only the committed hashed rules ran`;
  }
  return `redaction: replacement map LOADED, ${String(load.rules.length)} rule(s) applied from ${load.path}`;
}
