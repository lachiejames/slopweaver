/**
 * Which Queue registers a change in the home or the store moves, and how often an open Queue still polls once those
 * changes are pushed to it. Pure, and it imports NOTHING, for the reason `./queueRegisterPolls.ts` states.
 *
 * **Why the Queue is told rather than asked.** An open Queue re-read eleven registers every twenty seconds and the
 * board every minute, each read one `slopweaver <verb> --json` child process. MEASURED on a 16 GB Mac, the
 * console server answering those polls cost 0.64 of a core (107 child processes, 77 s of CPU in two minutes, read off
 * every process the server spawned). The owner's ruling: poll much less, and make the event-driven update reliable.
 * So the server watches the files and store tables each register is built from (`./liveChangesServer.ts`), pushes
 * which registers moved, and the page re-reads exactly those.
 *
 * **Three rules keep that from being worse than the poll it replaces**, and each is a function below:
 *
 * - A register re-reads on a change at most as often as it used to poll ({@link eventRefreshDelayMs}). Seats write run
 *   journals and readings constantly, and an uncapped refresh would re-run the nine-second board read back to back.
 * - A register whose change signal is down, or not yet up, polls exactly as it did before ({@link queuePollMs}), so a
 *   broken watcher can make the Queue no staler than it was.
 * - While every signal it needs is up, a register still re-reads on a slow safety poll, staggered so the fourteen
 *   registers never fire together. A change the watcher could not see (the board's probes of repositories outside the
 *   home, a coalesced file event) is bounded by that poll.
 */

/** Every register whose change the server pushes, by its live verb's slug (`./liveVerbs.ts`). */
export const QUEUE_LIVE_SLUGS = [
  "autonomy",
  "board",
  "currency-reading",
  "drafts",
  "hands",
  "import-questions",
  "landing-reading",
  "queue-deferred",
  "review-drafts",
  "reviewers",
  "slack-drafts",
  "standing-asks",
  "talk-cards",
  "workstreams",
] as const;

/** One register the server pushes changes for. */
export type QueueLiveSlug = (typeof QUEUE_LIVE_SLUGS)[number];

/** Where a register's data lives: files under the home, rows in the store, or both. */
export type QueueChangeSource = "files" | "store";

/** Which change signals are up right now. A signal still connecting is not up. */
export interface QueueChangeHealth {
  /** The page's own stream from the server. */
  readonly transport: boolean;
  /** The server's file watcher over the home. */
  readonly files: boolean;
  /** The server's in-process store listener (`./storeQueuePostgres.ts`). */
  readonly store: boolean;
}

/** No signal up: what a page holds before its stream says otherwise. */
export const QUEUE_CHANGE_HEALTH_DOWN: QueueChangeHealth = { files: false, store: false, transport: false };

/**
 * Which sources each register reads, from following each verb into its stores. The board's probe sweep also reads
 * repositories outside the home, which nothing here watches: its safety poll covers that.
 */
const QUEUE_SOURCES: Readonly<Record<QueueLiveSlug, readonly QueueChangeSource[]>> = {
  autonomy: ["store"],
  board: ["files", "store"],
  "currency-reading": ["files"],
  drafts: ["files"],
  hands: ["files"],
  "import-questions": ["store"],
  "landing-reading": ["files"],
  "queue-deferred": ["files"],
  "review-drafts": ["files"],
  reviewers: ["files", "store"],
  "slack-drafts": ["files"],
  "standing-asks": ["store"],
  "talk-cards": ["files"],
  workstreams: ["files", "store"],
};

/**
 * One path under the home a register is built from: a `file` (its staged-write siblings, `<file>.<pid>.<uuid>.tmp`,
 * included), or a `tree` (the directory and everything under it). Relative to the home, `/`-separated.
 */
interface QueuePathRule {
  readonly path: string;
  readonly kind: "file" | "tree";
  readonly slugs: readonly QueueLiveSlug[];
}

