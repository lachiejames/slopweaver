/**
 * Xero's business-object families, and the one bound the owner put on "everything reachable".
 *
 * ## What this file is FOR
 *
 * `docs/atlas-intent/06-holdings.md`: an atlas holding everything reachable holds it *"with the only exception really
 * being stuff that is like highly voluminous such as audit logs"*, and such a surface is **enumerated and
 * declared rather than stored whole**. This file is that enumeration. A family row says the surface exists,
 * which operations reach it, what shape its records are, and — where this atlas will never hold its rows —
 * that it will never hold them and why. An atlas that simply omitted its voluminous families would answer
 * "Xero has no general ledger", which is false; the disposition is the difference between a surface nobody
 * looked at and one that was looked at and deliberately not stored whole.
 *
 * ## The enumeration is DERIVED and the judgement is DECLARED
 *
 * The family list is computed from the installed SDK's own operations — one family per (product root, first
 * path segment) — so a Xero SDK bump adds families rather than silently leaving them out of a hand list. The
 * DISPOSITION cannot be computed, because the criterion is about what a record IS rather than what its path
 * looks like, so it is declared in {@link XERO_FAMILY_JUDGEMENTS} with a reason per entry.
 *
 * The two halves meet at a gate rather than at a convention: `families.test.ts` reads the installed SDK and
 * fails when it declares a family the table does not judge. So the table is exhaustive by CI rather than by
 * anyone remembering, and `unjudged` — which cannot occur on a green build — is what an install whose SDK
 * ran ahead of the table reports instead of quietly claiming the safer half.
 *
 * ## The criterion cuts THROUGH a family, so one rule is per-operation
 *
 * Every `/History` sub-resource returns Xero's own history-and-notes trail for one document: entries the
 * platform emits as a consequence of activity, identified by an instant, growing with the clock, and never
 * exhaustively listable. MEASURED against `xero-node` 19.1.0 — 32 such operations across 16 families, so a
 * family-level disposition alone would have to be wrong about one side of sixteen families. This is why
 * `mixed` exists.
 */
import type { XeroFamilyDisposition } from "./model.js";
import type { XeroSdkOperation } from "./sdkEndpoints.js";

/** The path suffix whose operations return the platform's own audit trail, whatever family they hang off. */
export const XERO_HISTORY_SUFFIX = "/History";

/**
 * Why every `/History` operation is observation-shaped, wherever it appears.
 *
 * @internal
 */
export const XERO_HISTORY_REASON =
  "the history-and-notes trail Xero emits as a consequence of activity on one document — entries nobody " +
  "authors, identified by an instant, growing with the clock and never exhaustively listable";

/** One family's declared judgement: its disposition and the reason, in the criterion's own terms. */
interface XeroFamilyJudgement {
  readonly disposition: Extract<XeroFamilyDisposition, "configuration" | "voluminous">;
  readonly reason: string;
}

/** The shorthand every configuration entry carries, so the table reads as judgements rather than as prose. */
const AUTHORED =
  "records a person or a connected system CREATED in this organisation, and a set that can be listed " +
  "exhaustively — configuration by the criterion, however many rows it currently holds";

/**
 * Every family the installed SDK declares, judged.
 *
 * Keyed `<product root>:<first path segment>` — the product root is the path beneath `api.xero.com`, so
 * three payroll clients sharing `payroll.xro/2.0` contribute to one set of families, which is correct: they
 * are the same paths on the same root.
 *
 * MEASURED against `xero-node` 19.1.0: 72 families across 9 product roots. Reproduce the list with
 * `slopweaver atlas xero families`.
 */
