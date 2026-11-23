/** When a row last moved, read off its journal's last event, on the board and the one-row surface. */
import { describe, expect, it } from "vitest";

import {
  boardJsonDocument,
  boardJsonRow,
  NO_BOARD_REFERENCES,
  NO_DETACHED_FINDINGS,
} from "../../../../cli/commands/handover/listJson.js";
import type { HandoverDoc } from "../../../../handover/doc.js";
import { EMPTY_TAG_FILTER } from "../../../../handover/tagFilter.js";
import { doc, type Journal, modelsFor, OBSERVED, SCAN_STARTED } from "./fixtures.js";

/**
 * When a row last MOVED — the console's workstream band calls an in-flight row slipping off it. The journal is append-ordered, so the LAST event is the answer, never the latest instant.
 */
describe("boardJsonDocument's movedIso", () => {
  const started = { atIso: "2026-09-19T09:00:00.000Z", branch: "b", docHash: "h", kind: "started" } as const;
  const later = { atIso: "2026-09-19T11:00:00.000Z", kind: "question", question: "which palette?" } as const;

  function rowOf({ docs, journals }: { docs: readonly HandoverDoc[]; journals: ReadonlyMap<string, Journal> }): {
    readonly slug: string;
    readonly movedIso: string | undefined;
    readonly section: string;
  }[] {
    return boardJsonDocument({
      detached: NO_DETACHED_FINDINGS,
      filter: EMPTY_TAG_FILTER,
      handoverDir: "/h",
      models: modelsFor({ docs, journals }),
      observedAtIso: OBSERVED,
      references: NO_BOARD_REFERENCES,
      scanStartedIso: SCAN_STARTED,
      unreadable: [],
      unresolved: 0,
    }).rows.map((row) => ({ movedIso: row.movedIso, section: row.section, slug: row.slug }));
  }

  it("carries the last journal event's instant, not the first", () => {
    const journals = new Map<string, Journal>([["moving", { events: [started, later], unreadableLines: [] }]]);
    expect(rowOf({ docs: [doc({ slug: "moving" })], journals })).toEqual([
      { movedIso: "2026-09-19T11:00:00.000Z", section: "WAITING ON OWNER", slug: "moving" },
    ]);
  });

  it("carries no instant for a row that has no journal", () => {
    expect(rowOf({ docs: [doc({ slug: "untouched" })], journals: new Map() })).toEqual([
      { movedIso: undefined, section: "RUN NOW", slug: "untouched" },
    ]);
  });

  it("keeps the instant on a row the dependency pass places", () => {
    const orphaned = {
      atIso: "2026-09-19T12:00:00.000Z",
      deadSessionId: "gone",
      kind: "orphaned",
      lastEventIso: "2026-09-19T09:00:00.000Z",
    } as const;
    const journals = new Map<string, Journal>([["waits", { events: [started, orphaned], unreadableLines: [] }]]);
    const rows = rowOf({ docs: [doc({ blockedBy: ["first"], slug: "waits" }), doc({ slug: "first" })], journals });
    expect(rows.find((row) => row.slug === "waits")).toEqual({
      movedIso: "2026-09-19T12:00:00.000Z",
      section: "NOT YET",
      slug: "waits",
    });
  });

  it("prints the same instant through the one-row surface", () => {
    const journals = new Map<string, Journal>([["moving", { events: [started, later], unreadableLines: [] }]]);
    const model = modelsFor({ docs: [doc({ slug: "moving" })], journals })[0]!;
    expect(boardJsonRow({ model, ownerNames: new Set(), prSteers: undefined, repoSlugs: new Map() }).movedIso).toBe(
      "2026-09-19T11:00:00.000Z",
    );
  });
});
