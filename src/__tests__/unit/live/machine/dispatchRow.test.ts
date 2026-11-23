/**
 * The dispatch row's defensive parser and its one-line rendering. The parser reads a JSONL file this process
 * did not necessarily write, so the cases that matter are the malformed ones: a half-row must come back
 * `undefined` rather than half-decoded, because a gate reading a half-row reports covered when it saw nothing.
 */
import { describe, expect, it } from "vitest";

import { dispatchLine, isOpen, parseDispatchRow } from "../../../../live/machine/dispatchRow.js";

/** The wire shape of one complete row, as the store writes it. */
const WIRE = {
  id: "d-20260919-0900",
  load1: 45.9,
  observedIso: "2026-09-19T09:00:00.000Z",
  seated: { kind: "seated", slug: "investigate-bfs", workspace: "workspace:9" },
  signature: "hold+single-process|bfs|foreign",
  subject: {
    kill: "kill 4242",
    label: "bfs",
    tree: [{ cpuPct: 301.2, elapsedSeconds: 900, label: "bfs", pid: 4242 }],
    why: "bfs (pid 4242) at 301.2% cpu for 15m — foreign, no session owns it",
  },
  triggers: ["hold", "single-process"],
};

describe("parseDispatchRow", () => {
  it("decodes a complete row, its subject and its tree", () => {
    const row = parseDispatchRow({ value: WIRE })!;

    expect(row.id).toBe("d-20260919-0900");
    expect(row.signature).toBe("hold+single-process|bfs|foreign");
    expect(row.triggers).toStrictEqual(["hold", "single-process"]);
    expect(row.load1).toBe(45.9);
    expect(row.seated).toStrictEqual({ kind: "seated", slug: "investigate-bfs", workspace: "workspace:9" });
    expect(row.subject.label).toBe("bfs");
    expect(row.subject.kill).toBe("kill 4242");
    expect(row.subject.sessionId).toBe(undefined);
    expect(row.subject.tree).toStrictEqual([{ cpuPct: 301.2, elapsedSeconds: 900, label: "bfs", pid: 4242 }]);
    expect(row.settled).toBe(undefined);
  });

  it("decodes the unseated arm, which carries the reason instead of a workspace", () => {
    const row = parseDispatchRow({ value: { ...WIRE, seated: { kind: "none", why: "backoff: 2 unsettled" } } })!;

    expect(row.seated).toStrictEqual({ kind: "none", why: "backoff: 2 unsettled" });
  });

  it("decodes the registered arm — a board row whose spawn has not reported", () => {
    const seated = { kind: "registered", sinceIso: "2026-09-19T09:00:05.000Z", slug: "machine-load-hold-on-cpu-d0" };

    expect(parseDispatchRow({ value: { ...WIRE, seated } })!.seated).toStrictEqual(seated);
  });

  it("refuses a registered arm with no instant, since liveness is judged by its age", () => {
    expect(parseDispatchRow({ value: { ...WIRE, seated: { kind: "registered", slug: "machine-load-d0" } } })).toBe(
      undefined,
    );
  });

  it("decodes a settlement", () => {
    const settled = { atIso: "2026-09-19T09:40:00.000Z", witness: "killed it; load back to 3.1" };
    const row = parseDispatchRow({ value: { ...WIRE, settled } })!;

    expect(row.settled).toStrictEqual(settled);
    expect(isOpen({ row })).toBe(false);
  });

  it("drops a settlement that names no witness, rather than reporting the row closed", () => {
    const row = parseDispatchRow({ value: { ...WIRE, settled: { atIso: "2026-09-19T09:40:00.000Z" } } })!;

    expect(row.settled).toBe(undefined);
    expect(isOpen({ row })).toBe(true);
  });

  it("refuses a row with no signature", () => {
    const { signature: _dropped, ...rest } = WIRE;

    expect(parseDispatchRow({ value: rest })).toBe(undefined);
  });

  it("refuses a row whose seat arm is neither shape", () => {
    expect(parseDispatchRow({ value: { ...WIRE, seated: { kind: "maybe" } } })).toBe(undefined);
  });

  it("refuses a row whose seat claims a workspace but names no slug", () => {
    expect(parseDispatchRow({ value: { ...WIRE, seated: { kind: "seated", workspace: "workspace:9" } } })).toBe(
      undefined,
    );
  });

  it("refuses a row whose subject carries no measurement", () => {
    expect(parseDispatchRow({ value: { ...WIRE, subject: { label: "bfs" } } })).toBe(undefined);
  });

  it("decodes a daemon-only row, whose one trigger an older reader would have dropped whole", () => {
    const row = parseDispatchRow({ value: { ...WIRE, triggers: ["daemon-footprint"] } })!;

    expect(row.triggers).toStrictEqual(["daemon-footprint"]);
  });

  it("refuses a row carrying no recognised trigger", () => {
    expect(parseDispatchRow({ value: { ...WIRE, triggers: ["swap-pressure"] } })).toBe(undefined);
  });

  it("refuses anything that is not a record at all", () => {
    expect(parseDispatchRow({ value: "d-20260919-0900" })).toBe(undefined);
  });

  it("drops a tree entry missing its cpu reading, keeping the rest of the row", () => {
    const subject = {
      ...WIRE.subject,
      tree: [
        { label: "bfs", pid: 4242 },
        { cpuPct: 12, label: "node", pid: 51 },
      ],
    };
    const row = parseDispatchRow({ value: { ...WIRE, subject } })!;

    expect(row.subject.tree).toStrictEqual([{ cpuPct: 12, elapsedSeconds: undefined, label: "node", pid: 51 }]);
  });
});

describe("dispatchLine", () => {
  it("names the instant, the triggers, the subject and the seat it opened", () => {
    const row = parseDispatchRow({ value: WIRE })!;

    expect(dispatchLine({ row })).toBe(
      "2026-09-19T09:00:00.000Z  OPEN  [hold+single-process] bfs — " +
        "bfs (pid 4242) at 301.2% cpu for 15m — foreign, no session owns it; seated investigate-bfs in workspace:9",
    );
  });

  it("says why no seat was opened, rather than going silent about it", () => {
    const row = parseDispatchRow({
      value: { ...WIRE, seated: { kind: "none", why: "backoff: 2 unsettled dispatch(es) on this signature" } },
    })!;

    expect(dispatchLine({ row })).toContain("no seat — backoff: 2 unsettled dispatch(es) on this signature");
  });

  it("prints the recovery for a registered row, whose spawn may have died with the watch", () => {
    const row = parseDispatchRow({
      value: { ...WIRE, seated: { kind: "registered", sinceIso: "2026-09-19T09:00:05.000Z", slug: "machine-load-d0" } },
    })!;

    expect(dispatchLine({ row })).toContain(
      "board row machine-load-d0 registered at 2026-09-19T09:00:05.000Z, its cmux spawn never reported — if no " +
        "workspace is on it (`slopweaver cmux list`), open one with `slopweaver cmux spawn machine-load-d0 --model opus`",
    );
  });

  it("reports a settled row as settled, with the instant it closed", () => {
    const row = parseDispatchRow({
      value: { ...WIRE, settled: { atIso: "2026-09-19T09:40:00.000Z", witness: "killed it" } },
    })!;

    expect(dispatchLine({ row })).toContain("settled 2026-09-19T09:40:00.000Z");
  });
});
