/**
 * What a Codex session is handed at start so it holds the same always-on rules a Claude session does.
 *
 * The rules stay in
 * `.claude/rules/`, and a Codex-only plugin `SessionStart` hook injects them. Claude Code reaches them through
 * `AGENTS.md`'s `@` imports and by loading every rule with no `paths:`; Codex reads `AGENTS.md` natively but
 * expands no import and reads no `.claude/rules/` at all. MEASURED (codex-cli 0.157.1):
 * `codex debug prompt-input | grep -c 'Universal named-object params'` printed 0.
 *
 * The set is the one {@link alwaysOnPaths} discovers, so a rule Claude loads is a rule Codex gets and the list
 * lives in one place. Two differences, each deliberate:
 *
 * - **The unscoped rules are DISCOVERED from the checkout the session stands in**, not taken from this build's
 *   `UNSCOPED_RULES`. The hook runs from the plugin mirror while the session edits a worktree, and a branch that
 *   adds or scopes a rule must be read as that branch has it — which is what Claude does.
 * - **The entry document is dropped.** Codex already reads `AGENTS.md`; printing it again would be a second copy.
 */
import { alwaysOnPaths, isPathScoped } from "../canon/alwaysOnDocs.js";

/** One rule file as it will be injected: its repo-relative path, and its text or `undefined` when unreadable. */
export interface CodexRulesDocument {
  readonly path: string;
  readonly content: string | undefined;
}

/**
 * The documents a Codex session needs beyond the entry it already reads: everything the entry `@`-imports,
 * transitively, and every rule file that carries no `paths:` frontmatter. Pure — reading is the caller's seam.
 *
 * @param entry the instructions file the host reads natively, `AGENTS.md` here
 * @param readDoc reads one repo-relative path, `undefined` when it is absent or unreadable
 * @param ruleFiles every `.claude/rules/*.md` path in the checkout, scoped or not
 * @returns each document once, in the order a Claude session receives them, the entry excluded
 */
export function codexRulesDocuments({
  entry,
  readDoc,
  ruleFiles,
}: {
  entry: string;
  readDoc: (args: { path: string }) => string | undefined;
  ruleFiles: readonly string[];
}): readonly CodexRulesDocument[] {
  const unscopedRules = [...ruleFiles].toSorted().filter((path) => {
    const content = readDoc({ path });
    return content !== undefined && !isPathScoped({ content });
  });
  return alwaysOnPaths({ entry, readDoc, unscopedRules })
    .filter((path) => path !== entry)
    .map((path) => ({ content: readDoc({ path }), path }));
}

/**
 * The injected text: a short preamble naming what this is, then every document under a heading carrying its
 * path. A document that could not be read is NAMED rather than dropped, so a dangling import shows up in the
 * session rather than as a rule that quietly never arrived.
 *
 * @param documents what {@link codexRulesDocuments} selected
 * @returns the lines to hand the host as `additionalContext`, empty when there is nothing to inject
 */
export function renderCodexRulesContext({
  documents,
}: {
  documents: readonly CodexRulesDocument[];
}): readonly string[] {
  if (documents.length === 0) {
    return [];
  }
  const lines: string[] = [
    "# Always-on rules for this repository",
    "",
    `Claude Code loads these ${documents.length} files at launch through AGENTS.md's @ imports and unscoped ` +
      "`.claude/rules/`; Codex expands neither, so the Slopweaver plugin injects them here. They are binding " +
      "exactly as AGENTS.md is.",
  ];
  for (const document of documents) {
    lines.push("", `<!-- file: ${document.path} -->`, "");
    if (document.content === undefined) {
      lines.push(`(${document.path} could not be read from this checkout — open it before writing code.)`);
      continue;
    }
    lines.push(document.content.trimEnd());
  }
  return lines;
}
