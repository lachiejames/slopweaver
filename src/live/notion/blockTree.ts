/**
 * Expanding every block nested beneath one Notion page slice, so a read returns what a reader sees.
 *
 * A read must show everything a reader can see in Notion: a PIR whose every section was a toggle heading read
 * as four top-level blocks, each `has_children: true`, and nothing beneath them.
 *
 * ## The raw slice stays raw; the tree is ours
 *
 * `data.blocks.results` is still the exact top-level provider slice. The expansion is a SEPARATE, ordered
 * tree of `{ block, expansion, children }` nodes, because the wrapper owns claims about the payload and never
 * the payload itself (`.claude/rules/area-live.md`): grafting a `children` key onto Notion's own block object
 * would invent a provider field. Each node says whether it is whole, so a partial subtree can never pass for
 * a complete one.
 *
 * ## A synced duplicate is listed by its ORIGINAL's id — measured, not read off the docs
 *
 * Notion's reference names `synced_from.block_id` but does not say which id the children endpoint wants.
 * MEASURED through `makeNotionNamedReadApi`: on two disposable pages, listing the duplicate's own
 * id returned `[]` with no error while the block reported `has_children: true`, and listing the original's
 * id returned its paragraph. So the duplicate's own id is a SILENT empty answer. The integration cassette
 * `reads a synced duplicate through its original` replays that pair.
 *
 * ## Breadth first, under two bounds, and never a false "complete"
 *
 * Breadth first BY PAGE, so one pathological first toggle cannot spend the allowance while every later section
 * stays shut: the unit of work is one child-list page, a block with more pages rejoins the back of its own
 * level, and a level is drained before the next one opens. A ceiling hit therefore leaves the deepest levels
 * and the far end of the widest lists unexpanded, never a sibling's first page. The bounds are the corpus's
 * measured per-item pair (`../../corpus/notion/caps.ts`: 400 requests, and five minutes because a request
 * bound alone once ran 23.5 minutes); the call ceiling lifts with `--nested-calls`. The clock is a STOP CHECK
 * before each call, not a wall the call is raced against, so one call in flight can carry the read past it. A
 * child page or database is a separate object and is NAMED, never read (`blockShape.ts` decides what each
 * block asks for). A token-level failure fails the whole read, as it does in the corpus crawl
 * (`skipIsFatal`); a block the integration cannot see is a named gap.
 */
import type { NotionNamedReadApi } from "../../corpus/notion/liveApi.js";
import { classifyNotionSkip, skipIsFatal } from "../../corpus/notion/skips.js";
import type { IngestError } from "../../lib/ingestError.js";
import { err, ok, type Result } from "../../lib/result.js";
import {
  gapsIn,
  type NotionBlockNode,
  type NotionLinkedObject,
  type NotionNestedExpansion,
  type NotionNodeExpansion,
  planBlock,
} from "./blockShape.js";

/** The nested child-list calls one read may spend by default — the corpus's measured per-item request bound. */
export const NOTION_NESTED_CALLS_DEFAULT = 400;

/** The most `--nested-calls` may raise it to: at Notion's ~3 req/s this is about the time limit's worth. */
export const NOTION_NESTED_CALLS_MAX = 2000;

/**
 * How long one read's nested expansion may keep STARTING calls — the corpus's five-minute per-item bound,
 * checked before each call; a call already in flight finishes, retries included.
 */
export const NOTION_NESTED_TIME_MS = 300_000;

/** Notion's own maximum children page size. */
const CHILD_PAGE_SIZE = 100;

interface MutableNode {
  readonly block: unknown;
  expansion: NotionNodeExpansion;
  readonly children: MutableNode[];
  reason: string | undefined;
}

/** A node waiting on one listing, with the source ids already open above it and how deep it sits. */
interface Waiter {
  readonly node: MutableNode;
  readonly ancestors: ReadonlySet<string>;
  readonly depth: number;
}

/**
 * One source id's child list, read a page at a time. Every node whose children come from this id waits on
 * it, so two synced duplicates of one original cost one listing.
 */
interface Listing {
  readonly sourceId: string;
  readonly depth: number;
  readonly results: unknown[];
  readonly cursors: Set<string>;
  readonly waiters: Waiter[];
  after: string | undefined;
  outcome:
    | { readonly expansion: "complete" | "unreadable" | "budget" | "inconsistent"; readonly reason: string | undefined }
    | undefined;
}

