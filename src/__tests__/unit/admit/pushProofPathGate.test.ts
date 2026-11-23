/** The proof-path door's pure refusal, its hatch, and the tree read it judges — over a real repository. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { headTreePaths, proofPathHatchOpen, proofPathRefusal } from "../../../admit/pushProofPathGate.js";
import { unwrap } from "../../../lib/result.js";
import { gitInTemp } from "../../tempGitRepo.js";

const PATHS: readonly string[] = ["src/proof/run.ts", "proof/otel-temporality/README.md", "docs/a.md"];

describe("proofPathRefusal", () => {
  it("names the proof file and the hatch", () => {
    const lines = proofPathRefusal({ hatchOpen: false, paths: PATHS, subject: "pull request #7" })!;
    expect(lines.slice(0, 2)).toEqual([
      "pull request #7 carries 1 proof file(s); nothing was sent:",
      "  proof/otel-temporality/README.md",
    ]);
    expect(lines[2]).toContain("blocked because the head carries proof output");
    expect(lines.join("\n")).toContain("SLOPWEAVER_ALLOW_PROOF_PATH=1");
  });

  it("says nothing over a clean head", () => {
    expect(proofPathRefusal({ hatchOpen: false, paths: ["src/proof/run.ts"], subject: "x" })).toBe(undefined);
  });

  it("says nothing once the hatch is open", () => {
    expect(proofPathRefusal({ hatchOpen: true, paths: PATHS, subject: "x" })).toBe(undefined);
  });
});

describe("proofPathHatchOpen", () => {
  it("opens only on exactly 1", () => {
    expect(
      [{ SLOPWEAVER_ALLOW_PROOF_PATH: "1" }, { SLOPWEAVER_ALLOW_PROOF_PATH: "true" }, {}].map((env) =>
        proofPathHatchOpen({ env }),
      ),
    ).toEqual([true, false, false]);
  });
});

describe("headTreePaths", () => {
  it("reads the commit that travels, not a replacement standing in for it", () => {
    const repo = mkdtempSync(join(tmpdir(), "proof-path-replace-"));
    const git = ({ args }: { cwd: string; args: readonly string[] }): string =>
      gitInTemp({ args: ["-c", "user.name=t", "-c", "user.email=t@t", ...args], cwd: repo });
    try {
      git({ args: ["init", "-q"], cwd: repo });
      mkdirSync(join(repo, "proof"));
      writeFileSync(join(repo, "proof", "a.gif"), "GIF89a");
      git({ args: ["add", "-f", "proof/a.gif"], cwd: repo });
      git({ args: ["commit", "-q", "-m", "carries proof"], cwd: repo });
      const carrying = git({ args: ["rev-parse", "HEAD"], cwd: repo });
      git({ args: ["rm", "-q", "-r", "proof"], cwd: repo });
      writeFileSync(join(repo, "clean.ts"), "");
      git({ args: ["add", "clean.ts"], cwd: repo });
      git({ args: ["commit", "-q", "-m", "clean"], cwd: repo });
      const clean = git({ args: ["rev-parse", "HEAD"], cwd: repo });
      git({ args: ["replace", carrying, clean], cwd: repo });
      expect(git({ args: ["ls-tree", "-r", "--name-only", carrying], cwd: repo })).toBe("clean.ts");
      expect(unwrap(headTreePaths({ localSha: carrying, readGit: git, repoRoot: repo }))).toEqual(["proof/a.gif"]);
    } finally {
      rmSync(repo, { force: true, recursive: true });
    }
  });
});
