import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { AETHER_ATLAS_DESCRIPTOR } from "../../../atlas/aether/descriptor.js";
import { AETHER_ATLAS_REGISTRATION } from "../../../atlas/aether/registration.js";
import { AIRTABLE_ATLAS_DESCRIPTOR } from "../../../atlas/airtable/descriptor.js";
import { AIRTABLE_ATLAS_REGISTRATION } from "../../../atlas/airtable/registration.js";
import { BRAZE_ATLAS_DESCRIPTOR } from "../../../atlas/braze/descriptor.js";
import { BRAZE_ATLAS_REGISTRATION } from "../../../atlas/braze/registration.js";
import { CANVA_ATLAS_DESCRIPTOR } from "../../../atlas/canva/descriptor.js";
import { CANVA_ATLAS_REGISTRATION } from "../../../atlas/canva/registration.js";
import { CLERK_ATLAS_DESCRIPTOR } from "../../../atlas/clerk/descriptor.js";
import { CLERK_ATLAS_REGISTRATION } from "../../../atlas/clerk/registration.js";
import { CLOUDFLARE_ATLAS_DESCRIPTOR } from "../../../atlas/cloudflare/descriptor.js";
import { CLOUDFLARE_ATLAS_REGISTRATION } from "../../../atlas/cloudflare/registration.js";
import { CROWDSTRIKE_ATLAS_DESCRIPTOR } from "../../../atlas/crowdstrike/descriptor.js";
import { CROWDSTRIKE_ATLAS_REGISTRATION } from "../../../atlas/crowdstrike/registration.js";
import { DATADOG_ATLAS_DESCRIPTOR } from "../../../atlas/datadog/descriptor.js";
import { DATADOG_ATLAS_REGISTRATION } from "../../../atlas/datadog/registration.js";
import { FIGMA_ATLAS_DESCRIPTOR } from "../../../atlas/figma/descriptor.js";
import { FIGMA_ATLAS_REGISTRATION } from "../../../atlas/figma/registration.js";
import { GEMINI_AI_STUDIO_ATLAS_DESCRIPTOR } from "../../../atlas/geminiAiStudio/descriptor.js";
import { GEMINI_AI_STUDIO_ATLAS_REGISTRATION } from "../../../atlas/geminiAiStudio/registration.js";
import { GITHUB_ATLAS_DESCRIPTOR } from "../../../atlas/github/descriptor.js";
import { GITHUB_ATLAS_REGISTRATION } from "../../../atlas/github/registration.js";
import { GOOGLE_ADMIN_ATLAS_DESCRIPTOR } from "../../../atlas/googleAdmin/descriptor.js";
import { GOOGLE_ADMIN_ATLAS_REGISTRATION } from "../../../atlas/googleAdmin/registration.js";
import { GOOGLE_SECOPS_ATLAS_DESCRIPTOR } from "../../../atlas/googleSecops/descriptor.js";
import { GOOGLE_SECOPS_ATLAS_REGISTRATION } from "../../../atlas/googleSecops/registration.js";
import { HIVE_ATLAS_DESCRIPTOR } from "../../../atlas/graphqlHive/descriptor.js";
import { GRAPHQL_HIVE_ATLAS_REGISTRATION } from "../../../atlas/graphqlHive/registration.js";
import { HEX_ATLAS_DESCRIPTOR } from "../../../atlas/hex/descriptor.js";
import { HEX_ATLAS_REGISTRATION } from "../../../atlas/hex/registration.js";
import { INNGEST_ATLAS_DESCRIPTOR } from "../../../atlas/inngest/descriptor.js";
import { INNGEST_ATLAS_REGISTRATION } from "../../../atlas/inngest/registration.js";
import { JAM_ATLAS_DESCRIPTOR } from "../../../atlas/jam/descriptor.js";
import { JAM_ATLAS_REGISTRATION } from "../../../atlas/jam/registration.js";
import { JUMPCLOUD_ATLAS_DESCRIPTOR } from "../../../atlas/jumpcloud/descriptor.js";
import { JUMPCLOUD_ATLAS_REGISTRATION } from "../../../atlas/jumpcloud/registration.js";
import type { AtlasDescriptor } from "../../../atlas/kit/contract.js";
import type { AtlasPlatformRegistration } from "../../../atlas/kit/registration.js";
import { KNOCK_ATLAS_DESCRIPTOR } from "../../../atlas/knock/descriptor.js";
import { KNOCK_ATLAS_REGISTRATION } from "../../../atlas/knock/registration.js";
import { KNOWBE4_ATLAS_DESCRIPTOR } from "../../../atlas/knowbe4/descriptor.js";
import { KNOWBE4_ATLAS_REGISTRATION } from "../../../atlas/knowbe4/registration.js";
import { LINEAR_ATLAS_DESCRIPTOR } from "../../../atlas/linear/descriptor.js";
import { LINEAR_ATLAS_REGISTRATION } from "../../../atlas/linear/registration.js";
import { MAKE_ATLAS_DESCRIPTOR } from "../../../atlas/make/descriptor.js";
import { MAKE_ATLAS_REGISTRATION } from "../../../atlas/make/registration.js";
import { MICROSOFT365_ATLAS_DESCRIPTOR } from "../../../atlas/microsoft365/descriptor.js";
import { MICROSOFT365_ATLAS_REGISTRATION } from "../../../atlas/microsoft365/registration.js";
import { NIGHTFALL_ATLAS_DESCRIPTOR } from "../../../atlas/nightfall/descriptor.js";
import { NIGHTFALL_ATLAS_REGISTRATION } from "../../../atlas/nightfall/registration.js";
import { NOTION_ATLAS_DESCRIPTOR } from "../../../atlas/notion/descriptor.js";
import { NOTION_ATLAS_REGISTRATION } from "../../../atlas/notion/registration.js";
import { NX_CLOUD_ATLAS_DESCRIPTOR } from "../../../atlas/nxCloud/descriptor.js";
import { NX_CLOUD_ATLAS_REGISTRATION } from "../../../atlas/nxCloud/registration.js";
import { ONEPASSWORD_ATLAS_DESCRIPTOR } from "../../../atlas/onepassword/descriptor.js";
import { ONEPASSWORD_ATLAS_REGISTRATION } from "../../../atlas/onepassword/registration.js";
import { PRISMA_DATA_PLATFORM_ATLAS_DESCRIPTOR } from "../../../atlas/prismaDataPlatform/descriptor.js";
import { PRISMA_DATA_PLATFORM_ATLAS_REGISTRATION } from "../../../atlas/prismaDataPlatform/registration.js";
import { atlasPlatforms, findAtlasPlatform } from "../../../atlas/registry.js";
import { SLACK_ATLAS_DESCRIPTOR } from "../../../atlas/slackApi/descriptor.js";
import { SLACK_ATLAS_REGISTRATION } from "../../../atlas/slackApi/registration.js";
import { TRELICA_ATLAS_DESCRIPTOR } from "../../../atlas/trelica/descriptor.js";
import { TRELICA_ATLAS_REGISTRATION } from "../../../atlas/trelica/registration.js";
import { TWILIO_ATLAS_DESCRIPTOR } from "../../../atlas/twilio/descriptor.js";
import { TWILIO_ATLAS_REGISTRATION } from "../../../atlas/twilio/registration.js";
import { VANTA_ATLAS_DESCRIPTOR } from "../../../atlas/vanta/descriptor.js";
import { VANTA_ATLAS_REGISTRATION } from "../../../atlas/vanta/registration.js";
import { WORKOS_ATLAS_DESCRIPTOR } from "../../../atlas/workos/descriptor.js";
import { WORKOS_ATLAS_REGISTRATION } from "../../../atlas/workos/registration.js";
import { XERO_ATLAS_DESCRIPTOR } from "../../../atlas/xero/descriptor.js";
import { XERO_ATLAS_REGISTRATION } from "../../../atlas/xero/registration.js";
import { unwrapErr } from "../../../lib/result.js";

