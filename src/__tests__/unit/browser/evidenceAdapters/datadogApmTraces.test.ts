/**
 * The Trace Explorer adapter is page-script TEXT: the observer runs inside a real page, which the unit lane does
 * not have. So these tests pin what can be pinned in Node — the exact selector, the two patterns as the regular
 * expressions the page will build from them, and the fragments the generated source carries. None of them
 * claims the generated function was executed.
 */
import { describe, expect, it } from "vitest";

import {
  datadogApmTracesObserveSource,
  SPAN_COUNT_PATTERN,
  TARGET_SELECTOR,
  ZERO_STATE_PATTERN,
} from "../../../../browser/evidenceAdapters/datadogApmTraces.js";

/** Build the RegExp a `/body/flags` literal compiles to, the way the page does when it evaluates the source. */
function regexOf({ literal }: { literal: string }): RegExp {
  const close = literal.lastIndexOf("/");
  return new RegExp(literal.slice(1, close), literal.slice(close + 1));
}

describe("the Trace Explorer constants", () => {
  it("targets the one visualization panel by its plain class name", () => {
    expect(TARGET_SELECTOR).toBe(".trace_analytics-visualization");
  });

  it("spells both patterns as the exact regular-expression literals the page source embeds", () => {
    expect(SPAN_COUNT_PATTERN).toBe("/([\\d.,]+)\\s*([kKmM]?)\\s+indexed spans/");
    expect(ZERO_STATE_PATTERN).toBe("/no matching traces found/i");
  });

  it("captures the number and the abbreviation suffix of an abbreviated span count", () => {
    expect([...regexOf({ literal: SPAN_COUNT_PATTERN }).exec("3.23k indexed spans")!]).toEqual([
      "3.23k indexed spans",
      "3.23",
      "k",
    ]);
    expect([...regexOf({ literal: SPAN_COUNT_PATTERN }).exec("1.5M indexed spans")!]).toEqual([
      "1.5M indexed spans",
      "1.5",
      "M",
    ]);
  });

  it("captures an unabbreviated count with an empty suffix", () => {
    expect([...regexOf({ literal: SPAN_COUNT_PATTERN }).exec("78 indexed spans")!]).toEqual([
      "78 indexed spans",
      "78",
      "",
    ]);
  });

  it("does not read a span total that is not an indexed-span count", () => {
    expect(regexOf({ literal: SPAN_COUNT_PATTERN }).exec("5,655,609 spans found in the past 15 min")).toBe(null);
  });

  it("finds the zero-state sentence anywhere in the panel text, in any case, and not in a span count", () => {
    expect(regexOf({ literal: ZERO_STATE_PATTERN }).test("No matching traces found · 5,655,609 spans")).toBe(true);
    expect(regexOf({ literal: ZERO_STATE_PATTERN }).test("NO MATCHING TRACES FOUND")).toBe(true);
    expect(regexOf({ literal: ZERO_STATE_PATTERN }).test("prefix no matching traces found suffix")).toBe(true);
    expect(regexOf({ literal: ZERO_STATE_PATTERN }).test("no matching traces")).toBe(false);
    expect(regexOf({ literal: ZERO_STATE_PATTERN }).test("3.23k indexed spans")).toBe(false);
  });
});

describe("datadogApmTracesObserveSource", () => {
  const source = datadogApmTracesObserveSource();

  it("generates a zero-argument function source", () => {
    expect(source.startsWith("() => {")).toBe(true);
  });

  it("generates source that targets the Trace Explorer panel selector", () => {
    expect(source).toContain(`const TARGET = ${JSON.stringify(TARGET_SELECTOR)};`);
  });

  it("generates source that assigns both patterns as regular-expression literals", () => {
    expect(source).toContain(`const SPANS = ${SPAN_COUNT_PATTERN};`);
    expect(source).toContain(`const ZERO_STATE = ${ZERO_STATE_PATTERN};`);
  });

  it("generates source that scales a k suffix by 1000 and an M suffix by 1000000", () => {
    expect(source).toContain('if (suffix === "k" || suffix === "K") {\n          return 1000;');
    expect(source).toContain('if (suffix === "m" || suffix === "M") {\n          return 1000000;');
  });

  it("generates source that rounds the scaled count and fills both summary counts with it", () => {
    expect(source).toContain("const spans = Math.round(count(match[1]) * scale(match[2]));");
    expect(source).toContain("summary = { groups: spans, logs: spans,");
  });

  it("generates source that reports the zero-state panel as a summary with both counts 0", () => {
    expect(source).toContain("summary = { groups: 0, logs: 0,");
  });

  it("generates the same source on every call", () => {
    expect(datadogApmTracesObserveSource()).toBe(source);
  });
});
