/**
 * Unit: the mail sanitiser's allowlist tables say what its header promises — nothing active is kept, nothing that
 * fetches or navigates is an allowed attribute, and no element is both kept and dropped.
 */
import { describe, expect, it } from "vitest";

import {
  DROPPED_ELEMENTS,
  ELEMENT_ATTRIBUTES,
  GLOBAL_ATTRIBUTES,
  isKeptDataImage,
  KEPT_ELEMENTS,
  REMOTE_SOURCE,
  VOID_ELEMENTS,
} from "../../../../live/gmail/mailHtmlAllowlist.js";

/** Every attribute any element may carry. */
const EVERY_ATTRIBUTE = [...GLOBAL_ATTRIBUTES, ...Object.values(ELEMENT_ATTRIBUTES).flatMap((names) => [...names])];

describe("mail HTML allowlist", () => {
  it("keeps no active, embedding or form element", () => {
    expect(KEPT_ELEMENTS.size).toBeGreaterThan(0);
    const active = ["script", "iframe", "object", "embed", "form", "input", "svg", "math", "style", "link", "meta"];
    expect(active.filter((name) => KEPT_ELEMENTS.has(name))).toEqual([]);
  });

  it("drops each of those with its contents", () => {
    const active = ["script", "iframe", "object", "embed", "form", "input", "svg", "math", "link", "meta", "noscript"];
    expect(active.filter((name) => !DROPPED_ELEMENTS.has(name))).toEqual([]);
  });

  it("names no element as both kept and dropped", () => {
    expect([...KEPT_ELEMENTS].filter((name) => DROPPED_ELEMENTS.has(name))).toEqual([]);
  });

  it("closes no void element it does not keep", () => {
    expect([...VOID_ELEMENTS].filter((name) => !KEPT_ELEMENTS.has(name))).toEqual([]);
  });

  it("allows no event handler, link target, srcset or background fetch", () => {
    expect(EVERY_ATTRIBUTE.length).toBeGreaterThan(0);
    const fetching = new Set(["href", "srcset", "background", "action", "formaction", "poster", "xlink:href", "ping"]);
    expect(EVERY_ATTRIBUTE.filter((name) => name.startsWith("on") || fetching.has(name))).toEqual([]);
  });

  it("keeps a base64 raster data image and nothing that can carry script", () => {
    expect(isKeptDataImage({ source: "data:image/png;base64,iVBORw0KGgo=" })).toBe(true);
    expect(isKeptDataImage({ source: "data:image/svg+xml;base64,PHN2Zz4=" })).toBe(false);
    expect(isKeptDataImage({ source: "data:text/html;base64,PHA+" })).toBe(false);
  });

  it("refuses an empty body, as the quantified regex it replaces did", () => {
    expect(isKeptDataImage({ source: "data:image/png;base64," })).toBe(false);
  });

  it("keeps a body ending in a newline, whitespace being in the body's class", () => {
    expect(isKeptDataImage({ source: "data:image/png;base64,AAAA\n" })).toBe(true);
  });

  it("refuses one character outside the alphabet in the middle of the body", () => {
    expect(isKeptDataImage({ source: "data:image/png;base64,AA!AA" })).toBe(false);
  });

  it("reads the header without regard to case and walks every header's own length", () => {
    expect(isKeptDataImage({ source: "DATA:IMAGE/PNG;BASE64,AAAA" })).toBe(true);
    expect(isKeptDataImage({ source: "data:image/jpeg;base64,AAAA" })).toBe(true);
    expect(isKeptDataImage({ source: "data:image/webp;base64,AAAA" })).toBe(true);
  });

  it("folds no non-ASCII letter into the alphabet", () => {
    expect(isKeptDataImage({ source: "data:image/png;base64,AAſ" })).toBe(false);
    expect(isKeptDataImage({ source: "data:image/png;base64,AAK" })).toBe(false);
  });

  it("reads http, https and protocol-relative sources as remote", () => {
    expect(["http://a.test/x.png", "https://a.test/x.png", "//a.test/x.png"].map((s) => REMOTE_SOURCE.test(s))).toEqual(
      [true, true, true],
    );
    expect(REMOTE_SOURCE.test("data:image/png;base64,AA==")).toBe(false);
  });
});
