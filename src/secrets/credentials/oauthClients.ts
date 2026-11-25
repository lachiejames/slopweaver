/**
 * The OAuth clients the consent doors stand on — the three Google Desktop-app clients (user data, Admin,
 * SecOps), the Outlook door's public client, and the SecOps instance name that door reads. None is a user
 * credential: a client id names an application, a Desktop-app secret ships with it, and the instance is a
 * resource name.
 */
import type { CredentialSpec } from "./spec.js";

/** A Desktop-app OAuth client id as Google issues it: the project number, a dash, the client's own id. */
const GOOGLE_CLIENT_ID_SHAPE = {
  describe: "a bare Google OAuth client id, `<digits>-<letters and digits>.apps.googleusercontent.com`",
  pattern: /^\d+-[a-z0-9]+\.apps\.googleusercontent\.com$/,
} as const;

/**
 * The OAuth client rows, in register order: the Admin client, the user-data client, the SecOps client,
 * Outlook's, then the SecOps instance.
 */
export const OAUTH_CLIENT_CREDENTIALS = [
  {
    expiry: "none",
    lifecycle: "live",
    mintScope: "not-a-credential",
    name: "google-admin-client-id",
    platform: "Google",
    reader: "src/secrets/googleClients.ts",
    readVerbs: "slopweaver atlas google-admin *",
    settable: true,
    shape: "line",
    usedFor:
      "identifying the SECOND Desktop-app OAuth client, the one the Google Workspace Admin door alone consents through — Google merges granted scopes over the (client, account) pair, so a client that has never been shown a write scope cannot produce a token carrying one (the line is write on the owner's own data, read-only on Google admin). It must be a NEW client: a second secret added to the `google-client-id` client leaves this id equal to that one, which `atlas google-admin connect` refuses",
    valueShape: GOOGLE_CLIENT_ID_SHAPE,
    what: "a Desktop-app OAuth client id, in the same Cloud project as `google-client-id`",
    writtenBy: "slopweaver secrets set google-admin-client-id",
  },
  {
    expiry: "none",
    lifecycle: "live",
    mintScope: "not-a-credential",
    name: "google-admin-client-secret",
    platform: "Google",
    reader: "src/secrets/googleClients.ts",
    readVerbs: "slopweaver atlas google-admin *",
    settable: true,
    shape: "line",
    usedFor:
      "the companion to `google-admin-client-id`; ships with the application, which is why the consent flow applies PKCE regardless of it",
    what: "a Desktop-app OAuth client secret",
    writtenBy: "slopweaver secrets set google-admin-client-secret",
  },
  {
    expiry: "none",
    lifecycle: "live",
    mintScope: "not-a-credential",
    name: "google-client-id",
    platform: "Google",
    reader: "src/secrets/googleClients.ts",
    readVerbs: "slopweaver gmail/drive/calendar connect",
    settable: true,
    shape: "line",
    usedFor:
      "identifying the Desktop-app OAuth client the USER-DATA doors consent through — mail, Drive and calendar, the three that may hold write scopes on the owner's own data (not a user credential). The Admin door uses `google-admin-client-id` instead",
    valueShape: GOOGLE_CLIENT_ID_SHAPE,
    what: "a Desktop-app OAuth client id",
    writtenBy: "slopweaver secrets set google-client-id",
  },
  {
    expiry: "none",
    lifecycle: "live",
    mintScope: "not-a-credential",
    name: "google-client-secret",
    platform: "Google",
    reader: "src/secrets/googleClients.ts",
    readVerbs: "slopweaver gmail/drive/calendar connect",
    settable: true,
    shape: "line",
    usedFor:
      "the companion to `google-client-id`; ships with the application, which is why the consent flow applies PKCE regardless of it",
    what: "a Desktop-app OAuth client secret",
    writtenBy: "slopweaver secrets set google-client-secret",
  },
  {
    expiry: "none",
    lifecycle: "live",
    mintScope: "not-a-credential",
    name: "google-secops-client-id",
    platform: "Google (SecOps door)",
    reader: "src/secrets/googleClients.ts",
    readVerbs: "slopweaver atlas google-secops *",
    settable: true,
    shape: "line",
    usedFor:
      "identifying the THIRD Desktop-app OAuth client, the one the Google Security Operations door alone consents through, for `chronicle.readonly` and nothing wider (least privilege on our own setup). Google merges granted scopes over the (client, account) pair, so a scope added to either other client would ride every token that client mints; `atlas google-secops connect` refuses an id equal to `google-client-id` or `google-admin-client-id`",
    valueShape: GOOGLE_CLIENT_ID_SHAPE,
    what: "a Desktop-app OAuth client id, in a Cloud project with the Chronicle API enabled",
    writtenBy: "slopweaver secrets set google-secops-client-id",
  },
  {
    expiry: "none",
    lifecycle: "live",
    mintScope: "not-a-credential",
    name: "google-secops-client-secret",
    platform: "Google (SecOps door)",
    reader: "src/secrets/googleClients.ts",
    readVerbs: "slopweaver atlas google-secops *",
    settable: true,
    shape: "line",
    usedFor:
      "the companion to `google-secops-client-id`; ships with the application, which is why the consent flow applies PKCE regardless of it",
    what: "a Desktop-app OAuth client secret",
    writtenBy: "slopweaver secrets set google-secops-client-secret",
  },
  {
    // Both grants sit on their own door's platform, so the link is what makes either one stored evidence that
    // this missing registration is a gap.
    absentMattersWith: ["outlook-oauth.json", "outlook-calendar-oauth.json"],
    expiry: "none",
    lifecycle: "live",
    mintScope: "not-a-credential",
    name: "outlook-client-id",
    platform: "Microsoft (Outlook mail and calendar doors)",
    reader: "src/secrets/outlookGrant.ts",
    readVerbs: "slopweaver outlook connect, slopweaver outlook-calendar connect, slopweaver connect outlook --check",
    settable: true,
    shape: "line",
    usedFor:
      "identifying the PUBLIC-client app registration (personal Microsoft accounts, Mobile and desktop platform, redirect `http://localhost`) the Outlook mail and Outlook Calendar doors each consent through with PKCE. Not a user credential, and a public client has no secret",
    valueShape: {
      describe: "a bare Microsoft application (client) id, a GUID like `00000000-0000-0000-0000-000000000000`",
      pattern: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    },
    what: "a Microsoft Entra application (client) id",
    writtenBy: "slopweaver secrets set outlook-client-id",
  },
  {
    expiry: "none",
    lifecycle: "live",
    mintScope: "not-a-credential",
    name: "google-secops-instance",
    platform: "Google (SecOps door)",
    reader: "src/live/googleSecops/instance.ts",
    readVerbs: "slopweaver atlas google-secops *",
    settable: true,
    shape: "line",
    usedFor:
      "naming the one Chronicle instance the door reads, as `projects/<project>/locations/<location>/instances/<uuid>`; the location fixes the only host it may call. Not a secret, and stored like one because the project id is the organisation's own name",
    what: "a Chronicle instance resource name",
    writtenBy: "slopweaver secrets set google-secops-instance",
  },
] as const satisfies readonly CredentialSpec[];
