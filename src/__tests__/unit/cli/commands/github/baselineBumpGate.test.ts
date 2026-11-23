/*
 * The ratchet-bump hold both landing verbs print (`src/cli/commands/github/baselineBumpGate.ts`): nothing when
 * the witness read is clear, otherwise one subject line per detail and the no-override line.
 */
import { describe, expect, it } from "vitest";

import { baselineBumpRefusal } from "../../../../../cli/commands/github/baselineBumpGate.js";
import type { PullRequestHead } from "../../../../../codex/landingGate.js";

const HEAD: PullRequestHead = {
  baseSha: "ba5e0000",
  branch: "feature",
  headSha: "cafe1234",
  repository: "acme/widget",
};

describe("baselineBumpRefusal", () => {
  it("prints nothing when every bump manifest is witnessed, and hands the reader the head as given", async () => {
    const asked: PullRequestHead[] = [];
    const lines = await baselineBumpRefusal({
      cwd: "/w/repo",
      head: HEAD,
      home: "/w/home",
      landingBranch: undefined,
      read: ({ head }) => {
        asked.push(head);
        return { kind: "clear" };
      },
    });

    expect(lines).toEqual([]);
    expect(asked).toEqual([HEAD]);
  });

  it("prints each detail under the subject, then the line saying there is no override", async () => {
    const lines = await baselineBumpRefusal({
      cwd: "/w/repo",
      head: HEAD,
      home: "/w/home",
      landingBranch: undefined,
      read: () =>
        Promise.resolve({ details: ["a.json has no Codex witness", "b.json has no Codex witness"], kind: "refused" }),
    });

    expect(lines).toEqual([
      "baseline-bump-unwitnessed: a.json has no Codex witness",
      "baseline-bump-unwitnessed: b.json has no Codex witness",
      "baseline-bump-unwitnessed has no acknowledgement and no escape hatch: --acknowledge and --acknowledge-all " +
        "do not reach it. Take the Codex witness review each line names on the pull request's head, then land again.",
    ]);
  });
});
