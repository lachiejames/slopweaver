/**
 * `src/cli/commands/claude/seatProfile.ts` — a prompt into a session lacking the owner's profile carries it in as
 * `additionalContext`; a session holding it gets nothing added. A real marker and ledger in a temp home, a plain fake
 * for the load.
 */
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { markPromptDelivery, promptProfile } from "../../../cli/commands/claude/seatProfile.js";
import type { LoadedContext } from "../../../context/cachedContext.js";
import { FIRST_BOOT_LINES, UNLOADED_HEADLINE } from "../../../context/loadLedger.js";
import { type DeliveryContext, markProfileDelivered, profileWasDelivered } from "../../../context/profileDelivery.js";
import { unwrap } from "../../../lib/result.js";

let home = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "seat-profile-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** A loader answering `loaded`. */
function loader({ loaded }: { loaded: LoadedContext }): () => Promise<LoadedContext> {
  return () => Promise.resolve(loaded);
}

const NOW = "2026-10-14T03:00:00.000Z";

/** A main thread's context, with no transcript named. */
function mainThread({ id }: { id: string }): DeliveryContext {
  return { awaitsBoundary: false, id, transcriptPath: undefined };
}

describe("promptProfile", () => {
  it("adds nothing to a session that holds its profile", async () => {
    unwrap(markProfileDelivered({ context: mainThread({ id: "s-1" }), home }));
    const carried = await promptProfile({
      delivery: mainThread({ id: "s-1" }),
      home,
      load: loader({ loaded: { lines: ["x"], origin: "live", reason: "" } }),
      nowIso: NOW,
      sessionId: "s-1",
    });
    expect(carried).toEqual({ deliversTo: undefined, line: undefined });
  });

  it("carries the profile into a prompt as UserPromptSubmit context, and the marker follows the print", async () => {
    const carried = await promptProfile({
      delivery: mainThread({ id: "s-2" }),
      home,
      load: loader({ loaded: { lines: ["## About the owner", "- a fact"], origin: "live", reason: "" } }),
      nowIso: NOW,
      sessionId: "s-2",
    });
    expect(JSON.parse(carried.line!)).toEqual({
      hookSpecificOutput: { additionalContext: "## About the owner\n- a fact", hookEventName: "UserPromptSubmit" },
    });
    expect(unwrap(profileWasDelivered({ context: mainThread({ id: "s-2" }), home }))).toBe(false);
    markPromptDelivery({ deliversTo: carried.deliversTo, home });
    expect(unwrap(profileWasDelivered({ context: mainThread({ id: "s-2" }), home }))).toBe(true);
  });

  it("carries the STOP block, and names no session to mark, when nothing loaded", async () => {
    const carried = await promptProfile({
      delivery: mainThread({ id: "s-3" }),
      firstBoot: () => false,
      home,
      load: loader({ loaded: { lines: ["unavailable"], origin: "none", reason: "store down" } }),
      nowIso: NOW,
      sessionId: "s-3",
    });
    const context = (JSON.parse(carried.line!) as { hookSpecificOutput: { additionalContext: string } })
      .hookSpecificOutput.additionalContext;
    expect([context.startsWith(UNLOADED_HEADLINE), carried.deliversTo]).toEqual([true, undefined]);
  });

  it("carries the first-boot lines, not the STOP block, on a machine never configured, and records nothing", async () => {
    const carried = await promptProfile({
      delivery: mainThread({ id: "s-5" }),
      firstBoot: () => true,
      home,
      load: loader({ loaded: { lines: ["unavailable"], origin: "none", reason: "no database is selected" } }),
      nowIso: NOW,
      sessionId: "s-5",
    });
    const context = (JSON.parse(carried.line!) as { hookSpecificOutput: { additionalContext: string } })
      .hookSpecificOutput.additionalContext;
    expect([context, carried.deliversTo, existsSync(join(home, "profile", "loads.jsonl"))]).toEqual([
      FIRST_BOOT_LINES.join("\n"),
      undefined,
      false,
    ]);
  });

  it("reads a live answer of no owner row as a first boot on a fresh machine, and as a load on a configured one", async () => {
    // An empty live read delivered and recorded let the session write the profile and act on it
    // unloaded; on a fresh machine it is no profile at all.
    const absent: LoadedContext = { lines: ["## About the owner"], origin: "live", ownerAbsent: true, reason: "" };
    const fresh = await promptProfile({
      delivery: mainThread({ id: "s-6" }),
      firstBoot: () => true,
      home,
      load: loader({ loaded: absent }),
      nowIso: NOW,
      sessionId: "s-6",
    });
    const recordedFresh = existsSync(join(home, "profile", "loads.jsonl"));
    const configured = await promptProfile({
      delivery: mainThread({ id: "s-7" }),
      firstBoot: () => false,
      home,
      load: loader({ loaded: absent }),
      nowIso: NOW,
      sessionId: "s-7",
    });
    expect([fresh.deliversTo, recordedFresh]).toEqual([undefined, false]);
    expect([configured.deliversTo, existsSync(join(home, "profile", "loads.jsonl"))]).toEqual([
      mainThread({ id: "s-7" }),
      true,
    ]);
  });

  it("bounds the live read at the session-start hook's two seconds, so a stalled store answers from the cache", async () => {
    const asked: number[] = [];
    await promptProfile({
      delivery: mainThread({ id: "s-4" }),
      home,
      load: ({ boundMs }) => {
        asked.push(boundMs);
        return Promise.resolve({ lines: ["x"], origin: "live", reason: "" });
      },
      nowIso: NOW,
      sessionId: "s-4",
    });
    expect(asked).toEqual([2_000]);
  });
});
