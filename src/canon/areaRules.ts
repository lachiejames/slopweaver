/**
 * The DIRECTORY axis — one `paths:`-scoped `.claude/rules/area-<name>.md` per `src/` subsystem, and the one
 * thing about it a command can check.
 *
 * ## What is already covered, and why this file is the residue
 *
 * The scoping itself is gated: `alwaysOnDocsBudget.test.ts` reads every `.claude/rules/*.md` off disk and
 * fails when one that carries no `paths:` is missing from `UNSCOPED_RULES`, so an area rule that loses its
 * frontmatter becomes a new unconditional cost the budget test refuses. `doc-counts` reaches these files
 * through `AUTHORITY_DOCS`, and `staleReferences` and `agent-doc-size` reach them by the `.claude/rules/`
 * prefix. Three gates and a budget, all inherited rather than built.
 *
 * What none of them can see is whether a rule is scoped to the tree it claims to be about. A `paths:` block
 * is a glob list and an H1 is prose, so `area-cli.md` scoped to `src/live/**` satisfies every check above
 * while being handed to a session working in the wrong tree and withheld from the one it documents. The
 * failure is silent in both directions — the wrong session gets rules it cannot act on, and the right one is
 * never handed the file written for it — which is exactly the shape a booted-session read cannot falsify,
 * because what arrives looks like a rule either way.
 *
 * So this module answers one question: does each area rule's `paths:` agree with the tree its own heading
 * names. Pure — the caller reads the files.
 */

import { micromark } from "micromark";
import { isScalar, isSeq, parseDocument } from "yaml";
import { splitFrontMatter } from "./alwaysOnDocs.js";

/** One area rule's declared subject, as its own text states it twice. */
export interface AreaRuleScope {
  /** The `src/` tree named in the H1, with a trailing slash — empty when the H1 names none. */
  readonly heading: string;
  /** Every glob in the top-level `paths:` block, in file order. */
  readonly globs: readonly string[];
}

/** An area rule file to check, as read off disk. */
export interface AreaRuleDoc {
  /** The repo-relative path, e.g. `.claude/rules/area-cli.md`. */
  readonly path: string;
  /** The file's full text, frontmatter included. */
  readonly content: string;
}

/**
 * The tree an area rule's heading names, and the globs its frontmatter scopes it to.
 *
 * The heading grammar is the one every shipped area rule already uses — `# Working in \`src/<tree>/\`` — and a
 * heading that does not match yields an empty string rather than a guess, so {@link areaRuleIssues} reports
 * the heading as unreadable instead of silently comparing against something it invented.
 *
 * @param content the rule file's full text
 * @returns the declared tree and the declared globs
 */
export function areaRuleScope({ content }: { content: string }): AreaRuleScope {
  // Memoised by content: `ruleForTree` asks once per tree per rule, so the atlas re-parsed the same dozen
  // files thousands of times and a CI shard timed `codebaseAtlas.test.ts` out at 36.9s against a 20s cap.
  // Bounded, since a long-lived process may read many revisions of one file.
  const known = SCOPE_BY_CONTENT.get(content);
  if (known !== undefined) {
    return known;
  }
  if (SCOPE_BY_CONTENT.size >= SCOPE_CACHE_LIMIT) {
    SCOPE_BY_CONTENT.clear();
  }
  // Frozen, object and array both: `readonly` is compile-time only, and one caller mutating a shared hit
  // would hand every later caller a scope the file does not declare.
  const parsed = parsedScope({ content });
  const scope: AreaRuleScope = Object.freeze({ globs: Object.freeze([...parsed.globs]), heading: parsed.heading });
  SCOPE_BY_CONTENT.set(content, scope);
  return scope;
}

/** Each rule text already parsed, so a repeat ask costs a lookup rather than a micromark and a yaml pass. */
const SCOPE_BY_CONTENT = new Map<string, AreaRuleScope>();
/** Far above the area rules a tree holds, so a run never evicts; only a long-lived process ever clears it. */
const SCOPE_CACHE_LIMIT = 256;

/**
 * {@link areaRuleScope}'s uncached body.
 *
 * @param content the rule file's full text
 * @returns the declared tree and the declared globs
 */
function parsedScope({ content }: { content: string }): AreaRuleScope {
  // CommonMark and YAML both end a line on LF, CRLF or a bare CR; normalised once here, so the frontmatter
  // split and the heading scan below see the same lines whichever a file was saved with.
  const normalised = content.replace(/\r\n?/g, "\n");
  return { globs: declaredGlobs({ content: normalised }), heading: declaredHeading({ content: normalised }) };
}

