/**
 * `confirmTab`: the four reads between the two table reads run in ONE order, executables, modes, holders, groups,
 * each stopping the rest on a failed read or a disagreement, and a forest with no shell costs none of them.
 */
import { describe, expect, it } from "vitest";

import { confirmTab } from "../../../../../cli/commands/cmux/reseatColdConfirm.js";
import type { CmuxProcess, CmuxWorkspaceSummary } from "../../../../../cmux/client.js";
import { err, ok, unwrap, unwrapErr } from "../../../../../lib/result.js";
import type { TtyProcessRow } from "../../../../../live/standing/processes.js";
import { honestExecutables, honestProcessGroups, honestTtyHolders, honestTtyModes } from "../fleet/fleetKit.js";

/** The measured bare tab, grafted: the login over the shell, on `ttys003`. */
const LOGIN_OVER_SHELL: readonly CmuxProcess[] = [
  { children: [{ children: [], name: "/bin/zsh", pid: 60562 }], name: "/usr/bin/login", pid: 60561 },
];
const TABLE: readonly TtyProcessRow[] = [
  { argv: "/Applications/cmux.app/Contents/MacOS/cmux", pid: 60470, ppid: 1, state: "S", tty: "??" },
  { argv: "/usr/bin/login -flp ada /bin/zsh", pid: 60561, ppid: 60470, state: "Ss", tty: "ttys003" },
  { argv: "/bin/zsh", pid: 60562, ppid: 60561, state: "S+", tty: "ttys003" },
];
const WORKSPACE: CmuxWorkspaceSummary = {
  currentDirectory: "/wt/chair",
  description: undefined,
  latestConversationMessage: undefined,
  latestSubmittedAtIso: undefined,
  latestSubmittedMessage: undefined,
  pinned: false,
  selected: false,
  title: "chair",
  windowId: "window:1",
  workspaceId: "ws-chair",
  workspaceRef: "workspace:1",
};

/**
 * The four honest reads, each recording that it ran.
 *
 * @param reads the record
 * @returns the reads
 */
function honestReads({ reads }: { reads: string[] }): Parameters<typeof confirmTab>[0]["deps"] {
  return {
    readExecutables: ({ pids }) => {
      reads.push(`executables ${pids.join(",")}`);
      return ok(honestExecutables({ pids, rows: TABLE }));
    },
    readProcessGroups: ({ pids }) => {
      reads.push(`groups ${pids.join(",")}`);
      return ok(honestProcessGroups({ pids }));
    },
    readTtyHolders: ({ tty }) => {
      reads.push(`holders ${tty}`);
      return ok(honestTtyHolders({ rows: TABLE, tty }));
    },
    readTtyModes: ({ tty }) => {
      reads.push(`modes ${tty}`);
      return ok(honestTtyModes());
    },
  };
}

describe("confirmTab", () => {
  it("runs the four reads in order over the shell alone and hands the forest back when every one agrees", () => {
    const reads: string[] = [];
    const grafted = { placement: new Map<number, string>(), tree: LOGIN_OVER_SHELL, tty: "ttys003" };

    const confirmed = unwrap(confirmTab({ deps: honestReads({ reads }), grafted, workspace: WORKSPACE }));

    expect([confirmed, reads]).toEqual([
      LOGIN_OVER_SHELL,
      ["executables 60562", "modes ttys003", "holders ttys003", "groups 60562"],
    ]);
  });

  it("stops at the modes read when a helper left the tty canonical, never reading the holders", () => {
    const reads: string[] = [];
    const grafted = { placement: new Map<number, string>(), tree: LOGIN_OVER_SHELL, tty: "ttys003" };
    const deps = {
      ...honestReads({ reads }),
      readTtyModes: ({ tty }: { readonly tty: string }) => {
        reads.push(`modes ${tty}`);
        return ok({ ...honestTtyModes(), lflag: 0x5c3 });
      },
    };

    const refused = unwrapErr(confirmTab({ deps, grafted, workspace: WORKSPACE }));

    expect([refused.code, reads]).toEqual(["CMUX_READ_FAILED", ["executables 60562", "modes ttys003"]]);
  });

  it("refuses a failed modes read whole, naming the tty, and costs no read on a forest with no shell", () => {
    const reads: string[] = [];
    const grafted = { placement: new Map<number, string>(), tree: LOGIN_OVER_SHELL, tty: "ttys003" };
    const deps = { ...honestReads({ reads }), readTtyModes: () => err("stty: exited 1") };
    const noShell = { placement: new Map<number, string>(), tree: [] as readonly CmuxProcess[], tty: "ttys003" };

    const refused = unwrapErr(confirmTab({ deps, grafted, workspace: WORKSPACE }));
    const empty = unwrap(confirmTab({ deps, grafted: noShell, workspace: WORKSPACE }));

    expect([refused.message, empty, reads]).toEqual([
      "cmux could not read the input modes of workspace:1's tty: stty: exited 1 — nothing was typed; run the same command again once cmux and ps answer, and read the tab's screen if it keeps failing",
      [],
      ["executables 60562"],
    ]);
  });
});
