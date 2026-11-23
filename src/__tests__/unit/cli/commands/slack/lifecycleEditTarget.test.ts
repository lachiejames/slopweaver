import { describe, expect, it } from "vitest";

import type { EditCardOptions } from "../../../../../cli/commands/slack/lifecycleCore.js";
import { cardEditTargetRefusals } from "../../../../../cli/commands/slack/lifecycleEditTarget.js";
import { ok } from "../../../../../lib/result.js";
import type { ReadSlackMessage } from "../../../../../outbound/slack/lifecycleGuards.js";
import { NO_FOLD_RENDERER } from "../../../../../outbound/slack/noFold.js";

const BUGS = { id: "C0SYN000003", name: "#defects" };

function options({ channel }: { channel: string }): EditCardOptions {
  return {
    actor: "bot",
    allowUnresolvedOwner: false,
    channel,
    dryRun: false,
    formJson: "{}",
    home: "/nonexistent-home",
    json: false,
    kind: "edit",
    ts: "1790000000.000100",
  };
}

const deps = {
  doorEnv: () => ({}),
  highStakes: () => ok({ channels: [BUGS], fleetGap: undefined, fleetUserIds: [], listGap: undefined }),
};

describe("cardEditTargetRefusals", () => {
  it("refuses a no-fold target before the channel is judged, naming the delete route", () => {
    const lines = cardEditTargetRefusals({
      deps,
      existing: { fileIds: [], renderer: NO_FOLD_RENDERER, ts: "1790000000.000100" },
      formKind: "update",
      options: options({ channel: BUGS.id }),
    });

    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain("slopweaver slack delete");
  });

  it("refuses a top-level update card in a high-stakes channel through the undefended hatch", () => {
    const lines = cardEditTargetRefusals({
      deps,
      existing: { fileIds: [], ts: "1790000000.000100" },
      formKind: "update",
      options: options({ channel: BUGS.id }),
    });

    expect(lines.join("\n")).toContain("high-stakes-undefended");
  });

  it.each<{ existing: ReadSlackMessage; name: string; channel?: string }>([
    {
      existing: { fileIds: [], threadTs: "1789999999.000100", ts: "1790000000.000100" },
      name: "a reply in a high-stakes channel",
    },
    {
      existing: { fileIds: [], ts: "1790000000.000100" },
      name: "a top-level card in an ordinary channel",
      channel: "C0SYNORDINARY",
    },
  ])("lets $name be edited", ({ existing, channel = BUGS.id }) => {
    expect(cardEditTargetRefusals({ deps, existing, formKind: "update", options: options({ channel }) })).toEqual([]);
  });

  it("lets a top-level finding card in a high-stakes channel be edited", () => {
    expect(
      cardEditTargetRefusals({
        deps,
        existing: { fileIds: [], ts: "1790000000.000100" },
        formKind: "finding",
        options: options({ channel: BUGS.id }),
      }),
    ).toEqual([]);
  });
});
