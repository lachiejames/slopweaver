/**
 * Whose work a repository is, on the `src/` side, by the same rule the console places a pull request by
 * (`site/lib/workspacePlacement.ts` § `repositoryEvidence`) — and the register flags a verb passes for it. Every
 * verdict is read off the organisation passed in, so each case that names the team runs against a second organisation
 * too: a reader still holding a constant passes for Acme and fails for Globex.
 */
import { describe, expect, it } from "vitest";

import {
  accountWorkspace,
  repositoryWorkspace,
  slackWorkspace,
  workspaceOfRepository,
  workspaceRegisterArgv,
} from "../../../handover/workspace.js";
import { ACME_ORGANISATION, FIXTURE_SELF_REPOSITORY, GLOBEX_ORGANISATION } from "../../organisationFixture.js";

const acme = ACME_ORGANISATION;
const globex = GLOBEX_ORGANISATION;

describe("slackWorkspace", () => {
  it("reads a permalink on any of the organisation's Slack hosts as the team's", () => {
    expect(
      slackWorkspace({ organisation: acme, permalink: "https://acme.slack.com/archives/C1", what: "a live incident" }),
    ).toEqual({ because: "a live incident is in acme.slack.com, the organisation's Slack", workspace: "team" });
    expect(
      [
        "https://globex.slack.com/archives/C1",
        "https://globex-eng.slack.com/archives/C1",
        "https://acme.slack.com/archives/C1",
      ].map((permalink) => slackWorkspace({ organisation: globex, permalink, what: "x" })?.workspace),
    ).toEqual(["team", "team", undefined]);
  });

  it("states nothing for another workspace, a look-alike host, plain http or a value that is no URL", () => {
    const permalinks = [
      "https://othercompany.slack.com/archives/C1",
      "https://othercompany.enterprise.slack.com/archives/C1",
      "https://acme.slack.com.example/archives/C1",
      "http://acme.slack.com/archives/C1",
      "acme.slack.com/archives/C1",
    ];
    expect(permalinks.map((permalink) => slackWorkspace({ organisation: acme, permalink, what: "x" }))).toEqual(
      permalinks.map(() => undefined),
    );
  });

  it("states nothing for any permalink when the organisation has no Slack: no conversation is the team's", () => {
    const noSlack = { ...acme, slackHosts: [] };
    const permalinks = ["https://acme.slack.com/archives/C1", "https://globex.slack.com/archives/C1"];
    expect(permalinks.map((permalink) => slackWorkspace({ organisation: noSlack, permalink, what: "x" }))).toEqual([
      undefined,
      undefined,
    ]);
  });
});

describe("workspaceOfRepository", () => {
  it("reads this build's own repository, off its origin, as self", () => {
    expect(workspaceOfRepository({ organisation: acme, repository: FIXTURE_SELF_REPOSITORY })).toBe("self");
  });

  it("reads any repository under the organisation's GitHub owner as the team's", () => {
    expect([
      workspaceOfRepository({ organisation: acme, repository: "acme/acme-admin" }),
      workspaceOfRepository({ organisation: globex, repository: "globex/web" }),
      workspaceOfRepository({ organisation: globex, repository: "acme/acme-admin" }),
    ]).toEqual(["team", "team", undefined]);
  });

  it("ignores case, as GitHub does", () => {
    expect(workspaceOfRepository({ organisation: acme, repository: "Octo-Self/SlopWeaver" })).toBe("self");
  });

  it("names nothing for a repository outside the organisation, rather than guessing the team's", () => {
    expect(workspaceOfRepository({ organisation: acme, repository: "octocat/hello-world" })).toBeUndefined();
  });

  it("names nothing for a value that is not an exact owner/repo", () => {
    expect(workspaceOfRepository({ organisation: acme, repository: "acme/acme-admin#12" })).toBeUndefined();
    expect(
      workspaceOfRepository({ organisation: acme, repository: "https://github.com/acme/acme-admin" }),
    ).toBeUndefined();
    expect(workspaceOfRepository({ organisation: acme, repository: "acme-admin" })).toBeUndefined();
    expect(workspaceOfRepository({ organisation: acme, repository: "" })).toBeUndefined();
  });

  it("names nothing for a dot path the name class admits but no repository is called", () => {
    expect(
      ["acme/..", "acme/.", "acme/.git", "acme/...git", "acme/.github"].map((repository) =>
        workspaceOfRepository({ organisation: acme, repository }),
      ),
    ).toEqual([undefined, undefined, undefined, undefined, "team"]);
  });

  it("reads a clone address's repository with its .git dropped, as the console does", () => {
    expect(
      ["octo-self/slopweaver.git", "octo-self/SlopWeaver.GIT", "acme/acme-admin.git"].map((repository) =>
        workspaceOfRepository({ organisation: acme, repository }),
      ),
    ).toEqual(["self", "self", "team"]);
  });
});

describe("repositoryWorkspace", () => {
  it("states the workspace with a reason naming the repository", () => {
    expect(
      repositoryWorkspace({
        organisation: acme,
        repository: "acme/ACME-ADMIN",
        what: "the landing dispatch's pull request",
      }),
    ).toEqual({ because: "the landing dispatch's pull request is in acme/acme-admin", workspace: "team" });
  });

  it("states nothing for a repository outside the organisation", () => {
    expect(
      repositoryWorkspace({ organisation: globex, repository: "acme/acme-admin", what: "the pull request" }),
    ).toBeUndefined();
  });
});

describe("accountWorkspace", () => {
  it("states the team's workspace for an account on the organisation's domain, naming the account", () => {
    expect(accountWorkspace({ account: "Owner@Acme.com", organisation: acme, what: "the mail" })).toEqual({
      because: "the mail is in owner@acme.com, an account on acme.com",
      workspace: "team",
    });
  });

  it("places no account at all for an organisation written with no Google domain", () => {
    expect(accountWorkspace({ account: "owner@acme.com", organisation: globex, what: "the mail" })).toBeUndefined();
  });

  it("states nothing for any other account, or a value that is no address", () => {
    expect(
      [
        "someone@gmail.com",
        "someone@notacme.com.au.example",
        "@acme.com",
        "acme.com",
        "someone@gmail.com@acme.com",
        "some one@acme.com",
      ].map((account) => accountWorkspace({ account, organisation: acme, what: "the mail" })),
    ).toEqual([undefined, undefined, undefined, undefined, undefined, undefined]);
  });
});

describe("workspaceRegisterArgv", () => {
  it("spells the pair `handover register` reads", () => {
    expect(workspaceRegisterArgv({ stated: { because: "it is ours", workspace: "self" } })).toEqual([
      "--workspace",
      "self",
      "--workspace-because",
      "it is ours",
    ]);
  });
});
