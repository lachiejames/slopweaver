/**
 * Every integration this build reaches, once — the list every other integration list is derived from.
 *
 * Each row is a `src/integrations/<id>/integration.ts` manifest (`./manifest.ts` is the shape). A list that has to
 * name every integration, or every integration with one feature, is computed from this rather than kept beside
 * it, so a new integration is its manifest plus one line below. Today that is the atlas list
 * (`src/atlas/registry.ts`), the atlas names (`src/automations/purposeNames.ts`), and the corpus source lists and
 * the `content_source` enum (`./corpusSources.ts`). Lists whose rows carry content
 * a manifest does not hold (credential rows, routing capability rows, browser write policy, rate limits) stay where
 * they live, kept by hand.
 *
 * ## Why this is cheap to import
 *
 * A manifest is strings, its atlas's registration and `import()` thunks — `./manifest.ts` says why and
 * `unit/integrations/manifestLaziness.test.ts` holds it. Importing this file loads forty small object literals and
 * the atlas registrations `src/atlas/registry.ts` already loaded on every invocation, and nothing else.
 *
 * ## Order
 *
 * Alphabetical by id, so the atlas subset reproduces `src/atlas/registry.ts`'s catalogue order exactly (that list
 * is alphabetical by platform name, and an atlas's id IS its platform name). A consumer whose output order differs
 * from this keeps its own order explicitly; `unit/integrations/registry.test.ts` pins this one.
 */
import type { AtlasPlatformRegistration } from "../atlas/kit/registration.js";

import { AETHER_INTEGRATION } from "./aether/integration.js";
import { AIRTABLE_INTEGRATION } from "./airtable/integration.js";
import { BRAZE_INTEGRATION } from "./braze/integration.js";
import { CALENDAR_INTEGRATION } from "./calendar/integration.js";
import { CANVA_INTEGRATION } from "./canva/integration.js";
import { CHATGPT_INTEGRATION } from "./chatgpt/integration.js";
import { CLERK_INTEGRATION } from "./clerk/integration.js";
import { CLOUDFLARE_INTEGRATION } from "./cloudflare/integration.js";
import { CROWDSTRIKE_INTEGRATION } from "./crowdstrike/integration.js";
import { DATADOG_INTEGRATION } from "./datadog/integration.js";
import { DRIVE_INTEGRATION } from "./drive/integration.js";
import { FATHOM_INTEGRATION } from "./fathom/integration.js";
import { FIGMA_INTEGRATION } from "./figma/integration.js";
import { GEMINI_AI_STUDIO_INTEGRATION } from "./gemini-ai-studio/integration.js";
import { GITHUB_INTEGRATION } from "./github/integration.js";
import { GMAIL_INTEGRATION } from "./gmail/integration.js";
import { GOOGLE_ADMIN_INTEGRATION } from "./google-admin/integration.js";
import { GOOGLE_SECOPS_INTEGRATION } from "./google-secops/integration.js";
import { GRAPHQL_HIVE_INTEGRATION } from "./graphql-hive/integration.js";
import { HEX_INTEGRATION } from "./hex/integration.js";
import { INNGEST_INTEGRATION } from "./inngest/integration.js";
import { JAM_INTEGRATION } from "./jam/integration.js";
import { JUMPCLOUD_INTEGRATION } from "./jumpcloud/integration.js";
import { KNOCK_INTEGRATION } from "./knock/integration.js";
import { KNOWBE4_INTEGRATION } from "./knowbe4/integration.js";
import { LINEAR_INTEGRATION } from "./linear/integration.js";
import { MAKE_INTEGRATION } from "./make/integration.js";
import type { IntegrationManifest } from "./manifest.js";
import { MICROSOFT365_INTEGRATION } from "./microsoft365/integration.js";
import { NIGHTFALL_INTEGRATION } from "./nightfall/integration.js";
import { NOTION_INTEGRATION } from "./notion/integration.js";
import { NX_CLOUD_INTEGRATION } from "./nx-cloud/integration.js";
import { ONEPASSWORD_INTEGRATION } from "./onepassword/integration.js";
import { OUTLOOK_INTEGRATION } from "./outlook/integration.js";
import { OUTLOOK_CALENDAR_INTEGRATION } from "./outlook-calendar/integration.js";
import { PRISMA_DATA_INTEGRATION } from "./prisma-data-platform/integration.js";
import { SLACK_INTEGRATION } from "./slack/integration.js";
import { TRELICA_INTEGRATION } from "./trelica/integration.js";
import { TWILIO_INTEGRATION } from "./twilio/integration.js";
import { VANTA_INTEGRATION } from "./vanta/integration.js";
import { WORKOS_INTEGRATION } from "./workos/integration.js";
import { XERO_INTEGRATION } from "./xero/integration.js";

