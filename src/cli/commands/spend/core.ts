/**
 * Pure argument handling and rendering for the `spend` noun. No filesystem, no clock: `./run.ts` is the shell.
 */
import { err, ok, type Result } from "../../../lib/result.js";
import { isIsoDay } from "../../../spend/exportLines.js";
import { merchantIdentityLabel } from "../../../spend/merchants/core.js";
import { formatMoney } from "../../../spend/money.js";
import type { CardReport, LatestDeclines, Money } from "../../../spend/types.js";
import { flagValue, flagValueOr, parseFlagTail } from "../../optionParsers.js";
import { type FlagSpec, parseFlags } from "../../parseFlags.js";

/** `spend import`'s flags. */
const SPEND_IMPORT_FLAGS: FlagSpec = { boolean: ["json"], string: ["as-of", "home"] };

/** `spend read`'s flags. */
const SPEND_READ_FLAGS = { boolean: ["json"], value: ["by", "card", "home"] } as const;

/** Every `spend import` flag NAME. */
export const SPEND_IMPORT_FLAG_NAMES: readonly string[] = ["--as-of", "--home", "--json"];

/** Every `spend read` flag NAME. */
export const SPEND_READ_FLAG_NAMES: readonly string[] = ["--by", "--card", "--home", "--json"];

/** `spend tasks`'s flags. */
const SPEND_TASKS_FLAGS = { boolean: ["json"], value: ["home"] } as const;

/** Every `spend tasks` flag NAME. */
export const SPEND_TASKS_FLAG_NAMES: readonly string[] = ["--home", "--json"];

/** A parsed `spend tasks` invocation. */
export interface SpendTasksOptions {
  readonly home: string | undefined;
  readonly json: boolean;
}

/**
 * Parse `spend tasks`'s argv tail.
 *
 * @param rest the argv after the verb
 * @returns the resolved options, or one line per refusal
 */
export function parseSpendTasksArgs({ rest }: { rest: readonly string[] }): Result<SpendTasksOptions> {
  const parsed = parseFlagTail({ rest, spec: SPEND_TASKS_FLAGS });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  let home: string | undefined;
  const homeFlag = flagValue({ name: "home", parsed: parsed.value });
  if (homeFlag !== null) {
    home = homeFlag;
  }
  return ok({ home, json: parsed.value.flags.has("json") });
}

/** `spend forward`'s flags. */
const SPEND_FORWARD_FLAGS = { boolean: ["dry-run", "json"], value: ["home"] } as const;

/** Every `spend forward` flag NAME. */
export const SPEND_FORWARD_FLAG_NAMES: readonly string[] = ["--dry-run", "--home", "--json"];

/** A parsed `spend forward` invocation. */
export interface SpendForwardOptions {
  readonly home: string | undefined;
  readonly json: boolean;
  readonly dryRun: boolean;
}

/**
 * Parse `spend forward`'s argv tail.
 *
 * @param rest the argv after the verb
 * @returns the resolved options, or one line per refusal
 */
export function parseSpendForwardArgs({ rest }: { rest: readonly string[] }): Result<SpendForwardOptions> {
  const parsed = parseFlagTail({ rest, spec: SPEND_FORWARD_FLAGS });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  let home: string | undefined;
  const homeFlag = flagValue({ name: "home", parsed: parsed.value });
  if (homeFlag !== null) {
    home = homeFlag;
  }
  return ok({ dryRun: parsed.value.flags.has("dry-run"), home, json: parsed.value.flags.has("json") });
}

/** The axes `spend read --by` totals on. */
export type SpendAxis = "merchant" | "month";

/** A parsed `spend import` invocation. */
export interface SpendImportOptions {
  readonly path: string;
  readonly asOf: string;
  readonly home: string | undefined;
  readonly json: boolean;
}

/** A parsed `spend read` invocation. */
export interface SpendReadOptions {
  readonly card: string | undefined;
  readonly by: SpendAxis;
  readonly home: string | undefined;
  readonly json: boolean;
}

