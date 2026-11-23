import { describe, expect, it } from "vitest";

import {
  headOfStatus,
  headStampOf,
  liveCallLeases,
  STAMP_KEYS,
  stampArgs,
  stampInPlist,
} from "../../../desktop/buildStamp.js";

const SHA = "461e873ed0f301ebbd167766265eea51f8db26be";
const ISO = "2026-10-05T16:54:25Z";
const NOW_MS = Date.parse("2026-10-06T02:30:00Z");

/** An Info.plist in the XML layout electron-builder writes, carrying the given string keys. */
const plist = ({ values }: { values: Record<string, string> }): string =>
  [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<plist version="1.0">',
    "<dict>",
    "\t<key>CFBundleVersion</key>\n\t<string>2290</string>",
    ...Object.entries(values).map(([key, value]) => `\t<key>${key}</key>\n\t<string>${value}</string>`),
    "</dict>",
    "</plist>",
  ].join("\n");

describe("headStampOf", () => {
  it("reads HEAD's sha and time, clean when the app's files match it", () => {
    expect(headStampOf({ log: `${SHA}\u001f${ISO}\n`, status: "" })).toEqual({
      committedIso: ISO,
      sha: SHA,
      tree: "clean",
    });
  });

  it("calls a build carrying uncommitted desktop changes dirty", () => {
    expect(headStampOf({ log: `${SHA}\u001f${ISO}`, status: " M desktop/src/main.ts\n" })!.tree).toBe("dirty");
  });

  it("refuses a log that is not one commit", () => {
    expect(headStampOf({ log: "fatal: bad", status: "" })).toBe(undefined);
    expect(headStampOf({ log: `${SHA}\u001fnot a time`, status: "" })).toBe(undefined);
  });
});

describe("headOfStatus", () => {
  it("reads the commit a clean status compared against, with no changes", () => {
    expect(headOfStatus({ status: `# branch.oid ${SHA}\n# branch.head main\n` })).toEqual({ changes: "", sha: SHA });
  });

  it("keeps every change line and drops the headers", () => {
    const status = `# branch.oid ${SHA}\n# branch.head main\n1 .M N... 100644 100644 100644 a b desktop/src/main.ts\n? desktop/src/new.ts\n`;
    expect(headOfStatus({ status })).toEqual({
      changes: "1 .M N... 100644 100644 100644 a b desktop/src/main.ts\n? desktop/src/new.ts",
      sha: SHA,
    });
  });

  it("names no commit on an unborn branch or a status without the branch headers", () => {
    expect(headOfStatus({ status: "# branch.oid (initial)\n# branch.head main\n" })).toBe(undefined);
    expect(headOfStatus({ status: " M desktop/src/main.ts\n" })).toBe(undefined);
  });
});

describe("stampArgs and stampInPlist", () => {
  it("round-trips a stamp through the flags electron-builder writes into Info.plist", () => {
    const stamp = { committedIso: ISO, sha: SHA, tree: "clean" as const };
    const values = Object.fromEntries(
      stampArgs({ stamp }).map((arg) => arg.slice("--config.mac.extendInfo.".length).split("=") as [string, string]),
    );
    expect(Object.keys(values)).toEqual([STAMP_KEYS.sha, STAMP_KEYS.committedIso, STAMP_KEYS.tree]);
    expect(stampInPlist({ plist: plist({ values }) })).toEqual(stamp);
  });

  it("reads a build without the keys as unstamped", () => {
    expect(stampInPlist({ plist: plist({ values: {} }) })).toBe(undefined);
  });

  it("reads a sha the command line coerced to a number as unstamped", () => {
    const coerced = plist({ values: { [STAMP_KEYS.committedIso]: ISO, [STAMP_KEYS.tree]: "clean" } }).replace(
      "</dict>",
      `\t<key>${STAMP_KEYS.sha}</key>\n\t<integer>1000000000000</integer>\n</dict>`,
    );
    expect(stampInPlist({ plist: coerced })).toBe(undefined);
  });

  it("refuses a tree word it does not know", () => {
    const values = { [STAMP_KEYS.committedIso]: ISO, [STAMP_KEYS.sha]: SHA, [STAMP_KEYS.tree]: "maybe" };
    expect(stampInPlist({ plist: plist({ values }) })).toBe(undefined);
  });
});

describe("liveCallLeases", () => {
  it("counts the leases whose untilMs is still ahead", () => {
    const leases = [
      JSON.stringify({ callId: "a", untilMs: NOW_MS + 1 }),
      JSON.stringify({ callId: "b", untilMs: NOW_MS }),
      JSON.stringify({ callId: "c", untilMs: NOW_MS - 1 }),
    ];
    expect(liveCallLeases({ leases, nowMs: NOW_MS })).toBe(1);
  });

  it("holds nothing on no leases, or ones that do not parse", () => {
    expect(liveCallLeases({ leases: [], nowMs: NOW_MS })).toBe(0);
    expect(liveCallLeases({ leases: ["{", "[]", JSON.stringify({ untilMs: "soon" })], nowMs: NOW_MS })).toBe(0);
  });
});
