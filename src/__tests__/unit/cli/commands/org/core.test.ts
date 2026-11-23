/** `org set|show`'s flags: the whole organisation stated on every write, absence said rather than left out. */
import { describe, expect, it } from "vitest";

import { orgSetArgs, orgShowArgs } from "../../../../../cli/commands/org/core.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

const WHOLE = [
  "--display-name",
  "Acme",
  "--github-owner",
  "Acme",
  "--google-domain",
  "acme.com",
  "--slack-host",
  "acme.slack.com",
  "--slack-host",
  "acme-eng.slack.com",
  "--linear-workspace",
  "acme",
  "--vanta-workspace",
  "acme",
  "--repository",
  "acme/acme-admin",
  "--dependency-bot",
  "acme-bot",
];

describe("orgSetArgs", () => {
  it("reads the whole organisation, every repeated flag kept and every value lowercased", () => {
    expect(unwrap(orgSetArgs({ rest: [...WHOLE, "--home", "/h", "--json"] }))).toEqual({
      home: "/h",
      json: true,
      record: {
        dependencyBots: ["acme-bot"],
        displayName: "Acme",
        githubOwner: "acme",
        googleDomain: "acme.com",
        linearWorkspace: "acme",
        repositories: ["acme/acme-admin"],
        slackHosts: ["acme.slack.com", "acme-eng.slack.com"],
        vantaWorkspace: "acme",
      },
    });
  });

  it("writes a stated absence as null, and no dependency bot as an empty list", () => {
    const record = unwrap(
      orgSetArgs({
        rest: [
          "--display-name",
          "Globex",
          "--github-owner",
          "globex",
          "--without-google",
          "--slack-host",
          "globex.slack.com",
          "--without-linear",
          "--without-vanta",
          "--repository",
          "globex/web",
        ],
      }),
    ).record;
    expect([record.googleDomain, record.linearWorkspace, record.vantaWorkspace, record.dependencyBots]).toEqual([
      null,
      null,
      null,
      [],
    ]);
  });

  it("refuses a flag left out, naming every one at once, since a row may never hold a field nobody wrote", () => {
    expect(
      unwrapErr(orgSetArgs({ rest: ["--slack-host", "acme.slack.com", "--repository", "acme/acme-admin"] })),
    ).toEqual([
      "--display-name is required: org set writes the whole organisation every time",
      "--github-owner is required: org set writes the whole organisation every time",
      "pass --google-domain <value>, or --without-google when the organisation has none",
      "pass --linear-workspace <value>, or --without-linear when the organisation has none",
      "pass --vanta-workspace <value>, or --without-vanta when the organisation has none",
    ]);
  });

  it("refuses a value and its stated absence together", () => {
    expect(unwrapErr(orgSetArgs({ rest: [...WHOLE, "--without-linear"] }))).toEqual([
      "--linear-workspace and --without-linear contradict each other: pass one",
    ]);
  });

  it("writes an organisation with no Slack as zero hosts when --without-slack states it", () => {
    const rest = [...WHOLE.filter((one) => one !== "--slack-host" && !one.endsWith(".slack.com")), "--without-slack"];
    expect(unwrap(orgSetArgs({ rest })).record.slackHosts).toEqual([]);
  });

  it("refuses an organisation whose Slack is neither listed nor stated absent", () => {
    const rest = WHOLE.filter((one) => one !== "--slack-host" && !one.endsWith(".slack.com"));
    expect(unwrapErr(orgSetArgs({ rest }))).toEqual([
      "pass --slack-host <host> (repeatable), or --without-slack when the organisation has none",
    ]);
  });

  it("refuses a Slack host beside --without-slack", () => {
    expect(unwrapErr(orgSetArgs({ rest: [...WHOLE, "--without-slack"] }))).toEqual([
      "--slack-host and --without-slack contradict each other: pass one",
    ]);
  });

  it("refuses a repository written as a URL, through the record's own validation", () => {
    const rest = WHOLE.map((one) => (one === "acme/acme-admin" ? "https://github.com/acme/acme-admin" : one));
    expect(unwrapErr(orgSetArgs({ rest }))).toEqual([
      "the organisation does not read: repositories.0: must be a lowercase owner/repo",
    ]);
  });
});

describe("orgShowArgs", () => {
  it("reads --json and --home, and neither by default", () => {
    expect([unwrap(orgShowArgs({ rest: ["--json", "--home", "/h"] })), unwrap(orgShowArgs({ rest: [] }))]).toEqual([
      { home: "/h", json: true },
      { home: undefined, json: false },
    ]);
  });
});
