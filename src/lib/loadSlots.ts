/**
 * How many memory-heavy corpus operations may be in flight ON THIS MACHINE at once.
 *
 * ## Why this exists
 *
 * `bin/slopweaver` now sizes `--max-old-space-size` from the host's RAM, because V8's default is a table
 * lookup rather than a reading of the machine and it refused a corpus that fit in a tenth of the memory
 * sitting idle beside it. That is an **interim**, and it moves the failure rather than removing it: a
 * ceiling one process may safely reach is not a ceiling THREE processes may reach at once. The owner accepts
 * the interim and names this exact hole: three people may ask the bot a question at once, and the owner is
 * only on a 48 GiB RAM laptop.
 *
 * So the raised ceiling ships with a limit on how many holders of it may exist. Without one, three
 * concurrent whole-corpus runs on a 48 GiB laptop can each grow toward 12 GiB while a Slack listener, a backfill
 * and a fleet of editor sessions share the machine — and the loser is chosen by the OOM killer, not by us.
 * A refusal that names the other holders is strictly better than a `SIGKILL` somewhere else.
 *
 * ## The limit is DERIVED, and it improves on its own
 *
 * The budget is the ceiling a process may reach, not the heap it happens to be using: a process that has
 * not grown yet is not a process that will not. So the limit is `machine share ÷ per-process ceiling`, and
 * when a query holds less the ceiling can come back down and this number rises without anyone editing it.
 * That is the intended relationship between the interim and its cause, stated here so a later reader does
 * not tune this constant instead of removing what made it necessary.
 *
 * **The prebuilt lexical index is not that moment, measured.** It removed the per-query BM25 build,
 * which was the second big allocation — but the FIRST is the records themselves, and `loadCorpus` still
 * reads every one of them into heap. With that index landed and no lexical artefact involved,
 * the whole-corpus reader at V8's default ceiling died during the bronze READ, before the coverage manifest
 * printed. What
 * lowers this cap is a query that stops loading the whole corpus, not one that stops indexing it.
 *
 * ## A SLICED query was smaller, and is now nothing at all
 *
 * The sliced query path landed and a question no longer loaded the corpus at all. It was read as retiring
 * this ration: for a while the slot was taken by the whole-corpus branch alone, so the question verbs,
 * `derive`, `distil`, `audit` and `pane` took no slot between them and nothing rationed concurrent
 * QUESTIONS. Measured on the owner's corpus (1,989,368 indexed records), under `/usr/bin/time -l`
 * over a single sliced question: it peaked at **1,295 MiB RSS**,
 * of which the on-device embedder was the largest single term. Smaller than the 11,811 MiB the un-migrated
 * fallback wanted, and not nothing — three of them plus a `derive` was still the shape the OOM killer
 * resolves. That is why the owner ruled that every verb committing
 * a large footprint takes a slot, sliced query included, and that concurrent questions queue behind a load
 * slot as a backstop.
 *
 * **Banishing embeddings dissolved the question half of that.** With embeddings, the vector index
 * and every locally-built lexical index banished, `store read` and `store cite` select rows from the Supabase
 * store and load no corpus — the 1,295 MiB and its largest term are both gone, so neither verb takes a slot
 * now. The
 * ration survives for the verbs that still commit a whole-corpus footprint. `derive` holds every record;
 * `distil`, `audit`, `pane` and `slice verify` stream the corpus census (`../corpus/corpusCensus.ts`),
 * which keeps one skinny entry per logical record and never its body, and still take a slot because that
 * census grows with the record count. It is a BACKSTOP rather than a queue — on the owner's 48 GiB laptop the derived limit is 3, so the
 * refusal is what stands between a fourth holder and a `SIGKILL`.
 *
 * ## The directory is MACHINE-scoped, not home-scoped
 *
 * The resource being rationed is this machine's memory, so the slots live under the OS temp directory
 * rather than under `$SLOPWEAVER_HOME`. Two homes on one laptop still share the same RAM, and a read-only
 * verb must not start writing into a home just because it wanted to know whether it could run.
 *
 * ## Liveness, not release
 *
 * A slot is reclaimed by probing the pid that took it rather than by a release call, for one reason: a killed
 * process must never permanently consume a slot. There is no release path to forget to call.
 *
 * The probe is the pid AND that process's identity ({@link slotHolderLive}): a slot records its writer's `ps`
 * start stamp, and a pid now running under a different one — or exited unreaped, a zombie — is not the writer. A
 * pid alone outlives its holder, and a reused one wedged a source's refresh for about ten hours before the binding
 * existed.
 *
 * ## Acquisition is EXCLUSIVE: a slot is a lane, and every change to one is one rename
 *
 * The slot directory holds LANES, `lane-0`, `lane-1`, …, and a caller whose limit is `n` may take only a lane below
 * `n`. A lane holds exactly one marker file, empty, whose NAME is the whole state (`./loadSlotMarker.ts`), so nothing
 * is ever half-written and every transition is one `rename(2)`, which has one winner — the shape of the snapshot
 * pool's lease (`../codex/snapshotLease.ts`):
 *
 * - a lane that does not exist is MINTED: a private directory already holding this caller's busy marker is renamed
 *   into place, and a second minter's rename fails on the first one's non-empty lane;
 * - a free lane is taken by renaming `free` to this caller's busy marker, and a dead holder's by renaming THAT EXACT
 *   busy name to it. The lease id is load-bearing: a reaper that judged a holder dead and then paused finds its
 *   source name already gone, and loses, rather than unlinking the lane of whoever took it in the meantime;
 * - a release renames this caller's busy marker back to `free`.
 *
 * Nothing in this module ever removes a marker, so the two windows the previous list-count-write shape left — two
 * callers racing one empty directory both admitted, and a reaper's `rmSync` unlinking a slot rewritten between its
 * read and the unlink — have no step left to fall into. Reading the holders ({@link liveSlots}) writes nothing at all.
 *
 * **Two limits on one machine.** The limit is derived from the caller's own heap ceiling, so two callers can disagree,
 * and every marker records the limit its holder took the lane under. One that wins a lane then reads every lane, any
 * index, and keeps its lane only while the live holders, itself included, number no more than the SMALLEST limit any
 * of them recorded — otherwise it gives the lane straight back and refuses. Every doubt errs toward a refusal, never
 * toward a holder past a limit some live holder counted by. Callers deriving the same limit can never trip that check.
 *
 * **A refusal can name no holder**, which the previous shape never produced: a directory or lane that will not list
 * or rename, or a lane every pass found changing hands. Such a refusal carries `obstacles` saying which, and a caller
 * renders those rather than reading an empty holder list as room. Acquisition FAILS CLOSED on a filesystem error: an
 * admission with no lane is a holder the next caller cannot count.
 *
 * **What remains, stated rather than discovered.**
 *
 * - A lane whose directory holds more than one entry was written by something other than this module; it is skipped,
 *   never guessed free, and costs one lane of capacity until it is cleared. A single marker this module does not
 *   recognise is taken over like a dead holder's, by its exact name, as a malformed slot always was.
 * - A `.mint-` directory a process left by dying between its mint and its rename is litter beside the lanes.
 * - Code from before lanes wrote `<pid>.json` files, which this ignores, and it ignores lanes in turn: a seat
 *   running that code beside one running this is not excluded by it. The two shapes share no state, so no reading of
 *   one by the other could close that.
 */
