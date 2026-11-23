/**
 * The ONE classification of every outbound write family against the outbound privacy check
 * (`src/outbound/privacyCheck.ts`'s `checkPrivacy`), read by the `outbound-privacy-closure` gate
 * (`./outboundPrivacyClosure.ts`), which says what is enforced over it and what slips past.
 *
 * A family is one provider write surface: the verbs that reach it, the sanctioned SDK factories that build its
 * clients, and the transport roots every write of it crosses. It is exactly one of three things:
 *
 * - **guarded** — every root reaches one of `checks` through its static runtime imports, and each check module
 *   calls `checkPrivacy`;
 * - **read-only** — a sanctioned factory whose client cannot write, named so the factory inventory closes;
 * - **residue** — a write surface the check does not judge yet, with the reason it is named rather than closed.
 *
 * A landing guard flips its row from `residue` to `guarded` and nothing else; the gate refuses a residue row whose
 * every root already reaches the check, so a dead residue row cannot linger.
 */

/** Which external-write verbs of one noun a family covers: named verbs, or all of them. */
export interface ExternalWriteSelector {
  readonly noun: string;
  readonly verbs: readonly string[] | "all";
}

/** Whether, and how, a family's writes are judged by the privacy check today. */
type OutboundPrivacyClassification =
  | {
      readonly kind: "guarded";
      /** Repo-relative modules that call `checkPrivacy` for this family. */
      readonly checks: readonly string[];
    }
  | { readonly kind: "read-only"; readonly reason: string }
  | { readonly kind: "residue"; readonly reason: string };

/** One outbound write family. */
export interface OutboundWriteFamily {
  readonly id: string;
  readonly selectors: readonly ExternalWriteSelector[];
  /** Keys of `SANCTIONED_CLIENT_FACTORIES` this family owns; every key is owned by exactly one family. */
  readonly factories: readonly string[];
  /** Repo-relative roots: the final SDK client, `fetch` or relay every write of the family crosses. */
  readonly transports: readonly string[];
  readonly classification: OutboundPrivacyClassification;
}

const GUARDED_FAMILIES: readonly OutboundWriteFamily[] = [
  {
    classification: {
      checks: ["src/outbound/github/writePrivacyPayload.ts", "src/outbound/publicationScan.ts"],
      kind: "guarded",
    },
    factories: ["src/corpus/github/writeCtx.ts"],
    id: "github",
    selectors: [{ noun: "github", verbs: "all" }],
    // `attachDeps.ts`, not `attachClient.ts`: the attach fetch is bound to its publication scan there, the one
    // place every `github attach` upload is composed.
    transports: ["src/corpus/github/writeCtx.ts", "src/cli/commands/github/attachDeps.ts"],
  },
  {
    classification: { checks: ["src/outbound/slack/writePrivacyPayload.ts"], kind: "guarded" },
    factories: [
      "src/corpus/slack/writeApi.ts",
      "src/corpus/slack/atMostOnceClient.ts",
      "src/corpus/slack/writeApiAccount.ts",
    ],
    id: "slack",
    selectors: [
      { noun: "slack", verbs: "all" },
      { noun: "listen", verbs: "all" },
      { noun: "turn", verbs: "all" },
      { noun: "witness", verbs: "all" },
      { noun: "queue", verbs: ["release"] },
      { noun: "vulnerability-fix", verbs: ["digest"] },
    ],
    transports: ["src/corpus/slack/guardedWebClient.ts"],
  },
  {
    classification: { checks: ["src/outbound/linear/writePrivacyPayload.ts"], kind: "guarded" },
    factories: ["src/corpus/linear/write.ts"],
    id: "linear",
    selectors: [
      { noun: "linear", verbs: "all" },
      { noun: "proposal", verbs: ["publish"] },
    ],
    transports: ["src/corpus/linear/writeGraphql.ts", "src/outbound/linear/assetUpload.ts"],
  },
  {
    classification: { checks: ["src/outbound/notion/writePrivacyPayload.ts"], kind: "guarded" },
    factories: ["src/corpus/notion/writeApi.ts"],
    id: "notion",
    selectors: [
      { noun: "notion", verbs: "all" },
      { noun: "sop", verbs: ["publish"] },
      { noun: "proposal", verbs: ["publish"] },
    ],
    transports: ["src/corpus/notion/guardedFetch.ts", "src/corpus/notion/mediaApi.ts"],
  },
  {
    classification: { checks: ["src/outbound/calendar/writePrivacyPayload.ts"], kind: "guarded" },
    factories: [],
    id: "google-calendar",
    selectors: [{ noun: "calendar", verbs: "all" }],
    transports: ["src/live/calendar/writeApi.ts"],
  },
  {
    classification: { checks: ["src/outbound/gmail/writePrivacyPayload.ts"], kind: "guarded" },
    factories: [],
    id: "gmail",
    selectors: [
      { noun: "gmail", verbs: "all" },
      { noun: "fathom", verbs: ["clear-inbox"] },
      { noun: "spend", verbs: ["forward"] },
    ],
    transports: ["src/live/gmail/client.ts", "src/live/gmail/unsubscribe.ts"],
  },
];

