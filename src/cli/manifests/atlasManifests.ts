/**
 * The platform atlases and live read-only clients of the noun barrel: the atlas verb and the platforms synced
 * into one (`atlas`, `onepassword`, `crowdstrike`, `cloudflare`), and the platforms read live or from a share
 * link (`datadog`, `fathom`, `chatgpt`, `hex`, `twilio`, `knock`).
 *
 * `./index.ts` spreads this array into `MANIFEST_MODULES`. A new noun of this family appends ONE row here; a
 * family file nearing the 300-code-line cap splits again rather than growing past it.
 */

import type { NounManifestModule } from "../manifest.js";
import { atlasManifest } from "./atlas.js";
import { chatgptManifest } from "./chatgpt.js";
import { cloudflareManifest } from "./cloudflare.js";
import { crowdstrikeManifest } from "./crowdstrike.js";
import { datadogManifest } from "./datadog.js";
import { fathomManifest } from "./fathom.js";
import { hexManifest } from "./hex.js";
import { knockManifest } from "./knock.js";
import { onepasswordManifest } from "./onepassword.js";
import { twilioManifest } from "./twilio.js";

/** The platform atlases and live read-only clients, each one `{ noun, summary, verbs }` row. */
export const ATLAS_MANIFEST_MODULES: readonly NounManifestModule[] = [
  {
    noun: "atlas",
    summary: "The local ground truth of what a platform CONTAINS — what exists, what you can read, what you have",
    verbs: atlasManifest,
  },
  {
    noun: "onepassword",
    summary:
      "Sync a 1Password account's ADMIN surface (people, groups, membership, vaults, vault access, item counts, integrations, audit activity) into a local atlas — never an item's contents",
    verbs: onepasswordManifest,
  },
  {
    noun: "crowdstrike",
    summary:
      "Sync one CrowdStrike Falcon tenant's endpoint surface (hosts, host groups, prevention and sensor-update policies, Spotlight findings, Zero Trust scores, detections) into a local atlas — strictly read-only",
    verbs: crowdstrikeManifest,
  },
  {
    noun: "cloudflare",
    summary:
      "Sync one Cloudflare account's configuration (Access, Gateway, Pages, Workers, notifications, audit logs, certificates, zones, plus DNS/firewall/SSL/analytics/API Gateway for one configured deep zone) into a local atlas",
    verbs: cloudflareManifest,
  },
  {
    noun: "datadog",
    summary:
      "A Datadog API client + query/citation/aggregation/rate-limit toolkit — a platform client, not a synced atlas",
    verbs: datadogManifest,
  },
  {
    noun: "fathom",
    summary:
      "Calls other people recorded and shared with you — read a share link's raw transcript by speaker, and find the links in Fathom's own mail",
    verbs: fathomManifest,
  },
  {
    noun: "chatgpt",
    summary:
      "The owner's ChatGPT account through its private web API: every conversation listed, and a named one read whole by id into a local transcript",
    verbs: chatgptManifest,
  },
  {
    noun: "hex",
    summary:
      "Reading Hex live — the masked, access-controlled view over the warehouse: projects, connections, cell sources, a cell's bounded output and run history. Read, never ingested",
    verbs: hexManifest,
  },
  {
    noun: "twilio",
    summary:
      "Reading Twilio live for an investigation — which SMS went to a number and whether each was delivered. GET-only, never a body, stored nowhere",
    verbs: twilioManifest,
  },
  {
    noun: "knock",
    summary:
      "Reading Knock live for an investigation — which notifications went to a user, their event trail and the provider calls behind them. GET-only, never a payload, stored nowhere",
    verbs: knockManifest,
  },
];
