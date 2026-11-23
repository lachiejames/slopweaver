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
 * are the MAIL capabilities, named before the calendar arrived; `calendar` is the calendar's read, which the
 * `outlook-calendar` noun needs and no mail verb does.
 */
export type OutlookCapability = "identity" | "read" | "modify" | "send" | "settings" | "calendar";

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
 * The MAIL grants `outlook connect --grant` offers, narrowest first. None carries `calendar`: a mail grant asks
 * for mail permissions only, and the calendar's `Calendars.Read` is added by `outlook connect --calendar` alone
 * (least privilege — the calendar door is the one verb family that needs it).
 */
export const OUTLOOK_GRANTS: Readonly<Record<string, readonly OutlookCapability[]>> = {
  full: ["identity", "read", "settings", "modify", "send"],
  // The default, and deliberately not `read`: categorising, read-state and archiving are what the owner reaches
  // for straight after reading, and widening a grant later costs a browser round trip. `send` stays behind an
  // explicit `--grant full`, because it is the one permission that puts mail in front of another person.
  manage: ["identity", "read", "settings", "modify"],
  read: ["identity", "read", "settings"],
};

/** The capability `outlook connect --calendar` adds to whichever mail grant it asks for. */
export const OUTLOOK_CALENDAR_CAPABILITY: OutlookCapability = "calendar";

/**
 * The ONE `outlook connect` command that re-grants what a verb found missing without narrowing what the stored
 * grant already holds: `--grant full` when `Mail.Send` is missing or already held, and `--calendar` when the
 * calendar permission is missing or already held. Re-running `connect` REPLACES the grant, so a remedy that left
 * either flag off would trade one missing permission for another.
 *
 * @param missing the permissions the verb found absent, as {@link missingOutlookScopes} names them
 * @param granted the scopes the stored grant carries, in any spelling
 * @returns the command line to run, flags included
 */
export function outlookReconnectCommand({
  missing,
  granted,
}: {
  missing: readonly string[];
  granted: readonly string[];
}): string {
  const calendarScope = comparable({ scope: OUTLOOK_SCOPES.calendar });
  const missingComparable = missing.map((scope) => comparable({ scope }));
  const calendarMissing = missingComparable.includes(calendarScope);
  const mailMissing = missingComparable.some((scope) => scope !== calendarScope);
  const holdsSend = missingOutlookScopes({ capabilities: ["send"], granted }).length === 0;
  const holdsCalendar = missingOutlookScopes({ capabilities: [OUTLOOK_CALENDAR_CAPABILITY], granted }).length === 0;
  const flags: string[] = [];
  if (mailMissing || holdsSend) {
    flags.push("--grant full");
  }
  if (calendarMissing || holdsCalendar) {
    flags.push("--calendar");
  }
  return ["slopweaver outlook connect", ...flags].join(" ");
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
