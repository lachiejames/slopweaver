/**
 * Which Microsoft Graph delegated permission each Outlook verb needs, and the three grants `outlook connect`
 * offers. Data, as the Gmail door's table is, so a verb names a capability and the capability names a scope.
 *
 * Microsoft's rules, not this repository's:
 *
 * - **`Mail.ReadWrite` subsumes `Mail.Read`**, so a manage grant satisfies every read verb.
 * - **`Mail.Send` is separate from `Mail.ReadWrite`.** Writing a draft and sending mail are different grants,
 *   so "drafts are the default, send is a deliberate verb" is a credential property here too.
 * - **`MailboxSettings.Read` is what `/me/outlook/masterCategories` needs**, personal accounts included;
 *   `Mail.ReadWrite` does not reach it. Tagging a message with a category is `Mail.ReadWrite`.
 * - **`offline_access` is requested and never checked.** It asks for a refresh token and reaches no data, and
 *   Microsoft routinely leaves it out of the scopes a token reports, so a check against it would refuse a grant
 *   that refreshes perfectly. Whether a grant refreshes is proved by refreshing it, in `client.ts`.
 *
 * Pure: no I/O, no clock.
 */

/**
 * The Outlook capability a verb needs. One capability maps to one Graph permission. `read`, `modify` and `send`
 * are the MAIL capabilities; `calendar` is the calendar's read, which the `outlook-calendar` noun needs and no
 * mail verb does.
 */
export type OutlookCapability = "identity" | "read" | "modify" | "send" | "settings" | "calendar";

/**
 * The Microsoft product a grant belongs to. Each is its own integration with its own consent and its own stored
 * grant: someone may connect their calendar and not their mail, or the reverse.
 */
export type OutlookProduct = "mail" | "calendar";

/** The verb that establishes each product's grant — the one each refusal for that product names. */
const CONNECT_VERB_BY_PRODUCT: Readonly<Record<OutlookProduct, string>> = {
  calendar: "slopweaver outlook-calendar connect",
  mail: "slopweaver outlook connect",
};

/** How each product names itself to the owner. */
const PRODUCT_NAME: Readonly<Record<OutlookProduct, string>> = {
  calendar: "Outlook Calendar",
  mail: "Outlook",
};

/**
 * The command that establishes a product's grant.
 *
 * @returns the connect command line, without flags
 */
export function outlookConnectVerb({ product }: { product: OutlookProduct }): string {
  return CONNECT_VERB_BY_PRODUCT[product];
}

/**
 * How a product names itself in a refusal.
 *
 * @returns the product's display name
 */
export function outlookProductName({ product }: { product: OutlookProduct }): string {
  return PRODUCT_NAME[product];
}

/** The Graph permission granted for each capability, as Microsoft spells it. */
const OUTLOOK_SCOPES: Readonly<Record<OutlookCapability, string>> = {
  calendar: "Calendars.Read",
  identity: "User.Read",
  modify: "Mail.ReadWrite",
  read: "Mail.Read",
  send: "Mail.Send",
  settings: "MailboxSettings.Read",
};

/** The permissions that ALSO satisfy a capability. */
const IMPLIED_BY: Readonly<Record<OutlookCapability, readonly string[]>> = {
  calendar: ["Calendars.ReadWrite"],
  identity: [],
  modify: [],
  read: ["Mail.ReadWrite"],
  send: [],
  settings: ["MailboxSettings.ReadWrite"],
};

/** The refresh-token request, sent with every grant and never part of a capability check. */
const OFFLINE_ACCESS = "offline_access";

/**
 * The MAIL grants `outlook connect --grant` offers, narrowest first. None carries `calendar`: the calendar is its
 * own integration, consented by `outlook-calendar connect` ({@link OUTLOOK_CALENDAR_GRANT}) into its own grant.
 */
