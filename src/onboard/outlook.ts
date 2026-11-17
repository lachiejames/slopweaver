/**
 * Outlook in `slopweaver onboard`: a personal Microsoft mailbox, one of the corpus sources, connected once and
 * then read whole the first time and by what changed after.
 *
 * What a fresh machine needs, in order: an Entra app registration's client id (a public client with PKCE, so
 * there is NO secret to lose — the opposite of Gmail's shown-once client secret), then ONE consent in the
 * browser. The registration settings come from {@link OUTLOOK_REGISTRATION_SETTINGS}, the same sentence the
 * preflight's `registration` row prints, so the two cannot drift.
 *
 * Pure: no I/O, no clock. Nothing here can emit an account, a client id or a token.
 */
import { OUTLOOK_REGISTRATION_SETTINGS } from "../live/outlook/scopes.js";
import type { OnboardSourceSpec } from "./sources.js";

/** The Graph delegated permissions to list on the registration, so its consent screen matches the ask. */
export const OUTLOOK_REGISTRATION_PERMISSIONS: readonly string[] = [
  "User.Read",
  "Mail.Read",
  "MailboxSettings.Read",
  "Mail.ReadWrite",
  "Mail.Send",
  "offline_access",
];

/** Everything `onboard` says about the Outlook mailbox. */
export const OUTLOOK_SOURCE_SPEC: OnboardSourceSpec = {
  buys:
    "a personal Microsoft mailbox (outlook.com, hotmail.com, live.com) — every folder bar drafts, outbox, junk " +
    "and deleted mail, read whole once and then by what changed",
  caveats: [
    "every mail record is PRIVATE by source and can never be served to a non-owner",
    "`refresh --all-sources` does NOT include it — a mailbox is reached by naming `--source outlook`",
    "the registration is a public client with PKCE, so there is no client secret to lose",
  ],
  credentials: [
    {
      action:
        `register an app under App registrations: ${OUTLOOK_REGISTRATION_SETTINGS}. List these delegated ` +
        `Microsoft Graph permissions: ${OUTLOOK_REGISTRATION_PERMISSIONS.join(", ")}. The Application (client) ` +
        "ID is an identifier, not a secret",
      page: "https://entra.microsoft.com",
      secret: "outlook-client-id",
      warning: undefined,
    },
    {
      action:
        "`slopweaver outlook connect --grant manage` — opens Microsoft's consent screen once, listens on " +
        "localhost for the single redirect, and stores the grant 0600. `--grant full` adds Mail.Send",
      page: "https://account.live.com/consent/Manage",
      secret: undefined,
      warning: undefined,
    },
  ],
  inAllSources: false,
  preflight: "slopweaver connect outlook --check --json",
  refreshArgv: ["refresh", "--source", "outlook"],
  source: "outlook",
};
