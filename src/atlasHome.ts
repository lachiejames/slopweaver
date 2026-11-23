/**
 * Where every atlas's generation lives under `$SLOPWEAVER_HOME`, one resolver per platform.
 *
 * ## Why this is its own module
 *
 * It was inside `stateHome.ts` until the fourteenth atlas took that file past the 600-code-line cap, which
 * is the `file-size-ratchet` gate doing exactly its job: the atlas sub-tree had become the largest thing in
 * a file whose subject is the WHOLE home, and it grows by one resolver per platform with no ceiling.
 *
 * Moving it also removes a collision surface the fleet was paying for. Every atlas landing in the same wave
 * edits its own resolver, its own key on the sub-tree type, and its own row in {@link atlasHomePaths} —
 * three hunks in one file, which is why concurrent atlas pull requests conflicted here every time. They
 * still conflict with each other, but no longer inside the module that resolves the corpus, the ledgers and
 * the queue as well.
 *
 * ## The single-home contract is unchanged
 *
 * `stateHome.ts` and the area modules under `stateHome/` it composes remain the only place a home path is derived
 * from the home root, which their guard test enforces by allowing that one join in that tree alone — this comment
 * deliberately does not spell the call
 * it names, because the guard reads source text and would flag its own description. This module takes
 * `$home/atlas` as an argument and resolves nothing above it. A platform still adds a sibling key and one
 * row, never a new home contract.
 */

import { AETHER_KINDS } from "./atlas/aether/model.js";
import { BRAZE_KINDS } from "./atlas/braze/model.js";
import { CANVA_ATLAS_KINDS } from "./atlas/canva/model.js";
import { CLOUDFLARE_KINDS } from "./atlas/cloudflare/model.js";
import { DATADOG_KINDS } from "./atlas/datadog/model.js";
import { GITHUB_KIND_FILES } from "./atlas/github/model.js";
import { JAM_ATLAS_KINDS } from "./atlas/jam/model.js";
import { MICROSOFT365_KINDS } from "./atlas/microsoft365/model.js";
import { NIGHTFALL_ATLAS_KINDS } from "./atlas/nightfall/model.js";
import { TRELICA_KIND_FILES } from "./atlas/trelica/kindFileNames.js";
import { airtableAtlasPaths } from "./atlasHomeAirtable.js";
import { figmaAtlasPaths } from "./atlasHomeFigma.js";
import {
  geminiAiStudioAtlasHomePaths,
  googleAdminAtlasHomePaths,
  googleSecopsAtlasHomePaths,
} from "./atlasHomeGoogle.js";
import { inngestAtlasHomePaths } from "./atlasHomeInngest.js";
import { jumpcloudAtlasPaths } from "./atlasHomeJumpcloud.js";
import { knockAtlasHomePaths } from "./atlasHomeKnock.js";
import { knowbe4AtlasHomePaths } from "./atlasHomeKnowbe4.js";
import { makeAtlasHomePaths } from "./atlasHomeMake.js";
import { atlasPlatformPaths } from "./atlasHomeShared.js";
import { vantaAtlasPaths } from "./atlasHomeVanta.js";
import { workosAtlasPaths } from "./atlasHomeWorkos.js";
import type { AtlasPlatformPaths, StateHomePaths } from "./stateHome.js";

/**
 * Resolve the Cloudflare atlas's paths. Split out of {@link atlasHomePaths} for the same line-count reason
 * that {@link atlasHomePaths} is itself split out of `./stateHome.ts`'s `stateHomePaths`.
 *
 * The kind map is COMPUTED from `CLOUDFLARE_KINDS`, the way {@link datadogAtlasPaths} is and for the reason
 * that function's header gives. It was hand-written while this atlas had thirty kinds, and every one of
 * those thirty lines spelled exactly `<kind>.jsonl` — so the map was already a repetition of the kind list,
 * and the Zero Trust cut taking it to sixty-three is what made that repetition expensive rather than merely
 * redundant. Every path this produces is byte-identical to the one the hand-written map produced; no
 * install's file moves.
 *
 * @param atlasRoot `$home/atlas`, the root every platform hangs off
 * @returns this platform's atlas paths
 */
