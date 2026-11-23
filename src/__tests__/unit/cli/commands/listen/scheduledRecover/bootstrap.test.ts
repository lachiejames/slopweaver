/**
 * `listen recover --scheduled`'s cycle — the bootstrap `--since` window and the V1-to-V2 watermark migration,
 * complete and partial. A real temp home, plain fake Slack API + write transport, an injected clock; never a real
 * network call.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runScheduledRecover } from "../../../../../../cli/commands/listen/scheduledRecover.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY } from "../../../../../../cli/exitCodes.js";
import type { SlackApi } from "../../../../../../corpus/slack/fetch.js";
import { writeThreadCursors } from "../../../../../../corpus/slack/threadCursors.js";
import { unwrap } from "../../../../../../lib/result.js";
import { readRecoverySweepState, writeRecoverySweepState } from "../../../../../../live/listen/recoverScheduleStore.js";
import { BASE_OPTIONS, fakeTransport, listOnlyC1 } from "../scheduledRecoverFakes.js";
import { emptyApi } from "./harness.js";

describe("runScheduledRecover", () => {
  let home: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "slop-scheduled-recover-"));
  });
  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("refuses --since once a durable watermark already exists", async () => {
    writeRecoverySweepState({
      home,
      state: { completedThroughTs: "1786500000.000000", nextDueAtIso: "2026-08-13T11:55:00.000Z", version: 1 },
    });

    const code = await runScheduledRecover({
      ...BASE_OPTIONS,
      api: emptyApi(),
      home,
      sinceExplicit: true,
      transport: fakeTransport({ calls: [] }),
    });

    expect(code).toBe(EXIT_ERROR);
  });

  it("writes V2, with an empty thread-checkpoint inventory, after a complete first-ever (missing-state) sweep", async () => {
    const code = await runScheduledRecover({
      ...BASE_OPTIONS,
      api: emptyApi(),
      home,
      transport: fakeTransport({ calls: [] }),
    });

    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    const state = unwrap(readRecoverySweepState({ home }));
    expect(state).toEqual({
      completedThroughTs: "1786622400.000000",
      nextDueAtIso: "2026-08-13T12:05:00.000Z",
      threadCheckpoints: {},
      version: 2,
    });
  });

  it("a V1 watermark is ignored during migration — the whole bootstrap --since window is read, not just its tail", async () => {
    writeRecoverySweepState({
      home,
      state: { completedThroughTs: "1786600000.000000", nextDueAtIso: "2026-08-13T11:55:00.000Z", version: 1 },
    });
    const seenOldest: string[] = [];
    const api: Pick<SlackApi, "history" | "replies" | "listChannels"> = {
      history: async ({ oldest }) => {
        seenOldest.push(oldest);
        return { messages: [] };
      },
      listChannels: listOnlyC1,
      replies: async () => ({ messages: [] }),
    };

    await runScheduledRecover({ ...BASE_OPTIONS, api, home, transport: fakeTransport({ calls: [] }) });

    // BASE_OPTIONS.sinceIso converts to epoch seconds 1786320000 — the WIDE bootstrap
    // bound, never the V1 watermark's own much-narrower "1786600000.000000".
    expect(seenOldest).toEqual(["1786320000.000000"]);
  });

  it("a partial migration sweep writes V1/missing back unchanged, so the next invocation retries the same bootstrap", async () => {
    const api: Pick<SlackApi, "history" | "replies" | "listChannels"> = {
      history: async () => {
        throw new Error("rate limited");
      },
      listChannels: listOnlyC1,
      replies: async () => ({ messages: [] }),
    };

    const code = await runScheduledRecover({ ...BASE_OPTIONS, api, home, transport: fakeTransport({ calls: [] }) });

    expect(code).toBe(EXIT_ERROR);
    const state = unwrap(readRecoverySweepState({ home }));
    expect(state).toEqual({ nextDueAtIso: "2026-08-13T12:05:00.000Z", version: 1 });
  });

  it("a partial migration sweep with an EXISTING V1 state preserves it completely unchanged, including its own nextDueAtIso", async () => {
    writeRecoverySweepState({
      home,
      state: { completedThroughTs: "1786500000.000000", nextDueAtIso: "2026-08-13T11:55:00.000Z", version: 1 },
    });
    const api: Pick<SlackApi, "history" | "replies" | "listChannels"> = {
      history: async () => {
        throw new Error("rate limited");
      },
      listChannels: listOnlyC1,
      replies: async () => ({ messages: [] }),
    };

    const code = await runScheduledRecover({ ...BASE_OPTIONS, api, home, transport: fakeTransport({ calls: [] }) });

    expect(code).toBe(EXIT_ERROR);
    const state = unwrap(readRecoverySweepState({ home }));
    expect(state).toEqual({
      completedThroughTs: "1786500000.000000",
      nextDueAtIso: "2026-08-13T11:55:00.000Z",
      version: 1,
    });
  });

  it("seeds a migration's checkpoint inventory with a corpus thread-cursor KEY, never its cursor VALUE", async () => {
    writeThreadCursors({ cursors: { "C1:1786400000.000100": { ts: "1786500000.000000" } }, home });

    const code = await runScheduledRecover({
      ...BASE_OPTIONS,
      api: emptyApi(),
      home,
      transport: fakeTransport({ calls: [] }),
    });

    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    const state = unwrap(readRecoverySweepState({ home }));
    // The bootstrap's own lower window bound (1786320000.000000), never the corpus's real cursor value
    // (1786500000.000000) — copying that value could skip a reply the corpus ingested but recovery never
    // classified. The freshly-seeded thread is also due (no `lastCheckedAtIso` yet) on an otherwise-empty
    // workspace, so this same bootstrap sweep polls it too — its `lastCheckedAtIso` records that.
    expect(state).toEqual({
      completedThroughTs: "1786622400.000000",
      nextDueAtIso: "2026-08-13T12:05:00.000Z",
      threadCheckpoints: {
        "C1:1786400000.000100": { cursorTs: "1786320000.000000", lastCheckedAtIso: "2026-08-13T12:00:00.000Z" },
      },
      version: 2,
    });
  });
});
