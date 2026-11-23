import { describe, expect, it } from "vitest";
import { githubVerbErrorLines } from "../../../../../cli/commands/github/errors.js";

import { parseGithubThreadArgs, threadDoorRequest } from "../../../../../cli/commands/github/threadCore.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

const ADDRESS = ["--repo", "o/r", "--number", "7"];

describe("parseGithubThreadArgs", () => {
  it("refuses an unrecognised sub-verb before parsing anything else", () => {
    expect(
      githubVerbErrorLines({ error: unwrapErr(parseGithubThreadArgs({ argv: ["dismiss", ...ADDRESS] })) }),
    ).toEqual(["usage: slopweaver github thread <list|reply|resolve|reopen> [...]"]);
  });

  it("parses list, which addresses the pull request and nothing narrower", () => {
    expect(unwrap(parseGithubThreadArgs({ argv: ["list", ...ADDRESS] }))).toEqual({
      dryRun: false,
      full: false,
      home: undefined,
      json: false,
      number: 7,
      openOnly: false,
      owner: "o",
      repo: "r",
      subVerb: "list",
    });
  });

  it("refuses the answer flags on list rather than ignoring them", () => {
    expect(
      githubVerbErrorLines({
        error: unwrapErr(
          parseGithubThreadArgs({ argv: ["list", ...ADDRESS, "--thread", "T1", "--body", "hi", "--resolve"] }),
        ),
      }),
    ).toEqual(["--thread is not a `list` flag", "--body is not a `list` flag", "--resolve is not a `list` flag"]);
  });

  it("parses reply --resolve as one operation carrying both", () => {
    expect(
      unwrap(parseGithubThreadArgs({ argv: ["reply", ...ADDRESS, "--thread", "T1", "--body", "hi", "--resolve"] })),
    ).toEqual({
      body: "hi",
      dryRun: false,
      home: undefined,
      json: false,
      number: 7,
      owner: "o",
      repo: "r",
      resolve: true,
      subVerb: "reply",
      threadId: "T1",
    });
  });

  it("requires a thread and a body for reply", () => {
    expect(githubVerbErrorLines({ error: unwrapErr(parseGithubThreadArgs({ argv: ["reply", ...ADDRESS] })) })).toEqual([
      "--thread <id> is required",
      "--body <text|-> is required for `reply`",
    ]);
  });

  it("resolves without a body, and refuses one", () => {
    expect(unwrap(parseGithubThreadArgs({ argv: ["resolve", ...ADDRESS, "--thread", "T1"] }))).toEqual({
      body: undefined,
      dryRun: false,
      home: undefined,
      json: false,
      number: 7,
      owner: "o",
      repo: "r",
      resolve: true,
      subVerb: "resolve",
      threadId: "T1",
    });
    expect(
      githubVerbErrorLines({
        error: unwrapErr(parseGithubThreadArgs({ argv: ["resolve", ...ADDRESS, "--thread", "T1", "--body", "x"] })),
      }),
    ).toEqual(["--body is not a `resolve` flag; use `reply --resolve`"]);
  });
});

describe("threadDoorRequest", () => {
  it("addresses the exact thread as the door artifact and marks the write external", () => {
    expect(
      threadDoorRequest({
        args: {
          body: "hi",
          dryRun: false,
          home: undefined,
          json: false,
          number: 7,
          owner: "o",
          repo: "r",
          resolve: true,
          subVerb: "reply",
          threadId: "T1",
        },
        home: "/tmp/home",
      }),
    ).toEqual({
      action: { kind: "verb", noun: "github", verb: "thread reply" },
      artifact: { id: "o/r#7 T1" },
      meta: { createsWorkItem: false, effect: "external-write", home: "/tmp/home", requiresApproval: false },
    });
  });
});

describe("parseGithubThreadArgs list filters", () => {
  it("parses --open and --full on list", () => {
    const parsed = unwrap(parseGithubThreadArgs({ argv: ["list", ...ADDRESS, "--open", "--full"] }));
    expect(parsed).toEqual({
      dryRun: false,
      full: true,
      home: undefined,
      json: false,
      number: 7,
      openOnly: true,
      owner: "o",
      repo: "r",
      subVerb: "list",
    });
  });

  it("refuses --open and --full on an answer, which addresses one thread already", () => {
    expect(
      githubVerbErrorLines({
        error: unwrapErr(
          parseGithubThreadArgs({ argv: ["resolve", ...ADDRESS, "--thread", "T1", "--open", "--full"] }),
        ),
      }),
    ).toEqual(["--open is not a `resolve` flag", "--full is not a `resolve` flag"]);
  });
});
