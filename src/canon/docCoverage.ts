/**
 * The DOC-COVERAGE sweep — catches a verb, a gate, a hook, a `src/` subsystem or a `SLOPWEAVER_*` name that
 * exists in the code and is named by no document anywhere.
 *
 * ## The defect this exists for
 *
 * Every new session starts from the documents it can find. Anything the program does that no document
 * names is therefore an unknown unknown to every session, forever: not a thing a session decides against,
 * a thing it never learns is there. `staleReferences.ts` is the mirror of this — it catches a doc naming
 * code that no longer exists. This catches code that no doc has ever named.
 *
 * ## What "named" means, and what it deliberately does not mean
 *
 * Exactly one thing: the literal reference shape for that item appears in at least one document in the
 * corpus ({@link isCoverageDocPath}). It does not prove the document is accurate, current, or that it
 * describes the item rather than mentioning it in passing. A floor, not a quality bar — a quality bar
 * cannot be machine-checked, and a gate that claims one is worse than a gate that claims a floor.
 *
 * The reference shape is per kind, and is narrow on purpose (see {@link referencePattern}). A CLI noun
 * must be named as an invocation, never as the bare English word — `route`, `memory`, `proof` and `pane`
 * are all ordinary prose in this repository, and matching those would report full coverage while every
 * verb stayed undescribed.
 *
 * Pure throughout: every filesystem and git edge is a caller-supplied seam, so this module is unit-tested
 * on inline fixtures and never reads a real file. The test that ratchets the real tree does the reading.
 */

/** The kinds of thing this sweep holds to a documentation floor. */
type CoverageKind = "cli-noun" | "hook" | "lint-gate" | "slopweaver-name" | "src-directory";

/** One inventory item, as enumerated from the code. */
export interface CoverageItem {
  readonly kind: CoverageKind;
  /** The bare name — a noun (`atlas`), a gate name (`no-headless`), a filename, a directory, a variable. */
  readonly name: string;
}

/** A regex-special character, escaped so a name is matched literally. */
const REGEX_SPECIAL = /[.*+?^${}()|[\]\\]/g;

/** Escape a name for literal use inside a pattern. */
function literal({ text }: { text: string }): string {
  return text.replace(REGEX_SPECIAL, "\\$&");
}

/**
 * Whether a document in the canon corpus is one this sweep reads.
 *
 * Wider than {@link ./staleReferences.isCanonPath}: `README.md` counts here. That file is human-facing and
 * is never loaded as instructions, but it is the first thing a person or an agent opens, so a subsystem
 * described only there is still discoverable — which is the whole property being defended.
 *
 * A skill's `reference/*.md` files count for the same reason its `SKILL.md` does: under the 200-line agent-doc
 * cap a body keeps the rule and its bundled reference keeps the procedure, so an item named only in the
 * reference is exactly as discoverable as one named in the body — an agent that reads the body is told to
 * open it.
 *
 * @param path the repo-relative path
 * @returns true when the file counts as documentation for coverage purposes
 */
export function isCoverageDocPath({ path }: { path: string }): boolean {
  if (path === "AGENTS.md" || path === "README.md") {
    return true;
  }
  if (path.startsWith(".claude/rules/") && path.endsWith(".md")) {
    return true;
  }
  if (/^skills\/[^/]+\/SKILL\.md$/.test(path) || /^skills\/[^/]+\/reference\/[^/]+\.md$/.test(path)) {
    return true;
  }
  return path.startsWith("docs/") && path.endsWith(".md");
}

/**
 * The literal shape a document must contain for this item to count as named.
 *
 * - **`cli-noun`** — the noun immediately after `slopweaver`, allowing the quote or backtick a bundled
 *   launcher path ends with (`"…/bin/slopweaver" facts`), which is how every `SKILL.md` writes it.
 * - **`src-directory`** — the repo-relative directory path, so a mention has to point at the code.
 * - **`lint-gate`** — the gate's registered name, which is unique enough to stand alone.
 * - **`hook`** — the `hooks/`-rooted path, for the same reason as a source directory.
 * - **`slopweaver-name`** — the `SLOPWEAVER_*` name, which cannot collide with prose.
 *
 * @param item the inventory item
 * @returns the pattern a document is searched with
 */
export function referencePattern({ item }: { item: CoverageItem }): RegExp {
  const name = literal({ text: item.name });
  switch (item.kind) {
    case "cli-noun":
      return new RegExp(`slopweaver["'\`]?\\s+${name}\\b`);
    case "src-directory":
      return new RegExp(`src/${name}\\b`);
    case "lint-gate":
      return new RegExp(`\\b${name}\\b`);
    case "hook":
      return new RegExp(`hooks/${name}`);
    case "slopweaver-name":
      return new RegExp(`\\b${name}\\b`);
  }
}

/**
 * Every inventory item no document in the corpus names.
 *
 * @param items the enumerated inventory
 * @param docs the text of every coverage document
 * @returns the unnamed items, input order preserved
 */