/** Every path a register reads, and the registers it moves. */
const QUEUE_PATH_RULES: readonly QueuePathRule[] = [
  { kind: "tree", path: "handovers", slugs: ["board"] },
  { kind: "tree", path: "runs", slugs: ["board"] },
  // What a card resolves a bare reference against (`src/cli/commands/handover/boardReferences.ts`): the Linear
  // directory, the Datadog census, the Vanta atlas and the Vanta workspace slug's secrets-store file.
  { kind: "file", path: "corpus/silver/index/structures.json", slugs: ["board"] },
  { kind: "file", path: "datadog/catalogue/manifest.json", slugs: ["board"] },
  { kind: "tree", path: "atlas/vanta", slugs: ["board"] },
  { kind: "file", path: "secrets/vanta-tenant-slug", slugs: ["board"] },
  { kind: "file", path: "queue/withheld.jsonl", slugs: ["drafts"] },
  { kind: "tree", path: "hand-steps", slugs: ["hands"] },
  { kind: "tree", path: "readings/github-landing", slugs: ["landing-reading", "reviewers"] },
  { kind: "file", path: "queue/github-review-drafts.jsonl", slugs: ["review-drafts"] },
  { kind: "file", path: "queue/slack-drafts.jsonl", slugs: ["slack-drafts"] },
  { kind: "tree", path: "corpus/members", slugs: ["slack-drafts", "workstreams"] },
  // A hand step's row carries the reason a kept card stayed open (`keptReasonsOf`), read off the card landings.
  { kind: "file", path: "talk/card-landings.jsonl", slugs: ["hands", "talk-cards"] },
  { kind: "file", path: "talk/card-moves.jsonl", slugs: ["talk-cards"] },
  { kind: "file", path: "talk/relays.jsonl", slugs: ["talk-cards"] },
  { kind: "tree", path: "talk/turns", slugs: ["talk-cards"] },
  { kind: "tree", path: "talk/calls", slugs: ["talk-cards"] },
  { kind: "file", path: "sessions/intake-marks.jsonl", slugs: ["talk-cards"] },
  { kind: "file", path: "ledgers/reviewers.jsonl", slugs: ["reviewers"] },
  { kind: "file", path: "profile.json", slugs: ["board", "reviewers"] },
  { kind: "file", path: "corpus/silver/index/identities.json", slugs: ["reviewers"] },
  { kind: "file", path: "corpus/silver/index/freshness.json", slugs: ["reviewers"] },
  // Only a witnessed one-time import source now; a change to it is a defect the verb reports, so it is a change.
  { kind: "file", path: "judgement/standing-asks.jsonl", slugs: ["standing-asks"] },
  { kind: "tree", path: "readings/handover-currency", slugs: ["currency-reading"] },
  { kind: "file", path: "queue/card-deferrals.jsonl", slugs: ["queue-deferred"] },
];

/** The registers a slug list names, once each, in {@link QUEUE_LIVE_SLUGS}' order, so two equal sets compare equal. */
function ordered({ slugs }: { slugs: ReadonlySet<QueueLiveSlug> }): readonly QueueLiveSlug[] {
  return QUEUE_LIVE_SLUGS.filter((slug) => slugs.has(slug));
}

/**
 * Whether a slug is one the server pushes changes for.
 *
 * @param slug any live verb's slug
 * @returns true for a Queue register
 */
export function isQueueLiveSlug(slug: string): slug is QueueLiveSlug {
  return (QUEUE_LIVE_SLUGS as readonly string[]).includes(slug);
}

/**
 * The sources one register reads.
 *
 * @returns files, store, or both
 */
export function queueSourcesForSlug({ slug }: { slug: QueueLiveSlug }): readonly QueueChangeSource[] {
  return QUEUE_SOURCES[slug];
}

/**
 * Every register a source feeds.
 *
 * @returns the registers, in their declared order
 */
export function queueSlugsForSource({ source }: { source: QueueChangeSource }): readonly QueueLiveSlug[] {
  return QUEUE_LIVE_SLUGS.filter((slug) => QUEUE_SOURCES[slug].includes(source));
}