import { realpathSync } from "node:fs";
import { tmpdir, totalmem } from "node:os";
import { join, resolve } from "node:path";
import { isMainThread } from "node:worker_threads";

import { readHeap } from "./heapBudget.js";
import {
  claimLane,
  freeLane,
  freeLanesOf,
  type HolderLive,
  type LiveLease,
  observeLanes,
  unparsableLease,
} from "./loadSlotLanes.js";
import type { LoadSlot, SlotLease } from "./loadSlotMarker.js";
import { lstartMs } from "./lstart.js";
import { type IdentityOf, type ProcessIdentity, processIdentityOf } from "./processIdentity.js";

export type { LoadSlot } from "./loadSlotMarker.js";

/**
 * The fraction of physical memory the concurrent corpus operations may claim between them. The rest is
 * for everything else on the machine, which on the owner's is a Slack listener, a running backfill and a
 * fleet of visible agent sessions — none of which is optional.
 */
export const MACHINE_SHARE = 0.75;

/**
 * The verdict: admitted with a lane held, or refused with the live holders that filled the machine — and, when they
 * do not explain the refusal on their own, the `obstacles` that do, one sentence each.
 */
export type SlotVerdict =
  | { readonly admitted: true; readonly limit: number; readonly inFlight: number }
  | {
      readonly admitted: false;
      readonly limit: number;
      readonly holders: readonly LoadSlot[];
      readonly obstacles: readonly string[];
    };

