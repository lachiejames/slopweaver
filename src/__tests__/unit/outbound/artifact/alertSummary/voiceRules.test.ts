import { describe, expect, it } from "vitest";

import { updateArtifactAboveFoldCells } from "../../../../../outbound/artifact/aboveFold.js";
import { alertSummaryToUpdate } from "../../../../../outbound/artifact/alertSummary.js";
import type { UpdateArtifact } from "../../../../../outbound/artifact/types.js";
import { authoredProseOf, exactVoiceRuleFindings } from "../../../../../outbound/voice/exactRules.js";
import { tallyForm } from "./harness.js";

describe("alertSummaryToUpdate — the derived card must survive the operator's own voice rules", () => {
  /** The one rule this card used to break, spelled as the real schema spells it. */
  const emDashRule = { kind: "literal", value: "\u2014" } as const;

  /** The shipped extractor's cells, run through the same prose splitter the fold rules use. */
  function cellsAsProse({
    cells,
  }: {
    cells: readonly { path: string; text: string }[];
  }): readonly { path: string; text: string }[] {
    return cells.flatMap(({ path, text }) => authoredProseOf({ path, text }));
  }

  /** Every text run of a derived card, quoted or not — the NAIVE collector, kept so the quoted witness below has a control. */
  function proseOf({ artifact }: { artifact: UpdateArtifact }): readonly { path: string; text: string }[] {
    const indexRegions = artifact.index.map((runs, position) => ({
      path: `index[${String(position)}]`,
      text: runs.map((run) => (run.type === "text" ? run.text : "")).join(""),
    }));
    return [{ path: "tldr", text: artifact.tldr }, ...indexRegions].flatMap(({ path, text }) =>
      authoredProseOf({ path, text }),
    );
  }

  it("derives an empty window's card with nothing an em-dash rule refuses", () => {
    const artifact = alertSummaryToUpdate({ form: { ...tallyForm(), lead: undefined, rows: [] } });

    expect(exactVoiceRuleFindings({ prose: proseOf({ artifact }), rules: [emDashRule] })).toEqual([]);
  });

  it("derives a tallied card with nothing an em-dash rule refuses", () => {
    const artifact = alertSummaryToUpdate({ form: tallyForm() });

    expect(exactVoiceRuleFindings({ prose: proseOf({ artifact }), rules: [emDashRule] })).toEqual([]);
  });

  it("a MONITOR name carrying one is QUOTED, not authored: the real cell extractor skips it, and the witness above can still fire", () => {
    const form = { ...tallyForm(), lead: undefined, rows: [{ count: 3, label: "GCE \u2014 CPU high" }] };
    const artifact = alertSummaryToUpdate({ form });

    // Both halves: the rendered run still carries the monitor's own em dash verbatim …
    expect(artifact.index[0]).toContainEqual({ bold: true, quoted: true, text: "GCE \u2014 CPU high", type: "text" });
    // … and this file's naive collector, which reads every text run, proves the dash IS there to be found …
    expect(exactVoiceRuleFindings({ prose: proseOf({ artifact }), rules: [emDashRule] }).length).toBe(1);
    // … while the collector `slack post` actually uses does not read a quoted run.
    expect(
      exactVoiceRuleFindings({
        prose: cellsAsProse({ cells: updateArtifactAboveFoldCells({ artifact }) }),
        rules: [emDashRule],
      }),
    ).toEqual([]);
  });
});
