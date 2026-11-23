/**
 * Branch attribution against a REAL repository, because every defect it guards against is a property of git's
 * own history walk: the pickaxe nominating a removal commit, a prose mention, or a row our own history already
 * added and retired. A Codex planning pass reproduced the first two in a throwaway repository before this
 * existed; each is pinned here as NOT named.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { REGISTRY_PATH, unlandedBranchesDeclaring } from "../../../devLint/secretsRegistryGit.js";
import { gitInTemp, REAL_GIT_TIMEOUT_MS } from "../../tempGitRepo.js";

let root = "";

/** A legal ref name ending in U+00A0, which a trimmed read folds into the unrelated branch `nbsp`. */
const NBSP_BRANCH = "nbsp\u00a0";

/** A real branch whose name is what `ffpeer` plus an invalid 0xff byte decodes to under UTF-8. */
const REPLACEMENT_BRANCH = "ffpeer\ufffd";

/** A category file under the register's category directory, where every row has stood since the split. */
const CATEGORY_PATH = "src/secrets/credentials/connectors.ts";

/** A category file whose name git C-quotes in a plain listing, as it does any non-ASCII byte by default. */
const ACCENTED_PATH = "src/secrets/credentials/café.ts";

/** Write the register (or one category file of it) as a list of row names, then commit it on the checked-out branch. */
function commitRegister({
  names,
  message,
  path = REGISTRY_PATH,
}: {
  names: readonly string[];
  message: string;
  path?: string;
}): void {
  const rows = names.map((name) => `  {\n    name: "${name}",\n  },`);
  // Git keeps no empty directory, so a checkout that drops the last file in one removes it.
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), ["export const CREDENTIALS = [", ...rows, "];", ""].join("\n"));
  gitInTemp({ args: ["add", "-A"], cwd: root });
  gitInTemp({ args: ["-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-qm", message], cwd: root });
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "sw-reg-git-"));
  mkdirSync(join(root, "src/secrets"), { recursive: true });
  gitInTemp({ args: ["init", "-q", "-b", "main"], cwd: root });
  commitRegister({ message: "base", names: ["notion-token"] });

  gitInTemp({ args: ["checkout", "-q", "-b", "peer"], cwd: root });
  commitRegister({ message: "peer adds store-url", names: ["notion-token", "store-url"] });

  gitInTemp({ args: ["checkout", "-q", "main"], cwd: root });
  gitInTemp({ args: ["checkout", "-q", "-b", "gone"], cwd: root });
  commitRegister({ message: "gone adds dropped-token", names: ["notion-token", "dropped-token"] });
  commitRegister({ message: "gone removes it", names: ["notion-token"] });

  gitInTemp({ args: ["checkout", "-q", "main"], cwd: root });
  gitInTemp({ args: ["checkout", "-q", "-b", "prose"], cwd: root });
  writeFileSync(
    join(root, REGISTRY_PATH),
    '// once read name: "prose-token", never a row\nexport const CREDENTIALS = [\n  {\n    name: "notion-token",\n  },\n];\n',
  );
  gitInTemp({ args: ["-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-qam", "prose"], cwd: root });

  gitInTemp({ args: ["checkout", "-q", "main"], cwd: root });
  gitInTemp({ args: ["checkout", "-q", "-b", "remote-only"], cwd: root });
  commitRegister({ message: "remote-only adds remote-token", names: ["notion-token", "remote-token"] });
  const remoteTip = gitInTemp({ args: ["rev-parse", "HEAD"], cwd: root }).trim();
  gitInTemp({ args: ["checkout", "-q", "main"], cwd: root });
  gitInTemp({ args: ["update-ref", "refs/remotes/origin/remote-only", remoteTip], cwd: root });
  gitInTemp({ args: ["branch", "-f", "remote-only", "main"], cwd: root });

  gitInTemp({ args: ["checkout", "-q", "main"], cwd: root });
  gitInTemp({ args: ["checkout", "-q", "-b", NBSP_BRANCH], cwd: root });
  commitRegister({ message: "nbsp branch adds nbsp-token", names: ["notion-token", "nbsp-token"] });
  gitInTemp({ args: ["checkout", "-q", "main"], cwd: root });
  gitInTemp({ args: ["branch", "nbsp", "main"], cwd: root });

  gitInTemp({ args: ["checkout", "-q", "main"], cwd: root });
  gitInTemp({ args: ["checkout", "-q", "-b", "ff-source"], cwd: root });
  commitRegister({ message: "ff-source adds ff-token", names: ["notion-token", "ff-token"] });
  const ffTip = gitInTemp({ args: ["rev-parse", "HEAD"], cwd: root }).trim();
  gitInTemp({ args: ["checkout", "-q", "main"], cwd: root });
  gitInTemp({ args: ["branch", "-D", "-q", "ff-source"], cwd: root });
  gitInTemp({ args: ["branch", REPLACEMENT_BRANCH, "main"], cwd: root });
  // A ref whose name is not valid UTF-8 cannot be made through argv, so it goes straight into packed-refs.
  writeFileSync(
    join(root, ".git", "packed-refs"),
    Buffer.concat([Buffer.from(`${ffTip} refs/heads/ffpeer`), Buffer.from([0xff]), Buffer.from("\n")]),
  );

  gitInTemp({ args: ["checkout", "-q", "main"], cwd: root });
  gitInTemp({ args: ["checkout", "-q", "-b", "category-peer"], cwd: root });
  // The accented file rides the same commit: `commitRegister` stages the whole tree.
  mkdirSync(join(root, "src/secrets/credentials"), { recursive: true });
  writeFileSync(join(root, ACCENTED_PATH), 'export const X = [\n  {\n    name: "accented-token",\n  },\n];\n');
  commitRegister({ message: "category-peer adds category-token", names: ["category-token"], path: CATEGORY_PATH });

  gitInTemp({ args: ["checkout", "-q", "main"], cwd: root });
  gitInTemp({ args: ["checkout", "-q", "-b", "category-gone"], cwd: root });
  commitRegister({
    message: "category-gone adds gone-category-token",
    names: ["gone-category-token"],
    path: CATEGORY_PATH,
  });
  gitInTemp({ args: ["rm", "-q", CATEGORY_PATH], cwd: root });
  gitInTemp({ args: ["-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-qm", "drop it"], cwd: root });

  gitInTemp({ args: ["checkout", "-q", "main"], cwd: root });
  commitRegister({ message: "main adds old-token", names: ["notion-token", "old-token"] });
  commitRegister({ message: "main retires old-token", names: ["notion-token"] });
}, REAL_GIT_TIMEOUT_MS);