/**
 * One refusal of a flag's value.
 *
 * @param flag the flag, without `--`
 * @param want what it must be
 * @param got what was given
 * @returns the refusal line
 */
function mustBe({ flag, got, want }: { flag: string; got: string; want: string }): string {
  return `--${flag} must be ${want}, got ${got}`;
}

/**
 * Parse `spend import`'s argv tail.
 *
 * @param rest the argv after the verb
 * @returns the resolved options, or one line per refusal
 */
export function parseSpendImportArgs({ rest }: { rest: readonly string[] }): Result<SpendImportOptions> {
  const parsed = parseFlags({ allowPositionals: true, args: rest, spec: SPEND_IMPORT_FLAGS });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { positionals, values } = parsed.value;
  if (positionals.length !== 1) {
    return err([`spend import takes exactly one path to a saved card-page export, got ${String(positionals.length)}`]);
  }
  const asOf = values["as-of"];
  if (typeof asOf !== "string") {
    return err(["--as-of <YYYY-MM-DD> is required — the day the page was captured, never guessed"]);
  }
  if (!isIsoDay({ text: asOf })) {
    return err([mustBe({ flag: "as-of", got: asOf, want: "a YYYY-MM-DD day" })]);
  }
  let home: string | undefined;
  if (typeof values["home"] === "string") {
    home = values["home"];
  }
  return ok({ asOf, home, json: values["json"] === true, path: positionals[0]! });
}

/**
 * Parse `spend read`'s argv tail.
 *
 * @param rest the argv after the verb
 * @returns the resolved options, or one line per refusal
 */
export function parseSpendReadArgs({ rest }: { rest: readonly string[] }): Result<SpendReadOptions> {
  const parsed = parseFlagTail({ rest, spec: SPEND_READ_FLAGS });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const by = flagValueOr({ fallback: "merchant", name: "by", parsed: parsed.value });
  if (by !== "merchant" && by !== "month") {
    return err([mustBe({ flag: "by", got: by, want: "merchant or month" })]);
  }
  const card = flagValue({ name: "card", parsed: parsed.value });
  if (card !== null && !/^\d{4}$/.test(card)) {
    return err([mustBe({ flag: "card", got: card, want: "the card's last four digits" })]);
  }
  let home: string | undefined;
  const homeFlag = flagValue({ name: "home", parsed: parsed.value });
  if (homeFlag !== null) {
    home = homeFlag;
  }
  let cardLast4: string | undefined;
  if (card !== null) {
    cardLast4 = card;
  }
  return ok({ by, card: cardLast4, home, json: parsed.value.flags.has("json") });
}

/**
 * Print several per-currency totals as one phrase.
 *
 * @param totals the totals, one per currency
 * @returns e.g. `120.00 AUD + 10.00 USD`, or `nothing` for none
 */
function totalsText({ totals }: { totals: readonly Money[] }): string {
  if (totals.length === 0) {
    return "nothing";
  }
  return totals.map((money) => formatMoney({ money })).join(" + ");
}

/**
 * The lines about the latest declines — what the page proves, and the one thing it never shows.
 *
 * @param report the card report
 * @returns the lines, indented under the card
 */
function declineLines({ report }: { report: CardReport }): readonly string[] {
  const declines = report.latestDeclines;
  if (declines === null) {
    return ["  declines: none on the page"];
  }
  const lines = [`  declines: ${String(report.declineCount)} on the page; the latest, ${declines.date}:`];
  for (const row of declines.rows) {
    let against = "within today's headroom";
    if (row.exceedsHeadroomAsOf === "yes") {
      against = "over today's headroom";
    } else if (row.exceedsHeadroomAsOf === "different-currency") {
      against = "not comparable to the limit without a rate";
    }
    let registered = "no registered merchant";
    if (row.identity.kind === "merchant") {
      registered = row.identity.slug;
    }
    let reason = "";
    if (row.reason !== null) {
      reason = `; Airwallex: ${row.reason}`;
    }
    lines.push(`    ${formatMoney({ money: row.amount })} ${row.merchant} (${registered}) — ${against}${reason}`);
  }
  const money = ({ amounts }: { amounts: readonly Money[] }): string =>
    amounts.map((amount) => formatMoney({ money: amount })).join(", ");
  if (declines.chargedAfter.length > 0) {
    lines.push(`    charged after them: ${money({ amounts: declines.chargedAfter })}`);
  }
  if (declines.heldBefore.length > 0) {
    lines.push(
      `    cancelled or verification holds before them, which may have been holding headroom: ${money({ amounts: declines.heldBefore })}`,
    );
  }
  lines.push(`    so the headroom they had was at least ${formatMoney({ money: declines.headroomThenAtLeast })}`);
  lines.push(verdictLine({ declines }));
  return lines;
}

