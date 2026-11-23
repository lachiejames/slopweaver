/**
 * The effectful half of CHECK 4 — the one {@link ReferentResolver} `./referents.ts` takes as a seam, answering
 * each of its four kinds against the real trees.
 *
 * ## Each kind is resolved by asking the thing that actually knows
 *
 * - a **path** is a `stat`, and when that fails, a search for its BASENAME, so a file that moved is reported as
 *   moved rather than as gone;
 * - a **skill** is a `stat` of its `SKILL.md`, and never moved: a skill has one address;
 * - a **verb** is a lookup in `NOUN_GROUPS`, which is the verb surface itself — `slopweaver catalog` reads the
 *   same table, so a memory naming a verb that no longer exists cannot pass;
 * - a **flag** is a literal search of the tracked tree, because a flag's existence is a string in a `FlagSpec`
 *   and there is no table of every flag to consult.
 *
 * ## Why the search is `git grep`/`git ls-files` and not a directory walk
 *
 * The tracked tree is the question being asked. A walk would descend into `node_modules` and the ignored scratch
 * directories, where it would find a build artifact carrying a flag that no longer exists in source, and report
 * a dead referent as alive. It is also the difference between one process and a recursive read of a
 * `node_modules` — the same measurement that made the temp-directory sandbox a mechanism rather than a
 * convention (`.claude/rules/testing.md`).
 *
 * `git` not being present, or the root not being a repository, makes the answer `resolves` for a flag: a
 * resolver that cannot look must not report an absence it never observed. Saying a referent is fine when it
 * could not be checked is the safe direction here, because the pass PROPOSES — a false clean costs a missed
 * proposal, a false finding costs the owner's attention.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { basename, join } from "node:path";

import { verbsOfNoun } from "../../cli/nounGroups.js";
import type { Referent, ReferentResolver, ReferentVerdict } from "./referents.js";

/**
 * How long a single `git` lookup may take. A resolver that hangs would hang a scheduled run.
 *
 * @internal
 */
export const GIT_TIMEOUT_MS = 10_000;

/**
 * The exit status a `child_process` failure carries, or `null` when the process never ran at all.
 *
 * The distinction is the whole reason this function exists: a `git` missing from `PATH` throws with no status,
 * while a git that ran and said no throws with one.
 */
function exitStatusOf({ error }: { error: unknown }): number | null {
  if (typeof error !== "object" || error === null || !("status" in error)) {
    return null;
  }
  const { status } = error;
  if (typeof status !== "number") {
    return null;
  }
  return status;
}

/**
 * One `git` invocation's stdout AND its exit status, or `null` when git could not be run at all.
 *
 * The status is carried rather than collapsed because a non-zero exit is how `git grep` says "no match", and a
 * caller that cannot tell that apart from "git is not here" answers one of them with the other. MEASURED here:
 * reading every failure as "could not look" made {@link flagResolves} return true unconditionally, so CHECK 4
 * could not report a dead flag at all. Repro — the first exits 0, the second exits 1 with empty output, the
 * third exits 128:
 *
 * ```bash
 * git grep -l -F -- --json; git grep -l -F -- --no-such-flag-anywhere; (cd "$TMPDIR" && git grep -l -F -- --json)
 * ```
 */
function git({ repo, args }: { repo: string; args: readonly string[] }): { status: number; stdout: string } | null {
  try {
    const stdout = execFileSync("git", [...args], {
      cwd: repo,
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
      timeout: GIT_TIMEOUT_MS,
    });
    return { status: 0, stdout };
  } catch (error) {
    const status = exitStatusOf({ error });
    if (status === null) {
      return null;
    }
    return { status, stdout: "" };
  }
}

/** `git grep`'s exit status for "ran, and matched nothing". Every other non-zero means it could not look. */
const GIT_GREP_NO_MATCH = 1;

/** Whether a verb the memory named is still on the surface. */
function verbResolves({ text }: { text: string }): boolean {
  const [noun, verb] = text.split(" ");
  if (noun === undefined || verb === undefined) {
    return false;
  }
  const group = verbsOfNoun({ noun });
  if (group === undefined) {
    return false;
  }
  return Object.hasOwn(group, verb);
}

/** Whether a flag the memory named appears anywhere in the tracked tree. */
function flagResolves({ repo, text }: { repo: string; text: string }): boolean {
  // `--` ends git's own option parsing, and `-F` makes the pattern a literal so a flag is never read as a regex.
  const found = git({ args: ["grep", "-l", "-F", "--", text], repo });
  if (found === null) {
    return true;
  }
  if (found.status === GIT_GREP_NO_MATCH) {
    return false;
  }
  if (found.status !== 0) {
    return true;
  }
  return found.stdout.trim().length > 0;
}

/** Whether a file of the same basename stands somewhere else in the tracked tree. */
function pathMoved({ repo, text }: { repo: string; text: string }): boolean {
  const name = basename(text);
  // `ls-files` exits 0 with empty output when it matches nothing, so a non-zero status here is never a "no" —
  // it is a tree that could not be read, and an unreadable tree is no evidence that the file moved.
  const found = git({ args: ["ls-files", "--", `*/${name}`, name], repo });
  if (found === null) {
    return false;
  }
  if (found.status !== 0) {
    return false;
  }
  return found.stdout.trim().length > 0;
}

/**
 * One referent's verdict against every repository the pass was given.
 *
 * A referent resolves when ANY tree holds it. The slopweaver auto-memory directory is loaded by acme-admin
 * sessions too, and a knowledge row is recorded from either repository without saying which,
 * so a path only acme-admin holds is not gone — and the two trees share `docs/`, `.claude/` and `scripts/` at
 * their roots, so no prefix could have told them apart.
 */
function verdictOf({ repos, referent }: { repos: readonly string[]; referent: Referent }): ReferentVerdict {
  if (referent.kind === "verb") {
    return verbResolves({ text: referent.text }) ? "resolves" : "gone";
  }
  if (referent.kind === "flag") {
    return repos.some((repo) => flagResolves({ repo, text: referent.text })) ? "resolves" : "gone";
  }
  if (referent.kind === "skill") {
    // A skill IS its `SKILL.md` — a directory left holding only a `reference/` is not a skill a session can load.
    return repos.some((repo) => existsSync(join(repo, referent.text, "SKILL.md"))) ? "resolves" : "gone";
  }
  if (repos.some((repo) => existsSync(join(repo, referent.text)))) {
    return "resolves";
  }
  return repos.some((repo) => pathMoved({ repo, text: referent.text })) ? "moved" : "gone";
}

/**
 * The production resolver, bound to the repository roots every referent is resolved against.
 *
 * @param repos the absolute roots — the `--repo` checkout first, then any `--also-repo`; a referent any of them holds resolves
 * @returns a resolver `findStaleReferentsIn` can take as its seam
 */
export function treeReferentResolver({ repos }: { repos: readonly string[] }): ReferentResolver {
  return ({ referent }) => verdictOf({ referent, repos });
}