/**
 * How many concurrent loads this machine can carry. Pure.
 *
 * Never below 1 — a machine that cannot fit even one load has a different problem, and refusing the only
 * caller would replace a typed heap refusal (which names the corpus and the remedy) with a concurrency
 * refusal that names neither.
 *
 * @param totalBytes physical memory on the host
 * @param ceilingBytes the per-process heap ceiling each load may grow to
 * @param machineShare the fraction of physical memory these loads may claim between them
 * @returns the maximum number of concurrent loads, at least 1
 */
export function concurrentLoadLimit({
  totalBytes,
  ceilingBytes,
  machineShare = MACHINE_SHARE,
}: {
  totalBytes: number;
  ceilingBytes: number;
  machineShare?: number;
}): number {
  if (ceilingBytes <= 0) {
    return 1;
  }
  return Math.max(1, Math.floor((totalBytes * machineShare) / ceilingBytes));
}

/**
 * Whether a slot's pid still names the process that wrote it. PURE.
 *
 * A running pid is not enough: once the holder dies the OS hands its pid to whatever starts next, and a pid-only
 * probe then reads that unrelated process as the holder for as long as it lives — measured at about ten hours of
 * one source's refresh refused behind a reused pid. So, in order:
 *
 * - a pid nothing runs under, or a zombie (exited, unreaped, still answering signal 0), is dead;
 * - a slot that recorded its writer's start stamp is live only while the pid's stamp still EQUALS it — identity,
 *   the relay lease's rule (`../talk/relayLease.ts` `holderRunning`), with no clock arithmetic to go wrong;
 * - a slot with no recorded stamp — written before the binding existed, or by a holder `ps` gave no stamp for — is
 *   read by ORDER: its holder was running before it wrote `startedAtIso`, and a process that reused the pid started
 *   only after the holder died. `lstart` truncates to the second, so a genuine holder never reads later than its own
 *   write.
 *
 * A start stamp `ps` did not give now, or one that will not parse, leaves the pid alone to decide: that errs toward
 * refusing a caller, never toward reaping a running holder. (A `startedAtIso` that will not parse never reaches
 * here — `leaseFromMarker` reads that marker as malformed, and its lane is taken over.)
 *
 * **What remains, stated rather than discovered**:
 *
 * - when `ps` cannot give a stamp — at the write, at the read, or both — this degrades to the order check or to the
 *   bare pid, which is what main did; on darwin `/bin/ps` is part of the base system, so that is a broken machine;
 * - the order check an unstamped slot falls back to trusts the wall clock both ways: a backward step between a
 *   holder's start and its slot write reads that genuine holder as reused, and a backward step after the write
 *   lets a reused pid read as the holder, as every pid did on main. Only slots written before stamping are exposed,
 *   and each is reaped once whatever holds its pid exits;
 * - `lstart` resolves to the second, so a pid handed out again within the same second as its holder started reads
 *   as that holder — the whole pid space would have to wrap inside that second.
 *
 * @param slot the slot as its file records it
 * @param now the slot pid's process as it stands now
 * @returns true while the slot's writer may still be running, so its slot must not be reaped
 */