function cloudflareAtlasPaths({ atlasRoot }: { atlasRoot: string }): AtlasPlatformPaths {
  const files: Record<string, string> = {};
  for (const kind of CLOUDFLARE_KINDS) {
    files[kind] = `${kind}.jsonl`;
  }
  return atlasPlatformPaths({ atlasRoot, files, platform: "cloudflare" });
}

/**
 * Resolve the Datadog atlas's paths. Split out of {@link atlasHomePaths} for the same line-count reason.
 *
 * The kind map is COMPUTED from `DATADOG_KINDS` rather than written out, and it is the only one here that
 * is. Every sibling atlas has between six and a dozen kinds and spells each file name deliberately; Datadog
 * has 115, taken from the provider's own first path segment, so a hand-written map would be 115 lines whose
 * only content is a repetition of the kind list — and a line nobody reads is a line that silently drifts
 * from the list it is supposed to mirror. The file name is the kind plus `.json`, which is why the kind
 * vocabulary being the provider's own matters: `logs.json`, `monitor.json`, `slo.json`.
 *
 * @param atlasRoot `$home/atlas`, the root every platform hangs off
 * @returns this platform's atlas paths
 */
function datadogAtlasPaths({ atlasRoot }: { atlasRoot: string }): AtlasPlatformPaths {
  const files: Record<string, string> = {};
  for (const kind of DATADOG_KINDS) {
    files[kind] = `${kind}.jsonl`;
  }
  return atlasPlatformPaths({ atlasRoot, files, platform: "datadog" });
}

/**
 * Resolve the Nightfall atlas's paths. Split out of {@link atlasHomePaths} for the same line-count reason.
 *
 * The file map is COMPUTED from `NIGHTFALL_ATLAS_KINDS` rather than written out, the way
 * {@link datadogAtlasPaths} is: nineteen lines whose only content is a repetition of the kind list are
 * nineteen lines that silently drift from it. The kinds are the vendor's own resource nouns, so the
 * directory reads as the platform does — `violation.json`, `mcp-server.json`, `endpoint-device.json`.
 *
 * @param atlasRoot `$home/atlas`, the root every platform hangs off
 * @returns this platform's atlas paths
 */
function nightfallAtlasPaths({ atlasRoot }: { atlasRoot: string }): AtlasPlatformPaths {
  const files: Record<string, string> = {};
  for (const kind of NIGHTFALL_ATLAS_KINDS) {
    files[kind] = `${kind}.jsonl`;
  }
  return atlasPlatformPaths({ atlasRoot, files, platform: "nightfall" });
}

/**
 * Resolve the 1Password atlas's paths. Split out of {@link atlasHomePaths} for the same line-count reason.
 *
 * @param atlasRoot `$home/atlas`, the root every platform hangs off
 * @returns this platform's atlas paths
 */
function onepasswordAtlasPaths({ atlasRoot }: { atlasRoot: string }): AtlasPlatformPaths {
  return atlasPlatformPaths({
    atlasRoot,
    files: {
      event: "events.jsonl",
      group: "groups.jsonl",
      "group-member": "group-members.jsonl",
      integration: "integrations.jsonl",
      user: "users.jsonl",
      vault: "vaults.jsonl",
      "vault-grant": "vault-grants.jsonl",
    },
    platform: "onepassword",
  });
}

/**
 * Resolve the Linear atlas's paths. Split out of {@link atlasHomePaths} for the same line-count reason.
 *
 * `sensitive` is resolved like every other platform's. The `setting` kind is the one that stores provider
 * VALUES, and `settings.ts`'s explicit selections are what keep a credential out of them, so nothing is
 * expected to land here and a file that does appear is a finding rather than routine.
 *
 * @param atlasRoot `$home/atlas`, the root every platform hangs off
 * @returns this platform's atlas paths
 */
function linearAtlasPaths({ atlasRoot }: { atlasRoot: string }): AtlasPlatformPaths {
  return atlasPlatformPaths({
    atlasRoot,
    files: {
      operation: "operations.jsonl",
      page: "pages.jsonl",
      setting: "settings.jsonl",
      type: "types.jsonl",
    },
    platform: "linear",
  });
}

