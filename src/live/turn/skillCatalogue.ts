/**
 * DISCOVERING the skills a dispatched worker could load — the I/O edge under `./skillRouting.ts`'s pure
 * ranking.
 *
 * ## Where it looks, and why that is the whole list
 *
 * Two roots, both already declared elsewhere rather than configured again here:
 *
 * - **this build's own `skills/`**, from the repository root the process is running out of. These are the
 *   `slopweaver:*` skills; a Claude Code worker already sees their one-line descriptions, so listing them
 *   costs little and makes the ranked list honest about what it chose between.
 * - **every main checkout `profile.json` declares**, at `.agents/skills/<name>/SKILL.md` and
 *   `.claude/skills/<name>/SKILL.md`. This is the half that matters: a dispatched worker's cwd is the loop's own
 *   checkout (`./askSessionPlan.ts` plans the CURRENT checkout, never a new worktree), so ANOTHER
 *   repository's skills are not in its context at all — nothing but this list will ever mention them.
 *
 * Reusing `profileStore.ts`'s register is the same choice `../../admit/declaredMainCheckouts.ts` made and
 * for the same reason: no new configuration surface, and no absolute home path in this repository's source.
 * On a real machine those two directories are commonly the same place behind a symlink, so entries are
 * deduplicated by the skill's own `name` — first root wins, and this build's own skills are read first so a
 * checkout cannot shadow one of them.
 *
 * ## Fails soft, everywhere
 *
 * Every read is best-effort. An unreadable root, a skill directory with no `SKILL.md`, a `SKILL.md` with no
 * frontmatter or no `description:` — each is skipped, never thrown. This feeds a brief: a worker that gets a
 * shorter list is mildly worse off, while one whose dispatch dies because a checkout was mid-rebase is a
 * turn that never happens. `skillRoutingLines` states an empty catalogue out loud rather than rendering
 * nothing, so a total discovery failure is visible instead of silent.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { splitFrontMatter } from "../../canon/alwaysOnDocs.js";
import { mainCheckoutsFromProfile } from "../../profileStore.js";
import type { CatalogueSkill } from "./skillRouting.js";

/** Where a checkout may keep its own skills, relative to its root. Both, because one is often a symlink to the other. */
const CHECKOUT_SKILL_DIRS: readonly string[] = [".agents/skills", ".claude/skills"];

/** A `description:` longer than this is trimmed for the brief — the first sentences carry the routing signal. */
const DESCRIPTION_MAX = 400;

/**
 * Read one scalar field out of a skill's frontmatter lines.
 *
 * Deliberately not a YAML parser: a `SKILL.md` frontmatter is two or three flat scalars, and pulling in a
 * parser to read them would be a dependency whose failure modes exceed the thing it reads. A quoted value
 * has its quotes stripped; anything else is taken verbatim.
 *
 * @param field the key to read, without its colon
 * @param frontMatter the lines between the fences
 * @returns the value, or `undefined` when the key is absent or empty
 */
function frontMatterField({
  field,
  frontMatter,
}: {
  field: string;
  frontMatter: readonly string[];
}): string | undefined {
  const prefix = `${field}:`;
  for (const line of frontMatter) {
    if (!line.startsWith(prefix)) {
      continue;
    }
    const raw = line.slice(prefix.length).trim();
    const unquoted = raw.replace(/^["']/, "").replace(/["']$/, "").trim();
    return unquoted.length === 0 ? undefined : unquoted;
  }
  return undefined;
}

/**
 * Parse one `SKILL.md`'s text into a catalogue entry.
 *
 * Pure, and exported so a test can assert the parse without a filesystem. A skill with no `name:` or no
 * `description:` is not an entry: the ranking has nothing to score and a brief line naming it would tell a
 * worker nothing it could act on.
 *
 * @param content the file's full text
 * @param path where it was found, as the entry should render it
 * @returns the entry, or `undefined` when the frontmatter does not describe a skill
 *
 * @internal — exported so a test can assert the frontmatter parse without a filesystem.
 */
export function parseCatalogueSkill({ content, path }: { content: string; path: string }): CatalogueSkill | undefined {
  const { frontMatter } = splitFrontMatter({ content });
  const name = frontMatterField({ field: "name", frontMatter });
  const description = frontMatterField({ field: "description", frontMatter });
  if (name === undefined || description === undefined) {
    return undefined;
  }
  return { description: description.slice(0, DESCRIPTION_MAX), name, path };
}

/**
 * Every skill directly under one skills root, in directory order.
 *
 * @param root an absolute path that may or may not exist
 * @returns the entries found there; empty when the root is missing, unreadable or holds no parseable skill
 */
function skillsUnder({ root }: { root: string }): readonly CatalogueSkill[] {
  let entries: readonly string[];
  try {
    entries = readdirSync(root).toSorted();
  } catch {
    return [];
  }
  const skills: CatalogueSkill[] = [];
  for (const entry of entries) {
    const path = join(root, entry, "SKILL.md");
    let content: string;
    try {
      content = readFileSync(path, "utf8");
    } catch {
      continue;
    }
    const skill = parseCatalogueSkill({ content, path });
    if (skill !== undefined) {
      skills.push(skill);
    }
  }
  return skills;
}

/**
 * The whole catalogue a dispatched worker could load from: this build's own skills first, then every
 * declared main checkout's, deduplicated by skill name.
 *
 * @param home the state home holding `profile.json`, whose `mainCheckouts` name the other roots
 * @param repoRoot this build's own repository root, holding `skills/`
 * @returns the catalogue, this build's own entries first
 */
export function availableSkills({ home, repoRoot }: { home: string; repoRoot: string }): readonly CatalogueSkill[] {
  const roots = [join(repoRoot, "skills")];
  for (const checkout of mainCheckoutsFromProfile({ home })) {
    for (const dir of CHECKOUT_SKILL_DIRS) {
      roots.push(join(checkout.path, dir));
    }
  }
  const byName = new Map<string, CatalogueSkill>();
  for (const root of roots) {
    for (const skill of skillsUnder({ root })) {
      if (!byName.has(skill.name)) {
        byName.set(skill.name, skill);
      }
    }
  }
  return [...byName.values()];
}
