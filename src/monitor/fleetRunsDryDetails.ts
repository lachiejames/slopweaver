/**
 * The `fleet-runs-dry` card's details: the machine, then one line per configured Claude and Codex plan in the
 * reading's order — its status, the spent window that holds it, that window's reset, its account and its free
 * resets — a Codex monthly-spend plan marked as never routed rather than dropped.
 *
 * Every plan is accounted for, Codex included, and usage resets count. So every plan is a line, and
 * a plan's free resets are named as held or as unread, never left off. A fleet that cannot be listed whole inside
 * the card's caps is a reason, never a shortened list, so `./fleetRunsDry.ts` reads it unmeasurable rather than
 * posting a card that reads whole and is not.
 *
 * Pure: a reading and its interval in, lines or a reason out.
 */
import { parseIsoMs } from "#lib/date.js";

import type { Ceiling, CeilingsReading } from "../capacity/ceilings.js";
import { checkedDetails, DETAIL_LINE_CAP, DETAILS_MAX } from "../hand/details.js";

import { type FleetDryInterval, spentWindows } from "./fleetRunsDryCeilings.js";
import { neverRouted } from "./fleetRunsDryRegister.js";

/**
 * An ISO instant to the UTC minute, converted rather than sliced: a provider instant carrying an offset would
 * otherwise print as a different instant. One that names no instant prints as filed, never as a wrong one.
 *
 * @param iso the instant to print
 * @returns `YYYY-MM-DDTHH:MMZ`, or `iso` itself when it names no instant
 */
export function minute({ iso }: { iso: string }): string {
  const ms = parseIsoMs({ tsIso: iso });
  if (ms === undefined) {
    return iso;
  }
  return `${new Date(ms).toISOString().slice(0, 16)}Z`;
}

/** A number of used or available percent, as a reader reads it. */
function amount({ value }: { value: number }): string {
  return String(Math.round(value * 100) / 100);
}

/** The machine's line: its status and its load against its hold. */
function machineLine({ machine }: { machine: Ceiling }): string {
  const load = machine.windows[0];
  const read =
    load === undefined ? "load unread" : `load ${amount({ value: load.used })} of ${amount({ value: load.available })}`;
  return `machine — ${machine.status}, ${read}: not what stops a seat`;
}

/** What a plan's account cell says, or that the reading carries none. */
function accountClause({ ceiling }: { ceiling: Ceiling }): string {
  if (typeof ceiling.account === "string") {
    return ceiling.account;
  }
  return "account unread";
}

/** What a plan holds in free resets, or that this reading does not read them. */
function freeResetsClause({ ceiling }: { ceiling: Ceiling }): string {
  if (typeof ceiling.freeResets === "number") {
    return `${String(ceiling.freeResets)} free reset(s) held`;
  }
  return "free resets unread";
}

/** One plan's line: its status, the spent window holding it latest and that window's reset, its account, its resets. */
function planLine({
  ceiling,
  interval,
  nowMs,
}: {
  ceiling: Ceiling;
  interval: FleetDryInterval;
  nowMs: number;
}): string {
  const provider = ceiling.kind === "claude" ? "Claude" : "Codex";
  const tail = `${accountClause({ ceiling })}; ${freeResetsClause({ ceiling })}`;
  if (neverRouted({ ceiling })) {
    return `${ceiling.id} — ${provider}, monthly spend, never routed: ${tail}`;
  }
  const holding = spentWindows({ ceiling, nowMs, routingBars: interval.routingBars }).toSorted(
    (left, right) => right.resetMs - left.resetMs,
  )[0];
  const ends = ceiling.id === interval.relievedByCeilingId ? "; its reset ends the dry interval" : "";
  if (holding === undefined) {
    return `${ceiling.id} — ${provider}, ${ceiling.status}, no spent window read: ${tail}${ends}`;
  }
  const { window } = holding;
  const used = `${window.window} ${amount({ value: window.used })} of ${amount({ value: window.available })}`;
  return `${ceiling.id} — ${provider}, ${ceiling.status}, ${used}: resets ${minute({ iso: window.resetAtIso! })}; ${tail}${ends}`;
}

/**
 * Every detail line — the machine, then each plan in the reading's order — or why the card cannot carry them whole.
 *
 * @param reading the filed ceilings reading the interval was judged from
 * @param interval the dry interval, whose relieving plan its line names
 * @returns the lines, or the sentence saying which cap they cannot fit
 */
export function fleetDryDetails({
  reading,
  interval,
}: {
  reading: CeilingsReading;
  interval: FleetDryInterval;
}): { readonly details: readonly string[] } | { readonly because: string } {
  const nowMs = parseIsoMs({ tsIso: interval.fromIso })!;
  const details = reading.ceilings.map((ceiling) => {
    if (ceiling.kind === "machine") {
      return machineLine({ machine: ceiling });
    }
    return planLine({ ceiling, interval, nowMs });
  });
  if (details.length > DETAILS_MAX) {
    return {
      because:
        `the fleet is ${String(details.length)} detail lines and a card carries ${String(DETAILS_MAX)}, ` +
        "so it cannot list every plan — `slopweaver machine capacity` prints them all",
    };
  }
  // An account cell or an alias is any string, so a line can outgrow the cap; cutting it would drop what it names.
  const overlong = details.find((line) => line.length > DETAIL_LINE_CAP);
  if (overlong !== undefined) {
    return {
      because:
        `a fleet line is ${String(overlong.length)} characters and a card line carries ${String(DETAIL_LINE_CAP)}, ` +
        `so it cannot list that plan whole: ${overlong.slice(0, 80)}…`,
    };
  }
  // The card's own validator, so whatever else it refuses (an alias carrying a newline) reads unmeasurable rather
  // than firing a reading no card can carry.
  const postable = checkedDetails({ value: details });
  if (postable.isErr()) {
    return {
      because: `the fleet's details cannot go on a card, so no plan is dropped to fit: ${postable.error.message}`,
    };
  }
  return { details };
}
