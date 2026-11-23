/**
 * Lazy manifest for the `drive` noun — the Google Drive door.
 *
 * ## No verb here writes, though one grant can
 *
 * Every verb here is `external-read` except `connect`, which writes a credential under `$SLOPWEAVER_HOME`
 * and touches no file in the Drive. Nothing in this noun creates, renames, moves, shares or deletes
 * anything. That is a property of the CODE, not of every grant: `--grant write`
 * has the credential carry `drive.file` and `documents` so a write verb added later needs no second browser
 * round trip. Which scope each capability is, and why `drive` itself is absent, is `src/live/drive/scopes.ts`.
 *
 * ## The three grants, and why the narrow one is the default
 *
 * `--grant metadata` enumerates and describes every file and CANNOT read one byte of any of them.
 * `--grant read` can. `--grant write` adds the two write scopes above. An install that only ever answers
 * "what is in here, who owns it, when did it change" therefore never has to hand the application the
 * ability to read the files themselves, and the default reflects that: reading content is the deliberate
 * second step, not the starting position. `list` and `drives` demand only `metadata`; `read` demands
 * `content`, and refuses at the door rather than failing halfway through with a 403 that names no scope.
 */
import { lazy, type VerbManifestEntry } from "../manifest.js";

const CONNECT_USAGE =
  "usage: slopweaver drive connect [--grant <metadata|read|write>] [--status] [--revoke] [--json]\n" +
  "       [--home <dir>]\n" +
  "  Opens Google's consent screen in your browser and stores the resulting grant, owner-only (0600)\n" +
  "  --grant   which capabilities to request (default metadata: list and describe, never read content)\n" +
  "            metadata = drive.metadata.readonly · read = + drive.readonly · write = + drive.file\n" +
  "            (only files this application created) + documents (edit a Doc you can already open)\n" +
  "  --status  report the stored grant's account and scopes and stop — no browser, no socket, no network\n" +
  "  --revoke  withdraw the stored grant at Google and delete it — Google revokes the whole\n" +
  "            (client, account) grant at once, so every door sharing this OAuth client goes with it\n" +
  "  --json    emit the token-free grant status as one machine-readable document\n" +
  "  Needs the USER-DATA Desktop-app OAuth client: `slopweaver secrets set google-client-id` and\n" +
  "  `slopweaver secrets set google-client-secret` — the one the mail, Drive and calendar doors share,\n" +
  "  and NOT the Google Admin door's. The grant is its own file, separate from the mail door's";

const LIST_USAGE =
  "usage: slopweaver drive list [--query <drive-query>] [--folder <id>] [--drive <id>] [--limit <1..100>] " +
  "[--trashed] [--json] [--home <dir>]\n" +
  "  Lists matching files as metadata only — name, type, size, owner, modified date. No content is read\n" +
  "  --query   a Drive search expression, exactly as the API takes it (`name contains 'budget'`)\n" +
  "  --folder  restrict to the direct children of one folder id\n" +
  "  --drive   search a SHARED drive instead of My Drive — a shared drive is a SEPARATE corpus and is not\n" +
  "            searched otherwise, however much it looks like one Drive in the browser\n" +
  "  --limit   how many files to read (default 25, maximum 100)\n" +
  "  --trashed include trashed files, which are excluded by default\n" +
  "  --json    emit one machine-readable document with freshness, coverage and residue\n" +
  "  One page, never the whole Drive: the residue says when more matched than was read";

const READ_USAGE =
  "usage: slopweaver drive read <file-id-or-url> [--metadata-only] [--json] [--home <dir>]\n" +
  "  Reads one file: its metadata always, and its text when it is a Google Doc, Sheet or Slides deck\n" +
  "  --metadata-only  do not export any text, even from a document that has one\n" +
  "  --json           emit one machine-readable document with freshness, coverage and residue\n" +
  "  Takes the URL from your browser bar as readily as a bare id. A binary file's BYTES are never\n" +
  "  downloaded — the read reports the file and says plainly that nothing reflects its content";

const DRIVES_USAGE =
  "usage: slopweaver drive drives [--json] [--home <dir>]\n" +
  "  Lists every SHARED drive this account can see, with the id a `drive list` restriction takes\n" +
  "  --json    emit one machine-readable document with freshness, coverage and residue\n" +
  "  My Drive is not a shared drive and has no id — it is what `drive list` searches by default";

export const driveManifest: Readonly<Record<string, VerbManifestEntry>> = {
  connect: lazy({
    load: () => import("../commands/drive/connectRun.js").then((m) => m.driveConnectCommand),
    meta: {
      createsWorkItem: false,
      // Not a diagnostic: `--status` reporting "not connected" is a finding, but the flow itself either
      // stores a grant or fails, and a failed consent is a broken run rather than a reported state.
      diagnostic: false,
      doorRouted: false,
      // NOT dryParseSafe, and the distinction is the point: a bare `drive connect` is a valid invocation
      // that opens a socket and a browser, so "no args does nothing" is false of it. The narrower claim IS
      // true — a bad flag or an unknown `--grant` is refused by the pure parser before any of that.
      dryParseSafe: false,
      effect: "local-state",
      example: "slopweaver drive connect --grant metadata",
      parseRejectIsIoFree: true,
      summary: "Authorise a Google Drive by browser consent and store the grant owner-only under this home",
      usage: CONNECT_USAGE,
    },
  }),
  drives: lazy({
    load: () => import("../commands/drive/readRun.js").then((m) => m.driveDrivesCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      // A bare `drive drives` is a valid whole-vocabulary read, so it is not no-args-safe; its REJECT
      // path is — an unknown flag is refused before a credential is read.
      dryParseSafe: false,
      effect: "external-read",
      example: "slopweaver drive drives --json",
      parseRejectIsIoFree: true,
      summary: "List the shared drives this account can see — the ids a --drive restriction is written in",
      usage: DRIVES_USAGE,
    },
  }),
  list: lazy({
    load: () => import("../commands/drive/readRun.js").then((m) => m.driveListCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      // A bare `drive list` is a valid whole-Drive read, so it is not no-args-safe; its REJECT path is.
      dryParseSafe: false,
      effect: "external-read",
      example: "slopweaver drive list --query \"name contains 'budget'\" --limit 20",
      parseRejectIsIoFree: true,
      summary: "List matching files as metadata only — name, type, size, owner, modified date, never content",
      usage: LIST_USAGE,
    },
  }),
  read: lazy({
    load: () => import("../commands/drive/readRun.js").then((m) => m.driveReadCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      // Genuinely no-args-safe: `drive read` with no address refuses on the pure parser, having read nothing.
      dryParseSafe: true,
      effect: "external-read",
      example: "slopweaver drive read https://docs.google.com/document/d/1AbCdEfGhIjK/edit",
      parseRejectIsIoFree: true,
      summary: "Read one file in full — metadata always, and exported text when it is a Google document",
      usage: READ_USAGE,
    },
  }),
};
