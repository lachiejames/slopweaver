/**
 * The title shape a policy holds a pull-request title to — this build's own repository by the code's rule, an
 * install's ticketed repository by the shape it names — and the write-time rule that judges it only when the
 * title is being set.
 */
import { describe, expect, it } from "vitest";
import { type TitleShapePolicy, titleShapeRefusal, titleWriteRefusal } from "../../../../outbound/github/titleShape.js";

const TEAM = { owner: "acme", repo: "acme-admin" } as const;
const SELF = { owner: "acme", repo: "slopweaver" } as const;
const POLICY: TitleShapePolicy = {
  repositoryShapes: { "acme/acme-admin": "ticketed" },
  selfRepository: "acme/slopweaver",
};
const SELF_ONLY: TitleShapePolicy = { repositoryShapes: {}, selfRepository: "acme/slopweaver" };

describe("titleShapeRefusal — a ticketed repository, a ticket in round brackets", () => {
  it.each([
    "dx(ABC-840): show the integration suite's logs when a test fails",
    "docs(ABC-1071, XYZ-7327): one page a new starter reads first",
    "fix(ABC-4001): clear the lodash prototype-pollution advisory from the customer report (CVSS 7.5)",
    "feat(ABC-99)!: two monitors so a flaky test on staging reaches a channel",
  ])("accepts %j", (title) => {
    expect(titleShapeRefusal({ ...TEAM, policy: POLICY, title })).toBeUndefined();
  });

  it.each([
    "[ABC-4001] fix(security): bump lodash",
    "dx: show the integration suite's logs",
    "dx(ABC-840) show the logs",
    "dx(abc-840): show the logs",
    "wip(ABC-840): show the logs",
    "Show the integration suite's logs",
    "chore(deps): update dependency vitest to v4.1.2",
    "fix(deps-dev): update dependency eslint to v9.3.0",
  ])("refuses %j, naming the shape and an example", (title) => {
    const refusal = titleShapeRefusal({ ...TEAM, policy: POLICY, title });
    expect(refusal).toContain("kind(TICKET): outcome");
    expect(refusal).toContain('e.g. "dx(ABC-840):');
  });

  it("does not judge the same repository when the install names no shape for it", () => {
    expect(titleShapeRefusal({ ...TEAM, policy: SELF_ONLY, title: "Show the logs" })).toBeUndefined();
  });
});

describe("titleShapeRefusal — this build's own repository, an area at most and no ticket", () => {
  it.each([
    "feat: two plain badges",
    "feat(pr-body): the risk badge says why it is low",
    "fix(vuln body): the change cell drops the fix rung",
    "fix: clear CVE-2026-1234 from the hook runner",
    "chore: pin GHSA-1111-2222-3333 out, and read UTF-8 safely",
  ])("accepts %j", (title) => {
    expect(titleShapeRefusal({ ...SELF, policy: SELF_ONLY, title })).toBeUndefined();
  });

  it.each([
    "feat(ABC-840): two plain badges",
    "feat(pr-body): two plain badges for ABC-840",
    "[ABC-840] feat: two plain badges",
    "two plain badges",
  ])("refuses %j", (title) => {
    expect(titleShapeRefusal({ ...SELF, policy: SELF_ONLY, title })).toContain("with no Linear ticket anywhere in it");
  });

  it("judges the repository whatever case its slug is written in", () => {
    const refusal = titleShapeRefusal({
      owner: "Acme",
      policy: SELF_ONLY,
      repo: "SlopWeaver",
      title: "two plain badges",
    });
    expect(refusal).toContain("with no Linear ticket anywhere in it");
  });

  it("follows the shape the install names for its own repository over the self rule", () => {
    const policy: TitleShapePolicy = {
      repositoryShapes: { "acme/slopweaver": "ticketed" },
      selfRepository: "acme/slopweaver",
    };
    expect(titleShapeRefusal({ ...SELF, policy, title: "feat(ABC-1): add badges" })).toBeUndefined();
    expect(titleShapeRefusal({ ...SELF, policy, title: "feat: add badges" })).toContain("kind(TICKET): outcome");
  });

  it("does not judge a repository it holds no rule for", () => {
    expect(
      titleShapeRefusal({ owner: "someone", policy: POLICY, repo: "else", title: "[X-1] anything" }),
    ).toBeUndefined();
  });
});

describe("titleWriteRefusal — judged only when the title is being set", () => {
  const LEGACY = "[ABC-840] Show the integration suite's logs";

  it("lets an update through that leaves an old-shaped title alone, so a body re-render is never blocked", () => {
    expect(titleWriteRefusal({ ...TEAM, liveTitle: LEGACY, policy: POLICY, title: LEGACY })).toBeUndefined();
  });

  it("refuses an update that changes the title to another old-shaped one", () => {
    const refusal = titleWriteRefusal({ ...TEAM, liveTitle: LEGACY, policy: POLICY, title: `${LEGACY}!` });
    expect(refusal).toContain("kind(TICKET): outcome");
  });

  it("accepts an update that changes an old-shaped title into the shape", () => {
    const title = "dx(ABC-840): show the integration suite's logs when a test fails";
    expect(titleWriteRefusal({ ...TEAM, liveTitle: LEGACY, policy: POLICY, title })).toBeUndefined();
  });

  it("always judges a create, which has no live title", () => {
    const refusal = titleWriteRefusal({ ...TEAM, liveTitle: undefined, policy: POLICY, title: LEGACY });
    expect(refusal).toContain("kind(TICKET): outcome");
  });
});
