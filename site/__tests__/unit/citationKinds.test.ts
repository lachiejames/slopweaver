/*
 * The one registry every citation chip draws its colour and icon from. A host claimed by the wrong integration, a
 * lookalike host claimed at all, or a row with no colour would put the wrong logo on a chip in every page at once.
 * Every Datadog host in this file reads the synthetic `ap1` site rather than the install's own.
 */

import { describe, expect, it } from "vitest";

import { citationKind, INTEGRATION_KINDS, integrationKindOf, PLACE_KINDS, WEB_KIND } from "../../lib/citationKinds";

describe("integrationKindOf", () => {
  it("claims a host and its subdomains for the one integration that declares it", () => {
    expect(
      ["github.com", "acme.slack.com", "app.vanta.com", "console.jumpcloud.com", "app.ap1.datadoghq.com"].map(
        (host) => integrationKindOf({ host })!.id,
      ),
    ).toEqual(["github", "slack", "vanta", "jumpcloud", "datadog"]);
  });

  it("never claims a lookalike that merely ends in a declared domain", () => {
    expect(
      ["notgithub.com", "evilslack.com", "vanta.com.example.org"].map((host) => integrationKindOf({ host })),
    ).toEqual([undefined, undefined, undefined]);
  });
});

describe("the registry", () => {
  const every = [...INTEGRATION_KINDS, ...Object.values(PLACE_KINDS), WEB_KIND];

  it("gives every row a name and a six-digit colour", () => {
    expect(every.length).toBeGreaterThan(0);
    expect(every.filter((kind) => kind.source === "" || !/^#[0-9A-F]{6}$/u.test(kind.colour))).toEqual([]);
  });

  it("draws a real mark for every integration but the few with none bundled, which draw the link glyph, never letters", () => {
    expect(INTEGRATION_KINDS.length).toBeGreaterThan(0);
    expect(INTEGRATION_KINDS.filter((kind) => kind.mark === "").map((kind) => kind.id)).toEqual([
      "vanta",
      "jumpcloud",
      "hex",
      "inngest",
      "aether",
      "braze",
      "canva",
      "crowdstrike",
      "graphqlHive",
      "jam",
      "knock",
      "knowbe4",
      "make",
      "nightfall",
      "trelica",
      "twilio",
      "workos",
    ]);
  });

  it("keys every row once, and no host twice", () => {
    const hosts = INTEGRATION_KINDS.flatMap((kind) => kind.hosts);
    expect(every.length).toBeGreaterThan(0);
    expect(new Set(every.map((kind) => kind.id)).size).toBe(every.length);
    expect(new Set(hosts).size).toBe(hosts.length);
  });

  it("keeps every place in this console on this machine, and every integration off it", () => {
    expect(Object.values(PLACE_KINDS).every((kind) => kind.internal)).toBe(true);
    expect(INTEGRATION_KINDS.some((kind) => kind.internal)).toBe(false);
  });

  it("answers an unknown id with the neutral web row rather than nothing", () => {
    expect([citationKind({ id: "vanta" }).source, citationKind({ id: "no-such-kind" }).id]).toEqual(["Vanta", "web"]);
  });
});
