import { describe, expect, it } from "vitest";

import { flattenAndChains } from "../../../store/backup/flattenAndChains.js";

/** The two lines `slopweaver store rehearse` reported, live first, the restored copy second. */
const MEASURED_LIVE =
  "constraint public.knowledge_domain.knowledge_domain_slug_shape CHECK ((((length(slug) >= 2) AND (length(slug) <= 40)) AND (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'::text)))";
const MEASURED_COPY =
  "constraint public.knowledge_domain.knowledge_domain_slug_shape CHECK (((length(slug) >= 2) AND (length(slug) <= 40) AND (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'::text)))";

describe("flattenAndChains", () => {
  it("turns the measured live line into the measured restored line", () => {
    expect(flattenAndChains({ text: MEASURED_LIVE })).toBe(MEASURED_COPY);
  });

  it("leaves an already flat chain byte for byte", () => {
    expect(flattenAndChains({ text: MEASURED_COPY })).toBe(MEASURED_COPY);
  });

  it("brings deep left and deep right nesting to the same flat chain", () => {
    expect(flattenAndChains({ text: "CHECK ((((a) AND (b)) AND (c)) AND (d))" })).toBe(
      "CHECK ((a) AND (b) AND (c) AND (d))",
    );
    expect(flattenAndChains({ text: "CHECK ((a) AND ((b) AND ((c) AND (d))))" })).toBe(
      "CHECK ((a) AND (b) AND (c) AND (d))",
    );
  });

  it("is idempotent", () => {
    const once = flattenAndChains({ text: "CHECK ((((a) AND (b)) AND (c)) AND (d))" });
    expect(flattenAndChains({ text: once })).toBe(once);
  });

  it("keeps the parentheses NOT owns", () => {
    expect(flattenAndChains({ text: "CHECK ((NOT ((a) AND (b))) AND (c))" })).toBe(
      "CHECK ((NOT ((a) AND (b))) AND (c))",
    );
  });

  it("never crosses an OR boundary, in either direction", () => {
    expect(flattenAndChains({ text: "CHECK ((((a) OR (b))) AND (c))" })).toBe("CHECK ((((a) OR (b))) AND (c))");
    expect(flattenAndChains({ text: "CHECK ((((a) AND (b))) OR (c))" })).toBe("CHECK ((((a) AND (b))) OR (c))");
  });

  it("does not flatten an OR chain", () => {
    expect(flattenAndChains({ text: "CHECK ((((a) OR (b)) OR (c)))" })).toBe("CHECK ((((a) OR (b)) OR (c)))");
  });

  it("keeps a real difference different", () => {
    expect(flattenAndChains({ text: "CHECK (((a) AND (b)) AND (c))" })).toBe("CHECK ((a) AND (b) AND (c))");
    expect(flattenAndChains({ text: "CHECK (((a) AND (b)) AND (d))" })).toBe("CHECK ((a) AND (b) AND (d))");
  });

  it("does not splice a group carrying a cast", () => {
    expect(flattenAndChains({ text: "CHECK ((((a) AND (b))::boolean AND (c)))" })).toBe(
      "CHECK ((((a) AND (b))::boolean AND (c)))",
    );
  });

  it("treats a single-quoted literal as opaque, a doubled quote included", () => {
    const text = "CHECK (((x = 'it''s (a AND b)') AND (y)) AND (z))";
    expect(flattenAndChains({ text })).toBe("CHECK ((x = 'it''s (a AND b)') AND (y) AND (z))");
    expect(flattenAndChains({ text: "CHECK ((x = '(p AND q) AND r'))" })).toBe("CHECK ((x = '(p AND q) AND r'))");
  });

  it("treats a dollar-quoted literal as opaque, so two different constants stay different", () => {
    expect(flattenAndChains({ text: "CHECK ((v = $$(((a) AND (b)) AND (c))$$))" })).toBe(
      "CHECK ((v = $$(((a) AND (b)) AND (c))$$))",
    );
    expect(flattenAndChains({ text: "CHECK ((v = $q$(((a) AND (b)) AND (c))$q$))" })).toBe(
      "CHECK ((v = $q$(((a) AND (b)) AND (c))$q$))",
    );
  });

  it("does not read a parameter or an identifier's $ as a dollar quote", () => {
    expect(flattenAndChains({ text: "CHECK ((((a$b$ > $1)) AND (c)) AND (d))" })).toBe(
      "CHECK (((a$b$ > $1)) AND (c) AND (d))",
    );
  });

  it("treats an escape-string literal as opaque, a backslash-escaped quote included", () => {
    expect(flattenAndChains({ text: String.raw`CHECK (v = E'x\'(((a) AND (b)) AND (c))\'y')` })).toBe(
      String.raw`CHECK (v = E'x\'(((a) AND (b)) AND (c))\'y')`,
    );
  });

  it("treats a dollar quote with a non-ASCII tag as opaque, as Postgres's lexer does", () => {
    expect(flattenAndChains({ text: "CHECK (((v = $é$(((a) AND (b)) AND (c))$é$) AND (y)) AND (z))" })).toBe(
      "CHECK ((v = $é$(((a) AND (b)) AND (c))$é$) AND (y) AND (z))",
    );
  });

  it("returns a line with an unclosed dollar quote unchanged", () => {
    expect(flattenAndChains({ text: "CHECK (((v = $$x) AND (b)) AND (c))" })).toBe(
      "CHECK (((v = $$x) AND (b)) AND (c))",
    );
  });

  it("treats a double-quoted identifier as opaque, a doubled quote included", () => {
    expect(flattenAndChains({ text: 'CHECK ((("we""ird (a AND b)" > 0) AND (y)) AND (z))' })).toBe(
      'CHECK (("we""ird (a AND b)" > 0) AND (y) AND (z))',
    );
  });

  it("splits only on the uppercase keyword with a space either side", () => {
    expect(flattenAndChains({ text: "CHECK (((BRAND) and (x)) and (y))" })).toBe("CHECK (((BRAND) and (x)) and (y))");
    expect(flattenAndChains({ text: "CHECK (((xANDy) AND (b)))" })).toBe("CHECK (((xANDy) AND (b)))");
  });

  it("returns a line whose parentheses or quotes do not balance unchanged", () => {
    expect(flattenAndChains({ text: "CHECK (((a) AND (b)) AND (c)" })).toBe("CHECK (((a) AND (b)) AND (c)");
    expect(flattenAndChains({ text: "CHECK ((a) AND (b))) AND (c)" })).toBe("CHECK ((a) AND (b))) AND (c)");
    expect(flattenAndChains({ text: "CHECK (((a = 'x) AND (b)) AND (c))" })).toBe("CHECK (((a = 'x) AND (b)) AND (c))");
  });

  it("returns a balanced line nested far deeper than any catalog line unchanged, rather than throwing", () => {
    const deep = `constraint x CHECK (${"(".repeat(2000)}a${")".repeat(2000)})`;
    expect(flattenAndChains({ text: deep })).toBe(deep);
  });

  it("flattens an inner chain far wider than any catalog line without throwing", () => {
    const wide = Array.from({ length: 150_000 }, () => "a").join(" AND ");
    expect(flattenAndChains({ text: `CHECK ((${wide}) AND z)` })).toBe(`CHECK (${wide} AND z)`);
  });

  it("still flattens at 200 groups deep, and stops at 201", () => {
    const chain = "((a) AND (b)) AND (c)";
    expect(flattenAndChains({ text: `${"(".repeat(198)}${chain}${")".repeat(198)}` })).toBe(
      `${"(".repeat(198)}(a) AND (b) AND (c)${")".repeat(198)}`,
    );
    const past = `${"(".repeat(199)}${chain}${")".repeat(199)}`;
    expect(flattenAndChains({ text: past })).toBe(past);
  });

  it("leaves a line with no expression in it alone", () => {
    expect(flattenAndChains({ text: "relation public.a kind=r rls=true forced=false" })).toBe(
      "relation public.a kind=r rls=true forced=false",
    );
  });
});
