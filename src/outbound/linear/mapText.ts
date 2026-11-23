/**
 * Walking every AUTHORED markdown string in a Linear body, and rewriting it.
 *
 * Two gates now rewrite prose on its way through this door — `./bareRefLinks.ts` turns `#N` into a link,
 * `./mentionRewrite.ts` turns `@{key}` into Linear's mention markup — and both have to reach exactly the
 * same set of fields. Two copies of this fan-out is the failure `../artifact/runs.ts` records one level up:
 * one copy forgets a nested list item and a whole class of content stops being rewritten, silently, in the
 * only region a reader was going to look. So the fan-out is written once and the REWRITE is the parameter.
 *
 * What counts as an authored string is a judgement this file owns, and it matches what `./schema.ts`
 * structurally checks:
 *
 *  - **In**: paragraphs, headings, list items and anything nested under them, checklist items, the
 *    structured kind's `acceptance` strings, a `details` fold's title and blocks, a comment's or update's
 *    `summary`.
 *  - **Out**: a `code` block, whose content is literal by construction — the renderer fences it so nothing
 *    inside is parsed as anything — and a `media` block's `alt`, which is a label rather than authored
 *    prose. Same call `../voice/aboveFold.ts` already makes for both.
 */
import type { BareRefIssue } from "../linkify/bareRefs.js";

import type { LinearCommentArtifact } from "./commentTypes.js";
import type { LinearProjectUpdateArtifact } from "./projectUpdateTypes.js";
import type {
  BulletsBlock,
  DetailsBlock,
  FreeformBlock,
  LinearIssueArtifact,
  ListItem,
  NestedBlock,
  SectionBlock,
  StructuredIssue,
} from "./types.js";

/** One authored string, rewritten, plus whatever the rewrite wants reported about it. */
interface MappedText {
  readonly text: string;
  readonly issues: readonly BareRefIssue[];
}

/**
 * The rewrite one gate applies to a single authored string.
 *
 * It receives the field's own path so an issue it reports addresses the exact field a caller has to fix.
 */
export type TextMapper = (args: { text: string; path: readonly (string | number)[] }) => MappedText;

/** One block, rewritten, plus its issues. */
interface BlockResult<B> {
  readonly block: B;
  readonly issues: readonly BareRefIssue[];
}

/** One markdown text field, rewritten, with its residue addressed at `[...path, "text"]`. */
function mapTextField({
  text,
  map,
  path,
}: {
  text: string;
  map: TextMapper;
  path: readonly (string | number)[];
}): MappedText {
  return map({ path: [...path, "text"], text });
}

/** A list item's own text, plus anything nested under it. */
function mapListItem({ item, map, path }: { item: ListItem; map: TextMapper; path: readonly (string | number)[] }): {
  readonly item: ListItem;
  readonly issues: readonly BareRefIssue[];
} {
  const own = mapTextField({ map, path, text: item.text });
  if (item.nested === undefined) {
    return { issues: own.issues, item: { ...item, text: own.text } };
  }
  const nested = item.nested.map((block, index) => mapNestedBlock({ block, map, path: [...path, "nested", index] }));
  return {
    issues: [...own.issues, ...nested.flatMap((result) => result.issues)],
    item: { ...item, nested: nested.map((result) => result.block), text: own.text },
  };
}

/** A block that may sit under a list item: prose, media, code or a checklist — never a heading or a bullet list. */
function mapNestedBlock({
  block,
  map,
  path,
}: {
  block: NestedBlock;
  map: TextMapper;
  path: readonly (string | number)[];
}): BlockResult<NestedBlock> {
  if (block.kind === "para") {
    const mapped = mapTextField({ map, path, text: block.text });
    return { block: { ...block, text: mapped.text }, issues: mapped.issues };
  }
  if (block.kind === "code" || block.kind === "media") {
    return { block, issues: [] };
  }
  const results = block.items.map((item, index) => {
    const mapped = mapTextField({ map, path: [...path, "items", index], text: item.text });
    return { issues: mapped.issues, item: { ...item, text: mapped.text } };
  });
  return {
    block: { ...block, items: results.map((result) => result.item) },
    issues: results.flatMap((result) => result.issues),
  };
}

/** A bulleted list: each item's own text, plus anything nested under it. */
function mapBulletsBlock({
  block,
  map,
  path,
}: {
  block: BulletsBlock;
  map: TextMapper;
  path: readonly (string | number)[];
}): BlockResult<BulletsBlock> {
  const results = block.items.map((item, index) => mapListItem({ item, map, path: [...path, "items", index] }));
  return {
    block: { ...block, items: results.map((result) => result.item) },
    issues: results.flatMap((result) => result.issues),
  };
}

