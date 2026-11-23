import { describe, expect, it } from "vitest";

import { digestFormSchema, digestToUpdate } from "../../../../../outbound/artifact/digest.js";
import {
  DIGEST_INDEXED_MAX,
  DIGEST_LEAD_VISIBLE_MAX,
  DIGEST_LINE_VISIBLE_MAX,
  type DigestForm,
} from "../../../../../outbound/artifact/digestFields.js";
import {
  ABOVE_FOLD_VISIBLE_MAX,
  INDEX_ITEM_VISIBLE_MAX,
  TABLE_MAX_ROWS,
  TLDR_VISIBLE_MAX,
  updateArtifactSchema,
} from "../../../../../outbound/artifact/schema.js";
import { TRUNCATED_SEND_ESCAPE } from "../../../../../outbound/artifact/truncatedSendHatch.js";
import type { InlineRun } from "../../../../../outbound/artifact/types.js";
import { visibleLengthOfDetail } from "../../../../../outbound/artifact/visibleLength.js";
import { withLiveGrant } from "../../../../hatchGrantFixture.js";
import { ALL_KNOWN, derive, knockForm } from "./harness.js";

/** The visible width of a run sequence, by the schema's own rule: a link costs its label, a chip its `[n]`. */
function widthOf({ runs, labels }: { runs: readonly InlineRun[]; labels: ReadonlyMap<string, string> }): number {
  return runs.reduce((total, run) => {
    if (run.type === "text") {
      return total + run.text.length;
    }
    if (run.type === "link") {
      return total + run.label.length;
    }
    if (run.type === "citation") {
      return total + labels.get(run.citationId)!.length;
    }
    return total;
  }, 0);
}

/**
 * THE GUARANTEE. A digest is composed unattended, so "the form was valid" has to imply "the card will send".
 *
 * This block used to be titled "no valid digest form can derive an invalid card" while CONTAINING a test that
 * asserted the opposite — maximal substance derived a card `updateArtifactSchema` rejects. The guarantee was
 * therefore known to be false and filed under a heading denying it, and the three worst-case fixtures here
 * maximise only fields that cost nothing against the detail cap (titles, states, tickets, trends), so nothing
 * else caught it either.
 *
 * The guarantee is real now, and it is stated over the FORM SCHEMA rather than over hand-built objects: what
 * `digestFormSchema` accepts always derives a valid card, because the schema now measures the derived detail.
 * `derive()` alone bypasses that check, so a test that only calls it proves nothing about the send path.
 */