/**
 * Whether one path, relative to the home, falls under one rule: the rule's own path, anything under a tree, a staged
 * write beside a file, or the directory holding a file (an event a rename can report alone).
 */
function pathMatches({ path, rule }: { path: string; rule: QueuePathRule }): boolean {
  if (path === rule.path || path.startsWith(`${rule.path}/`) || path.startsWith(`${rule.path}.`)) {
    return true;
  }
  if (rule.kind === "tree") {
    // A tree's parent appearing or going is the tree appearing or going.
    return rule.path.startsWith(`${path}/`);
  }
  const slash = rule.path.lastIndexOf("/");
  return slash > 0 && path === rule.path.slice(0, slash);
}

/**
 * Which registers one file event under the home moves.
 *
 * A `null` path is a watcher that could not say which file changed (a coalesced event), so it moves every register
 * built from files. A path that leaves the home (absolute, or climbing with `..`) moves nothing: it is not one the
 * watcher can have meant.
 *
 * @param relativePath the changed path relative to the home, either separator, or `null` when the watcher named none
 * @returns the registers, once each, in their declared order
 */
export function queueSlugsForHomePath({ relativePath }: { relativePath: string | null }): readonly QueueLiveSlug[] {
  if (relativePath === null) {
    return queueSlugsForSource({ source: "files" });
  }
  const path = relativePath
    .replaceAll("\\", "/")
    .replace(/^\.\/+/u, "")
    .replace(/\/+$/u, "");
  if (path === "" || path.startsWith("/") || path.split("/").includes("..")) {
    return [];
  }
  const moved = new Set<QueueLiveSlug>();
  for (const rule of QUEUE_PATH_RULES) {
    if (pathMatches({ path, rule })) {
      for (const slug of rule.slugs) {
        moved.add(slug);
      }
    }
  }
  return ordered({ slugs: moved });
}

/** One directory the server watches, relative to the home (`""` is the home itself). */
export interface QueueWatchRoot {
  readonly dir: string;
  readonly recursive: boolean;
}

/**
 * The directories the server watches: each tree recursively, and each file's own directory without recursion. The home
 * is always watched without recursion, which sees a top-level file such as `profile.json` and a watched directory
 * appearing. Never the whole home recursively: the corpus alone takes a resync's thousands of writes, none of them a
 * Queue register's.
 *
 * @returns each directory once, a recursive watch winning over a flat one of the same directory
 */
export function queueWatchRoots(): readonly QueueWatchRoot[] {
  const roots = new Map<string, boolean>([["", false]]);
  for (const rule of QUEUE_PATH_RULES) {
    if (rule.kind === "tree") {
      roots.set(rule.path, true);
      continue;
    }
    const slash = rule.path.lastIndexOf("/");
    const dir = slash < 0 ? "" : rule.path.slice(0, slash);
    roots.set(dir, roots.get(dir) === true);
  }
  return [...roots.entries()]
    .map(([dir, recursive]) => ({ dir, recursive }))
    .toSorted((a, b) => a.dir.localeCompare(b.dir));
}

/** A register's safety poll while every signal it needs is up: five minutes, plus its own share of a 45-second spread. */
export const SAFETY_POLL_BASE_MS = 300_000;

/** The spread the fourteen registers' safety polls are staggered across, so they never fire as one burst. */
export const SAFETY_POLL_SPREAD_MS = 45_000;

/**
 * One register's safety poll: the base plus a stable share of the spread, from a hash of its slug, so the same
 * register always polls on the same interval and two registers seldom share one.
 *
 * @returns milliseconds between safety polls, in `[SAFETY_POLL_BASE_MS, SAFETY_POLL_BASE_MS + SAFETY_POLL_SPREAD_MS)`
 */