/**
 * Resolve the CrowdStrike Falcon atlas's paths. Split out of {@link atlasHomePaths} for the same
 * line-count reason.
 *
 * Page screenshots are artifacts INSIDE the generation, addressed by a path relative to `root` rather than
 * by a key here — the same shape the Slack atlas uses. They are images of a security console showing real
 * machines and real people, so they live under the private state home and are never committed.
 *
 * @param atlasRoot the resolved `$home/atlas`
 * @returns the CrowdStrike sub-tree
 */
function crowdstrikeAtlasPaths({ atlasRoot }: { atlasRoot: string }): AtlasPlatformPaths {
  return atlasPlatformPaths({
    atlasRoot,
    files: {
      "console-page": "console-pages.jsonl",
      "console-request": "console-requests.jsonl",
      detection: "detections.jsonl",
      host: "hosts.jsonl",
      "host-group": "host-groups.jsonl",
      "prevention-policy": "prevention-policies.jsonl",
      "sensor-update-policy": "sensor-update-policies.jsonl",
      vulnerability: "vulnerabilities.jsonl",
      "zero-trust-assessment": "zero-trust-assessments.jsonl",
      "zero-trust-audit": "zero-trust-audit.jsonl",
    },
    platform: "crowdstrike",
  });
}

/**
 * Resolve the Prisma Data Platform atlas's paths.
 *
 * Twenty-six kind files, and the shape of the list is the atlas's own argument: three map the platform —
 * the management API's operations, the console's routes and the authorization server's endpoints — and the
 * other twenty-three are entities, because `docs/atlas-intent/06-holdings.md`'s test comes out "everything
 * reachable" here. `src/atlas/prismaDataPlatform/model.ts` carries why.
 *
 * @param atlasRoot `$home/atlas`, the root every platform hangs off
 * @returns this platform's atlas paths
 */
function prismaDataPlatformAtlasHomePaths({ atlasRoot }: { atlasRoot: string }): AtlasPlatformPaths {
  return atlasPlatformPaths({
    atlasRoot,
    files: {
      account: "accounts.jsonl",
      branch: "branches.jsonl",
      bucket: "buckets.jsonl",
      "bucket-key": "bucket-keys.jsonl",
      build: "builds.jsonl",
      connection: "connections.jsonl",
      "console-route": "console-routes.jsonl",
      "custom-domain": "custom-domains.jsonl",
      database: "databases.jsonl",
      "database-backup": "database-backups.jsonl",
      "database-usage": "database-usage.jsonl",
      deployment: "deployments.jsonl",
      "environment-variable": "environment-variables.jsonl",
      "event-shape": "event-shapes.jsonl",
      "iac-state": "iac-state.jsonl",
      integration: "integrations.jsonl",
      method: "methods.jsonl",
      "oauth-endpoint": "oauth-endpoints.jsonl",
      project: "projects.jsonl",
      region: "regions.jsonl",
      "scm-installation": "scm-installations.jsonl",
      service: "services.jsonl",
      "service-token": "service-tokens.jsonl",
      "source-repository": "source-repositories.jsonl",
      subscription: "subscriptions.jsonl",
      workspace: "workspaces.jsonl",
    },
    platform: "prisma-data-platform",
  });
}

/**
 * Resolve the Clerk atlas's paths. Split out of {@link atlasHomePaths} for the same line-count reason.
 *
 * Page screenshots are artifacts INSIDE the generation, under `<root>/artifacts/pages`, addressed by a path
 * relative to `root` rather than by a key here — the same shape the Slack, Notion, Trelica and Xero atlases
 * use. A signed-in Clerk dashboard renders the product's own end users, so these are the most sensitive
 * pictures any atlas here holds: they live under the private state home and are never committed.
 *
 * `spec/` holds the four pinned Clerk documents this atlas compiles from, cached by the commit they came
 * from (`atlas/clerk/specSource.ts`). It sits inside the atlas root rather than beside it because it is
 * this atlas's own input and nothing else reads it, and it needs no key here for the same reason.
 * `sensitive` stays empty: every field an operation entity carries is a NAME.
 *
 * @param atlasRoot `$home/atlas`, the root every platform hangs off
 * @returns this platform's atlas paths
 */
