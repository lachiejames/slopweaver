import { describe, expect, it } from "vitest";
import { classifyGithub } from "../../../connect/github.js";
import { classifyLinear } from "../../../connect/linear.js";
import { classifyNotion } from "../../../connect/notion.js";
import { classifySlack } from "../../../connect/slack.js";
import { type ConnectCapability, probeScopeDetail } from "../../../connect/types.js";

const detail = ({ capabilities }: { capabilities: readonly ConnectCapability[] }): string =>
  capabilities.find((c) => c.id === "read-probe")!.detail;

describe("probeScopeDetail", () => {
  it("renders one lane with the not-coverage disclaimer and the audit pointer", () => {
    expect(probeScopeDetail({ sampled: ["1 repo(s)"] })).toBe(
      "scope check only — the probe sampled 1 repo(s). These are PROBE SAMPLE SIZES, not corpus coverage; run `slopweaver audit` for coverage.",
    );
  });

  it("joins multiple lanes", () => {
    expect(probeScopeDetail({ sampled: ["1 member(s)", "1 channel(s)"] })).toBe(
      "scope check only — the probe sampled 1 member(s), 1 channel(s). These are PROBE SAMPLE SIZES, not corpus coverage; run `slopweaver audit` for coverage.",
    );
  });
});

// PR5.4: every connector's read-probe detail is asserted EXACTLY, because the defect was the wording — a
// bare `saw 1 member(s), 1 channel(s)` that read as corpus coverage. A status-only assertion (all these
// tests had before) cannot catch a line that is misleading but structurally correct.
describe("read-probe detail is never a bare count", () => {
  it("slack", () => {
    const report = classifySlack({
      probe: {
        authReachable: true,
        channelsSampled: 1,
        emailVisible: true,
        humanMembersSampled: 1,
        membersSampled: 1,
        tokenKind: "user",
        write: { bot: { kind: "absent" }, user: { kind: "absent" } },
      },
    });
    expect(detail({ capabilities: report.capabilities })).toBe(
      "scope check only — the probe sampled 1 member(s), 1 channel(s). These are PROBE SAMPLE SIZES, not corpus coverage; run `slopweaver audit` for coverage.",
    );
  });

  it("linear", () => {
    const report = classifyLinear({
      probe: { authReachable: true, curatedSampled: 1, issuesSampled: 1, projectsSampled: 1, usersSampled: 1 },
    });
    expect(detail({ capabilities: report.capabilities })).toBe(
      "scope check only — the probe sampled 1 user(s), 1 issue(s), 1 project(s). These are PROBE SAMPLE SIZES, not corpus coverage; run `slopweaver audit` for coverage.",
    );
  });

  it("notion", () => {
    const report = classifyNotion({
      probe: { anyPerson: true, authReachable: true, emailVisible: true, pagesSampled: 1, usersSampled: 1 },
    });
    expect(detail({ capabilities: report.capabilities })).toBe(
      "scope check only — the probe sampled 1 shared page/data source(s). These are PROBE SAMPLE SIZES, not corpus coverage; run `slopweaver audit` for coverage.",
    );
  });

  it("github", () => {
    const report = classifyGithub({
      probe: { authReachable: true, reposSampled: 1, samlPresent: true, teamsReadable: true, tokenPresent: true },
    });
    expect(detail({ capabilities: report.capabilities })).toBe(
      "scope check only — the probe sampled 1 repo(s). These are PROBE SAMPLE SIZES, not corpus coverage; run `slopweaver audit` for coverage.",
    );
  });
});
