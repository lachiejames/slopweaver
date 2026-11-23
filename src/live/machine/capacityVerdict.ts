/**
 * The one-line verdict `machine capacity` prints — the pure text half of `./capacity.ts`, which grades a reading
 * into holds and alerts and hands the crossings here to be named. Split from it along that seam: grading decides
 * WHAT crossed, this decides how the line reads, and neither needs the other's thresholds.
 */
import type { CompressorGauge, LoadAverage, SwapUsage } from "./capacityParse.js";
import type { RankedProcess } from "./capacityRank.js";
import type { FleetCulprit } from "./fleetCulprit.js";
import { type HiddenCpuReading, hiddenCpuClause } from "./hiddenCpu.js";

/**
 * Which thing a reading belongs to. `memory` is the foreign-hog footprint, swap, the compressor and the
 * swapfile count; `cpu` is the load average; `boots` is the sessions started too recently for the load to
 * see (`./recentBoots.ts`). Every verdict names the subjects it graded, because `ok` meaning
 * `ok on memory` is the defect this split exists to end.
 *
 * `boots` is a HOLD subject and never a GRADED one: it is a forecast of load the average has not caught up
 * with, not a state of the machine, so it holds a spawn and is never what an `ok` is an `ok` about.
 *
 * `disk` is a HOLD subject and never a GRADED one too: the volume's free space below the floor
 * (`./diskFootprint.ts`'s header) holds discretionary seating until `worktree prune --apply` frees it.
 */
export type CapacitySubject = "memory" | "cpu" | "boots" | "disk";

/** The order subjects are named in, so two verdicts of the same shape read the same way. */
const SUBJECT_ORDER: readonly CapacitySubject[] = ["memory", "cpu", "boots", "disk"];

/**
 * The hold subjects that are never a STANDING machine hold: each holds discretionary seating, and neither
 * seats an investigation nor refuses a load dispatch. `boots` clears as the sessions settle, and `disk` is
 * cleared by `worktree prune`, never by a session reasoning about it.
 */
export const NOT_STANDING: ReadonlySet<CapacitySubject> = new Set<CapacitySubject>(["boots", "disk"]);

/** One threshold crossing: which subject it belongs to, and the clause a verdict prints for it. */
export interface GradeReason {
  readonly subject: CapacitySubject;
  readonly text: string;
}

/**
 * The distinct subjects a set of crossings belongs to.
 *
 * @returns each subject at least one crossing names, in {@link SUBJECT_ORDER}
 */
export function subjectsOf({ reasons }: { reasons: readonly GradeReason[] }): readonly CapacitySubject[] {
  return SUBJECT_ORDER.filter((subject) => reasons.some((reason) => reason.subject === subject));
}

/** Subjects as the words a verdict prints — `memory`, `cpu`, `memory and cpu`, or `nothing` for an empty set. */
function subjectPhrase({ subjects }: { subjects: readonly CapacitySubject[] }): string {
  const ordered = SUBJECT_ORDER.filter((subject) => subjects.includes(subject));
  return ordered.length === 0 ? "nothing" : ordered.join(" and ");
}

/**
 * The summary tail every verdict ends with: the 1-minute load and `top`'s idle, then the foreign hog, swap, compressor and
 * swapfile readings. Load LEADS because it is the reading whose absence let an `ok` stand on a machine that
 * could not pass a gate (the threshold header above) — a reader who stops at the first clause has still seen it.
 * A process that refused its stats rides directly behind the foreign hog, because a hog the table cannot see
 *  is exactly the one that clause would otherwise misname (`./hiddenCpu.ts`).
 *
 * @returns the summary tail, its clauses joined by ` · `
 */
