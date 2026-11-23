/**
 * The SHAPE of an expanded Notion block tree, and what each raw block asks of the walk that builds it.
 *
 * `blockTree.ts` owns the walk — the order calls are spent in and the bounds that stop it. This module owns
 * everything that is true of one block or one finished tree without a call: whether a block is a leaf, a
 * named child object, malformed, or a list to read and from WHICH id; and, once the walk is done, the gaps it
 * left and the raw blocks in reading order. The synced-duplicate rule lives here because it is a fact about a
 * block, measured in `blockTree.ts`'s header.
 */
import { isRecord } from "../../lib/parsers.js";

/**
 * Whether one node is whole.
 *
 * `leaf` has no children; `complete` had every child listed; `linked-object` is a child page or database,
 * named and deliberately not read. The other four are gaps: `unreadable` (the integration cannot list it),
 * `budget` (a bound stopped it), `inconsistent` (Notion said more children follow and gave no new cursor)
 * and `cycle` (a synced reference back into its own ancestry).
 */
export type NotionNodeExpansion =
  "leaf" | "complete" | "linked-object" | "unreadable" | "budget" | "inconsistent" | "cycle";

/** One block as Notion returned it, plus the children listed beneath it and whether that list is whole. */
export interface NotionBlockNode {
  readonly block: unknown;
  readonly expansion: NotionNodeExpansion;
  readonly children: readonly NotionBlockNode[];
  /** Why this node is not whole; present on every gap and on nothing else. */
  readonly reason?: string;
}

/** A child page or database named in the tree, which a reader opens as its own object. */
export interface NotionLinkedObject {
  readonly kind: "page" | "database";
  readonly id: string;
  readonly title?: string;
  readonly url: string;
}

/** One node the expansion could not make whole. */
interface NotionUnexpandedBlock {
  readonly id: string;
  readonly type: string;
  readonly expansion: NotionNodeExpansion;
  readonly reason: string;
}

/** The claims about one read's nested expansion, structured so a caller never parses residue prose. */
export interface NotionNestedExpansion {
  readonly complete: boolean;
  readonly calls: number;
  readonly callLimit: number;
  readonly stoppedBy: "calls" | "time" | null;
  readonly unexpanded: readonly NotionUnexpandedBlock[];
  readonly linkedObjects: readonly NotionLinkedObject[];
}

/** What the walk does with one block. */
type BlockPlan =
  | { readonly kind: "leaf" }
  | { readonly kind: "linked"; readonly linked: NotionLinkedObject }
  | { readonly kind: "malformed" }
  | { readonly kind: "expand"; readonly sourceId: string };

/** The title a child page or database block carries, when it carries one. */
function childTitle({ block, type }: { block: Record<string, unknown>; type: string }): string | undefined {
  const body = block[type];
  return isRecord(body) && typeof body["title"] === "string" ? body["title"] : undefined;
}

/** The id a block's children are listed from: a synced DUPLICATE's original, any other block's own. */
function childSourceId({ block, id }: { block: Record<string, unknown>; id: string }): string {
  const synced = block["synced_block"];
  if (block["type"] !== "synced_block" || !isRecord(synced)) {
    return id;
  }
  const from = synced["synced_from"];
  return isRecord(from) && typeof from["block_id"] === "string" ? from["block_id"] : id;
}

/**
 * What to do with one block: leave it, name it, refuse it as malformed, or list its children from an id —
 * a synced duplicate's ORIGINAL id, since its own lists nothing.
 *
 * @param block one raw block exactly as Notion returned it
 * @returns the plan the walk follows for it
 */
export function planBlock({ block }: { block: unknown }): BlockPlan {
  if (!isRecord(block)) {
    return { kind: "malformed" };
  }
  const type = block["type"];
  const id = block["id"];
  if ((type === "child_page" || type === "child_database") && typeof id === "string") {
    const title = childTitle({ block, type });
    return {
      kind: "linked",
      linked: {
        id,
        kind: type === "child_page" ? "page" : "database",
        ...(title === undefined ? {} : { title }),
        url: `https://www.notion.so/${id.replaceAll("-", "")}`,
      },
    };
  }
  if (block["has_children"] !== true) {
    return { kind: "leaf" };
  }
  if (typeof id !== "string") {
    return { kind: "malformed" };
  }
  return { kind: "expand", sourceId: childSourceId({ block, id }) };
}

/** A string field of a raw block, or the placeholder naming its absence. */
function blockField({ block, field }: { block: unknown; field: "id" | "type" }): string {
  if (isRecord(block) && typeof block[field] === "string") {
    return block[field];
  }
  return `(no ${field})`;
}

/**
 * Every gap in the tree, in reading order.
 *
 * @param tree the finished nodes
 * @returns one entry per node carrying a reason, a parent before its children
 */
export function gapsIn({ tree }: { tree: readonly NotionBlockNode[] }): NotionUnexpandedBlock[] {
  const gaps: NotionUnexpandedBlock[] = [];
  for (const node of tree) {
    if (node.reason !== undefined) {
      gaps.push({
        expansion: node.expansion,
        id: blockField({ block: node.block, field: "id" }),
        reason: node.reason,
        type: blockField({ block: node.block, field: "type" }),
      });
    }
    gaps.push(...gapsIn({ tree: node.children }));
  }
  return gaps;
}

/**
 * Every raw block in the tree in reading order — a parent before its children — for a caller that scans
 * blocks rather than walking nodes (the file opener).
 *
 * @param tree the expanded nodes
 * @returns the raw blocks, depth first
 */
export function flattenBlockTree({ tree }: { tree: readonly NotionBlockNode[] }): readonly unknown[] {
  return tree.flatMap((node) => [node.block, ...flattenBlockTree({ tree: node.children })]);
}
