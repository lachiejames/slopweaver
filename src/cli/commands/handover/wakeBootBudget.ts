/**
 * How many boots one `handover wake` run may spend — wake reseats count against the 180-second boot window.
 *
 * Every reseat is one Claude boot, and `cmux spawn` holds once {@link DEFAULT_RECENT_BOOTS_HOLD} sessions started
 * inside the 180-second window (`../../../live/machine/recentBoots.ts`). The tick runs the wake BEFORE the chair's
 * own fill, so a wake that spent the window starved the fill behind it. A run's budget is therefore
 * {@link WAKE_BOOT_SHARE} less the boots already in flight: the wake and whatever just booted never hold more than
 * that share of the window, and the rest is left for the fill. The order the budget is spent in is
 * `../../../handover/wakeOrder.ts`.
 */
import { DEFAULT_RECENT_BOOTS_HOLD } from "../../../live/machine/recentBoots.js";

/** The share of the boot window's hold the wake may fill: half, so the chair's fill always has the other half. */
export const WAKE_BOOT_SHARE = Math.floor(DEFAULT_RECENT_BOOTS_HOLD / 2);

/**
 * How many reseats one run may attempt: {@link WAKE_BOOT_SHARE} less the boots already in flight, never below 0.
 *
 * @param bootsInFlight Claude sessions that started inside the boot window when the run began
 * @returns the run's attempt budget
 */
export function wakeBootBudget({ bootsInFlight }: { bootsInFlight: number }): number {
  return Math.max(0, WAKE_BOOT_SHARE - bootsInFlight);
}
