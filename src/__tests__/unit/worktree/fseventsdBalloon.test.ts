/**
 * A ballooned fseventsd stands the prune's apply down: its resident size read by exact binary path and summed, or
 * its `top` footprint, either judged against the 1 GiB line, where an unreadable read never holds by itself.
 */
import { describe, expect, it } from "vitest";

import type { FseventsdFootprint } from "../../../monitor/fseventsdBloated.js";
import { FSEVENTSD_BALLOON_KIB, fseventsdBalloonHold, parseFseventsdRss } from "../../../worktree/fseventsdBalloon.js";

/** The line, in bytes, as the footprint is read. */
const LINE_BYTES = FSEVENTSD_BALLOON_KIB * 1024;
const NO_FOOTPRINT: FseventsdFootprint = { kind: "not-running" };
const FOOTPRINT_UNREADABLE: FseventsdFootprint = { kind: "unreadable", why: "`top` printed nothing for the pid" };
/** What every stand-down line says after the size. */
const TAIL =
  "a stuck FSEvents client's queue that every delete would only add to, and the free-space deficit is its swap, " +
  "which no prune reclaims. Relief, as the fseventsd-bloated card asks: `sudo killall fseventsd`, not during a " +
  "call; the next run prunes as normal.";
const HEAD = "worktree prune: stood down, nothing scanned or deleted — fseventsd";

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
  it("stands down at exactly 1 GiB of resident size, naming the pid, the size, which size, why, and the relief", () => {
    expect(
      fseventsdBalloonHold({
        footprint: NO_FOOTPRINT,
        rss: { kib: FSEVENTSD_BALLOON_KIB, kind: "read", pids: [61323] },
      }),
    ).toBe(`${HEAD} (pid 61323) has a 1.0 GB resident size, ${TAIL}`);
  });

  it("names every instance's pid, in listing order, when the summed resident size is the larger", () => {
    expect(
      fseventsdBalloonHold({
        footprint: FOOTPRINT_UNREADABLE,
        rss: { kib: 2 * FSEVENTSD_BALLOON_KIB, kind: "read", pids: [100, 200] },
      }),
    ).toBe(`${HEAD} (pid 100, 200) has a 2.0 GB resident size, ${TAIL}`);
  });

  it("stands down on a real balloon's own resident size, 36.5 GB", () => {
    expect(
      fseventsdBalloonHold({ footprint: NO_FOOTPRINT, rss: { kib: 38_273_024, kind: "read", pids: [61323] } }),
    ).toBe(`${HEAD} (pid 61323) has a 36.5 GB resident size, ${TAIL}`);
  });

  it("stands down on a swapped-out balloon: 16 MB resident, a 4 GB footprint", () => {
    expect(
      fseventsdBalloonHold({
        footprint: { bytes: 4 * LINE_BYTES, kind: "read", pid: 4242 },
        rss: { kib: 16_384, kind: "read", pids: [4242] },
      }),
    ).toBe(`${HEAD} (pid 4242) has a 4.0 GB footprint, ${TAIL}`);
  });

  it("stands down on the footprint when the resident size cannot be read", () => {
    expect(
      fseventsdBalloonHold({
        footprint: { bytes: LINE_BYTES, kind: "read", pid: 4242 },
        rss: { kind: "unreadable", why: "ps timed out" },
      }),
    ).toBe(`${HEAD} (pid 4242) has a 1.0 GB footprint, ${TAIL}`);
  });

  it("prints the larger size when both are over the line, and resident size on a tie", () => {
    expect(
      fseventsdBalloonHold({
        footprint: { bytes: 3 * LINE_BYTES, kind: "read", pid: 4242 },
        rss: { kib: 2 * FSEVENTSD_BALLOON_KIB, kind: "read", pids: [4242] },
      }),
    ).toBe(`${HEAD} (pid 4242) has a 3.0 GB footprint, ${TAIL}`);
    expect(
      fseventsdBalloonHold({
        footprint: { bytes: 2 * LINE_BYTES, kind: "read", pid: 4242 },
        rss: { kib: 2 * FSEVENTSD_BALLOON_KIB, kind: "read", pids: [4242] },
      }),
    ).toBe(`${HEAD} (pid 4242) has a 2.0 GB resident size, ${TAIL}`);
  });

  it("runs one KiB under the line on resident size and one byte under on footprint", () => {
    expect(
      fseventsdBalloonHold({
        footprint: { bytes: LINE_BYTES - 1, kind: "read", pid: 79903 },
        rss: { kib: FSEVENTSD_BALLOON_KIB - 1, kind: "read", pids: [79903] },
      }),
    ).toBe(null);
  });

  it("runs on a healthy daemon's largest measured size, 16 MB, by either measure", () => {
    expect(
      fseventsdBalloonHold({
        footprint: { bytes: 16 * 1024 * 1024, kind: "read", pid: 79903 },
        rss: { kib: 16_384, kind: "read", pids: [79903] },
      }),
    ).toBe(null);
  });

  it("runs when the footprint cannot be read and the resident size is under the line", () => {
    expect(
      fseventsdBalloonHold({ footprint: FOOTPRINT_UNREADABLE, rss: { kib: 16_384, kind: "read", pids: [79903] } }),
    ).toBe(null);
  });

  it("runs when neither size is running or readable, leaving the CPU gates to stop", () => {
    expect(fseventsdBalloonHold({ footprint: NO_FOOTPRINT, rss: { kind: "not-running" } })).toBe(null);
    expect(
      fseventsdBalloonHold({ footprint: FOOTPRINT_UNREADABLE, rss: { kind: "unreadable", why: "ps timed out" } }),
    ).toBe(null);
  });
});
