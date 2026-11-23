import { describe, expect, it } from "vitest";

import { isPlainClick, NAV_STALL_MS, navStallAction, pathOfHref } from "../../lib/navStall";

const PLAIN = { altKey: false, button: 0, ctrlKey: false, metaKey: false, shiftKey: false };

describe("which sidebar click the page waits for", () => {
  it("takes a primary-button click with no modifier", () => {
    expect(isPlainClick(PLAIN)).toBe(true);
  });

  it("leaves a click that opens a tab or a window alone", () => {
    expect(isPlainClick({ ...PLAIN, metaKey: true })).toBe(false);
    expect(isPlainClick({ ...PLAIN, ctrlKey: true })).toBe(false);
    expect(isPlainClick({ ...PLAIN, shiftKey: true })).toBe(false);
    expect(isPlainClick({ ...PLAIN, altKey: true })).toBe(false);
    expect(isPlainClick({ ...PLAIN, button: 1 })).toBe(false);
  });
});

describe("the path a sidebar address lands on", () => {
  it("drops the query the context rides in", () => {
    expect(pathOfHref({ href: "/queue?context=work&sidebar=icons" })).toBe("/queue");
  });

  it("drops a fragment", () => {
    expect(pathOfHref({ href: "/talk#voice" })).toBe("/talk");
  });

  it("keeps a bare path whole", () => {
    expect(pathOfHref({ href: "/workstreams" })).toBe("/workstreams");
  });
});

describe("a click whose page has not arrived", () => {
  it("waits out the rest of the allowance", () => {
    expect(navStallAction({ callLive: false, clickedAtMs: 1_000, nowMs: 1_500 })).toEqual({
      inMs: NAV_STALL_MS - 500,
      kind: "wait",
    });
  });

  it("loads the page as a document once the allowance is spent", () => {
    expect(navStallAction({ callLive: false, clickedAtMs: 1_000, nowMs: 1_000 + NAV_STALL_MS })).toEqual({
      kind: "load-document",
    });
  });

  it("holds it instead during a voice call, which a document load would end", () => {
    expect(navStallAction({ callLive: true, clickedAtMs: 1_000, nowMs: 1_000 + NAV_STALL_MS + 1 })).toEqual({
      kind: "held-by-call",
    });
  });

  it("loads a click held for a call once the call has ended", () => {
    expect(navStallAction({ callLive: false, clickedAtMs: 0, nowMs: 60_000 })).toEqual({ kind: "load-document" });
  });

  it("still waits during a call while the allowance runs", () => {
    expect(navStallAction({ callLive: true, clickedAtMs: 0, nowMs: NAV_STALL_MS - 1 })).toEqual({
      inMs: 1,
      kind: "wait",
    });
  });
});
