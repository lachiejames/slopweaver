/**
 * The refresh token reads, as they stand: they take no `home` and resolve from the environment plus the
 * AMBIENT home's secrets, so each case points `SLOPWEAVER_HOME` at an empty temp home and restores every
 * variable it touched. Slack's read token is the user token when there is one, else the bot token with the
 * limited-visibility warning.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resolveTokens, slackReadToken } from "../../../../../cli/commands/refresh/tokens.js";

/** Every variable these reads consult, saved and restored around each case. */
const TOUCHED = [
  "SLOPWEAVER_HOME",
  "SLACK_USER_TOKEN",
  "SLACK_BOT_TOKEN",
  "LINEAR_API_KEY",
  "LINEAR_TOKEN",
  "NOTION_TOKEN",
  "NOTION_API_KEY",
] as const;

const BOT_WARNING =
  "slack: using a bot token — channel visibility is limited to bot-invited channels; set SLACK_USER_TOKEN for full read access";

let home = "";
let saved = new Map<string, string | undefined>();

beforeEach(() => {
  saved = new Map(TOUCHED.map((name) => [name, process.env[name]]));
  for (const name of TOUCHED) {
    delete process.env[name];
  }
  home = mkdtempSync(join(tmpdir(), "tokens-"));
  process.env["SLOPWEAVER_HOME"] = home;
});

afterEach(() => {
  for (const [name, value] of saved) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
  rmSync(home, { force: true, recursive: true });
});

describe("slackReadToken", () => {
  it("answers the user token, with no warning key, when both Slack tokens are set", () => {
    process.env["SLACK_USER_TOKEN"] = "xoxp-user";
    process.env["SLACK_BOT_TOKEN"] = "xoxb-bot";

    expect(slackReadToken()).toStrictEqual({ token: "xoxp-user" });
  });

  it("answers the bot token with the limited-visibility warning when it is the only one", () => {
    process.env["SLACK_BOT_TOKEN"] = "xoxb-bot";

    expect(slackReadToken()).toStrictEqual({ token: "xoxb-bot", warning: BOT_WARNING });
  });

  it("answers an empty object when neither Slack token is configured", () => {
    expect(slackReadToken()).toStrictEqual({});
  });
});

describe("resolveTokens", () => {
  it("answers all three sources undefined over an empty home and an empty environment", () => {
    expect(resolveTokens()).toStrictEqual({ linear: undefined, notion: undefined, slack: undefined });
  });

  it("answers each source's own token from the environment", () => {
    process.env["LINEAR_API_KEY"] = "lin-key";
    process.env["NOTION_TOKEN"] = "notion-key";
    process.env["SLACK_USER_TOKEN"] = "xoxp-user";

    expect(resolveTokens()).toStrictEqual({ linear: "lin-key", notion: "notion-key", slack: "xoxp-user" });
  });

  it("answers Slack's bot token for the slack source when it is the only Slack token", () => {
    process.env["SLACK_BOT_TOKEN"] = "xoxb-bot";

    expect(resolveTokens()).toStrictEqual({ linear: undefined, notion: undefined, slack: "xoxb-bot" });
  });
});
