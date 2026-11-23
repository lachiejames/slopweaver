/**
 * The board document itself: each row's placement and identity, the closed sections the rendered board hides,
 * a parked run's question, and an empty board.
 */
import { describe, expect, it } from "vitest";

import {
  boardJsonDocument,
  NO_BOARD_REFERENCES,
  NO_DETACHED_FINDINGS,
} from "../../../../cli/commands/handover/listJson.js";
import { EMPTY_TAG_FILTER } from "../../../../handover/tagFilter.js";
import { doc, type Journal, modelsFor, OBSERVED, SCAN_STARTED } from "./fixtures.js";

describe("boardJsonDocument", () => {
  it("carries each row's placement, the reason for it, and enough identity to go and look", () => {
    const document = boardJsonDocument({
      detached: NO_DETACHED_FINDINGS,
      filter: EMPTY_TAG_FILTER,
      handoverDir: "/h",
      models: modelsFor({ docs: [doc({ kind: "ask", priority: "p0", slug: "ready-one" })] }),
      observedAtIso: OBSERVED,
      references: NO_BOARD_REFERENCES,
      scanStartedIso: SCAN_STARTED,
      unreadable: [],
      unresolved: 0,
    });

    expect(document.observedAtIso).toBe(OBSERVED);
    expect(document.scanStartedIso).toBe(SCAN_STARTED);
    expect(document.handoverDir).toBe("/h");
    expect(document.rows.length).toBe(1);
    const row = document.rows[0]!;
    expect(row.slug).toBe("ready-one");
    expect(row.section).toBe("RUN NOW");
    expect(row.kind).toBe("ask");
    expect(row.priority).toBe("p0");
    expect(row.status).toBe("ready");
    expect(row.summary).toBe("what ready-one does");
    expect(row.repo).toBe("/w/repo");
    expect(row.path).toBe("/h/ready-one.md");
    expect(row.run).toBe("never-started");
  });

  /**
   * The rendered board hides the closed sections behind `--all`. This lane must not, because a caller can
   * filter on `section` and cannot recover a row that was dropped before it ever saw one.
   */
  it("emits the closed sections the rendered board hides", () => {
    const document = boardJsonDocument({
      detached: NO_DETACHED_FINDINGS,
      filter: EMPTY_TAG_FILTER,
      handoverDir: "/h",
      models: modelsFor({ docs: [doc({ slug: "shipped", status: "done" }), doc({ slug: "live" })] }),
      observedAtIso: OBSERVED,
      references: NO_BOARD_REFERENCES,
      scanStartedIso: SCAN_STARTED,
      unreadable: [],
      unresolved: 0,
    });

    expect(document.rows.map((row) => row.slug).toSorted()).toEqual(["live", "shipped"]);
    expect(document.rows.find((row) => row.slug === "shipped")!.section).toBe("DONE");
  });

  it("reports a run parked on the owner with the question it recorded", () => {
    const journals = new Map<string, Journal>([
      [
        "parked",
        {
          events: [
            { atIso: "2026-09-19T09:00:00.000Z", branch: "b", docHash: "h", kind: "started" },
            { atIso: "2026-09-19T09:30:00.000Z", kind: "question", question: "which palette?" },
          ],
          unreadableLines: [],
        },
      ],
    ]);
    const document = boardJsonDocument({
      detached: NO_DETACHED_FINDINGS,
      filter: EMPTY_TAG_FILTER,
      handoverDir: "/h",
      models: modelsFor({ docs: [doc({ slug: "parked" })], journals }),
      observedAtIso: OBSERVED,
      references: NO_BOARD_REFERENCES,
      scanStartedIso: SCAN_STARTED,
      unreadable: [],
      unresolved: 0,
    });

    const row = document.rows[0]!;
    expect(row.run).toBe("waiting-on-owner");
    expect(row.question).toBe("which palette?");
  });

  /** A run that is NOT waiting carries no question — the other dispositions have strings that are not one. */
  it("leaves the question absent on a run that is not waiting on the owner", () => {
    const document = boardJsonDocument({
      detached: NO_DETACHED_FINDINGS,
      filter: EMPTY_TAG_FILTER,
      handoverDir: "/h",
      models: modelsFor({ docs: [doc({ slug: "ready-one" })] }),
      observedAtIso: OBSERVED,
      references: NO_BOARD_REFERENCES,
      scanStartedIso: SCAN_STARTED,
      unreadable: [],
      unresolved: 0,
    });

    expect(document.rows[0]!.question).toBe(undefined);
  });

  it("is an empty document rather than an error when nothing is on the board", () => {
    const document = boardJsonDocument({
      detached: NO_DETACHED_FINDINGS,
      filter: EMPTY_TAG_FILTER,
      handoverDir: "/h",
      models: [],
      observedAtIso: OBSERVED,
      references: NO_BOARD_REFERENCES,
      scanStartedIso: SCAN_STARTED,
      unreadable: ["/h/broken.md"],
      unresolved: 3,
    });

    expect(document.rows).toEqual([]);
    expect(document.unreadable).toEqual(["/h/broken.md"]);
    expect(document.unresolved).toBe(3);
  });
});