export const XERO_FAMILY_JUDGEMENTS: Readonly<Record<string, XeroFamilyJudgement>> = {
  "api.xro/2.0:Accounts": { disposition: "configuration", reason: `the chart of accounts — ${AUTHORED}` },
  "api.xro/2.0:BankTransactions": {
    disposition: "voluminous",
    reason:
      "spend- and receive-money lines originating in the BANK FEED — pushed by the bank rather than " +
      "authored here, unbounded, growing with the clock and identified by the instant they cleared",
  },
  "api.xro/2.0:BankTransfers": { disposition: "configuration", reason: `transfers between accounts — ${AUTHORED}` },
  "api.xro/2.0:BatchPayments": { disposition: "configuration", reason: `payment batches — ${AUTHORED}` },
  "api.xro/2.0:BrandingThemes": { disposition: "configuration", reason: `invoice branding — ${AUTHORED}` },
  "api.xro/2.0:Budgets": { disposition: "configuration", reason: `budgets — ${AUTHORED}` },
  "api.xro/2.0:ContactGroups": { disposition: "configuration", reason: `contact groups — ${AUTHORED}` },
  "api.xro/2.0:Contacts": {
    disposition: "configuration",
    reason: `customers and suppliers, the vendor half of "what did we spend with whom" — ${AUTHORED}`,
  },
  "api.xro/2.0:CreditNotes": { disposition: "configuration", reason: `credit notes — ${AUTHORED}` },
  "api.xro/2.0:Currencies": { disposition: "configuration", reason: `enabled currencies — ${AUTHORED}` },
  "api.xro/2.0:ExpenseClaims": { disposition: "configuration", reason: `expense claims — ${AUTHORED}` },
  "api.xro/2.0:InvoiceReminders": { disposition: "configuration", reason: `reminder settings — ${AUTHORED}` },
  "api.xro/2.0:Invoices": {
    disposition: "configuration",
    reason: `sales invoices and purchase bills, the amount half of "what did we spend with whom" — ${AUTHORED}`,
  },
  "api.xro/2.0:Items": { disposition: "configuration", reason: `the inventory item list — ${AUTHORED}` },
  "api.xro/2.0:Journals": {
    disposition: "voluminous",
    reason:
      "the GENERAL LEDGER — double-entry postings Xero emits as a consequence of every transaction rather " +
      "than anything a person writes, paged by an ever-increasing journal number rather than by any name, " +
      "and unbounded by construction. The ledger half of the owner's own highly-voluminous class",
  },
  "api.xro/2.0:LinkedTransactions": { disposition: "configuration", reason: `billable-expense links — ${AUTHORED}` },
  "api.xro/2.0:ManualJournals": { disposition: "configuration", reason: `hand-posted journals — ${AUTHORED}` },
  "api.xro/2.0:Organisation": { disposition: "configuration", reason: `the organisation's own settings — ${AUTHORED}` },
  "api.xro/2.0:Overpayments": { disposition: "configuration", reason: `overpayments — ${AUTHORED}` },
  "api.xro/2.0:PaymentServices": { disposition: "configuration", reason: `payment services — ${AUTHORED}` },
  "api.xro/2.0:Payments": { disposition: "configuration", reason: `payments against documents — ${AUTHORED}` },
  "api.xro/2.0:Prepayments": { disposition: "configuration", reason: `prepayments — ${AUTHORED}` },
  "api.xro/2.0:PurchaseOrders": { disposition: "configuration", reason: `purchase orders — ${AUTHORED}` },
  "api.xro/2.0:Quotes": { disposition: "configuration", reason: `quotes — ${AUTHORED}` },
  "api.xro/2.0:Receipts": { disposition: "configuration", reason: `receipts — ${AUTHORED}` },
  "api.xro/2.0:RepeatingInvoices": {
    disposition: "configuration",
    reason: `repeating invoice templates — ${AUTHORED}`,
  },
  "api.xro/2.0:Reports": {
    disposition: "voluminous",
    reason:
      "computed VIEWS over a window rather than stored records — a report is parameterised by dates and " +
      "options, so there is no exhaustive set of rows to hold at all. Its existence, its parameters and " +
      "its response shape are atlas content; the numbers it returns for one window are not",
  },
  "api.xro/2.0:Setup": { disposition: "configuration", reason: `conversion-balance setup — ${AUTHORED}` },
  "api.xro/2.0:TaxRates": { disposition: "configuration", reason: `tax rates — ${AUTHORED}` },
  "api.xro/2.0:TrackingCategories": { disposition: "configuration", reason: `tracking categories — ${AUTHORED}` },
  "api.xro/2.0:Users": { disposition: "configuration", reason: `the organisation's own user list — ${AUTHORED}` },
  "appstore/2.0:subscriptions": { disposition: "configuration", reason: `app-store subscriptions — ${AUTHORED}` },
  "assets.xro/1.0:AssetTypes": { disposition: "configuration", reason: `fixed-asset types — ${AUTHORED}` },
  "assets.xro/1.0:Assets": { disposition: "configuration", reason: `the fixed-asset register — ${AUTHORED}` },
  "assets.xro/1.0:Settings": { disposition: "configuration", reason: `fixed-asset settings — ${AUTHORED}` },
  "bankfeeds.xro/1.0:FeedConnections": {
    disposition: "configuration",
    reason: `the bank-feed connections themselves — ${AUTHORED}`,
  },
  "bankfeeds.xro/1.0:Statements": {
    disposition: "voluminous",
    reason:
      "BANK-FEED statement lines, pushed by the feed provider rather than authored here, identified by the " +
      "date they posted and unbounded by construction. The bank-feed half of the owner's own " +
      "highly-voluminous class",
  },
  "files.xro/1.0:Associations": { disposition: "configuration", reason: `file-to-document links — ${AUTHORED}` },
  "files.xro/1.0:Files": { disposition: "configuration", reason: `uploaded files — ${AUTHORED}` },
  "files.xro/1.0:Folders": { disposition: "configuration", reason: `file folders — ${AUTHORED}` },
  "files.xro/1.0:Inbox": { disposition: "configuration", reason: `the files inbox — ${AUTHORED}` },
  "finance.xro/1.0:BankStatementsPlus": {
    disposition: "voluminous",
    reason:
      "the same bank-feed statement lines read back with their accounting context, over a date window — " +
      "feed-pushed, instant-identified and unbounded, exactly as the bankfeeds surface is",
  },
  "finance.xro/1.0:CashValidation": {
    disposition: "voluminous",
    reason: "a computed view comparing feed and ledger over a window; there is no exhaustive set of rows to hold",
  },
  "finance.xro/1.0:FinancialStatements": {
    disposition: "voluminous",
    reason: "computed statements over a window, parameterised by dates rather than stored as rows",
  },
  "payroll.xro/1.0:Employees": { disposition: "configuration", reason: `the AU payroll employee list — ${AUTHORED}` },
  "payroll.xro/1.0:LeaveApplications": { disposition: "configuration", reason: `AU leave applications — ${AUTHORED}` },
  "payroll.xro/1.0:PayItems": { disposition: "configuration", reason: `AU pay items — ${AUTHORED}` },
  "payroll.xro/1.0:PayRuns": { disposition: "configuration", reason: `AU pay runs — ${AUTHORED}` },
  "payroll.xro/1.0:PayrollCalendars": { disposition: "configuration", reason: `AU payroll calendars — ${AUTHORED}` },
  "payroll.xro/1.0:Payslip": {
    disposition: "voluminous",
    reason:
      "one payslip per employee per pay run, emitted BY the pay run rather than authored, identified by the " +
      "period it covers and growing with the clock for as long as the organisation runs payroll",
  },
  "payroll.xro/1.0:Settings": { disposition: "configuration", reason: `AU payroll settings — ${AUTHORED}` },
  "payroll.xro/1.0:SuperfundProducts": { disposition: "configuration", reason: `AU superfund products — ${AUTHORED}` },
  "payroll.xro/1.0:Superfunds": { disposition: "configuration", reason: `AU superfunds — ${AUTHORED}` },
  "payroll.xro/1.0:Timesheets": { disposition: "configuration", reason: `AU timesheets — ${AUTHORED}` },
  "payroll.xro/2.0:Benefits": { disposition: "configuration", reason: `payroll benefits — ${AUTHORED}` },
  "payroll.xro/2.0:Deductions": { disposition: "configuration", reason: `payroll deductions — ${AUTHORED}` },
  "payroll.xro/2.0:EarningsOrders": { disposition: "configuration", reason: `earnings orders — ${AUTHORED}` },
  "payroll.xro/2.0:EarningsRates": { disposition: "configuration", reason: `earnings rates — ${AUTHORED}` },
  "payroll.xro/2.0:Employees": { disposition: "configuration", reason: `the payroll employee list — ${AUTHORED}` },
  "payroll.xro/2.0:LeaveTypes": { disposition: "configuration", reason: `leave types — ${AUTHORED}` },
  "payroll.xro/2.0:PayRunCalendars": { disposition: "configuration", reason: `pay-run calendars — ${AUTHORED}` },
  "payroll.xro/2.0:PayRuns": { disposition: "configuration", reason: `pay runs — ${AUTHORED}` },
  "payroll.xro/2.0:PaySlips": {
    disposition: "voluminous",
    reason: "one payslip per employee per pay run, emitted BY the pay run and growing with the clock",
  },
  "payroll.xro/2.0:Payslips": {
    disposition: "voluminous",
    reason:
      "the same payslips under Xero's other spelling of the same segment — kept apart rather than merged, " +
      "because the paths differ byte-exactly and merging them would invent a route neither client sends",
  },
  "payroll.xro/2.0:Reimbursements": { disposition: "configuration", reason: `reimbursement types — ${AUTHORED}` },
  "payroll.xro/2.0:Settings": { disposition: "configuration", reason: `payroll settings — ${AUTHORED}` },
  "payroll.xro/2.0:StatutoryDeductions": { disposition: "configuration", reason: `statutory deductions — ${AUTHORED}` },
  "payroll.xro/2.0:StatutoryLeaves": { disposition: "configuration", reason: `statutory leave — ${AUTHORED}` },
  "payroll.xro/2.0:Superannuations": { disposition: "configuration", reason: `superannuation setup — ${AUTHORED}` },
  "payroll.xro/2.0:Timesheets": { disposition: "configuration", reason: `timesheets — ${AUTHORED}` },
  "projects.xro/2.0:Projects": {
    disposition: "configuration",
    reason: `projects, tasks and time entries — ${AUTHORED}`,
  },
  "projects.xro/2.0:ProjectsUsers": { disposition: "configuration", reason: `project users — ${AUTHORED}` },
};

