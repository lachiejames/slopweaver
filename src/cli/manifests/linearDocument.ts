/**
 * The `linear document` verb's manifest entry, declared apart from `./linear.ts` and spread into it, so that
 * file stays under the file-size cap — the split `./githubCi.ts` makes for `github`.
 *
 * A document is the long-form page a proposal is written into, attached to a project, initiative, issue or
 * team. `create` is the work item a team notices unprompted, so the verb declares `createsWorkItem: true` —
 * the widest arm is the honest one, as `initiative` declares for its three.
 */
import { LINEAR_DOCUMENT_USAGE } from "../commands/linear/documentUsage.js";
import { lazy, type VerbManifestEntry } from "../manifest.js";

export const linearDocumentManifest: Readonly<Record<string, VerbManifestEntry>> = {
  document: lazy({
    load: () => import("../commands/linear/documentRun.js").then((m) => m.linearDocumentCommand),
    meta: {
      createsWorkItem: true,
      diagnostic: false,
      doorRouted: true,
      dryParseSafe: true,
      effect: "external-write",
      example: "slopweaver linear document create --form - --dry-run",
      parseRejectIsIoFree: true,
      summary: "Create or re-render a Linear document from a typed form — rendered by code, through the door",
      usage: LINEAR_DOCUMENT_USAGE,
    },
  }),
};
