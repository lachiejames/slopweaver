import { describe, expect, it } from "vitest";

import type { BrowserReapVerdict } from "../../../browser/sessionReap.js";
import {
  type BrowserReapExecution,
  emptyBrowserReapExecution,
  renderBrowserReapLines,
} from "../../../browser/sessionReapReport.js";

const verdict = (over: Partial<BrowserReapVerdict> = {}): BrowserReapVerdict => ({
  action: "close",
  clientSession: "slopweaver-a",
  daemonPids: [900],
  id: "a",
  idleJudgedOn: null,
  owner: "dead",
  ownerWhy: "its opener pid 500 is gone",
  url: "http://localhost:3001/queue",
  why: "its opener pid 500 is gone",
  ...over,
});

const VERDICTS: readonly BrowserReapVerdict[] = [
  verdict({ id: "a" }),
  verdict({ action: "forget", daemonPids: [], id: "b", url: null }),
  verdict({ action: "keep", id: "c", owner: "live", why: "its opener pid 600 is alive" }),
  verdict({ id: "d" }),
];

const render = ({ execution, dryRun }: { execution: BrowserReapExecution; dryRun: boolean }) =>
  renderBrowserReapLines({ dryRun, outcome: { execution, verdicts: VERDICTS } });

describe("renderBrowserReapLines", () => {
  it("prints nothing at all when the home holds no session", () => {
    expect(
      renderBrowserReapLines({ dryRun: false, outcome: { execution: emptyBrowserReapExecution(), verdicts: [] } }),
    ).toEqual([]);
  });

  it("says WOULD on a dry run, and counts the plan rather than an execution", () => {
    expect(render({ dryRun: true, execution: emptyBrowserReapExecution() })).toEqual([
      "WOULD CLOSE browser session a · owner dead · http://localhost:3001/queue — its opener pid 500 is gone",
      "WOULD FORGET browser session b · owner dead · (never read) — its opener pid 500 is gone",
      "WOULD CLOSE browser session d · owner dead · http://localhost:3001/queue — its opener pid 500 is gone",
      "left browser session c alone: its opener pid 600 is alive",
      "machine reap: would close 2 browser session(s), forget 1 whose tab no daemon holds, and keep 1",
    ]);
  });

  it("calls a tab CLOSED only when the client confirmed it, and names an unconfirmed and a deferred close", () => {
    const lines = render({
      dryRun: false,
      execution: {
        ...emptyBrowserReapExecution(),
        deferred: ["d"],
        forgotten: ["b"],
        unknownTabs: [{ id: "a", why: "tab-close timed out" }],
      },
    });
    expect(lines).toEqual([
      "UNCONFIRMED CLOSE of browser session a · owner dead · http://localhost:3001/queue — its opener pid 500 is gone",
      "FORGOT browser session b · owner dead · (never read) — its opener pid 500 is gone",
      "DEFERRED (relay not answering) the close of browser session d · owner dead · http://localhost:3001/queue — its opener pid 500 is gone",
      "left browser session c alone: its opener pid 600 is alive",
      "browser session a: its tab may still be open — the client could not confirm the close (tab-close timed out)",
      'machine reap: closed 0 browser tab(s), forgot 1 record(s) whose tab no daemon held (Chrome shows any such tab as "not connected"), 1 close(s) unconfirmed, 1 deferred, 0 failed — kept 1',
    ]);
  });

  it("reports a confirmed close as CLOSED and a record that would not delete as FAILED", () => {
    const lines = render({
      dryRun: false,
      execution: {
        ...emptyBrowserReapExecution(),
        closed: ["a", "d"],
        failed: [{ id: "b", why: "its record could not be removed: EACCES" }],
      },
    });
    expect(lines[0]).toBe(
      "CLOSED browser session a · owner dead · http://localhost:3001/queue — its opener pid 500 is gone",
    );
    expect(lines[1]).toBe(
      "FAILED to forget browser session b · owner dead · (never read) — its opener pid 500 is gone",
    );
    expect(lines).toContain("browser session b: its record could not be removed: EACCES");
    expect(lines.at(-1)).toContain("closed 2 browser tab(s)");
  });

  it("names a session used again since it was judged, and counts it as kept", () => {
    const lines = render({
      dryRun: false,
      execution: { ...emptyBrowserReapExecution(), closed: ["a"], forgotten: ["b"], superseded: ["d"] },
    });
    expect(lines[2]).toBe(
      "LEFT (used again since it was judged) browser session d · owner dead · http://localhost:3001/queue — its opener pid 500 is gone",
    );
    expect(lines.at(-1)).toContain("0 failed — kept 2");
  });
});