export function slotHolderLive({ slot, now }: { slot: LoadSlot; now: ProcessIdentity }): boolean {
  if (!now.running || now.zombie) {
    return false;
  }
  if (now.start === undefined) {
    return true;
  }
  if (slot.start !== undefined) {
    return now.start === slot.start;
  }
  const startedMs = lstartMs({ text: now.start });
  if (startedMs === undefined) {
    return true;
  }
  return startedMs <= Date.parse(slot.startedAtIso);
}

/** The real probe: a signal-0 reach and `/bin/ps`'s state and start stamp for one pid. */
const realIdentityOf: IdentityOf = (candidate) => processIdentityOf({ pid: candidate });

/** {@link slotHolderLive} over whatever `identityOf` says a pid's process is now. */
function holderLiveBy({ identityOf }: { identityOf: IdentityOf }): HolderLive {
  return (slot) => slotHolderLive({ now: identityOf(slot.pid), slot });
}

/**
 * The live slots in a directory, lowest lane first. READS ONLY: a dead holder's lane stays as it is until a caller
 * taking a slot renames it over, so a read-only caller — a card asking whether a refresh is running — never writes.
 *
 * A dead holder never wedges its lane: a `SIGKILL`ed query leaves its marker, and the next caller probes its pid,
 * finds it gone — or now another process, or a zombie ({@link slotHolderLive}) — and takes the lane over.
 *
 * @param dir the slot directory
 * @param identityOf a pid's process as it stands now — injected so a dead, reused or zombie holder is a fixture
 * @returns the slots whose holders are still running
 */
export function liveSlots({
  dir,
  identityOf = realIdentityOf,
}: {
  dir: string;
  identityOf?: IdentityOf;
}): readonly LoadSlot[] {
  return observeLanes({ dir, isLive: holderLiveBy({ identityOf }) }).live.map((lane) => lane.lease.slot);
}

/**
 * Whether a lease is this process's own. The pid alone is not enough — a marker naming this pid under another start
 * stamp is an earlier process's — so the stamps must match exactly. A process `ps` gave no stamp owns the unstamped
 * lease naming its pid: no other running process can carry that pid, so the lease is its own or a dead predecessor's,
 * and either way taking a second lane beside it would count this one process twice.
 */
function isOwnLease({ lease, start }: { lease: SlotLease; start: string | undefined }): boolean {
  return lease.slot.pid === process.pid && lease.slot.start === start;
}

/** A sentence for each live holder that took its lane under a smaller limit than this caller's. */
function smallerLimits({ others, limit }: { others: readonly LiveLease[]; limit: number }): readonly string[] {
  return others
    .filter((lane) => lane.lease.limit < limit)
    .map(
      (lane) =>
        `pid ${String(lane.lease.slot.pid)} holds lane ${String(lane.index)} under a limit of ${String(lane.lease.limit)}, below this caller's ${String(limit)}`,
    );
}

/**
 * Whether this caller may hold lane `mine` beside everything else observed: the other live holders, this one, and
 * every lane that could not be read number no more than the smallest limit — this caller's, or any live lease's
 * own recorded one, this caller's earlier lease included (see the module doc).
 */
function fitsBeside({
  observed,
  mine,
  limit,
}: {
  observed: { readonly live: readonly LiveLease[]; readonly obstacles: readonly string[] };
  mine: number;
  limit: number;
}): { readonly fits: boolean; readonly others: readonly LiveLease[] } {
  const others = observed.live.filter((lane) => lane.index !== mine);
  const bound = Math.min(limit, ...observed.live.map((lane) => lane.lease.limit));
  return { fits: others.length + 1 + observed.obstacles.length <= bound, others };
}

/**
 * Keep a lane just won, or give it straight back: read every lane again and keep it only while {@link fitsBeside}
 * holds. A lane that will not give back is said in the refusal, since it stays counted until this process exits.
 */
