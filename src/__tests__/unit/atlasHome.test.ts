/**
 * Every atlas's generation paths under `$home/atlas`: the platform set, the four standard paths each one gets,
 * the hand-written and computed kind maps, and the resolvers delegated to sibling modules.
 */
import { describe, expect, it } from "vitest";

import { AETHER_KINDS } from "../../atlas/aether/model.js";
import { BRAZE_KINDS } from "../../atlas/braze/model.js";
import { CANVA_ATLAS_KINDS } from "../../atlas/canva/model.js";
import { CLOUDFLARE_KINDS } from "../../atlas/cloudflare/model.js";
import { DATADOG_KINDS } from "../../atlas/datadog/model.js";
import { GEMINI_AI_STUDIO_KINDS } from "../../atlas/geminiAiStudio/model.js";
import { JAM_ATLAS_KINDS } from "../../atlas/jam/model.js";
import { KNOCK_ATLAS_KINDS } from "../../atlas/knock/kinds.js";
import { MICROSOFT365_KINDS } from "../../atlas/microsoft365/model.js";
import { NIGHTFALL_ATLAS_KINDS } from "../../atlas/nightfall/model.js";
import { atlasHomePaths } from "../../atlasHome.js";
import { googleAdminAtlasHomePaths, googleSecopsAtlasHomePaths } from "../../atlasHomeGoogle.js";
import { inngestAtlasHomePaths } from "../../atlasHomeInngest.js";
import { jumpcloudAtlasPaths } from "../../atlasHomeJumpcloud.js";
import { knockAtlasHomePaths } from "../../atlasHomeKnock.js";
import { knowbe4AtlasHomePaths } from "../../atlasHomeKnowbe4.js";
import { makeAtlasHomePaths } from "../../atlasHomeMake.js";

const ATLAS_ROOT = "/state/home/atlas";

