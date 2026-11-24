import { describe, expect, it } from "vitest";

import { parseStoreWatchQueueArgs } from "../../../cli/commands/store/watchQueueRun.js";
import { STORE_WATCH_QUEUE_USAGE } from "../../../cli/commands/store/watchQueueUsage.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import { queueWatchLineText } from "../../../store/queueChangeWatch.js";

describe("queueWatchLineText", () => {
  it("prints one JSON object per line for the broker", () => {
    expect(queueWatchLineText({ json: true, line: { kind: "changed", slug: "workstreams" } })).toBe(
      '{"kind":"changed","slug":"workstreams"}',
    );
    expect(queueWatchLineText({ json: true, line: { atIso: "2026-11-18T06:30:00.000Z", kind: "heartbeat" } })).toBe(
      '{"atIso":"2026-11-18T06:30:00.000Z","kind":"heartbeat"}',
    );
  });

  it("names every missing trigger and the verb that installs them, for a person", () => {
    expect(
      queueWatchLineText({
        json: false,
        line: { kind: "not-ready", missing: ["trg_workstream_queue_change", "trg_autonomy_event_queue_change"] },
      }),
    ).toBe(
      "store watch-queue: not listening — the store lacks 2 notify trigger(s): trg_workstream_queue_change, trg_autonomy_event_queue_change; run `slopweaver store push` to install them",
    );
  });

  it("names the channel when listening", () => {
    expect(queueWatchLineText({ json: false, line: { channel: "slopweaver_queue_change", kind: "ready" } })).toBe(
      "store watch-queue: listening on slopweaver_queue_change",
    );
  });
});

describe("STORE_WATCH_QUEUE_USAGE", () => {
  it("names the flags, the exit-3 refusal, and that the console never runs it", () => {
    expect(STORE_WATCH_QUEUE_USAGE).toBe(
      "usage: slopweaver store watch-queue [--home <dir>] [--json]\n" +
        "  Holds a LISTEN on the store's Queue channel and prints one line per event until stopped: ready, a register\n" +
        "  that changed, and a heartbeat every 15s that is a real round trip. Refuses, exiting 3, when the store lacks a\n" +
        "  notify trigger (`store push` installs them). Shows what the console's Queue hears; the console holds its own\n" +
        "  LISTEN and never runs this. Writes nothing.",
    );
  });
});

describe("parseStoreWatchQueueArgs", () => {
  it("reads --json with no home", () => {
    const parsed = parseStoreWatchQueueArgs({ rest: ["--json"] });
    expect(parsed.isOk()).toBe(true);
    expect(unwrap(parsed)).toEqual({ home: undefined, json: true });
  });

  it("refuses a flag the verb does not take", () => {
    const parsed = parseStoreWatchQueueArgs({ rest: ["--follow"] });
    expect(parsed.isErr()).toBe(true);
    expect(unwrapErr(parsed).join(" ")).toContain("--follow");
  });
});
