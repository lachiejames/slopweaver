/** Who or what a paused row is paused on, as the board publishes it. */
import { describe, expect, it } from "vitest";

import {
  boardJsonDocument,
  NO_BOARD_REFERENCES,
  NO_DETACHED_FINDINGS,
} from "../../../../cli/commands/handover/listJson.js";
import type { HandoverDoc } from "../../../../handover/doc.js";
import { ownerNames } from "../../../../handover/pauseSubject.js";
import { EMPTY_TAG_FILTER } from "../../../../handover/tagFilter.js";
import { doc, modelsFor, OBSERVED, SCAN_STARTED } from "./fixtures.js";

describe("boardJsonDocument's pausedOn", () => {
  it("publishes a PAUSED row's subject whole, even where the reason's phrase could not be split back", () => {
    const paused: HandoverDoc = {
      ...doc({ slug: "held", status: "paused" }),
      pausedOn: "Othercompany, since merger",
      pausedSince: "2026-09-20",
    };
    const rows = boardJsonDocument({
      detached: NO_DETACHED_FINDINGS,
      filter: EMPTY_TAG_FILTER,
      handoverDir: "/h",
      models: modelsFor({ docs: [paused, doc({ slug: "ready" })], journals: new Map() }),
      observedAtIso: OBSERVED,
      references: NO_BOARD_REFERENCES,
      scanStartedIso: SCAN_STARTED,
      unreadable: [],
      unresolved: 0,
    }).rows;
    expect(rows[0]!.reason).toBe("paused on Othercompany, since merger, since 2026-09-20 — no deadline, never overdue");
    expect(rows.map((row) => ({ pausedOn: row.pausedOn, section: row.section, slug: row.slug }))).toEqual([
      { pausedOn: "Othercompany, since merger", section: "PAUSED", slug: "held" },
      { pausedOn: undefined, section: "RUN NOW", slug: "ready" },
    ]);
  });

  it("publishes an older pause naming the owner as the owner's role word, and anyone else's as written", () => {
    const onOwner: HandoverDoc = { ...doc({ slug: "on-owner", status: "paused" }), pausedOn: "Ada" };
    const onQuinn: HandoverDoc = { ...doc({ slug: "on-quinn", status: "paused" }), pausedOn: "Quinn" };
    const rows = boardJsonDocument({
      detached: NO_DETACHED_FINDINGS,
      filter: EMPTY_TAG_FILTER,
      handoverDir: "/h",
      models: modelsFor({ docs: [onOwner, onQuinn], journals: new Map() }),
      observedAtIso: OBSERVED,
      references: { ...NO_BOARD_REFERENCES, ownerNames: ownerNames({ displayName: "Ada Lovelace", persons: [] }) },
      scanStartedIso: SCAN_STARTED,
      unreadable: [],
      unresolved: 0,
    }).rows;
    expect(rows.map((row) => ({ pausedOn: row.pausedOn, slug: row.slug }))).toEqual([
      { pausedOn: "owner", slug: "on-owner" },
      { pausedOn: "Quinn", slug: "on-quinn" },
    ]);
  });
});
