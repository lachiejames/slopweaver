import { describe, expect, it } from "vitest";

import { atlasKitOnlySummary, atlasKitVerbsFor, atlasPlatformVerbNames } from "../../../atlas/kit/verbs.js";
import { atlasPlatforms, atlasRegistrations, findAtlasPlatform } from "../../../atlas/registry.js";
import { atlasPlatformUsage } from "../../../cli/commands/atlas/platformVerb.js";
import { atlasManifest } from "../../../cli/manifests/atlas.js";
import { atlasEstateManifest } from "../../../cli/manifests/atlasEstate.js";

/**
 * Every platform this build has, and EXACTLY the verbs each answers beyond the kit's four, in the order
 * its usage block lists them.
 *
 * Hand-written on purpose and compared against the registry both ways: a registration that lost a verb, or
 * grew one nobody wrote down, fails here by name. That is the property the 31 per-platform suites each
 * asserted for their own platform before the registry carried the rows — kept as one table so the next
 * atlas adds a line rather than a file.
 */
const OWN_VERBS: Readonly<Record<string, readonly string[]>> = {
  aether: ["walk", "reset"],
  airtable: ["sync", "reset"],
  braze: ["sync", "report", "reset"],
  canva: ["sync", "reset"],
  clerk: ["sync", "walk", "refresh", "report", "reset"],
  cloudflare: [],
  crowdstrike: [],
  datadog: ["sync", "walk", "reset"],
  figma: ["sync", "reset"],
  "gemini-ai-studio": ["sync", "reset"],
  github: ["sync", "walk", "report"],
  "google-admin": ["sync", "connect", "fill", "walk", "reset"],
  "google-secops": ["connect", "fill"],
  "graphql-hive": ["sync", "walk", "refresh", "report", "reset"],
  hex: ["sync", "walk", "refresh", "report", "reset"],
  inngest: ["sync", "walk", "reset"],
  jam: ["sync", "walk", "refresh", "report"],
  jumpcloud: ["auth-events", "sync", "walk", "reset"],
  knock: ["sync", "walk", "report"],
  knowbe4: ["sync"],
  linear: ["sync", "walk", "report", "reset"],
  make: ["fill"],
  microsoft365: ["sync", "reset"],
  nightfall: ["sync", "reset"],
  notion: ["sync", "walk", "settings", "refresh", "report", "reset"],
  "nx-cloud": ["sync", "walk", "refresh", "report", "reset"],
  onepassword: [],
  "prisma-data-platform": ["sync", "reset"],
  slack: [],
  trelica: ["sync", "walk", "refresh", "report", "reset"],
  twilio: ["sync", "walk", "report", "reset"],
  vanta: [
    "sync",
    "changes",
    "reset",
    "vulnerabilities",
    "test-entities",
    "controls-evidence",
    "control-evidence",
    "walk",
    "shot",
    "policy-versions",
  ],
  workos: ["sync", "walk", "refresh", "report", "reset"],
  xero: ["sync", "walk", "refresh", "report", "families", "reset"],
};

/** The rows whose verbs reach a doored provider under a read-only grant. Every other row is undoored. */
const DOOR_ROUTED: readonly string[] = ["clerk", "knock", "linear"];

/**
 * A word in a platform's usage block that a reader most needs and that a generic line would flatten —
 * carried over from the per-platform suites that each pinned one.
 */
const USAGE_SAYS: Readonly<Record<string, readonly string[]>> = {
  airtable: ["no network call and no credential"],
  braze: ["including that no workspace has ever been read", "the stored operations"],
  datadog: ["no network call and", "no credential"],
  "gemini-ai-studio": ["including who holds its entities instead"],
  github: ["it resolves none of them"],
  linear: ["photographed", "it resolves nothing"],
  microsoft365: ["no credential, no tenant reached", "including that no tenant has ever been read"],
  notion: ["no network call"],
  vanta: [
    "nothing is published",
    "fill the BROWSER surface",
    "photograph ONE named control at its own address",
    "reads only, clicks no item",
    "file the evidence behind which of them need attention",
    "explain ONE control LIVE",
    "with each deactivation's reason",
  ],
  xero: ["fill the BROWSER surface", "every business-object family, its disposition"],
};

/** A word in a platform's catalogue summary that is the row's whole point. */
const SUMMARY_SAYS: Readonly<Record<string, string>> = {
  datadog: "fill the `console` channel",
  microsoft365: "The LIVE Graph surface is unfilled",
  notion: "Page CONTENT is the world model's",
  "nx-cloud": "declared rather than stored",
  xero: "never stored whole",
};

