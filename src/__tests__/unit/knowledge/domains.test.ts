/**
 * The closed domain vocabulary: every alias lands on a domain the vocabulary holds, no alias shadows a
 * canonical slug, the standing of a slug is exactly one of the three, and an install's own domains and
 * aliases join the committed ones without the committed file naming any of them.
 */
import { describe, expect, it } from "vitest";

import { atlasPlatforms } from "../../../atlas/registry.js";
import { KNOWLEDGE_DOMAIN_ALIASES_A_TO_P } from "../../../knowledge/domainAliasesAtoP.js";
import { KNOWLEDGE_DOMAIN_ALIASES_Q_TO_Z } from "../../../knowledge/domainAliasesQtoZ.js";
import { KNOWLEDGE_DOMAIN_ALIASES, KNOWLEDGE_DOMAINS } from "../../../knowledge/domains.js";
import {
  domainStanding,
  type InstallKnowledgeDomains,
  knowledgeDomainEntries,
  knowledgeDomainSlugs,
  noInstallDomains,
} from "../../../knowledge/domainVocabulary.js";
import { isLessonDomain } from "../../../knowledge/row.js";

const HOME = "/tmp/sw-home";
const NONE = noInstallDomains({ home: HOME });

/** A synthetic install: its own domain, one alias into it and one into a committed domain. */
const ACME: InstallKnowledgeDomains = {
  aliases: { "acme-access": "identity", "acme-e2e": "acme" },
  domains: [{ holds: "the synthetic team monorepo and its local gates", slug: "acme" }],
  home: HOME,
};

describe("the closed domain vocabulary", () => {
  it("names every domain as a legal slug", () => {
    expect(KNOWLEDGE_DOMAINS.length).toBeGreaterThan(0);
    expect(knowledgeDomainSlugs({ installDomains: NONE }).filter((domain) => !isLessonDomain({ domain }))).toEqual([]);
  });

  it("describes every named domain, so a writer choosing one reads what it holds", () => {
    expect(KNOWLEDGE_DOMAINS.length).toBeGreaterThan(0);
    expect(KNOWLEDGE_DOMAINS.filter((entry) => entry.holds.trim().length === 0)).toEqual([]);
  });

  it("names each domain once", () => {
    const slugs = KNOWLEDGE_DOMAINS.map((entry) => entry.slug);
    expect(slugs.length).toBeGreaterThan(0);
    expect(slugs.filter((slug, index) => slugs.indexOf(slug) !== index)).toEqual([]);
  });

  it("holds every atlas platform, so adding an atlas adds its domain", () => {
    const slugs = knowledgeDomainSlugs({ installDomains: NONE });
    expect(atlasPlatforms().length).toBeGreaterThan(0);
    expect(atlasPlatforms().filter((platform) => !slugs.includes(platform))).toEqual([]);
  });

  it("folds every alias onto a domain the vocabulary holds", () => {
    const entries = Object.entries(KNOWLEDGE_DOMAIN_ALIASES);
    const slugs = knowledgeDomainSlugs({ installDomains: NONE });
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.filter(([, canonical]) => !slugs.includes(canonical))).toEqual([]);
  });

  it("lets no alias shadow a canonical slug, which would make the alias unreachable", () => {
    const aliases = Object.keys(KNOWLEDGE_DOMAIN_ALIASES);
    const slugs = knowledgeDomainSlugs({ installDomains: NONE });
    expect(aliases.length).toBeGreaterThan(0);
    expect(aliases.filter((alias) => slugs.includes(alias))).toEqual([]);
  });

  it("folds the four spellings of CI the hygiene page named into one domain", () => {
    expect(
      ["ci", "slopweaver-ci", "github-ci", "github-actions"].map((domain) =>
        domainStanding({ domain, installDomains: NONE }),
      ),
    ).toEqual([
      { kind: "canonical" },
      { canonical: "ci", kind: "alias" },
      { canonical: "ci", kind: "alias" },
      { canonical: "ci", kind: "alias" },
    ]);
  });

  it("keeps pulumi a committed alias of gcp", () => {
    expect(domainStanding({ domain: "pulumi", installDomains: NONE })).toEqual({ canonical: "gcp", kind: "alias" });
  });

  it("calls a slug neither canonical nor an alias unknown", () => {
    expect(domainStanding({ domain: "made-up-system", installDomains: NONE })).toEqual({ kind: "unknown" });
  });

  it("reads an inherited Object property as unknown, never as an alias", () => {
    expect(domainStanding({ domain: "constructor", installDomains: ACME })).toEqual({ kind: "unknown" });
  });
});