export function undocumentedItems({
  items,
  docs,
}: {
  items: readonly CoverageItem[];
  docs: readonly string[];
}): readonly CoverageItem[] {
  return items.filter((item) => {
    const pattern = referencePattern({ item });
    return !docs.some((text) => pattern.test(text));
  });
}

/** A registered `dev lint` check name, as written in the plan. */
const LINT_CHECK_NAME = /name: "([a-z][a-z0-9-]*)"/g;

/**
 * Every gate name the lint plan registers, read from the plan's own source text.
 *
 * Read from text rather than by calling `lintChecks()` because the plan resolves binary paths against a
 * working directory and this module stays pure — and because the name is the thing being inventoried, not
 * the spawn.
 *
 * A LIST of sources, like `slopweaverNamesFrom` below, because the registry is not one file. It was, until
 * the 300-code-line cap forced `devLint.ts` to hand its group functions to
 * `gateGroups.ts`; reading one path reported ZERO gates the moment that landed, and a caller taking the
 * count at face value would have read an empty inventory as full coverage. Pass every file that declares
 * a check rather than the one that happens to hold most of them today.
 *
 * @param sources the text of each file declaring registry entries — today `devLint.ts` and `gateGroups.ts`
 * @returns the registered check names, deduplicated and sorted
 */
export function lintGateNamesFrom({ sources }: { sources: readonly string[] }): readonly string[] {
  const names = new Set<string>();
  for (const source of sources) {
    for (const match of source.matchAll(LINT_CHECK_NAME)) {
      names.add(match[1]!);
    }
  }
  return [...names].toSorted();
}

/** A `SLOPWEAVER_*` name written as a string literal — the only shape that gives one meaning in the code. */
const SLOPWEAVER_LITERAL = /"(SLOPWEAVER_[A-Z0-9_]+)"/g;

/**
 * Every `SLOPWEAVER_*` name the shipped program gives meaning to, from the source text of the files that
 * declare it — environment variables AND the stdout markers a caller greps a live session for.
 *
 * Both, rather than variables alone, because the shapes are not separable mechanically: a variable is read
 * through `process.env[X]`, `env[X]`, `deps.env({ name: X })` and `Object.getOwnPropertyDescriptor(env, X)`
 * in this repository already, so a reader-shape scan reports a shrinking, arbitrary subset. Both kinds are
 * the same class of unknown unknown anyway — a name the code acts on that no document mentions.
 *
 * A STRING LITERAL, never a bare mention: measured on this tree, scanning bare mentions reported
 * `SLOPWEAVER_ALLOW_REMOTE_AHEAD` as live when the only text naming it is a doc comment explaining that no
 * such override exists. A prose name in a comment is a claim; a literal is the key.
 *
 * @param sources the text of each non-test `.ts` file in scope
 * @returns the names, deduplicated and sorted
 */
export function slopweaverNamesFrom({ sources }: { sources: readonly string[] }): readonly string[] {
  const names = new Set<string>();
  for (const source of sources) {
    for (const match of source.matchAll(SLOPWEAVER_LITERAL)) {
      names.add(match[1]!);
    }
  }
  return [...names].toSorted();
}

/**
 * Every top-level directory under `src/`, from the tracked file list.
 *
 * `__tests__` is excluded: it is the test tree, governed by `.claude/rules/testing.md`, not a subsystem a
 * session needs a description of.
 *
 * @param paths every repo-relative path
 * @returns the directory names, deduplicated and sorted
 */
export function srcDirectoriesFrom({ paths }: { paths: readonly string[] }): readonly string[] {
  const directories = new Set<string>();
  for (const path of paths) {
    const match = /^src\/([^/]+)\//.exec(path);
    if (match !== null && match[1] !== "__tests__") {
      directories.add(match[1]!);
    }
  }
  return [...directories].toSorted();
}

/**
 * Every hook file, from the tracked file list — the executables the harness invokes, not their helpers.
 *
 * `hooks/lib/` is excluded: it holds shared shell functions the hooks source, which no session invokes and
 * which are described by the hook that uses them.
 *
 * @param paths every repo-relative path
 * @returns the hook filenames, sorted
 */
export function hookNamesFrom({ paths }: { paths: readonly string[] }): readonly string[] {
  return paths
    .filter((path) => /^hooks\/[^/]+\.(ts|sh|json)$/.test(path))
    .map((path) => path.slice("hooks/".length))
    .toSorted();
}

/**
 * The failure report — one line per unnamed item, grouped by kind, in a shape a reader can paste into a
 * grep. Kept here rather than in the test so the wording is unit-tested alongside the sweep.
 *
 * @param items the unnamed items
 * @returns the report text, empty when nothing is unnamed
 */
export function formatUndocumented({ items }: { items: readonly CoverageItem[] }): string {
  if (items.length === 0) {
    return "";
  }
  const kinds = [...new Set(items.map((item) => item.kind))];
  return kinds
    .map((kind) => {
      const names = items.filter((item) => item.kind === kind).map((item) => item.name);
      return `${kind}: ${names.join(" ")}`;
    })
    .join("\n");
}
