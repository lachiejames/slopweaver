/**
 * The words of `./fleetWhy.ts`'s report — the sentences the Fleet page's glance shows under its verdict and the
 * lines `slopweaver fleet why` prints. One renderer, so the page and the verb can never say two different things.
 *
 * Every figure is the report's own; nothing here measures. The wording keeps the claim boundaries `./fleetWhy.ts`
 * states: a hold is the policy's reason, the window is sampled, unattributed cpu is assigned to nobody, and the
 * seats the owner could add are computed for them rather than left for them to subtract.
 */
import type { FleetWhyFacts, FleetWhyPlans, FleetWhyReport } from "./fleetWhy.js";
import type { FleetWhyWindow } from "./fleetWhyWindow.js";

/**
 * A count of seats as a reader says it.
 *
 * @returns e.g. `1 working seat`, `4 working seats`
 */
function seatsWords({ n }: { n: number }): string {
  return `${String(n)} working seat${n === 1 ? "" : "s"}`;
}

/**
 * The working seats against the ceiling they reached.
 *
 * @returns e.g. `4 working seats fill the 4 the plans' week carries`, or `6 working seats, above the 4 …`
 */
function atCeilingWords({ working, ceiling }: { working: number; ceiling: number }): string {
  if (working > ceiling) {
    return `${seatsWords({ n: working })}, above the ${String(ceiling)} the plans' week carries`;
  }
  return `${seatsWords({ n: working })} fill the ${String(ceiling)} the plans' week carries`;
}

/**
 * The cost of ten seats, when the plans were measured.
 *
 * @returns the clause, or an empty string
 */
function tenClause({ plans }: { plans: FleetWhyPlans }): string {
  if (plans.kind !== "measured") {
    return "";
  }
  const share = Math.round(plans.burnPerWorkingSeatDay * 100);
  return ` A working seat spends about ${String(share)}% of a plan's week a day; ten would spend the plans ${plans.tenSeatSpendMultiple.toFixed(1)}× as fast as they reset.`;
}

/**
 * The first sentence: what stops one more working seat right now.
 *
 * @returns the sentence
 */
function bindingSentence({ report }: { report: FleetWhyFacts }): string {
  const { binding, current, plans } = report;
  const subjects = current.holdSubjects.join(", ");
  if (binding === "unknown" || current.working === null) {
    if (report.unknownBecause === null) {
      return "What binds the fleet right now is not known.";
    }
    return `${capitalised({ text: report.unknownBecause })}.`;
  }
  if (binding === "machine" && (current.ceilingSeats === null || plans.kind !== "measured")) {
    return `The latest tick held new seats on ${subjects}, and how many the plans carry is not measured.`;
  }
  // Every binding past here was judged against a measured ceiling, so it is there.
  const ceiling = current.ceilingSeats!;
  if (binding === "both") {
    return `${atCeilingWords({ ceiling, working: current.working })}, and the latest tick also held new seats on ${subjects}.${tenClause({ plans })}`;
  }
  if (binding === "plans") {
    return `${atCeilingWords({ ceiling, working: current.working })}, and the latest tick did not hold the machine.${tenClause({ plans })}`;
  }
  const free = ceiling - current.working;
  if (binding === "machine") {
    return `The latest tick held new seats on ${subjects}; the plans' week would carry ${String(free)} more than the ${String(current.working)} working.`;
  }
  const fit = free === 1 ? "1 more working seat fits" : `${String(free)} more working seats fit`;
  return `${fit} the plans' week than the ${String(current.working)} working, and the latest tick did not hold the machine.`;
}

/**
 * Upper-case a sentence's first letter.
 *
 * @returns the text
 */
function capitalised({ text }: { text: string }): string {
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

/**
 * The second sentence: what the sampled machine readings measured over the window.
 *
 * @returns the sentence
 */
function windowSentence({ window, minutes }: { window: FleetWhyWindow; minutes: number }): string {
  const span = `the last ${String(minutes)} min`;
  if (window.readings === 0 || window.load1 === null) {
    return `No machine capacity reading landed in ${span}, so what the machine measured is not known.`;
  }
  const subjects = window.heldSubjects.map((entry) => entry.subject).join(", ");
  let held = `None of ${String(window.readings)} sampled machine readings held in ${span}`;
  if (window.readings === 1) {
    held = `The one sampled machine reading in ${span} did not hold`;
    if (window.heldReadings === 1) {
      held = `The one sampled machine reading in ${span} held, on ${subjects}`;
    }
  } else if (window.heldReadings > 0) {
    held = `${String(window.heldReadings)} of ${String(window.readings)} sampled machine readings held in ${span}, on ${subjects}`;
  }
  let busy = "";
  if (window.busyCores !== null) {
    busy = `, ${String(window.busyCores.max)} cores busy at the most`;
  }
  return `${held}; 1-minute load peaked at ${String(window.load1.max)} against the hold at ${String(window.loadHold)}${busy}.`;
}

/**
 * The third sentence: where the cpu went, as far as the readings captured it.
 *
 * @returns the sentence, or an empty string when the window attributed no cpu
 */
function cpuSentence({ window }: { window: FleetWhyWindow }): string {
  const parts: string[] = [];
  if (window.fleetCpuPct !== null) {
    parts.push(`the seats and their tools used ${(window.fleetCpuPct.mean / 100).toFixed(1)} cores on average`);
  }
  if (window.topForeign.length > 0) {
    const named = window.topForeign.map((hog) => `${hog.label} ${String(Math.round(hog.meanCapturedCpuPct))}%`);
    parts.push(`the heaviest other processes were ${named.join(", ")}`);
  }
  if (window.unattributedCores !== null) {
    const hidden = window.hiddenFromTop.map((entry) => entry.label);
    let whoHid = "";
    if (hidden.length > 0) {
      const more = hidden.length > 1 ? ` and ${String(hidden.length - 1)} more` : "";
      whoHid = `, while ${hidden[0]!}${more} ran hidden from top`;
    }
    parts.push(`${String(window.unattributedCores.mean)} cores went unattributed${whoHid}`);
  }
  if (parts.length === 0) {
    return "";
  }
  return `${capitalised({ text: parts.join("; ") })}.`;
}

/**
 * The report as the sentences a reader reads, in order: what binds now, what the window measured, where the cpu
 * went.
 *
 * @returns one to three sentences
 */
export function fleetWhySentences({ report }: { report: FleetWhyFacts }): readonly string[] {
  return [
    bindingSentence({ report }),
    windowSentence({ minutes: report.minutes, window: report.window }),
    cpuSentence({ window: report.window }),
  ].filter((sentence) => sentence.length > 0);
}

/**
 * The lines `slopweaver fleet why` prints: the sentences, then each problem the reader could not see past.
 *
 * @returns the lines
 */
export function renderFleetWhyLines({ report }: { report: FleetWhyReport }): readonly string[] {
  return [
    ...report.sentences,
    `binding: ${report.binding}${report.current.tick === null ? "" : ` (${report.current.tick})`} · window ${report.window.fromIso} → ${report.window.toIso}`,
    ...report.problems.map((problem) => `problem: ${problem}`),
  ];
}
