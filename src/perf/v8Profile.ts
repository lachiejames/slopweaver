/**
 * The pure reader for V8's two profile documents: `--cpu-prof`'s `.cpuprofile` and `--heap-prof`'s
 * `.heapprofile`, each folded into self-cost BY MODULE.
 *
 * Both are shipped by Node itself, so this tree hand-rolls no sampler and adds no dependency — the profiler
 * verb spawns the subject with the flags on and reads what V8 wrote. What it does add is the fold: a raw
 * profile is tens of thousands of call frames and answers nothing on its own, while "72% of the CPU was in
 * `node_modules/typescript`" is the sentence somebody acts on.
 *
 * **Self cost, never total.** A tree's total time double-counts every ancestor, so the deepest frame and the
 * `(root)` both read as 100% and no module stands out. Self cost partitions: the shares add to one, and the
 * module at the top is the one actually doing the work.
 *
 * Reproduce either document by hand:
 * `node --cpu-prof --cpu-prof-dir /tmp/p --heap-prof --heap-prof-dir /tmp/p <script>`.
 */
import { z } from "zod";

/** One V8 call frame, as both documents spell it. */
const callFrameSchema = z.object({
  functionName: z.string(),
  url: z.string(),
});

/**
 * A `.cpuprofile`, narrowed to the four fields this fold reads.
 *
 * `samples` and `timeDeltas` are taken in preference to each node's own `hitCount` because the deltas are
 * real microseconds: a sampler that missed its interval reports the gap, and `hitCount` cannot.
 */
export const cpuProfileSchema = z.object({
  nodes: z.array(z.object({ callFrame: callFrameSchema, id: z.number() })),
  samples: z.array(z.number()),
  timeDeltas: z.array(z.number()),
});

/** A `.heapprofile`: one tree, every node carrying the bytes sampled at that frame itself. */
export const heapProfileSchema = z.object({
  head: z.object({
    callFrame: callFrameSchema,
    children: z.array(z.unknown()),
    selfSize: z.number(),
  }),
});

/** What one module cost, and what share of the whole run that was. */
export interface ModuleCost {
  /** The bucket — a package under `node_modules`, a directory under the repo root, or a V8 pseudo-frame. */
  readonly module: string;
  /** Microseconds for a CPU fold, sampled bytes for a heap fold. */
  readonly value: number;
  /** `value` as a fraction of every bucket's total, in [0, 1]. */
  readonly share: number;
}

/**
 * The package a `node_modules` path belongs to, scope included.
 *
 * @param url the frame's script url
 * @returns the package name, or `undefined` when the path names no package after the last `node_modules`
 */
function vendoredPackage({ url }: { url: string }): string | undefined {
  const marker = "/node_modules/";
  const at = url.lastIndexOf(marker);
  if (at < 0) {
    return undefined;
  }
  const parts = url.slice(at + marker.length).split("/");
  const [first, second] = parts;
  if (first === undefined || first === "") {
    return undefined;
  }
  if (first.startsWith("@") && second !== undefined && second !== "") {
    return `${first}/${second}`;
  }
  return first;
}

/**
 * The bucket a frame is attributed to.
 *
 * V8's synthetic frames — `(garbage collector)`, `(program)`, `(idle)` — carry no url and are kept under
 * their own names rather than merged into an "other": GC time is the single most useful line in a heap
 * investigation, and folding it away is how a profile stops answering the question it was run for.
 *
 * @param url the frame's script url, empty for a synthetic frame
 * @param functionName the frame's name, which is what a synthetic frame has instead of a url
 * @returns the bucket name
 */
