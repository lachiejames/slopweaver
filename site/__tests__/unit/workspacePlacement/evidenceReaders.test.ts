import { describe, expect, it } from "vitest";

import { indexBoardRows } from "../../../lib/boardRowIndex";
import { actPlacement, handPlacement } from "../../../lib/registerPlacement";
import { prPlacement } from "../../../lib/registerPlacementDirect";
import { findingLabel } from "../../../lib/workspacePlacementContext";
import { ACME_PLACER } from "../../organisationFixture";
import { ACME_ADMIN_PR, BARE } from "./fixtures";

describe("the evidence readers — each reads a WHOLE value, never a slug found inside text", () => {
  it("reads a github.com URL and an exact owner/repo(#n), lowercased", () => {
    expect(ACME_PLACER.repositoryEvidence({ value: ACME_ADMIN_PR })).toEqual({
      source: "repository",
      value: "acme/acme-admin",
      workspace: "team",
    });
    expect(ACME_PLACER.repositoryEvidence({ value: "Octo-Self/Slopweaver#1419" })).toEqual({
      source: "repository",
      value: "octo-self/slopweaver",
      workspace: "self",
    });
  });

  it("reads a clone URL's .git as the same repository", () => {
    expect(ACME_PLACER.repositoryEvidence({ value: "https://github.com/octo-self/slopweaver.git" })).toEqual({
      source: "repository",
      value: "octo-self/slopweaver",
      workspace: "self",
    });
    expect(ACME_PLACER.repositoryEvidence({ value: "octo-self/slopweaver.git" })).toEqual({
      source: "repository",
      value: "octo-self/slopweaver",
      workspace: "self",
    });
  });

  it("reads github.com/<org>/<name> as that repository, GitHub's own routing, and an organisation page as none", () => {
    expect(ACME_PLACER.repositoryEvidence({ value: "https://github.com/acme/settings/pulls" })).toEqual({
      source: "repository",
      value: "acme/settings",
      workspace: "team",
    });
    expect(ACME_PLACER.repositoryEvidence({ value: "https://github.com/orgs/acme/projects/3" })).toBeUndefined();
    expect(ACME_PLACER.repositoryEvidence({ value: "https://github.com/settings/profile" })).toBeUndefined();
    expect(ACME_PLACER.repositoryEvidence({ value: "https://github.com/acme" })).toBeUndefined();
  });

  it("reads a URL as the repository GitHub routes it to: percent-decoded, on either host", () => {
    const slopweaver = { source: "repository", value: "octo-self/slopweaver", workspace: "self" };
    expect(ACME_PLACER.repositoryEvidence({ value: "https://github.com/octo-self/%73lopweaver/pull/1419" })).toEqual(
      slopweaver,
    );
    expect(ACME_PLACER.repositoryEvidence({ value: "https://www.github.com/octo-self/slopweaver/pull/1419" })).toEqual(
      slopweaver,
    );
    expect(ACME_PLACER.repositoryEvidence({ value: "https://github.com./octo-self/slopweaver" })).toEqual(slopweaver);
    expect(ACME_PLACER.repositoryEvidence({ value: "https://github.com/acme/%E0%A4%A/pull/1" })).toBeUndefined();
  });

  it("reads an encoded slash as part of one segment, which names no repository", () => {
    const encoded = "https://github.com/octo-self/slopweaver%2Fpull%2F1";
    expect(ACME_PLACER.repositoryEvidence({ value: encoded })).toBeUndefined();
    expect(ACME_PLACER.slackEvidence({ value: "https://acme.slack.com/archives%2FC123/p1" })).toBeUndefined();
    expect(ACME_PLACER.addressEvidence({ values: [encoded] })).toEqual([]);
    expect(ACME_PLACER.repositoryEvidence({ value: "https://github.com/octo-self/slop%20weaver" })).toBeUndefined();
  });

  it("reads only a web URL as an address: another scheme on a known host names nothing", () => {
    const ftp = "ftp://github.com/octo-self/slopweaver/pull/1";
    expect(ACME_PLACER.repositoryEvidence({ value: "http://github.com/octo-self/slopweaver/pull/1" })).toEqual({
      source: "repository",
      value: "octo-self/slopweaver",
      workspace: "self",
    });
    expect(ACME_PLACER.repositoryEvidence({ value: ftp })).toBeUndefined();
    expect(
      ACME_PLACER.addressEvidence({
        values: [ftp, "ssh://acme.slack.com/archives/C123/p1", "ws://localhost:3000/queue"],
      }),
    ).toEqual([]);
    expect(prPlacement({ placer: ACME_PLACER, row: { repoSlug: "octo-self/slopweaver", url: ftp } }).kind).toBe(
      "unplaced",
    );
  });

  it("reads a link only as it is spelled, never as the URL parser repairs it", () => {
    const repaired = [
      "https:/github.com/acme/acme-admin/pull/16644",
      "https:github.com/acme/acme-admin/pull/16644",
      "https:\\\\github.com\\acme\\acme-admin",
      "https://git\thub.com/acme/acme-admin",
      "https:///github.com/acme/acme-admin",
    ];
    expect(ACME_PLACER.addressEvidence({ values: repaired })).toEqual([]);
    const step = { cites: [], context: undefined, row: undefined, url: undefined, where: repaired[0] };
    expect(handPlacement({ placer: ACME_PLACER, rows: [], step }).kind).toBe("unplaced");
    expect(ACME_PLACER.addressEvidence({ values: ["HTTPS://github.com/acme/acme-admin/pull/16644"] })).toEqual([
      { source: "repository", value: "acme/acme-admin", workspace: "team" },
    ]);
  });

  it("reads the path up to a query or fragment, and a long near-miss as prose (CodeQL alert 123)", () => {
    expect(
      ACME_PLACER.addressEvidence({ values: ["https://github.com/acme/acme-admin/pull/16644?tab=files#diff-1"] }),
    ).toEqual([{ source: "repository", value: "acme/acme-admin", workspace: "team" }]);
    expect(ACME_PLACER.addressEvidence({ values: [`https://github.com/${"a/".repeat(20_000)}\\`] })).toEqual([]);
  });

  it("reads a host or path the parser would rewrite as prose, never as the address it rewrites to", () => {
    const rewritten = [
      "https://github。com/octo-self/slopweaver/pull/1",
      "https://ｇithub.com/octo-self/slopweaver/pull/1",
      "https://github.com/octo-self/acme-admin/../slopweaver/pull/1",
      "https://github.com/octo-self/./slopweaver",
      "https://someone@github.com/octo-self/slopweaver",
      "https://github.com:443/octo-self/slopweaver",
      "https://github.com/octo-self/slopéweaver",
      "https://acme.slack.com/archives/C123/p1 ",
    ];
    expect(ACME_PLACER.addressEvidence({ values: rewritten })).toEqual([]);
    const step = { cites: [], context: undefined, row: undefined, url: undefined, where: rewritten[0] };
    expect(handPlacement({ placer: ACME_PLACER, rows: [], step }).kind).toBe("unplaced");
    expect(ACME_PLACER.addressEvidence({ values: ["https://GitHub.com/octo-self/slopweaver"] })).toEqual([
      { source: "repository", value: "octo-self/slopweaver", workspace: "self" },
    ]);
  });

  it("reads no repository where the name is nothing once its clone suffix is gone", () => {
    const nameless = [
      "https://github.com/acme/.git",
      "acme/.git",
      "acme/..",
      "acme/.",
      "https://github.com/acme/%2E%2E/pull/1",
    ];
    expect(ACME_PLACER.addressEvidence({ values: nameless })).toEqual([]);
    const step = { cites: [nameless[0]], context: undefined, row: undefined, url: undefined, where: undefined };
    expect(handPlacement({ placer: ACME_PLACER, rows: [], step }).kind).toBe("unplaced");
  });

  it("holds a decoded segment to the alphabet a written one keeps", () => {
    const encoded = [
      "https://github.com/octo-self/slopweaver/%5C/x",
      "https://github.com/octo-self/slopweaver/%09",
      "https://github.com/octo-self/slopweaver/%C3%A9",
      "https://acme.slack.com/archives/C123/p1%20",
    ];
    expect(ACME_PLACER.addressEvidence({ values: encoded })).toEqual([]);
    const step = { cites: [encoded[0]], context: undefined, row: undefined, url: undefined, where: undefined };
    expect(handPlacement({ placer: ACME_PLACER, rows: [], step }).kind).toBe("unplaced");
  });

  it("reads a host on another port as another server, never the one on the default", () => {
    const ported = [
      "https://github.com:444/octo-self/slopweaver/pull/1",
      "https://acme.slack.com:8443/archives/C123/p1",
      "https://linear.app:444/acme/issue/INFR-1",
    ];
    expect(ACME_PLACER.addressEvidence({ values: ported })).toEqual([]);
    const step = { cites: [], context: undefined, row: undefined, url: undefined, where: ported[0] };
    expect(handPlacement({ placer: ACME_PLACER, rows: [], step }).kind).toBe("unplaced");
  });

  it("drops a clone address's .git only where the value ends at it", () => {
    const slopweaver = { source: "repository", value: "octo-self/slopweaver", workspace: "self" };
    expect(ACME_PLACER.repositoryEvidence({ value: "https://github.com/octo-self/slopweaver.git" })).toEqual(
      slopweaver,
    );
    expect(ACME_PLACER.repositoryEvidence({ value: "octo-self/slopweaver.git" })).toEqual(slopweaver);
    expect(
      ACME_PLACER.addressEvidence({
        values: ["https://github.com/octo-self/slopweaver.git/issues", "octo-self/slopweaver.git#12"],
      }),
    ).toEqual([]);
    const step = {
      cites: ["https://github.com/octo-self/slopweaver.git/issues"],
      context: undefined,
      row: undefined,
      url: undefined,
      where: undefined,
    };
    expect(handPlacement({ placer: ACME_PLACER, rows: [], step }).kind).toBe("unplaced");
  });

  it("reads a path with an empty segment inside it as naming no page, never collapsed", () => {
    const doubled = [
      "https://acme.slack.com/archives//C123/p1",
      "https://github.com//octo-self/slopweaver",
      "https://github.com/octo-self//slopweaver/pull/1",
      "https://linear.app//acme/issue/INFR-1",
    ];
    expect(ACME_PLACER.addressEvidence({ values: doubled })).toEqual([]);
    const step = { cites: [doubled[0]], context: undefined, row: undefined, url: undefined, where: undefined };
    expect(handPlacement({ placer: ACME_PLACER, rows: [], step }).kind).toBe("unplaced");
    expect(ACME_PLACER.addressEvidence({ values: ["https://github.com/octo-self/slopweaver/"] })).toEqual([
      { source: "repository", value: "octo-self/slopweaver", workspace: "self" },
    ]);
  });

  it("reads a value with whitespace around it as prose, never trimmed into an address", () => {
    const padded = " https://github.com/octo-self/slopweaver/pull/1 ";
    expect(
      ACME_PLACER.addressEvidence({ values: [padded, " octo-self/slopweaver", "octo-self/slopweaver\n"] }),
    ).toEqual([]);
    const step = { cites: [], context: undefined, row: undefined, url: undefined, where: padded };
    expect(handPlacement({ placer: ACME_PLACER, rows: [], step }).kind).toBe("unplaced");
  });

  it("reads every other address through the same routing, so no encoding hides one", () => {
    expect(ACME_PLACER.slackEvidence({ value: "https://acme.slack.com/%61rchives/C123/p1" })).toEqual({
      source: "slack-workspace",
      value: "acme.slack.com/archives/C123/p1",
      workspace: "team",
    });
    expect(ACME_PLACER.linearEvidence({ value: "https://linear.app/%61cme/issue/INFR-1" })!.workspace).toBe("team");
    expect(ACME_PLACER.vantaEvidence({ value: "https://app.vanta.com./c/acme/tests" })!.workspace).toBe("team");
  });

  it("gives nothing for prose naming a repository, or a repository outside the organisation", () => {
    expect(ACME_PLACER.repositoryEvidence({ value: "port this to acme/acme-admin" })).toBeUndefined();
    expect(ACME_PLACER.repositoryEvidence({ value: "https://github.com/vercel/next.js/pull/1" })).toBeUndefined();
    expect(ACME_PLACER.repositoryEvidence({ value: "/Users/x/dev/personal/slopweaver" })).toBeUndefined();
  });

  it("reads a slopweaver under any other owner as neither, so only this instance's own repository is self", () => {
    expect(ACME_PLACER.repositoryEvidence({ value: "someone-else/slopweaver" })).toBeUndefined();
    expect(
      ACME_PLACER.repositoryEvidence({ value: "https://github.com/someone-else/slopweaver/pull/1" }),
    ).toBeUndefined();
  });

  it("reads the organisation's Slack hosts and no other", () => {
    expect(ACME_PLACER.slackEvidence({ value: "https://acme.slack.com/archives/C1/p1" })).toEqual({
      source: "slack-workspace",
      value: "acme.slack.com/archives/C1/p1",
      workspace: "team",
    });
    expect(ACME_PLACER.slackEvidence({ value: "https://other.slack.com/archives/C1/p1" })).toBeUndefined();
  });

  it("names the permalink a stated workspace overrules, so two threads on one host read apart", () => {
    const placement = handPlacement({
      placer: ACME_PLACER,
      rows: [],
      step: {
        url: undefined,
        where: undefined,
        row: undefined,
        cites: ["https://acme.slack.com/archives/C0SYN1234567/p1234567890000000"],
        context: "slopweaver",
      },
    });
    expect(findingLabel({ placement })).toEqual({
      label: "stated over a conflict",
      title: "stated self, overruling: slack-workspace acme.slack.com/archives/C0SYN1234567/p1234567890000000 → team",
    });
  });

  it("joins the ask a queue link opens on any spelling of this machine", () => {
    const ask = { ...BARE, slug: "a", workspace: "self" as const };
    const step = {
      cites: [],
      context: undefined,
      row: undefined,
      url: "http://localhost.:3000/queue?open=ask%3Aa",
      where: undefined,
    };
    expect(handPlacement({ placer: ACME_PLACER, rows: [ask], step }).kind).toBe("placed");
    expect(
      handPlacement({
        placer: ACME_PLACER,
        rows: [ask],
        step: { ...step, url: "http://[::1]:3000/queue?open=ask%3Aa" },
      }).kind,
    ).toBe("placed");
    const encoded = { ...step, url: "http://localhost:3000/%71ueue?open=ask%3Aa" };
    expect(handPlacement({ placer: ACME_PLACER, rows: [ask], step: encoded }).kind).toBe("placed");
  });

  it("reads an act's padded link as written, never trimmed into an address", () => {
    const placed = ({ subject }: { subject: string }): string =>
      actPlacement({
        act: { kind: "press-merge-when-ready", run: undefined, subject },
        board: indexBoardRows({ rows: [] }),
        placer: ACME_PLACER,
      }).kind;
    expect(placed({ subject: " https://github.com/octo-self/slopweaver/pull/1 " })).toBe("unplaced");
    expect(placed({ subject: "https://github.com/octo-self/slopweaver/pull/1 merged on green" })).toBe("placed");
  });

  it("makes a record a finding when one address is a link the parser would rewrite", () => {
    const repaired = "https://github.com:443/acme/acme-admin/pull/1";
    const step = {
      cites: [repaired, "https://github.com/octo-self/slopweaver/pull/2"],
      context: undefined,
      row: undefined,
      url: undefined,
      where: undefined,
    };
    expect(handPlacement({ placer: ACME_PLACER, rows: [], step })).toEqual({
      kind: "unplaced",
      why: `its address "${repaired}" is spelt as a link the parser would rewrite (NOT MEASURED)`,
    });
    expect(
      actPlacement({
        act: { kind: "restart-dev-server", run: undefined, subject: "http://localhost:80/queue" },
        board: indexBoardRows({ rows: [] }),
        placer: ACME_PLACER,
      }).kind,
    ).toBe("unplaced");
    expect(
      ACME_PLACER.repairedAddresses({
        values: [
          " https://acme.slack.com/archives/C1/p1",
          "https:/linear.app/acme/issue/INFR-1",
          "https://github.com/octo-self/slopweaver",
          "https://example.com:443/x",
          "ftp://github.com/acme/acme-admin",
          "ftp://example.com/x",
          "not a link at all",
        ],
      }),
    ).toEqual([
      " https://acme.slack.com/archives/C1/p1",
      "https:/linear.app/acme/issue/INFR-1",
      "ftp://github.com/acme/acme-admin",
    ]);
    const stated = { cites: ["ftp://github.com/octo-self/slopweaver/pull/1"], context: "work" as const };
    expect(handPlacement({ placer: ACME_PLACER, rows: [], step: { ...step, ...stated } }).kind).toBe("unplaced");
  });

  it("reads a permalink only where it names a conversation, and a message in it", () => {
    const notPermalinks = [
      "https://acme.slack.com/archives/0",
      "https://acme.slack.com/archives/X123",
      "https://acme.slack.com/archives/c123",
      "https://acme.slack.com/archives",
      "https://acme.slack.com/archives/C123/1720000000",
      "https://acme.slack.com/archives/C123/p1/extra",
    ];
    expect(ACME_PLACER.addressEvidence({ values: notPermalinks })).toEqual([]);
    const step = { cites: [notPermalinks[0]], context: undefined, row: undefined, url: undefined, where: undefined };
    expect(handPlacement({ placer: ACME_PLACER, rows: [], step }).kind).toBe("unplaced");
    expect(ACME_PLACER.slackEvidence({ value: "https://acme.slack.com/archives/G0AB12/p1" })!.workspace).toBe("team");
  });

  it("reads a permalink on the organisation's Slack host, and no other link on it", () => {
    expect(ACME_PLACER.slackEvidence({ value: "https://acme.slack.com/archives/D09ABC" })!.workspace).toBe("team");
    expect(ACME_PLACER.slackEvidence({ value: "https://acme.slack.com/not-a-permalink" })).toBeUndefined();
    expect(ACME_PLACER.slackEvidence({ value: "https://acme.slack.com/docs/T1/F1" })).toBeUndefined();
  });

  it("reads a Linear URL in the organisation's workspace, and nothing that is not an address", () => {
    expect(
      ACME_PLACER.addressEvidence({ values: ["https://linear.app/acme/issue/JJJJ-1642", "localhost:3000/queue"] }),
    ).toEqual([{ source: "linear-workspace", value: "linear.app/acme", workspace: "team" }]);
    expect(ACME_PLACER.addressEvidence({ values: ["https://linear.app/someone-else/issue/X-1"] })).toEqual([]);
  });
});
