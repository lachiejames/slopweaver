/**
 * What a Datadog or GitHub sign-in wall in the owner's Chrome is asking for: a button the fleet presses, or a step only the owner's
 * hands can take.
 *
 * Owner ruling: the fleet may always click the buttons and do the sign-in, for Datadog and GitHub. Other providers stay the owner's hand
 * under least privilege until the pain shows. A seat once carded "sign in to Datadog in the work Chrome"
 * having never opened a browser at all — the console read signed in when looked at — so `browser sign-in` LOOKS
 * first and this module only judges a page the look actually landed on.
 *
 * The press set is CLOSED: Datadog's "Sign in with Google" button, GitHub's organisation single sign-on "Continue",
 * and the row naming the owner's recorded work account on Google's account CHOOSER. None of the three submits a field, so
 * a password box beside one does not stop it — Datadog's login page carries both. Anything else — a password, a
 * passkey, a second factor, a chooser that does not list the owner's work account, a page this has never seen — is the owner's
 * hands, because a click the fleet invents on an identity page is exactly the free-form write the unregistered-host
 * rail exists to refuse (`../admit/browserSurface.ts`).
 *
 * Pure: the landed address, the page's accessibility snapshot and the recorded work email in, a verdict out.
 */

/** The providers the owner's ruling hands to the fleet. Every other sign-in stays the owner's. */
export const SIGN_IN_PROVIDERS = ["datadog", "github"] as const;

/** One provider the fleet signs in to itself. */
export type SignInProvider = (typeof SIGN_IN_PROVIDERS)[number];

/**
 * Whether a typed value names a provider the fleet signs in to.
 *
 * @returns true for `datadog` or `github`
 */
export function isSignInProvider(value: string | undefined): value is SignInProvider {
  return SIGN_IN_PROVIDERS.some((provider) => provider === value);
}

/**
 * What `browser sign-in` prints for a wall the fleet presses: the press, the break-glass a Google account chooser
 * needs first, and the look after it — through the same tab, because a fresh one would show the button just pressed.
 *
 * @param observation the look the press cites, and the address that look landed on
 * @param ref the element to press, as that look's snapshot names it
 * @param sessionId the session whose tab is left open for the press
 * @param why what to press and where, as the look was recorded
 * @returns the lines, in print order
 */
export function wallPressLines({
  observation,
  provider,
  ref,
  sessionId,
  why,
}: {
  observation: { readonly id: string; readonly url: string };
  provider: SignInProvider;
  ref: string;
  sessionId: string;
  why: string;
}): readonly string[] {
  const lines = [`browser sign-in: ${provider} WALL the fleet presses — ${why}. Press it, then look again:`];
  if (new URL(observation.url).hostname === "accounts.google.com") {
    lines.push(
      `  slopweaver browser break-glass --page ${observation.url} --reason ` +
        `"Google chooser on a ${provider} sign-in, the owner's work account (owner ruling)"`,
    );
  }
  lines.push(
    `  slopweaver browser act --session ${sessionId} --do click --target ${ref} --observation ${observation.id}`,
  );
  lines.push(`  slopweaver browser sign-in --provider ${provider} --session ${sessionId}`);
  return lines;
}

/** The wall's verdict: the one element to press, or why the next step is the owner's. */
export type WallVerdict =
  | {
      readonly kind: "pressable";
      /** The element's ref in the snapshot, exactly as `browser act --target` takes it. */
      readonly ref: string;
      /** The element's accessible name, so a reader sees what will be pressed. */
      readonly label: string;
    }
  | { readonly kind: "owner-hands"; readonly why: string };

/** One clickable element the snapshot names, by role, accessible name and ref. */
interface SnapshotControl {
  readonly role: string;
  readonly name: string;
  readonly ref: string;
}

/** A `- button "Continue" [ref=f1e18]` line, as the relay's snapshot prints a clickable control. */
const CONTROL_LINE = /^\s*-\s+(button|link)\s+"([^"]*)"[^\n]*?\[ref=([a-z0-9]+)\]/gim;

