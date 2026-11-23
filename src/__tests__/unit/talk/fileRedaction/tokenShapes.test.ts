/*
 * What `file_read` masks before a window leaves the machine: each provider token shape counted by label, a whole
 * private key block, a secret-named assignment and a denylisted string. Every secret-shaped fixture is assembled
 * at run time, so this file is not itself a hit for the hygiene gate it exercises.
 */
import { describe, expect, it } from "vitest";

import { redactCredentials } from "../../../../talk/fileRedaction.js";
import { GITHUB, SLACK } from "./harness.js";

const ANTHROPIC = `${["sk", "-ant-"].join("")}${"b2".repeat(20)}`;
const AWS_ID = `${["AK", "IA"].join("")}${"ABCDEFGHIJKLMNOP"}`;
const KEY_HEAD = ["-----BEGIN", "OPENSSH PRIVATE KEY-----"].join(" ");
const KEY_END = ["-----END", "OPENSSH PRIVATE KEY-----"].join(" ");

describe("redactCredentials", () => {
  it("masks each token shape in place and counts it by label", () => {
    const masked = redactCredentials({
      denylist: [],
      source: false,
      text: `slack ${SLACK}\ngh ${GITHUB} and ${GITHUB}\n${ANTHROPIC}\n${AWS_ID}\n`,
    });
    expect(masked.text).toBe(
      "slack [redacted:slack-token]\ngh [redacted:github-token] and [redacted:github-token]\n" +
        "[redacted:anthropic-key]\n[redacted:aws-key-id]\n",
    );
    expect(masked.redactions).toEqual([
      { count: 1, label: "slack-token" },
      { count: 2, label: "github-token" },
      { count: 1, label: "anthropic-key" },
      { count: 1, label: "aws-key-id" },
    ]);
  });

  it("masks a whole private key block, and a window that starts inside one", () => {
    const block = `before\n${KEY_HEAD}\nb3BlbnNzaC1rZXktdjE\n${KEY_END}\nafter\n`;
    expect(redactCredentials({ denylist: [], source: false, text: block }).text).toBe(
      "before\n[redacted:private-key]\nafter\n",
    );
    const tail = `b3BlbnNzaC1rZXktdjE\n${KEY_END}\nafter\n`;
    expect(redactCredentials({ denylist: [], source: false, text: tail }).text).toBe("[redacted:private-key]\nafter\n");
  });

  it("masks a secret-named assignment's value but keeps code that only names one", () => {
    const text = 'API_KEY="abc123def456ghi789"\nconst token = await fetchToken();\nprocess.env.SLACK_TOKEN\n';
    expect(redactCredentials({ denylist: [], source: false, text }).text).toBe(
      'API_KEY="[redacted:secret-env]"\nconst token = await fetchToken();\nprocess.env.SLACK_TOKEN\n',
    );
  });

  it("masks every denylisted string, case-insensitively, and skips a blank entry", () => {
    const masked = redactCredentials({
      denylist: ["Hunter2.Plus", " "],
      source: false,
      text: "pw hunter2.plus and HUNTER2.PLUS",
    });
    expect(masked.text).toBe("pw [redacted:denylist] and [redacted:denylist]");
    expect(masked.redactions).toEqual([{ count: 2, label: "denylist" }]);
  });
});
