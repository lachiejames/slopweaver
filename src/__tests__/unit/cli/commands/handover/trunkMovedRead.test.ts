/**
 * `readTrunkMoved` over a real temp checkout: the one effectful half of the trunk-moved hold, so the git argv,
 * the floor and the fail-open read are exercised against git itself rather than restated.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { readTrunkMoved } from "../../../../../cli/commands/handover/trunkMovedRead.js";
import { composeBoardModels } from "../../../../../handover/boardState.js";
import type { BoardModel } from "../../../../../handover/boardTypes.js";
import { parseHandoverDoc } from "../../../../../handover/doc.js";
import { gitInTemp, REAL_GIT_TIMEOUT_MS } from "../../../../tempGitRepo.js";

const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A fresh temp directory, removed after the test. */
function tempDir({ prefix }: { prefix: string }): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  fixtureDirs.push(dir);
  return dir;
}

/** A checkout whose `origin/main` holds one commit touching `src/a.ts`, made now. */
function checkout({ origin = "git@github.com:acme/widgets.git" }: { origin?: string } = {}): string {
  const dir = tempDir({ prefix: "trunk-moved-repo-" });
  const git = (...args: readonly string[]): string => gitInTemp({ args, cwd: dir });
  git("init", "--initial-branch=main", ".");
  git("config", "user.email", "fixture@example.invalid");
  git("config", "user.name", "Fixture");
  git("remote", "add", "origin", origin);
  mkdirSync(join(dir, "src"));
  writeFileSync(join(dir, "src", "a.ts"), "export const a = 1;\n");
  git("add", ".");
  git("commit", "-m", "Change a (#7)");
  git("update-ref", "refs/remotes/origin/main", "HEAD");
  return dir;
}

/** A RUN NOW finding row in `repo` citing `evidence` (by default `src/a.ts`), with extra front-matter lines. */
function findingModel({
  repo,
  slug,
  extra = "",
  evidence = "[src/a.ts:3]",
}: {
  repo: string;
  slug: string;
  extra?: string;
  evidence?: string;
}): BoardModel {
  const text =
    `---\nslug: ${slug}\nkind: ask\nsummary: a finding\nstatus: ready\naskedIso: 2020-01-01T00:00:00.000Z\n` +
    `origin: finding\nobservedBy: a-session\nevidence: ${evidence}\nrepo: ${repo}\n${extra}---\n\n# a finding\n`;
  const doc = parseHandoverDoc({ path: `/h/${slug}.md`, text });
  const [model] = composeBoardModels({
    journals: new Map(),
    probeStates: new Map(),
    resolutionDocs: [doc],
    roots: [doc],
  });
  return { ...model!, section: "RUN NOW" };
}