/** Verbs that would change a platform. An atlas only ever reads, so no row may answer one. */
const MUTATIONS: ReadonlySet<string> = new Set([
  "approve",
  "create",
  "deactivate",
  "delete",
  "pay",
  "post",
  "reconcile",
  "void",
  "write",
]);

describe("the registry's verb rows", () => {
  it("names exactly the platforms the table names, so the table cannot go stale in either direction", () => {
    expect([...atlasPlatforms()].toSorted()).toEqual(Object.keys(OWN_VERBS).toSorted());
  });

  it.each(Object.entries(OWN_VERBS))("%s declares exactly its own verbs, in usage order", (platform, verbs) => {
    const registration = findAtlasPlatform({ platform })!;
    expect(registration.verbs.map((verb) => verb.verb)).toEqual(verbs);
  });

  it.each(atlasPlatforms())("%s answers the kit verbs alongside its own, sorted", (platform) => {
    const registration = findAtlasPlatform({ platform })!;
    const kit = atlasKitVerbsFor({ hasReset: registration.readReset !== undefined });
    expect([
      ...atlasPlatformVerbNames({ hasReset: registration.readReset !== undefined, ownVerbs: registration.verbs }),
    ]).toEqual([...kit, ...OWN_VERBS[platform]!].toSorted());
  });

  it.each(atlasPlatforms())("%s answers no verb that would change the platform", (platform) => {
    const registration = findAtlasPlatform({ platform })!;
    expect(registration.verbs.map((verb) => verb.verb).filter((verb) => MUTATIONS.has(verb))).toEqual([]);
  });

  it.each(atlasPlatforms())("%s describes every verb it lists in its usage block", (platform) => {
    const registration = findAtlasPlatform({ platform })!;
    const usage = atlasPlatformUsage({ registration });
    expect(
      usage.startsWith(
        `usage: slopweaver atlas ${platform} <${atlasPlatformVerbNames({ hasReset: registration.readReset !== undefined, ownVerbs: registration.verbs }).join(" | ")}>`,
      ),
    ).toBe(true);
    const undescribed = atlasPlatformVerbNames({
      hasReset: registration.readReset !== undefined,
      ownVerbs: registration.verbs,
    }).filter((verb) => !usage.includes(`\n  ${verb} `));
    expect(undescribed).toEqual([]);
  });

  it.each(Object.entries(USAGE_SAYS))("%s's usage block keeps the words a reader most needs", (platform, phrases) => {
    const usage = atlasPlatformUsage({ registration: findAtlasPlatform({ platform })! });
    expect(phrases.filter((phrase) => !usage.includes(phrase))).toEqual([]);
  });

  it("carries a fallback on the Slack row alone, because `atlas slack` with no verb is the map", () => {
    expect(
      atlasRegistrations()
        .filter((registration) => registration.fallback !== undefined)
        .map((r) => r.platform),
    ).toEqual(["slack"]);
  });

  it("gives a kit-only atlas a null summary, and no other", () => {
    const kitOnly = atlasRegistrations()
      .filter((registration) => registration.catalogue.summary === null)
      .map((registration) => registration.platform);
    expect(kitOnly).toEqual(["cloudflare", "crowdstrike", "onepassword"]);
  });

  it("door-routes exactly the rows whose sync reads a doored provider", () => {
    const doored = atlasRegistrations()
      .filter((registration) => registration.catalogue.doorRouted)
      .map((registration) => registration.platform);
    expect(doored).toEqual(DOOR_ROUTED);
  });
});

// Every own verb's `load()` names an export of a real module. A row that pointed at a module that does not
// exist, or at an export a rename removed, would refuse at dispatch and pass every other test — this is the
// 1Password shape (an atlas complete and unreachable) at the verb level, and it is caught here by loading each.
describe("every own verb loads to a command", () => {
  const rows = atlasRegistrations().flatMap((registration) =>
    registration.verbs.map((verb) => [registration.platform, verb.verb, verb] as const),
  );

  it.each(rows)("%s %s", async (_platform, _verb, verb) => {
    expect(await verb.load()).toBeInstanceOf(Function);
  });

  it("loads Slack's fallback to the map", async () => {
    expect(await findAtlasPlatform({ platform: "slack" })!.fallback!()).toBeInstanceOf(Function);
  });
});

