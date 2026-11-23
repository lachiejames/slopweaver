/**
 * The KIND labels a pull request carries, derived from its conventional-commit title and nothing else.
 *
 * A reader scanning the pull-request list sees what kind of change each one is without opening it, and the label
 * is computed rather than chosen, so two sessions never label the same kind of change two ways. The mapping:
 *
 * - `fix` → `bug fix`; `feat` → `feature`; `refactor` and `perf` → `refactor`; `test` → `tests`; `docs` → `docs`;
 * - `build`, `chore`, `ci`, `dx`, `style` and `revert` → `maintenance`;
 * - a `deps` or `dependencies` scope → `dependencies`, in place of `maintenance`;
 * - a `security` scope adds `security` beside whatever the type gave.
 *
 * A title with no recognised type yields no label: the title-shape check (`./titleShape.ts`) owns refusing a title,
 * and this module never guesses a kind for one.
 */

/** The label each conventional-commit type maps to. */
const TYPE_LABELS: Readonly<Record<string, string>> = {
  build: "maintenance",
  chore: "maintenance",
  ci: "maintenance",
  docs: "docs",
  dx: "maintenance",
  feat: "feature",
  fix: "bug fix",
  perf: "refactor",
  refactor: "refactor",
  revert: "maintenance",
  style: "maintenance",
  test: "tests",
};

/** The scopes that make a change a dependency change. */
const DEPENDENCY_SCOPES: ReadonlySet<string> = new Set(["deps", "dependencies"]);

/** A conventional-commit title's head: `type(scope)!: `, the scope and the bang optional. */
const TITLE_HEAD = /^([a-z]+)(?:\(([^)]*)\))?!?: /;

/**
 * Every kind label this repository derives for a title.
 *
 * @param title the pull request's title
 * @returns the labels, in a stable order (the type's label first, then `security`), or none for an unrecognised type
 */
export function kindLabelsForTitle({ title }: { title: string }): readonly string[] {
  const head = TITLE_HEAD.exec(title.trimStart());
  if (head === null) {
    return [];
  }
  const typeLabel = TYPE_LABELS[head[1]!];
  if (typeLabel === undefined) {
    return [];
  }
  // An absent scope group reads as no scopes: the destructuring default says so at the read.
  const [, , scopeList = ""] = head;
  const scopes = scopeList
    .split(",")
    .map((scope) => scope.trim().toLowerCase())
    .filter((scope) => scope.length > 0);
  const dependency = scopes.some((scope) => DEPENDENCY_SCOPES.has(scope));
  const base = dependency && typeLabel === "maintenance" ? "dependencies" : typeLabel;
  return scopes.includes("security") ? [base, "security"] : [base];
}

/**
 * The kind labels a pull request is missing, given the labels it carries.
 *
 * @param title the pull request's title
 * @param labels the labels it carries now
 * @returns each derived label it lacks, in derivation order
 */
export function missingKindLabels({ title, labels }: { title: string; labels: readonly string[] }): readonly string[] {
  return kindLabelsForTitle({ title }).filter((label) => !labels.includes(label));
}
