/**
 * Lazy manifest for the `alias` noun — the mailbox half of standing up an assistant plan on an
 * organisation-owned identity. `provision` and `catch-all` WRITE to Cloudflare Email Routing and are
 * therefore doored; `list` only reads the zone's rules.
 *
 * The usage strings are imported from `../commands/alias/core.js` rather than hand-copied: that module is
 * pure argv parsing with no provider client behind it, so importing it here costs the eager manifest load
 * nothing and makes drift between the two copies structurally impossible.
 */
import { ALIAS_CATCH_ALL_USAGE, ALIAS_LIST_USAGE, ALIAS_PROVISION_USAGE } from "../commands/alias/usage.js";
import { lazy, type VerbManifestEntry } from "../manifest.js";

export const aliasManifest: Readonly<Record<string, VerbManifestEntry>> = {
  "catch-all": lazy({
    load: () => import("../commands/alias/run.js").then((m) => m.aliasCatchAllCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: true,
      dryParseSafe: true,
      effect: "external-write",
      example: "slopweaver alias catch-all --domain acme.com --enable --destination ops@acme.com",
      parseRejectIsIoFree: true,
      summary:
        "Point a zone's catch-all at one verified mailbox, or switch it off — the one-time write that makes a per-seat alias step unnecessary",
      usage: ALIAS_CATCH_ALL_USAGE,
    },
  }),
  list: lazy({
    load: () => import("../commands/alias/run.js").then((m) => m.aliasListCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      effect: "external-read",
      example: "slopweaver alias list --domain acme.com",
      parseRejectIsIoFree: true,
      summary: "Read every email-routing rule on a zone, so a re-run can see what is already provisioned",
      usage: ALIAS_LIST_USAGE,
    },
  }),
  provision: lazy({
    load: () => import("../commands/alias/run.js").then((m) => m.aliasProvisionCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: true,
      dryParseSafe: true,
      effect: "external-write",
      example: "slopweaver alias provision --domain acme.com --provider claude --label five --destination ops@acme.com",
      parseRejectIsIoFree: true,
      summary:
        "Provision one `<provider>-<label>@<zone>` forwarding address on a Cloudflare zone this account holds, refusing an unheld zone, a disabled routing setup, an unverified destination and an address already routed",
      usage: ALIAS_PROVISION_USAGE,
    },
  }),
};
