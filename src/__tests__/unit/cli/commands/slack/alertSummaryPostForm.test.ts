/**
 * `slack post --form` over an alert-summary form: the card validates with its row labels' `quoted` flags removed,
 * and the card it hands on carries them again — so a monitor title with an em dash neither fails the layout
 * schema nor reaches the voice rules as authored prose.
 */
import { describe, expect, it } from "vitest";

import { parseSlackForm } from "../../../../../cli/commands/slack/coreForm.js";
import { unwrap } from "../../../../../lib/result.js";
import { updateArtifactAboveFoldCells } from "../../../../../outbound/artifact/aboveFold.js";
import type { UpdateArtifact } from "../../../../../outbound/artifact/types.js";

/** The card an alert-summary form parses to — always an update card, so anything else throws. */
function cardOf({ json }: { json: string }): UpdateArtifact {
  const { artifact } = unwrap(parseSlackForm({ json }));
  if (artifact.kind !== "update") {
    throw new Error(`an alert-summary form parsed to a ${artifact.kind} message`);
  }
  return artifact;
}

const FORM = {
  kind: "alert-summary",
  label: "alerts-platform",
  rows: [
    { count: 7, label: "Worker lease stalled — scheduler pauses batch runs", severity: "red" },
    { count: 2, label: "Pool fetch timeout", severity: "orange" },
  ],
  skipped: 0,
  window: "24h",
};

describe("parseSlackForm — an alert-summary form", () => {
  it("ACCEPTS rows whose labels are quoted titles, and hands on a card whose labels are marked quoted", () => {
    const card = cardOf({ json: JSON.stringify(FORM) });
    const labelRuns = card.index.flatMap((runs) => runs.filter((run) => run.type === "text" && run.bold === true));

    expect(labelRuns).toEqual([
      { bold: true, quoted: true, text: "Worker lease stalled — scheduler pauses batch runs", type: "text" },
      { bold: true, quoted: true, text: "Pool fetch timeout", type: "text" },
    ]);
  });

  it("marks a title the fold TRIMMED as quoted too, so a long noisy monitor still posts", () => {
    const label = "Worker lease stalled — scheduler pauses batch runs on the primary cluster (prod)";
    const card = cardOf({
      json: JSON.stringify({
        ...FORM,
        rows: [{ citationUrl: "https://example.invalid/m/1", count: 1000, label, severity: "red" }],
      }),
    });
    const labelRun = card.index[0]!.find((run) => run.type === "text" && run.bold === true);

    // 62 rather than the 78 this asserted before an owner ask: the line now carries the derived priority
    // and the estimated blast radius as well, and the LABEL is still the only cell that gives way to make room.
    expect(label.length).toBe(80);
    expect(labelRun).toEqual({ bold: true, quoted: true, text: `${label.slice(0, 62)}…`, type: "text" });
    expect(updateArtifactAboveFoldCells({ artifact: card }).some((cell) => cell.text.includes("Worker"))).toBe(false);
  });

  it("keeps a monitor's title out of the above-the-fold voice cells", () => {
    const card = cardOf({ json: JSON.stringify(FORM) });
    const cells = updateArtifactAboveFoldCells({ artifact: card }).map((cell) => cell.text);

    expect(cells.some((text) => text.includes("Worker lease stalled"))).toBe(false);
    expect(cells.length).toBeGreaterThan(0);
  });
});
