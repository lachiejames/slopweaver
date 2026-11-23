/**
 * Every row `github bump-drive` writes to the autonomy ledger, and the id the body rewrite is keyed by.
 *
 * Two of the three exist because the act they record would otherwise be invisible to the owner: rule 10's other half
 * is that an unasked act is RECORDED, and a pass that undrafted a bump or replaced a bot's description leaves
 * no other trace outside a transcript. The third reason is mechanical — `bumpBodyActionId` is the rewrite's
 * one-per-head guard, so a change to how it is keyed changes whether the verb can loop.
 */
import { describe, expect, it } from "vitest";

import {
  AUTONOMY_ACTION_ID_MAX,
  AUTONOMY_SLUG_PATTERN,
  type AutonomyActionRow,
} from "../../../../../autonomy/types.js";
import {
  bumpBodyActionId,
  bumpBodyWasRecorded,
  bumpLedgerRow,
  bumpRewriteLedgerRow,
  bumpUndraftLedgerRow,
} from "../../../../../cli/commands/github/bumpDriveLedger.js";
import { pressActionId } from "../../../../../cli/commands/github/landingPressRow.js";
import type { BumpAct, BumpPlan } from "../../../../../review/bumpSelection.js";
import { landingRowFake } from "../../../../landingRowFake.js";

/** `landingRowFake`'s head, which every id below spells whole. */
const HEAD = "1".repeat(40);

/** One plan, with only the fields a case is about stated. */
function plan({ act, number = 1, why = "because" }: { act: BumpAct; number?: number; why?: string }): BumpPlan {
  return { act, row: landingRowFake({ number }), signal: "bot-author", why };
}

describe("bumpLedgerRow", () => {
  it("records the enqueue with its subject and the signal that selected it", () => {
    const row = bumpLedgerRow({
      atIso: "2026-09-20T01:00:00.000Z",
      bySession: "session-1",
      plan: plan({ act: "enqueue", number: 951, why: "every one of the six tests passed" }),
    });

    expect(row).toEqual({
      actionId: `enqueue-acme.widgets-951-${HEAD}`,
      bySession: "session-1",
      doneIso: "2026-09-20T01:00:00.000Z",
      kind: "press-merge-when-ready",
      subject: "https://github.com/acme/widgets/pull/16378",
      why: "it is a dependency bump selected by bot-author, and every one of the six tests passed",
      witness: "slopweaver github bump-drive -> enqueued acme/widgets#951 at head 1111111",
    });
  });

  it("says the undraft out loud in the witness, because it changed what the repository shows", () => {
    const row = bumpLedgerRow({
      atIso: "2026-09-20T01:00:00.000Z",
      bySession: "session-1",
      plan: plan({ act: "undraft-and-enqueue", number: 662 }),
    });

    expect(row.witness).toBe(
      "slopweaver github bump-drive -> undrafted it and enqueued acme/widgets#662 at head 1111111",
    );
  });

  it("files the press under the id github landing --press writes for the same act at the same head", () => {
    const row = landingRowFake({ number: 951 });
    const bumped = bumpLedgerRow({
      atIso: "2026-09-20T01:00:00.000Z",
      bySession: "s",
      plan: { ...plan({ act: "enqueue" }), row },
    });

    expect(bumped.actionId).toBe(pressActionId({ row }));
  });

  it("keys the press by repository, number and head, so none of the three repeats another's id", () => {
    const idOf = (over: Parameters<typeof landingRowFake>[0]): string =>
      bumpLedgerRow({ atIso: "t", bySession: "s", plan: { ...plan({ act: "enqueue" }), row: landingRowFake(over) } })
        .actionId;

    expect(idOf({ number: 661 })).toBe(`enqueue-acme.widgets-661-${HEAD}`);
    expect(idOf({ number: 661, repoSlug: "acme/gadgets" })).toBe(`enqueue-acme.gadgets-661-${HEAD}`);
    expect(idOf({ headOid: "2".repeat(40), number: 661 })).toBe(`enqueue-acme.widgets-661-${"2".repeat(40)}`);
  });
});

describe("bumpUndraftLedgerRow", () => {
  it("records the undraft ON ITS OWN when the enqueue after it was refused, naming the state it left", () => {
    const row = bumpUndraftLedgerRow({
      atIso: "2026-09-20T01:00:00.000Z",
      bySession: "session-1",
      plan: plan({ act: "undraft-and-enqueue", number: 661, why: "every test but the draft flag passed" }),
      why: "undrafted, but `github enqueue` refused it",
    });

    expect(row).toEqual({
      actionId: `undraft-acme.widgets-661-${HEAD}`,
      bySession: "session-1",
      doneIso: "2026-09-20T01:00:00.000Z",
      kind: "undraft-pull-request",
      subject: "https://github.com/acme/widgets/pull/16378",
      why:
        "it is a dependency bump selected by bot-author, and every test but the draft flag passed — then " +
        "undrafted, but `github enqueue` refused it",
      witness: "slopweaver github bump-drive -> marked acme/widgets#661 ready at head 1111111, and it did NOT queue",
    });
  });

  it("carries a different action id from the enqueue row, so one bump's two acts are two ledger rows", () => {
    const enqueued = bumpLedgerRow({
      atIso: "2026-09-20T01:00:00.000Z",
      bySession: "s",
      plan: plan({ act: "undraft-and-enqueue", number: 661 }),
    });
    const undrafted = bumpUndraftLedgerRow({
      atIso: "2026-09-20T01:00:00.000Z",
      bySession: "s",
      plan: plan({ act: "undraft-and-enqueue", number: 661 }),
      why: "refused",
    });

    expect(undrafted.actionId).not.toBe(enqueued.actionId);
  });
});

