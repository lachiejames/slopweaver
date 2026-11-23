/**
 * WHICH SIGN-INS THE FLEET CAN CHECK ITSELF — one row per browser platform, each reading its own atlas's sign-in test.
 *
 * A sign-in card that opens straight onto the dashboard wastes the owner's attention, so the fleet checks first; but a
 * platform's UI (Clerk's, say) must not be probed in a way that could lock the fleet out as a bot.
 * So the check is never a new probe of a platform: it is the FIRST navigation that platform's own scheduled walk makes
 * on every run — the bare origin, through the same relay and the owner's recorded work Chrome profile — judged by the same
 * sign-in test that walk applies (`../atlas/<platform>/`). One visit per origin per pass, no click, no screenshot.
 *
 * ## Signed in is a POSITIVE reading, never the absence of a wall
 *
 * A Clerk sign-in card was once posted on a resync that failed with a navigation ETIMEDOUT — no wall at all. A check that
 * read "no sign-in page seen" as signed in would retire a card on exactly that failure. So
 * {@link browserSessionVerdict} answers `signed-in` only for a capture that answered without an HTTP error, settled ON
 * the origin it asked for or one its platform declares a signed-in visit lands on, and is not the platform's sign-in
 * page. A redirect anywhere else — `login.xero.com`, `app.trelica.com`, a `*.accounts.dev` Clerk wall — is signed out;
 * a visit that failed is never a capture at all.
 *
 * ## A signed-in landing is declared, never inferred
 *
 * Signed in under an employee-only role, Xero sends `go.xero.com/` on to its employee portal at `payroll.xero.com` (the
 * reason `../atlas/xero/walkLease.ts` admits it). Before a row could say so, every recheck of a Xero card visited under
 * a lease of the asked origin alone, failed `OFF_LEASE_ORIGIN` on that redirect and read `unread` — on every pass,
 * so the card had to be settled by hand after the owner had signed in. So a row names the origins its
 * visit's lease admits (Xero's is its walk's own lease, sign-in origin included, so a signed-out visit is judged rather
 * than refused) and the ones a signed-in visit lands on. Neither list is a guess at where a redirect might go.
 *
 * A platform with no row here is not checked, and the recheck says so rather than guessing: adding one is a row
 * naming the atlas's own test, nothing else. Pure.
 */
import { CLERK_PAGE_SETTLE_MS } from "../atlas/clerk/browserWalk.js";
import { CLERK_DASHBOARD_ORIGIN, isClerkSignInUrl } from "../atlas/clerk/dashboardAddress.js";
import {
  GOOGLE_ACCOUNTS_ORIGIN,
  GOOGLE_ADMIN_ORIGIN,
  isGoogleAdminSignInUrl,
} from "../atlas/googleAdmin/browserPages.js";
import { HEX_APP_ORIGIN } from "../atlas/hex/browserPages.js";
import { HEX_SIGN_IN_ROUTE } from "../atlas/hex/walk.js";
import { TRELICA_PAGE_SETTLE_MS } from "../atlas/trelica/browserWalk.js";
import { isTrelicaSignInLanding } from "../atlas/trelica/heldAddress.js";
import { isTrelicaTenantHost, TRELICA_LOGIN_ORIGIN } from "../atlas/trelica/tenant.js";
import { isSignInOrigin, XERO_WEB_ORIGIN } from "../atlas/xero/browserPages.js";
import { XERO_PAGE_SETTLE_MS } from "../atlas/xero/browserWalk.js";
import { XERO_PAYROLL_ORIGIN, XERO_WALK_LEASE_ORIGINS } from "../atlas/xero/walkLease.js";

/** One platform whose sign-in the fleet can read for itself. */
interface SessionProbe {
  /** The atlas whose walk makes this navigation — named on the relay lease and in every line the recheck prints. */
  readonly platform: string;
  /**
   * How long the visit watches the page settle, so a client-side redirect to the sign-in page has happened before
   * it is judged — the platform walk's own figure where it exports one. Hex exports none, so it borrows Clerk's: both
   * are client-rendered apps whose wall is a same-origin route.
   */
  readonly settleMs: number;
  /** Whether an origin is this platform's own app — the origin its walk asks for first. */
  readonly owns: (input: { origin: string }) => boolean;
  /** Every origin the visit's relay lease admits, the asked one among them. */
  readonly leaseOrigins: (input: { origin: string }) => readonly string[];
  /** The origins other than the asked one that a SIGNED-IN visit settles on. */
  readonly signedInLandings: readonly string[];
  /** The platform's own test that a settled URL is its sign-in page. */
  readonly signInPage: (input: { finalUrl: string }) => boolean;
}

/** The lease of a platform whose visit may only settle on the origin it asked for. */
function askedOriginOnly({ origin }: { origin: string }): readonly string[] {
  return [origin];
}

/** The URL one string names, or `null` when it names none. */
function parsed({ url }: { url: string }): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