describe("the alias ranges the vocabulary composes", () => {
  const parentEntries = Object.entries(KNOWLEDGE_DOMAIN_ALIASES);
  const aToPEntries = Object.entries(KNOWLEDGE_DOMAIN_ALIASES_A_TO_P);
  const qToZEntries = Object.entries(KNOWLEDGE_DOMAIN_ALIASES_Q_TO_Z);

  it("holds the A-through-P spellings first, from admit to pull-requests, in order", () => {
    expect(aToPEntries.length).toBeGreaterThan(0);
    expect(aToPEntries[0]![0]).toBe("admit");
    expect(aToPEntries.at(-1)![0]).toBe("pull-requests");
    expect(parentEntries.slice(0, aToPEntries.length)).toEqual(aToPEntries);
  });

  it("holds the Q-through-Z spellings after them, from raycast to zod, in order", () => {
    expect(qToZEntries.length).toBeGreaterThan(0);
    expect(qToZEntries[0]![0]).toBe("raycast");
    expect(qToZEntries.at(-1)![0]).toBe("zod");
    expect(parentEntries.slice(aToPEntries.length)).toEqual(qToZEntries);
  });

  it("is exactly the two ranges, contiguous, with nothing dropped or overwritten", () => {
    expect(aToPEntries.length).toBe(144);
    expect(qToZEntries.length).toBe(122);
    expect(parentEntries).toEqual([...aToPEntries, ...qToZEntries]);
  });
});

describe("an install's own domains", () => {
  it("joins the install domain once, sorted among the rest, marked as the install's", () => {
    const entries = knowledgeDomainEntries({ installDomains: ACME });
    const slugs = entries.map((entry) => entry.slug);
    expect(entries.filter((entry) => entry.slug === "acme")).toEqual([
      { holds: "the synthetic team monorepo and its local gates", slug: "acme", source: "install" },
    ]);
    expect(slugs).toEqual(slugs.toSorted((left, right) => left.localeCompare(right)));
  });

  it("adds exactly the install's domains to the committed vocabulary", () => {
    const without = knowledgeDomainSlugs({ installDomains: NONE });
    const withAcme = knowledgeDomainSlugs({ installDomains: ACME });
    expect(withAcme.filter((slug) => !without.includes(slug))).toEqual(["acme"]);
    expect(without.includes("acme")).toBe(false);
  });

  it("marks an atlas platform as atlas, with nothing it holds but its atlas", () => {
    const platform = atlasPlatforms()[0]!;
    expect(knowledgeDomainEntries({ installDomains: NONE }).find((entry) => entry.slug === platform)).toEqual({
      holds: null,
      slug: platform,
      source: "atlas",
    });
  });

  it("folds an install alias into the install's domain or into a committed one", () => {
    expect(domainStanding({ domain: "acme", installDomains: ACME })).toEqual({ kind: "canonical" });
    expect(domainStanding({ domain: "acme-e2e", installDomains: ACME })).toEqual({ canonical: "acme", kind: "alias" });
    expect(domainStanding({ domain: "acme-access", installDomains: ACME })).toEqual({
      canonical: "identity",
      kind: "alias",
    });
  });

  it("knows none of them without the install file", () => {
    expect(["acme", "acme-e2e"].map((domain) => domainStanding({ domain, installDomains: NONE }))).toEqual([
      { kind: "unknown" },
      { kind: "unknown" },
    ]);
  });
});
