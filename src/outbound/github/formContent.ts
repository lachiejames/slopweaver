/**
 * Every authored cell of a C3 body, in reading order — the ONE walk over the form.
 *
 * The voice gate (`./aboveFold.ts`) and bare-reference linking (`./bareRefLinks.ts`) both need every cell a reader
 * sees, each addressed by the form path a caller fixes. Walking the body once here means a section added to the form
 * is seen by both, instead of escaping whichever walk forgot it.
 *
 * Above the fold is everything except the re-run fold. The plain sentences only a badge hover carries (the top risk's
 * worst case and check, what was seen or why not) are read as cells too, because a reader sees them on hover; they
 * are never REWRITTEN by {@link mapContentFields}, since a hover is plain text and cannot carry a link.
 */
import type { Content, PrBody, ProofSlot, RerunItem } from "./types.js";

/** A form path, as a schema issue spells it. */
export type ContentPath = readonly (string | number)[];

/** One authored cell: where it sits, its runs, and whether a reader sees it without expanding anything. */
export interface ContentField {
  readonly path: ContentPath;
  readonly content: Content;
  readonly fold: "above" | "below";
}

/** What a mapping is handed for each cell. */
interface MapInput {
  readonly path: ContentPath;
  readonly content: Content;
}

/** The rewrite applied to every cell. */
type CellMap = (input: MapInput) => Content;

/** A plain hover sentence read as a one-run cell. */
function hoverCell({ path, text }: { path: ContentPath; text: string }): ContentField {
  return { content: [{ kind: "text", text }], fold: "above", path };
}

/**
 * A proof slot's one authored cell. A quote's output and its source are not authored prose, so neither is a cell:
 * the output is somebody else's bytes, and the source is one link or code run the prose rules skip anyway.
 */
function slotField({ slot, field }: { slot: ProofSlot; field: string }): ContentField {
  if (slot.kind === "reason") {
    return { content: slot.reason, fold: "above", path: [field, "reason"] };
  }
  return { content: slot.proves, fold: "above", path: [field, "proves"] };
}

/** A re-run item's cells, below the fold; a command is not authored prose. */
function rerunFields({ item, index }: { item: RerunItem; index: number }): readonly ContentField[] {
  if (item.kind === "note") {
    return [{ content: item.content, fold: "below", path: ["rerun", index, "content"] }];
  }
  if (item.kind === "tests") {
    return item.items.map((content, at) => ({ content, fold: "below", path: ["rerun", index, "items", at] }));
  }
  return [];
}

/**
 * Every authored cell of a body, in the order a reader meets it.
 *
 * @returns each cell with its form path and fold side
 */
export function contentFieldsOf({ body }: { body: PrBody }): readonly ContentField[] {
  const seen = body.problemSeen;
  return [
    ...body.risk.items.flatMap((item, index) => [
      hoverCell({ path: ["risk", "items", index, "worst"], text: item.worst }),
      hoverCell({
        path: ["risk", "items", index, "check"],
        text: item.check.kind === "checked" ? item.check.check : item.check.why,
      }),
    ]),
    hoverCell({
      path: ["problemSeen", seen.kind === "seen" ? "what" : "why"],
      text: seen.kind === "seen" ? seen.what : seen.why,
    }),
    { content: body.explainer, fold: "above", path: ["explainer"] },
    slotField({ field: "problemProof", slot: body.problemProof }),
    slotField({ field: "solutionProof", slot: body.solutionProof }),
    ...body.checks.map((content, index): ContentField => ({ content, fold: "above", path: ["checks", index] })),
    ...body.notChecked.flatMap((item, index): ContentField[] => [
      { content: item.check, fold: "above", path: ["notChecked", index, "check"] },
      { content: item.why, fold: "above", path: ["notChecked", index, "why"] },
    ]),
    ...body.rerun.flatMap((item, index) => rerunFields({ index, item })),
  ];
}

/** A slot with its one cell mapped. */
function mapSlot({ slot, field, map }: { slot: ProofSlot; field: string; map: CellMap }): ProofSlot {
  if (slot.kind === "reason") {
    return { ...slot, reason: map({ content: slot.reason, path: [field, "reason"] }) };
  }
  return { ...slot, proves: map({ content: slot.proves, path: [field, "proves"] }) };
}

/** A re-run item with its cells mapped. */
function mapRerun({ item, index, map }: { item: RerunItem; index: number; map: CellMap }): RerunItem {
  if (item.kind === "note") {
    return { ...item, content: map({ content: item.content, path: ["rerun", index, "content"] }) };
  }
  if (item.kind === "tests") {
    return { ...item, items: item.items.map((content, at) => map({ content, path: ["rerun", index, "items", at] })) };
  }
  return item;
}

/**
 * Every content cell of a body rewritten by `map`, everything else kept. Hover sentences are plain text and are left
 * alone.
 *
 * @param body the body or form
 * @param map the rewrite, handed each cell and its path
 * @returns the body with every cell rewritten
 */
export function mapContentFields<B extends PrBody>({ body, map }: { body: B; map: CellMap }): B {
  const groups =
    body.checkGroups === undefined
      ? {}
      : {
          checkGroups: body.checkGroups.map((group, index) => ({
            items: group.items.map((content, at) => map({ content, path: ["checkGroups", index, "items", at] })),
            label: map({ content: group.label, path: ["checkGroups", index, "label"] }),
          })),
        };
  return {
    ...body,
    ...groups,
    checks: body.checks.map((content, index) => map({ content, path: ["checks", index] })),
    explainer: map({ content: body.explainer, path: ["explainer"] }),
    notChecked: body.notChecked.map((item, index) => ({
      check: map({ content: item.check, path: ["notChecked", index, "check"] }),
      why: map({ content: item.why, path: ["notChecked", index, "why"] }),
    })),
    problemProof: mapSlot({ field: "problemProof", map, slot: body.problemProof }),
    rerun: body.rerun.map((item, index) => mapRerun({ index, item, map })),
    solutionProof: mapSlot({ field: "solutionProof", map, slot: body.solutionProof }),
  };
}
