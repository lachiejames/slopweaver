/** The scene, or the gap instead of one, a parked question's own line carries onto its row. */
import { describe, expect, it } from "vitest";

import { boardJsonRow } from "../../../../cli/commands/handover/listJson.js";
import type { RunEvent } from "../../../../handover/ledger.js";
import { doc, type Journal, modelsFor } from "./fixtures.js";

describe("boardJsonRow — examples", () => {
  const SCENE = "You open the card and see the fleet merged its own fix. Was that right?";
  const rowOf = ({ asked }: { asked: RunEvent }) =>
    boardJsonRow({
      model: modelsFor({
        docs: [doc({ kind: "ask", slug: "scene" })],
        journals: new Map<string, Journal>([
          [
            "scene",
            {
              events: [{ atIso: "2026-09-19T09:00:00.000Z", branch: "b", docHash: "h", kind: "started" }, asked],
              unreadableLines: [],
            },
          ],
        ]),
      })[0]!,
      ownerNames: new Set(),
      prSteers: undefined,
      repoSlugs: new Map(),
    });

  // The scene rides the asking line, so the card reads it with no second append.
  it("publishes the scene a question line carries itself", () => {
    const row = rowOf({
      asked: { atIso: "2026-09-19T09:30:00.000Z", examples: [SCENE], kind: "question", question: "was it?" },
    });

    expect(row.run).toBe("waiting-on-owner");
    expect(row.examples).toEqual([SCENE]);
    expect(row.exampleGap).toBeUndefined();
  });

  it("publishes the gap a question line carries instead of a scene", () => {
    const row = rowOf({
      asked: { atIso: "2026-09-19T09:30:00.000Z", exampleGap: "no scene fits", kind: "question", question: "was it?" },
    });

    expect(row.exampleGap).toBe("no scene fits");
  });
});