/**
 * The `src/` tree an area rule's H1 names, with a trailing slash, or the empty string when it names none.
 *
 * Only the body's FIRST H1 is the heading: a `# Working in` line quoted inside a code fence, or a later one, is
 * prose, and reading it would let a file claim a tree its real heading does not name. The body is RENDERED by
 * micromark, the CommonMark parser the tree already uses, rather than scanned line by line: what counts as a
 * fence, a list-nested fence or an ATX heading is the parser's decision, and a hand scanner reached that
 * answer only one review counterexample at a time.
 *
 * @param content the rule file's full text
 * @returns the tree, or `""` when the heading does not match the shipped grammar
 */
function declaredHeading({ content }: { content: string }): string {
  const html = micromark(splitFrontMatter({ content }).body);
  // micromark draws an ATX or setext H1 as a bare `<h1>`, and an H1 cannot nest, so the first close ends it.
  const open = html.indexOf("<h1>");
  if (open === -1) {
    return "";
  }
  const heading = html.slice(open + "<h1>".length, html.indexOf("</h1>", open));
  const match = /^Working in <code>(src\/[^<]+?)\/?<\/code>$/.exec(heading);
  if (match === null) {
    return "";
  }
  const tree = match[1];
  if (tree === undefined) {
    return "";
  }
  // micromark escapes exactly these four in text; `&amp;` goes last so `&amp;lt;` stays the literal `&lt;`.
  const unescaped = tree
    .replaceAll("&quot;", '"')
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
  return `${unescaped}/`;
}

/**
 * Every glob under the TOP-LEVEL `paths:` key of the FRONTMATTER, in file order.
 *
 * Frontmatter only, through the same `splitFrontMatter` that `isPathScoped` reads, so the two checks can
 * never disagree about whether a file is scoped: a `paths:` in the body is prose to Claude Code and is prose
 * here. Top-level because an indented `paths:` belongs to something else and scopes nothing.
 *
 * @param content the rule file's full text
 * @returns the declared globs, empty when there is no such block
 */
function declaredGlobs({ content }: { content: string }): readonly string[] {
  // Parsed by `yaml`, the parser the tree already uses, so quoting, comments and sequence styles are the
  // parser's decision; a hand scanner reached that answer only one review counterexample at a time.
  const document = parseDocument(splitFrontMatter({ content }).frontMatter.join("\n"));
  if (document.errors.length > 0) {
    // An unparseable frontmatter scopes nothing, which `areaRuleIssues` reports as a missing `paths:` block.
    return [];
  }
  // The `paths` node alone, never `toJS()` on the whole document: that walks every unrelated key and throws
  // on yaml's alias-count limit, so a sibling key could make a well-scoped rule unreadable.
  const paths = document.get("paths", true);
  if (!isSeq(paths)) {
    return [];
  }
  return paths.items.flatMap((item) => (isScalar(item) && typeof item.value === "string" ? [item.value] : []));
}

/**
 * Every way one area rule disagrees with itself, as display strings.
 *
 * A list rather than a typed union on purpose: the whole point is the MULTIPLICITY — a file can name no tree
 * AND carry a glob pointing somewhere else — and one discriminated error would lose it. Nothing branches on
 * these; they are read by a person looking at a failed assertion.
 *
 * The test is that SOME glob covers the heading's tree, not that every one does. A subsystem whose CLI verbs
 * live elsewhere legitimately reaches for a second glob — `area-handover.md` adds
 * `src/cli/commands/handover/**` — and that is coverage rather than drift. What stays caught is the failure
 * this exists for: a rule whose globs miss its own subject entirely.
 *
 * @param doc the rule file, as read off disk
 * @returns one string per disagreement, empty when the file agrees with itself
 */
export function areaRuleIssues({ doc }: { doc: AreaRuleDoc }): readonly string[] {
  const { globs, heading } = areaRuleScope({ content: doc.content });
  const issues: string[] = [];
  if (heading === "") {
    issues.push(`${doc.path}: no \`# Working in \`src/<tree>/\`\` heading, so it names no subject`);
  }
  if (globs.length === 0) {
    issues.push(`${doc.path}: no top-level \`paths:\` block, so it would load into every session`);
  }
  if (heading === "" || globs.length === 0) {
    return issues;
  }
  if (!globs.some((glob) => glob.startsWith(heading))) {
    issues.push(
      `${doc.path}: scoped to ${globs.map((glob) => `\`${glob}\``).join(", ")}, none of which covers the ` +
        `\`${heading}\` its heading names`,
    );
  }
  return issues;
}

/**
 * The area rules in a set of tracked rule paths, in path order.
 *
 * Discovered from the tree rather than listed, so a new one lands inside every check here the moment it is
 * committed — a literal list is what left `AGENTS.md`'s own `@` imports uncounted.
 *
 * @param paths every `.claude/rules/*.md` path
 * @returns the subset that are area rules
 */
export function areaRulePaths({ paths }: { paths: readonly string[] }): readonly string[] {
  return paths.filter((path) => /^\.claude\/rules\/area-[^/]+\.md$/.test(path)).toSorted();
}