describe("atlasHomePaths", () => {
  it("resolves every platform and the root, so a platform cannot silently disappear", () => {
    expect(Object.keys(atlasHomePaths({ atlasRoot: ATLAS_ROOT })).toSorted()).toEqual([
      "aether",
      "airtable",
      "braze",
      "canva",
      "clerk",
      "cloudflare",
      "crowdstrike",
      "datadog",
      "figma",
      "geminiAiStudio",
      "github",
      "googleAdmin",
      "googleSecops",
      "graphqlHive",
      "hex",
      "inngest",
      "jam",
      "jumpcloud",
      "knock",
      "knowbe4",
      "linear",
      "make",
      "microsoft365",
      "nightfall",
      "notion",
      "nxCloud",
      "onepassword",
      "prismaDataPlatform",
      "root",
      "slack",
      "trelica",
      "twilio",
      "vanta",
      "workos",
      "xero",
    ]);
  });

  it("returns the atlas root unchanged", () => {
    expect(atlasHomePaths({ atlasRoot: ATLAS_ROOT }).root).toBe("/state/home/atlas");
  });

  it("lays one hand-written platform out whole: manifest, sensitive, superseded and each kind file", () => {
    expect(atlasHomePaths({ atlasRoot: ATLAS_ROOT }).linear).toEqual({
      kinds: {
        operation: "/state/home/atlas/linear/operations.jsonl",
        page: "/state/home/atlas/linear/pages.jsonl",
        setting: "/state/home/atlas/linear/settings.jsonl",
        type: "/state/home/atlas/linear/types.jsonl",
      },
      manifest: "/state/home/atlas/linear/manifest.json",
      root: "/state/home/atlas/linear",
      sensitive: "/state/home/atlas/linear/_sensitive",
      superseded: "/state/home/atlas/_superseded/linear",
    });
  });

  it("names a directory by the catalogue's platform word rather than the camel-case key", () => {
    const paths = atlasHomePaths({ atlasRoot: ATLAS_ROOT });
    expect([
      paths.nxCloud.root,
      paths.geminiAiStudio.root,
      paths.graphqlHive.root,
      paths.prismaDataPlatform.root,
    ]).toEqual([
      "/state/home/atlas/nx-cloud",
      "/state/home/atlas/gemini-ai-studio",
      "/state/home/atlas/graphql-hive",
      "/state/home/atlas/prisma-data-platform",
    ]);
  });

  it("writes the .jsonl extension whether a platform declared .json (figma) or none at all (nx-cloud)", () => {
    const paths = atlasHomePaths({ atlasRoot: ATLAS_ROOT });
    expect([paths.figma.kinds["file"], paths.nxCloud.kinds["endpoint"]]).toEqual([
      "/state/home/atlas/figma/files.jsonl",
      "/state/home/atlas/nx-cloud/endpoints.jsonl",
    ]);
  });

  it("delegates Inngest, both Google atlases, JumpCloud, Knock, KnowBe4 and Make to their own resolvers", () => {
    const paths = atlasHomePaths({ atlasRoot: ATLAS_ROOT });
    expect(paths.make).toEqual(makeAtlasHomePaths({ atlasRoot: ATLAS_ROOT }));
    expect(paths.inngest).toEqual(inngestAtlasHomePaths({ atlasRoot: ATLAS_ROOT }));
    expect(paths.googleAdmin).toEqual(googleAdminAtlasHomePaths({ atlasRoot: ATLAS_ROOT }));
    expect(paths.googleSecops).toEqual(googleSecopsAtlasHomePaths({ atlasRoot: ATLAS_ROOT }));
    expect(paths.jumpcloud).toEqual(jumpcloudAtlasPaths({ atlasRoot: ATLAS_ROOT }));
    expect(paths.knock).toEqual(knockAtlasHomePaths({ atlasRoot: ATLAS_ROOT }));
    expect(paths.knowbe4).toEqual(knowbe4AtlasHomePaths({ atlasRoot: ATLAS_ROOT }));
  });

  it("lays the KnowBe4 atlas out one kind file per Reporting API family", () => {
    const paths = atlasHomePaths({ atlasRoot: ATLAS_ROOT }).knowbe4;
    expect([paths.root, paths.manifest, paths.kinds["group-member"], paths.kinds["training-enrollment"]]).toEqual([
      "/state/home/atlas/knowbe4",
      "/state/home/atlas/knowbe4/manifest.json",
      "/state/home/atlas/knowbe4/group-members.jsonl",
      "/state/home/atlas/knowbe4/training-enrollments.jsonl",
    ]);
  });

  it("computes the kind map of every list-driven atlas from its model's kind list, in order", () => {
    const paths = atlasHomePaths({ atlasRoot: ATLAS_ROOT });
    expect(Object.keys(paths.cloudflare.kinds)).toEqual([...CLOUDFLARE_KINDS]);
    expect(Object.keys(paths.datadog.kinds)).toEqual([...DATADOG_KINDS]);
    expect(Object.keys(paths.canva.kinds)).toEqual([...CANVA_ATLAS_KINDS]);
    expect(Object.keys(paths.geminiAiStudio.kinds)).toEqual([...GEMINI_AI_STUDIO_KINDS]);
    expect(Object.keys(paths.knock.kinds)).toEqual([...KNOCK_ATLAS_KINDS]);
    expect(Object.keys(paths.microsoft365.kinds)).toEqual([...MICROSOFT365_KINDS]);
    expect(Object.keys(paths.braze.kinds)).toEqual([...BRAZE_KINDS]);
    expect(Object.keys(paths.nightfall.kinds)).toEqual([...NIGHTFALL_ATLAS_KINDS]);
    expect(Object.keys(paths.jam.kinds)).toEqual([...JAM_ATLAS_KINDS]);
    expect(Object.keys(paths.aether.kinds)).toEqual([...AETHER_KINDS]);
  });

  it("names a computed kind file after the kind itself, at both ends of the Datadog list", () => {
    const { kinds } = atlasHomePaths({ atlasRoot: ATLAS_ROOT }).datadog;
    const first = DATADOG_KINDS[0];
    const last = DATADOG_KINDS.at(-1)!;
    expect([kinds[first], kinds[last]]).toEqual([
      `/state/home/atlas/datadog/${first}.jsonl`,
      `/state/home/atlas/datadog/${last}.jsonl`,
    ]);
  });

  it("pluralises the Jam and Aether kind files with a trailing s", () => {
    const paths = atlasHomePaths({ atlasRoot: ATLAS_ROOT });
    expect([paths.jam.kinds["integration"], paths.aether.kinds["finding"]]).toEqual([
      "/state/home/atlas/jam/integrations.jsonl",
      "/state/home/atlas/aether/findings.jsonl",
    ]);
  });
});
