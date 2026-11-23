/** The registered line a row says it bears on, withheld while a run asks its own question. */
import { describe, expect, it } from "vitest";

import { boardJsonRow } from "../../../../cli/commands/handover/listJson.js";
import { doc, type Journal, modelsFor } from "./fixtures.js";

describe("boardJsonRow — bearsOn", () => {
  const LINE = "The owner already said the mirror holds what an auditor opens.";
  const rowOf = ({ journals }: { journals?: ReadonlyMap<string, Journal> }) =>
    boardJsonRow({
      model: modelsFor({
        docs: [{ ...doc({ kind: "ask", slug: "mirror" }), bearsOn: LINE }],
        ...(journals === undefined ? {} : { journals }),
      })[0]!,
      ownerNames: new Set(),
      prSteers: undefined,
      repoSlugs: new Map(),
    });

  it("publishes the registered line on a row no run is asking about", () => {
    expect(rowOf({}).bearsOn).toBe(LINE);
  });

  it("withholds it while a run asks its own question, which it was never written for", () => {
    const journals = new Map<string, Journal>([
      [
        "mirror",
        {
          events: [
            { atIso: "2026-09-19T09:00:00.000Z", branch: "b", docHash: "h", kind: "started" },
            { atIso: "2026-09-19T09:30:00.000Z", kind: "question", question: "which palette?" },
          ],
          unreadableLines: [],
        },
      ],
    ]);
    const row = rowOf({ journals });

    expect(row.run).toBe("waiting-on-owner");
    expect(row.bearsOn).toBeUndefined();
  });

  it("publishes nothing for a row that recorded none", () => {
    const row = boardJsonRow({
      model: modelsFor({ docs: [doc({ kind: "ask", slug: "plain" })] })[0]!,
      ownerNames: new Set(),
      prSteers: undefined,
      repoSlugs: new Map(),
    });

    expect(row.bearsOn).toBeUndefined();
  });
});
