/**
 * The Alignment board projection's rows, derived from the composed board with the very helpers `boardJsonRow`
 * (`./listJson.ts`) publishes those fields with — so the projection and `handover list --json` cannot disagree
 * about a row's section, run, tags, links or action, which is everything that places an act.
 *
 * Here rather than in `src/handover/alignmentBoardProjection.ts` because those helpers live beside the `--json`
 * lane; the schema, parser and renderer stay in the handover tree with the store.
 */

import {
  ALIGNMENT_BOARD_PROJECTION_SCHEMA_VERSION,
  type AlignmentBoardProjection,
  type AlignmentBoardProjectionRow,
} from "../../../handover/alignmentBoardProjection.js";
import type { BoardModel } from "../../../handover/boardTypes.js";
import { actionOf, mailPreviewFor } from "./listJsonAsk.js";
import { prUrlsIn } from "./listJsonRowText.js";
import { publishedWaitOf } from "./listJsonWait.js";

/**
 * One composed row's placement fields.
 *
 * @param model the doc's composed placement
 * @returns the projected row
 */
function projectionRowOf({ model }: { model: BoardModel }): AlignmentBoardProjectionRow {
  const { question } = publishedWaitOf({ model });
  const action = actionOf({ run: model.run });
  return {
    action: action === undefined ? undefined : { ...action },
    actionUnreadable: model.run.kind === "waiting-on-owner" && model.run.actionUnreadable,
    mailPreview: mailPreviewFor({ action, slug: model.doc.slug }),
    prUrls: prUrlsIn({ parts: [model.doc.summary, question, model.reason] }),
    run: model.run.kind,
    section: model.section,
    slug: model.doc.slug,
    tags: model.tags.tags,
    tagsIncomplete: model.tagsIncomplete,
    unrecognisedTags: model.tags.unrecognised.map(({ key, value }) => ({ key, value })),
    workspace: model.doc.workspace,
    workspaceUnread: model.doc.workspaceUnread,
  };
}

/**
 * Project every composed row — closed sections included — into the Alignment board projection.
 *
 * @param models every doc's composed placement, in board order
 * @param builtAtIso when the composition finished
 * @param scanStartedIso when the doc scan behind it began
 * @returns the projection, ready to write or print
 */
export function alignmentBoardProjectionOf({
  models,
  builtAtIso,
  scanStartedIso,
}: {
  models: readonly BoardModel[];
  builtAtIso: string;
  scanStartedIso: string;
}): AlignmentBoardProjection {
  return {
    builtAtIso,
    rows: models.map((model) => projectionRowOf({ model })),
    scanStartedIso,
    schemaVersion: ALIGNMENT_BOARD_PROJECTION_SCHEMA_VERSION,
  };
}