function clerkAtlasPlatformPaths({ atlasRoot }: { atlasRoot: string }): AtlasPlatformPaths {
  return atlasPlatformPaths({
    atlasRoot,
    files: {
      operation: "operations.jsonl",
      page: "pages.jsonl",
      "webhook-event": "webhook-events.jsonl",
    },
    platform: "clerk",
  });
}

/**
 * Resolve the Microsoft 365 / Entra atlas's paths. Split out of {@link atlasHomePaths} for the same
 * line-count reason.
 *
 * The kind map is COMPUTED from `MICROSOFT365_KINDS` rather than written out, the same way the Datadog
 * resolver computes its own: Microsoft Graph has 70 resource roots, plus `page` for the browser surface, and
 * writing seventy-one names here produced a second copy large enough that `duplicate-windows` flagged it
 * against `atlas/microsoft365/model.ts`. A checked duplicate is still a duplicate.
 *
 * `spec/` holds the pinned Graph specification this atlas compiles from, cached by the commit it came from
 * (`atlas/microsoft365/specSource.ts`). It sits inside the atlas root rather than beside it because it is
 * this atlas's own input and nothing else reads it, and it needs no key here for the same reason. `sensitive`
 * stays empty: every field an operation entity carries is a NAME.
 *
 * @param atlasRoot `$home/atlas`, the root every platform hangs off
 * @returns this platform's atlas paths
 */
function microsoft365AtlasPaths({ atlasRoot }: { atlasRoot: string }): AtlasPlatformPaths {
  return atlasPlatformPaths({
    atlasRoot,
    files: Object.fromEntries(MICROSOFT365_KINDS.map((kind) => [kind, `${kind}.jsonl`])),
    platform: "microsoft365",
  });
}

/**
 * Resolve the Braze atlas's paths. Split out of {@link atlasHomePaths} for the same line-count reason.
 *
 * `_cache/docs-operations.json` sits beside the generation rather than under a kind key: it holds the rows
 * extracted from Braze's endpoint reference, keyed by each page's own `lastmod`, and it is a fetch
 * optimisation rather than atlas content. `reset` deliberately leaves it alone — `atlas/braze/reset.ts` says
 * why.
 *
 * @param atlasRoot `$home/atlas`, the root every platform hangs off
 * @returns this platform's atlas paths
 */
function brazeAtlasPlatformPaths({ atlasRoot }: { atlasRoot: string }): AtlasPlatformPaths {
  return atlasPlatformPaths({
    atlasRoot,
    files: Object.fromEntries(BRAZE_KINDS.map((kind) => [kind, `${kind}.jsonl`])),
    platform: "braze",
  });
}

/**
 * Resolve the Notion atlas's paths. Split out of {@link atlasHomePaths} for the same line-count reason.
 *
 * Page screenshots are artifacts INSIDE the generation, under `<root>/artifacts/pages`, addressed by a path
 * relative to `root` rather than by a key here — the same shape the Slack and CrowdStrike atlases use. They
 * are images of a real workspace, so they live under the private state home and are never committed.
 * `sensitive` is resolved like every other platform's and is expected to stay empty: every field this atlas
 * stores is a name, a title, a URL or a screenshot, and none of them is a withheld value.
 *
 * @param atlasRoot `$home/atlas`, the root every platform hangs off
 * @returns this platform's atlas paths
 */
function notionAtlasPlatformPaths({ atlasRoot }: { atlasRoot: string }): AtlasPlatformPaths {
  return atlasPlatformPaths({
    atlasRoot,
    files: { method: "methods.jsonl", page: "pages.jsonl" },
    platform: "notion",
  });
}

/**
 * Resolve the Trelica atlas's paths. Split out of {@link atlasHomePaths} for the same line-count reason.
 *
 * Page screenshots are artifacts INSIDE the generation, under `<root>/artifacts/pages`, addressed by a path
 * relative to `root` rather than by a key here — the same shape the Slack, CrowdStrike and Notion atlases
 * use. They are images of a real tenant, so they live under the private state home and are never committed.
 * `sensitive` is resolved like every other platform's and is expected to stay empty: the entity kinds are
 * read through a closed projection, so nothing withheld ever reaches a companion file.
 *
 * @param atlasRoot `$home/atlas`, the root every platform hangs off
 * @returns this platform's atlas paths
 */