afterAll(() => {
  rmSync(root, { force: true, recursive: true });
});

describe("unlandedBranchesDeclaring", () => {
  it(
    "names the peer branch whose tip carries the row",
    () => {
      expect(unlandedBranchesDeclaring({ name: "store-url", root })).toEqual(["refs/heads/peer"]);
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it(
    "names the peer branch whose tip carries the row in a category file rather than the composition root",
    () => {
      expect(unlandedBranchesDeclaring({ name: "category-token", root })).toEqual(["refs/heads/category-peer"]);
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it(
    "names the peer branch whose row sits in a category file with a non-ASCII name",
    () => {
      expect(unlandedBranchesDeclaring({ name: "accented-token", root })).toEqual(["refs/heads/category-peer"]);
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it(
    "does not name a branch whose category file carrying the row is gone at its tip",
    () => {
      expect(unlandedBranchesDeclaring({ name: "gone-category-token", root })).toEqual([]);
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it(
    "does not name a branch that added the row and then removed it",
    () => {
      expect(unlandedBranchesDeclaring({ name: "dropped-token", root })).toEqual([]);
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it(
    "does not name a branch that only mentions the field in prose",
    () => {
      expect(unlandedBranchesDeclaring({ name: "prose-token", root })).toEqual([]);
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it(
    "does not name anything for a row our own history added and retired",
    () => {
      expect(unlandedBranchesDeclaring({ name: "old-token", root })).toEqual([]);
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it(
    "names a remote-tracking ref by its full name, never as the local branch whose own tip lacks the row",
    () => {
      expect(unlandedBranchesDeclaring({ name: "remote-token", root })).toEqual(["refs/remotes/origin/remote-only"]);
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it(
    "returns a ref name ending in whitespace exactly, never the different branch a trim would produce",
    () => {
      expect(unlandedBranchesDeclaring({ name: "nbsp-token", root })).toEqual([`refs/heads/${NBSP_BRANCH}`]);
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it(
    "never names a branch an undecodable ref name collides with, whose own tip lacks the row",
    () => {
      expect(unlandedBranchesDeclaring({ name: "ff-token", root })).toEqual([]);
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it(
    "answers none, rather than throwing, outside a repository",
    () => {
      const outside = mkdtempSync(join(tmpdir(), "sw-reg-nogit-"));
      try {
        expect(unlandedBranchesDeclaring({ name: "store-url", root: outside })).toEqual([]);
      } finally {
        rmSync(outside, { force: true, recursive: true });
      }
    },
    REAL_GIT_TIMEOUT_MS,
  );
});