/**
 * The walk's shared state. `levels[d]` is the FIFO of listings whose NEXT PAGE is due at depth `d`; the
 * shallowest non-empty level always goes first, and a listing with more pages rejoins the END of its own
 * level, so one wide block cannot drain the allowance before its siblings' first pages are read.
 */
interface Walk {
  readonly listings: Map<string, Listing>;
  readonly levels: Listing[][];
  readonly linked: NotionLinkedObject[];
  stoppedBy: "calls" | "time" | null;
}

interface Budget {
  readonly calls: () => number;
  readonly spend: () => void;
  readonly stoppedBy: () => "calls" | "time" | null;
}

/** Why a listing was left short, per bound: the clock only ever stops a call from STARTING. */
const BUDGET_REASON: Readonly<Record<"calls" | "time", string>> = {
  calls: "the read's calls ceiling was reached",
  time: "the read had run past its time limit for starting calls",
};

/**
 * A fresh allowance for one read: a call count, and a clock checked before each call starts. The first stop
 * LATCHES, reason and all — a clock that steps backward must not reopen a read already past its limit.
 */
function createBudget({ maxCalls, maxMs, nowMs }: { maxCalls: number; maxMs: number; nowMs: () => number }): Budget {
  const startedAtMs = nowMs();
  let spent = 0;
  let stopped: "calls" | "time" | null = null;
  return {
    calls: () => spent,
    spend: () => {
      spent += 1;
    },
    stoppedBy: () => {
      if (stopped === null && spent >= maxCalls) {
        stopped = "calls";
      } else if (stopped === null && nowMs() - startedAtMs >= maxMs) {
        stopped = "time";
      }
      return stopped;
    },
  };
}

/** Queue a listing's next page at the end of its own level. */
function enqueue({ walk, listing }: { walk: Walk; listing: Listing }): void {
  while (walk.levels.length <= listing.depth) {
    walk.levels.push([]);
  }
  walk.levels[listing.depth]!.push(listing);
}

/** The listing whose next page is due: the head of the shallowest level holding one. */
function nextListing({ walk }: { walk: Walk }): Listing | undefined {
  const level = walk.levels.find((candidate) => candidate.length > 0);
  return level === undefined ? undefined : level.shift();
}

/** Give one waiting node its listing's outcome and a node per child, each queued if it has children of its own. */
function settle({ walk, listing, waiter }: { walk: Walk; listing: Listing; waiter: Waiter }): void {
  const outcome = listing.outcome!;
  waiter.node.expansion = outcome.expansion;
  waiter.node.reason = outcome.reason;
  const ancestors = new Set([...waiter.ancestors, listing.sourceId]);
  for (const child of listing.results) {
    waiter.node.children.push(nodeFor({ ancestors, block: child, depth: waiter.depth + 1, walk }));
  }
}

/** Close one listing and settle every node waiting on it. */
function finish({
  walk,
  listing,
  expansion,
  reason,
}: {
  walk: Walk;
  listing: Listing;
  expansion: "complete" | "unreadable" | "budget" | "inconsistent";
  reason: string | undefined;
}): void {
  listing.outcome = { expansion, reason };
  for (const waiter of listing.waiters) {
    settle({ listing, waiter, walk });
  }
}

/**
 * Read ONE page of one listing, then queue its next page or close it — or say exactly why it stopped short.
 *
 * Only a token-level failure is an `err`; everything else closes the listing with what was read. The clock
 * is checked before the call, not raced against it: a call already in flight runs to its own per-attempt
 * deadline and retries (`../../corpus/notion/callDeadline.ts`), so the read can run past the time limit by one call.
 */
async function readNextPage({
  api,
  budget,
  listing,
  walk,
}: {
  api: NotionNamedReadApi;
  budget: Budget;
  listing: Listing;
  walk: Walk;
}): Promise<Result<void, IngestError>> {
  const stopped = budget.stoppedBy();
  if (stopped !== null) {
    // The budget latches its first stop, so every listing reaching here records the same bound.
    walk.stoppedBy = stopped;
    finish({ expansion: "budget", listing, reason: BUDGET_REASON[stopped], walk });
    return ok(undefined);
  }
  budget.spend();
  const page = await api.listBlockChildren({ after: listing.after, id: listing.sourceId, limit: CHILD_PAGE_SIZE });
  if (page.isErr()) {
    const reason = classifyNotionSkip({ error: page.error });
    if (skipIsFatal({ reason })) {
      return err(page.error);
    }
    finish({ expansion: "unreadable", listing, reason: `${reason}: ${page.error.message}`, walk });
    return ok(undefined);
  }
  listing.results.push(...page.value.results);
  if (!page.value.hasMore) {
    finish({ expansion: "complete", listing, reason: undefined, walk });
    return ok(undefined);
  }
  const next = page.value.nextCursor;
  if (next === undefined || listing.cursors.has(next)) {
    finish({
      expansion: "inconsistent",
      listing,
      reason: "Notion reported more children but gave no new cursor to reach them",
      walk,
    });
    return ok(undefined);
  }
  listing.cursors.add(next);
  listing.after = next;
  enqueue({ listing, walk });
  return ok(undefined);
}

