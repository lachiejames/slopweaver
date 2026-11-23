/*
 * The front-window read hands the voice's window names only, bounded, from a fixed program that reaches no other
 * application — and a locked screen, or anything unreadable, is a refusal rather than a sample.
 */
import { describe, expect, it } from "vitest";

import {
  FRONT_APP_MAX_CHARS,
  FRONT_TITLE_MAX_CHARS,
  FRONT_WINDOW_PROGRAM,
  frontWindowPidOf,
  frontWindowReplyOf,
} from "../../src/frontWindow";

describe("frontWindowReplyOf", () => {
  it("reads the program's line as the application, its bundle id and its window's title", () => {
    const stdout = '{"app":"Slack","bundleId":"com.tinyspeck.slackmacgap","title":"#dev-platform"}\n';
    expect(frontWindowReplyOf({ stdout })).toEqual({
      app: "Slack",
      bundleId: "com.tinyspeck.slackmacgap",
      title: "#dev-platform",
    });
  });

  it("carries a title macOS withheld, or an empty one, as null", () => {
    expect([
      frontWindowReplyOf({ stdout: '{"app":"Slack","bundleId":null,"title":null}' }),
      frontWindowReplyOf({ stdout: '{"app":"Slack","bundleId":"com.tinyspeck.slackmacgap","title":"  "}' }),
    ]).toEqual([
      { app: "Slack", bundleId: null, title: null },
      { app: "Slack", bundleId: "com.tinyspeck.slackmacgap", title: null },
    ]);
  });

  it("bounds every name: control characters gone, whitespace collapsed, capped", () => {
    const stdout = JSON.stringify({ app: `Sl\u0007ack ${"a".repeat(100)}`, bundleId: null, title: "t".repeat(500) });
    const reply = frontWindowReplyOf({ stdout });
    expect(reply).toEqual({
      app: `Sl ack ${"a".repeat(FRONT_APP_MAX_CHARS - 7)}`,
      bundleId: null,
      title: "t".repeat(FRONT_TITLE_MAX_CHARS),
    });
  });

  // Measured: the program over a locked screen printed loginwindow.
  it("refuses a locked screen rather than calling the lock a window you are in", () => {
    const stdout = '{"app":"loginwindow","bundleId":"com.apple.loginwindow","title":null}';
    expect(frontWindowReplyOf({ stdout })).toEqual({ why: "the owner's screen is locked" });
  });

  it("refuses output that is not one record naming an application", () => {
    expect([
      frontWindowReplyOf({ stdout: "execution error: -1743" }),
      frontWindowReplyOf({ stdout: "[]" }),
      frontWindowReplyOf({ stdout: '{"app":"","bundleId":null,"title":null}' }),
    ]).toEqual([
      { why: "the front window's names did not read as JSON" },
      { why: "the front window's names were not one record" },
      { why: "no application is in front" },
    ]);
  });
});

describe("frontWindowPidOf", () => {
  it("reads the front application's process id", () => {
    expect(frontWindowPidOf({ stdout: '{"app":"Slack","bundleId":null,"pid":412,"title":null}\n' })).toBe(412);
  });

  it.each([
    ["no pid", '{"app":"Slack"}'],
    ["a non-integer", '{"pid":4.5}'],
    ["a string", '{"pid":"412"}'],
    ["not one record", "[]"],
    ["not JSON", "execution error: -1743"],
  ])("reads none from %s", (_name, stdout) => {
    expect(frontWindowPidOf({ stdout })).toBe(undefined);
  });

  it("never carries the process id across to a page", () => {
    expect(
      Object.keys(frontWindowReplyOf({ stdout: '{"app":"Slack","bundleId":null,"pid":412,"title":null}' })),
    ).toEqual(["app", "bundleId", "title"]);
  });
});

describe("FRONT_WINDOW_PROGRAM", () => {
  it("reads names from the window server and drives no other application", () => {
    expect([
      FRONT_WINDOW_PROGRAM.includes("frontmostApplication"),
      FRONT_WINDOW_PROGRAM.includes("CGWindowListCopyWindowInfo"),
      /System Events|Application\(|CGWindowListCreateImage|doShellScript/u.test(FRONT_WINDOW_PROGRAM),
    ]).toEqual([true, true, false]);
  });
});
