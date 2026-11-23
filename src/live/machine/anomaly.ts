/**
 * IS THIS MACHINE ANOMALOUS, and WHO made it so — the pure judgement `slopweaver machine watch` dispatches
 * an investigation on, and the gate in `../../supervisor/loadDispatchGate.ts` refuses a tick over.
 *
 * ## What it is for
 *
 * Anomalous machine load must be structurally impossible to miss. The owner keeps catching it by hand — one
 * incident was load **45.9**, one seat's `bfs` walking `/` at **three cores**,
 * five stale `nx` daemons and three parked seats, all of it found by the owner rather than by the fleet. The
 * supervisor already HAD the reading: `machine capacity` published a `capacity-hold` naming a stalled hook
 * and nobody acted on it. A reading a supervisor may skip is not a mechanism, so
 * this module turns the reading into a TRIGGER, and the trigger into a row somebody has to settle.
 *
 * ## The three triggers, and why each line sits where it does
 *
 * Every number here is a FIRST MEASUREMENT to ratchet, never a line to argue past — the same treatment
 * `./capacity.ts`'s compressor and swapfile holds carry, and each carries the command that re-measures it.
 *
 * - **`hold`** — `./capacity.ts` already decided this: the compressor, the swapfile count or the 1-minute
 *   load crossed a HOLD threshold. No new number. It is the trigger that closes the stale-daemon gap directly,
 *   because in that incident the hold was TRUE and the fleet did nothing with it.
 *
 * - **`single-process`** at {@link DEFAULT_SINGLE_PROCESS_CORES} cores, SUSTAINED for
 *   {@link DEFAULT_SUSTAINED_SECONDS} seconds. The `bfs` reading was three cores. Measured on this machine,
 *   the heaviest single process was **89.0%** — well under one core — while the heaviest whole
 *   session TREE was 276.9%; reproduce with
 *   `top -l 2 -s 1 -stats pid,cpu | awk '/^PID/{s++} s==2 && NF==2 {print $2, $1}' | sort -rn | head`.
 *   Node is single-threaded for JS and vitest parallelises across PROCESSES, so a `yarn validate` lap does
 *   not approach 300% in any one process; three cores in one process is native multi-threaded work.
 *
 *   The elapsed qualifier is not belt-and-braces. The sample is `top -l 2 -s 1` — a **one-second** window —
 *   so a compile burst genuinely can read 300% for one sample and be gone before a seat could open. A
 *   process that has burned three cores for two minutes is anomalous on any reading; one that did it for a
 *   second is `top` catching a build.
 *
 * - **`process-count`** at {@link DEFAULT_SESSION_PROCESS_COUNT} NON-HOOK processes in one session tree.
 *   The exclusion is the whole point and `./fleetLoad.ts`'s `nonHookProcessCount` carries the arithmetic:
 *   one PreToolUse hook per `Bash` call, each firing two node processes, against a MANDATORY
 *   detective fan-out whose measured lap ran 28 readers — about 56 hook processes under one session on
 *   completely correct work.
 *   A line over the raw `processCount` would fire every bot turn, which is precisely the mistake
 *   `./fleetLoad.ts`'s own footer refused to make with the parallel-call count. Today's largest non-hook
 *   tree is **24** (`slopweaver machine capacity --json`).
 *
 * - **`daemon-footprint`** — a macOS daemon in {@link WATCHED_DAEMONS}, read by its exact binary path, strictly over
 *   {@link DEFAULT_DAEMON_FOOTPRINT_GB}, on exact bytes. The incident: `fseventsd` (root) held **24 GiB**, 19 of
 *   it compressed, 4 d 19 h after boot, while `machine capacity` had printed it as the top foreign hog for as
 *   long as anyone looked — an ALERT, which dispatches nothing, and a memory HOLD whose subject was whichever
 *   session topped the CPU list. So a daemon leak was never its own dispatch, and the owner found it in Activity
 *   Monitor. Creating 1.75 M unique files moved it 24 → 26 GiB in 7.5 minutes after 13 flat; a fleet
 *   worktree is ~182 k paths created and deleted again. Re-measure with
 *   `top -l 1 -pid "$(pgrep -x fseventsd)" -stats mem,cmprs`. A seat cannot restart a root daemon, so the
 *   subject carries no `kill` and its `why` names the one hand step.
 *
 * There is deliberately **no total-fleet process count**. That number scales with a fleet the owner wants maxed,
 * so it could only ever punish success.
 *
 * ## Who a bare HOLD may name — and why a rotating subject is the same bug as a pid
 *
 * The signature is what `./backoff.ts` dedupes on and what a settlement clears: the trigger kinds, the
 * culprit's LABEL, and the session that owns it — or the literal `foreign` when nothing in the fleet does.
 * A restarted `nx` daemon gets a fresh pid every time, so a pid-keyed signature makes every recurrence look
 * novel and defeats the backoff outright.
 *
 * **A session id behaves exactly like a pid when the hold is MACHINE-WIDE**, which is the whole of the
 * rotating-subject incident. `./fleetCulprit.ts#fleetCulprit` falls through to `sessions[0]` — the top of a
 * CPU-sorted list — so on a flat list the subject is simply whichever session the one-second sample caught.
 * Four readings in twenty-seven minutes named four different sessions, each 5.4–7.3% of a fifteen-core
 * machine, each carrying its own `kill`, while all twenty-four live sessions together were 2.8 cores against
 * a 1-minute load of 24–36; the load fell 36 → 24 with nothing killed. Two rows 77 seconds apart both
 * attempted a seat, because `./backoff.ts`'s window is keyed on a subject that had rotated under it.
 *
 * So a bare hold names a culprit SESSION only when something independent of the CPU ranking marks it, and
 * both marks are already in the reading:
 *
 * - **A stalled hook** — `hookStallSeconds` at or over the report's own `hookStallHoldSeconds`. A wedged
 *   hook is a defect whoever is top of the list, which is why `fleetCulprit` ranks it first.
 * - **A STRICT majority of the MACHINE's busy CPU** — the session's attributed `%CPU` strictly over everything
 *   else `top`'s header says the machine is burning (`hiddenCpu.busyCores` × 100, less the session). Both
 *   sides come from the same final `top` sample on the same scale, 100 to a core. It is a relation inside one
 *   reading rather than a threshold, so it needs no re-measurement on another machine; and it is the only
 *   relation that licenses a `kill`, because a session that is not most of what the machine is burning
 *   cannot be what holds a machine-wide load, so ending it cannot end the condition.
 *
 *   It replaced a strict majority of the FLEET's own CPU, which was cheap and transient because the fleet's
 *   attributed share is a slice of the busy machine. MEASURED on one dispatch: load1 48.85 on
 *   15 cores, `machine capacity` reading 15 cores busy, 6.6 visible, 8.4 unattributed — and the subject was a
 *   ten-hour seat doing ordinary work, with `kill 73794`, because its 97% (92.5% of it one 16-second-old
 *   `node`) beat every other session's attributed share in that one-second sample. Eight re-readings over the
 *   next six minutes saw load fall to 31.8 with nothing killed and the top session move between three seats,
 *   and the old mark held once for 0.38 of a core. Reproduce with `slopweaver machine dispatches --all` and
 *   `slopweaver machine capacity --json`. Either relation picks at most one session WITHIN a reading; neither
 *   proves the subject cannot rotate ACROSS readings, and nothing here claims it does.
 *
 *   An unread `busyCores` licenses nobody: the machine subject, never the fleet relation in its place, which
 *   would quietly restore the defect whenever `top`'s header did not parse. A lone two-and-a-half-core tree on
 *   a fifteen-busy-core machine is the machine subject too, still carrying that tree for whoever reads the
 *   row — the single-process and process-count triggers, not this one, name a concrete thing to go and end.
 *   Both sides are stored to one decimal place (`busyCores` to 0.1 core, session CPU to 0.1%), and the
 *   comparison is strict on those stored values.
 *
 * Anything else is the machine itself ({@link machineSubject}): no `kill` at all, and a signature that is the
 * same string on every reading. An ORPHAN group is untouched by this — `slopweaver machine reap` costs no
 * workstream and a dead seat's snapshot name does not rotate.
 *
 * The heaviest session's TREE still rides the machine subject, and it does rotate sample to sample. That is
 * deliberate and harmless — it is labels and pids for whoever picks the row up, it is not part of the
 * signature, and an empty tree is the incident `./fleetLoad.ts` exists to end.
 *
 * Pure: a report in, a verdict out. No clock, no filesystem, no env.
 */
