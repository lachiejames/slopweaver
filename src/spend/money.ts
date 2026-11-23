/**
 * Amounts as integer minor units, parsed from and printed back to the page's own spelling.
 *
 * No float ever touches an amount: `2,410.58` becomes 241058 by string surgery, so a sum of many charges is
 * exact. Totals are kept PER CURRENCY and never converted — see `./types.ts`'s `Money`.
 */
import type { Money } from "./types.js";

/** `1,234.50 AUD` — grouped or ungrouped digits, exactly two decimals, a three-letter code. */
const AMOUNT = /^(\d{1,3}(?:,\d{3})+|\d+)\.(\d{2}) ([A-Z]{3})$/;

/**
 * Parse one amount exactly as the page prints it.
 *
 * @param text the amount text, e.g. `2,410.58 AUD`
 * @returns the amount, or undefined when the text is not in the page's shape
 */
export function parseMoney({ text }: { text: string }): Money | undefined {
  const match = AMOUNT.exec(text.trim());
  if (match === null) {
    return undefined;
  }
  const whole = Number(match[1]!.replaceAll(",", ""));
  return { currency: match[3]!, minor: whole * 100 + Number(match[2]!) };
}

/**
 * Print an amount the way the page does: grouped whole units, two decimals, the code.
 *
 * @param money the amount to print
 * @returns e.g. `2,410.58 AUD`, or `-12.00 AUD` for a negative one
 */
export function formatMoney({ money }: { money: Money }): string {
  const sign = money.minor < 0 ? "-" : "";
  const absolute = Math.abs(money.minor);
  const whole = Math.floor(absolute / 100).toLocaleString("en-AU");
  const cents = String(absolute % 100).padStart(2, "0");
  return `${sign}${whole}.${cents} ${money.currency}`;
}

/**
 * Sum amounts per currency, never across one.
 *
 * @param amounts the amounts to total
 * @returns one total per currency present, sorted by currency code
 */
export function sumByCurrency({ amounts }: { amounts: readonly Money[] }): readonly Money[] {
  const totals = new Map<string, number>();
  for (const amount of amounts) {
    const running = totals.get(amount.currency);
    if (running === undefined) {
      totals.set(amount.currency, amount.minor);
      continue;
    }
    totals.set(amount.currency, running + amount.minor);
  }
  return [...totals.entries()]
    .toSorted(([a], [b]) => a.localeCompare(b))
    .map(([currency, minor]) => ({ currency, minor }));
}