const READ_ONLY_FAMILIES: readonly OutboundWriteFamily[] = [
  {
    classification: {
      kind: "read-only",
      reason: "Slack read clients: the read seam, the structural lane and the bounded one-shot lookups and probe",
    },
    factories: [
      "src/corpus/slack/api.ts",
      "src/corpus/slack/structures.ts",
      "src/corpus/slack/workspaceLookupOnce.ts",
      "src/cli/commands/slack/uploadReadiness.ts",
      "src/cli/commands/slack/wallRunRead.ts",
      "src/cli/commands/slack/highStakesRead.ts",
      "src/cli/commands/slack/probeRun.ts",
    ],
    id: "slack-read",
    selectors: [],
    transports: [],
  },
  {
    classification: { kind: "read-only", reason: "the single Linear read client every read lane shares" },
    factories: ["src/corpus/linear/transport.ts"],
    id: "linear-read",
    selectors: [],
    transports: [],
  },
  {
    classification: { kind: "read-only", reason: "the Notion read and structural lanes" },
    factories: ["src/corpus/notion/liveApi.ts", "src/corpus/notion/structures.ts"],
    id: "notion-read",
    selectors: [],
    transports: [],
  },
  {
    classification: {
      kind: "read-only",
      reason: "the connect probes test a token with a read before any seam trusts it",
    },
    factories: ["src/connect/probes.ts"],
    id: "connect-probes",
    selectors: [],
    transports: [],
  },
];

const RESIDUE_FAMILIES: readonly OutboundWriteFamily[] = [
  {
    classification: { kind: "residue", reason: "Outlook mail writes through Microsoft Graph have no guard yet" },
    factories: ["src/live/outlook/client.ts"],
    id: "outlook-mail",
    selectors: [{ noun: "outlook", verbs: "all" }],
    transports: ["src/live/outlook/apiWrite.ts"],
  },
  {
    classification: {
      kind: "residue",
      reason: "Datadog metric, monitor, triage and HMI writes land in the organisation's own monitoring, unguarded",
    },
    factories: [],
    id: "datadog",
    selectors: [{ noun: "datadog", verbs: "all" }],
    transports: [
      "src/datadog/seriesSubmit.ts",
      "src/cli/commands/datadog/monitorRun.ts",
      "src/cli/commands/datadog/triageRun.ts",
      "src/cli/commands/datadog/hmiRun.ts",
    ],
  },
  {
    classification: {
      kind: "residue",
      reason: "an email routing rule carries an address and a destination, not authored text; no guard yet",
    },
    factories: [],
    id: "cloudflare-email-routing",
    selectors: [{ noun: "alias", verbs: "all" }],
    transports: ["src/cli/commands/alias/run.ts"],
  },
  {
    classification: { kind: "residue", reason: "GCP resource writes configure infrastructure; no guard yet" },
    factories: [],
    id: "gcp",
    selectors: [{ noun: "gcp", verbs: "all" }],
    transports: ["src/cli/commands/gcp/gcpRun.ts"],
  },
  {
    classification: {
      kind: "residue",
      reason: "a browser action can type into any registered page; the page policy is not the privacy check",
    },
    factories: [],
    id: "browser",
    selectors: [{ noun: "browser", verbs: "all" }],
    transports: ["src/browser/action.ts"],
  },
  {
    classification: { kind: "residue", reason: "Vanta Manage API writes have no guard yet" },
    factories: [],
    id: "vanta",
    selectors: [{ noun: "write", verbs: ["vanta"] }],
    transports: ["src/atlas/vanta/writeTransport.ts"],
  },
  {
    classification: {
      kind: "residue",
      reason: "redeeming a plan's usage reset sends no authored text, so there is nothing for the check to read",
    },
    factories: [],
    id: "usage-reset",
    selectors: [
      { noun: "claude", verbs: ["reset"] },
      { noun: "codex", verbs: ["reset"] },
    ],
    transports: ["src/cli/commands/claude/resetRun.ts", "src/cli/commands/codex/resetRun.ts"],
  },
  {
    classification: {
      kind: "residue",
      reason:
        "Codex turns send prompts to the model provider, an egress the owner accepted, never a publication to a third party",
    },
    factories: ["src/codex/client.ts"],
    id: "codex-model",
    selectors: [],
    transports: [],
  },
  {
    classification: {
      kind: "residue",
      reason: "the manifest declares an outward write, but only a local path or file:// destination is accepted today",
    },
    factories: [],
    id: "store-backup",
    selectors: [{ noun: "store", verbs: ["backup"] }],
    transports: ["src/cli/commands/store/backup.ts"],
  },
];

/** Every outbound write family: guarded, read-only, then residue. */
export const OUTBOUND_PRIVACY_FAMILIES: readonly OutboundWriteFamily[] = [
  ...GUARDED_FAMILIES,
  ...READ_ONLY_FAMILIES,
  ...RESIDUE_FAMILIES,
];
