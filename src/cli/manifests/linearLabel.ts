/**
 * The `linear labels` and `linear label` verbs' manifest entries, declared apart from `./linear.ts` and spread
 * into it, so that file stays under the file-size cap — the split `./linearDocument.ts` makes for `document`.
 *
 * `labels` lists the label ids a team can apply and `label create` adds one. The issue and project forms
 * always carried `labelIds`, and without these two nothing could say which ids exist. A label
 * is vocabulary rather than work anyone triages, so the write declares `createsWorkItem: false`; it is still
 * an external write, because every member of the team sees it in their label picker.
 */
import { LINEAR_LABELS_USAGE } from "../commands/linear/labelsUsage.js";
import { LINEAR_LABEL_USAGE } from "../commands/linear/labelUsage.js";
import { lazy, type VerbManifestEntry } from "../manifest.js";

export const linearLabelManifest: Readonly<Record<string, VerbManifestEntry>> = {
  label: lazy({
    load: () => import("../commands/linear/labelRun.js").then((m) => m.linearLabelCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: true,
      dryParseSafe: true,
      effect: "external-write",
      example: "slopweaver linear label create --form - --dry-run",
      parseRejectIsIoFree: true,
      summary: "Add one issue label or project label to a team or the workspace, through the door",
      usage: LINEAR_LABEL_USAGE,
    },
  }),
  labels: lazy({
    load: () => import("../commands/linear/labelsRun.js").then((m) => m.linearLabelsCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      effect: "external-read",
      example: "slopweaver linear labels --team ENG --json",
      parseRejectIsIoFree: true,
      summary: "Read every issue label and project label one team can apply, each with its full id",
      usage: LINEAR_LABELS_USAGE,
    },
  }),
};
