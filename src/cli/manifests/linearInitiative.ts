/**
 * The `linear initiative` and `linear initiative-update` verbs' manifest entries, declared apart from `./linear.ts`
 * and spread into it, so that file stays under the file-size cap — the split `./linearLabel.ts` makes for `labels`
 * and `label`. The two are different nouns for the same reason `project` and `project-update` are: Linear's own
 * API names an initiative's editor and its status report alike.
 */
import { lazy, type VerbManifestEntry } from "../manifest.js";

const INITIATIVE_USAGE =
  "usage: slopweaver linear initiative <create|update|link> --form <json|-> [--initiative-id <uuid>] " +
  "[--dry-run] [--json] [--home <dir>]\n" +
  "  create      file a new initiative; the id is DERIVED from the intent, so a retry after a lost\n" +
  "              response reuses it instead of filing a second initiative\n" +
  "  update      replace the fields from the form you supply; only initiatives slopweaver created\n" +
  "  link        file an existing project under an existing initiative; the link id is derived from the\n" +
  "              two endpoints, so the same project cannot be joined to the same initiative twice\n" +
  "  --dry-run   print the exact resolved fields and perform no effect";

const INITIATIVE_UPDATE_USAGE =
  "usage: slopweaver linear initiative-update create --form <json|-> [--dry-run] [--json] [--home <dir>]\n" +
  "  create      post one status update on an initiative; the id is DERIVED from the initiative, the\n" +
  "              declared health and the rendered body, so the same report cannot be posted twice\n" +
  "  --dry-run   print the exact body bytes and the declared health, and perform no effect";

export const linearInitiativeManifest: Readonly<Record<string, VerbManifestEntry>> = {
  initiative: lazy({
    load: () => import("../commands/linear/initiativeRun.js").then((m) => m.linearInitiativeCommand),
    meta: {
      // A new initiative is a plan a team notices unprompted, exactly as a new project is. `update` and
      // `link` touch things they already know about, but the meta is per VERB rather than per sub-verb, and
      // the widest arm is the honest one to declare.
      createsWorkItem: true,
      diagnostic: false,
      doorRouted: true,
      dryParseSafe: true,
      effect: "external-write",
      example: "slopweaver linear initiative create --form - --dry-run",
      parseRejectIsIoFree: true,
      summary: "Create or edit a Linear initiative, or file a project under one, from a typed form",
      usage: INITIATIVE_USAGE,
    },
  }),
  "initiative-update": lazy({
    load: () => import("../commands/linear/initiativeUpdateRun.js").then((m) => m.linearInitiativeUpdateCommand),
    meta: {
      // A status update creates nothing anyone has to triage — but every member watching the initiative is
      // notified, which is why it is approval-gated like every other send.
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: true,
      dryParseSafe: true,
      effect: "external-write",
      example: "slopweaver linear initiative-update create --form - --dry-run",
      parseRejectIsIoFree: true,
      summary: "Post one Linear initiative status update from a typed form — rendered by code, through the door",
      usage: INITIATIVE_UPDATE_USAGE,
    },
  }),
};
