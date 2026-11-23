/**
 * Lazy manifest for the `google` noun — Google Cloud credentials a seat needs but must never sign in for itself.
 * `adc` reads whether Application Default Credentials work, and waits on the owner's sign-in rather than running it;
 * `audit-log` reads Cloud Audit Logs over that credential, read-only, into a local generation.
 * Loads only when dispatched.
 */
import { GOOGLE_ADC_USAGE_LINE } from "../commands/google/adcUsage.js";
import { GOOGLE_AUDIT_LOG_USAGE_LINE } from "../commands/google/auditLogUsage.js";
import { lazy, type VerbManifestEntry } from "../manifest.js";

const adcMeta = {
  createsWorkItem: false,
  diagnostic: true,
  doorRouted: false,
  dryParseSafe: true,
  effect: "external-read",
  example: "slopweaver google adc --row review-17961 --wait --timeout-seconds 28800",
  parseRejectIsIoFree: true,
  summary:
    "Whether Google Application Default Credentials work — and when a sign-in is the fix, the one floating-note line for the supervisor and a wait on the owner's sign-in, never the sign-in itself",
  usage: GOOGLE_ADC_USAGE_LINE,
} as const;

const loadAdc = () => import("../commands/google/adc.js").then((m) => m.googleAdcCommand);

const auditLogMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  dryParseSafe: true,
  effect: "local-state",
  example:
    "slopweaver google audit-log pull --org 112233445566 --quota-project acme-local --since 2025-08-29T00:00:00Z --principal ada@acme.com --role roles/viewer",
  parseRejectIsIoFree: true,
  summary:
    "READ-ONLY: Cloud Audit Logs across a GCP organisation into a local generation — every principal's calls by service and method, the permissions Google recorded, the retention and sinks that bound what Logging still holds — and which exercised permissions a least-privilege plan would remove",
  usage: GOOGLE_AUDIT_LOG_USAGE_LINE,
} as const;

const loadAuditLog = () => import("../commands/google/auditLog.js").then((m) => m.googleAuditLogCommand);

export const googleManifest: Readonly<Record<string, VerbManifestEntry>> = {
  adc: lazy({ load: loadAdc, meta: adcMeta }),
  "audit-log": lazy({ load: loadAuditLog, meta: auditLogMeta }),
};
