import { describe, expect, it } from "vitest";

import { atlasRegistrations } from "../../../atlas/registry.js";
import { AIRTABLE_RESET_USAGE } from "../../../cli/commands/airtableAtlas/resetRun.js";
import { AIRTABLE_SYNC_USAGE } from "../../../cli/commands/airtableAtlas/syncRun.js";
import { CANVA_RESET_USAGE } from "../../../cli/commands/atlas/canva/resetRun.js";
import { CANVA_SYNC_USAGE } from "../../../cli/commands/atlas/canva/syncRun.js";
import { GOOGLE_ADMIN_FILL_USAGE } from "../../../cli/commands/atlas/googleAdmin/fillRun.js";
import { GOOGLE_ADMIN_RESET_USAGE } from "../../../cli/commands/atlas/googleAdmin/resetRun.js";
import { GOOGLE_ADMIN_SYNC_USAGE } from "../../../cli/commands/atlas/googleAdmin/syncRun.js";
import { GOOGLE_ADMIN_WALK_USAGE } from "../../../cli/commands/atlas/googleAdmin/walkRun.js";
import { GOOGLE_SECOPS_FILL_USAGE } from "../../../cli/commands/atlas/googleSecops/fillRun.js";
import { JUMPCLOUD_RESET_USAGE } from "../../../cli/commands/atlas/jumpcloud/resetRun.js";
import { JUMPCLOUD_SYNC_USAGE } from "../../../cli/commands/atlas/jumpcloud/syncRun.js";
import { JUMPCLOUD_WALK_USAGE } from "../../../cli/commands/atlas/jumpcloud/walkRun.js";
import { KNOWBE4_SYNC_USAGE } from "../../../cli/commands/atlas/knowbe4/syncRun.js";
import { LINEAR_VERB_USAGE } from "../../../cli/commands/atlas/linearCore.js";
import { MAKE_FILL_USAGE } from "../../../cli/commands/atlas/make/fillRun.js";
import { NIGHTFALL_RESET_USAGE } from "../../../cli/commands/atlas/nightfall/resetRun.js";
import { NIGHTFALL_SYNC_USAGE } from "../../../cli/commands/atlas/nightfall/syncRun.js";
import { atlasResetUsage } from "../../../cli/commands/atlas/resetRunCore.js";
import { BRAZE_REPORT_USAGE } from "../../../cli/commands/brazeAtlas/reportRun.js";
import { BRAZE_RESET_USAGE } from "../../../cli/commands/brazeAtlas/resetRun.js";
import { BRAZE_SYNC_USAGE } from "../../../cli/commands/brazeAtlas/syncRun.js";
import { CLERK_REFRESH_USAGE } from "../../../cli/commands/clerkAtlas/refreshRun.js";
import { CLERK_REPORT_USAGE } from "../../../cli/commands/clerkAtlas/reportRun.js";
import { CLERK_RESET_USAGE } from "../../../cli/commands/clerkAtlas/resetRun.js";
import { CLERK_SYNC_USAGE } from "../../../cli/commands/clerkAtlas/syncRun.js";
import { CLERK_WALK_USAGE } from "../../../cli/commands/clerkAtlas/walkRun.js";
import { DATADOG_RESET_USAGE } from "../../../cli/commands/datadogAtlas/resetRun.js";
import { DATADOG_SYNC_USAGE } from "../../../cli/commands/datadogAtlas/syncRun.js";
import { DATADOG_WALK_USAGE } from "../../../cli/commands/datadogAtlas/walkRun.js";
import { FIGMA_RESET_USAGE } from "../../../cli/commands/figmaAtlas/resetRun.js";
import { FIGMA_SYNC_USAGE } from "../../../cli/commands/figmaAtlas/syncRun.js";
import { GEMINI_AI_STUDIO_RESET_USAGE } from "../../../cli/commands/geminiAiStudioAtlas/resetRun.js";
import { GEMINI_AI_STUDIO_SYNC_USAGE } from "../../../cli/commands/geminiAiStudioAtlas/syncRun.js";
import { HIVE_REFRESH_USAGE } from "../../../cli/commands/graphqlHiveAtlas/refreshRun.js";
import { HIVE_REPORT_USAGE } from "../../../cli/commands/graphqlHiveAtlas/reportRun.js";
import { HIVE_RESET_USAGE } from "../../../cli/commands/graphqlHiveAtlas/resetRun.js";
import { HIVE_SYNC_USAGE } from "../../../cli/commands/graphqlHiveAtlas/syncRun.js";
import { HIVE_WALK_USAGE } from "../../../cli/commands/graphqlHiveAtlas/walkRun.js";
import { HEX_REFRESH_USAGE } from "../../../cli/commands/hexAtlas/refreshRun.js";
import { HEX_REPORT_USAGE } from "../../../cli/commands/hexAtlas/reportRun.js";
import { HEX_RESET_USAGE } from "../../../cli/commands/hexAtlas/resetRun.js";
import { HEX_SYNC_USAGE } from "../../../cli/commands/hexAtlas/syncRun.js";
import { HEX_WALK_USAGE } from "../../../cli/commands/hexAtlas/walkRun.js";
import { INNGEST_RESET_USAGE } from "../../../cli/commands/inngestAtlas/resetRun.js";
import { INNGEST_SYNC_USAGE } from "../../../cli/commands/inngestAtlas/syncRun.js";
import { INNGEST_WALK_USAGE } from "../../../cli/commands/inngestAtlas/walkRun.js";
import { JAM_REFRESH_USAGE } from "../../../cli/commands/jamAtlas/refreshRun.js";
import { JAM_REPORT_USAGE } from "../../../cli/commands/jamAtlas/reportRun.js";
import { JAM_SYNC_USAGE } from "../../../cli/commands/jamAtlas/syncRun.js";
import { JAM_WALK_USAGE } from "../../../cli/commands/jamAtlas/walkRun.js";
import { KNOCK_REPORT_USAGE } from "../../../cli/commands/knockAtlas/reportRun.js";
import { KNOCK_SYNC_USAGE } from "../../../cli/commands/knockAtlas/syncRun.js";
import { KNOCK_WALK_USAGE } from "../../../cli/commands/knockAtlas/walkRun.js";
import { MICROSOFT365_RESET_USAGE } from "../../../cli/commands/microsoft365Atlas/resetRun.js";
import { MICROSOFT365_SYNC_USAGE } from "../../../cli/commands/microsoft365Atlas/syncRun.js";
import { NOTION_REFRESH_USAGE } from "../../../cli/commands/notionAtlas/refreshRun.js";
import { NOTION_REPORT_USAGE } from "../../../cli/commands/notionAtlas/reportRun.js";
import { NOTION_RESET_USAGE } from "../../../cli/commands/notionAtlas/resetRun.js";
import { NOTION_SYNC_USAGE } from "../../../cli/commands/notionAtlas/syncRun.js";
import { NOTION_WALK_USAGE } from "../../../cli/commands/notionAtlas/walkRun.js";
import { NX_CLOUD_REFRESH_USAGE } from "../../../cli/commands/nxCloudAtlas/refreshRun.js";
import { NX_CLOUD_REPORT_USAGE } from "../../../cli/commands/nxCloudAtlas/reportRun.js";
import { NX_CLOUD_RESET_USAGE } from "../../../cli/commands/nxCloudAtlas/resetRun.js";
import { NX_CLOUD_SYNC_USAGE } from "../../../cli/commands/nxCloudAtlas/syncRun.js";
import { NX_CLOUD_WALK_USAGE } from "../../../cli/commands/nxCloudAtlas/walkRun.js";
import { PRISMA_DATA_PLATFORM_RESET_USAGE } from "../../../cli/commands/prismaDataPlatformAtlas/resetRun.js";
import { PRISMA_DATA_PLATFORM_SYNC_USAGE } from "../../../cli/commands/prismaDataPlatformAtlas/syncRun.js";
import {
  TRELICA_REFRESH_USAGE,
  TRELICA_REPORT_USAGE,
  TRELICA_RESET_USAGE,
  TRELICA_SYNC_USAGE,
  TRELICA_WALK_USAGE,
} from "../../../cli/commands/trelicaAtlas/core.js";
import { TWILIO_REPORT_USAGE } from "../../../cli/commands/twilioAtlas/reportRun.js";
import { TWILIO_RESET_USAGE } from "../../../cli/commands/twilioAtlas/resetRun.js";
import { TWILIO_SYNC_USAGE } from "../../../cli/commands/twilioAtlas/syncRun.js";
import { TWILIO_WALK_USAGE } from "../../../cli/commands/twilioAtlas/walkRun.js";
import { VANTA_CHANGES_USAGE } from "../../../cli/commands/vanta/changesRun.js";
import { VANTA_CONTROL_EVIDENCE_USAGE } from "../../../cli/commands/vanta/controlEvidenceRun.js";
import { VANTA_CONTROLS_EVIDENCE_USAGE } from "../../../cli/commands/vanta/controlsEvidenceRun.js";
import { VANTA_POLICY_VERSIONS_USAGE } from "../../../cli/commands/vanta/policyVersionRun.js";
import { VANTA_RESET_USAGE } from "../../../cli/commands/vanta/resetRun.js";
import { VANTA_SYNC_USAGE } from "../../../cli/commands/vanta/syncRun.js";
import { VANTA_TEST_ENTITIES_USAGE } from "../../../cli/commands/vanta/testEntitiesRun.js";
import { VANTA_VULNERABILITIES_USAGE } from "../../../cli/commands/vanta/vulnerabilitiesRun.js";
import { VANTA_WALK_USAGE } from "../../../cli/commands/vanta/walkRun.js";
import { WORKOS_REFRESH_USAGE } from "../../../cli/commands/workosAtlas/refreshRun.js";
import { WORKOS_REPORT_USAGE } from "../../../cli/commands/workosAtlas/reportRun.js";
import { WORKOS_RESET_USAGE } from "../../../cli/commands/workosAtlas/resetRun.js";
import { WORKOS_SYNC_USAGE } from "../../../cli/commands/workosAtlas/syncRun.js";
import { WORKOS_WALK_USAGE } from "../../../cli/commands/workosAtlas/walkRun.js";
import { XERO_FAMILIES_USAGE } from "../../../cli/commands/xeroAtlas/familiesRun.js";
import { XERO_REFRESH_USAGE } from "../../../cli/commands/xeroAtlas/refreshRun.js";
import { XERO_REPORT_USAGE } from "../../../cli/commands/xeroAtlas/reportRun.js";
import { XERO_RESET_USAGE } from "../../../cli/commands/xeroAtlas/resetRun.js";
import { XERO_SYNC_USAGE } from "../../../cli/commands/xeroAtlas/syncRun.js";
import { XERO_WALK_USAGE } from "../../../cli/commands/xeroAtlas/walkRun.js";
import { atlasManifest } from "../../../cli/manifests/atlas.js";