import type { MachineCapacityReport } from "./capacity.js";
import { overThresholdGb, type RankedProcess } from "./capacityRank.js";
import { NOT_STANDING } from "./capacityVerdict.js";
import type { CpuHog } from "./cpuHogs.js";
import { WATCHED_DAEMONS } from "./daemonWatch.js";
import type { SessionLoad, TreeProcess } from "./fleetLoad.js";
import { machineHoldStands } from "./recentBoots.js";

/**
 * A single process at or above this many cores' worth of CPU is a trigger. The `bfs` reading; the
 * heaviest single process on this machine was 0.89 cores.
 */
export const DEFAULT_SINGLE_PROCESS_CORES = 3;

/**
 * How long a single-process reading must have been running to count. The CPU sample is a ONE-SECOND window
 * (`top -l 2 -s 1`), so without this a compile burst dispatches an investigation into a process that has
 * already exited.
 */
export const DEFAULT_SUSTAINED_SECONDS = 120;

/**
 * NON-HOOK processes in one session tree, at or above which that session is a trigger. Today's largest is 24
 * (`slopweaver machine capacity --json`). See this module's header for why hooks are excluded.
 */
export const DEFAULT_SESSION_PROCESS_COUNT = 40;

/**
 * A watched daemon strictly over this footprint, in GiB, is a trigger, judged on exact bytes. A FIRST
 * measurement to ratchet: a freshly restarted `fseventsd` read **4.5 MB** (pid 48986,
 * `top -l 1 -pid "$(pgrep -x fseventsd)" -stats mem`), the incident 24 GiB, and the `mds-ceiling` launchd
 * job already restarts `mds` over 1 GiB. One GiB is over two hundred times the healthy reading and a
 * twenty-fourth of the incident.
 *
 * "Exact" is exact on the bytes `top` prints, which is the only footprint reading open without root. It prints
 * whole MiB here (`1025M`), so a footprint within 1 MiB over the line reads as ON it and stays clear — a
 * one-part-in-a-thousand blind edge, named rather than engineered past.
 */
