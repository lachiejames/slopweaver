/**
 * `relayContentOf` — what a `talk relay` carries, read straight off its parsed flags, with every problem appended to
 * the caller's list. `args.test.ts` drives the same reads through the whole `parseRelayArgs`; this holds the module
 * itself down, so a change to it is noticed here first.
 */
import { describe, expect, it } from "vitest";

import { relayContentOf } from "../../../cli/commands/talk/relayContentArgs.js";

describe("relayContentOf", () => {
  it("reads every content flag as given, and appends no problem when they agree", () => {
    const problems: string[] = [];
    const content = relayContentOf({
      problems,
      values: { "offered-file": "/o.json", "read-after": "", say: "x", "screen-recording-off": true },
    });
    expect(content).toEqual({
      offeredFile: "/o.json",
      readAfter: [],
      say: "x",
      screen: undefined,
      screenFailed: false,
      screenNotTaken: false,
      screenRecordingOff: true,
      typed: false,
      wordsAlone: false,
    });
    expect(problems).toEqual([]);
  });

  it("trims --read-after and drops its empty entries", () => {
    expect(relayContentOf({ problems: [], values: { "read-after": " web_search, ,read_screen " } }).readAfter).toEqual([
      "web_search",
      "read_screen",
    ]);
  });

  it("appends to the caller's list rather than replacing it, a problem per clash", () => {
    const problems = ["already there"];
    relayContentOf({ problems, values: { "screen-failed": true, "screen-recording-off": true, typed: true } });
    expect(problems).toEqual([
      "already there",
      "talk relay takes one of --screen <webp-file>, --screen-failed, --screen-not-taken or --screen-recording-off, never two",
      "talk relay --typed takes no --screen-failed, --screen-not-taken or --screen-recording-off: a typed steer takes no look at their screen, and a missing image is one they did not attach",
    ]);
  });
});
