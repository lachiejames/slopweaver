/**
 * The marker proof: a marker counts only when the pattern's top level spells it unbroken, so a skip built on
 * it can never drop a match. Each refusal below is a shape that matches some text without the marker.
 */
import { describe, expect, it } from "vitest";

import { markerIsRequired } from "../../../hygiene/locationMarker.js";

const proves = ({ marker, re }: { marker: string; re: RegExp }): boolean => markerIsRequired({ marker, re });

describe("markerIsRequired", () => {
  it("proves a host literal after a label group and an optional subdomain group", () => {
    expect(proves({ marker: "slack.com", re: /([a-z0-9-]+)\.(?:enterprise\.)?slack\.com/gi })).toBe(true);
    expect(proves({ marker: "linear.app/", re: /(?<![a-z])linear\.app\/([a-z0-9-]+)/gi })).toBe(true);
  });

  it("refuses a top-level alternation, where another branch matches without the marker", () => {
    expect(proves({ marker: "slack.com", re: /([a-z]+)\.slack\.com|([a-z]+)\.other\.com/gi })).toBe(false);
  });

  it("refuses a marker that lives inside a group, alternating or not", () => {
    expect(proves({ marker: "slack.com", re: /([a-z]+)(?:slack.com|other.com)/gi })).toBe(false);
    expect(proves({ marker: "slack.com", re: /([a-z]+)\.(?:slack\.com)/gi })).toBe(false);
  });

  it("refuses an unescaped dot, which is a wildcard and not the dot in the marker", () => {
    expect(proves({ marker: "slack.com", re: /([a-z]+)\.slack.com/gi })).toBe(false);
  });

  it("refuses a marker broken by a quantifier or a group between its characters", () => {
    expect(proves({ marker: "slack.com", re: /([a-z]+)\.slack\.com?/gi })).toBe(false);
    expect(proves({ marker: "slack.com", re: /([a-z]+)\.slack\.co+m/gi })).toBe(false);
    expect(proves({ marker: "slack.com", re: /([a-z]+)\.slack(?:x)?\.com/gi })).toBe(false);
  });

  it("refuses a marker spelled only through an escape's operand", () => {
    expect(proves({ marker: "41.com", re: /([a-z]+)\x41\.com/gi })).toBe(false);
  });

  it("refuses a Unicode-mode pattern, whose case folding matches text a lowercased copy does not spell", () => {
    expect(proves({ marker: "s", re: /([a-z]+)s/giu })).toBe(false);
    expect(proves({ marker: "s", re: /([a-z]+)s/giv })).toBe(false);
    expect(proves({ marker: "s", re: /([a-z]+)s/gi })).toBe(true);
  });

  it("refuses a non-ASCII marker, which regex folding and toLowerCase disagree on", () => {
    expect(proves({ marker: "σ", re: /([a-z]+)Σ/gi })).toBe(false);
  });

  it("refuses an ASCII marker spelled only through a non-ASCII literal that lowercases onto it", () => {
    expect(proves({ marker: "k.com", re: /([a-z]+)K\.com/gi })).toBe(false);
  });

  it("refuses an empty marker and one the pattern never spells", () => {
    expect(proves({ marker: "", re: /([a-z]+)\.slack\.com/gi })).toBe(false);
    expect(proves({ marker: "slack.org", re: /([a-z]+)\.slack\.com/gi })).toBe(false);
  });

  it("reads a `)` inside a character class as literal, not as the group's close", () => {
    expect(proves({ marker: "slack.com", re: /([)a-z]+\.)slack\.com/gi })).toBe(true);
    expect(proves({ marker: "slack.com", re: /([)a-z]+\.slack\.com)/gi })).toBe(false);
  });
});