export const OUTLOOK_GRANTS: Readonly<Record<string, readonly OutlookCapability[]>> = {
  full: ["identity", "read", "settings", "modify", "send"],
  // The default, and deliberately not `read`: categorising, read-state and archiving are what the owner reaches
  // for straight after reading, and widening a grant later costs a browser round trip. `send` stays behind an
  // explicit `--grant full`, because it is the one permission that puts mail in front of another person.
  manage: ["identity", "read", "settings", "modify"],
  read: ["identity", "read", "settings"],
};

/**
 * What `outlook-calendar connect` asks for: who the account is, and the calendar's read. Nothing of the mail.
 * Exactly `User.Read Calendars.Read offline_access` once {@link outlookRequestScopes} adds the refresh request.
 */
export const OUTLOOK_CALENDAR_GRANT: readonly OutlookCapability[] = ["identity", "calendar"];

/**
 * The ONE command that re-grants what a verb found missing without narrowing what the stored grant already
 * holds. A calendar grant is one fixed consent, so its remedy is always `outlook-calendar connect`. A mail
 * remedy is `outlook connect`, with `--grant full` when `Mail.Send` is missing or already held: re-running
 * `connect` REPLACES the grant, so leaving the flag off would trade one missing permission for another.
 *
 * @param missing the permissions the verb found absent, as {@link missingOutlookScopes} names them
 * @param granted the scopes the stored grant carries, in any spelling
 * @param product which product's grant fell short
 * @returns the command line to run, flags included
 */
export function outlookReconnectCommand({
  missing,
  granted,
  product,
}: {
  missing: readonly string[];
  granted: readonly string[];
  product: OutlookProduct;
}): string {
  if (product === "calendar") {
    return outlookConnectVerb({ product });
  }
  const holdsSend = missingOutlookScopes({ capabilities: ["send"], granted }).length === 0;
  if (missing.length > 0 || holdsSend) {
    return `${outlookConnectVerb({ product })} --grant full`;
  }
  return outlookConnectVerb({ product });
}

/**
 * Whether a mail grant carries the calendar's read — the one fact that lets a calendar verb read over a mail
 * grant that was consented before the calendar had a consent of its own.
 *
 * @param granted the scopes the mail grant carries, in any spelling
 * @returns true when `Calendars.Read`, or a permission implying it, is among them
 */
export function mailGrantCoversCalendar({ granted }: { granted: readonly string[] }): boolean {
  return missingOutlookScopes({ capabilities: ["calendar"], granted }).length === 0;
}

/**
 * The warning a mail re-consent owes when it just cut off a calendar that was reading over the replaced grant:
 * the old mail grant covered the calendar, the new one does not, and no calendar grant of its own is stored.
 *
 * @param previousScopes the scopes of the mail grant the consent replaced, or `undefined` when there was none
 * @param replacementScopes the scopes Microsoft reported on the new mail grant
 * @param calendarGrantStored whether the calendar's own grant file exists
 * @returns the warning line, or `undefined` when nothing the calendar relied on was lost
 */
export function mailReconnectCalendarWarning({
  previousScopes,
  replacementScopes,
  calendarGrantStored,
}: {
  previousScopes: readonly string[] | undefined;
  replacementScopes: readonly string[];
  calendarGrantStored: boolean;
}): string | undefined {
  if (previousScopes === undefined || calendarGrantStored) {
    return undefined;
  }
  if (
    !mailGrantCoversCalendar({ granted: previousScopes }) ||
    mailGrantCoversCalendar({ granted: replacementScopes })
  ) {
    return undefined;
  }
  return (
    "the Outlook calendar was reading over the mail grant this consent replaced, and the new grant does not " +
    `cover it — run \`${outlookConnectVerb({ product: "calendar" })}\` to connect the calendar on its own`
  );
}

/**
 * The app registration the door consents through, said once so the door's own refusal, the `connect outlook
 * --check` row and onboarding cannot drift apart. `/consumers` is the authority (`authority.ts`), so the
 * registration must admit personal accounts; one that also admits work accounts works too.
 */