function keepOrGiveBack({
  dir,
  isLive,
  limit,
  won,
}: {
  dir: string;
  isLive: HolderLive;
  limit: number;
  won: { readonly index: number; readonly marker: string };
}): SlotVerdict {
  const after = observeLanes({ dir, isLive });
  const { fits, others } = fitsBeside({ limit, mine: won.index, observed: after });
  if (fits) {
    return { admitted: true, inFlight: others.length + 1, limit };
  }
  const stuck = freeLane({ dir, index: won.index, marker: won.marker });
  const obstacles = [...after.obstacles, ...smallerLimits({ limit, others }), ...stuck];
  return { admitted: false, holders: others.map((lane) => lane.lease.slot), limit, obstacles };
}

/**
 * A re-entrant call: this process already holds `own`. It takes no second lane, but it is held to the same bound as
 * a fresh one — a nested call under a SMALLER limit than the lease it already holds is refused when the holders now
 * standing exceed it. A refusal leaves `own` exactly where it is, since the outer call that took it still holds it.
 */
function reEnter({
  before,
  limit,
  own,
}: {
  before: { readonly live: readonly LiveLease[]; readonly obstacles: readonly string[] };
  limit: number;
  own: LiveLease;
}): SlotVerdict {
  const { fits, others } = fitsBeside({ limit, mine: own.index, observed: before });
  if (fits) {
    return { admitted: true, inFlight: others.length + 1, limit };
  }
  const obstacles = [...before.obstacles, ...smallerLimits({ limit, others: before.live })];
  return { admitted: false, holders: others.map((lane) => lane.lease.slot), limit, obstacles };
}

/** The refusal for a caller that won no lane: the live holders, and whatever else stopped it when they do not fill. */
function wonNone({
  dir,
  isLive,
  limit,
  obstacles,
}: {
  dir: string;
  isLive: HolderLive;
  limit: number;
  obstacles: readonly string[];
}): SlotVerdict {
  const after = observeLanes({ dir, isLive });
  const holders = after.live.map((lane) => lane.lease.slot);
  const all = [...obstacles, ...after.obstacles];
  if (all.length === 0 && holders.length < limit) {
    all.push(`every lane below ${String(limit)} changed hands while this caller tried it`);
  }
  return { admitted: false, holders, limit, obstacles: all };
}

/**
 * Take a slot for this process, or report what filled the machine.
 *
 * Re-entrant: a process whose own live lease already stands ({@link isOwnLease}) takes no second one, so a verb that
 * loads the corpus twice is never refused for its own lease — though it is held to the same limits as a fresh call
 * ({@link reEnter}). Otherwise it takes the lowest lane below `limit` it can win, and keeps it only while the holders
 * it then counts fit every live holder's limit (see the module doc).
 *
 * FAILS CLOSED: a directory or lane that will not list or rename is a refusal whose `obstacles` say so, never an
 * admission with no lane — that would be a holder the next caller could not count.
 *
 * @param dir the slot directory — see {@link loadSlotsDir}
 * @param limit how many concurrent loads this machine can carry — {@link concurrentLoadLimit}
 * @param ceilingMib the heap ceiling this process may grow to, recorded so a refusal can show the arithmetic
 * @param identityOf a pid's process as it stands now — see {@link liveSlots}; also gives this process's own start
 *   stamp, which the slot records
 * @returns the verdict; a lane is held only when admitted
 */
export function acquireLoadSlot({
  dir,
  limit,
  ceilingMib,
  identityOf = realIdentityOf,
}: {
  dir: string;
  limit: number;
  ceilingMib: number;
  identityOf?: IdentityOf;
}): SlotVerdict {
  if (!isMainThread) {
    // A worker shares this pid and start stamp but not `admittedDepth`, so its release would free a lane
    // the main thread's scope still holds. No worker takes a slot today; refused rather than half-supported.
    const why = `${dir} not tried: a worker thread shares its process's lease, so only the main thread takes a slot`;
    return { admitted: false, holders: [], limit, obstacles: [why] };
  }
  const verdict = decideSlot({ ceilingMib, dir, identityOf, limit });
  if (verdict.admitted) {
    const key = depthKey({ dir });
    const held = admittedDepth.get(key);
    admittedDepth.set(key, held === undefined ? 1 : held + 1);
  }
  return verdict;
}

