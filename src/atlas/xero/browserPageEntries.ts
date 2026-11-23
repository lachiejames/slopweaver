/**
 * The bookkeeping half of the Xero page list, and the shape every declared page has.
 *
 * `browserPages.ts` joins this half with its settings-and-account half into `XERO_BROWSER_PAGES`, and the four
 * rules in that file's header govern every entry here exactly as they govern its own: above all, no declared
 * route may DO anything, and the organisation's short code is never written down.
 *
 * This module imports nothing. The page type is declared here rather than imported back from `browserPages.ts`,
 * so the two files share no import cycle at all (`import/no-cycle` would not flag a type-only one).
 */

/**
 * Where a declared path hangs off.
 *
 * - `origin` — `go.xero.com/<path>`, the original web client
 * - `app` — `go.xero.com/app/!<short code>/<path>`, learned at run time and never written down
 * - `account` — `my.xero.com/<path>`, the account and organisation hub
 * - `reporting` — `reporting.xero.com/<path>`, where the report client moved
 */
type XeroPageRoot = "origin" | "app" | "account" | "reporting";

/** One page of the Xero web client this atlas walks. */
export interface XeroBrowserPage {
  /** The surface name its coverage cell and its entity are reported under. Unique across this list. */
  readonly surface: string;
  /** Which root {@link path} hangs off. */
  readonly root: XeroPageRoot;
  /** The path beneath that root, with no leading slash. */
  readonly path: string;
  /**
   * Query state that overrides whatever the client last left on this page.
   *
   * A value here must be NON-EMPTY to have any effect: an empty string is not a way to clear a filter, it is
   * a way to believe you cleared one. Where no overriding value is known, leave this empty and let
   * `redirected` record honestly that the client chose the view.
   */
  readonly query: Readonly<Record<string, string>>;
  /**
   * Which SDK-declared family this page shows, as a family key, or `null` when it shows none.
   *
   * This is the join that makes a family row able to say WHERE a human goes to see it — `docs/atlas-intent/05-browser-proof.md`
   * §5's whole point, and the thing that turns "spend per vendor" from an endpoint into an address.
   */
  readonly family: string | null;
  readonly description: string;
}