describe("bumpRewriteLedgerRow", () => {
  it("records WHAT was sent and WHY the description could never have passed as renovate opened it", () => {
    const row = bumpRewriteLedgerRow({
      atIso: "2026-09-20T01:00:00.000Z",
      bySession: "session-1",
      plan: plan({
        act: "rewrite-body",
        number: 661,
        why: "dev-gate is the only failing check, and this bot's description can never satisfy it",
      }),
    });

    expect(row.actionId).toBe(`rewrite-acme.widgets-661-${HEAD}`);
    expect(row.kind).toBe("rewrite-pull-request-body");
    expect(row.subject).toBe("https://github.com/acme/widgets/pull/16378");
    expect(row.witness).toBe(
      "slopweaver github bump-drive -> sent the typed bump form as acme/widgets#661's whole description at head " +
        "1111111, through github pr update --form",
    );
    expect(row.why).toBe(
      "it is a dependency bump selected by bot-author, and dev-gate is the only failing check, and this bot's " +
        "description can never satisfy it — the origin rule requires the Problem cell to name an origin and renovate's " +
        "template names none, so the description it opened with can never pass this repository's own gate",
    );
  });

  it("keys the row by HEAD, and within the register's own id bounds, since an illegal id cannot be appended", () => {
    const first = bumpBodyActionId({ row: landingRowFake({ headOid: "a".repeat(40), number: 661 }) });
    const second = bumpBodyActionId({ row: landingRowFake({ headOid: "b".repeat(40), number: 661 }) });

    expect(first).toBe(`rewrite-acme.widgets-661-${"a".repeat(40)}`);
    expect(second).toBe(`rewrite-acme.widgets-661-${"b".repeat(40)}`);
    expect(AUTONOMY_SLUG_PATTERN.test(first)).toBe(true);
    expect(first.length).toBeLessThanOrEqual(AUTONOMY_ACTION_ID_MAX);
  });

  it("tells apart two heads sharing their first seven characters, and the other repository's same number", () => {
    const one = bumpBodyActionId({ row: landingRowFake({ headOid: `abcdef0${"1".repeat(33)}`, number: 661 }) });
    const two = bumpBodyActionId({ row: landingRowFake({ headOid: `abcdef0${"2".repeat(33)}`, number: 661 }) });
    const other = bumpBodyActionId({ row: landingRowFake({ number: 661, repoSlug: "acme/gadgets" }) });

    expect(new Set([one, two, other, bumpBodyActionId({ row: landingRowFake({ number: 661 }) })]).size).toBe(4);
  });
});

describe("bumpBodyWasRecorded", () => {
  const row = landingRowFake({ number: 661, url: "https://github.com/acme/widgets/pull/661" });
  const act = (over: Partial<AutonomyActionRow>): AutonomyActionRow => ({
    actionId: bumpBodyActionId({ row }),
    bySession: "s",
    doneIso: "2026-09-20T01:00:00.000Z",
    kind: "rewrite-pull-request-body",
    subject: "https://github.com/acme/widgets/pull/661",
    why: "w",
    witness: "x",
    ...over,
  });

  it("finds this head's rewrite under its full id", () => {
    expect(bumpBodyWasRecorded({ acts: [act({})], row })).toBe(true);
  });

  it("finds a row written under the seven-character id when it names the same pull request", () => {
    expect(bumpBodyWasRecorded({ acts: [act({ actionId: "661-bump-body-1111111" })], row })).toBe(true);
  });

  it("ignores a seven-character row naming the other repository's same-numbered pull request", () => {
    const elsewhere = act({ actionId: "661-bump-body-1111111", subject: "https://github.com/acme/gadgets/pull/661" });

    expect(bumpBodyWasRecorded({ acts: [elsewhere], row })).toBe(false);
  });

  it("ignores a row under the right id whose kind is some other act", () => {
    expect(bumpBodyWasRecorded({ acts: [act({ kind: "press-merge-when-ready" })], row })).toBe(false);
  });

  it("finds nothing on an empty ledger", () => {
    expect(bumpBodyWasRecorded({ acts: [], row })).toBe(false);
  });
});