/**
 * How many admitted acquisitions of each slot directory this process has not yet released, keyed by
 * {@link depthKey}. A re-entrant call shares the outer call's lane, so only the release matching the OUTERMOST
 * admission gives that lane back (a nested scope's release used to free the lane its outer scope was still
 * loading under).
 */
const admittedDepth = new Map<string, number>();

/**
 * The one key a slot directory's depth is counted under: its real path, so `D`, `D/`, `D/.` and a symlink to `D` are
 * one directory, not four depths. An admitted call's directory exists, since it holds a lane there; one
 * that will not resolve has no lane of this process's to protect, so its normalised spelling is enough.
 */
function depthKey({ dir }: { dir: string }): string {
  try {
    return realpathSync(dir);
  } catch {
    return resolve(dir);
  }
}

/** {@link acquireLoadSlot}'s verdict, before this process's own nesting depth is counted. */
function decideSlot({
  dir,
  limit,
  ceilingMib,
  identityOf,
}: {
  dir: string;
  limit: number;
  ceilingMib: number;
  identityOf: IdentityOf;
}): SlotVerdict {
  const start = identityOf(process.pid).start;
  const base = { ceilingMib, pid: process.pid, startedAtIso: new Date().toISOString() };
  const slot: LoadSlot = start === undefined ? base : { ...base, start };
  const unparsable = unparsableLease({ lease: { limit, slot } });
  if (unparsable !== undefined) {
    // Checked before the re-entrant branch too, which takes no lane and so never reaches claimLane's own check.
    return { admitted: false, holders: [], limit, obstacles: [unparsable] };
  }
  const isLive = holderLiveBy({ identityOf });
  const before = observeLanes({ dir, isLive });
  const own = before.live.find((lane) => isOwnLease({ lease: lane.lease, start }));
  if (own !== undefined) {
    return reEnter({ before, limit, own });
  }
  const claim = claimLane({ dir, isLive, lease: { limit, slot } });
  if (claim.kind === "lost") {
    return wonNone({ dir, isLive, limit, obstacles: claim.obstacles });
  }
  return keepOrGiveBack({ dir, isLive, limit, won: claim });
}

/**
 * Release this process's slot: its busy marker renamed back to `free`. A caller taking a slot takes over a lane whose
 * holder is gone, so exclusivity never depends on this being called — but a lane that will not free stays counted as
 * a live holder until this process exits, so each one is RETURNED for the caller to say, never swallowed.
 *
 * Every lane naming this pid is freed, whatever start stamp it carries: one that is not this process's own names an
 * earlier holder of the same pid, which is dead by construction.
 *
 * NESTED: while a re-entrant admission of `dir` is still outstanding, this only counts one down and frees nothing —
 * the outer scope is still loading under that lane ({@link admittedDepth}).
 *
 * @param dir the slot directory
 * @returns a sentence for each lane of this process's that stayed held; empty when every one was freed, or when an
 *   outer admission still holds the lane
 */
export function releaseLoadSlot({ dir }: { dir: string }): readonly string[] {
  if (!isMainThread) {
    // A worker's own `admittedDepth` is empty, so it would free the main thread's still-open lane by pid.
    return [`${dir} not released: a worker thread never takes a slot, so it frees none of its process's`];
  }
  const key = depthKey({ dir });
  const held = admittedDepth.get(key);
  if (held !== undefined && held > 1) {
    admittedDepth.set(key, held - 1);
    return [];
  }
  admittedDepth.delete(key);
  return freeLanesOf({ dir, pid: process.pid });
}

