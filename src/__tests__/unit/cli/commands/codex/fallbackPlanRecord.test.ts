/**
 * `codex plan-fallback record`'s body over the REAL store-backed port on an in-memory store: which request it
 * will answer, and that a request it refuses gains no receipt row.
 */
import { describe, expect, it } from "vitest";

import { readUnansweredPlanRequest, recordFallbackPlan } from "../../../../../cli/commands/codex/fallbackPlanRecord.js";
import { EXIT_ERROR } from "../../../../../cli/exitCodes.js";
import type { ClaudeFallbackPlanRequest } from "../../../../../codex/fallbackPlan.js";
import { fallbackRequestText } from "../../../../../codex/fallbackRequestRead.js";
import {
  memoryFallbackRegisterPort,
  memoryFallbackStore,
  putFallbackRequest,
  unavailableFallbackRegisterPort,
} from "../../../../fallbackRegisterFixture.js";

const HOME = "/h/unused-by-the-memory-store";
const HEAD = "06e12d9aa1b2c3d4e5f60718293a4b5c6d7e8f90";

const REQUEST: ClaudeFallbackPlanRequest = {
  capEvidence: {
    blockedBy: "Codex reported workspace_member_usage_limit_reached at 2026-09-15T08:22:23.654Z",
    limitId: null,
    observedAtIso: "2026-09-15T08:22:23.654Z",
    reachedType: "workspace_member_usage_limit_reached",
  },
  createdAtIso: "2026-09-15T16:00:00.000Z",
  mode: "plan",
  pass: "p1",
  promptBytes: 1,
  promptSha256: "a".repeat(64),
  repoRoot: "/w/repo",
  requestId: "plan-a",
  schemaVersion: 1,
  taskSha256: "b".repeat(64),
  tree: { branch: "feature", dirtyBytes: 0, fingerprint: "f".repeat(64), headSha: HEAD, treeSha: HEAD },
};

describe("which plan request record will answer", () => {
  it("reads an unanswered request back with the exact bytes a receipt binds to", async () => {
    const port = memoryFallbackRegisterPort();
    const requestText = await putFallbackRequest({ home: HOME, port, request: REQUEST });

    const read = await readUnansweredPlanRequest({ home: HOME, port, requestId: "plan-a" });

    expect(read).toEqual({ answered: false, bytes: requestText, request: REQUEST });
  });

  it("refuses a request that already has a receipt row", async () => {
    const store = memoryFallbackStore();
    store.rows.set("plan-a", {
      receiptText: "{}",
      requestId: "plan-a",
      requestText: fallbackRequestText({ request: REQUEST }),
    });

    const read = await readUnansweredPlanRequest({
      home: HOME,
      port: memoryFallbackRegisterPort({ store }),
      requestId: "plan-a",
    });

    expect(read).toBe(EXIT_ERROR);
  });

  it("refuses an id no row carries", async () => {
    const read = await readUnansweredPlanRequest({
      home: HOME,
      port: memoryFallbackRegisterPort(),
      requestId: "absent",
    });

    expect(read).toBe(EXIT_ERROR);
  });

  it("refuses when the store cannot be reached, rather than reading anything else", async () => {
    const read = await readUnansweredPlanRequest({
      home: HOME,
      port: unavailableFallbackRegisterPort(),
      requestId: "plan-a",
    });

    expect(read).toBe(EXIT_ERROR);
  });
});

describe("recording a plan answer", () => {
  it("leaves an unanswered request unanswered when its answer file cannot be read", async () => {
    const store = memoryFallbackStore();
    await putFallbackRequest({ home: HOME, port: memoryFallbackRegisterPort({ store }), request: REQUEST });

    const exit = await recordFallbackPlan({
      answerFile: "/nonexistent/answer.json",
      home: HOME,
      json: false,
      planner: { host: "claude-code", model: null, workspace: null },
      port: memoryFallbackRegisterPort({ store }),
      repo: "/nonexistent/repo",
      requestId: "plan-a",
    });

    expect(exit).toBe(EXIT_ERROR);
    expect(store.rows.get("plan-a")!.receiptText).toBe(null);
    expect([...store.rows.keys()]).toEqual(["plan-a"]);
  });
});
