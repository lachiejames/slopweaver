/**
 * What `github bump-drive` reports about one bump without making a write: the caps, the no-act arms, and the
 * ledger rail a dry run and a real pass share — so a dry run never promises an act the real pass refuses.
 */
import { describe, expect, it } from "vitest";

import type { AutonomyActionRow } from "../../../../../autonomy/types.js";
import { cappedOutcome, dryOutcome, ledgerRefusal } from "../../../../../cli/commands/github/bumpDriveOutcomes.js";
import { err, ok, type Result } from "../../../../../lib/result.js";
import type { BumpAct, BumpPlan } from "../../../../../review/bumpSelection.js";
import { landingRowFake } from "../../../../landingRowFake.js";

/** One plan, with only the act a case is about stated. */
function plan({ act }: { act: BumpAct }): BumpPlan {
  return { act, row: landingRowFake({ number: 661 }), signal: "bot-author", why: "every test passed" };
}

/** A ledger that answers, so it can take a row. */
const writable = {
  ledgerActs: (): Promise<Result<readonly AutonomyActionRow[], string>> => Promise.resolve(ok([])),
};

/** A ledger whose store refuses. */
const unwritable = {
  ledgerActs: (): Promise<Result<readonly AutonomyActionRow[], string>> =>
    Promise.resolve(err("the autonomy ledger lives in the store, and the store could not be opened")),
};

describe("ledgerRefusal", () => {
  it("answers undefined when the ledger can take the act's row", async () => {
    expect(await ledgerRefusal({ deps: writable, home: undefined, plan: plan({ act: "enqueue" }) })).toBe(undefined);
  });

  it("names the unmade act and the ledger's own error when it cannot", async () => {
    const refused = (await ledgerRefusal({
      deps: unwritable,
      home: undefined,
      plan: plan({ act: "undraft-and-enqueue" }),
    }))!;
    expect(refused.outcome).toBe("failed");
    expect(refused.detail).toBe(
      "not undrafted: the autonomy ledger could not be read (the autonomy ledger lives in the store, and the store could not be opened), and an unasked act the owner's briefing could not show is not made",
    );
  });
});

describe("dryOutcome", () => {
  it("promises the act when the ledger can take its row", async () => {
    const outcome = await dryOutcome({
      deps: writable,
      entry: { capped: false, plan: plan({ act: "enqueue" }) },
      home: undefined,
    });
    expect(outcome.outcome).toBe("would-act");
    expect(outcome.detail).toBe("would enqueue: every test passed");
  });

  it("refuses a rewrite the real pass would refuse, never 'would rewrite-body'", async () => {
    const outcome = await dryOutcome({
      deps: unwritable,
      entry: { capped: false, plan: plan({ act: "rewrite-body" }) },
      home: undefined,
    });
    expect(outcome.outcome).toBe("failed");
    expect(outcome.detail.startsWith("not rewritten: ")).toBe(true);
  });

  it("still promises a seat, which writes no autonomy row, past an unwritable ledger", async () => {
    const outcome = await dryOutcome({
      deps: unwritable,
      entry: { capped: false, plan: plan({ act: "seat" }) },
      home: undefined,
    });
    expect(outcome.outcome).toBe("would-act");
  });

  it("reports a cap before the ledger, the same line a real pass prints", async () => {
    const entry = { capped: true, plan: plan({ act: "enqueue" }) };
    expect(await dryOutcome({ deps: unwritable, entry, home: undefined })).toEqual(cappedOutcome({ plan: entry.plan }));
  });

  it("skips a seat the board already holds, as the real pass's `seatOne` does, never 'would seat'", async () => {
    const seat = plan({ act: "seat" });
    const outcome = await dryOutcome({
      deps: writable,
      entry: {
        capped: false,
        plan: {
          ...seat,
          row: { ...seat.row, boardRow: { kind: "row", slug: "land-acme-widgets-661", status: "ready" } },
        },
      },
      home: undefined,
    });
    expect(outcome.outcome).toBe("skipped");
    expect(outcome.detail).toBe("land-acme-widgets-661 already holds this branch and is ready");
  });

  it("skips a no-act arm with the plan's own reason", async () => {
    const outcome = await dryOutcome({
      deps: unwritable,
      entry: { capped: false, plan: plan({ act: "held" }) },
      home: undefined,
    });
    expect(outcome.outcome).toBe("skipped");
    expect(outcome.detail).toBe("every test passed");
  });
});
