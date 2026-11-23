/**
 * Outlook in `slopweaver onboard`: a LIVE personal mailbox, connected once and read at question time.
 *
 * It is not one of the five corpus sources and must not become one — `ONBOARD_SOURCES` is a closed list of
 * things `onboard plan` turns into a `refresh --source` command, and nothing crawls Outlook. So it renders
 * as its own block beside them, the way the org-owned mailbox does, rather than weakening that type.
 *
 * What a fresh machine needs, in order: an Entra app registration's client id (a public client with PKCE, so
 * there is NO secret to lose — the opposite of Gmail's shown-once client secret), then ONE consent in the
 * browser. The registration settings come from {@link OUTLOOK_REGISTRATION_SETTINGS}, the same sentence the
 * preflight's `registration` row prints, so the two cannot drift.
 *
 * Pure: no I/O, no clock. Nothing here can emit an account, a client id or a token.
 */
import { OUTLOOK_REGISTRATION_SETTINGS } from "../live/outlook/scopes.js";

/** The Graph delegated permissions to list on the registration, so its consent screen matches the ask. */
export const OUTLOOK_REGISTRATION_PERMISSIONS: readonly string[] = [
  "User.Read",
  "Mail.Read",
  "MailboxSettings.Read",
  "Mail.ReadWrite",
  "Mail.Send",
  "offline_access",
];

/**
 * The Outlook block of the "connect your sources" section.
 *
 * @returns the lines to print, in order
 */
export function outlookConnectorLines(): readonly string[] {
  return [
    "Live connector: Outlook (a personal Microsoft mailbox — outlook.com, hotmail.com, live.com)",
    "  Read at question time through the `outlook` verbs and NEVER crawled: nothing reaches bronze or the store,",
    "  so there is no backfill to choose and `refresh` never names it.",
    "    https://entra.microsoft.com → App registrations",
    `      ${OUTLOOK_REGISTRATION_SETTINGS}`,
    `      delegated Microsoft Graph permissions to list: ${OUTLOOK_REGISTRATION_PERMISSIONS.join(", ")}`,
    "      capture as: outlook-client-id   (an identifier, not a secret — nothing is shown once)",
    "    then ONE consent: `slopweaver outlook connect --grant manage` opens Microsoft's consent screen, listens",
    "      on localhost for the single redirect and stores the grant 0600. `--grant full` adds Mail.Send;",
    "      widening later is another explicit consent",
    "    · its preflight proves the registration, the grant's tiers and a live GET /me — listed with the others below",
    "",
  ];
}