export function safetyPollMs({ slug }: { slug: QueueLiveSlug }): number {
  let hash = 0;
  for (const char of slug) {
    hash = (hash * 31 + char.charCodeAt(0)) % SAFETY_POLL_SPREAD_MS;
  }
  return SAFETY_POLL_BASE_MS + hash;
}

/**
 * Whether every signal one register needs is up: the page's stream, and each source the register reads.
 *
 * @returns true only when a change to this register would reach the page
 */
export function queueSignalUp({ health, slug }: { health: QueueChangeHealth; slug: QueueLiveSlug }): boolean {
  return health.transport && QUEUE_SOURCES[slug].every((source) => health[source]);
}

/**
 * The interval one subscriber's channel actually polls at.
 *
 * A slug that is not a Queue register gets exactly what it asked for. A Queue register that asked for a single read
 * still gets its safety poll, whatever the signals say: a change event can be lost (a store `LISTEN` dropped between
 * notifications, a coalesced file event), and a register read once would then stay stale until some unrelated event
 * re-read it. A Queue register whose signal is down gets the interval it asked for, which is the cadence it polled at
 * before changes were pushed. Only a register whose every signal is up slows to its safety poll — never faster than
 * what was asked.
 *
 * @param slug the live verb's slug
 * @param askedMs the interval the subscriber asked for, `undefined` for one read
 * @param health which signals are up
 * @returns the interval to arm, `undefined` for one read of a slug that is not a Queue register
 */
export function queuePollMs({
  slug,
  askedMs,
  health,
}: {
  slug: string;
  askedMs: number | undefined;
  health: QueueChangeHealth;
}): number | undefined {
  if (!isQueueLiveSlug(slug)) {
    return askedMs;
  }
  const safety = safetyPollMs({ slug });
  if (askedMs === undefined) {
    return safety;
  }
  if (!queueSignalUp({ health, slug })) {
    return askedMs;
  }
  return Math.max(askedMs, safety);
}

/**
 * What the Queue says while a change signal is down, so a register polling on its old cadence is never mistaken for
 * one that is pushed: which signal, and what that costs. Nothing while every signal is up, or before the page has
 * either heard the stream or waited long enough to say it has not.
 *
 * @param health which signals are up
 * @param settled whether the page has heard the stream, or given up waiting for it
 * @returns the notice, or `undefined` when there is nothing to say
 */
export function liveChangesNotice({
  health,
  settled,
}: {
  health: QueueChangeHealth;
  settled: boolean;
}): string | undefined {
  if (!settled) {
    return undefined;
  }
  if (!health.transport) {
    return "live updates off: no change stream, so every register is back on its old poll";
  }
  const down = [!health.files && "the file watch", !health.store && "the store listener"].filter(
    (name): name is string => name !== false,
  );
  if (down.length === 0) {
    return undefined;
  }
  return `live updates partly off: ${down.join(" and ")} ${down.length === 1 ? "is" : "are"} down, so those registers are back on their old poll`;
}

/** How soon after one change-driven re-read the board may be re-read for another: its old poll interval. */
export const BOARD_EVENT_GAP_MS = 60_000;

/** The same for every other register: the fast lane's old poll interval. */
export const EVENT_GAP_MS = 20_000;

/**
 * How long to wait before re-reading one register for a change, so a register is never re-read on changes more often
 * than it used to be polled: at once when its last change-driven read is older than its gap, else when the gap ends.
 *
 * @param lastRefreshAtMs when the last change-driven re-read of this register started, `undefined` for never
 * @param nowMs now, on the same clock
 * @returns milliseconds to wait, 0 for at once
 */
export function eventRefreshDelayMs({
  slug,
  lastRefreshAtMs,
  nowMs,
}: {
  slug: QueueLiveSlug;
  lastRefreshAtMs: number | undefined;
  nowMs: number;
}): number {
  if (lastRefreshAtMs === undefined) {
    return 0;
  }
  const gap = slug === "board" ? BOARD_EVENT_GAP_MS : EVENT_GAP_MS;
  return Math.max(0, lastRefreshAtMs + gap - nowMs);
}