/** The atlas source root. Enumerated from DISK, because a hand-kept list is what this gate exists to distrust. */
const ATLAS_ROOT = new URL("../../../atlas/", import.meta.url).pathname;

/** One atlas directory's two declared halves: what it IS, and the registry row that reaches it. */
interface KnownAtlas {
  readonly descriptor: AtlasDescriptor;
  readonly registration: AtlasPlatformRegistration;
}

/**
 * Every atlas this test KNOWS about, keyed by its directory.
 *
 * Hand-written on purpose, and checked against the directory listing below rather than trusted: a bundler
 * cannot resolve a fully-variable dynamic import, so the enumeration has to be static. What makes that safe
 * is that the disk scan fails when a directory declares a descriptor or a registration this map does not
 * name — so a NEW atlas cannot slip past by being forgotten here either.
 */
const KNOWN: Readonly<Record<string, KnownAtlas>> = {
  aether: { descriptor: AETHER_ATLAS_DESCRIPTOR, registration: AETHER_ATLAS_REGISTRATION },
  airtable: { descriptor: AIRTABLE_ATLAS_DESCRIPTOR, registration: AIRTABLE_ATLAS_REGISTRATION },
  braze: { descriptor: BRAZE_ATLAS_DESCRIPTOR, registration: BRAZE_ATLAS_REGISTRATION },
  canva: { descriptor: CANVA_ATLAS_DESCRIPTOR, registration: CANVA_ATLAS_REGISTRATION },
  clerk: { descriptor: CLERK_ATLAS_DESCRIPTOR, registration: CLERK_ATLAS_REGISTRATION },
  cloudflare: { descriptor: CLOUDFLARE_ATLAS_DESCRIPTOR, registration: CLOUDFLARE_ATLAS_REGISTRATION },
  crowdstrike: { descriptor: CROWDSTRIKE_ATLAS_DESCRIPTOR, registration: CROWDSTRIKE_ATLAS_REGISTRATION },
  datadog: { descriptor: DATADOG_ATLAS_DESCRIPTOR, registration: DATADOG_ATLAS_REGISTRATION },
  figma: { descriptor: FIGMA_ATLAS_DESCRIPTOR, registration: FIGMA_ATLAS_REGISTRATION },
  geminiAiStudio: { descriptor: GEMINI_AI_STUDIO_ATLAS_DESCRIPTOR, registration: GEMINI_AI_STUDIO_ATLAS_REGISTRATION },
  github: { descriptor: GITHUB_ATLAS_DESCRIPTOR, registration: GITHUB_ATLAS_REGISTRATION },
  googleAdmin: { descriptor: GOOGLE_ADMIN_ATLAS_DESCRIPTOR, registration: GOOGLE_ADMIN_ATLAS_REGISTRATION },
  googleSecops: { descriptor: GOOGLE_SECOPS_ATLAS_DESCRIPTOR, registration: GOOGLE_SECOPS_ATLAS_REGISTRATION },
  graphqlHive: { descriptor: HIVE_ATLAS_DESCRIPTOR, registration: GRAPHQL_HIVE_ATLAS_REGISTRATION },
  hex: { descriptor: HEX_ATLAS_DESCRIPTOR, registration: HEX_ATLAS_REGISTRATION },
  inngest: { descriptor: INNGEST_ATLAS_DESCRIPTOR, registration: INNGEST_ATLAS_REGISTRATION },
  jam: { descriptor: JAM_ATLAS_DESCRIPTOR, registration: JAM_ATLAS_REGISTRATION },
  jumpcloud: { descriptor: JUMPCLOUD_ATLAS_DESCRIPTOR, registration: JUMPCLOUD_ATLAS_REGISTRATION },
  knock: { descriptor: KNOCK_ATLAS_DESCRIPTOR, registration: KNOCK_ATLAS_REGISTRATION },
  knowbe4: { descriptor: KNOWBE4_ATLAS_DESCRIPTOR, registration: KNOWBE4_ATLAS_REGISTRATION },
  linear: { descriptor: LINEAR_ATLAS_DESCRIPTOR, registration: LINEAR_ATLAS_REGISTRATION },
  make: { descriptor: MAKE_ATLAS_DESCRIPTOR, registration: MAKE_ATLAS_REGISTRATION },
  microsoft365: { descriptor: MICROSOFT365_ATLAS_DESCRIPTOR, registration: MICROSOFT365_ATLAS_REGISTRATION },
  nightfall: { descriptor: NIGHTFALL_ATLAS_DESCRIPTOR, registration: NIGHTFALL_ATLAS_REGISTRATION },
  notion: { descriptor: NOTION_ATLAS_DESCRIPTOR, registration: NOTION_ATLAS_REGISTRATION },
  nxCloud: { descriptor: NX_CLOUD_ATLAS_DESCRIPTOR, registration: NX_CLOUD_ATLAS_REGISTRATION },
  onepassword: { descriptor: ONEPASSWORD_ATLAS_DESCRIPTOR, registration: ONEPASSWORD_ATLAS_REGISTRATION },
  prismaDataPlatform: {
    descriptor: PRISMA_DATA_PLATFORM_ATLAS_DESCRIPTOR,
    registration: PRISMA_DATA_PLATFORM_ATLAS_REGISTRATION,
  },
  slackApi: { descriptor: SLACK_ATLAS_DESCRIPTOR, registration: SLACK_ATLAS_REGISTRATION },
  trelica: { descriptor: TRELICA_ATLAS_DESCRIPTOR, registration: TRELICA_ATLAS_REGISTRATION },
  twilio: { descriptor: TWILIO_ATLAS_DESCRIPTOR, registration: TWILIO_ATLAS_REGISTRATION },
  vanta: { descriptor: VANTA_ATLAS_DESCRIPTOR, registration: VANTA_ATLAS_REGISTRATION },
  workos: { descriptor: WORKOS_ATLAS_DESCRIPTOR, registration: WORKOS_ATLAS_REGISTRATION },
  xero: { descriptor: XERO_ATLAS_DESCRIPTOR, registration: XERO_ATLAS_REGISTRATION },
};