describe("the manifest row each registration becomes", () => {
  const generated = atlasPlatforms().filter((platform) => platform !== "slack");

  // The estate rows are EXCLUDED by reading the module that declares them rather than by a literal list.
  // Measured: `probe` landed as the fourth estate verb and this case failed with "probe" in the received
  // array, naming a platform nobody had registered — a list that has to be edited in step with a sibling
  // module is a second declaration of the same fact. Slack's two are named, because they are the
  // hand-written map's own rows and `atlasSlack.ts` keys them by neither platform nor estate verb.
  it("has one row per registered platform, with Slack's hand-written beside them", () => {
    const estate = new Set(Object.keys(atlasEstateManifest));
    expect(estate.size).toBeGreaterThan(0);
    const rows = Object.keys(atlasManifest).filter(
      (key) => !estate.has(key) && !["slack-api", "slack-drive"].includes(key),
    );
    expect(rows.toSorted()).toEqual([...atlasPlatforms()].toSorted());
  });

  it("keeps every estate verb out of the platform list, so no estate verb is ever read as an atlas", () => {
    const platforms = new Set(atlasPlatforms());
    const estateKeys = Object.keys(atlasEstateManifest);
    // Both sides are asserted non-empty first: an empty estate manifest, or an empty registry, makes the
    // filter below vacuously true and the case would pass over a build carrying neither.
    expect(estateKeys.length).toBeGreaterThan(0);
    expect(platforms.size).toBeGreaterThan(0);
    expect(estateKeys.filter((key) => platforms.has(key))).toEqual([]);
  });

  it.each(generated)("%s advertises every verb the dispatcher answers", (platform) => {
    const registration = findAtlasPlatform({ platform })!;
    const { usage } = atlasManifest[platform]!.meta;
    expect(
      usage.startsWith(
        `usage: slopweaver atlas ${platform} <${atlasPlatformVerbNames({ hasReset: registration.readReset !== undefined, ownVerbs: registration.verbs }).join(" | ")}>`,
      ),
    ).toBe(true);
  });

  it.each(generated)(
    "%s advertises each own verb's flag tail, so a flag is never reachable but unadvertised",
    (platform) => {
      const registration = findAtlasPlatform({ platform })!;
      const { usage } = atlasManifest[platform]!.meta;
      const missing = registration.verbs.flatMap((verb) => verb.usage).filter((line) => !usage.includes(`\n  ${line}`));
      expect(missing).toEqual([]);
    },
  );

  it.each(generated)("%s advertises the kit verbs' flags", (platform) => {
    const { usage } = atlasManifest[platform]!.meta;
    expect(
      ["  read [--kind", "  coverage [--kind", "  render [--out", "  restore [--archive"].filter(
        (line) => !usage.includes(line),
      ),
    ).toEqual([]);
  });

  it.each(generated)(
    "%s is local-state, diagnostic and parse-safe, with the catalogue's own example and door",
    (platform) => {
      const registration = findAtlasPlatform({ platform })!;
      const { meta } = atlasManifest[platform]!;
      expect(meta.effect).toBe("local-state");
      expect(meta.diagnostic).toBe(true);
      expect(meta.dryParseSafe).toBe(true);
      expect(meta.parseRejectIsIoFree).toBe(true);
      expect(meta.createsWorkItem).toBe(false);
      expect(meta.doorRouted).toBe(registration.catalogue.doorRouted);
      expect(meta.example).toBe(registration.catalogue.example);
    },
  );

  it.each(Object.entries(SUMMARY_SAYS))("%s's summary says what the row is for", (platform, phrase) => {
    expect(atlasManifest[platform]!.meta.summary).toContain(phrase);
  });

  it("prints the generic kit summary for a kit-only atlas rather than a copy of it", () => {
    expect(atlasManifest["cloudflare"]!.meta.summary).toBe(atlasKitOnlySummary({ platform: "cloudflare" }));
    expect(atlasManifest["cloudflare"]!.meta.usage).toBe(
      "usage: slopweaver atlas cloudflare <coverage | read | render | restore>\n" +
        "  read [--kind <k>] [--surface <s>] [--id <id>] [--query <words>] [--include-stale]\n" +
        "       [--after <entity-id>] [--limit <1..1000>] [--json] [--home <dir>]\n" +
        "  coverage [--kind <k>] [--surface <s>] [--state <coverage-state>] [--open-only] [--json] [--home <dir>]\n" +
        "  render [--out <path>] [--fragment] [--json] [--max-rows <n>] [--never-hit-cap <n>]\n" +
        "         [--screenshot-budget-mib <n>] [--no-screenshots] [--max-page-mib <n>] [--home <dir>]\n" +
        "  restore [--archive <archive-id> --confirm archive-current] [--json] [--home <dir>]",
    );
  });
});
