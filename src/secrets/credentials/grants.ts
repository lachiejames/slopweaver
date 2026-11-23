/**
 * The grants and sessions a verb acts as the owner through — the user-consent OAuth grants a `connect` verb writes
 * (Gmail, Outlook, Drive, calendar, Google Admin, Google SecOps) and the one ChatGPT web session
 * `chatgpt import-request` stores. None is settable: `secrets set` refuses a multi-line value on purpose.
 */
import type { CredentialSpec } from "./spec.js";

/** The grant and session rows, in register order, the ChatGPT web session first. */
export const GRANT_CREDENTIALS = [
  {
    expiry: "at-mint",
    lifecycle: "live",
    mintScope: "read-write",
    name: "chatgpt-web-session.json",
    platform: "ChatGPT (the owner's personal account's web session)",
    reader: "src/cli/commands/chatgpt/session.ts",
    readVerbs: "slopweaver chatgpt conversation, slopweaver chatgpt list",
    settable: false,
    shape: "file",
    usedFor:
      "listing every conversation on the owner's account and reading a named one whole, by id, through ChatGPT's private web API. The five request headers of a signed-in chatgpt.com request copied from DevTools; a browser session can do anything the owner can, which is why the verbs holding it build only GET paths in code, read each answer through a strict boundary and never follow a redirect. The bearer's own `exp` is recorded beside the headers",
    what: "a signed-in chatgpt.com session: bearer, cookie, account id, device id, user agent",
    writtenBy: "slopweaver chatgpt import-request --from <the owner's pasted request>, which removes the paste",
  },
  {
    expiry: "grant-cache",
    lifecycle: "live",
    mintScope: "read-write",
    name: "gmail-oauth.json",
    platform: "Google (mail door)",
    reader: "src/secrets/gmailGrant.ts",
    readVerbs: "slopweaver gmail *",
    settable: false,
    shape: "grant",
    usedFor:
      "acting as the bound mailbox — reading, labelling, archiving and, on the owner's approval, sending. A refresh token plus the scopes actually approved; the cached access token beside it is renewed automatically",
    what: "a Google user-consent grant",
    writtenBy: "slopweaver gmail connect",
  },
  {
    expiry: "grant-cache",
    lifecycle: "live",
    mintScope: "read-write",
    name: "outlook-oauth.json",
    platform: "Microsoft (Outlook mail door)",
    reader: "src/secrets/outlookGrant.ts",
    readVerbs: "slopweaver outlook *, slopweaver connect outlook --check",
    settable: false,
    shape: "grant",
    usedFor:
      "acting as the bound personal mailbox — reading, categorising, archiving and, on the owner's approval, sending. MSAL's serialized token cache (a rotating refresh token, the cached access token, the account) plus the scopes Microsoft reported granted; rewritten after every silent refresh",
    what: "a Microsoft user-consent grant",
    writtenBy: "slopweaver outlook connect",
  },
  {
    expiry: "grant-cache",
    lifecycle: "live",
    mintScope: "read-write",
    name: "drive-oauth.json",
    platform: "Google (Drive door)",
    reader: "src/secrets/driveGrant.ts",
    readVerbs: "slopweaver drive *",
    settable: false,
    shape: "grant",
    usedFor:
      "listing and reading the bound account's Drive, and creating files and editing Docs for the owner. The write scopes are `drive.file`, which reaches only what this application itself created, and `documents`, which edits a Doc the owner can already open and can delete nothing. `https://www.googleapis.com/auth/drive`, the one that could wipe a company drive, is kept out by a rail in `src/__tests__/unit/live/google/actsOnlyAsTheBoundAccount.test.ts` rather than asserted here",
    what: "a Google user-consent grant",
    writtenBy: "slopweaver drive connect",
  },
  {
    expiry: "grant-cache",
    lifecycle: "live",
    mintScope: "read-write",
    name: "calendar-oauth.json",
    platform: "Google (calendar door)",
    reader: "src/secrets/calendarGrant.ts",
    readVerbs: "slopweaver calendar *",
    settable: false,
    shape: "grant",
    usedFor:
      "reading which calendars exist, what is on in a window, and one event in full — and booking, moving, answering and cancelling events on a calendar the account OWNS, under `calendar.events.owned` and nothing wider",
    what: "a Google user-consent grant",
    writtenBy: "slopweaver calendar connect",
  },
  {
    expiry: "grant-cache",
    lifecycle: "live",
    mintScope: "read-only",
    name: "google-admin-oauth.json",
    platform: "Google (Admin door)",
    reader: "src/secrets/googleAdminGrant.ts",
    readVerbs: "slopweaver atlas google-admin *",
    settable: false,
    shape: "grant",
    usedFor:
      "reading the Workspace directory through readonly administrator scopes, and nothing else, through its OWN OAuth client (`google-admin-client-id`): `atlas google-admin connect` refuses one equal to `google-client-id` and refuses to store a grant carrying a scope not provably read-only. Whether the grant on disk IS read-only is the label `secrets status` derives from its scopes, never this cell — a consent screen can grant more than the client asked for, so a grant may carry write scopes on the owner's own data while staying read-only on Google admin",
    what: "a Google user-consent grant",
    writtenBy: "slopweaver atlas google-admin connect",
  },
  {
    expiry: "grant-cache",
    lifecycle: "live",
    mintScope: "read-only",
    name: "google-secops-oauth.json",
    platform: "Google (SecOps door)",
    reader: "src/secrets/googleSecopsGrant.ts",
    readVerbs: "slopweaver atlas google-secops *",
    settable: false,
    shape: "grant",
    usedFor:
      "reading the Google Security Operations instance under `chronicle.readonly` and nothing else, through its OWN OAuth client (`google-secops-client-id`): `atlas google-secops connect` refuses one equal to either other Google client and refuses to store a grant carrying a scope not provably read-only, and the door's transport sends only a GET to the instance's own regional host (never write onto SecOps)",
    what: "a Google user-consent grant",
    writtenBy: "slopweaver atlas google-secops connect",
  },
] as const satisfies readonly CredentialSpec[];
