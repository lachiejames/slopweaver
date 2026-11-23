/*
 * `parseSlackForm` over the alert-summary form: a derived card whose runs carry the `quoted` flag is accepted, and
 * the flag is handed back on the row's monitor title and on the behind line's monitor and service names only.
 */
import { describe, expect, it } from "vitest";

import { parseSlackForm } from "../../../../../../cli/commands/slack/core.js";
import { unwrap } from "../../../../../../lib/result.js";

describe("parseSlackForm — the alert-summary form's own `quoted` runs", () => {
  const TALLY = JSON.stringify({
    behind: [{ events: 486, groups: [{ count: 475, name: "jobs-api" }], monitor: "Worker lease stalled — scheduler" }],
    kind: "alert-summary",
    label: "alerts-platform",
    rows: [{ count: 7, label: "Worker lease stalled — scheduler pausing or delaying batch run" }],
    skipped: 0,
    window: "24h",
  });

  // MEASURED: the derived card was validated with its flags still on, so `updateArtifactSchema`
  // refused `unknown field "quoted"` and every one of the ten daily team-alerts cards would have failed its
  // next firing. The strip is what this pins, and the restore below is why the strip is not the whole fix.
  it("accepts a derived card whose runs carry the flag the composed-form schema refuses", () => {
    const artifact = unwrap(parseSlackForm({ json: TALLY })).artifact;

    expect(artifact.kind).toBe("update");
  });

  it("hands the flag back on, so the voice pass still reads a monitor's title as somebody else's words", () => {
    const artifact = unwrap(parseSlackForm({ json: TALLY })).artifact;
    const index = artifact.kind === "update" ? artifact.index : [];

    expect(index[0]!.filter((run) => run.type === "text" && run.quoted === true).length).toBe(1);
  });

  // The BEHIND line's own borrowed words — the monitor again, and each service the aggregate grouped by. A
  // review pass found this half pinned by nothing: the row path had a witness and the widening did not, so a
  // regression here would have surfaced as a daily card refusing an em dash in a Datadog service tag.
  it("marks the behind line's monitor and every service name it names, and nothing else on that line", () => {
    const artifact = unwrap(parseSlackForm({ json: TALLY })).artifact;
    const detail = artifact.kind === "update" ? artifact.detail : [];
    const behindLine = detail.findLast((block) => block.type === "list")!;
    const runs = (behindLine.type === "list" ? behindLine.items : []).flat();

    const quoted = runs.filter((run) => run.type === "text" && run.quoted === true);

    expect(quoted.map((run) => (run.type === "text" ? run.text : ""))).toEqual([
      "Worker lease stalled — scheduler",
      "jobs-api",
    ]);
  });
});
