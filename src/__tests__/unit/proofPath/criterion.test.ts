/**
 * The proof-path criterion, over the shapes the incident actually committed, a cassette under a name the
 * directory rule never sees, and the source module that must stay legal.
 */
import { describe, expect, it } from "vitest";

import {
  isProofPath,
  missingProofGitignoreLines,
  PROOF_GITIGNORE_LINES,
  proofPathHits,
} from "../../../proofPath/criterion.js";

/** Paths the incident PRs committed, or would have: each must be refused. */
const REFUSED: readonly string[] = [
  "packages/tool-cli/proof/plugin-loads-in-claude.gif",
  "packages/tool-cli/proof/plugin-loads-in-claude.tape",
  "packages/tool-cli/proof/violating-body.md",
  "packages/tool-cli/proof/proof-form.json",
  "proof/otel-temporality/batchPlan.mts",
  "proof/otel-temporality/.gitignore",
  "apps/test/proof/journeys/x.journey.ts",
  "apps/test/proof/README.md",
  "docs/proofs/a.md",
  "site/screenshots/a.png",
  ".proof/run.json",
  "packages/x/src/proof/out.gif",
  "src/proof/notes.md",
  "src/proof/out.gif",
  "proof.png",
  "tools/Screenshot 2026-09-27.png",
  "src/cli/proof-run.tape",
  "Proof/A.TS",
  "packages/tool-cli/cassettes/verb-raises-a-pr-codex.tape",
  "demo/Recording.TAPE",
  "apps/test/recordings/session.cast",
];

/** Source and assets that must stay legal. */
const ALLOWED: readonly string[] = [
  "src/proof/yarnWhy/capture.ts",
  "src/cli/commands/proof/run.ts",
  "src/__tests__/unit/proof/yarnWhy/tape.test.ts",
  "packages/x/src/proof/index.mts",
  "packages/x/src/proofs/view.tsx",
  "src/screenshots/shoot.cts",
  "site/public/demo.gif",
  "docs/proof-capture.md",
  "src/cli/commands/proof/core.ts",
  "proof.md",
  "src/proofPath/criterion.ts",
];

describe("isProofPath", () => {
  it("refuses every incident shape", () => {
    expect(REFUSED.filter((path) => !isProofPath({ path }))).toEqual([]);
  });

  it("keeps source modules and site assets legal", () => {
    expect(ALLOWED.filter((path) => isProofPath({ path }))).toEqual([]);
  });

  it("ignores a leading ./", () => {
    expect(isProofPath({ path: "./proof/a.gif" })).toBe(true);
  });

  it("reads a backslash as a filename character, not a separator", () => {
    expect(isProofPath({ path: "docs\\proof\\a.md" })).toBe(false);
  });
});

describe("proofPathHits", () => {
  it("returns the hits sorted and de-duplicated", () => {
    expect(proofPathHits({ paths: ["z/proof/b.gif", "src/proof/a.ts", "a/proof/c.tape", "z/proof/b.gif"] })).toEqual([
      "a/proof/c.tape",
      "z/proof/b.gif",
    ]);
  });

  it("returns nothing for a clean listing", () => {
    expect(proofPathHits({ paths: ALLOWED })).toEqual([]);
  });
});

describe("missingProofGitignoreLines", () => {
  const block = PROOF_GITIGNORE_LINES.join("\n");

  it("accepts the block anywhere in the file", () => {
    expect(missingProofGitignoreLines({ content: `node_modules/\n\n# proof\n${block}\n.env\n` })).toEqual([]);
  });

  it("names the one line an otherwise intact block lost", () => {
    const content = PROOF_GITIGNORE_LINES.filter((line) => line !== "**/proof*.gif").join("\n");
    expect(missingProofGitignoreLines({ content })).toEqual(["**/proof*.gif"]);
  });

  it("asks for the whole block when every line is present but reordered", () => {
    const content = PROOF_GITIGNORE_LINES.toReversed().join("\n");
    expect(missingProofGitignoreLines({ content })).toEqual(PROOF_GITIGNORE_LINES);
  });

  it("asks for the whole block when there is none", () => {
    expect(missingProofGitignoreLines({ content: "node_modules/\n" })).toEqual(PROOF_GITIGNORE_LINES);
  });

  it("opens with the directory block and its source re-inclusion", () => {
    expect(PROOF_GITIGNORE_LINES.slice(0, 5)).toEqual([
      "**/proof/**",
      "!**/src/**/proof/**/",
      "!**/src/**/proof/**/*.ts",
      "!**/src/**/proof/**/*.tsx",
      "!**/src/**/proof/**/*.[cm]ts",
    ]);
  });

  it("closes with a recording source ignored under any name", () => {
    expect(PROOF_GITIGNORE_LINES.slice(-2)).toEqual(["**/*.tape", "**/*.cast"]);
  });
});
