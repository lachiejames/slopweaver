/**
 * The autonomy-ledger id of one press. The ledger refuses a second row under a held id with different fields,
 * so two distinct presses sharing an id is a press the owner's briefing never shows.
 */
import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { isAutonomyActionId } from "../../../../../autonomy/fields.js";
import { AUTONOMY_ACTION_ID_MAX, AUTONOMY_CLASS_ID_PREFIX } from "../../../../../autonomy/types.js";
import {
  type PressLedgerRow,
  pressActionId,
  pressOccurrenceId,
} from "../../../../../cli/commands/github/landingPressRow.js";
import { landingRowFake } from "../../../../landingRowFake.js";

const SHA = "abcdef0123456789abcdef0123456789abcdef01";

describe("pressActionId", () => {
  it("names the repository, the number and the full head", () => {
    const row = landingRowFake({ headOid: SHA, number: 17522, repoSlug: "acme/acme-admin" });
    const id = pressActionId({ row });
    expect(id).toBe(`enqueue-acme.acme-admin-17522-${SHA}`);
    expect(isAutonomyActionId({ actionId: id })).toBe(true);
  });

  it("tells one commit pushed to two repositories apart", () => {
    const ids = ["acme/one", "acme/two"].map((repoSlug) =>
      pressActionId({ row: landingRowFake({ headOid: SHA, number: 7, repoSlug }) }),
    );
    expect(ids).toEqual([`enqueue-acme.one-7-${SHA}`, `enqueue-acme.two-7-${SHA}`]);
  });

  it("tells two heads sharing a 12-character prefix apart", () => {
    const heads = [`abcdef012345${"0".repeat(28)}`, `abcdef012345${"1".repeat(28)}`];
    const ids = heads.map((headOid) => pressActionId({ row: landingRowFake({ headOid }) }));
    expect(ids).toEqual([`enqueue-acme.widgets-16378-${heads[0]!}`, `enqueue-acme.widgets-16378-${heads[1]!}`]);
  });

  it("tells apart two repositories that one lossy spelling would merge", () => {
    const ids = ["a-b/c", "a/b-c", "acme/foo.bar", "acme/foo-bar", "acme/foo_bar"].map((repoSlug) =>
      pressActionId({ row: landingRowFake({ headOid: SHA, number: 1, repoSlug }) }),
    );
    expect(new Set(ids).size).toBe(5);
    expect(ids.every((actionId) => isAutonomyActionId({ actionId }))).toBe(true);
  });

  it("digests a repository too long to spell, and stays a valid ledger id", () => {
    const repoSlug = `an-organisation-with-a-long-name/${"r".repeat(60)}`;
    const id = pressActionId({ row: landingRowFake({ headOid: SHA, number: 999999, repoSlug }) });
    expect(id).toMatch(/^enqueue-[0-9a-f]{64}$/u);
    expect(isAutonomyActionId({ actionId: id })).toBe(true);
  });

  it("tells apart two repositories whose 12-character digests collide", () => {
    const repoSlugs = ["collide/r_5372199", "collide/r_18095474"];
    const prefixes = repoSlugs.map((slug) => createHash("sha256").update(slug).digest("hex").slice(0, 12));
    expect(prefixes).toEqual(["58d1d84f8775", "58d1d84f8775"]);
    const ids = repoSlugs.map((repoSlug) =>
      pressActionId({ row: landingRowFake({ headOid: SHA, number: 1, repoSlug }) }),
    );
    expect(new Set(ids).size).toBe(2);
  });

  it("reads a repository's case as GitHub does, one repository whatever the casing", () => {
    const ids = ["Acme/Widgets", "acme/widgets"].map((repoSlug) =>
      pressActionId({ row: landingRowFake({ headOid: SHA.toUpperCase(), repoSlug }) }),
    );
    expect(ids).toEqual([`enqueue-acme.widgets-16378-${SHA}`, `enqueue-acme.widgets-16378-${SHA}`]);
  });

  it("never opens on the ledger's reserved class prefix", () => {
    const id = pressActionId({ row: landingRowFake({ headOid: SHA, number: 1, repoSlug: "class/widgets" }) });
    expect(id).toBe(`enqueue-class.widgets-1-${SHA}`);
    expect(id.startsWith(AUTONOMY_CLASS_ID_PREFIX)).toBe(false);
  });

  it("digests a slug the ledger grammar cannot spell one-to-one", () => {
    const id = pressActionId({ row: landingRowFake({ headOid: SHA, repoSlug: "Acme_Co/Widgets.JS" }) });
    expect(id).toMatch(/^enqueue-[0-9a-f]{64}$/u);
    expect(isAutonomyActionId({ actionId: id })).toBe(true);
  });
});