describe("readTrunkMoved", () => {
  it(
    "holds a finding whose cited file a trunk commit after its floor touched, keyed by its doc path",
    () => {
      const repo = checkout();
      const read = readTrunkMoved({ models: [findingModel({ repo, slug: "moved" })] });

      expect([...read.held.keys()]).toEqual(["/h/moved.md"]);
      expect(read.held.get("/h/moved.md")!.moves.map((move) => [move.ref, move.commits.map((c) => c.subject)])).toEqual(
        [["src/a.ts", ["Change a (#7)"]]],
      );
      expect(read.unread).toEqual([]);
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it(
    "still holds when a later tip carries an older committer date than the commit that moved the file",
    () => {
      // A plain `--since` stops walking at the first commit older than its date, so a
      // tip dated 2019 would hide the commit under it that touched the cited file after the 2020 floor.
      const repo = checkout();
      const git = (...args: readonly string[]): string => gitInTemp({ args, cwd: repo });
      writeFileSync(join(repo, "b.ts"), "export const b = 1;\n");
      git("add", ".");
      git("commit", "-m", "Change b", "--date=2019-01-01T00:00:00Z");
      git("rebase", "--committer-date-is-author-date", "HEAD~1");
      git("update-ref", "refs/remotes/origin/main", "HEAD");
      const read = readTrunkMoved({ models: [findingModel({ repo, slug: "skewed" })] });

      expect([git("log", "-1", "--format=%cI"), [...read.held.keys()]]).toEqual([
        "2019-01-01T00:00:00Z",
        ["/h/skewed.md"],
      ]);
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it(
    "releases a row from a future-dated commit its recheck's trunk tip carried, and still holds on a later one",
    () => {
      // An instant floor alone kept a commit dated 2099 after every recheck, so no recheck released it.
      const repo = checkout();
      const git = (...args: readonly string[]): string => gitInTemp({ args, cwd: repo });
      git("commit", "--amend", "--no-edit", "--date=2099-01-01T00:00:00Z");
      git("rebase", "--committer-date-is-author-date", "--root");
      git("update-ref", "refs/remotes/origin/main", "HEAD");
      const seenTip = git("rev-parse", "HEAD");
      const recheck = "trunkRecheckedIso: 2026-10-10T12:00:00.000Z\ntrunkRechecked: re-ran it\n";
      const rows = [
        findingModel({ extra: recheck, repo, slug: "instant-only" }),
        findingModel({ extra: `${recheck}trunkRecheckedSha: ${seenTip}\n`, repo, slug: "tip-seen" }),
      ];
      const before = [...readTrunkMoved({ models: rows }).held.keys()];
      writeFileSync(join(repo, "src", "a.ts"), "export const a = 2;\n");
      git("add", ".");
      git("commit", "-m", "Change a again");
      git("update-ref", "refs/remotes/origin/main", "HEAD");
      const after = readTrunkMoved({ models: rows }).held.get("/h/tip-seen.md")!;

      expect([git("log", "-1", "--format=%cI", seenTip), before]).toEqual([
        "2099-01-01T00:00:00Z",
        ["/h/instant-only.md"],
      ]);
      expect(after.moves.flatMap((move) => move.commits.map((commit) => commit.subject))).toEqual(["Change a again"]);
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it(
    "states a row whose recorded recheck tip the checkout does not have, and offers it unchecked",
    () => {
      const repo = checkout();
      const extra = `trunkRecheckedIso: 2019-01-01T00:00:00.000Z\ntrunkRecheckedSha: ${"d".repeat(40)}\n`;
      const read = readTrunkMoved({ models: [findingModel({ extra, repo, slug: "tip-gone" })] });

      expect([[...read.held.keys()], read.unread]).toEqual([
        [],
        [{ repo, slugs: ["tip-gone"], why: "the trunk tip their recheck recorded is not in this checkout" }],
      ]);
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it(
    "holds on a merge that brought a cited file in after the floor, though the branch commit predates it",
    () => {
      // A pathspec log simplifies history, so the merge — identical to its feature
      // parent at the cited path — was dropped, and the feature commit dated before the floor was filtered out.
      const repo = checkout();
      const git = (...args: readonly string[]): string => gitInTemp({ args, cwd: repo });
      git("checkout", "-b", "feature");
      writeFileSync(join(repo, "src", "b.ts"), "export const b = 1;\n");
      git("add", ".");
      git("commit", "-m", "Add b", "--date=2019-01-01T00:00:00Z");
      git("rebase", "--committer-date-is-author-date", "HEAD~1");
      git("checkout", "main");
      writeFileSync(join(repo, "src", "c.ts"), "export const c = 1;\n");
      git("add", ".");
      git("commit", "-m", "Change c");
      git("merge", "--no-ff", "feature", "-m", "Merge feature");
      git("update-ref", "refs/remotes/origin/main", "HEAD");
      const read = readTrunkMoved({ models: [findingModel({ evidence: "[src/b.ts]", repo, slug: "merged" })] });

      expect([
        git("log", "-1", "--format=%cI", "feature"),
        read.held.get("/h/merged.md")!.moves.map((move) => [move.ref, move.commits.map((c) => c.subject)]),
      ]).toEqual(["2019-01-01T00:00:00Z", [["src/b.ts", ["Merge feature"]]]]);
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it(
    "never holds on a merge whose only difference at the cited file is against its side parent",
    () => {
      // `-m` diffing a merge against EVERY parent, so a file the trunk changed
      // before the floor would read as changed by the merge through its side parent's older copy. Git 2.54 did not
      // reproduce it beside `--first-parent`, even under `log.diffMerges=separate`; the read now names
      // `--diff-merges=first-parent` outright, and this case pins the behaviour either way.
      const repo = checkout();
      const git = (...args: readonly string[]): string => gitInTemp({ args, cwd: repo });
      git("config", "log.diffMerges", "separate");
      git("commit", "--amend", "--no-edit", "--date=2019-01-01T00:00:00Z");
      git("rebase", "--root", "--committer-date-is-author-date");
      git("checkout", "-b", "side");
      writeFileSync(join(repo, "src", "b.ts"), "export const b = 1;\n");
      git("add", ".");
      git("commit", "-m", "Add b");
      git("checkout", "main");
      writeFileSync(join(repo, "src", "a.ts"), "export const a = 2;\n");
      git("add", ".");
      git("commit", "-m", "Change a again", "--date=2019-06-01T00:00:00Z");
      git("rebase", "--committer-date-is-author-date", "HEAD~1");
      git("merge", "--no-ff", "side", "-m", "Merge side");
      git("update-ref", "refs/remotes/origin/main", "HEAD");
      const read = readTrunkMoved({ models: [findingModel({ repo, slug: "side-only" })] });

      expect([
        git("log", "--first-parent", "--format=%cI", "HEAD^1"),
        git("diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD^2", "HEAD"),
        git("diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD^1", "HEAD"),
        [...read.held.keys()],
      ]).toEqual(["2019-06-01T00:00:00Z\n2019-01-01T00:00:00Z", "src/a.ts", "src/b.ts", []]);
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it(
    "reads a pull's landing only off the trunk's first-parent line, never a merged side branch",
    () => {
      // The subject walk followed a merge into its side branch, so a side commit titled with a pull number by
      // GitHub's committer read as that pull landing on the trunk.
      const repo = checkout();
      const git = (...args: readonly string[]): string => gitInTemp({ args, cwd: repo });
      git("checkout", "-b", "side");
      writeFileSync(join(repo, "src", "z.ts"), "export const z = 1;\n");
      git("add", ".");
      git("-c", "user.email=noreply@github.com", "commit", "-m", "Unrelated side commit (#77)");
      git("checkout", "main");
      writeFileSync(join(repo, "src", "c.ts"), "export const c = 1;\n");
      git("add", ".");
      git("commit", "-m", "Change c");
      git("merge", "--no-ff", "side", "-m", "Merge side");
      git("update-ref", "refs/remotes/origin/main", "HEAD");
      const read = readTrunkMoved({
        models: [findingModel({ evidence: '["acme/widgets#77"]', repo, slug: "side-pull" })],
      });

      expect([git("log", "-1", "--format=%ce", "side"), read.held.size, read.unread]).toEqual([
        "noreply@github.com",
        0,
        [],
      ]);
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it(
    "holds on a path git still C-quotes with core.quotePath off, one carrying a double quote",
    () => {
      const repo = checkout();
      const git = (...args: readonly string[]): string => gitInTemp({ args, cwd: repo });
      writeFileSync(join(repo, "src", 'q".ts'), "export const q = 1;\n");
      git("add", ".");
      git("commit", "-m", "Add q");
      git("update-ref", "refs/remotes/origin/main", "HEAD");
      const model = findingModel({ evidence: '[src/q".ts]', repo, slug: "quoted" });
      const read = readTrunkMoved({ models: [model] });

      expect([model.doc.evidence, read.held.get("/h/quoted.md")!.moves.map((move) => move.ref)]).toEqual([
        ['src/q".ts'],
        ['src/q".ts'],
      ]);
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it(
    "reads a cited path as a literal name, never as pathspec magic",
    () => {
      const repo = checkout();
      const git = (...args: readonly string[]): string => gitInTemp({ args, cwd: repo });
      mkdirSync(join(repo, ":(literal)src"));
      writeFileSync(join(repo, ":(literal)src", "foo.ts"), "export const foo = 1;\n");
      git("add", ".");
      git("commit", "-m", "Add a magic-looking path");
      git("update-ref", "refs/remotes/origin/main", "HEAD");
      const model = findingModel({ evidence: "[:(literal)src/foo.ts]", repo, slug: "magic" });
      const read = readTrunkMoved({ models: [model] });

      expect([model.doc.evidence, read.held.get("/h/magic.md")!.moves.map((move) => move.ref)]).toEqual([
        [":(literal)src/foo.ts"],
        [":(literal)src/foo.ts"],
      ]);
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it(
    "holds on a commit whose subject carries a control character, as git prints it",
    () => {
      const repo = checkout();
      const git = (...args: readonly string[]): string => gitInTemp({ args, cwd: repo });
      writeFileSync(join(repo, "src", "d.ts"), "export const d = 1;\n");
      git("add", ".");
      git("commit", "-m", "fix\u001fextra \u001e tail");
      git("update-ref", "refs/remotes/origin/main", "HEAD");
      const read = readTrunkMoved({ models: [findingModel({ evidence: "[src/d.ts]", repo, slug: "control" })] });

      expect(read.held.get("/h/control.md")!.moves.map((move) => move.commits.map((c) => c.subject))).toEqual([
        ["fix\u001fextra \u001e tail"],
      ]);
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it(
    "holds nothing once a recheck moved the floor past every commit",
    () => {
      const repo = checkout();
      const extra = 'trunkRecheckedIso: 2099-01-01T00:00:00.000Z\ntrunkRechecked: "still refuses"\n';
      const read = readTrunkMoved({ models: [findingModel({ extra, repo, slug: "rechecked" })] });

      expect([read.held.size, read.unread]).toEqual([0, []]);
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it(
    "states a checkout it cannot read and holds nothing there, rather than holding on a guess",
    () => {
      const repo = tempDir({ prefix: "trunk-moved-not-git-" });
      const read = readTrunkMoved({ models: [findingModel({ repo, slug: "unread" })] });

      expect(read.held.size).toBe(0);
      expect(read.unread.map((gap) => [gap.repo, gap.slugs])).toEqual([[repo, ["unread"]]]);
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it(
    "holds on a non-ASCII path, which git would otherwise print quoted and escaped",
    () => {
      const repo = checkout();
      const git = (...args: readonly string[]): string => gitInTemp({ args, cwd: repo });
      writeFileSync(join(repo, "src", "é.ts"), "export const e = 1;\n");
      git("add", ".");
      git("commit", "-m", "Add é");
      git("update-ref", "refs/remotes/origin/main", "HEAD");
      const read = readTrunkMoved({ models: [findingModel({ evidence: "[src/é.ts]", repo, slug: "accented" })] });

      expect(read.held.get("/h/accented.md")!.moves.map((move) => move.ref)).toEqual(["src/é.ts"]);
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it(
    "states the rows whose cited pull went unchecked under a non-GitHub origin, and still checks their paths",
    () => {
      // An origin `originSlug` cannot read dropped every cited pull without a word.
      const repo = checkout({ origin: "https://git.example.invalid/acme/widgets.git" });
      const read = readTrunkMoved({
        models: [
          findingModel({ evidence: '["acme/widgets#7"]', repo, slug: "pull-only" }),
          findingModel({ evidence: '[src/a.ts:3, "acme/widgets#7"]', repo, slug: "path-and-pull" }),
        ],
      });

      expect([[...read.held.keys()], read.pullsUnchecked, read.unread]).toEqual([
        ["/h/path-and-pull.md"],
        [{ repo, slugs: ["path-and-pull", "pull-only"], why: "its origin names no github.com repository" }],
        [],
      ]);
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it(
    "keeps the path holds it read when the origin remote itself cannot be read",
    () => {
      // A failed `remote get-url` classified the whole checkout unread, discarding the
      // path commits it had already read, so a row whose cited file moved was offered as ready.
      const repo = checkout();
      // Removing the remote drops its tracking refs too, so the trunk ref is put back.
      gitInTemp({ args: ["remote", "remove", "origin"], cwd: repo });
      gitInTemp({ args: ["update-ref", "refs/remotes/origin/main", "HEAD"], cwd: repo });
      const read = readTrunkMoved({
        models: [findingModel({ evidence: '[src/a.ts:3, "acme/widgets#7"]', repo, slug: "no-remote" })],
      });

      expect([[...read.held.keys()], read.pullsUnchecked, read.unread]).toEqual([
        ["/h/no-remote.md"],
        [{ repo, slugs: ["no-remote"], why: "its origin remote could not be read" }],
        [],
      ]);
    },
    REAL_GIT_TIMEOUT_MS,
  );
});