/**
 * Each own verb's OWN usage constant — what the verb prints on `--help` and parses against — beside the
 * platform and verb its registration files it under. The manifest row is built from the registration, so this
 * is the one place the two sources of a verb's flags are held against each other: a flag the verb parses that
 * its row never advertised, or a row line the verb no longer accepts, fails here by name.
 *
 * A verb absent from this table exports no usage constant (GitHub and
 * `google-admin connect` print theirs inline); the registry suite still proves each of those loads.
 */
const VERB_USAGE: readonly (readonly [platform: string, verb: string, usage: string])[] = [
  ["airtable", "sync", AIRTABLE_SYNC_USAGE],
  ["airtable", "reset", AIRTABLE_RESET_USAGE],
  ["braze", "sync", BRAZE_SYNC_USAGE],
  ["braze", "report", BRAZE_REPORT_USAGE],
  ["braze", "reset", BRAZE_RESET_USAGE],
  ["canva", "sync", CANVA_SYNC_USAGE],
  ["canva", "reset", CANVA_RESET_USAGE],
  ["clerk", "sync", CLERK_SYNC_USAGE],
  ["clerk", "walk", CLERK_WALK_USAGE],
  ["clerk", "refresh", CLERK_REFRESH_USAGE],
  ["clerk", "report", CLERK_REPORT_USAGE],
  ["clerk", "reset", CLERK_RESET_USAGE],
  ["datadog", "sync", DATADOG_SYNC_USAGE],
  ["datadog", "walk", DATADOG_WALK_USAGE],
  ["datadog", "reset", DATADOG_RESET_USAGE],
  ["figma", "sync", FIGMA_SYNC_USAGE],
  ["figma", "reset", FIGMA_RESET_USAGE],
  ["gemini-ai-studio", "sync", GEMINI_AI_STUDIO_SYNC_USAGE],
  ["gemini-ai-studio", "reset", GEMINI_AI_STUDIO_RESET_USAGE],
  ["google-admin", "sync", GOOGLE_ADMIN_SYNC_USAGE],
  ["google-admin", "fill", GOOGLE_ADMIN_FILL_USAGE],
  ["google-admin", "walk", GOOGLE_ADMIN_WALK_USAGE],
  ["google-admin", "reset", GOOGLE_ADMIN_RESET_USAGE],
  ["google-secops", "fill", GOOGLE_SECOPS_FILL_USAGE],
  ["graphql-hive", "sync", HIVE_SYNC_USAGE],
  ["graphql-hive", "walk", HIVE_WALK_USAGE],
  ["graphql-hive", "refresh", HIVE_REFRESH_USAGE],
  ["graphql-hive", "report", HIVE_REPORT_USAGE],
  ["graphql-hive", "reset", HIVE_RESET_USAGE],
  ["hex", "sync", HEX_SYNC_USAGE],
  ["hex", "walk", HEX_WALK_USAGE],
  ["hex", "refresh", HEX_REFRESH_USAGE],
  ["hex", "report", HEX_REPORT_USAGE],
  ["hex", "reset", HEX_RESET_USAGE],
  ["inngest", "sync", INNGEST_SYNC_USAGE],
  ["inngest", "walk", INNGEST_WALK_USAGE],
  ["inngest", "reset", INNGEST_RESET_USAGE],
  ["jam", "sync", JAM_SYNC_USAGE],
  ["jam", "walk", JAM_WALK_USAGE],
  ["jam", "refresh", JAM_REFRESH_USAGE],
  ["jam", "report", JAM_REPORT_USAGE],
  ["jumpcloud", "sync", JUMPCLOUD_SYNC_USAGE],
  ["jumpcloud", "walk", JUMPCLOUD_WALK_USAGE],
  ["jumpcloud", "reset", JUMPCLOUD_RESET_USAGE],
  ["linear", "sync", LINEAR_VERB_USAGE.sync],
  ["linear", "walk", LINEAR_VERB_USAGE.walk],
  ["linear", "report", LINEAR_VERB_USAGE.report],
  ["linear", "reset", LINEAR_VERB_USAGE.reset],
  ["knock", "sync", KNOCK_SYNC_USAGE],
  ["knock", "walk", KNOCK_WALK_USAGE],
  ["knock", "report", KNOCK_REPORT_USAGE],
  ["knowbe4", "sync", KNOWBE4_SYNC_USAGE],
  ["make", "fill", MAKE_FILL_USAGE],
  ["microsoft365", "sync", MICROSOFT365_SYNC_USAGE],
  ["microsoft365", "reset", MICROSOFT365_RESET_USAGE],
  ["nightfall", "sync", NIGHTFALL_SYNC_USAGE],
  ["nightfall", "reset", NIGHTFALL_RESET_USAGE],
  ["notion", "sync", NOTION_SYNC_USAGE],
  ["notion", "walk", NOTION_WALK_USAGE],
  ["notion", "refresh", NOTION_REFRESH_USAGE],
  ["notion", "report", NOTION_REPORT_USAGE],
  ["notion", "reset", NOTION_RESET_USAGE],
  ["nx-cloud", "sync", NX_CLOUD_SYNC_USAGE],
  ["nx-cloud", "walk", NX_CLOUD_WALK_USAGE],
  ["nx-cloud", "refresh", NX_CLOUD_REFRESH_USAGE],
  ["nx-cloud", "report", NX_CLOUD_REPORT_USAGE],
  ["nx-cloud", "reset", NX_CLOUD_RESET_USAGE],
  ["prisma-data-platform", "sync", PRISMA_DATA_PLATFORM_SYNC_USAGE],
  ["prisma-data-platform", "reset", PRISMA_DATA_PLATFORM_RESET_USAGE],
  ["twilio", "sync", TWILIO_SYNC_USAGE],
  ["twilio", "walk", TWILIO_WALK_USAGE],
  ["twilio", "report", TWILIO_REPORT_USAGE],
  ["twilio", "reset", TWILIO_RESET_USAGE],
  ["vanta", "sync", VANTA_SYNC_USAGE],
  ["vanta", "changes", VANTA_CHANGES_USAGE],
  ["vanta", "reset", VANTA_RESET_USAGE],
  ["vanta", "vulnerabilities", VANTA_VULNERABILITIES_USAGE],
  ["vanta", "test-entities", VANTA_TEST_ENTITIES_USAGE],
  ["vanta", "controls-evidence", VANTA_CONTROLS_EVIDENCE_USAGE],
  ["vanta", "control-evidence", VANTA_CONTROL_EVIDENCE_USAGE],
  ["vanta", "walk", VANTA_WALK_USAGE],
  ["vanta", "policy-versions", VANTA_POLICY_VERSIONS_USAGE],
  ["workos", "sync", WORKOS_SYNC_USAGE],
  ["workos", "walk", WORKOS_WALK_USAGE],
  ["workos", "refresh", WORKOS_REFRESH_USAGE],
  ["workos", "report", WORKOS_REPORT_USAGE],
  ["workos", "reset", WORKOS_RESET_USAGE],
  ["xero", "sync", XERO_SYNC_USAGE],
  ["xero", "walk", XERO_WALK_USAGE],
  ["xero", "refresh", XERO_REFRESH_USAGE],
  ["xero", "report", XERO_REPORT_USAGE],
  ["xero", "families", XERO_FAMILIES_USAGE],
  ["xero", "reset", XERO_RESET_USAGE],
  ["trelica", "sync", TRELICA_SYNC_USAGE],
  ["trelica", "walk", TRELICA_WALK_USAGE],
  ["trelica", "refresh", TRELICA_REFRESH_USAGE],
  ["trelica", "report", TRELICA_REPORT_USAGE],
  ["trelica", "reset", TRELICA_RESET_USAGE],
];