/**
 * Every manifest, alphabetical by id.
 *
 * A literal tuple rather than an array typed as `IntegrationManifest[]`, so a list that needs a literal TYPE
 * (`CorpusSource`, `ConnectSource`) can be computed from `typeof INTEGRATIONS` without losing its members.
 */
const INTEGRATIONS = [
  AETHER_INTEGRATION,
  AIRTABLE_INTEGRATION,
  BRAZE_INTEGRATION,
  CALENDAR_INTEGRATION,
  CANVA_INTEGRATION,
  CHATGPT_INTEGRATION,
  CLERK_INTEGRATION,
  CLOUDFLARE_INTEGRATION,
  CROWDSTRIKE_INTEGRATION,
  DATADOG_INTEGRATION,
  DRIVE_INTEGRATION,
  FATHOM_INTEGRATION,
  FIGMA_INTEGRATION,
  GEMINI_AI_STUDIO_INTEGRATION,
  GITHUB_INTEGRATION,
  GMAIL_INTEGRATION,
  GOOGLE_ADMIN_INTEGRATION,
  GOOGLE_SECOPS_INTEGRATION,
  GRAPHQL_HIVE_INTEGRATION,
  HEX_INTEGRATION,
  INNGEST_INTEGRATION,
  JAM_INTEGRATION,
  JUMPCLOUD_INTEGRATION,
  KNOCK_INTEGRATION,
  KNOWBE4_INTEGRATION,
  LINEAR_INTEGRATION,
  MAKE_INTEGRATION,
  MICROSOFT365_INTEGRATION,
  NIGHTFALL_INTEGRATION,
  NOTION_INTEGRATION,
  NX_CLOUD_INTEGRATION,
  ONEPASSWORD_INTEGRATION,
  OUTLOOK_INTEGRATION,
  OUTLOOK_CALENDAR_INTEGRATION,
  PRISMA_DATA_INTEGRATION,
  SLACK_INTEGRATION,
  TRELICA_INTEGRATION,
  TWILIO_INTEGRATION,
  VANTA_INTEGRATION,
  WORKOS_INTEGRATION,
  XERO_INTEGRATION,
] as const satisfies readonly IntegrationManifest[];

/**
 * One registered manifest as its own literal type, so a literal list (`CorpusSource`, `./corpusSources.ts`) can be
 * computed from the ids and flags the registry holds.
 */
export type RegisteredIntegration = (typeof INTEGRATIONS)[number];

/** The same rows, read through the manifest shape, so an optional feature can be asked about on every row. */
const MANIFESTS: readonly IntegrationManifest[] = INTEGRATIONS;

/**
 * Every integration, in registry order.
 *
 * @returns the manifests, alphabetical by id
 */
export function integrations(): readonly IntegrationManifest[] {
  return MANIFESTS;
}

/**
 * Every integration as its own literal type — what a derivation needing a literal result type reads.
 *
 * @returns the same manifests as {@link integrations}, unwidened
 */
export function registeredIntegrations(): readonly RegisteredIntegration[] {
  return INTEGRATIONS;
}

/**
 * The atlas registration of every given integration that has an atlas — what `src/atlas/registry.ts` holds.
 *
 * Takes the manifests rather than reading the registry, so a test can add a fixture integration and watch it
 * appear; production passes {@link integrations}.
 *
 * @param manifests the integrations to project, in the order the result keeps
 * @returns the registrations, in the manifests' order — for the registry, the atlas catalogue's order
 */
export function atlasRegistrationsOf({
  manifests,
}: {
  manifests: readonly IntegrationManifest[];
}): readonly AtlasPlatformRegistration[] {
  return manifests.flatMap((manifest) => (manifest.features.atlas === undefined ? [] : [manifest.features.atlas]));
}

/**
 * Each given integration's plain name, keyed by its atlas's platform name, for those that have an atlas.
 *
 * @param manifests the integrations to project
 * @returns the names, keyed by platform — `ATLAS_NAMES` (`src/automations/purposeNames.ts`) for the registry
 */
export function atlasNamesOf({
  manifests,
}: {
  manifests: readonly IntegrationManifest[];
}): Readonly<Record<string, string>> {
  return Object.fromEntries(
    manifests.flatMap((manifest) =>
      manifest.features.atlas === undefined ? [] : [[manifest.features.atlas.platform, manifest.name] as const],
    ),
  );
}