/**
 * The product root one operation's base path names — the path beneath `api.xero.com`.
 *
 * @param basePath the operation's own declared base path
 * @returns the root, e.g. `api.xro/2.0`, or the whole base path when it cannot be parsed as a URL
 */
export function xeroProductRoot({ basePath }: { basePath: string }): string {
  try {
    return new URL(basePath).pathname.replace(/^\/+/, "").replace(/\/+$/, "");
  } catch {
    return basePath;
  }
}

/**
 * The family one operation belongs to: its product root and its first path segment.
 *
 * @param operation the SDK-declared operation
 * @returns the family key, e.g. `api.xro/2.0:Invoices`
 */
export function xeroFamilyKey({ operation }: { operation: XeroSdkOperation }): string {
  return `${xeroProductRoot({ basePath: operation.basePath })}:${firstPathSegment({ path: operation.path })}`;
}

/** The first non-empty segment of an operation's path; an operation addressing the product root itself has none. */
function firstPathSegment({ path }: { path: string }): string {
  const segment = path.split("/").find((part) => part.length > 0);
  if (segment === undefined) {
    return "(root)";
  }
  return segment;
}

/** One family, as derived from the SDK and judged by the table. */
export interface XeroFamily {
  /** `<product root>:<first path segment>`, which is also the entity's `providerId`. */
  readonly key: string;
  readonly product: string;
  readonly segment: string;
  readonly disposition: XeroFamilyDisposition;
  readonly reason: string;
  /** Every operation reaching this family, as `<METHOD> <path>`, sorted. */
  readonly operations: readonly string[];
  /** The observation-shaped subset of {@link operations}, sorted. */
  readonly voluminousOperations: readonly string[];
}

