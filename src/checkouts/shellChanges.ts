/**
 * Which of the upstream's newest commits change the desktop app, and which change the console page or its voice —
 * the two ways a landing reaches what the owner sees. The shell's commits are the ones a RUNNING app can be missing, since
 * the app is rebuilt only by `slopweaver desktop install`, never on a landing; the console's are what the release
 * notes call "in the app". Pure but for {@link markMainlinePathChanges}, which runs both `git log`s through an
 * injected seam; `./consoleBuildRead.ts` calls it once the mainline window is read.
 */
import type { ConsoleCommit } from "./consoleBuild.js";
import type { ConsoleBuildDeps } from "./consoleBuildDeps.js";

/** A full commit sha. */
const SHA = /^[0-9a-f]{40}$/u;

/**
 * What the desktop app is built from: `desktop/package.json`'s `build.files` (assets, the compiled `build/`, the
 * manifest) and what compiles them. Its README and its tests are not here — a commit touching only those leaves the
 * installed app exactly right.
 */
export const SHELL_PATHSPEC: readonly string[] = [
  "desktop/src/",
  "desktop/assets/",
  "desktop/package.json",
  "desktop/yarn.lock",
  "desktop/tsconfig.json",
  "desktop/.yarnrc.yml",
];

/**
 * What the console the owner uses inside the app is built from, and the voice it talks through: the site, less its tests,
 * its docs pages and the diagrams only those pages draw; plus the talk runtime the site's `api/talk` routes run. A path-based
 * signal rather than a dependency closure — a change only to a module `src/talk/` imports is not caught.
 */
export const CONSOLE_PATHSPEC: readonly string[] = [
  "site/",
  "src/talk/",
  "src/cli/commands/talk/",
  ":(exclude)site/__tests__/",
  ":(exclude)site/app/(docs)/",
  ":(exclude)site/components/diagrams/",
  ":(exclude)site/content/",
  ":(exclude)site/fixtures/",
  ":(exclude)site/AGENTS.md",
];

/** Which flag on a {@link ConsoleCommit} a path read answers. */
export type PathChangeField = "changesConsole" | "changesShell";

/**
 * The `git log` arguments naming which of the mainline window's commits touch a pathspec. Bounded to the window
 * itself — `-n` with a pathspec would walk back to the Nth commit TOUCHING the paths, far past the window. A window
 * that is the whole history (not truncated) has no `~limit` to name, so it is the tip alone.
 *
 * @param sha the upstream tip the mainline was read from
 * @param truncated whether older commits exist beyond the window
 * @param limit the window's size, `MAINLINE_LIMIT`
 * @param pathspec {@link SHELL_PATHSPEC} or {@link CONSOLE_PATHSPEC}
 * @returns the arguments after `git`
 */
export function pathChangeLogArgs({
  sha,
  truncated,
  limit,
  pathspec,
}: {
  sha: string;
  truncated: boolean;
  limit: number;
  pathspec: readonly string[];
}): readonly string[] {
  let range = sha;
  if (truncated) {
    range = `${sha}~${String(limit)}..${sha}`;
  }
  return ["log", "--first-parent", "--format=%H", range, "--", ...pathspec];
}

/**
 * Decode a `--format=%H` log: one full sha per line.
 *
 * @param text the log's stdout
 * @returns the shas, empty for empty output, or `undefined` when any line is not a sha
 */
export function parseShaLines({ text }: { text: string }): ReadonlySet<string> | undefined {
  const shas = new Set<string>();
  for (const line of text.split("\n")) {
    if (line === "") {
      continue;
    }
    if (!SHA.test(line)) {
      return undefined;
    }
    shas.add(line);
  }
  return shas;
}

/**
 * Mark each mainline commit with whether it touches one pathspec, leaving the other flag as it was.
 *
 * @param commits the mainline, newest first
 * @param changing the window's commits that touch the paths, or `undefined` when they could not be read
 * @param field which flag this read answers
 * @returns the same commits with that flag set — or left as they were throughout when nothing was read
 */
export function withPathChanges({
  commits,
  changing,
  field,
}: {
  commits: readonly ConsoleCommit[];
  changing: ReadonlySet<string> | undefined;
  field: PathChangeField;
}): readonly ConsoleCommit[] {
  if (changing === undefined) {
    return commits;
  }
  return commits.map((commit) => ({ ...commit, [field]: changing.has(commit.sha) }));
}

/** The mainline window's commits, each marked with whether it touches one pathspec — unread when that fails. */
function markPathChanges({
  commits,
  deps,
  field,
  limit,
  pathspec,
  problem,
  problems,
  root,
  sha,
  truncated,
}: {
  commits: readonly ConsoleCommit[];
  deps: Pick<ConsoleBuildDeps, "git">;
  field: PathChangeField;
  limit: number;
  pathspec: readonly string[];
  /** The sentence a failed read adds to the report's problems. */
  problem: string;
  problems: string[];
  root: string;
  sha: string;
  truncated: boolean;
}): readonly ConsoleCommit[] {
  const log = deps.git({ args: pathChangeLogArgs({ limit, pathspec, sha, truncated }), cwd: root });
  const changing = log === undefined ? undefined : parseShaLines({ text: log });
  if (changing === undefined) {
    problems.push(problem);
  }
  return withPathChanges({ changing, commits, field });
}

/**
 * Mark the mainline window with both path flags. Two independent reads: one failing leaves its own flag unknown,
 * names itself in `problems`, and never erases the other's answer.
 *
 * @param commits the mainline window, newest first, both flags unread
 * @param ref the upstream's name, for the problem sentences
 * @param sha the upstream tip the window was read from
 * @param truncated whether older commits exist beyond the window
 * @param limit the window's size, `MAINLINE_LIMIT`
 * @param problems collects each read that failed
 * @returns the same commits with every flag that could be read set
 */
export function markMainlinePathChanges({
  commits,
  deps,
  limit,
  problems,
  ref,
  root,
  sha,
  truncated,
}: {
  commits: readonly ConsoleCommit[];
  deps: Pick<ConsoleBuildDeps, "git">;
  limit: number;
  problems: string[];
  ref: string;
  root: string;
  sha: string;
  truncated: boolean;
}): readonly ConsoleCommit[] {
  const window = { deps, limit, problems, root, sha, truncated };
  const shell = markPathChanges({
    ...window,
    commits,
    field: "changesShell",
    pathspec: SHELL_PATHSPEC,
    problem: `which of ${ref}'s commits change the desktop app could not be read`,
  });
  return markPathChanges({
    ...window,
    commits: shell,
    field: "changesConsole",
    pathspec: CONSOLE_PATHSPEC,
    problem: `which of ${ref}'s commits change the console or its voice could not be read`,
  });
}