export const OUTLOOK_REGISTRATION_SETTINGS =
  "create or reuse a Microsoft Entra app registration that admits personal Microsoft accounts, add the " +
  "Mobile and desktop applications platform with redirect `http://localhost` (a public client using PKCE, so " +
  "no client secret), see `skills/outlook/reference/connecting.md`";

/** The settings plus the command that stores the client id — what a refusal tells a reader to do. */
export const OUTLOOK_REGISTRATION_STEPS = `${OUTLOOK_REGISTRATION_SETTINGS}, then run \`slopweaver secrets set outlook-client-id\``;

/** What an unflagged `outlook connect` asks for — see {@link OUTLOOK_GRANTS}. */
export const DEFAULT_OUTLOOK_GRANT = "manage";

/** The capability each Outlook verb needs — the single place a verb's minimum grant is declared. */
export const OUTLOOK_VERB_CAPABILITIES: Readonly<Record<string, readonly OutlookCapability[]>> = {
  archive: ["modify"],
  attachment: ["read"],
  categories: ["settings"],
  // The category list a name resolves against is a mailbox SETTING, read before anything is written.
  category: ["modify", "settings"],
  draft: ["modify"],
  folders: ["read"],
  list: ["read"],
  mark: ["modify"],
  measure: ["read"],
  read: ["read"],
  send: ["send", "read"],
  triage: ["read"],
};

/**
 * One permission as Graph might report it, reduced to Microsoft's short spelling and lower-cased, so
 * `https://graph.microsoft.com/Mail.Read` and `mail.read` compare equal.
 *
 * @returns the comparable form
 */
function comparable({ scope }: { scope: string }): string {
  return scope.replace(/^https:\/\/graph\.microsoft\.com\//i, "").toLowerCase();
}

/**
 * The permissions to REQUEST for a set of capabilities, with `offline_access` always last.
 *
 * @param capabilities what the caller wants to be able to do
 * @returns the deduplicated scope list in capability order
 */
export function outlookRequestScopes({
  capabilities,
}: {
  capabilities: readonly OutlookCapability[];
}): readonly string[] {
  const scopes = capabilities.map((capability) => OUTLOOK_SCOPES[capability]);
  return [...new Set(scopes), OFFLINE_ACCESS];
}

/**
 * The permissions a stored grant is MISSING for a verb, named by each capability's own permission so the
 * message says what to approve rather than what would have implied it.
 *
 * @param granted the scopes Microsoft reported on the grant, in any spelling
 * @param capabilities every capability the verb needs
 * @returns the permission of each unsatisfied capability, in the order given
 */
export function missingOutlookScopes({
  granted,
  capabilities,
}: {
  granted: readonly string[];
  capabilities: readonly OutlookCapability[];
}): readonly string[] {
  const have = new Set(granted.map((scope) => comparable({ scope })));
  return capabilities
    .filter((capability) => {
      const accepted = [OUTLOOK_SCOPES[capability], ...IMPLIED_BY[capability]];
      return !accepted.some((scope) => have.has(comparable({ scope })));
    })
    .map((capability) => OUTLOOK_SCOPES[capability]);
}

/**
 * The scopes worth recording on a grant: what Microsoft reported, in its short spelling, without the
 * OpenID scopes MSAL adds on its own (`openid`, `profile`, `offline_access`), which reach no mailbox data.
 *
 * @param reported the scopes an MSAL `AuthenticationResult` carried
 * @returns the resource permissions, deduplicated, in the order reported
 */
export function grantedOutlookScopes({ reported }: { reported: readonly string[] }): readonly string[] {
  const openId = new Set(["openid", "profile", "email", OFFLINE_ACCESS]);
  const short = reported.map((scope) => scope.replace(/^https:\/\/graph\.microsoft\.com\//i, ""));
  return [...new Set(short.filter((scope) => !openId.has(scope.toLowerCase())))];
}