function trelicaAtlasPlatformPaths({ atlasRoot }: { atlasRoot: string }): AtlasPlatformPaths {
  return atlasPlatformPaths({
    atlasRoot,
    files: TRELICA_KIND_FILES,
    platform: "trelica",
  });
}

/**
 * Resolve the Twilio atlas's paths. Split out of {@link atlasHomePaths} for the same line-count reason.
 *
 * `sensitive` is resolved like every other platform's, and this atlas is expected to keep it empty: what
 * it stores is Twilio's own published definitions and, once a credential exists, the account's own
 * configuration. Never a message body, a recording, or a phone number belonging to a person.
 *
 * @param atlasRoot `$home/atlas`, the root every platform hangs off
 * @returns this platform's atlas paths
 */
function twilioAtlasPlatformPaths({ atlasRoot }: { atlasRoot: string }): AtlasPlatformPaths {
  return atlasPlatformPaths({
    atlasRoot,
    files: {
      account: "accounts.jsonl",
      api: "apis.jsonl",
      method: "methods.jsonl",
      page: "pages.jsonl",
      resource: "resources.jsonl",
    },
    platform: "twilio",
  });
}

/**
 * Resolve the Hex atlas's paths. Split out of {@link atlasHomePaths} for the same line-count reason.
 *
 * Five kinds, and only three of them are ever filled on an install with no Hex token: `api`, `method` and
 * `page` are the surface map, while `project` and `resource` are declared and carry a `not-configured` cell
 * rather than being absent — `docs/atlas-intent/settled-decisions.md`'s honesty properties turn on a kind saying what it is
 * waiting for. Page screenshots are artifacts INSIDE the generation, under `<root>/artifacts/pages`.
 *
 * @param atlasRoot `$home/atlas`, the root every platform hangs off
 * @returns this platform's atlas paths
 */
function hexAtlasPlatformPaths({ atlasRoot }: { atlasRoot: string }): AtlasPlatformPaths {
  return atlasPlatformPaths({
    atlasRoot,
    files: {
      api: "apis.jsonl",
      method: "methods.jsonl",
      page: "pages.jsonl",
      project: "projects.jsonl",
      resource: "resources.jsonl",
    },
    platform: "hex",
  });
}

/**
 * Resolve the Jam atlas's paths.
 *
 * Five kind files: three the compiled channel fills from Jam's own published documents, one the
 * credential-free route probe fills, and one the browser walk fills. There is deliberately no `jams` file —
 * `src/atlas/jam/model.ts` carries why a recording's payload is withheld on disclosure.
 *
 * @param atlasRoot `$home/atlas`, the root every platform hangs off
 * @returns this platform's atlas paths
 */
function jamAtlasPlatformPaths({ atlasRoot }: { atlasRoot: string }): AtlasPlatformPaths {
  return atlasPlatformPaths({
    atlasRoot,
    files: Object.fromEntries(JAM_ATLAS_KINDS.map((kind) => [kind, `${kind}s.jsonl`])),
    platform: "jam",
  });
}

/**
 * Resolve the Aether atlas's paths.
 *
 * Five kinds, all reduced from ONE driven-browser surface — the dvuln pentest portal in the owner's own
 * signed-in Chrome — because `docs/atlas-intent/06-holdings.md`'s per-platform test comes out the entities-included
 * way: nothing else in this installation holds what a third-party pentest of Acme's staging estate found.
 * `src/atlas/aether/model.ts` carries why the Attack Surface is declared voluminous and not stored whole.
 *
 * @param atlasRoot `$home/atlas`, the root every platform hangs off
 * @returns this platform's atlas paths
 */
function aetherAtlasPlatformPaths({ atlasRoot }: { atlasRoot: string }): AtlasPlatformPaths {
  return atlasPlatformPaths({
    atlasRoot,
    files: Object.fromEntries(AETHER_KINDS.map((kind) => [kind, `${kind}s.jsonl`])),
    platform: "aether",
  });
}