/**
 * Every directory under `src/atlas/` that declares a given file — one per atlas this build ships.
 *
 * `kit/` is the shared machinery, not an atlas: its `registration.ts` declares the row TYPE, never a row.
 */
function atlasDirectoriesDeclaring({ file }: { file: string }): readonly string[] {
  return readdirSync(ATLAS_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== "kit")
    .map((entry) => entry.name)
    .filter((name) => existsSync(join(ATLAS_ROOT, name, file)))
    .toSorted();
}

describe("the registry covers every atlas this build ships", () => {
  // 1Password shipped a complete atlas — descriptor, store, model, coverage, sync — publishing a full
  // generation of entities, with no registry row. So it synced, published, and was unreachable through the read verb while
  // every test passed, because nothing compared the atlases that EXIST against the ones a reader can reach.
  // That comparison is this file's whole job; the fix without it only moves the next omission along.
  it("registers a platform for every descriptor on disk", () => {
    const declared = Object.values(KNOWN)
      .map((known) => known.descriptor.platform)
      .toSorted();

    expect(declared).toEqual([...atlasPlatforms()].toSorted());
  });

  // The directory name is NOT the platform — `slackApi/` declares `slack` — so this asserts the map is
  // complete against disk, and the test above asserts the platforms it names are all reachable.
  it("names every atlas directory that declares a descriptor", () => {
    expect(Object.keys(KNOWN).toSorted()).toEqual([...atlasDirectoriesDeclaring({ file: "descriptor.ts" })]);
  });

  it("names every atlas directory that declares a registration", () => {
    expect(Object.keys(KNOWN).toSorted()).toEqual([...atlasDirectoriesDeclaring({ file: "registration.ts" })]);
  });

  it("resolves every registered platform to a real registration", () => {
    const unresolved = atlasPlatforms().filter((platform) => findAtlasPlatform({ platform }) === null);

    expect(unresolved).toEqual([]);
  });
});

