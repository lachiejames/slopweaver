/**
 * A ballooned fseventsd stands the prune's apply down: its resident size read by exact binary path and summed,
 * and judged against the 1 GiB line, where an unreadable read never holds.
 */
import { describe, expect, it } from "vitest";

import { FSEVENTSD_BALLOON_KIB, fseventsdBalloonHold, parseFseventsdRss } from "../../../worktree/fseventsdBalloon.js";

const FSEVENTSD =
  "/System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/FSEvents.framework/Versions/A/Support/fseventsd";

describe("parseFseventsdRss", () => {
  it("reads fseventsd's resident KiB by its exact binary path out of a real listing", () => {
    const text = `  581  40112 /usr/libexec/opendirectoryd\n79903  12704 ${FSEVENTSD}\n`;
    expect(parseFseventsdRss({ text })).toEqual({ kib: 12704, kind: "read", pids: [79903] });
  });

  it("sums two instances", () => {
    const text = `  100  600000 ${FSEVENTSD}\n  200  600000 ${FSEVENTSD}\n`;
    expect(parseFseventsdRss({ text })).toEqual({ kib: 1_200_000, kind: "read", pids: [100, 200] });
  });

  it("never reads a lookalike name as the daemon", () => {
    const text = `  300  9999999 /tmp/fseventsd\n  301  100 /bin/zsh\n`;
    expect(parseFseventsdRss({ text })).toEqual({ kind: "not-running" });
  });

  it("reads a comm with spaces in it whole, and skips a line that is not a row", () => {
    const text = `PID RSS COMM\n  400  90000 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome\n  401  2048 ${FSEVENTSD}\n`;
    expect(parseFseventsdRss({ text })).toEqual({ kib: 2048, kind: "read", pids: [401] });
  });

  it("calls an empty listing unreadable, never not-running", () => {
    expect(parseFseventsdRss({ text: "" })).toEqual({
      kind: "unreadable",
      why: "`ps -ax -o pid=,rss=,comm=` listed no process at all",
    });
  });
});

describe("fseventsdBalloonHold", () => {
  it("stands down at exactly 1 GiB, naming the pid, the size, why, and the relief", () => {
    expect(fseventsdBalloonHold({ rss: { kib: FSEVENTSD_BALLOON_KIB, kind: "read", pids: [61323] } })).toBe(
      "worktree prune: stood down, nothing scanned or deleted — fseventsd (pid 61323) holds 1.0 GB, a stuck FSEvents " +
        "client's queue that every delete would only add to, and the free-space deficit is its swap, which no prune " +
        "reclaims. Relief, as the fseventsd-bloated card asks: `sudo killall fseventsd`, not during a call; the next " +
        "run prunes as normal.",
    );
  });

  it("names every instance's pid, in listing order", () => {
    const line = fseventsdBalloonHold({ rss: { kib: 2 * FSEVENTSD_BALLOON_KIB, kind: "read", pids: [100, 200] } })!;
    expect(line).toContain("fseventsd (pid 100, 200) holds 2.0 GB");
  });

  it("stands down on a real balloon's own size, 36.5 GB", () => {
    const line = fseventsdBalloonHold({ rss: { kib: 38_273_024, kind: "read", pids: [61323] } })!;
    expect(line).toContain("holds 36.5 GB");
  });

  it("runs one KiB under the line", () => {
    expect(fseventsdBalloonHold({ rss: { kib: FSEVENTSD_BALLOON_KIB - 1, kind: "read", pids: [79903] } })).toBe(null);
  });

  it("runs on a healthy daemon's largest measured size, 16 MB", () => {
    expect(fseventsdBalloonHold({ rss: { kib: 16_384, kind: "read", pids: [79903] } })).toBe(null);
  });

  it("runs when fseventsd is not running or its size cannot be read, leaving the CPU gates to stop", () => {
    expect(fseventsdBalloonHold({ rss: { kind: "not-running" } })).toBe(null);
    expect(fseventsdBalloonHold({ rss: { kind: "unreadable", why: "ps timed out" } })).toBe(null);
  });
});