describe("what digestFormSchema ACCEPTS always derives a valid card", () => {
  it("holds for the real digest", () => {
    const parsed = updateArtifactSchema.safeParse(derive({ form: knockForm() }));

    expect(parsed.success).toBe(true);
  });

  it("holds at the WORST CASE: DIGEST_INDEXED_MAX maximal lines and a maximal TL;DR", () => {
    const form: DigestForm = {
      items: Array.from({ length: DIGEST_INDEXED_MAX }, (_, position) => ({
        count: 999_999,
        severity: "red" as const,
        state: "x".repeat(80),
        ticket: { id: "K".repeat(40), url: "https://example.invalid/k" },
        title: `${String(position)}${"t".repeat(79)}`,
        trend: "y".repeat(40),
      })),
      kind: "digest",
      label: "L".repeat(40),
      lead: "z".repeat(DIGEST_LEAD_VISIBLE_MAX),
      window: "W".repeat(12),
    };
    const card = derive({ form });
    const parsed = updateArtifactSchema.safeParse(card);

    expect(parsed.success).toBe(true);
    // The region cap is the binding one; prove it is respected rather than merely not tripped by luck.
    const labels = new Map(card.citations.map((c) => [c.id, c.label]));
    const region = card.tldr.length + card.index.reduce((total, line) => total + widthOf({ labels, runs: line }), 0);
    expect(region).toBeLessThanOrEqual(ABOVE_FOLD_VISIBLE_MAX);
  });

  it("holds at the maximum number of items, which overflows the index but not the table", () => {
    const form: DigestForm = {
      items: Array.from({ length: TABLE_MAX_ROWS }, (_, position) => ({
        citationUrl: `https://example.invalid/logs?q=${String(position)}`,
        count: position,
        severity: "orange" as const,
        state: "s".repeat(80),
        title: `item ${String(position)}`,
        trend: "flat",
      })),
      kind: "digest",
      label: "Knock",
      lead: "z".repeat(DIGEST_LEAD_VISIBLE_MAX),
      window: "24h",
    };
    const card = derive({ form });

    const table = card.detail[0]!;

    expect(updateArtifactSchema.safeParse(card).success).toBe(true);
    expect(card.index.length).toBe(DIGEST_INDEXED_MAX);
    expect(table.type).toBe("table");
    expect(table.type === "table" ? table.rows.length : 0).toBe(TABLE_MAX_ROWS);
  });

  it("REFUSES maximal substance at FORM level by default: the layout schema no longer truncates silently", () => {
    const form = {
      ...knockForm(),
      items: knockForm().items.map((item) => ({ ...item, substance: "p".repeat(600) })),
    };

    // Four 600-char paragraphs is 2400 chars, over DETAIL_PROSE_VISIBLE_MAX (1800). `digestFormSchema`'s own
    // check defers entirely to `updateArtifactSchema` (`if (derived.success) return;`), so this form is
    // refused too — with no code change needed here, which is the whole point of the cap living at the
    // layout-schema layer. This is the exact live shape (a Knock alert digest truncated mid-sentence with
    // "…") that motivated reversing the default from truncate-and-post back to refuse-by-default.
    const parsed = digestFormSchema.safeParse(form);
    const { artifact } = digestToUpdate({ form, isKnownPerson: () => false });
    const derived = updateArtifactSchema.safeParse(artifact);

    expect(parsed.success).toBe(false);
    expect(derived.success).toBe(false);
    expect(derived.success ? "" : derived.error.issues.map((issue) => issue.message).join(" ")).toContain(
      TRUNCATED_SEND_ESCAPE,
    );
  });

  it("TRUNCATES maximal substance at FORM level under a live truncated-send grant", () => {
    const form = {
      ...knockForm(),
      items: knockForm().items.map((item) => ({ ...item, substance: "p".repeat(600) })),
    };

    withLiveGrant({
      hatchIds: ["truncated-send"],
      run: () => {
        const parsed = digestFormSchema.safeParse(form);
        const { artifact } = digestToUpdate({ form, isKnownPerson: () => false });
        const derived = updateArtifactSchema.safeParse(artifact);
        const warningBlock = derived.data!.detail.at(-1)!;
        const warningRun = warningBlock.type === "paragraph" ? warningBlock.runs[0]! : undefined;
        const warningText = warningRun?.type === "text" ? warningRun.text : "";

        expect(parsed.success).toBe(true);
        expect(derived.success).toBe(true);
        expect(warningText).toContain("over the 1800-character cap");
      },
    });
  });

  it("REFUSES by default the aggregate that owner asks alone can reach, with no substance anywhere", () => {
    // MEASURED at 2040 through the real verb: ten items, each a maximal `owner.ask` and a maximal `person`,
    // and not one `substance`. Every field is inside its own limit. This is the case the old fixtures were
    // blind to, because they never set `owner` at all.
    const form = {
      items: Array.from({ length: TABLE_MAX_ROWS }, (_unused, position) => ({
        count: 1,
        owner: { ask: "a".repeat(120), person: "p".repeat(60) },
        severity: "red" as const,
        title: `item ${String(position)}`,
      })),
      kind: "digest" as const,
      label: "L",
      window: "24h",
    };
    const parsed = digestFormSchema.safeParse(form);

    expect(parsed.success).toBe(false);
  });

  it("TRUNCATES the aggregate that owner asks alone can reach, with no substance anywhere, under a live truncated-send grant", () => {
    const form = {
      items: Array.from({ length: TABLE_MAX_ROWS }, (_unused, position) => ({
        count: 1,
        owner: { ask: "a".repeat(120), person: "p".repeat(60) },
        severity: "red" as const,
        title: `item ${String(position)}`,
      })),
      kind: "digest" as const,
      label: "L",
      window: "24h",
    };

    withLiveGrant({
      hatchIds: ["truncated-send"],
      run: () => {
        expect(digestFormSchema.safeParse(form).success).toBe(true);
      },
    });
  });

  it("is biased toward REFUSING: it turns away a 12-char band that would have sent (known cost)", () => {
    // Found by an adversarial review. Pessimistically this paragraph is 662 and refused; with the owner
    // RESOLVED it is exactly 650 and would have sent. The band is real and is the price of the one-directional
    // guarantee — accepted implies sendable, never the converse. A false refusal is loud and fixed by cutting
    // twelve characters; a false acceptance is a failed unattended send.
    const form = {
      items: [
        {
          count: 0,
          owner: { person: "p" },
          severity: "red" as const,
          substance: "s".repeat(597),
          ticket: { id: "t".repeat(40), url: "https://example.invalid/t" },
          title: "x",
        },
      ],
      kind: "digest" as const,
      label: "L",
      window: "1h",
    };

    expect(digestFormSchema.safeParse(form).success).toBe(false);
    // ...and the card it WOULD have derived for a resolved owner is valid, which is what makes this a cost
    // rather than a bug: the schema is refusing something sendable, on purpose, in the safe direction.
    expect(updateArtifactSchema.safeParse(derive({ form, isKnownPerson: ALL_KNOWN })).success).toBe(true);
  });

  it("costs exactly 12 characters per owner-bearing item, which is what sizes that band", () => {
    const items = Array.from({ length: 3 }, (_unused, position) => ({
      count: 1,
      owner: { ask: "a".repeat(120), person: "p".repeat(60) },
      severity: "red" as const,
      substance: "s".repeat(400),
      title: `item ${String(position)}`,
    }));
    const form = { items, kind: "digest" as const, label: "L", window: "24h" };
    const optimistic = visibleLengthOfDetail({
      citations: [],
      detail: digestToUpdate({ form, isKnownPerson: () => true }).artifact.detail,
    });
    const pessimistic = visibleLengthOfDetail({
      citations: [],
      detail: digestToUpdate({ form, isKnownPerson: () => false }).artifact.detail,
    });

    expect(pessimistic - optimistic).toBe(36);
    expect((pessimistic - optimistic) / items.length).toBe(12);
  });

  it("ACCEPTS a form just under the aggregate cap, and its card is valid", () => {
    const form = {
      items: [{ count: 1, severity: "red" as const, substance: "s".repeat(600), title: "one" }],
      kind: "digest" as const,
      label: "L",
      window: "24h",
    };
    const parsed = digestFormSchema.safeParse(form);

    expect(parsed.success).toBe(true);
    expect(updateArtifactSchema.safeParse(derive({ form: parsed.data! })).success).toBe(true);
  });

  it("trims an over-long title rather than failing the send", () => {
    const form: DigestForm = {
      ...knockForm(),
      items: [
        {
          count: 5,
          severity: "red",
          ticket: { id: "KK-1770", url: "https://example.invalid/KK-1770" },
          title: "t".repeat(80),
          trend: "rising",
        },
      ],
    };
    const card = derive({ form });
    const labels = new Map(card.citations.map((c) => [c.id, c.label]));

    expect(widthOf({ labels, runs: card.index[0]! })).toBeLessThanOrEqual(DIGEST_LINE_VISIBLE_MAX);
    expect(JSON.stringify(card.index[0])).toContain("…");
    expect(updateArtifactSchema.safeParse(card).success).toBe(true);
  });

  it("never trims the ticket link, the numbers or the chip — only the title", () => {
    const form: DigestForm = {
      ...knockForm(),
      items: [
        {
          citationUrl: "https://example.invalid/logs",
          count: 706,
          severity: "red",
          ticket: { id: "KK-1770", url: "https://example.invalid/KK-1770" },
          title: "t".repeat(80),
          trend: "rising",
        },
      ],
    };
    const line = derive({ form }).index[0]!;

    expect(line.some((run) => run.type === "link" && run.label === "KK-1770")).toBe(true);
    expect(line.some((run) => run.type === "text" && run.text.includes("706, rising"))).toBe(true);
    expect(line.filter((run) => run.type === "citation").length).toBe(1);
  });

  it("keeps the derived TL;DR inside its own cap at the worst case", () => {
    const form: DigestForm = {
      items: [
        { count: 1, severity: "red", title: "a" },
        { count: 1, severity: "orange", title: "b" },
        { count: 1, severity: "green", title: "c" },
      ],
      kind: "digest",
      label: "L".repeat(40),
      lead: "z".repeat(DIGEST_LEAD_VISIBLE_MAX),
      window: "W".repeat(12),
    };

    expect(derive({ form }).tldr.length).toBeLessThanOrEqual(TLDR_VISIBLE_MAX);
  });

  it("keeps every derived line inside the LAYOUT's per-line cap too", () => {
    const card = derive({ form: knockForm() });
    const labels = new Map(card.citations.map((c) => [c.id, c.label]));

    for (const line of card.index) {
      expect(widthOf({ labels, runs: line })).toBeLessThanOrEqual(INDEX_ITEM_VISIBLE_MAX);
    }
  });
});
