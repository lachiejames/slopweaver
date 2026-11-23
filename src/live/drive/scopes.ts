/**
 * Which Google scope each Drive verb needs — the Drive door's own vocabulary, read by the shared helpers in
 * `src/live/google/scopes.ts`.
 *
 * ## Why `metadata` is a capability of its own and not a convenience
 *
 * `drive.metadata.readonly` lists and describes files — names, owners, types, sizes, folder parents, the
 * whole tree — and **cannot read a single byte of content**. `drive.readonly` can. That is the sharpest
 * line the Drive API draws, and it is the one worth making a person choose on the consent screen: an
 * install that only ever needs to answer "what is in here and who owns it" never has to grant an
 * application the ability to read the files themselves. So `drive connect --grant metadata` is a genuinely
 * useful narrow grant rather than a token gesture, and it is why `list` and `drives` demand only `metadata`
 * while `read` demands `content`.
 *
 * `drive.readonly` subsumes `drive.metadata.readonly` — Google's rule, not this repo's — so an install that
 * approved the wider grant is never told to re-consent for the narrower one.
 *
 * ## The two WRITE scopes, and the one that is deliberately not here
 *
 * The owner's rule: write capabilities on Gmail, Drive, Docs and Calendar, to pull their data and write on
 * their word. The standing rail is the other half of it — no scope that allows wiping company drives — and
 * the two together pick the scopes exactly:
 *
 * - **`write` is `drive.file`**, the PER-FILE scope: create a file, and read, edit or delete only the files
 *   this application itself created or the owner explicitly opened with it. It cannot touch anything else in
 *   their Drive and it cannot reach a shared drive at all, so it can create what the owner asks for and
 *   cannot wipe what they did not.
 * - **`docs` is `documents`**, Google Docs read and write. `drive.file` alone would NOT satisfy what the
 *   owner asked for: the common case is editing a doc that already exists and that this application did not
 *   create, which `drive.file` reaches only through Google's Picker and therefore never from a CLI.
 *   `documents` closes exactly that gap and grants no delete of anything — the Docs API has no such method.
 *   It subsumes the `documents.readonly` the MAIL door asks for (`src/live/gmail/scopes.ts`), which is why
 *   that door's `docs` capability accepts this scope by implication.
 * - **`https://www.googleapis.com/auth/drive` is NOT here**, and its absence is the rail. It is the one
 *   scope that can delete every file in a shared drive, and `actsOnlyAsTheBoundAccount.test.ts` asserts the
 *   declared Drive scope set exactly so that adding it fails a test rather than a review.
 *
 * Neither write scope has a verb yet — `VERB_CAPABILITIES` below names only the three readers. They are
 * requested so the credential carries what the owner asked it to carry; the verbs that spend them are the named
 * next step, and a verb added later needs no second browser round trip.
 *
 * Pure: no I/O, no clock.
 */
import type { GoogleScopeTable } from "../google/scopes.js";

/** The Drive capability a verb needs. One capability maps to exactly one scope URI. */
export type DriveCapability = "metadata" | "content" | "write" | "docs" | "identity";

/** The scope URI granted for each capability. */
export const DRIVE_SCOPES: Readonly<Record<DriveCapability, string>> = {
  content: "https://www.googleapis.com/auth/drive.readonly",
  docs: "https://www.googleapis.com/auth/documents",
  identity: "https://www.googleapis.com/auth/userinfo.email",
  metadata: "https://www.googleapis.com/auth/drive.metadata.readonly",
  write: "https://www.googleapis.com/auth/drive.file",
} as const;

/** The Drive door's scope vocabulary, in the shape every shared grant helper reads. */
export const DRIVE_SCOPE_TABLE: GoogleScopeTable<DriveCapability> = {
  identity: "identity",
  /**
   * `drive.readonly` reads metadata too; nothing implies content, and nothing implies identity. Nothing
   * implies either write scope either — a grant that reads is never told it can also create.
   */
  impliedBy: {
    content: [],
    docs: [],
    identity: [],
    metadata: [DRIVE_SCOPES.content],
    write: [],
  },
  scopes: DRIVE_SCOPES,
};

/** The capability each Drive verb needs — the single place a verb's minimum grant is declared. */
export const VERB_CAPABILITIES: Readonly<Record<string, readonly DriveCapability[]>> = {
  drives: ["metadata"],
  list: ["metadata"],
  // The one verb that reads a file's own bytes, and the only reason this door ever asks for `drive.readonly`.
  read: ["content"],
} as const;
