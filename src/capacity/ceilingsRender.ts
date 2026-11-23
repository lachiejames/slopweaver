/**
 * The ceilings reading as text: the lines `machine capacity` prints under the machine report and the refusal
 * the idle-capacity gate prints, and the one clause the fleet briefing carries. Pure; numbers are rounded here
 * and only here, so `--json` keeps the exact values.
 */
import { admissionOf } from "./admission.js";
import type { Ceiling, CeilingsReading, CeilingWindow } from "./ceilings.js";

/** A number as a reader compares it — at most two decimals, no trailing zeros. */
function num({ value }: { value: number }): string {
  return String(Math.round(value * 100) / 100);
}

/** A reset instant to the minute, `1999-10-03T22:00Z`; anything not in UTC `Z` form prints verbatim. */
function minute({ iso }: { iso: string }): string {
  if (!iso.endsWith("Z") || iso.length < 16) {
    return iso;
  }
  return `${iso.slice(0, 16)}Z`;
}

/** One window as `name used/available`, with its reset when it has one. */
function windowText({ window }: { window: CeilingWindow }): string {
  const used = `${window.window} ${num({ value: window.used })}/${num({ value: window.available })}`;
  if (window.resetAtIso === null) {
    return used;
  }
  return `${used} resets ${minute({ iso: window.resetAtIso })}`;
}

/** A ceiling's unused share as a whole percentage, or `unknown` for one that could not be read. */
function unusedPct({ ceiling }: { ceiling: Ceiling }): string {
  if (ceiling.headroom === null) {
    return "unknown";
  }
  return `${String(Math.round(ceiling.headroom * 100))}%`;
}

/** A ceiling's unused share in a sentence of its own. */
function unusedText({ ceiling }: { ceiling: Ceiling }): string {
  if (ceiling.headroom === null) {
    return "unknown";
  }
  return `${unusedPct({ ceiling })} unused`;
}

/**
 * The window that binds a ceiling — the least headroom — leaving the Fable week out of a Claude plan, because
 * an all-models seat never spends it.
 */
function bindingWindow({ ceiling }: { ceiling: Ceiling }): CeilingWindow | undefined {
  const candidates = ceiling.windows.filter((window) => window.window !== "fable-seven-day");
  let binding: CeilingWindow | undefined;
  for (const window of candidates) {
    if (binding === undefined || window.used / window.available > binding.used / binding.available) {
      binding = window;
    }
  }
  return binding;
}

/**
 * One line per ceiling, every window as used of available with its reset, under a head naming the lowest.
 *
 * @param reading the ceilings reading
 * @returns the lines, head first, then one per ceiling in reading order, then each problem
 */
export function ceilingLines({ reading }: { reading: CeilingsReading }): readonly string[] {
  const selected = reading.selectedRoute;
  const admission = admissionOf({ reading });
  let head = "ceilings: no ceiling carries a number, so which one binds is unknown";
  if (selected !== null) {
    head =
      `ceilings: lowest unused is ${selected.limitingCeilingId} — a seat can start now via ${selected.driver} on ` +
      `${selected.planCeilingId}, ${String(Math.round(selected.headroom * 100))}% headroom`;
  } else if (admission.kind === "free") {
    head = `ceilings: lowest unused is ${admission.binding} — no plan could be read, so the machine alone admits a seat`;
  } else if (reading.lowest !== null) {
    head = `ceilings: no seat can start now — lowest is ${reading.lowest}`;
  }
  const rows = reading.ceilings.map((ceiling) => {
    const windows = ceiling.windows.map((window) => windowText({ window })).join(" · ");
    const reason = ceiling.reason === null ? "" : ` (${ceiling.reason})`;
    const body = windows.length === 0 ? "" : ` — ${windows}`;
    return `  ${ceiling.id} ${ceiling.status}, ${unusedText({ ceiling })}${body}${reason}`;
  });
  return [head, ...rows, ...reading.problems.map((problem) => `  could not read: ${problem}`)];
}

/**
 * The briefing's clause: every ceiling's unused share with the window that binds it, then the lowest.
 *
 * @param reading the ceilings reading
 * @returns one clause, `unused now: machine 0% (load1 32.31/22), …; lowest machine`
 */
export function unusedNowClause({ reading }: { reading: CeilingsReading }): string {
  const parts = reading.ceilings.map((ceiling) => {
    const window = bindingWindow({ ceiling });
    let detail: string = ceiling.status;
    if (window !== undefined) {
      detail = windowText({ window });
    }
    if (ceiling.status !== "open" && window !== undefined) {
      detail = `${ceiling.status}, ${detail}`;
    }
    return `${ceiling.id} ${unusedPct({ ceiling })} (${detail})`;
  });
  let lowest = "lowest unknown";
  if (reading.lowest !== null) {
    lowest = `lowest ${reading.lowest}`;
  }
  return `unused now: ${parts.join(", ")}; ${lowest}`;
}
