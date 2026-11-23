/**
 * The effectful half of CHECK 5 — everything in this repository that already enforces something, read off disk
 * and handed to `./enforcement.ts`'s pure matcher.
 *
 * ## What counts, and the `paths:` frontmatter is the whole distinction
 *
 * An always-on doc reaches EVERY session, so a memory restating one changes nothing. A `paths:`-scoped rule
 * reaches a session only when it touches matching files, so a memory covering the same ground genuinely does
 * change behaviour everywhere else — {@link classifyRule} is what separates them, and it separates them by
 * reading the frontmatter rather than by a list of filenames, because the scoping is a property of the file.
 * `docs/agent-docs-practice.md` § the directory axis is where that convention is written down.
 *
 * A scoped rule is still returned, classified `scoped-rule`, rather than being dropped. `./refute.ts` refutes a
 * match against one, so the card SAYS that a memory overlaps a scoped rule and that this is why it stands. A
 * filter here would have produced the same recommendation with none of the reasoning visible.
 *
 * ## A lint gate's text is its own DECLARATION, never its source
 *
 * `../../devLint/refusal/declarations.ts` already carries, per gate, what it caught and why plus the
 * correction — which is exactly the prose a memory restating the gate would use. Reading a gate's
 * implementation instead would match on TypeScript identifiers and find nothing.
 *
 * ## A skill is an enforcer of a TECHNIQUE
 *
 * The strictness bar says a technique belongs in a skill rather than in a memory, so a memory whose
 * description matches a `SKILL.md` is a memory that ought to be that skill's content. Only the front matter and
 * the first section are read: a skill is hundreds of lines of procedure, and matching against all of it would
 * pair every memory with every skill on shared vocabulary.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { LINT_GATE_DECLARATIONS } from "../../devLint/refusal/declarations.js";
import { err, ok, type Result } from "../../lib/result.js";
import { safeFs } from "../../lib/safeBoundary.js";
import type { Enforcer, EnforcerKind } from "./enforcement.js";

/**
 * The always-on docs at the repository root, in load order.
 *
 * Named rather than globbed: these two are the always-on set by doctrine, and a glob over root markdown would
 * pull in a README and call it an enforcer.
 *
 * @internal
 */
export const ROOT_ALWAYS_ON_DOCS: readonly string[] = ["AGENTS.md", "CLAUDE.md"];

/** Where the rule files live, relative to the repository root. */
const RULES_DIR = join(".claude", "rules");

/** Where the skills live, relative to the repository root. */
const SKILLS_DIR = "skills";

/**
 * How much of a `SKILL.md` is read. Its frontmatter and opening section — see this module's header.
 *
 * @internal
 */
export const SKILL_HEAD_LINES = 40;

/**
 * Whether a rule file is always-on or `paths:`-scoped, decided from its frontmatter.
 *
 * Only the leading frontmatter block is examined. A `paths:` written in the body is prose about scoping rather
 * than scoping, and treating it as the latter would misclassify the rule that DOCUMENTS the convention.
 *
 * @param text the rule file's contents
 * @returns which kind of enforcer it is
 */
export function classifyRule({ text }: { text: string }): EnforcerKind {
  const lines = text.split("\n");
  if (lines[0] !== "---") {
    return "always-on-doc";
  }
  const close = lines.indexOf("---", 1);
  if (close === -1) {
    return "always-on-doc";
  }
  const frontmatter = lines.slice(1, close);
  return frontmatter.some((line) => line.startsWith("paths:")) ? "scoped-rule" : "always-on-doc";
}

/** Read one file, or nothing when it is not there — an absent optional doc is not a fault. */
function readIfPresent({ path }: { path: string }): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}

/** Every entry of a directory, or an empty list when the directory is absent. */
function entriesOf({ dir }: { dir: string }): readonly string[] {
  try {
    return readdirSync(dir).toSorted();
  } catch {
    return [];
  }
}

/** The always-on docs and the rule files, each classified by its own frontmatter. */
function docEnforcers({ repo }: { repo: string }): readonly Enforcer[] {
  const roots = ROOT_ALWAYS_ON_DOCS.flatMap((name): readonly Enforcer[] => {
    const text = readIfPresent({ path: join(repo, name) });
    if (text === undefined) {
      return [];
    }
    return [{ id: name, kind: "always-on-doc", text }];
  });
  const rules = entriesOf({ dir: join(repo, RULES_DIR) }).flatMap((name): readonly Enforcer[] => {
    if (!name.endsWith(".md")) {
      return [];
    }
    const text = readIfPresent({ path: join(repo, RULES_DIR, name) });
    if (text === undefined) {
      return [];
    }
    return [{ id: join(RULES_DIR, name), kind: classifyRule({ text }), text }];
  });
  return [...roots, ...rules];
}

/**
 * One enforcer per declared lint gate, its text being what the gate says about itself.
 *
 * Ordered by REFUSAL ID rather than by however the table happens to be written. The rows used to be one
 * alphabetical literal, so source order and id order were the same thing and nothing had to say which one
 * this function meant. Splitting the quality family into `refusal/qualityDeclarations.ts` and spreading it
 * back in separated them, and a review caught this list silently reordering as a result. Sorting
 * here makes the order a property somebody chose instead of a side effect of where a row is written.
 */
function gateEnforcers(): readonly Enforcer[] {
  return Object.entries(LINT_GATE_DECLARATIONS)
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(([, declaration]) => ({
      id: declaration.gate,
      kind: "lint-gate",
      text: `${declaration.gate} ${declaration.caught} ${declaration.correction} ${declaration.exceptions.join(" ")}`,
    }));
}

/** One enforcer per skill, reading only its head. */
function skillEnforcers({ repo }: { repo: string }): readonly Enforcer[] {
  return entriesOf({ dir: join(repo, SKILLS_DIR) }).flatMap((name): readonly Enforcer[] => {
    const path = join(repo, SKILLS_DIR, name, "SKILL.md");
    const text = readIfPresent({ path });
    if (text === undefined) {
      return [];
    }
    return [{ id: `skills/${name}`, kind: "skill", text: text.split("\n").slice(0, SKILL_HEAD_LINES).join("\n") }];
  });
}

/**
 * Read every enforcer in one repository.
 *
 * The repository root is required rather than derived, for the same reason `--dir` is: a scheduled run fires
 * from whatever directory the recipe was in, and a reader that guessed would report a clean pass over nothing.
 *
 * @param repo the absolute repository root
 * @returns every enforcer, docs first then gates then skills, or why the root could not be read
 */
export function readEnforcers({ repo }: { repo: string }): Result<readonly Enforcer[]> {
  const exists = safeFs({
    execute: (): boolean => statSync(repo).isDirectory(),
    operation: "stat repository root",
    path: repo,
  });
  if (exists.isErr()) {
    return err([exists.error.message]);
  }
  if (!exists.value) {
    return err([`--repo must name a directory: ${repo}`]);
  }
  return ok([...docEnforcers({ repo }), ...gateEnforcers(), ...skillEnforcers({ repo })]);
}