/**
 * Resolve the Nx Cloud atlas's paths.
 *
 * The directory is `nx-cloud`, matching the platform name the catalogue keys on, rather than the camel-case
 * the TypeScript key uses — a person reading `$SLOPWEAVER_HOME/atlas/` should see the same word the verb
 * takes. `sensitive` is resolved like every other platform's and is expected to stay empty: `projection.ts`
 * is an allowlist and `sensitivity.ts` refuses rather than withholds, so there is no withheld value to
 * store beside a generation.
 *
 * @param atlasRoot `$home/atlas`, the root every platform hangs off
 * @returns this platform's atlas paths
 */
function nxCloudAtlasPlatformPaths({ atlasRoot }: { atlasRoot: string }): AtlasPlatformPaths {
  return atlasPlatformPaths({
    atlasRoot,
    files: {
      endpoint: "endpoints",
      family: "families",
      organization: "organizations",
      route: "routes",
      workspace: "workspaces",
    },
    platform: "nx-cloud",
  });
}

/**
 * Resolve the Xero atlas's paths. Split out of {@link atlasHomePaths} for the same line-count reason.
 *
 * Page screenshots are artifacts INSIDE the generation, under `<root>/artifacts/pages`, addressed by a path
 * relative to `root` rather than by a key here — the same shape every walking atlas uses. They are pictures
 * of a real organisation's books, so they live under the private state home and are never committed.
 * `sensitive` is resolved like every other platform's and is expected to stay empty: every field this atlas
 * stores is a name, a count, a URL or a screenshot, and none of them is a withheld value.
 *
 * @param atlasRoot `$home/atlas`, the root every platform hangs off
 * @returns this platform's atlas paths
 */
function xeroAtlasPlatformPaths({ atlasRoot }: { atlasRoot: string }): AtlasPlatformPaths {
  return atlasPlatformPaths({
    atlasRoot,
    files: {
      family: "families.jsonl",
      method: "methods.jsonl",
      page: "pages.jsonl",
    },
    platform: "xero",
  });
}

/**
 * Resolve the Slack atlas's paths. Split out of {@link atlasHomePaths} for the same line-count reason.
 *
 * `sensitive` is resolved like every other platform's and is expected to stay empty: nothing this atlas
 * stores is a withheld value, because every field a method entity carries is a NAME. The screenshots the
 * browser surface holds are artifacts inside the generation, not companions beside it.
 *
 * @param atlasRoot `$home/atlas`, the root every platform hangs off
 * @returns this platform's atlas paths
 */
function slackAtlasPlatformPaths({ atlasRoot }: { atlasRoot: string }): AtlasPlatformPaths {
  return atlasPlatformPaths({
    atlasRoot,
    files: {
      method: "methods.jsonl",
      page: "pages.jsonl",
    },
    platform: "slack",
  });
}

/**
 * Resolve the GraphQL Hive atlas's paths. Split out of {@link atlasHomePaths} for the same line-count reason.
 *
 * TWO artifact directories rather than the usual one, both resolved relative to `root` rather than by a key
 * here: `artifacts/pages` for a console screenshot and `artifacts/schemas` for a target's composed SDL. The
 * schema is the typed surface an end-to-end map would otherwise rediscover, which is why this atlas keeps
 * the bytes rather than a link to them. `sensitive` is resolved like every other platform's and is expected
 * to stay empty: this atlas stores names, slugs, URLs, screenshots and public schema text, and none of them
 * is a withheld value.
 *
 * @param atlasRoot `$home/atlas`, the root every platform hangs off
 * @returns this platform's atlas paths
 */
function graphqlHiveAtlasPaths({ atlasRoot }: { atlasRoot: string }): AtlasPlatformPaths {
  return atlasPlatformPaths({
    atlasRoot,
    files: {
      operation: "operations.jsonl",
      organization: "organizations.jsonl",
      page: "pages.jsonl",
      project: "projects.jsonl",
      target: "targets.jsonl",
      type: "types.jsonl",
    },
    platform: "graphql-hive",
  });
}