export function moduleBucketOf({ url, functionName }: { url: string; functionName: string }): string {
  if (url === "") {
    if (functionName === "") {
      return "(anonymous)";
    }
    return functionName;
  }
  if (url.startsWith("node:")) {
    return "node:internal";
  }
  const vendored = vendoredPackage({ url });
  if (vendored !== undefined) {
    return `node_modules/${vendored}`;
  }
  const path = url.replace(/^file:\/\//u, "");
  const at = path.lastIndexOf("/src/");
  if (at < 0) {
    return "other";
  }
  const segments = path.slice(at + "/src/".length).split("/");
  const [first] = segments;
  if (first === undefined || segments.length === 1) {
    return "src";
  }
  return `src/${first}`;
}

/**
 * Add one frame's cost to its bucket.
 *
 * Written as a statement rather than `totals.get(bucket) ?? 0`, which the `no-silent-fallback` gate refuses:
 * an absent bucket is a first sighting, and naming that case is what the rule asks for.
 *
 * @param totals the running fold, mutated in place
 * @param bucket the module the cost belongs to
 * @param value the cost to add
 */
function addTo({ totals, bucket, value }: { totals: Map<string, number>; bucket: string; value: number }): void {
  const seen = totals.get(bucket);
  if (seen === undefined) {
    totals.set(bucket, value);
    return;
  }
  totals.set(bucket, seen + value);
}

/**
 * Fold a bucket→cost map into the ranked, shared list a reader sees.
 *
 * @param totals every bucket's raw cost
 * @returns the buckets, heaviest first, each carrying its share of the total
 */
function rank({ totals }: { totals: ReadonlyMap<string, number> }): readonly ModuleCost[] {
  let whole = 0;
  for (const value of totals.values()) {
    whole += value;
  }
  const divisor = whole > 0 ? whole : 1;
  return [...totals]
    .map(([module, value]) => ({ module, share: value / divisor, value }))
    .toSorted((a, b) => b.value - a.value);
}

/**
 * Self CPU time by module, in microseconds.
 *
 * Each delta is attributed to the sample it precedes, which is the standard reading of the pair and the one
 * Chrome DevTools uses. A document whose `samples` and `timeDeltas` disagree in length is folded over the
 * shorter of the two rather than refused: V8 truncates the tail when a process exits mid-interval, and
 * dropping one sample is a better answer than dropping the profile.
 *
 * @param document a parsed `.cpuprofile`
 * @returns every bucket that took time, heaviest first
 */
export function cpuSelfTimeByModule({
  document,
}: {
  document: z.infer<typeof cpuProfileSchema>;
}): readonly ModuleCost[] {
  const bucketById = new Map<number, string>();
  for (const node of document.nodes) {
    bucketById.set(node.id, moduleBucketOf(node.callFrame));
  }
  const totals = new Map<string, number>();
  const pairs = Math.min(document.samples.length, document.timeDeltas.length);
  for (let i = 0; i < pairs; i += 1) {
    const id = document.samples[i];
    const delta = document.timeDeltas[i];
    if (id === undefined || delta === undefined || delta < 0) {
      continue;
    }
    const bucket = bucketById.get(id);
    if (bucket === undefined) {
      continue;
    }
    addTo({ bucket, totals, value: delta });
  }
  return rank({ totals });
}

/** A `.heapprofile` node, as the recursive walk below needs it. */
interface HeapNode {
  readonly callFrame: { readonly functionName: string; readonly url: string };
  readonly selfSize: number;
  readonly children: readonly unknown[];
}

/**
 * Whether an arbitrary child value is a heap-profile node.
 *
 * The schema deliberately stops at `z.unknown()` for children: a `.heapprofile` is an arbitrarily deep tree
 * and a recursive Zod schema would walk the whole of it twice, once to validate and once to fold. This guard
 * is the one walk.
 */
function isHeapNode(value: unknown): value is HeapNode {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as { callFrame?: unknown; selfSize?: unknown; children?: unknown };
  if (typeof candidate.selfSize !== "number" || !Array.isArray(candidate.children)) {
    return false;
  }
  const frame = candidate.callFrame;
  if (typeof frame !== "object" || frame === null) {
    return false;
  }
  const named = frame as { functionName?: unknown; url?: unknown };
  return typeof named.functionName === "string" && typeof named.url === "string";
}

/**
 * Sampled allocation by module, in bytes.
 *
 * `--heap-prof` samples ALLOCATIONS, not the live set, so a module at the top of this list is where the
 * garbage comes from and not necessarily what the process is still holding. The two questions are different
 * and both worth asking: the phase report answers what is held, this answers what was churned.
 *
 * @param document a parsed `.heapprofile`
 * @returns every bucket that allocated, heaviest first
 */
export function heapSelfSizeByModule({
  document,
}: {
  document: z.infer<typeof heapProfileSchema>;
}): readonly ModuleCost[] {
  const totals = new Map<string, number>();
  const pending: HeapNode[] = [document.head];
  while (pending.length > 0) {
    const node = pending.pop();
    if (node === undefined) {
      continue;
    }
    if (node.selfSize > 0) {
      const bucket = moduleBucketOf(node.callFrame);
      addTo({ bucket, totals, value: node.selfSize });
    }
    for (const child of node.children) {
      if (isHeapNode(child)) {
        pending.push(child);
      }
    }
  }
  return rank({ totals });
}

/**
 * Merge several folds of the same kind into one, re-ranked so shares are of the WHOLE run.
 *
 * A profiled subject is rarely one process — `tsx` and `vitest` both spawn children, and V8 writes a
 * document per process. Reading one of them would report a fraction of the work and call it the whole, so
 * the profiler folds every document the run left behind and merges the results here.
 *
 * @param folds one fold per document, each already bucketed by module
 * @returns the merged fold, heaviest first
 */
export function mergeCosts({ folds }: { folds: readonly (readonly ModuleCost[])[] }): readonly ModuleCost[] {
  const totals = new Map<string, number>();
  for (const fold of folds) {
    for (const cost of fold) {
      addTo({ bucket: cost.module, totals, value: cost.value });
    }
  }
  return rank({ totals });
}

/** V8's pseudo-frame for time the process had nothing to run — it was waiting, not computing. */
const IDLE_BUCKET = "(idle)";

/**
 * Split a CPU fold into the waiting half and the working half.
 *
 * Idle is left IN the fold by {@link cpuSelfTimeByModule}, because a run that is 66% idle is the most
 * important thing about it — but it must not compete in the module table, where it drowns every real
 * entry and makes two modules four percentage points apart look identical. So it is reported as one
 * number, and the modules are re-shared over the time the process was actually running.
 *
 * MEASURED on `dev profile --gate jsdoc-tags --cpu`: idle was 66.5% of samples, and
 * `node_modules/typescript` read as 21.1% of the whole against 79.5% of the work. Reproduce:
 * `slopweaver dev profile --gate jsdoc-tags --cpu`.
 *
 * @param costs a CPU fold, idle included
 * @returns the idle share in [0, 1], and the remaining buckets re-shared over the busy total
 */
export function splitIdle({ costs }: { costs: readonly ModuleCost[] }): {
  readonly idleShare: number;
  readonly busy: readonly ModuleCost[];
} {
  const idle = costs.find((cost) => cost.module === IDLE_BUCKET);
  const idleShare = idle === undefined ? 0 : idle.share;
  const busy = costs.filter((cost) => cost.module !== IDLE_BUCKET);
  const totals = new Map<string, number>();
  for (const cost of busy) {
    totals.set(cost.module, cost.value);
  }
  return { busy: rank({ totals }), idleShare };
}
