/**
 * The done-check `handover register` writes per ask row : a Slack-anchored ask carries
 * `slack replied` against its own anchor, every other ask carries none. The round trip through the board's own
 * parser is the property — `handover currency` recognises the check by exact equality, so a byte the writer puts
 * down and the parser reads back differently would leave every Slack ask reading "declared, not run".
 */
import { describe, expect, it } from "vitest";

import { askRowText } from "../../../cli/commands/handover/askRowText.js";
import { askDoneCommand } from "../../../handover/askDoneCommand.js";
import { checkBareSubVerbSuccessProbes } from "../../../handover/check.js";
import { parseHandoverDoc } from "../../../handover/doc.js";

const SLACK_LINK = "https://acme.slack.com/archives/C0SYN123ABCD/p1785114398557099";
const REPLY_LINK = `${SLACK_LINK}?thread_ts=1785114000.000100&cid=C0SYN123ABCD`;

const written = ({ anchor }: { anchor: string | undefined }): string =>
  askRowText({
    anchor,
    ask: "Should the mirror carry the evidence files themselves?",
    askedIso: "2026-10-02T10:50:00.000Z",
    branch: undefined,
    checkedIso: "2026-10-02T10:51:00.000Z",
    dispatch: false,
    finding: undefined,
    priority: undefined,
    repo: undefined,
    shape: undefined,
    slug: "mirror-evidence-files",
  });

const parsed = ({ text }: { text: string }): ReturnType<typeof parseHandoverDoc> =>
  parseHandoverDoc({ path: "/state/handovers/mirror-evidence-files.md", text });

describe("askDoneCommand", () => {
  it("checks the owner's reply after a Slack message link", () => {
    expect(askDoneCommand({ anchor: SLACK_LINK })).toBe(
      `slopweaver slack replied --url '${SLACK_LINK}' | grep -q '^replied at '`,
    );
  });

  it("keeps a reply link's query, which names the thread", () => {
    expect(askDoneCommand({ anchor: REPLY_LINK })).toBe(
      `slopweaver slack replied --url '${REPLY_LINK}' | grep -q '^replied at '`,
    );
  });

  it("writes none for a transcript anchor, a pull request, or no anchor", () => {
    expect(askDoneCommand({ anchor: "transcript:a0000007#33dac8fe" })).toBeUndefined();
    expect(askDoneCommand({ anchor: "https://github.com/acme/repo/pull/12" })).toBeUndefined();
    expect(askDoneCommand({ anchor: undefined })).toBeUndefined();
  });

  it("writes none for a link carrying a shell character, rather than escaping it", () => {
    expect(askDoneCommand({ anchor: `${SLACK_LINK}'; rm -rf ~; '` })).toBeUndefined();
    expect(askDoneCommand({ anchor: `${SLACK_LINK}$(id)` })).toBeUndefined();
  });
});

describe("askRowText — doneWhen", () => {
  it("round-trips a Slack ask's check through the board's own parser, byte for byte", () => {
    const doc = parsed({ text: written({ anchor: SLACK_LINK }) });

    expect(doc.doneWhen).toEqual([{ command: askDoneCommand({ anchor: SLACK_LINK })!, kind: "command" }]);
  });

  it("leaves a non-Slack ask with no check", () => {
    const text = written({ anchor: "transcript:a0000007#33dac8fe" });

    expect(text).toContain("doneWhen: []");
    expect(parsed({ text }).doneWhen).toEqual([]);
  });

  it("writes a check the doc checker accepts — it asserts on what it printed, not on exit code alone", () => {
    const line = written({ anchor: SLACK_LINK })
      .split("\n")
      .find((raw) => raw.includes("command:"))!;

    expect(checkBareSubVerbSuccessProbes({ line, lineNumber: 1 })).toEqual([]);
    expect(
      checkBareSubVerbSuccessProbes({ line: line.replace(" | grep -q '^replied at '", ""), lineNumber: 1 }),
    ).toHaveLength(1);
  });
});