/**
 * The closing line on the latest declines: what headroom proves about the limit, and whether Airwallex said why.
 *
 * @param declines the latest declines
 * @returns the line, indented under the declines
 */
function verdictLine({ declines }: { declines: LatestDeclines }): string {
  const reasoned = declines.rows.every((row) => row.reason !== null);
  if (declines.limitVerdict.kind === "ruled-out") {
    if (reasoned) {
      return "    so the monthly limit was NOT what declined them; Airwallex's own reason is on each row above";
    }
    return "    so the monthly limit was NOT what declined them; the page gives no reason — balance or issuer, still open";
  }
  const because = declines.limitVerdict.because.join("; ");
  if (reasoned) {
    return `    headroom alone leaves the monthly limit possible, not proven — ${because}; Airwallex's own reason is on each row above`;
  }
  return `    the page gives no decline reason, so the monthly limit is possible, not proven — ${because}`;
}

/**
 * The totals lines for one axis.
 *
 * @param report the card report
 * @param by the axis to total on
 * @returns the lines, indented under the card
 */
function totalLines({ by, report }: { by: SpendAxis; report: CardReport }): readonly string[] {
  const header =
    "charged only; currencies are kept apart — a USD charge counts against the AUD limit at a rate the page does not show";
  if (by === "month") {
    return [
      `  by month (${header}):`,
      ...report.byMonth.map(
        (row) =>
          `    ${row.month}  ${merchantIdentityLabel({ identity: row.identity }).padEnd(9)}  ${totalsText({ totals: row.totals })}`,
      ),
    ];
  }
  return [
    `  by merchant (${header}):`,
    ...report.byMerchant.map(
      (row) =>
        `    ${merchantIdentityLabel({ identity: row.identity }).padEnd(9)}  ${String(row.charges)} charge(s)  ${totalsText({ totals: row.totals })}  — ${row.merchants.join(", ")}`,
    ),
  ];
}

/**
 * Render one card for a terminal.
 *
 * @param report the card report
 * @param by the axis to total on
 * @returns the lines to print, newline-joined
 */
export function renderCardReport({ by, report }: { by: SpendAxis; report: CardReport }): string {
  const { monthly } = report;
  let resetNote = "";
  if (monthly.resetNote !== null) {
    resetNote = ` (${monthly.resetNote})`;
  }
  let allow = "no merchant control on the page";
  let from = "a pasted export";
  if (report.source.kind === "live") {
    allow = "merchant control not named (the live read carries brand ids, not names)";
    from = "read live from their card page";
  }
  if (report.merchantAllow !== null) {
    allow = `merchants allowed: ${report.merchantAllow.join(", ")}`;
  }
  return [
    `${report.provider} card ${report.last4} "${report.nickname}" — ${report.organisation}, as of ${report.asOf} (${from})`,
    `  monthly: ${formatMoney({ money: monthly.used })} of ${formatMoney({ money: monthly.limit })} used — ${formatMoney({ money: monthly.headroom })} left, resets ${monthly.resetsOn}${resetNote}`,
    `  per charge: up to ${formatMoney({ money: report.transactionLimit })} · ${allow}`,
    ...declineLines({ report }),
    ...totalLines({ by, report }),
    `  source: ${report.source.path}, imported ${report.source.importedAt}`,
  ].join("\n");
}
