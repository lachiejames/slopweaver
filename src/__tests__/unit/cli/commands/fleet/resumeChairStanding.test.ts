/**
 * Whether the chair's own tab hosts the supervisor pin, judged purely over what cmux and the process table
 * reported: the pin found by its pid, under the tab's listed shell, on its tty, or not at all. The effectful
 * half, `chairHostsPin`, is `./resumeChair.test.ts`.
 */
import { describe, expect, it } from "vitest";

import { pinHostedHere } from "../../../../../cli/commands/fleet/resumeChairStanding.js";
import type { CmuxProcess } from "../../../../../cmux/client.js";
import { unwrap } from "../../../../../lib/result.js";
import { parseProcessRowsWhole } from "../../../../../live/standing/processes.js";
import { chairLiveRecord as liveRecord, UNUSED_SESSION } from "./fleetKit.js";

describe("pinHostedHere", () => {
  /** Whether the pin, live at `pid`, is hosted by a tab cmux reported as `trees`, `ttyPids` and `ttys`, over `table`. */
  const hostedAt = ({
    pid,
    trees,
    ttyPids = [],
    ttys = [],
    table = "",
  }: {
    pid: number;
    trees: readonly CmuxProcess[];
    ttyPids?: readonly number[];
    ttys?: readonly string[];
    table?: string;
  }): boolean =>
    pinHostedHere({
      liveRecords: [liveRecord({ pid })],
      report: { surfaces: 1, trees, ttys, unattributedTtyPids: ttyPids },
      rows: unwrap(parseProcessRowsWhole({ text: table })),
      sessionId: UNUSED_SESSION,
    });

  it("is true only where the pinned session's own process runs, however deep in the tree", () => {
    const shellRunningPin = [{ children: [{ children: [], name: "claude", pid: 4242 }], name: "zsh", pid: 10 }];
    expect(hostedAt({ pid: 4242, trees: shellRunningPin })).toBe(true);
  });

  // MEASURED: cmux 0.65.2 attributed nothing to the working chair's tab and listed its
  // `login` and shell as tty pids, so the attributed tree alone refused the chair `NO_LIVE_SESSION`.
  it("is true when cmux attributes nothing and the table puts the pin under the tab's listed shell", () => {
    const table = [
      "  900     1 ??       Ss   /Applications/cmux.app/Contents/MacOS/cmux",
      "  901   900 ttys004  Ss   login -pfl ada /bin/bash -c exec -la zsh /bin/zsh",
      "  902   901 ttys004  S    -/bin/zsh",
      " 4242   902 ttys004  S+   claude --resume x",
    ].join("\n");
    expect(hostedAt({ pid: 4242, table, trees: [], ttyPids: [901, 902] })).toBe(true);
  });

  // MEASURED: cmux reported neither a tree nor a tty pid for two running seats' tabs; the pty
  // each surface names is the tie left.
  it("is true when cmux reports no pid at all and the table puts the pin on the tab's own tty, false on another", () => {
    const table = " 4242   902 ttys004  S+   claude --resume x";
    expect([
      hostedAt({ pid: 4242, table, trees: [], ttys: ["ttys004"] }),
      hostedAt({ pid: 4242, table, trees: [], ttys: ["ttys005"] }),
    ]).toEqual([true, false]);
  });

  it("is false for a bare shell, an empty tab, and a tab running a different session", () => {
    const bareShell = [{ children: [], name: "zsh", pid: 10 }];
    const otherSession = [{ children: [{ children: [], name: "claude", pid: 5151 }], name: "zsh", pid: 10 }];
    expect([
      hostedAt({ pid: 4242, trees: bareShell }),
      hostedAt({ pid: 4242, trees: [] }),
      hostedAt({ pid: 4242, trees: otherSession }),
    ]).toEqual([false, false, false]);
  });
});
