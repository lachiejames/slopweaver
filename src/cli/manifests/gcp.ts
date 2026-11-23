/**
 * The `gcp` noun — the door a seat's Google Cloud reads and writes go through instead of raw `gcloud`. One verb
 * per resource family, each taking an action: `run describe|deploy`, `secret describe|access|create|
 * add-version|disable-version|add-iam-policy-binding`, `service-account describe|create`, `services
 * describe|enable`, `artifacts describe|create`.
 *
 * Every family can write, so each is `effect: "external-write"` + `doorRouted: true`, and every write
 * `requiresApproval`: a write is sent only with `--approve` carrying the digest a preview printed of exactly
 * those steps, and a step changing something that already exists also needs `--edit-existing "<why>"`. A
 * describe, an access, and every write without `--approve`, only reads.
 */
import {
  GCP_ARTIFACTS_USAGE,
  GCP_RUN_USAGE,
  GCP_SECRET_USAGE,
  GCP_SERVICE_ACCOUNT_USAGE,
  GCP_SERVICES_USAGE,
} from "../commands/gcp/gcpUsage.js";
import { lazy, type VerbManifestEntry } from "../manifest.js";

/** The `gcp` verbs, one per resource family. */
export const gcpManifest: Readonly<Record<string, VerbManifestEntry>> = {
  artifacts: lazy({
    load: () => import("../commands/gcp/gcpRun.js").then((m) => m.gcpArtifactsCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: true,
      dryParseSafe: true,
      effect: "external-write",
      example:
        "slopweaver gcp artifacts describe --project acme-security --region australia-southeast1 --repository acme-desktop",
      parseRejectIsIoFree: true,
      summary:
        "Read an Artifact Registry repository, or preview and create a new Docker repository behind an approval digest",
      usage: GCP_ARTIFACTS_USAGE,
    },
  }),
  run: lazy({
    load: () => import("../commands/gcp/gcpRun.js").then((m) => m.gcpRunCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: true,
      dryParseSafe: true,
      effect: "external-write",
      example:
        "slopweaver gcp run describe --project acme-security --region australia-southeast1 --service acme-desktop-api",
      parseRejectIsIoFree: true,
      summary:
        "Read a Cloud Run service and who may invoke it, or preview a deploy — a new service, or a new revision of an " +
        "existing one behind --edit-existing — and send it only with --approve",
      usage: GCP_RUN_USAGE,
    },
  }),
  secret: lazy({
    load: () => import("../commands/gcp/gcpRun.js").then((m) => m.gcpSecretCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: true,
      dryParseSafe: true,
      effect: "external-write",
      example: "slopweaver gcp secret describe --project acme-security --secret acme_desktop_vanta_client_id",
      parseRejectIsIoFree: true,
      summary:
        "Read a Secret Manager secret's versions and grants, access a payload as its length and sha256 (or to a new " +
        "0600 file), or preview and send a create, version add, version disable or one IAM member",
      usage: GCP_SECRET_USAGE,
    },
  }),
  "service-account": lazy({
    load: () => import("../commands/gcp/gcpRun.js").then((m) => m.gcpServiceAccountCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: true,
      dryParseSafe: true,
      effect: "external-write",
      example:
        "slopweaver gcp service-account describe --project acme-security --email acme-desktop-api@acme-security.iam.gserviceaccount.com",
      parseRejectIsIoFree: true,
      summary: "Read a service account, or preview and create a new one behind an approval digest",
      usage: GCP_SERVICE_ACCOUNT_USAGE,
    },
  }),
  services: lazy({
    load: () => import("../commands/gcp/gcpRun.js").then((m) => m.gcpServicesCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: true,
      dryParseSafe: true,
      effect: "external-write",
      example: "slopweaver gcp services describe --project acme-security --service run.googleapis.com",
      parseRejectIsIoFree: true,
      summary: "Read whether a Google API is enabled on a project, or preview and enable it behind an approval digest",
      usage: GCP_SERVICES_USAGE,
    },
  }),
};