/** Whether one operation is observation-shaped whatever its family's own disposition is. */
function isHistoryOperation({ operation }: { operation: XeroSdkOperation }): boolean {
  return operation.path.endsWith(XERO_HISTORY_SUFFIX);
}

/** The disposition and reason a family carries, given its judgement and whether any operation cuts across it. */
function resolveDisposition({
  judgement,
  hasHistory,
}: {
  judgement: XeroFamilyJudgement | undefined;
  hasHistory: boolean;
}): { disposition: XeroFamilyDisposition; reason: string } {
  if (judgement === undefined) {
    return {
      disposition: "unjudged",
      reason:
        "the installed SDK declares this family and XERO_FAMILY_JUDGEMENTS does not judge it, so this atlas " +
        "does not know whether its records are configuration or observations — add an entry with a reason",
    };
  }
  if (judgement.disposition === "voluminous") {
    return { disposition: "voluminous", reason: judgement.reason };
  }
  if (!hasHistory) {
    return { disposition: "configuration", reason: judgement.reason };
  }
  return {
    disposition: "mixed",
    reason: `${judgement.reason}. Its history sub-resource is not: ${XERO_HISTORY_REASON}`,
  };
}

/**
 * Derive every family the installed SDK declares, and judge each.
 *
 * @param operations every operation the SDK declares
 * @returns one row per family, sorted by key so a published file is stable
 */
export function xeroFamilies({ operations }: { operations: readonly XeroSdkOperation[] }): readonly XeroFamily[] {
  const grouped = Map.groupBy(operations, (operation) => xeroFamilyKey({ operation }));
  return [...grouped.entries()]
    .map(([key, members]): XeroFamily => {
      const hasHistory = members.some((operation) => isHistoryOperation({ operation }));
      const resolved = resolveDisposition({ hasHistory, judgement: XERO_FAMILY_JUDGEMENTS[key] });
      const spell = ({ operation }: { operation: XeroSdkOperation }): string =>
        `${operation.httpMethod} ${operation.path}`;
      const everything = [...new Set(members.map((operation) => spell({ operation })))].toSorted();
      const observations =
        resolved.disposition === "voluminous"
          ? everything
          : [
              ...new Set(
                members
                  .filter((operation) => isHistoryOperation({ operation }))
                  .map((operation) => spell({ operation })),
              ),
            ].toSorted();
      return {
        disposition: resolved.disposition,
        key,
        operations: everything,
        product: key.slice(0, key.lastIndexOf(":")),
        reason: resolved.reason,
        segment: key.slice(key.lastIndexOf(":") + 1),
        voluminousOperations: observations,
      };
    })
    .toSorted((left, right) => left.key.localeCompare(right.key));
}
