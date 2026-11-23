import { describe, expect, it } from "vitest";

import { boardRowPlacement, handPlacement } from "../../../lib/registerPlacement";
import { buildWorkspacePlacer } from "../../../lib/workspacePlacement";
import { ACME_PLACEMENT, ACME_PLACER, FIXTURE_SELF_REPOSITORY, GLOBEX_PLACER } from "../../organisationFixture";
import { BARE } from "./fixtures";

describe.each([
  { name: "acme", other: "globex", placer: ACME_PLACER, slackHosts: ["acme.slack.com"] },
  { name: "globex", other: "acme", placer: GLOBEX_PLACER, slackHosts: ["globex.slack.com", "globex-eng.slack.com"] },
])(
  "the organisation, for $name — the one place its owner and hosts are read from",
  ({ name, other, placer, slackHosts }) => {
    it("places its own repository in team, this build's in self, and another organisation's nowhere", () => {
      expect([
        placer.repositoryEvidence({ value: `https://github.com/${name}/${name}-admin/pull/7` }),
        placer.repositoryEvidence({ value: `https://github.com/${FIXTURE_SELF_REPOSITORY}/pull/1` }),
        placer.repositoryEvidence({ value: `https://github.com/${other}/${other}-admin/pull/7` }),
        placer.repositoryEvidence({ value: "torvalds/linux" }),
      ]).toEqual([
        { source: "repository", value: `${name}/${name}-admin`, workspace: "team" },
        { source: "repository", value: FIXTURE_SELF_REPOSITORY, workspace: "self" },
        undefined,
        undefined,
      ]);
    });

    it("places a pull request by the same rule, and names one outside the organisation unplaced", () => {
      const own = `${name}/${name}-admin`;
      expect([
        placer.repositoryPlacement({ repo: own }),
        placer.repositoryPlacement({ repo: FIXTURE_SELF_REPOSITORY }),
        placer.repositoryPlacement({ repo: `${other}/${other}-admin` }),
      ]).toEqual([
        { by: [{ source: "repository", value: own, workspace: "team" }], kind: "placed", workspace: "team" },
        {
          by: [{ source: "repository", value: FIXTURE_SELF_REPOSITORY, workspace: "self" }],
          kind: "placed",
          workspace: "self",
        },
        { kind: "unplaced", why: `${other}/${other}-admin is not a repository of the organisation` },
      ]);
    });

    it("reads a permalink on every one of its Slack hosts, and none on another organisation's", () => {
      expect(slackHosts.map((host) => placer.slackEvidence({ value: `https://${host}/archives/C1/p1` }))).toEqual(
        slackHosts.map((host) => ({ source: "slack-workspace", value: `${host}/archives/C1/p1`, workspace: "team" })),
      );
      expect(placer.slackEvidence({ value: `https://${other}.slack.com/archives/C1/p1` })).toBeUndefined();
    });

    it("is a conflict when a row names its repository and this build's", () => {
      const placement = boardRowPlacement({
        placer,
        row: {
          ...BARE,
          prUrls: [
            `https://github.com/${name}/${name}-app/pull/1`,
            `https://github.com/${FIXTURE_SELF_REPOSITORY}/pull/2`,
          ],
        },
      });
      expect(placement).toEqual({
        evidence: [
          { source: "repository", value: `${name}/${name}-app`, workspace: "team" },
          { source: "repository", value: FIXTURE_SELF_REPOSITORY, workspace: "self" },
        ],
        kind: "conflict",
      });
    });

    it("makes a step a finding when its address is one the parser would repair, on its own host", () => {
      const repaired = `https:/${slackHosts[0]}/archives/C1/p1`;
      expect(placer.repairedAddresses({ values: [repaired, `https://${slackHosts[0]}/archives/C1/p1`] })).toEqual([
        repaired,
      ]);
      const step = { cites: [repaired], context: undefined, row: undefined, url: undefined, where: undefined };
      expect(handPlacement({ placer, rows: [], step }).kind).toBe("unplaced");
    });
  },
);

describe("an organisation that also owns this build's repository, where console placement reads only the row", () => {
  const placer = buildWorkspacePlacer({ organisation: { ...ACME_PLACEMENT, selfRepository: "acme/slopweaver" } });

  it("places this build's repository in self, ahead of the owner, and the owner's other repositories in team", () => {
    expect([
      placer.repositoryEvidence({ value: "https://github.com/acme/slopweaver/pull/1" }),
      placer.repositoryEvidence({ value: "https://github.com/acme/acme-admin/pull/7" }),
    ]).toEqual([
      { source: "repository", value: "acme/slopweaver", workspace: "self" },
      { source: "repository", value: "acme/acme-admin", workspace: "team" },
    ]);
  });
});

describe("an organisation with no Slack, where no conversation is the team's", () => {
  const placer = buildWorkspacePlacer({ organisation: { ...ACME_PLACEMENT, slackHosts: [] } });
  const permalink = "https://acme.slack.com/archives/C1/p1";

  it("reads no Slack permalink as evidence, on any host, while its repositories still place", () => {
    expect([
      placer.slackEvidence({ value: permalink }),
      placer.addressEvidence({ values: [permalink] }),
      placer.repositoryEvidence({ value: "https://github.com/acme/acme-admin/pull/7" }),
    ]).toEqual([undefined, [], { source: "repository", value: "acme/acme-admin", workspace: "team" }]);
  });

  it("never reads a broken Slack address as one it would repair, having no Slack host to repair it onto", () => {
    expect(placer.repairedAddresses({ values: ["https:/acme.slack.com/archives/C1/p1"] })).toEqual([]);
  });
});

describe("an organisation's Linear and Vanta — read when it has them, never when it has none", () => {
  it("places Acme's Linear and Vanta workspaces in team, and another workspace on either nowhere", () => {
    expect([
      ACME_PLACER.linearEvidence({ value: "https://linear.app/acme/issue/ABC-1" }),
      ACME_PLACER.vantaEvidence({ value: "https://app.vanta.com/c/acme/tests" }),
      ACME_PLACER.linearEvidence({ value: "https://linear.app/globex/issue/ABC-1" }),
      ACME_PLACER.vantaEvidence({ value: "https://app.vanta.com/c/globex/tests" }),
    ]).toEqual([
      { source: "linear-workspace", value: "linear.app/acme", workspace: "team" },
      { source: "vanta-workspace", value: "app.vanta.com/c/acme", workspace: "team" },
      undefined,
      undefined,
    ]);
  });

  it("reads no Linear or Vanta address at all for Globex, which has neither, never a default workspace", () => {
    const addresses = ["https://linear.app/globex/issue/ABC-1", "https://app.vanta.com/c/globex/tests"];
    expect([
      GLOBEX_PLACER.linearEvidence({ value: addresses[0] }),
      GLOBEX_PLACER.vantaEvidence({ value: addresses[1] }),
      GLOBEX_PLACER.addressEvidence({ values: addresses }),
    ]).toEqual([undefined, undefined, []]);
  });
});