describe("each own verb's usage constant agrees with the manifest row built from its registration", () => {
  it.each(VERB_USAGE)("%s %s", (platform, verb, usage) => {
    const prefix = `usage: slopweaver atlas ${platform} ${verb}`;
    expect(usage.startsWith(prefix)).toBe(true);
    const firstLine = usage.split("\n")[0]!.slice("usage: slopweaver atlas ".length + platform.length + 1);
    expect(atlasManifest[platform]!.meta.usage).toContain(`\n  ${firstLine}`);
  });
});

describe("a platform whose registration declares a reset advertises the derived usage line", () => {
  const withReset = atlasRegistrations().filter((row) => row.readReset !== undefined);

  it("at least one platform declares one", () => {
    expect(withReset.length).toBeGreaterThan(0);
  });

  it.each(withReset.map((row) => [row.platform] as const))("%s", (platform) => {
    const firstLine = atlasResetUsage({ platform }).slice("usage: slopweaver atlas ".length + platform.length + 1);
    expect(firstLine).toBe("reset --confirm archive [--json] [--home <dir>]");
    expect(atlasManifest[platform]!.meta.usage).toContain(`\n  ${firstLine}`);
  });

  it("a reset line in a row has exactly one source: the kit's, or the platform's own verb row", () => {
    const without = atlasRegistrations().filter((row) => row.readReset === undefined);
    expect(without.length).toBeGreaterThan(0);
    const unsourced = without
      .filter((row) => atlasManifest[row.platform]!.meta.usage.includes("\n  reset --confirm archive"))
      .filter((row) => !row.verbs.some((verb) => verb.verb === "reset"))
      .map((row) => row.platform);
    expect(unsourced).toEqual([]);
  });
});
