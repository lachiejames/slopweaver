/** `awaitColdVerdict` over a fake client: unreadable tables and trees are refused, and the poll gives up after three failed reads in a row. */
import { describe, expect, it } from "vitest";

import { awaitColdVerdict } from "../../../../../../cli/commands/cmux/reseatCold.js";
import type { CmuxClient, CmuxProcess } from "../../../../../../cmux/client.js";
import { CmuxErrors } from "../../../../../../cmux/errors.js";
import { err, ok, unwrap, unwrapErr } from "../../../../../../lib/result.js";
import { BARE, CHAIR_ID, workspace } from "./fixtures.js";
import { coldWorld } from "./harness.js";

describe("awaitColdVerdict", () => {
  it("refuses the read, never judging an unattributed tab empty, when the process table cannot be read", async () => {
    const journal: string[] = [];
    const { client, deps } = coldWorld({ journal, trees: [] });
    const unattributed: CmuxClient = {
      ...client,
      workspaceTop: () =>
        Promise.resolve(ok({ surfaces: 1, trees: [], ttys: [], unattributedTtyPids: [60561, 60562] })),
    };

    const read = await awaitColdVerdict({
      deps: { ...deps, client: unattributed, readProcessRows: () => err("ps: timed out") },
      pinnedSessionId: CHAIR_ID,
      workspace: workspace({ id: "ws-chair", ref: "workspace:1" }),
    });

    expect(unwrapErr(read)).toEqual({
      code: "CMUX_READ_FAILED",
      message:
        "cmux could not read the process table behind workspace:1's processes: ps: timed out — nothing was typed; run the same command again once cmux and ps answer, and read the tab's screen if it keeps failing",
    });
  });

  // A tab cmux attributed a tree to was judged off that tree alone, never checked against the
  // table — now every reported process is checked, and only a tab reporting nothing at all costs no `ps`.
  it("refuses an attributed bare shell the process table cannot confirm, and reads no table for a tab reporting nothing", async () => {
    const attributedJournal: string[] = [];
    const attributed = coldWorld({ journal: attributedJournal, trees: [BARE] });
    const emptyJournal: string[] = [];
    const empty = coldWorld({ journal: emptyJournal, trees: [[]] });

    const attributedRead = await awaitColdVerdict({
      deps: { ...attributed.deps, client: attributed.client, readProcessRows: () => err("ps: timed out") },
      pinnedSessionId: CHAIR_ID,
      workspace: workspace({ id: "ws-chair", ref: "workspace:1" }),
    });
    const emptyRead = await awaitColdVerdict({
      deps: { ...empty.deps, client: empty.client, readProcessRows: () => err("ps: never read") },
      pinnedSessionId: CHAIR_ID,
      workspace: workspace({ id: "ws-chair", ref: "workspace:1" }),
    });

    expect(unwrapErr(attributedRead)).toEqual({
      code: "CMUX_READ_FAILED",
      message:
        "cmux could not read the process table behind workspace:1's processes: ps: timed out — nothing was typed; run the same command again once cmux and ps answer, and read the tab's screen if it keeps failing",
    });
    expect(unwrap(emptyRead)).toEqual({ kind: "not-cold", why: "no-process" });
  });

  // A reply holding no surface for the tab was judged `no-process`, a shell not yet
  // started, where the tab is gone or not listed.
  it("refuses a reply that decodes but holds no surface for the tab, never judging it empty", async () => {
    const journal: string[] = [];
    const { client, deps } = coldWorld({ journal, trees: [] });
    const unlisted: CmuxClient = {
      ...client,
      workspaceTop: () => Promise.resolve(ok({ surfaces: 0, trees: [], ttys: [], unattributedTtyPids: [] })),
    };

    const read = await awaitColdVerdict({
      deps: { ...deps, client: unlisted, readProcessRows: () => err("ps: never read") },
      pinnedSessionId: CHAIR_ID,
      workspace: workspace({ id: "ws-chair", ref: "workspace:1" }),
    });

    expect(journal).toEqual([]);
    expect(unwrapErr(read)).toEqual({
      code: "CMUX_READ_FAILED",
      message:
        "cmux could not read workspace:1's process tree: cmux's process listing holds no surface for the tab, so it is gone or not listed — nothing was typed; run the same command again once cmux and ps answer, and read the tab's screen if it keeps failing",
    });
  });

  it("gives up after three failed reads in a row, however many polls the budget still holds", async () => {
    const journal: string[] = [];
    const { client, deps } = coldWorld({ journal, trees: [BARE] });
    let treeReads = 0;
    const hung: CmuxClient = {
      ...client,
      workspaceTop: () => {
        treeReads += 1;
        return Promise.resolve(err(CmuxErrors.malformedReply({ detail: "timed out", method: "system.top" })));
      },
    };

    const read = await awaitColdVerdict({
      deps: { ...deps, client: hung, coldShellPolls: 40 },
      pinnedSessionId: CHAIR_ID,
      workspace: workspace({ id: "ws-chair", ref: "workspace:1" }),
    });

    expect(treeReads).toBe(3);
    expect(read.isErr()).toBe(true);
    expect(unwrapErr(read).code).toBe("CMUX_READ_FAILED");
  });

  it("starts the count again after a read that answers, so failures apart never add up to the limit", async () => {
    const journal: string[] = [];
    const { client, deps } = coldWorld({ journal, trees: [] });
    const starting: readonly CmuxProcess[] = [{ children: [], name: "login", pid: 2 }];
    const answers: (readonly CmuxProcess[] | undefined)[] = [
      undefined,
      undefined,
      starting,
      undefined,
      undefined,
      BARE,
    ];
    let treeReads = 0;
    const flaky: CmuxClient = {
      ...client,
      workspaceTop: () => {
        const answer = answers[Math.min(treeReads, answers.length - 1)];
        treeReads += 1;
        if (answer === undefined) {
          return Promise.resolve(err(CmuxErrors.malformedReply({ detail: "timed out", method: "system.top" })));
        }
        return Promise.resolve(ok({ surfaces: 1, trees: answer, ttys: [], unattributedTtyPids: [] }));
      },
    };

    const read = await awaitColdVerdict({
      deps: { ...deps, client: flaky, coldShellPolls: 40 },
      pinnedSessionId: CHAIR_ID,
      workspace: workspace({ id: "ws-chair", ref: "workspace:1" }),
    });

    expect(treeReads).toBe(7);
    expect(read.isOk()).toBe(true);
    expect(unwrap(read).kind).toBe("cold");
  });
});
