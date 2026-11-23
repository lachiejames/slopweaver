/**
 * `spend tasks` as text: one line per card expense, each the act the owner takes — upload this invoice into Airwallex now
 * — with the pulled file beside it, or the reason there is none. Pure.
 *
 * A line never quotes a receipt's body: a subject is sender text and is not printed either, only the mail's own
 * address, which the console draws as a Gmail citation chip.
 */
import { formatMoney } from "../money.js";
import type { TaskAct, TaskReading } from "./read.js";

/**
 * What stands beside one act: the file, or why there is none.
 *
 * @param account the mailbox searched, named when nothing was found in it
 * @returns the clause after the dash
 */
export function invoiceClause({ act, account }: { act: TaskAct; account: string }): string {
  const { invoice } = act;
  if (invoice.kind === "matched") {
    const paths = invoice.files.map((file) => file.localPath).join(", ");
    return `invoice ${paths} (receipt ${invoice.permalink})`;
  }
  if (invoice.kind === "unconfirmed") {
    return (
      `${String(invoice.candidateIds.length)} receipt mail(s) in the window, none naming ` +
      `${formatMoney({ money: act.expense.amount })}: ${invoice.candidateIds.join(", ")} — nothing pulled`
    );
  }
  if (invoice.kind === "none") {
    return `no matching invoice mail in ${account} (searched: ${String(act.query)})`;
  }
  return (
    `${act.expense.merchant} is not a registered merchant with a receipt domain, so no invoice was searched for ` +
    "(`slopweaver spend merchants set` registers one)"
  );
}

/**
 * Render a reading.
 *
 * @param reading what `readTasks` answered
 * @returns the lines, joined
 */
export function renderTaskReading({ reading }: { reading: TaskReading }): string {
  if (reading.kind === "no-reminder") {
    return `spend tasks: no Airwallex task reminder in the inbox of ${reading.account} (searched: ${reading.query})`;
  }
  const { account, acts, open, reminder, superseded } = reading;
  const lines = [
    `spend tasks: ${account}`,
    `reminder ${reminder.sentAtIso.slice(0, 10)}: ${String(open.openTasks)} task(s), ` +
      `${String(open.cardExpenses)} card expense(s) — ${reminder.permalink}`,
  ];
  if (superseded.length > 0) {
    lines.push(
      `  superseded by it: ${String(superseded.length)} older reminder(s) still in the inbox — ` +
        superseded.map((mail) => mail.permalink).join(" "),
    );
  }
  for (const act of acts) {
    const { amount, day, merchant } = act.expense;
    lines.push(
      `- upload ${merchant} ${formatMoney({ money: amount })} (${day}) into Airwallex now — ` +
        invoiceClause({ account, act }),
    );
  }
  if (open.more > 0) {
    lines.push(`  + ${String(open.more)} more card expense(s) the reminder did not list — open Airwallex for them`);
  }
  return lines.join("\n");
}