export const DEFAULT_DAEMON_FOOTPRINT_GB = 1;

/** Which line fired. A reading can cross more than one, and the row carries all of them. */
export type AnomalyTrigger = "hold" | "single-process" | "process-count" | "daemon-footprint";

/** Who a dispatch is ABOUT, in the shape a finding row and a briefing clause both read. */
export interface AnomalySubject {
  /** What to name — a process label, or `session <id>`. Never an argv. */
  readonly label: string;
  /** The measurement that selected it, in one clause. */
  readonly why: string;
  /**
   * The command a SEATED session may run to end it, or `undefined` when none does. A command only the owner can run
   * (a root daemon's restart) is not one: it rides in {@link why}, and its absence here is what keeps
   * `./backoff.ts` doubling, because settling the row cannot have ended the condition.
   */
  readonly kill: string | undefined;
  /** The session that owns it, or `undefined` when nothing in the fleet does. */
  readonly sessionId: string | undefined;
  /** Its process tree, largest CPU first, labels only. */
  readonly tree: readonly TreeProcess[];
}

/** What one reading concluded. */
export type MachineAnomaly =
  /** Nothing crossed a line. */
  | { readonly kind: "clear" }
  /** At least one line fired, and this is who. */
  | {
      readonly kind: "anomalous";
      /** Every line that fired, in the order this module declares them. */
      readonly triggers: readonly AnomalyTrigger[];
      readonly subject: AnomalySubject;
      /** The dedupe key — trigger kinds, culprit label and owning session. Never a pid. */
      readonly signature: string;
    };