/**
 * The refusal a caller prints: what is running, and why the limit is what it is.
 *
 * It names the interim explicitly. A reader who hits this should understand that the number is derived from
 * a raised ceiling, and that the way to raise the number is to lower the ceiling by making a query hold
 * less — not to edit a constant here.
 *
 * A refusal carrying `obstacles` is explained by them as well as its holders, and it says so instead: a lane that
 * would not read or free, or a live holder under a smaller limit, is never the same thing as room. Which shape is
 * printed keys on the obstacles alone, never on the holder count — a refusal under a smaller recorded limit has fewer
 * holders than this caller's limit, and an empty obstacle list would render as a sentence with nothing after its colon.
 *
 * @param holders the live slots that filled the machine
 * @param limit the concurrent-load limit in force
 * @param ceilingMib this process's own heap ceiling
 * @param obstacles what stopped a slot being taken besides its holders, one sentence each
 * @returns the refusal lines, remedy first
 */
export function slotRefusalLines({
  holders,
  limit,
  ceilingMib,
  obstacles,
}: {
  holders: readonly LoadSlot[];
  limit: number;
  ceilingMib: number;
  obstacles: readonly string[];
}): readonly string[] {
  const running = holders
    .map((slot) => `pid ${String(slot.pid)} since ${slot.startedAtIso} (${String(slot.ceilingMib)} MiB ceiling)`)
    .join(", ");
  if (obstacles.length > 0) {
    return [
      `no load slot could be taken on this machine (limit ${String(limit)}, ${String(holders.length)} live holder(s)${running === "" ? "" : `: ${running}`}): ${obstacles.join("; ")}. Refused rather than running as a holder the next caller could not count.`,
      `  to answer now: retry — a lane changing hands settles in moments; a lane or directory that will not list or rename is a filesystem fault under ${tmpdir()} to clear first.`,
    ];
  }
  return [
    `${String(holders.length)} memory-heavy corpus operation(s) are already in flight on this machine and the limit is ${String(limit)}: ${running}. Refused here rather than letting ${String(holders.length + 1)} processes each grow toward a ${String(ceilingMib)} MiB ceiling and letting the OOM killer pick the loser.`,
    `  to answer now: wait for one of those to finish, then retry — nothing is queued, so a retry is the whole remedy.`,
    `  what takes a slot: every verb that commits a whole-corpus footprint — \`derive\`, which holds every record, and \`distil\`, \`audit\`, \`pane\` and \`slice verify\`, which hold one census entry per record. \`store read\` and \`store cite\` select from the store and take no slot at all.`,
    `  why the limit is ${String(limit)}: it is ${String(Math.round(MACHINE_SHARE * 100))}% of this machine's memory divided by the per-process ceiling. It is an INTERIM's companion — the raised ceiling exists because \`derive\` still holds every record, and the limit rises on its own when that ceiling comes down. Never edit it here.`,
  ];
}

/**
 * The real guard: derive the limit from this host and this process's ceiling, then take a slot.
 *
 * @param dir the slot directory (defaults to the machine-wide one)
 * @returns the verdict
 */
export function guardLoadSlot({ dir = loadSlotsDir() }: { dir?: string } = {}): SlotVerdict {
  const ceilingBytes = readHeap().limitBytes;
  return acquireLoadSlot({
    ceilingMib: Math.round(ceilingBytes / (1024 * 1024)),
    dir,
    limit: concurrentLoadLimit({ ceilingBytes, totalBytes: totalmem() }),
  });
}

/**
 * Where the slots live: one machine-wide directory under the OS temp dir. Not under `$SLOPWEAVER_HOME` —
 * see the module doc.
 *
 * @returns the slot directory path
 */
function loadSlotsDir(): string {
  return join(tmpdir(), "slopweaver-load-slots");
}

/** The shape a caller injects — {@link guardLoadSlot} in production, a plain fake in tests. */
export type LoadSlotGuard = (args: { dir?: string }) => SlotVerdict;