/** A field asking for a secret or a second factor: what no session ever fills on the owner's behalf. */
const SECRET_FIELD =
  /^\s*-\s+textbox\s+"[^"]*(?:password|passkey|code|verification|2-step|two-factor|authenticator)[^"]*"/im;

/** Datadog's own sign-in button on its login page. */
const DATADOG_GOOGLE_BUTTON = /\b(?:sign|log)\s*in\s+with\s+google\b/i;

/**
 * Google's account-chooser paths. A challenge page (password, passkey, a prompt on the owner's phone) names their account too,
 * on the chip that switches it, so the email alone never makes a row pressable — the page has to BE the chooser.
 */
const GOOGLE_CHOOSER_PATH = /accountchooser|chooseaccount|selectaccount/i;

/** Every Datadog console host family, as `../admit/browserSurface.ts` registers them. */
const DATADOG_HOSTS: readonly string[] = ["datadoghq.com", "datadoghq.eu", "ddog-gov.com"];

/**
 * Every clickable control the snapshot names, in page order.
 *
 * @param elements the page's accessibility snapshot, as `browser read` writes it
 * @returns each button or link with its accessible name and ref
 */
export function snapshotControls({ elements }: { elements: string }): readonly SnapshotControl[] {
  return [...elements.matchAll(CONTROL_LINE)].map((match) => ({
    name: match[2]!,
    ref: match[3]!,
    role: match[1]!.toLowerCase(),
  }));
}

/**
 * Whether a host is a Datadog console or one of its subdomains.
 *
 * @returns true for a host under one of Datadog's registered console families
 */
function isDatadogHost({ host }: { host: string }): boolean {
  return DATADOG_HOSTS.some((family) => host === family || host.endsWith(`.${family}`));
}

/**
 * The provider whose sign-in a host's wall is, when it is one the fleet signs in to itself.
 *
 * @param host a page's host, as `URL.host` gives it
 * @returns `datadog` for a Datadog console host, `github` for github.com, else `undefined`
 */
export function signInProviderOfHost({ host }: { host: string }): SignInProvider | undefined {
  const bare = host.toLowerCase().replace(/:\d+$/, "");
  if (isDatadogHost({ host: bare })) {
    return "datadog";
  }
  if (bare === "github.com") {
    return "github";
  }
  return undefined;
}

/** One press the closed set allows on this page, or why there is none. */
type PressFound = { readonly control: SnapshotControl } | { readonly missing: string };

/**
 * The chooser row naming the owner's work account, on Google's account chooser only.
 *
 * @returns the row, or why there is none to press
 */
function googlePress({
  url,
  controls,
  workEmail,
}: {
  url: URL;
  controls: readonly SnapshotControl[];
  workEmail: string | undefined;
}): PressFound {
  if (!GOOGLE_CHOOSER_PATH.test(url.pathname)) {
    return { missing: `Google wants the owner's own step at ${url.pathname}` };
  }
  if (workEmail === undefined) {
    return {
      missing:
        "Google asks which account to use, and no work account is recorded for the owner's Chrome profile (`browser profile`)",
    };
  }
  const wanted = workEmail.toLowerCase();
  const row = controls.find((control) => control.name.toLowerCase().includes(wanted));
  if (row === undefined) {
    return { missing: `Google's chooser does not list the owner's work account ${workEmail}` };
  }
  return { control: row };
}

/**
 * The one press the closed set allows on the landed page, or why there is none.
 *
 * @returns the control to press, or why the page offers none
 */
function pressOn({
  url,
  controls,
  workEmail,
}: {
  url: URL;
  controls: readonly SnapshotControl[];
  workEmail: string | undefined;
}): PressFound {
  const host = url.hostname.toLowerCase();
  if (host === "accounts.google.com") {
    return googlePress({ controls, url, workEmail });
  }
  if (host === "github.com" && /^\/orgs\/[^/]+\/sso\b/.test(url.pathname)) {
    const proceed = controls.find((control) => control.role === "button" && control.name.trim() === "Continue");
    if (proceed === undefined) {
      return { missing: "GitHub's single sign-on page shows no Continue button" };
    }
    return { control: proceed };
  }
  if (host === "github.com") {
    return { missing: `GitHub wants the owner's own sign-in at ${url.pathname}` };
  }
  if (isDatadogHost({ host })) {
    const google = controls.find((control) => DATADOG_GOOGLE_BUTTON.test(control.name));
    if (google === undefined) {
      return { missing: `Datadog's sign-in page at ${url.pathname} offers no Google button` };
    }
    return { control: google };
  }
  return { missing: `the sign-in moved on to ${host}, a page the fleet never presses` };
}

/**
 * Whether a session's tab was taken on the provider's own sign-in, so a re-look through it judges that provider.
 *
 * `browser sign-in --session` re-looks the tab a press left open, because a fresh tab on the wall's address shows
 * the same button again — measured, five `pressable` GitHub rows in eleven minutes on
 * `/orgs/acme/sso` while the pressed tab sat on the organisation's Cloudflare Access login. Without this
 * check, any session's page could stand behind a sign-in card it has nothing to do with.
 *
 * @param origins the origins the session was opened on, as its record carries them
 * @returns true when one of them is a host the provider signs in on
 */
export function sessionOpenedOnProvider({
  origins,
  provider,
}: {
  origins: readonly string[];
  provider: SignInProvider;
}): boolean {
  return origins.some((origin) => {
    try {
      return signInProviderOfHost({ host: new URL(origin).host }) === provider;
    } catch {
      return false;
    }
  });
}

/**
 * Judge the page a sign-in look landed on.
 *
 * Called only on a page already read as walled — signed-in is decided by the measured detectors
 * (`../datadog/shot/proof.ts`'s `isDatadogSignInWall`, `../outbound/github/orgSso.ts`'s `orgGrantVerdict`), never
 * here, so this cannot mistake a console for a wall.
 *
 * @param landedUrl the address the browser settled on
 * @param elements the page's accessibility snapshot
 * @param workEmail the account the owner's recorded work Chrome profile is signed in as, when Chrome names one
 * @returns the one element to press, or why the next step is the owner's
 */
export function classifyWall({
  landedUrl,
  elements,
  workEmail,
}: {
  landedUrl: string;
  elements: string;
  workEmail: string | undefined;
}): WallVerdict {
  let url: URL;
  try {
    url = new URL(landedUrl);
  } catch {
    return { kind: "owner-hands", why: `the wall's address does not parse: ${landedUrl}` };
  }
  // The Google press already ran and Datadog refused the account it got back, so pressing again repeats the same
  // bounce, and this reason is more exact than the password box the same page carries. MEASURED:
  // the press landed on `/account/login?google_invalid_email=t` under "We don't have a Datadog account associated
  // with the Google user", and the re-look printed the same press again.
  if (isDatadogHost({ host: url.hostname.toLowerCase() }) && url.searchParams.has("google_invalid_email")) {
    return {
      kind: "owner-hands",
      why: `Datadog on ${url.host} has no account for the Google user Chrome signed in as, so the Google press bounced`,
    };
  }
  const found = pressOn({ controls: snapshotControls({ elements }), url, workEmail });
  if ("control" in found) {
    return { kind: "pressable", label: found.control.name, ref: found.control.ref };
  }
  if (SECRET_FIELD.test(elements)) {
    return { kind: "owner-hands", why: `${url.host} asks for a password, passkey or second factor` };
  }
  return { kind: "owner-hands", why: found.missing };
}