export function verdictSummary({
  load,
  topForeign,
  hiddenCpu,
  swap,
  compressor,
  swapfileCount,
}: {
  load: LoadAverage | undefined;
  topForeign: RankedProcess | undefined;
  hiddenCpu: HiddenCpuReading;
  swap: SwapUsage | undefined;
  compressor: CompressorGauge | undefined;
  swapfileCount: number | undefined;
}): string {
  const loadOnly = load === undefined ? "load unmeasured" : `1-min load ${String(load.load1)}`;
  // Idle rides beside the load because it grades the load hold, and it is the figure Activity Monitor shows the owner.
  const idlePart = hiddenCpu.idlePct === undefined ? "idle unmeasured" : `${String(hiddenCpu.idlePct)}% idle`;
  const loadPart = `${loadOnly} · ${idlePart}`;
  const foreignPart =
    topForeign === undefined
      ? "no foreign process observed"
      : `top foreign hog '${topForeign.label}' at ${String(topForeign.footprintGb)} GB`;
  const hiddenPart = hiddenCpuClause({ reading: hiddenCpu });
  const hogPart = hiddenPart === undefined ? foreignPart : `${foreignPart} · ${hiddenPart}`;
  const swapPart = swap === undefined ? "swap unmeasured" : `swap ${String(swap.usedGb)}/${String(swap.totalGb)} GB`;
  const compressorPart =
    compressor === undefined
      ? "compressor unmeasured"
      : `compressor ${String(compressor.segmentsPct)}% of segments limit`;
  const swapfilePart = swapfileCount === undefined ? "swapfiles uncounted" : `${String(swapfileCount)} swapfiles`;
  return `${loadPart} · ${hogPart} · ${swapPart} · ${compressorPart} · ${swapfilePart}`;
}

/**
 * How the verdict says to end its subject: a seat's `kill`, or a root daemon's relief as the owner's hand step.
 * Never during a call, because restarting fseventsd stalls configd about a minute and drops the network
 * (`../../monitor/fseventsdBloated.ts` § "Never during a call").
 */
function endClause({ culprit }: { culprit: FleetCulprit }): string {
  if (culprit.endedBy === "owner") {
    return `relief is the owner's one hand step \`${culprit.kill}\`, never during a call`;
  }
  return `end it with \`${culprit.kill}\``;
}

/**
 * The one-line verdict. `HOLD` leads whenever the compressor, the swapfile count, the 1-minute load or the
 * boots in flight crossed its threshold, because that is the line that stops a spawn; an `ALERT` is appended to it, or stands alone
 * when only a foreign hog or swap crossed — a foreign hog is a briefing line, never by itself a hold
 * (`fleet-capacity.md`).
 *
 * **Every grade names its subject**, and a subject nothing could be read for is called UNGRADED rather than
 * folded into the grade: a bare `ok` that meant `ok on memory` is what let a session spawn onto a machine at
 * load 34.84 (the threshold header above). `graded` is empty only when nothing at all was readable, and the
 * verdict then says so instead of claiming an `ok` it cannot support.
 *
 * @returns the whole `machine capacity: …` line
 */
export function renderVerdict({
  holds,
  alerts,
  graded,
  ungraded,
  summary,
  culprit,
}: {
  holds: readonly GradeReason[];
  alerts: readonly GradeReason[];
  graded: readonly CapacitySubject[];
  ungraded: readonly CapacitySubject[];
  summary: string;
  culprit: FleetCulprit | undefined;
}): string {
  const parts: string[] = [];
  if (holds.length > 0) {
    const where = subjectPhrase({ subjects: subjectsOf({ reasons: holds }) });
    parts.push(`HOLD on ${where} (${holds.map((reason) => reason.text).join("; ")})`);
  }
  if (alerts.length > 0) {
    const where = subjectPhrase({ subjects: subjectsOf({ reasons: alerts }) });
    parts.push(`ALERT on ${where} (${alerts.map((reason) => reason.text).join(", ")})`);
  }
  if (parts.length === 0) {
    parts.push(graded.length === 0 ? "graded nothing" : `ok on ${subjectPhrase({ subjects: graded })}`);
  }
  if (ungraded.length > 0) {
    parts.push(`${subjectPhrase({ subjects: ungraded })} UNGRADED`);
  }
  // ONE clause, never a table: this line is pasted verbatim into react-now (sweep-contract.md step 8) and
  // doctrine rule 7 caps what may stand above the fold. The per-session breakdown is the text report's.
  if (culprit !== undefined) {
    parts.push(`SUBJECT ${culprit.subject} — ${culprit.why}; ${endClause({ culprit })}`);
  }
  return `machine capacity: ${parts.join(" · ")} — ${summary}`;
}