// Every descriptor is typed `AtlasDescriptor`, so a registration whose thunk loads ANOTHER directory's
// descriptor type-checks and, before this block, passed every test: `kit/backlog.test.ts` calls each thunk
// but only aggregates what comes back. Freshness windows, resync commands and the backlog all read a
// descriptor through this thunk, so a crossed wire would quietly judge one platform by another's contract.
describe("each directory's registration is the row the registry reaches it by", () => {
  const rows = Object.entries(KNOWN);

  it("has rows to check", () => {
    expect(rows.length).toBeGreaterThan(0);
  });

  it.each(rows)("%s's thunk resolves to its own directory's descriptor", async (_dir, known) => {
    expect(await known.registration.readDescriptor()).toBe(known.descriptor);
    expect(known.descriptor.platform).toBe(known.registration.platform);
  });

  it.each(rows)("%s's module row is the one the registry serves", (_dir, known) => {
    const served = findAtlasPlatform({ platform: known.registration.platform })!;
    expect(served.readDescriptor).toBe(known.registration.readDescriptor);
    expect(served.verbs).toBe(known.registration.verbs);
    expect(served.catalogue).toBe(known.registration.catalogue);
  });
});

// Every reset shares one signature, so a `readReset` thunk that loads ANOTHER platform's whole reset
// type-checks; the compiler catches only a mismatched store spec and paths inside one reset. Running it over
// an EMPTY home is a pure witness: the refusal names the platform of the store spec it bound, and nothing is
// written.
describe("a declared reset archives its own platform's generation", () => {
  const homes: string[] = [];

  afterEach(() => {
    homes.splice(0).forEach((home) => {
      rmSync(home, { force: true, recursive: true });
    });
  });

  const withReset = Object.values(KNOWN)
    .map((known) => known.registration)
    .filter((registration) => registration.readReset !== undefined);

  it("is declared on exactly the rows that answer reset through the atlas noun's kit verb", () => {
    expect(withReset.map((registration) => registration.platform)).toEqual([
      "github",
      "google-secops",
      "jam",
      "knock",
      "knowbe4",
      "make",
      "slack",
    ]);
  });

  it.each(withReset.map((registration) => [registration.platform, registration] as const))(
    "%s refuses an empty home by its own name",
    async (platform, registration) => {
      const home = mkdtempSync(join(tmpdir(), "atlas-reset-"));
      homes.push(home);
      const reset = await registration.readReset!();

      const outcome = reset({ at: "2026-09-30T00:00:00.000Z", home });

      expect(outcome.isErr()).toBe(true);
      expect(unwrapErr(outcome).join("\n")).toContain(`no current ${platform} atlas at ${home}`);
    },
  );
});
