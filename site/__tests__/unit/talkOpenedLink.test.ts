/*
 * The link a voice tool call opened, as its line in the call file names it. A call that rolls over at
 * its cap while the owner walks a Slack thread with it must not make the next call ask them to paste the link: the voice
 * reads it off the Slack reply box and the line says only `read`, so the line carries the link itself.
 */
import { describe, expect, it } from "vitest";

import { answeredLine, openedFieldOf, planAnswerLine } from "../../components/voice/talkToolCalls";
import { openedLinkOf } from "../../lib/talkTools";

const LINK = "https://acme.slack.com/archives/C0SYNPLATFORM/p1759813000000100";

describe("openedLinkOf", () => {
  it("names the link a tool with a url slot read: the Slack thread and the Slack open", () => {
    expect(openedLinkOf({ args: { url: LINK }, name: "slack_thread_after" })).toBe(LINK);
    expect(openedLinkOf({ args: { url: ` ${LINK} ` }, name: "slack_open" })).toBe(LINK);
  });

  it("names the link a browser look or a tool with a url OPTION was handed", () => {
    expect(openedLinkOf({ args: { url: LINK }, name: "browser" })).toBe(LINK);
    expect(openedLinkOf({ args: { url: LINK }, name: "browser_open" })).toBe(LINK);
  });

  it("names none for a browser open aimed at a named destination or page rather than a link", () => {
    expect(openedLinkOf({ args: { destination: "queue" }, name: "browser_open" })).toBe(undefined);
    expect(openedLinkOf({ args: { page: "talk" }, name: "browser_open" })).toBe(undefined);
  });

  it("names none for a tool that reads no link, whatever its arguments say", () => {
    expect(openedLinkOf({ args: { url: LINK }, name: "code_read" })).toBe(undefined);
    expect(openedLinkOf({ args: { url: LINK }, name: "relay_steer" })).toBe(undefined);
    expect(openedLinkOf({ args: { url: LINK }, name: "no_such_tool" })).toBe(undefined);
  });

  it("names none when the call carried no usable url", () => {
    expect(openedLinkOf({ args: {}, name: "slack_thread_after" })).toBe(undefined);
    expect(openedLinkOf({ args: { url: "  " }, name: "slack_thread_after" })).toBe(undefined);
    expect(openedLinkOf({ args: { url: 7 }, name: "slack_thread_after" })).toBe(undefined);
    expect(openedLinkOf({ args: undefined, name: "slack_thread_after" })).toBe(undefined);
  });
});

describe("openedFieldOf", () => {
  const rawArguments = JSON.stringify({ url: LINK });

  const field = ({ delegated = false, name = "slack_thread_after", raw = rawArguments, refused = false } = {}) =>
    openedFieldOf({ delegated, name, rawArguments: raw, refused });

  it("spreads the link into an answered call's line", () => {
    expect(field()).toEqual({ opened: LINK });
  });

  it("spreads nothing for a refused call, nor for a tool that reads no link", () => {
    expect(field({ refused: true })).toStrictEqual({});
    expect(field({ name: "code_read" })).toStrictEqual({});
  });

  // A url-taking read this line cannot vouch for must still stop an older link passing for the newest.
  it("writes null for a url-taking read that named no usable url, or whose answer the plan thread has yet to take", () => {
    expect(field({ raw: "not json" })).toStrictEqual({ opened: null });
    expect(field({ raw: JSON.stringify({ url: " " }) })).toStrictEqual({ opened: null });
    expect(field({ delegated: true })).toStrictEqual({ opened: null });
  });
});

// A voice call's line carries its input and output, the way a fleet card's does.
describe("answeredLine", () => {
  const rawArguments = JSON.stringify({ url: LINK });
  const base = { delegated: false, detail: "read the thread", ms: 900, name: "slack_thread_after", rawArguments };

  it("carries the link, the indented arguments and the answer the model was handed", () => {
    expect(answeredLine({ ...base, output: "the thread says yes", refused: false })).toStrictEqual({
      detail: "read the thread",
      ms: 900,
      name: "slack_thread_after",
      opened: LINK,
      refused: false,
      shown: { input: `{\n  "url": "${LINK}"\n}`, output: "the thread says yes" },
      usage: undefined,
    });
  });

  // The output is what `functionCallOutputOf` handed the model — a refusal arrives serialized.
  it("shows a refused call's serialized refusal, indented, with no link", () => {
    const why = "only the voice's window may look at the owner's screen";
    const output = JSON.stringify({ refused: why });
    expect(answeredLine({ ...base, detail: why, output, refused: true })).toStrictEqual({
      detail: why,
      ms: 900,
      name: "slack_thread_after",
      refused: true,
      shown: { input: `{\n  "url": "${LINK}"\n}`, output: `{\n  "refused": "${why}"\n}` },
      usage: undefined,
    });
  });

  it("keeps a delegated read's link unvouched while still showing its call", () => {
    const line = answeredLine({ ...base, delegated: true, output: "the thread says yes", refused: false });
    expect([line.opened, line.shown]).toEqual([
      null,
      { input: `{\n  "url": "${LINK}"\n}`, output: "the thread says yes" },
    ]);
  });
});

// A delegated read names its link only on the line written once the plan thread took the answer.
describe("planAnswerLine", () => {
  const rawArguments = JSON.stringify({ url: LINK });

  it("names the link a delegated read opened, as an answered line", () => {
    expect(planAnswerLine({ name: "slack_thread_after", rawArguments, refused: false, why: undefined })).toEqual({
      detail: "the plan thread took the answer",
      ms: undefined,
      name: "slack_thread_after",
      opened: LINK,
      refused: false,
      usage: undefined,
    });
  });

  it("writes no line for a delegated call that opened no link, nor a refused one", () => {
    expect(planAnswerLine({ name: "code_read", rawArguments, refused: false, why: undefined })).toBe(undefined);
    expect(planAnswerLine({ name: "slack_thread_after", rawArguments: "{}", refused: false, why: undefined })).toBe(
      undefined,
    );
    expect(planAnswerLine({ name: "slack_thread_after", rawArguments, refused: true, why: undefined })).toBe(undefined);
  });

  it("writes a refused line naming no link for an answer the post lost", () => {
    const why = "the answer was lost: 502; the call was told the tool could not run";
    expect(planAnswerLine({ name: "slack_thread_after", rawArguments, refused: false, why })).toStrictEqual({
      detail: why,
      ms: undefined,
      name: "slack_thread_after",
      refused: true,
      usage: undefined,
    });
  });
});