/** The heaviest hog that is over the line AND has been over it long enough to be worth a seat. */
function sustainedHog({
  report,
  cores,
  sustainedSeconds,
}: {
  report: MachineCapacityReport;
  cores: number;
  sustainedSeconds: number;
}): CpuHog | undefined {
  const line = cores * 100;
  return report.cpuHogs.hogs.find(
    (hog) => hog.cpuPct >= line && hog.elapsedSeconds !== undefined && hog.elapsedSeconds >= sustainedSeconds,
  );
}

/** The session with the most non-hook processes, when that count is at or over the line. */
function overgrownSession({
  report,
  sessionProcessCount,
}: {
  report: MachineCapacityReport;
  sessionProcessCount: number;
}): SessionLoad | undefined {
  return report.fleet.sessions
    .filter((session) => session.nonHookProcessCount >= sessionProcessCount)
    .toSorted((a, b) => b.nonHookProcessCount - a.nonHookProcessCount)[0];
}

/** A watched daemon over its footprint line, heaviest first, with the command that relieves it. */
interface BloatedDaemon {
  readonly process: RankedProcess;
  readonly relief: string;
}

/** The heaviest watched daemon strictly over the footprint line. Every entry was read by exact binary path. */
function bloatedDaemon({ report, gb }: { report: MachineCapacityReport; gb: number }): BloatedDaemon | undefined {
  for (const process of report.watchedProcesses.toSorted((a, b) => b.footprintBytes - a.footprintBytes)) {
    const daemon = WATCHED_DAEMONS.find((entry) => entry.label === process.label);
    if (daemon !== undefined && overThresholdGb({ bytes: process.footprintBytes, gb })) {
      return { process, relief: daemon.relief };
    }
  }
  return undefined;
}

/**
 * The subject a bloated daemon names: the daemon, by LABEL, so a relaunch under a new pid signs the same
 * string. No `kill` — it is root, so a seat cannot end it, and the absent kill keeps `./backoff.ts` doubling.
 */
function daemonSubject({ daemon, gb }: { daemon: BloatedDaemon; gb: number }): AnomalySubject {
  const { process, relief } = daemon;
  return {
    kill: undefined,
    label: process.label,
    sessionId: undefined,
    tree: [],
    why:
      `${process.label} (pid ${String(process.pid)}, root) holds ${String(process.footprintGb)} GB, line at ` +
      `${String(gb)} GB — investigate which file churn or slow client drove it; relief is the owner's one hand step \`${relief}\``,
  };
}

/** The tree of whichever session owns a pid, or an empty tree when none does. */
function treeForSession({
  report,
  sessionId,
}: {
  report: MachineCapacityReport;
  sessionId: string | undefined;
}): readonly TreeProcess[] {
  if (sessionId === undefined) {
    return [];
  }
  const owner = report.fleet.sessions.find((session) => session.sessionId === sessionId);
  if (owner === undefined) {
    return [];
  }
  return owner.tree;
}

