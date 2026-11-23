import { describe, expect, it } from "vitest";

import type { DigestForm } from "../../../../../outbound/artifact/digestFields.js";
import { derive, knockForm } from "./harness.js";

describe("digestToUpdate — the structure is derived, not authored", () => {
  it("orders the index red then orange then green, stable within a severity", () => {
    const card = derive({ form: knockForm() });
    const leadLabels = card.index.flatMap((line) =>
      line.filter((run) => run.type === "link").map((run) => (run.type === "link" ? run.label : "")),
    );

    expect(leadLabels).toEqual(["KK-1770", "SUP-9145", "JJJJ-1316", "CCCC-1909"]);
  });

  it("puts EVERY item in the table, not only the indexed ones", () => {
    const form = knockForm();
    const card = derive({ form });
    const table = card.detail[0]!;

    expect(table.type).toBe("table");
    expect(table.type === "table" ? table.rows.length : 0).toBe(form.items.length);
  });

  it("heads the count column with the window and leaves the severity column BLANK", () => {
    const card = derive({ form: knockForm() });
    const table = card.detail[0]!;

    expect(table.type === "table" ? table.columns : []).toEqual(["", "Issue", "24h", "State"]);
  });

  it("derives the TL;DR from the counts, non-zero buckets only, plus the authored lead", () => {
    const card = derive({ form: knockForm() });

    expect(card.tldr).toBe("Knock 24h · 1 red, 2 orange, 1 green. The red one is still unowned.");
  });

  it("omits a severity with no items rather than reporting a zero", () => {
    const form: DigestForm = {
      items: [{ count: 3, severity: "orange", title: "one thing" }],
      kind: "digest",
      label: "Knock",
      window: "24h",
    };

    expect(derive({ form }).tldr).toBe("Knock 24h · 1 orange.");
  });

  it("omits the lead clause entirely when none is authored", () => {
    const form: DigestForm = {
      items: [{ count: 3, severity: "green", title: "quiet" }],
      kind: "digest",
      label: "Knock",
      window: "7d",
    };

    expect(derive({ form }).tldr).toBe("Knock 7d · 1 green.");
  });

  it("gives a paragraph ONLY to the items carrying substance", () => {
    const card = derive({ form: knockForm() });

    // One table + exactly one paragraph, because exactly one item supplied substance.
    expect(card.detail.length).toBe(2);
    expect(card.detail[1]!.type).toBe("paragraph");
  });

  it("is deterministic — the same form derives a byte-identical card", () => {
    expect(JSON.stringify(derive({ form: knockForm() }))).toBe(JSON.stringify(derive({ form: knockForm() })));
  });

  it("does not depend on the input order of the items", () => {
    const form = knockForm();
    const reversed: DigestForm = { ...form, items: form.items.toReversed() };

    // Reversing the input reverses the tie-break among the two oranges, so compare the severity sequence
    // rather than the whole card: the ORDERING RULE is what must not depend on input order.
    const severities = (f: DigestForm) => {
      const block = derive({ form: f }).detail[0]!;
      if (block.type !== "table") {
        return [];
      }
      return block.rows.map((row) => {
        const cell = row[0]![0]!;
        return cell.type === "text" ? cell.text : undefined;
      });
    };

    expect(severities(form)).toEqual(["🔴", "🟠", "🟠", "🟢"]);
    expect(severities(reversed)).toEqual(["🔴", "🟠", "🟠", "🟢"]);
  });
});