/** One block a named section may hold — prose, a bulleted list, media, code or a checklist. */
function mapSectionBlock({
  block,
  map,
  path,
}: {
  block: SectionBlock;
  map: TextMapper;
  path: readonly (string | number)[];
}): BlockResult<SectionBlock> {
  return block.kind === "bullets" ? mapBulletsBlock({ block, map, path }) : mapNestedBlock({ block, map, path });
}

/** {@link mapSectionBlock} over a whole section. */
function mapSectionBlocks({
  blocks,
  map,
  field,
}: {
  blocks: readonly SectionBlock[];
  map: TextMapper;
  field: string;
}): { readonly blocks: readonly SectionBlock[]; readonly issues: readonly BareRefIssue[] } {
  const results = blocks.map((block, index) => mapSectionBlock({ block, map, path: [field, index] }));
  return { blocks: results.map((result) => result.block), issues: results.flatMap((result) => result.issues) };
}

/** One block a freeform body may hold — a {@link SectionBlock}, or the heading only that kind may control. */
function mapFreeformBlock({
  block,
  map,
  path,
}: {
  block: FreeformBlock;
  map: TextMapper;
  path: readonly (string | number)[];
}): BlockResult<FreeformBlock> {
  if (block.kind === "heading") {
    const mapped = mapTextField({ map, path, text: block.text });
    return { block: { ...block, text: mapped.text }, issues: mapped.issues };
  }
  return mapSectionBlock({ block, map, path });
}

/** {@link mapFreeformBlock} over a whole freeform body. */
function mapFreeformBlocks({
  blocks,
  map,
  field,
}: {
  blocks: readonly FreeformBlock[];
  map: TextMapper;
  field: string;
}): { readonly blocks: readonly FreeformBlock[]; readonly issues: readonly BareRefIssue[] } {
  const results = blocks.map((block, index) => mapFreeformBlock({ block, map, path: [field, index] }));
  return { blocks: results.map((result) => result.block), issues: results.flatMap((result) => result.issues) };
}

/**
 * Rewrite every authored string in a whole Linear issue body — structured or freeform.
 *
 * @param artifact the composed issue body
 * @param map the rewrite to apply to every authored string
 * @returns the rewritten artifact, plus everything the rewrite reported
 */
export function mapIssueArtifactText({ artifact, map }: { artifact: LinearIssueArtifact; map: TextMapper }): {
  readonly artifact: LinearIssueArtifact;
  readonly issues: readonly BareRefIssue[];
} {
  const aiPrompt = mapSectionBlocks({ blocks: artifact.aiPrompt, field: "aiPrompt", map });
  const details = mapDetails({ details: artifact.details, map });
  if (artifact.kind === "freeform") {
    const body = mapFreeformBlocks({ blocks: artifact.body, field: "body", map });
    return {
      artifact: { ...artifact, aiPrompt: aiPrompt.blocks, body: body.blocks, ...details.fields },
      issues: [...body.issues, ...details.issues, ...aiPrompt.issues],
    };
  }
  const problem = mapSectionBlocks({ blocks: artifact.problem, field: "problem", map });
  const solution = mapSectionBlocks({ blocks: artifact.solution, field: "solution", map });
  const proofOfProblem = mapProofOfProblem({ artifact, map });
  const acceptance = mapAcceptance({ artifact, map });
  return {
    artifact: {
      ...artifact,
      aiPrompt: aiPrompt.blocks,
      ...acceptance.fields,
      ...details.fields,
      problem: problem.blocks,
      ...proofOfProblem.fields,
      solution: solution.blocks,
    },
    issues: [
      ...problem.issues,
      ...solution.issues,
      ...aiPrompt.issues,
      ...proofOfProblem.issues,
      ...acceptance.issues,
      ...details.issues,
    ],
  };
}

/**
 * Either kind's optional `details` folds, rewritten: each title like a heading, each fold's blocks like a
 * section. An issue declaring no folds carries no such key and has nothing in it to report.
 */