/** The subject a single-process trigger names: the hog itself, with its owning session's tree behind it. */
function hogSubject({ hog, report }: { hog: CpuHog; report: MachineCapacityReport }): AnomalySubject {
  const elapsed = hog.elapsedSeconds;
  const age = elapsed === undefined ? "age unread" : `${String(Math.round(elapsed / 60))}m`;
  const owner = hog.sessionId === undefined ? `${hog.classification}, no session owns it` : `session ${hog.sessionId}`;
  return {
    kill: `kill ${String(hog.pid)}`,
    label: hog.label,
    sessionId: hog.sessionId,
    tree: treeForSession({ report, sessionId: hog.sessionId }),
    why: `${hog.label} (pid ${String(hog.pid)}) at ${String(hog.cpuPct)}% cpu for ${age} — ${owner}`,
  };
}

/** The subject an overgrown session names. */
function sessionSubject({ session }: { session: SessionLoad }): AnomalySubject {
  return {
    kill: `kill ${String(session.pid)}`,
    label: `session ${session.sessionId}`,
    sessionId: session.sessionId,
    tree: session.tree,
    why:
      `${String(session.nonHookProcessCount)} non-hook processes (${String(session.processCount)} total) ` +
      `at ${String(session.cpuPct)}% cpu`,
  };
}

/**
 * Whether a culprit session is marked by something INDEPENDENT of the CPU ranking, and so is a fair subject
 * for a machine-wide hold: a hook stalled past the report's own hold, or a STRICT majority of the MACHINE's
 * busy CPU. An unread busy reading licenses nobody. This module's header § "Who a bare HOLD may name"
 * carries the measurement behind both.
 */
function rankIndependentCulprit({ report, session }: { report: MachineCapacityReport; session: SessionLoad }): boolean {
  const stall = session.hookStallSeconds;
  if (stall !== undefined && stall >= report.hookStallHoldSeconds) {
    return true;
  }
  const busyCores = report.hiddenCpu.busyCores;
  if (busyCores === undefined) {
    return false;
  }
  return session.cpuPct > busyCores * 100 - session.cpuPct;
}

/**
 * The subject a hold nobody can fairly be blamed for names: the MACHINE. No kill, no session id, and a label
 * built only from what is holding, so every reading of the same condition signs the same string.
 *
 * The `why` carries the arithmetic that rules the fleet out, and deliberately never the heaviest session's
 * id — naming it in the one field a seat reads (`../../cli/commands/machine/watch.ts` puts this straight into
 * the board row's ask) is the same accusation wearing different clothes. It says "nothing here to kill" in
 * words because `kill: undefined` is a field no rendered line ever shows.
 *
 * **The absent `kill` is READ, not merely unprinted.** `./backoff.ts#consecutiveUnsettled` takes it as the
 * marker that settling this row could not have ended the condition, and so keeps the window's doubling
 * instead of handing it back. Tidying `kill: undefined` into a placeholder string would silently re-arm one
 * seat per sample on a machine-wide hold; that module's header § "Why ANSWERING a row is not always FIXING
 * it" carries the measurement.
 *
 * It is composed here rather than taken from `report.verdict`, and that is the point rather than a
 * duplication: the verdict ENDS in `./capacity.ts`'s own `SUBJECT <session> … end it with \`kill <pid>\``
 * clause, so quoting it puts the accusation and the kill command back into the row verbatim. Measured
 * against the live machine, which is how this was caught. The reading's own numbers stay one
 * command away instead, and the row already carries `load1` in its own field.
 */
