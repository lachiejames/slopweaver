/** The no-proof-path gate's pure scan, over the listing acme-admin actually committed. */
import { describe, expect, it } from "vitest";

import { scanNoProofPath } from "../../../devLint/noProofPath.js";
import { PROOF_GITIGNORE_LINES } from "../../../proofPath/criterion.js";

const INTACT = `node_modules/\n${PROOF_GITIGNORE_LINES.join("\n")}\n`;

describe("scanNoProofPath", () => {
  it("names every committed proof file", () => {
    const findings = scanNoProofPath({
      gitignore: INTACT,
      paths: [
        "packages/tool-cli/src/index.ts",
        "packages/tool-cli/proof/opt-in-not-opt-out.gif",
        "packages/tool-cli/proof/opt-in-not-opt-out.tape",
        "packages/tool-cli/proof/violating-body.md",
      ],
    });
    expect(findings).toEqual([
      { kind: "proof-path", subject: "packages/tool-cli/proof/opt-in-not-opt-out.gif" },
      { kind: "proof-path", subject: "packages/tool-cli/proof/opt-in-not-opt-out.tape" },
      { kind: "proof-path", subject: "packages/tool-cli/proof/violating-body.md" },
    ]);
  });

  it("passes this repository's own proof source module and a site asset", () => {
    expect(
      scanNoProofPath({
        gitignore: INTACT,
        paths: ["src/proof/yarnWhy/tape.ts", "src/cli/commands/proof/run.ts", "site/public/demo.gif"],
      }),
    ).toEqual([]);
  });

  it("names the gitignore line the block lost", () => {
    const gitignore = PROOF_GITIGNORE_LINES.filter((line) => line !== "**/screenshots/**").join("\n");
    expect(scanNoProofPath({ gitignore, paths: [] })).toEqual([{ kind: "gitignore", subject: "**/screenshots/**" }]);
  });

  it("lists a proof path before a gitignore finding", () => {
    const findings = scanNoProofPath({ gitignore: "", paths: ["proof/a.gif"] });
    expect(findings[0]).toEqual({ kind: "proof-path", subject: "proof/a.gif" });
    expect(findings.length).toBe(1 + PROOF_GITIGNORE_LINES.length);
  });
});
