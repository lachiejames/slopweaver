/**
 * Reading each live row's text for the supersession pass.
 *
 * A second read of each doc — the board scan discards the text, and supersession is a claim about what one
 * row's prose NAMES. `handover list` makes the same second read for its file-collision warning, for the same
 * reason and at the same cost.
 */
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";

import type { JournalEvidence } from "../../../handover/assemble.js";
import { hasUnansweredDispatch } from "../../../handover/attention.js";
import type { HandoverDoc } from "../../../handover/doc.js";
import { scanBoard } from "../../../handover/store.js";
import { topupAskRepo } from "../../../review/vulnTopupBatchRead.js";
import {
  type GenerationInput,
  generationBriefReads,
  generationSupersessionEdges,
  mergeSupersessionEdges,
  type SupersessionEdge,
  type SupersessionInput,
  supersessionEdges,
} from "../../../sweep/supersession.js";

/**
 * Every supersession edge the sweep honours, the one composition `sweep board` and `sweep apply` share.
 *
 * Declared edges read the LIVE rows' text, because a declaration counts only from a newer live row. The
 * generation edges read every SCANNED doc, settled ones included, AND the archive: the newest generation is
 * usually settled already and is still the evidence the top-up moved on, and a settled generation is swept
 * into `handovers/archive/` while an older one it overtakes can still sit live (as `topupBoard.ts`
 * already reads it for the merge-release gate).
 *
 * A row with a dispatch nothing has answered takes no generation edge: a seat `cmux spawn` opened is on it
 * before its `handover start`, while the row still reads RUN NOW.
 *
 * @param docs every doc the board scan read
 * @param live the composed rows still live
 * @param journals each live row's journal, read for an unanswered dispatch
 * @param handoverDir the board directory, whose `archive/` is read for generations
 * @returns the merged edges, every live slug whose text did not read, and every archive file that did not
 */
export function boardSupersessions({
  docs,
  live,
  journals,
  handoverDir,
}: {
  docs: readonly Pick<HandoverDoc, "askedIso" | "problems" | "slug" | "summary">[];
  live: readonly { readonly doc: Pick<HandoverDoc, "askedIso" | "path" | "slug"> }[];
  journals: ReadonlyMap<string, Pick<JournalEvidence, "events">>;
  handoverDir: string;
}): {
  readonly edges: ReadonlyMap<string, SupersessionEdge>;
  readonly unreadable: readonly string[];
  readonly archiveUnreadable: readonly string[];
} {
  const texts = readRowTexts({ models: live });
  const archive = scanBoard({ handoverDir: join(handoverDir, "archive") });
  // An archive that will not read is reported, never read as an empty one: fewer generations only ever means
  // fewer edges, and the caller that must not publish a partial board sees why.
  const archived = archive.isOk() ? archive.value.docs : [];
  const archiveUnreadable = archive.isOk()
    ? archive.value.unreadable
    : [`the archive itself (${archive.error.message})`];
  const allGenerated = generationSupersessionEdges({
    rows: [
      ...docs.map((doc) => generationRow({ doc, filedAsSlug: true })),
      ...archived.map((doc) => generationRow({ doc, filedAsSlug: basename(doc.path) === `${doc.slug}.md` })),
    ],
  });
  const generated = new Map(
    [...allGenerated].filter(([slug]) => {
      const journal = journals.get(slug);
      return journal === undefined || !hasUnansweredDispatch({ events: journal.events });
    }),
  );
  return {
    edges: mergeSupersessionEdges({ declared: supersessionEdges({ rows: texts.inputs }), generated }),
    archiveUnreadable,
    unreadable: texts.unreadable,
  };
}

/**
 * One scanned doc as the generation pass reads it. Every parsed doc is passed, so each still COUNTS against a
 * slug's uniqueness; only a trusted one may carry evidence. Trusted means its front matter has no
 * problems — a CONTRADICTION the board trusts none of (`boardEvidence.ts`) — and it is filed as `<slug>.md`,
 * the one archived shape `handover settle --as filed` resolves (`registerWrite.ts` records that an archived doc
 * can carry its slug under another name).
 *
 * @param doc the scanned doc
 * @param filedAsSlug whether its file is named for its own slug; a live row's always is for this purpose
 * @returns the generation input
 */
function generationRow({
  doc,
  filedAsSlug,
}: {
  doc: Pick<HandoverDoc, "askedIso" | "problems" | "slug" | "summary">;
  filedAsSlug: boolean;
}): GenerationInput {
  const trusted = doc.problems.length === 0 && filedAsSlug;
  // A doc with no summary names no repository and no batch, so it can only count against its slug's uniqueness.
  if (doc.summary === undefined) {
    return { askedIso: doc.askedIso, briefReads: false, repo: undefined, slug: doc.slug, trusted };
  }
  const repo = topupAskRepo({ ask: doc.summary });
  return {
    askedIso: doc.askedIso,
    briefReads: generationBriefReads({ repo, slug: doc.slug, summary: doc.summary }),
    repo,
    slug: doc.slug,
    trusted,
  };
}

/**
 * One supersession input per row whose text could be read, and the slugs of those that could not.
 *
 * A row whose file cannot be read supersedes nothing and is superseded by nothing — inventing an edge from an
 * absent file would be worse than the omission — but the file may have gone between the scan and this read,
 * so the omission is returned for a caller that must not publish a partial board.
 *
 * @param models the composed live rows
 * @returns the inputs, in the models' order, and every slug whose text did not read
 */
export function readRowTexts({
  models,
}: {
  models: readonly { readonly doc: Pick<HandoverDoc, "askedIso" | "path" | "slug"> }[];
}): {
  readonly inputs: readonly SupersessionInput[];
  readonly unreadable: readonly string[];
} {
  const inputs: SupersessionInput[] = [];
  const unreadable: string[] = [];
  for (const model of models) {
    try {
      inputs.push({
        askedIso: model.doc.askedIso,
        slug: model.doc.slug,
        text: readFileSync(model.doc.path, "utf8"),
      });
    } catch {
      unreadable.push(model.doc.slug);
    }
  }
  return { inputs, unreadable };
}