function machineSubject({ report }: { report: MachineCapacityReport }): AnomalySubject {
  const sessions = report.fleet.sessions;
  const heaviest = sessions[0];
  const total = sessions.reduce((sum, session) => sum + session.cpuPct, 0);
  let top = "none live";
  let tree: readonly TreeProcess[] = [];
  if (heaviest !== undefined) {
    top = `heaviest ${String(heaviest.cpuPct)}%`;
    tree = heaviest.tree;
  }
  // Without a per-process CPU reading every `cpuPct` here is ZERO, and printing the arithmetic anyway would
  // report an idle fleet on a machine nobody measured — the same lie `./fleetLoad.ts#stalledHookLabel`
  // refuses when a hook's script will not resolve. The verdict is unchanged; only the reason is.
  let arithmetic = `${String(sessions.length)} live session(s), cpu UNATTRIBUTED — nothing was measured to blame`;
  if (report.fleet.cpuAttributed) {
    const fleet = `${String(sessions.length)} live session(s) at ${String(Math.round(total * 10) / 10)}% cpu between them, ${top}`;
    const busyCores = report.hiddenCpu.busyCores;
    arithmetic = `${fleet}, but the machine's busy cpu was UNREAD, so no session can be measured as its majority`;
    if (busyCores !== undefined) {
      arithmetic = `no session is a strict majority of the machine's ${String(busyCores)} busy cores: ${fleet}`;
    }
  }
  // Boots in flight and the disk floor are left out of the label: boots come and go inside three minutes, the
  // disk floor comes and goes with each prune, and a label that moved with either would rotate the signature
  // the backoff dedupes on (`./recentBoots.ts`).
  const held = report.holdSubjects.filter((subject) => !NOT_STANDING.has(subject)).join(" and ");
  return {
    kill: undefined,
    label: `hold on ${held}`,
    sessionId: undefined,
    tree,
    why:
      `HOLD on ${held} — ${arithmetic}. This is the machine, not one session, ` +
      "so there is nothing here to kill; read it with `slopweaver machine capacity`",
  };
}

/**
 * The subject a bare HOLD names — whatever `./fleetCulprit.ts#fleetCulprit` blamed, but only when that blame
 * survives {@link rankIndependentCulprit}. A culprit that is merely the top of a flat list is not a cause,
 * and naming it both accuses an innocent session and rotates the key the backoff dedupes on.
 */
function holdSubject({ report }: { report: MachineCapacityReport }): AnomalySubject {
  const culprit = report.culprit;
  if (culprit === undefined) {
    // A hold naming nobody is the incident `./fleetLoad.ts` exists to end, so the machine
    // subject still carries the heaviest tree on the machine rather than an empty one.
    return machineSubject({ report });
  }
  // A root daemon's relief is the owner's to run, so it rides in prose and `kill` stays absent for `./backoff.ts`.
  if (culprit.endedBy === "owner") {
    const why = `${culprit.why}; relief is the owner's one hand step \`${culprit.kill}\``;
    return { kill: undefined, label: culprit.subject, sessionId: undefined, tree: [], why };
  }
  // Runaway searches are blamed by WHAT they are, never by rank, and their remedy ends no seat — so they skip
  // the rank test below, which would otherwise hand a search-held machine back as "nothing here to kill".
  const search = report.runawaySearches[0];
  if (search !== undefined) {
    return { kill: culprit.kill, label: culprit.subject, sessionId: search.sessionId, tree: [], why: culprit.why };
  }
  const owner = report.fleet.sessions.find((session) => culprit.subject.includes(session.sessionId));
  if (owner !== undefined) {
    if (!rankIndependentCulprit({ report, session: owner })) {
      return machineSubject({ report });
    }
    return {
      kill: culprit.kill,
      label: culprit.subject,
      sessionId: owner.sessionId,
      tree: owner.tree,
      why: culprit.why,
    };
  }
  // No live session matched the culprit clause, so it is an orphan group's — the only other thing
  // `fleetCulprit` ever blames, and the one whose remedy costs no workstream.
  const topOrphan = report.fleet.orphans[0];
  return {
    kill: culprit.kill,
    label: culprit.subject,
    sessionId: undefined,
    tree: topOrphan === undefined ? [] : topOrphan.tree,
    why: culprit.why,
  };
}

/**
 * The dedupe key: what fired, who it was about, and whose session — never a pid, because a restarted daemon
 * gets a new one every time and every recurrence would then look novel.
 */
