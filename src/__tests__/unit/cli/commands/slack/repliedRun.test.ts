/**
 * `slack replied`'s shell: the usage and its exit contract, refused before any read, and the could-not-check a home
 * with no Slack token gives — never "not yet", so an ask's done-check that could not look never reads as undone.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { parseSlackRepliedArgs, SlackRepliedArgsErrors } from "../../../../../cli/commands/slack/repliedArgs.js";
import { checkOwnerReply, OWNER_REPLY_DEADLINE_MS } from "../../../../../cli/commands/slack/repliedRead.js";
import { runSlackReplied } from "../../../../../cli/commands/slack/repliedRun.js";
import { SLACK_REPLIED_USAGE } from "../../../../../cli/commands/slack/repliedUsage.js";
import { EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

const LINK = "https://acme.slack.com/archives/C123/p1785114398557099";
const minted: string[] = [];

afterEach(() => {
  for (const dir of minted.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

describe("SLACK_REPLIED_USAGE", () => {
  it("states all three answers and their exits", () => {
    expect(SLACK_REPLIED_USAGE).toContain("`replied at <iso>: <reply link>` and exits 0");
    expect(SLACK_REPLIED_USAGE).toContain("`not yet: …` and exits 3");
    expect(SLACK_REPLIED_USAGE).toContain("`could not check: <why>` on stderr and exits 1");
  });
});

describe("runSlackReplied", () => {
  it("prints its usage on --help", async () => {
    expect(await runSlackReplied(["node", "slopweaver", "slack", "replied", "--help"])).toBe(EXIT_OK);
  });

  it("refuses a missing --url as a usage mistake", async () => {
    expect(await runSlackReplied(["node", "slopweaver", "slack", "replied", "--json"])).toBe(EXIT_USAGE);
  });
});

describe("parseSlackRepliedArgs", () => {
  it("names a missing link, an over-long one and a bad flag, each by its own code", () => {
    const missing = parseSlackRepliedArgs({ rest: ["--json"] });
    const long = parseSlackRepliedArgs({ rest: ["--url", "x".repeat(2001)] });
    const flag = parseSlackRepliedArgs({ rest: ["--url", LINK, "--nope"] });

    expect(unwrapErr(missing)).toEqual(SlackRepliedArgsErrors.urlMissing());
    expect(unwrapErr(long)).toEqual(SlackRepliedArgsErrors.urlTooLong());
    expect(unwrapErr(flag).code).toBe("FLAGS_INVALID");
  });

  it("reads the link, the home and --json", () => {
    expect(unwrap(parseSlackRepliedArgs({ rest: ["--url", LINK, "--home", "/h", "--json"] }))).toEqual({
      home: "/h",
      json: true,
      url: LINK,
    });
  });
});

describe("checkOwnerReply", () => {
  it("reads could-not-check, naming the fix, when the home holds no Slack token", async () => {
    const home = mkdtempSync(join(tmpdir(), "replied-"));
    minted.push(home);

    expect(await checkOwnerReply({ home, permalink: LINK })).toEqual({
      kind: "could-not-check",
      why: "no Slack token is configured — run `slopweaver connect slack`",
    });
  });

  it("gives up well inside a tick reading's budget", () => {
    expect(OWNER_REPLY_DEADLINE_MS).toBe(14_000);
  });
});