/** Every platform the recheck can read, each by its own atlas's test. */
const SESSION_PROBES: readonly SessionProbe[] = [
  {
    leaseOrigins: askedOriginOnly,
    owns: ({ origin }) => origin === CLERK_DASHBOARD_ORIGIN,
    platform: "clerk",
    settleMs: CLERK_PAGE_SETTLE_MS,
    signedInLandings: [],
    signInPage: ({ finalUrl }) => isClerkSignInUrl({ finalUrl }),
  },
  {
    leaseOrigins: () => XERO_WALK_LEASE_ORIGINS,
    owns: ({ origin }) => origin === XERO_WEB_ORIGIN,
    platform: "xero",
    settleMs: XERO_PAGE_SETTLE_MS,
    signedInLandings: [XERO_PAYROLL_ORIGIN],
    signInPage: ({ finalUrl }) => isSignInOrigin({ finalUrl }),
  },
  {
    leaseOrigins: askedOriginOnly,
    owns: ({ origin }) => origin === HEX_APP_ORIGIN,
    platform: "hex",
    settleMs: CLERK_PAGE_SETTLE_MS,
    signedInLandings: [],
    signInPage: ({ finalUrl }) => {
      const path = parsed({ url: finalUrl })?.pathname;
      return path === HEX_SIGN_IN_ROUTE || path?.startsWith(`${HEX_SIGN_IN_ROUTE}/`) === true;
    },
  },
  {
    // A tenant's own host, e.g. acme.trelica.app. A lost session lands on the tenant's own /Account/Login
    // (measured, `tenant.ts`) or the vendor's shared sign-in origin — the walk's own test reads both,
    // and the lease admits the vendor's origin so a landing there is judged signed out rather than refused unread.
    leaseOrigins: ({ origin }) => [origin, TRELICA_LOGIN_ORIGIN],
    owns: ({ origin }) => {
      const url = parsed({ url: origin });
      return url?.protocol === "https:" && isTrelicaTenantHost({ host: url.hostname });
    },
    platform: "trelica",
    settleMs: TRELICA_PAGE_SETTLE_MS,
    signedInLandings: [],
    signInPage: ({ finalUrl }) => isTrelicaSignInLanding({ finalUrl }),
  },
  {
    // The console signs out after about an hour, so a bot turn reaching for it checks here first (`turn reach`).
    // The lease admits Google's accounts origin so a signed-out visit is judged rather than refused. The settle
    // time is Clerk's borrowed, not a figure measured on the console: both are client-rendered apps.
    leaseOrigins: () => [GOOGLE_ADMIN_ORIGIN, GOOGLE_ACCOUNTS_ORIGIN],
    owns: ({ origin }) => origin === GOOGLE_ADMIN_ORIGIN,
    platform: "google-admin",
    settleMs: CLERK_PAGE_SETTLE_MS,
    signedInLandings: [],
    signInPage: ({ finalUrl }) => isGoogleAdminSignInUrl({ finalUrl }),
  },
];

/**
 * The platform whose own walk opens on an origin, when the recheck can read its sign-in.
 *
 * @param origin a bare `https://host` origin
 * @returns the platform's name, or `undefined` when no row reads that origin
 */
export function sessionProbePlatform({ origin }: { origin: string }): string | undefined {
  return sessionProbeVisit({ origin })?.platform;
}

/**
 * What the one visit of an origin needs: whose walk it is, how long to let the page settle, and where its lease lets
 * it land.
 *
 * @param origin a bare `https://host` origin
 * @returns the platform, settle time and lease origins, or `undefined` when no row reads that origin
 */
export function sessionProbeVisit({
  origin,
}: {
  origin: string;
}): { readonly platform: string; readonly settleMs: number; readonly leaseOrigins: readonly string[] } | undefined {
  const probe = SESSION_PROBES.find((one) => one.owns({ origin }));
  if (probe === undefined) {
    return undefined;
  }
  return { leaseOrigins: probe.leaseOrigins({ origin }), platform: probe.platform, settleMs: probe.settleMs };
}

/** What one visit of a sign-in origin said. */
export type BrowserSessionVerdict =
  | { readonly kind: "signed-in"; readonly observed: string }
  | { readonly kind: "signed-out"; readonly observed: string };

/**
 * Judge one capture of a platform's bare origin: signed in only on positive evidence.
 *
 * @param origin the origin the visit asked for, one {@link sessionProbePlatform} reads
 * @param finalUrl where the browser settled
 * @param statusCode the document's HTTP status, `null` when the transport saw no document response
 * @returns signed in or out, each with what was observed — `signed-out` for an origin no row reads
 */
export function browserSessionVerdict({
  origin,
  finalUrl,
  statusCode,
}: {
  origin: string;
  finalUrl: string;
  statusCode: number | null;
}): BrowserSessionVerdict {
  const probe = SESSION_PROBES.find((one) => one.owns({ origin }));
  if (probe === undefined) {
    return { kind: "signed-out", observed: `no sign-in test is registered for ${origin}` };
  }
  if (statusCode !== null && statusCode >= 400) {
    return { kind: "signed-out", observed: `${origin} answered HTTP ${String(statusCode)}` };
  }
  const settled = parsed({ url: finalUrl });
  if (settled === null || (settled.origin !== origin && !probe.signedInLandings.includes(settled.origin))) {
    return {
      kind: "signed-out",
      observed: `${origin} sent the browser to ${settled === null ? "an unreadable address" : settled.origin}`,
    };
  }
  if (probe.signInPage({ finalUrl })) {
    return { kind: "signed-out", observed: `${origin} settled on its own sign-in page` };
  }
  if (settled.origin !== origin) {
    return {
      kind: "signed-in",
      observed: `${probe.platform} opened ${origin} signed in, landing on ${settled.origin}, no sign-in page`,
    };
  }
  return { kind: "signed-in", observed: `${probe.platform} opened ${origin} signed in, no sign-in page` };
}