/** Wait on the listing for one source id, opening it when nobody has asked for that id yet. */
function request({ walk, sourceId, waiter }: { walk: Walk; sourceId: string; waiter: Waiter }): void {
  const existing = walk.listings.get(sourceId);
  if (existing === undefined) {
    const listing: Listing = {
      after: undefined,
      cursors: new Set<string>(),
      depth: waiter.depth,
      outcome: undefined,
      results: [],
      sourceId,
      waiters: [waiter],
    };
    walk.listings.set(sourceId, listing);
    enqueue({ listing, walk });
    return;
  }
  if (existing.outcome === undefined) {
    existing.waiters.push(waiter);
    return;
  }
  settle({ listing: existing, waiter, walk });
}

/** A node for one raw block, waiting on a listing when it has children of its own to read. */
function nodeFor({
  block,
  ancestors,
  depth,
  walk,
}: {
  block: unknown;
  ancestors: ReadonlySet<string>;
  depth: number;
  walk: Walk;
}): MutableNode {
  const plan = planBlock({ block });
  const node: MutableNode = { block, children: [], expansion: "leaf", reason: undefined };
  if (plan.kind === "linked") {
    node.expansion = "linked-object";
    walk.linked.push(plan.linked);
  }
  if (plan.kind === "malformed") {
    node.expansion = "unreadable";
    node.reason = "the block is not an object carrying an id, so its children cannot be listed";
  }
  if (plan.kind === "expand" && ancestors.has(plan.sourceId)) {
    node.expansion = "cycle";
    node.reason = `a synced reference back to ${plan.sourceId}, already open above this block`;
  }
  if (plan.kind === "expand" && !ancestors.has(plan.sourceId)) {
    request({ sourceId: plan.sourceId, waiter: { ancestors, depth, node }, walk });
  }
  return node;
}

/** The readonly node a caller receives, `reason` present only on a gap. */
function freeze({ node }: { node: MutableNode }): NotionBlockNode {
  return {
    block: node.block,
    children: node.children.map((child) => freeze({ node: child })),
    expansion: node.expansion,
    ...(node.reason === undefined ? {} : { reason: node.reason }),
  };
}

/**
 * Expand every block nested beneath one top-level slice, breadth first by page, under a call ceiling and a
 * time limit on STARTING calls — the call in flight when that limit passes finishes, retries included.
 *
 * @param api the safe official-SDK seam; only `listBlockChildren` is called
 * @param blocks the top-level slice exactly as Notion returned it
 * @param maxCalls how many child-list calls the expansion may spend
 * @param maxMs how long after it began the expansion may still START a call
 * @param nowMs the clock that limit reads, injected so a test needs no real one
 * @returns the ordered tree and the structured claims about it, or the token-level failure that ends the read
 */
export async function expandNotionBlocks({
  api,
  blocks,
  maxCalls,
  maxMs,
  nowMs,
}: {
  api: NotionNamedReadApi;
  blocks: readonly unknown[];
  maxCalls: number;
  maxMs: number;
  nowMs: () => number;
}): Promise<Result<{ tree: readonly NotionBlockNode[]; nested: NotionNestedExpansion }, IngestError>> {
  const budget = createBudget({ maxCalls, maxMs, nowMs });
  const walk: Walk = { levels: [], linked: [], listings: new Map<string, Listing>(), stoppedBy: null };
  const roots = blocks.map((block) => nodeFor({ ancestors: new Set<string>(), block, depth: 0, walk }));
  for (let listing = nextListing({ walk }); listing !== undefined; listing = nextListing({ walk })) {
    const read = await readNextPage({ api, budget, listing, walk });
    if (read.isErr()) {
      return err(read.error);
    }
  }
  const tree = roots.map((node) => freeze({ node }));
  const unexpanded = gapsIn({ tree });
  return ok({
    nested: {
      calls: budget.calls(),
      callLimit: maxCalls,
      complete: unexpanded.length === 0,
      linkedObjects: walk.linked,
      stoppedBy: walk.stoppedBy,
      unexpanded,
    },
    tree,
  });
}
