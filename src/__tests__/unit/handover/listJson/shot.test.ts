/** The picture a row publishes: a parked question's from its journal, a registered ask's from front matter. */
import { describe, expect, it } from "vitest";

import { boardJsonRow } from "../../../../cli/commands/handover/listJson.js";
import type { RunEvent } from "../../../../handover/ledger.js";
import { doc, type Journal, modelsFor } from "./fixtures.js";

describe("boardJsonRow — shot", () => {
  const SHOT = {
    boxes: [{ height: 40, label: "empty on every trace", width: 300, x: 120, y: 80 }],
    height: 900,
    sha256: "c".repeat(64),
    width: 1440,
  };
  const ASKED: RunEvent = { atIso: "2026-09-19T09:30:00.000Z", kind: "question", question: "is it worth it?" };
  const rowOf = ({ events, shot }: { events: readonly RunEvent[]; shot: typeof SHOT | undefined }) =>
    boardJsonRow({
      model: modelsFor({
        docs: [{ ...doc({ kind: "ask", slug: "tracing" }), ...(shot === undefined ? {} : { shot }) }],
        journals: new Map<string, Journal>([
          [
            "tracing",
            {
              events: [{ atIso: "2026-09-19T09:00:00.000Z", branch: "b", docHash: "h", kind: "started" }, ...events],
              unreadableLines: [],
            },
          ],
        ]),
      })[0]!,
      ownerNames: new Set(),
      prSteers: undefined,
      repoSlugs: new Map(),
    });

  it("publishes the picture a parked question's journal binds to it", () => {
    const pictured: RunEvent = { ...ASKED, atIso: "2026-09-19T09:40:00.000Z", kind: "question-shot", shot: SHOT };
    const row = rowOf({ events: [ASKED, pictured], shot: undefined });

    expect([row.run, row.shot]).toEqual(["waiting-on-owner", SHOT]);
  });

  it("reads a parked run's picture from its journal only, never the doc's front matter", () => {
    expect(rowOf({ events: [ASKED], shot: SHOT }).shot).toBe(undefined);
  });

  it("publishes a registered ask's front-matter picture when no run holds a question", () => {
    expect(rowOf({ events: [], shot: SHOT }).shot).toEqual(SHOT);
  });
});
