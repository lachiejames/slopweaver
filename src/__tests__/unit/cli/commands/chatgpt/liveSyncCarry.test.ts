/**
 * The listing a live-sync run carries to the next: when a carried walk lets the next one stop early, how a walk is laid
 * over the carry, and the file's round trip. Synthetic ids and instants only; the one filesystem touch is a throwaway dir.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import type { ListedChatgptConversation } from "../../../../../cli/commands/chatgpt/listing.js";
import {
  CARRY_MARGIN_MS,
  CARRY_MAX_AGE_MS,
  carryBoundaryIso,
  type ListingCarry,
  mergeListing,
  readListingCarry,
  writeListingCarry,
} from "../../../../../cli/commands/chatgpt/liveSyncCarry.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { tempDir, useTempDirs } from "../../../corpus/chatgpt/ingest/harness.js";

useTempDirs();

const WALK_STARTED = "2026-11-18T00:00:00.000Z";

function chat({ id, updatedIso }: { id: string; updatedIso: string }): ListedChatgptConversation {
  return {
    createdIso: "2026-01-01T00:00:00.000Z",
    id,
    lane: "active",
    projectId: null,
    title: "Synthetic",
    updatedIso,
  };
}

function carryOf({ conversations }: { conversations: readonly ListedChatgptConversation[] }): ListingCarry {
  return { conversations, walkStartedIso: WALK_STARTED, wholeWalkStartedIso: WALK_STARTED };
}

describe("carryBoundaryIso", () => {
  const carry = carryOf({ conversations: [] });

  it("is the carried walk's start less the margin while the carry is fresh", () => {
    const boundary = carryBoundaryIso({ carry, nowIso: "2026-11-18T06:00:00.000Z", relist: false });
    expect(boundary).toBe(new Date(Date.parse(WALK_STARTED) - CARRY_MARGIN_MS).toISOString());
    expect(boundary).toBe("2026-11-17T23:50:00.000Z");
  });

  it("is undefined, so the whole account is listed, with no carry or when --relist is given", () => {
    expect(carryBoundaryIso({ carry: undefined, nowIso: "2026-11-18T06:00:00.000Z", relist: false })).toBe(undefined);
    expect(carryBoundaryIso({ carry, nowIso: "2026-11-18T06:00:00.000Z", relist: true })).toBe(undefined);
  });

  it("is undefined once the carry is older than its maximum age, and still defined at exactly that age", () => {
    const atLimit = new Date(Date.parse(WALK_STARTED) + CARRY_MAX_AGE_MS).toISOString();
    const pastLimit = new Date(Date.parse(WALK_STARTED) + CARRY_MAX_AGE_MS + 1).toISOString();
    expect(carryBoundaryIso({ carry, nowIso: atLimit, relist: false })).toBe("2026-11-17T23:50:00.000Z");
    expect(carryBoundaryIso({ carry, nowIso: pastLimit, relist: false })).toBe(undefined);
  });

  it("reads the age from the last whole walk, so a carry renewed by carried runs still expires", () => {
    const renewed: ListingCarry = {
      conversations: [],
      walkStartedIso: "2026-11-20T00:00:00.000Z",
      wholeWalkStartedIso: WALK_STARTED,
    };
    const pastLimit = new Date(Date.parse(WALK_STARTED) + CARRY_MAX_AGE_MS + 1).toISOString();
    expect(carryBoundaryIso({ carry: renewed, nowIso: "2026-11-20T06:00:00.000Z", relist: false })).toBe(
      "2026-11-19T23:50:00.000Z",
    );
    expect(carryBoundaryIso({ carry: renewed, nowIso: pastLimit, relist: false })).toBe(undefined);
  });

  it("is undefined for a carry written in the future, which no clock can vouch for", () => {
    expect(carryBoundaryIso({ carry, nowIso: "2026-11-17T00:00:00.000Z", relist: false })).toBe(undefined);
  });
});

describe("mergeListing", () => {
  it("lays the walk over the carry: a named chat takes the walk's entry, the rest keep the carried one", () => {
    const merged = mergeListing({
      carried: [
        chat({ id: "a", updatedIso: "2026-11-01T00:00:00.000Z" }),
        chat({ id: "b", updatedIso: "2026-10-01T00:00:00.000Z" }),
      ],
      fresh: [
        chat({ id: "c", updatedIso: "2026-11-17T00:00:00.000Z" }),
        chat({ id: "a", updatedIso: "2026-11-16T00:00:00.000Z" }),
      ],
    });
    expect(merged.map((one) => [one.id, one.updatedIso])).toEqual([
      ["c", "2026-11-17T00:00:00.000Z"],
      ["a", "2026-11-16T00:00:00.000Z"],
      ["b", "2026-10-01T00:00:00.000Z"],
    ]);
  });

  it("is the carry alone when the walk named nothing", () => {
    const carried = [chat({ id: "a", updatedIso: "2026-11-01T00:00:00.000Z" })];
    expect(mergeListing({ carried, fresh: [] })).toEqual(carried);
  });

  it("keeps one entry per id, the first, when a carry names a chat twice", () => {
    const first = chat({ id: "a", updatedIso: "2026-11-02T00:00:00.000Z" });
    const repeat = chat({ id: "a", updatedIso: "2026-11-01T00:00:00.000Z" });
    const other = chat({ id: "b", updatedIso: "2026-11-01T00:00:00.000Z" });
    expect(mergeListing({ carried: [first, other, repeat], fresh: [] })).toEqual([first, other]);
  });
});

describe("the carry file", () => {
  it("reads as absent before any walk, and round-trips what a walk wrote", () => {
    const root = join(tempDir(), "live");
    expect(unwrap(readListingCarry({ root }))).toBe(undefined);
    const carry = carryOf({ conversations: [chat({ id: "a", updatedIso: "2026-11-01T00:00:00.000Z" })] });
    unwrap(writeListingCarry({ carry, root }));
    expect(unwrap(readListingCarry({ root }))).toEqual(carry);
  });

  it("refuses a file that is not what this writes, naming --relist as the way out", () => {
    const root = join(tempDir(), "live");
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, "listing-carry.json"), JSON.stringify({ schemaVersion: 2 }));
    const refused = unwrapErr(readListingCarry({ root }));
    expect(refused.code).toBe("FILE_FAILED");
    expect(refused.message).toContain("run with --relist to list again");
  });

  it("refuses a file that is not JSON, naming --relist too", () => {
    const root = join(tempDir(), "live");
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, "listing-carry.json"), "{ not json");
    const refused = unwrapErr(readListingCarry({ root }));
    expect(refused.code).toBe("FILE_FAILED");
    expect(refused.message).toContain("--relist");
  });
});
