import { describe, expect, it } from "vitest";

import { slackClientWorkspaceId } from "../../../../../atlas/slackApi/clientRoots.js";
import { SlackArgumentErrors, slackArgumentErrorLines } from "../../../../../cli/commands/slack/argumentErrors.js";
import {
  classifySlackShotTarget,
  renderSlackShotReport,
  resolveSlackShotOptions,
  SLACK_CLIENT_ORIGIN,
  SLACK_SHOT_DEFAULT_SETTLE_MS,
  SLACK_SHOT_MAX_SETTLE_MS,
  type SlackShotReport,
  slackClientUrl,
  slackShotOrigins,
} from "../../../../../cli/commands/slack/shotCore.js";
import { runSlackShot, SLACK_SHOT_LEASE_PLATFORM } from "../../../../../cli/commands/slack/shotRun.js";
import { EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

const PERMALINK = "https://acme.slack.com/archives/D0SYN000001/p1789176080417389";

function options(over: Record<string, string | boolean | undefined> = {}) {
  return {
    home: undefined,
    json: false,
    out: "/tmp/shot.png",
    settle: undefined,
    url: PERMALINK,
    ...over,
  } as Parameters<typeof resolveSlackShotOptions>[0];
}

describe("classifySlackShotTarget", () => {
  it("accepts a message permalink and returns the conversation and timestamp", () => {
    const target = unwrap(classifySlackShotTarget({ url: PERMALINK }));

    expect(target.channel).toBe("D0SYN000001");
    expect(target.messageTs).toBe("1789176080.417389");
  });

  it("REFUSES a Slack page that is not a message, and says what it takes instead", () => {
    expect(unwrapErr(classifySlackShotTarget({ url: "https://acme.slack.com/admin/settings" })).code).toBe(
      "TARGET_REFUSED",
    );
    const problems = slackArgumentErrorLines({
      error: unwrapErr(classifySlackShotTarget({ url: "https://acme.slack.com/admin/settings" })),
    });

    expect(problems[1]!).toContain("photographs ONE rendered message");
  });

  it("REFUSES an address that is not Slack at all", () => {
    expect(
      slackArgumentErrorLines({ error: unwrapErr(classifySlackShotTarget({ url: "https://example.invalid/a" })) })[0],
    ).toBe("not a Slack host: example.invalid");
  });
});

describe("slackClientWorkspaceId", () => {
  it("uses the ENTERPRISE id on a grid — measured: the team id redirected to the activity inbox", () => {
    expect(slackClientWorkspaceId({ enterpriseId: "E1", teamId: "T1" })).toBe("E1");
  });

  it("uses the team id when the workspace is not on a grid", () => {
    expect(slackClientWorkspaceId({ enterpriseId: undefined, teamId: "T1" })).toBe("T1");
  });

  it("treats an EMPTY enterprise id as absent rather than as a workspace called nothing", () => {
    expect(slackClientWorkspaceId({ enterpriseId: "", teamId: "T1" })).toBe("T1");
  });
});

describe("slackClientUrl", () => {
  it("builds the CONVERSATION route, never the per-message one", () => {
    expect(slackClientUrl({ channel: "D1", workspaceId: "E1" })).toBe(`${SLACK_CLIENT_ORIGIN}/client/E1/D1`);
  });
});

describe("slackShotOrigins", () => {
  it("leases the workspace origin AND the client origin, because the permalink redirects across them", () => {
    expect(slackShotOrigins({ url: PERMALINK })).toEqual(["https://acme.slack.com", SLACK_CLIENT_ORIGIN]);
  });
});

describe("resolveSlackShotOptions", () => {
  it("defaults the settle and carries the parsed message identity", () => {
    const resolved = unwrap(resolveSlackShotOptions(options()));

    expect(resolved.settleMs).toBe(SLACK_SHOT_DEFAULT_SETTLE_MS);
    expect(resolved.channel).toBe("D0SYN000001");
    expect(resolved.messageTs).toBe("1789176080.417389");
  });

  it("REFUSES an --out that is not a .png", () => {
    expect(
      slackArgumentErrorLines({ error: unwrapErr(resolveSlackShotOptions(options({ out: "/tmp/shot.jpg" }))) }).join(
        " ",
      ),
    ).toContain("takes a .png");
  });

  it("REFUSES a settle over the ceiling, naming it", () => {
    const problems = slackArgumentErrorLines({
      error: unwrapErr(resolveSlackShotOptions(options({ settle: String(SLACK_SHOT_MAX_SETTLE_MS + 1) }))),
    });

    expect(problems.join(" ")).toContain(String(SLACK_SHOT_MAX_SETTLE_MS));
  });

  it("REFUSES a non-numeric settle", () => {
    expect(unwrapErr(resolveSlackShotOptions(options({ settle: "soon" })))).toEqual(
      SlackArgumentErrors.argumentsRefused({ reasons: ["--settle takes whole milliseconds, got 'soon'"] }),
    );
    expect(slackArgumentErrorLines({ error: unwrapErr(resolveSlackShotOptions(options({ settle: "soon" }))) })).toEqual(
      ["--settle takes whole milliseconds, got 'soon'"],
    );
  });

  it("accumulates EVERY rejection rather than stopping at the first", () => {
    const problems = slackArgumentErrorLines({
      error: unwrapErr(resolveSlackShotOptions(options({ out: "x.jpg", settle: "soon", url: undefined }))),
    });

    expect(problems.length).toBe(3);
  });
});

describe("renderSlackShotReport", () => {
  function report(over: Partial<SlackShotReport> = {}): SlackShotReport {
    return {
      because: null,
      bytes: 1024,
      channel: "D1",
      finalUrl: `${SLACK_CLIENT_ORIGIN}/client/E1/D1`,
      messageTs: "1789176080.417389",
      outcome: "photographed",
      path: "/tmp/shot.png",
      statusCode: 200,
      title: "the bot (DM)",
      url: PERMALINK,
      ...over,
    };
  }

  it("names the outcome on the FIRST line, including on the successful path", () => {
    expect(renderSlackShotReport({ report: report() })[0]!).toContain("photographed");
  });

  it("carries the one-layout caveat whenever a picture exists, so it cannot be over-quoted", () => {
    expect(renderSlackShotReport({ report: report() }).join("\n")).toContain("ONE layout's answer");
  });

  it("says the picture is of the NEWEST messages, so an older one is known to be out of frame", () => {
    expect(renderSlackShotReport({ report: report() }).join("\n")).toContain("NEWEST messages");
  });

  it("prints the reason and no caveat when there is no picture", () => {
    const lines = renderSlackShotReport({
      report: report({ because: "the relay is held by a walk", bytes: null, outcome: "relay-unavailable", path: null }),
    });

    expect(lines.join("\n")).toContain("the relay is held by a walk");
    // The caveat belongs to a PICTURE. Printing it beside a failure would claim a layout was measured when
    // nothing was photographed at all.
    expect(lines.join("\n")).not.toContain("ONE layout's answer");
  });
});

describe("the shot command module the manifest dispatches", () => {
  it("takes its relay lease under a name that says a VERB holds the tab, not an atlas walk", () => {
    expect(SLACK_SHOT_LEASE_PLATFORM).toBe("slack shot");
  });

  it("REFUSES a non-message address before any browser is attached, at the usage exit code", async () => {
    const code = await runSlackShot({ rest: ["https://acme.slack.com/admin", "--out", "/tmp/x.png"] });

    expect(code).toBe(EXIT_USAGE);
  });

  it("REFUSES a second permalink rather than silently photographing the first", async () => {
    const code = await runSlackShot({ rest: [PERMALINK, PERMALINK, "--out", "/tmp/x.png"] });

    expect(code).toBe(EXIT_USAGE);
  });

  it("REFUSES an unknown flag rather than ignoring it", async () => {
    const code = await runSlackShot({ rest: [PERMALINK, "--out", "/tmp/x.png", "--width", "1280"] });

    expect(code).toBe(EXIT_USAGE);
  });

  it("REFUSES an --out that is not a .png before it opens anything", async () => {
    const code = await runSlackShot({ rest: [PERMALINK, "--out", "/tmp/x.jpg"] });

    expect(code).toBe(EXIT_USAGE);
  });
});