/**
 * Resolve the Canva atlas's paths. Split out of {@link atlasHomePaths} for the same line-count reason.
 *
 * The file map is COMPUTED from `CANVA_ATLAS_KINDS` rather than written out, for the reason
 * {@link datadogAtlasPaths} gives. The kinds are the vendor's own tags, kebab-cased, so the directory reads
 * as the platform's own documentation does — `design.json`, `brand-template.json`, `folder.json`.
 *
 * @param atlasRoot `$home/atlas`, the root every platform hangs off
 * @returns this platform's atlas paths
 */
function canvaAtlasPlatformPaths({ atlasRoot }: { atlasRoot: string }): AtlasPlatformPaths {
  const files: Record<string, string> = {};
  for (const kind of CANVA_ATLAS_KINDS) {
    files[kind] = `${kind}.jsonl`;
  }
  return atlasPlatformPaths({ atlasRoot, files, platform: "canva" });
}

/**
 * Resolve the `atlas` sub-tree — the platform root plus each platform's own generation paths. Split out of
 * `./stateHome.ts`'s `stateHomePaths` purely to keep that function's own line count down; still the only other place
 * that derives an atlas sub-path from `home`, so the single-contract guard still holds.
 *
 * @param atlasRoot `$home/atlas`, resolved by `stateHome.ts` — the entry of the one tree where a home path is derived
 * @returns the atlas sub-tree, rooted at that directory
 */
export function atlasHomePaths({ atlasRoot }: { atlasRoot: string }): StateHomePaths["atlas"] {
  return {
    aether: aetherAtlasPlatformPaths({ atlasRoot }),
    airtable: airtableAtlasPaths({ atlasRoot }),
    braze: brazeAtlasPlatformPaths({ atlasRoot }),
    canva: canvaAtlasPlatformPaths({ atlasRoot }),
    cloudflare: cloudflareAtlasPaths({ atlasRoot }),
    crowdstrike: crowdstrikeAtlasPaths({ atlasRoot }),
    datadog: datadogAtlasPaths({ atlasRoot }),
    figma: figmaAtlasPaths({ atlasRoot }),
    geminiAiStudio: geminiAiStudioAtlasHomePaths({ atlasRoot }),
    // Admin-page screenshots are artifacts INSIDE the generation, addressed by a path relative to `root`
    // rather than by a key here — the same shape the Slack and CrowdStrike atlases use. They photograph a
    // signed-in settings console showing the organisation's name, repositories and people, so they live
    // under the private state home and are never committed.
    github: atlasPlatformPaths({ atlasRoot, files: GITHUB_KIND_FILES, platform: "github" }),
    googleAdmin: googleAdminAtlasHomePaths({ atlasRoot }),
    googleSecops: googleSecopsAtlasHomePaths({ atlasRoot }),
    graphqlHive: graphqlHiveAtlasPaths({ atlasRoot }),
    jam: jamAtlasPlatformPaths({ atlasRoot }),
    jumpcloud: jumpcloudAtlasPaths({ atlasRoot }),
    knowbe4: knowbe4AtlasHomePaths({ atlasRoot }),
    linear: linearAtlasPaths({ atlasRoot }),
    make: makeAtlasHomePaths({ atlasRoot }),
    clerk: clerkAtlasPlatformPaths({ atlasRoot }),
    microsoft365: microsoft365AtlasPaths({ atlasRoot }),
    nightfall: nightfallAtlasPaths({ atlasRoot }),
    notion: notionAtlasPlatformPaths({ atlasRoot }),
    nxCloud: nxCloudAtlasPlatformPaths({ atlasRoot }),
    onepassword: onepasswordAtlasPaths({ atlasRoot }),
    inngest: inngestAtlasHomePaths({ atlasRoot }),
    knock: knockAtlasHomePaths({ atlasRoot }),
    prismaDataPlatform: prismaDataPlatformAtlasHomePaths({ atlasRoot }),
    hex: hexAtlasPlatformPaths({ atlasRoot }),
    root: atlasRoot,
    slack: slackAtlasPlatformPaths({ atlasRoot }),
    trelica: trelicaAtlasPlatformPaths({ atlasRoot }),
    twilio: twilioAtlasPlatformPaths({ atlasRoot }),
    vanta: vantaAtlasPaths({ atlasRoot }),
    workos: workosAtlasPaths({ atlasRoot }),
    xero: xeroAtlasPlatformPaths({ atlasRoot }),
  };
}