/** One press's row, as the landing builds it, at a given instant and under a given first-occurrence id. */
const pressRow = ({
  actionId = `enqueue-acme.acme-admin-17531-${SHA}`,
  doneIso = "2026-09-28T05:11:09.856Z",
}: {
  actionId?: string;
  doneIso?: string;
}): PressLedgerRow => ({
  actionId,
  bySession: "5fb44c1d-280b-4989-add0-5f0d519b8230",
  doneIso,
  kind: "press-merge-when-ready",
  subject: "https://github.com/acme/acme-admin/pull/17531",
  why: "every one of the six landing tests passed and nothing needing the owner's judgment was on it at press time",
  witness: `slopweaver github landing --press -> enqueued acme/acme-admin#17531 at head ${SHA}`,
});

describe("pressOccurrenceId", () => {
  const first = pressRow({});
  const second = pressRow({ doneIso: "2026-09-28T05:15:21.838Z" });

  it("keeps the first press at a head on the id pressActionId spells", () => {
    expect(pressOccurrenceId({ held: [], row: first })).toBe(first.actionId);
  });

  it("gives a second press at the SAME head its own id", () => {
    const id = pressOccurrenceId({ held: [first], row: second });
    expect(id).toBe(`${first.actionId}-2`);
    expect(isAutonomyActionId({ actionId: id })).toBe(true);
  });

  it("answers the held id for a retried write of the SAME press, so a retry is not a second row", () => {
    expect(pressOccurrenceId({ held: [first, { ...second, actionId: `${first.actionId}-2` }], row: second })).toBe(
      `${first.actionId}-2`,
    );
  });

  it("never answers an id an EARLIER, different row holds, even when a later identical one shares it", () => {
    expect(pressOccurrenceId({ held: [first, { ...second, actionId: first.actionId }], row: second })).toBe(
      `${first.actionId}-2`,
    );
  });

  it("counts on past every occurrence already held", () => {
    const third = pressRow({ doneIso: "2026-09-28T05:21:53.638Z" });
    const held = [first, { ...second, actionId: `${first.actionId}-2` }];
    expect(pressOccurrenceId({ held, row: third })).toBe(`${first.actionId}-3`);
  });

  it("digests a repeat whose spelling would pass the ledger's 80-character bound, and stays a valid id", () => {
    const base = `enqueue-a.${"r".repeat(26)}-1-${SHA}`;
    expect(base.length).toBe(AUTONOMY_ACTION_ID_MAX - 1);
    const id = pressOccurrenceId({
      held: [pressRow({ actionId: base })],
      row: pressRow({ actionId: base, doneIso: second.doneIso }),
    });
    expect(id).toBe(`enqueue-${createHash("sha256").update(`${base}\n2`).digest("hex")}`);
    expect(isAutonomyActionId({ actionId: id })).toBe(true);
  });

  it("spells a repeat of a digested id as that digest and its ordinal, still inside the bound", () => {
    const base = `enqueue-${"a".repeat(64)}`;
    const id = pressOccurrenceId({
      held: [pressRow({ actionId: base })],
      row: pressRow({ actionId: base, doneIso: second.doneIso }),
    });
    expect(id).toBe(`${base}-2`);
    expect(isAutonomyActionId({ actionId: id })).toBe(true);
  });

  it("keeps an undraft's own word when a repeat of it is digested, so it never reads as a press", () => {
    const base = `undraft-a.${"r".repeat(26)}-1-${SHA}`;
    expect(base.length).toBe(AUTONOMY_ACTION_ID_MAX - 1);
    const id = pressOccurrenceId({
      held: [pressRow({ actionId: base })],
      row: pressRow({ actionId: base, doneIso: second.doneIso }),
    });
    expect(id).toBe(`undraft-${createHash("sha256").update(`${base}\n2`).digest("hex")}`);
    expect(isAutonomyActionId({ actionId: id })).toBe(true);
  });
});

describe("pressActionId under another act's word", () => {
  const row = landingRowFake({ headOid: SHA, number: 661, repoSlug: "acme/widgets" });

  it("spells the same repository, number and head under each word, and three distinct ids", () => {
    const ids = (["enqueue", "undraft", "rewrite"] as const).map((word) => pressActionId({ row, word }));
    expect(ids).toEqual([
      `enqueue-acme.widgets-661-${SHA}`,
      `undraft-acme.widgets-661-${SHA}`,
      `rewrite-acme.widgets-661-${SHA}`,
    ]);
    expect(ids.every((actionId) => isAutonomyActionId({ actionId }))).toBe(true);
  });

  it("leaves landing's own id byte-identical when no word is named", () => {
    expect(pressActionId({ row })).toBe(pressActionId({ row, word: "enqueue" }));
  });

  it("digests under the named word when the slug cannot be spelled", () => {
    const odd = landingRowFake({ headOid: SHA, number: 1, repoSlug: "Acme_Co/Widgets.JS" });
    expect(pressActionId({ row: odd, word: "rewrite" })).toBe(
      `rewrite-${createHash("sha256").update(`acme_co/widgets.js\n1\n${SHA}`).digest("hex")}`,
    );
  });
});
