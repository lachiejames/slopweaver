/**
 * `unpin`, `clear-lapse`, `set-email` and `set-store-dir`: each edits one raw row, keeps every other field and row,
 * and refuses a change that would change nothing.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "#lib/result.js";

import { isPlanAlias } from "../../../plans/alias.js";
import { prepareRegisterChange } from "../../../plans/mutate.js";
import { parsePlanRegister, pinnedPlanFor } from "../../../plans/register.js";
import { removedProblems } from "../../../plans/removed.js";
import { isRowEdit } from "../../../plans/rowEdits.js";
import type { PlanRegisterSnapshot } from "../../../plans/types.js";

const registered = ({ rows }: { rows: readonly Readonly<Record<string, unknown>>[] }): PlanRegisterSnapshot => ({
  ...unwrap(parsePlanRegister({ value: { rows, version: 1 } })),
  source: "registered",
});

const PINNED = {
  alias: "plan-five",
  email: "five@example.com",
  lapsesAtIso: "2026-11-17T00:00:00Z",
  note: "kept by an older writer",
  pinned: true,
  provider: "claude",
  storeDir: "/c5",
};

describe("isRowEdit", () => {
  it("claims exactly remove, unpin, clear-lapse, set-email and set-store-dir", () => {
    const where = { alias: "plan-five", provider: "claude" } as const;
    expect(isRowEdit({ ...where, kind: "remove", removedAtIso: "2026-11-06T02:00:00Z" })).toBe(true);
    expect(isRowEdit({ ...where, kind: "unpin" })).toBe(true);
    expect(isRowEdit({ ...where, kind: "clear-lapse" })).toBe(true);
    expect(isRowEdit({ ...where, email: "owner@example.com", kind: "set-email" })).toBe(true);
    expect(isRowEdit({ ...where, kind: "set-store-dir", storeDir: "/new/c5" })).toBe(true);
    expect(isRowEdit({ ...where, kind: "pin" })).toBe(false);
    expect(isRowEdit({ ...where, kind: "resume" })).toBe(false);
  });
});

describe("prepareRegisterChange — unpin", () => {
  it("takes the pin off without moving it, every other key kept", () => {
    const changed = unwrap(
      prepareRegisterChange({
        mutation: { alias: "plan-five", kind: "unpin", provider: "claude" },
        snapshot: registered({ rows: [PINNED] }),
      }),
    );

    const { pinned: _pinned, ...rest } = PINNED;
    expect(changed.document.rows).toStrictEqual([rest]);
    expect(pinnedPlanFor({ plans: changed.plans, provider: "claude" })).toBeUndefined();
  });

  it("lets the last Claude plan be paused once it is unpinned", () => {
    const unpinned = unwrap(
      prepareRegisterChange({
        mutation: { alias: "plan-five", kind: "unpin", provider: "claude" },
        snapshot: registered({ rows: [PINNED] }),
      }),
    );
    const paused = unwrap(
      prepareRegisterChange({
        mutation: {
          alias: "plan-five",
          kind: "pause",
          paused: { reason: "subscription dropped", sinceIso: "2026-11-06T02:00:00.000Z" },
          provider: "claude",
        },
        snapshot: unpinned,
      }),
    );

    expect(paused.plans[0]!.paused).toStrictEqual({
      reason: "subscription dropped",
      sinceIso: "2026-11-06T02:00:00.000Z",
    });
  });

  it("refuses a row that is not pinned", () => {
    const refused = unwrapErr(
      prepareRegisterChange({
        mutation: { alias: "plan-one", kind: "unpin", provider: "claude" },
        snapshot: registered({ rows: [{ alias: "plan-one", provider: "claude", storeDir: "/c1" }] }),
      }),
    );

    expect(refused.message).toBe(
      "that change cannot be applied to the register as it stands: `plan-one` is not pinned, so nothing unpins",
    );
  });
});

describe("prepareRegisterChange — clear-lapse", () => {
  it("drops the recorded lapse and nothing else", () => {
    const changed = unwrap(
      prepareRegisterChange({
        mutation: { alias: "plan-five", kind: "clear-lapse", provider: "claude" },
        snapshot: registered({ rows: [PINNED] }),
      }),
    );

    const { lapsesAtIso: _lapse, ...rest } = PINNED;
    expect(changed.document.rows).toStrictEqual([rest]);
    expect(changed.plans[0]!.lapsesAtIso).toBeUndefined();
  });

  it("refuses a row with no lapse recorded", () => {
    const refused = unwrapErr(
      prepareRegisterChange({
        mutation: { alias: "plan-one", kind: "clear-lapse", provider: "claude" },
        snapshot: registered({ rows: [{ alias: "plan-one", provider: "claude", storeDir: "/c1" }] }),
      }),
    );

    expect(refused.message).toBe(
      "that change cannot be applied to the register as it stands: `plan-one` has no lapse recorded, so nothing clears",
    );
  });
});

describe("prepareRegisterChange — set-email", () => {
  it("records the corrected address on that row alone", () => {
    const changed = unwrap(
      prepareRegisterChange({
        mutation: { alias: "plan-five", email: "owner@example.com", kind: "set-email", provider: "claude" },
        snapshot: registered({ rows: [PINNED, { alias: "plan-one", provider: "claude", storeDir: "/c1" }] }),
      }),
    );

    expect(changed.document.rows).toStrictEqual([
      { ...PINNED, email: "owner@example.com" },
      { alias: "plan-one", provider: "claude", storeDir: "/c1" },
    ]);
  });

  it("refuses the address the row already carries, as an edit that changes nothing", () => {
    const refused = unwrapErr(
      prepareRegisterChange({
        mutation: { alias: "plan-five", email: "five@example.com", kind: "set-email", provider: "claude" },
        snapshot: registered({ rows: [PINNED] }),
      }),
    );

    expect(refused.message).toBe(
      "that change cannot be applied to the register as it stands: `plan-five` already reads that way, so nothing changes",
    );
  });

  it("refuses an address with no @ through the register's own decode", () => {
    const refused = unwrapErr(
      prepareRegisterChange({
        mutation: { alias: "plan-five", email: "plan five", kind: "set-email", provider: "claude" },
        snapshot: registered({ rows: [PINNED] }),
      }),
    );

    expect(refused.code).toBe("REGISTER_INVALID");
  });
});

describe("prepareRegisterChange — set-store-dir", () => {
  const CODEX = { alias: "codex-two", email: "two@example.com", note: "kept", provider: "codex", storeDir: "/old/x2" };
  const moveTo = ({ alias, provider, storeDir }: { alias: string; provider: "claude" | "codex"; storeDir: string }) =>
    ({ alias, kind: "set-store-dir", provider, storeDir }) as const;

  it("moves a Claude row's store and keeps its address, alias and every other key", () => {
    const changed = unwrap(
      prepareRegisterChange({
        mutation: moveTo({ alias: "plan-five", provider: "claude", storeDir: "/new/c5" }),
        snapshot: registered({ rows: [PINNED, CODEX] }),
      }),
    );

    expect(changed.document.rows).toStrictEqual([{ ...PINNED, storeDir: "/new/c5" }, CODEX]);
    expect(changed.plans[0]!.email).toBe("five@example.com");
  });

  it("moves a Codex row's store and drops only the address it recorded off the old one", () => {
    const changed = unwrap(
      prepareRegisterChange({
        mutation: moveTo({ alias: "codex-two", provider: "codex", storeDir: "/new/x2" }),
        snapshot: registered({ rows: [PINNED, CODEX] }),
      }),
    );

    const { email: _email, ...rest } = CODEX;
    expect(changed.document.rows).toStrictEqual([PINNED, { ...rest, storeDir: "/new/x2" }]);
    expect(changed.plans[1]!.email).toBeUndefined();
  });

  it("refuses the path the row already names, as an edit that changes nothing, clearing no address", () => {
    const refused = unwrapErr(
      prepareRegisterChange({
        mutation: moveTo({ alias: "codex-two", provider: "codex", storeDir: "/old/x2" }),
        snapshot: registered({ rows: [CODEX] }),
      }),
    );

    expect(refused.message).toBe(
      "that change cannot be applied to the register as it stands: `codex-two` already reads that way, so nothing changes",
    );
  });

  it("refuses an alias no row carries", () => {
    const refused = unwrapErr(
      prepareRegisterChange({
        mutation: moveTo({ alias: "plan-nine", provider: "claude", storeDir: "/new/c9" }),
        snapshot: registered({ rows: [PINNED] }),
      }),
    );

    expect(refused.code).toBe("UNKNOWN_DESTINATION");
  });

  it("refuses a move onto a store another row of that provider already names", () => {
    const refused = unwrapErr(
      prepareRegisterChange({
        mutation: moveTo({ alias: "plan-five", provider: "claude", storeDir: "/c1" }),
        snapshot: registered({ rows: [PINNED, { alias: "plan-one", provider: "claude", storeDir: "/c1" }] }),
      }),
    );

    expect(refused.code).toBe("REGISTER_INVALID");
  });

  it("leaves the removal history as it was", () => {
    const removed = [{ alias: "plan-two", provider: "claude", removedAtIso: "2026-11-06T02:00:00Z", storeDir: "/c2" }];
    const snapshot: PlanRegisterSnapshot = {
      ...unwrap(parsePlanRegister({ value: { removed, rows: [PINNED], version: 1 } })),
      source: "registered",
    };
    const changed = unwrap(
      prepareRegisterChange({
        mutation: moveTo({ alias: "plan-five", provider: "claude", storeDir: "/new/c5" }),
        snapshot,
      }),
    );

    expect(changed.document["removed"]).toStrictEqual(removed);
  });
});

describe("removedProblems", () => {
  it("accepts a register with no history and one with a well-formed entry", () => {
    expect(removedProblems({ document: { rows: [], version: 1 } })).toStrictEqual([]);
    expect(
      removedProblems({
        document: {
          removed: [{ alias: "plan-two", provider: "claude", removedAtIso: "2026-11-06T02:00:00Z", storeDir: "/c2" }],
          rows: [],
          version: 1,
        },
      }),
    ).toStrictEqual([]);
  });

  it("refuses a history that is not an array, and names each malformed entry", () => {
    expect(removedProblems({ document: { removed: {}, rows: [], version: 1 } })).toStrictEqual([
      "the register's `removed`, when present, must be an array",
    ]);
    expect(
      removedProblems({ document: { removed: [{ alias: "plan-two", provider: "claude" }], rows: [], version: 1 } }),
    ).toStrictEqual([
      "removed entry 1 needs a `provider`, an `alias`, the `storeDir` it named and a `removedAtIso` instant",
    ]);
  });

  it("refuses an entry naming an alias or store no row could carry", () => {
    const entry = { alias: "plan-two", provider: "codex", removedAtIso: "2026-11-06T02:00:00Z", storeDir: "/c2" };
    const document = {
      removed: [entry, { ...entry, alias: "../../quota" }, { ...entry, alias: "plan-three", storeDir: "   " }],
      rows: [],
      version: 1,
    };
    const shape = "needs a `provider`, an `alias`, the `storeDir` it named and a `removedAtIso` instant";

    expect(removedProblems({ document })).toStrictEqual([`removed entry 2 ${shape}`, `removed entry 3 ${shape}`]);
    expect(unwrapErr(parsePlanRegister({ value: document })).code).toBe("REGISTER_INVALID");
    expect(isPlanAlias({ alias: "plan-two" })).toBe(true);
  });

  it("refuses a second record for one alias, so an add cannot honour one store and erase the other", () => {
    const old = { alias: "old", provider: "codex", removedAtIso: "2026-11-05T00:00:00Z", storeDir: "/store-a" };
    const document = {
      removed: [
        old,
        { ...old, removedAtIso: "2026-11-06T00:00:00Z", storeDir: "/store-b" },
        { ...old, provider: "claude" },
      ],
      rows: [],
      version: 1,
    };

    expect(removedProblems({ document })).toStrictEqual([
      "removed entry 2 names codex/old a second time; one alias keeps one removal record",
    ]);
    expect(unwrapErr(parsePlanRegister({ value: document })).code).toBe("REGISTER_INVALID");
  });
});