function signatureOf({ triggers, subject }: { triggers: readonly AnomalyTrigger[]; subject: AnomalySubject }): string {
  // Spelled out rather than `?? "foreign"`: the absence of an owning session is a REAL case with its own
  // meaning (an nx daemon the fleet never launched), not a missing value standing in for a present one.
  let owner = "foreign";
  if (subject.sessionId !== undefined) {
    owner = subject.sessionId;
  }
  return `${triggers.join("+")}|${subject.label}|${owner}`;
}

/**
 * Judge one capacity reading: did anything cross a line, and if so who.
 *
 * A bloated watched daemon is the subject whenever one stands, and signs on its OWN trigger alone. It stands
 * for days while a hog, an overgrown session and the load hold beside it come and go sample to sample, so a
 * signature carrying any of them would make each flip look novel to `./backoff.ts` — the rotating-subject bug
 * by another route — and a lasting hog ranked above it would keep it from ever being named.
 *
 * Otherwise the subject is picked by SEVERITY rather than by trigger order — a sustained multi-core process is
 * a concrete thing to go and look at, an overgrown session is the next most concrete, and a bare hold names
 * whoever `fleetCulprit` blamed only when that blame is rank-independent — otherwise the machine itself, with
 * no kill. Every trigger that fired is still listed, so a row never hides one line behind another.
 *
 * @param report the capacity reading to judge
 * @param singleProcessCores the sustained single-process line, in cores
 * @param sustainedSeconds how long a single process must have held that line to count
 * @param sessionProcessCount the non-hook per-session process line
 * @param daemonFootprintGb the watched-daemon footprint line, in GiB, judged on exact bytes
 * @returns `clear`, or the triggers, the subject and the dedupe signature
 */
export function machineAnomaly({
  report,
  singleProcessCores = DEFAULT_SINGLE_PROCESS_CORES,
  sustainedSeconds = DEFAULT_SUSTAINED_SECONDS,
  sessionProcessCount = DEFAULT_SESSION_PROCESS_COUNT,
  daemonFootprintGb = DEFAULT_DAEMON_FOOTPRINT_GB,
}: {
  report: MachineCapacityReport;
  singleProcessCores?: number;
  sustainedSeconds?: number;
  sessionProcessCount?: number;
  daemonFootprintGb?: number;
}): MachineAnomaly {
  const hog = sustainedHog({ cores: singleProcessCores, report, sustainedSeconds });
  const session = overgrownSession({ report, sessionProcessCount });
  const daemon = bloatedDaemon({ gb: daemonFootprintGb, report });
  const triggers: AnomalyTrigger[] = [];
  // A boots-only or disk-only hold is not an anomaly: boots clear inside the window and the disk floor is
  // `worktree prune`'s, and an investigation seated into either would be one more boot on one more worktree
  // (`./recentBoots.ts`).
  if (machineHoldStands({ hold: report.hold, holdSubjects: report.holdSubjects })) {
    triggers.push("hold");
  }
  if (hog !== undefined) {
    triggers.push("single-process");
  }
  if (session !== undefined) {
    triggers.push("process-count");
  }
  if (daemon !== undefined) {
    triggers.push("daemon-footprint");
  }
  if (triggers.length === 0) {
    return { kind: "clear" };
  }
  // Exclusive rather than overwrites: `holdSubject`'s machine arm composes a sentence about what is
  // HOLDING, and on a reading where no hold fired that sentence would be built and thrown away.
  let subject: AnomalySubject;
  let signed: readonly AnomalyTrigger[] = triggers;
  if (daemon !== undefined) {
    subject = daemonSubject({ daemon, gb: daemonFootprintGb });
    signed = ["daemon-footprint"];
  } else if (hog !== undefined) {
    subject = hogSubject({ hog, report });
  } else if (session !== undefined) {
    subject = sessionSubject({ session });
  } else {
    subject = holdSubject({ report });
  }
  return { kind: "anomalous", signature: signatureOf({ subject, triggers: signed }), subject, triggers };
}