export const XERO_BOOKKEEPING_PAGES: readonly XeroBrowserPage[] = [
  {
    description: "the organisation dashboard, addressed under the modern app root",
    family: null,
    path: "dashboard",
    query: {},
    root: "app",
    surface: "app-dashboard",
  },
  {
    description: "the dashboard addressed at the original web root, which is the form most links still use",
    family: null,
    path: "Dashboard",
    query: {},
    root: "origin",
    surface: "dashboard",
  },
  {
    description: "the bank accounts overview — every account, its feed state and its reconciliation backlog",
    family: "api.xro/2.0:BankTransactions",
    path: "Bank/BankAccounts.aspx",
    query: {},
    root: "origin",
    surface: "bank-accounts",
  },
  {
    description: "bank accounts addressed under the modern app root",
    family: "api.xro/2.0:BankTransactions",
    path: "bank",
    query: {},
    root: "app",
    surface: "app-bank",
  },
  {
    description: "the chart of accounts — every account these books post to, with its type and code",
    family: "api.xro/2.0:Accounts",
    path: "Setup/Chart.aspx",
    query: {},
    root: "origin",
    surface: "chart-of-accounts",
  },
  {
    description: "the chart of accounts addressed under the modern app root",
    family: "api.xro/2.0:Accounts",
    path: "accounting/chart-of-accounts",
    query: {},
    root: "app",
    surface: "app-chart-of-accounts",
  },
  {
    description: "the contacts list — every customer and supplier, which is the vendor half of spend-per-vendor",
    family: "api.xro/2.0:Contacts",
    path: "Contacts",
    query: {},
    root: "origin",
    surface: "contacts",
  },
  {
    description: "contacts addressed under the modern app root",
    family: "api.xro/2.0:Contacts",
    path: "contacts",
    query: {},
    root: "app",
    surface: "app-contacts",
  },
  {
    description: "supplier contacts specifically, which is the list a spend question starts from",
    family: "api.xro/2.0:Contacts",
    path: "contacts/suppliers",
    query: {},
    root: "app",
    surface: "app-contacts-suppliers",
  },
  {
    description: "bills to pay — purchases, which is the amount half of spend-per-vendor",
    family: "api.xro/2.0:Invoices",
    path: "AccountsPayable/Search.aspx",
    query: {},
    root: "origin",
    surface: "bills",
  },
  {
    description: "purchases addressed under the modern app root",
    family: "api.xro/2.0:Invoices",
    path: "purchases/bills",
    query: {},
    root: "app",
    surface: "app-bills",
  },
  {
    description: "sales invoices raised against customers, at the original web root",
    family: "api.xro/2.0:Invoices",
    path: "AccountsReceivable/Search.aspx",
    query: {},
    root: "origin",
    surface: "invoices",
  },
  {
    description: "invoices addressed under the modern app root",
    family: "api.xro/2.0:Invoices",
    path: "invoicing",
    query: {},
    root: "app",
    surface: "app-invoicing",
  },
  {
    description: "purchase orders raised against suppliers",
    family: "api.xro/2.0:PurchaseOrders",
    path: "PurchaseOrders",
    query: {},
    root: "origin",
    surface: "purchase-orders",
  },
  {
    description: "the quotes list — sales quotes that have not become invoices yet",
    family: "api.xro/2.0:Quotes",
    path: "Quotes",
    query: {},
    root: "origin",
    surface: "quotes",
  },
  {
    description: "credit notes, on both the sales and the purchases side",
    family: "api.xro/2.0:CreditNotes",
    path: "CreditNotes",
    query: {},
    root: "origin",
    surface: "credit-notes",
  },
  {
    description: "manual journals — the postings somebody wrote by hand rather than the ledger emitted",
    family: "api.xro/2.0:ManualJournals",
    path: "GeneralLedger/Journal.aspx",
    query: {},
    root: "origin",
    surface: "manual-journals",
  },
  {
    description: "the reports index at the original web root",
    family: "api.xro/2.0:Reports",
    path: "Reports",
    query: {},
    root: "origin",
    surface: "reports",
  },
  {
    description: "the reports index on the origin the report client moved to",
    family: "api.xro/2.0:Reports",
    path: "reports",
    query: {},
    root: "reporting",
    surface: "reporting-reports",
  },
  {
    description: "the inventory item list",
    family: "api.xro/2.0:Items",
    path: "Inventory",
    query: {},
    root: "origin",
    surface: "inventory",
  },
  {
    description: "the fixed-asset register",
    family: "assets.xro/1.0:Assets",
    path: "FixedAssets",
    query: {},
    root: "origin",
    surface: "fixed-assets",
  },
  {
    description: "expense claims staff have submitted against these books",
    family: "api.xro/2.0:ExpenseClaims",
    path: "Expenses",
    query: {},
    root: "origin",
    surface: "expenses",
  },
  {
    description: "projects and their time entries",
    family: "projects.xro/2.0:Projects",
    path: "Projects",
    query: {},
    root: "origin",
    surface: "projects",
  },
  {
    description: "the payroll overview — pay runs, calendars and what is due",
    family: "payroll.xro/2.0:PayRuns",
    path: "Payroll",
    query: {},
    root: "origin",
    surface: "payroll",
  },
  {
    description: "the payroll employee list",
    family: "payroll.xro/2.0:Employees",
    path: "payroll/employees",
    query: {},
    root: "app",
    surface: "app-payroll-employees",
  },
  {
    description: "the file library, and what each stored file is attached to",
    family: "files.xro/1.0:Files",
    path: "Files",
    query: {},
    root: "origin",
    surface: "files",
  },
];
