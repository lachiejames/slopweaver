/**
 * Which pids the watched-daemon read asks `top` for. Identity is the binary's exact path under SIP-protected
 * `/System`, so a lookalike name elsewhere is never read as the daemon, and the daemon is never judged by argv.
 */
import { describe, expect, it } from "vitest";

import { WATCHED_DAEMONS, watchedDaemonPids } from "../../../../live/machine/daemonWatch.js";

const FSEVENTSD =
  "/System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/FSEvents.framework/Versions/A/Support/fseventsd";

describe("watchedDaemonPids", () => {
  it("watches fseventsd at its system path, relieved by the owner's one root step", () => {
    expect(WATCHED_DAEMONS).toStrictEqual([{ comm: FSEVENTSD, label: "fseventsd", relief: "sudo killall fseventsd" }]);
  });

  it("finds a watched daemon by its exact binary path, and never a same-named binary elsewhere", () => {
    const comms = [
      { comm: "/System/Library/CoreServices/WindowServer", pid: 416 },
      { comm: FSEVENTSD, pid: 345 },
      { comm: "/opt/synthetic/bin/fseventsd", pid: 900 },
    ];

    expect(watchedDaemonPids({ comms })).toStrictEqual([345]);
  });

  it("asks for nothing when no watched daemon runs", () => {
    expect(watchedDaemonPids({ comms: [] })).toStrictEqual([]);
  });
});
