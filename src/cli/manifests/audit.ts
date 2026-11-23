/**
 * Lazy manifest for the `audit` noun (read-only quality + cost snapshots; see `cli/manifest.ts`).
 *
 * The bare-noun and `run` verb resolve to the SAME handler, so both share one loader (one module fetch).
 * Meta rides here so enumeration stays import-free; the command module loads only when dispatched.
 */
import { AUDIT_HYGIENE_USAGE } from "../commands/audit/hygieneUsage.js";
import { AUDIT_PUBLICATIONS_USAGE } from "../commands/audit/publicationsUsage.js";
import { AUDIT_REFERENCES_USAGE } from "../commands/audit/referencesUsage.js";
import { DEFAULT_VERB, lazy, type VerbManifestEntry } from "../manifest.js";

/** Shared meta for the bare-noun + `run` verb; both resolve to the same audit handler. */
const auditMeta = {
  createsWorkItem: false,
  diagnostic: true,
  doorRouted: false,
  dryParseSafe: false,
  effect: "none",
  example: "slopweaver audit",
  parseRejectIsIoFree: true,
  summary: "Read-only quality + cost snapshot of the local world model (no network, no tokens)",
  usage: "usage: slopweaver audit [--json] [--home <dir>]",
} as const;

/** Lazy loader for the shared audit handler — one module fetch, reused across the bare-noun + `run` verb. */
const loadAudit = () => import("../commands/audit/run.js").then((m) => m.auditRunCommand);

/** The `audit` noun's verbs as lazy manifest entries. */
export const auditManifest: Readonly<Record<string, VerbManifestEntry>> = {
  [DEFAULT_VERB]: lazy({ load: loadAudit, meta: auditMeta }),
  hygiene: lazy({
    load: () => import("../commands/audit/hygieneRun.js").then((m) => m.auditHygieneCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: true,
      doorRouted: false,
      // A bare `audit hygiene` is a valid whole-corpus scan, so it is not no-args-safe; its REJECT path is.
      dryParseSafe: false,
      effect: "none",
      example: "slopweaver audit hygiene --source gmail",
      parseRejectIsIoFree: true,
      summary: "Run the leak-class patterns and the private denylist over the bronze corpus on disk",
      usage: AUDIT_HYGIENE_USAGE,
    },
  }),
  publications: lazy({
    load: () => import("../commands/audit/publicationsRun.js").then((m) => m.auditPublicationsCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: true,
      // Its provider reads go through each door's own read seam, like `github exposure`; it writes nothing out.
      doorRouted: false,
      // A bare `audit publications` reads every thread on the repository, so it is not no-args-safe; its REJECT path is.
      dryParseSafe: false,
      // `--fire` adds the `publication-leak` pass's floating notes and Queue cards: local state, as `monitor check`'s are.
      effect: "local-state",
      example: "slopweaver audit publications --json",
      parseRejectIsIoFree: true,
      summary:
        "Read back what the fleet published and judge it with the outbound privacy check; counts only, each finding (class, door, link) written 0600 for the publication-leak monitor",
      usage: AUDIT_PUBLICATIONS_USAGE,
    },
  }),
  references: lazy({
    load: () => import("../commands/audit/referencesRun.js").then((m) => m.auditReferencesCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: true,
      doorRouted: false,
      // A bare `audit references` exports, scans and publishes, so it is not no-args-safe; its REJECT path is.
      dryParseSafe: false,
      effect: "local-state",
      example: "slopweaver audit references --list",
      parseRejectIsIoFree: true,
      summary:
        "Export main as a zip with no .git, scan every file and file name for a reference to the organisation, count by class, and re-render the zero-references-proof page",
      usage: AUDIT_REFERENCES_USAGE,
    },
  }),
  run: lazy({ load: loadAudit, meta: auditMeta }),
};