function mapDetails({ details, map }: { details: readonly DetailsBlock[] | undefined; map: TextMapper }): {
  readonly fields: { readonly details?: readonly DetailsBlock[] };
  readonly issues: readonly BareRefIssue[];
} {
  if (details === undefined) {
    return { fields: {}, issues: [] };
  }
  const results = details.map((fold, index) => {
    const title = map({ path: ["details", index, "title"], text: fold.title });
    const blocks = fold.blocks.map((block, blockIndex) =>
      mapSectionBlock({ block, map, path: ["details", index, "blocks", blockIndex] }),
    );
    return {
      fold: { blocks: blocks.map((result) => result.block), title: title.text },
      issues: [...title.issues, ...blocks.flatMap((result) => result.issues)],
    };
  });
  return {
    fields: { details: results.map((result) => result.fold) },
    issues: results.flatMap((result) => result.issues),
  };
}

/**
 * The structured kind's optional `proofOfProblem` section, rewritten. An issue that offers no proof carries no
 * such key and has nothing in it to report, so the rewrite adds neither.
 */
function mapProofOfProblem({ artifact, map }: { artifact: StructuredIssue; map: TextMapper }): {
  readonly fields: { readonly proofOfProblem?: readonly SectionBlock[] };
  readonly issues: readonly BareRefIssue[];
} {
  if (artifact.proofOfProblem === undefined) {
    return { fields: {}, issues: [] };
  }
  const mapped = mapSectionBlocks({ blocks: artifact.proofOfProblem, field: "proofOfProblem", map });
  return { fields: { proofOfProblem: mapped.blocks }, issues: mapped.issues };
}

/**
 * The structured kind's optional `acceptance` strings, rewritten. An issue that declares no acceptance criteria
 * carries no such key and has no item to report, so the rewrite adds neither.
 */
function mapAcceptance({ artifact, map }: { artifact: StructuredIssue; map: TextMapper }): {
  readonly fields: { readonly acceptance?: readonly string[] };
  readonly issues: readonly BareRefIssue[];
} {
  if (artifact.acceptance === undefined) {
    return { fields: {}, issues: [] };
  }
  const results = artifact.acceptance.map((text, index) => mapTextField({ map, path: ["acceptance", index], text }));
  return {
    fields: { acceptance: results.map((result) => result.text) },
    issues: results.flatMap((result) => result.issues),
  };
}

/**
 * Rewrite every authored string in a document body — the same freeform blocks an issue's freeform body holds,
 * addressed under `content`.
 *
 * @param content the document's blocks
 * @param map the rewrite to apply to every authored string
 * @returns the rewritten blocks, plus everything the rewrite reported
 */
export function mapDocumentContentText({ content, map }: { content: readonly FreeformBlock[]; map: TextMapper }): {
  readonly content: readonly FreeformBlock[];
  readonly issues: readonly BareRefIssue[];
} {
  const mapped = mapFreeformBlocks({ blocks: content, field: "content", map });
  return { content: mapped.blocks, issues: mapped.issues };
}

/**
 * Rewrite every authored string in a comment: its summary, and its detail blocks.
 *
 * @param artifact the composed comment
 * @param map the rewrite to apply to every authored string
 * @returns the rewritten artifact, plus everything the rewrite reported
 */
export function mapCommentArtifactText({ artifact, map }: { artifact: LinearCommentArtifact; map: TextMapper }): {
  readonly artifact: LinearCommentArtifact;
  readonly issues: readonly BareRefIssue[];
} {
  const summary = mapTextField({ map, path: ["summary"], text: artifact.summary });
  if (artifact.detail === undefined) {
    return { artifact: { ...artifact, summary: summary.text }, issues: summary.issues };
  }
  const detail = mapSectionBlocks({ blocks: artifact.detail, field: "detail", map });
  return {
    artifact: { ...artifact, detail: detail.blocks, summary: summary.text },
    issues: [...summary.issues, ...detail.issues],
  };
}

/**
 * Rewrite every authored string in a project update: its summary, and its detail blocks.
 *
 * @param artifact the validated project-update body
 * @param map the rewrite to apply to every authored string
 * @returns the rewritten artifact, plus everything the rewrite reported
 */
export function mapProjectUpdateArtifactText({
  artifact,
  map,
}: {
  artifact: LinearProjectUpdateArtifact;
  map: TextMapper;
}): { readonly artifact: LinearProjectUpdateArtifact; readonly issues: readonly BareRefIssue[] } {
  const summary = mapTextField({ map, path: ["summary"], text: artifact.summary });
  if (artifact.detail === undefined) {
    return { artifact: { ...artifact, summary: summary.text }, issues: summary.issues };
  }
  const detail = mapSectionBlocks({ blocks: artifact.detail, field: "detail", map });
  return {
    artifact: { ...artifact, detail: detail.blocks, summary: summary.text },
    issues: [...summary.issues, ...detail.issues],
  };
}
