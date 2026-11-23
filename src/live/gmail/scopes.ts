/**
 * Which Google scope each Gmail verb needs — the mail door's own vocabulary, read by the shared helpers in
 * `src/live/google/scopes.ts`.
 *
 * The doc this integration was built from asks for the MINIMUM scope per verb rather than one broad grant,
 * so the mapping is data rather than prose: a verb names its capability, the capability names its scope,
 * and `gmail connect` requests exactly the union the caller asked to be able to do. Two properties are
 * worth stating because they are Google's rules and not this repo's choices:
 *
 * - **`gmail.modify` subsumes `gmail.readonly`.** A grant carrying modify can read, so a readonly
 *   requirement is satisfied by either. The reverse is not true.
 * - **`gmail.send` does not subsume `gmail.compose`.** Composing a draft and sending a message are separate
 *   grants in Google's model, which is exactly what makes "drafts are the default outcome, send is a
 *   separate deliberate verb" expressible as a credential property rather than only as a code path.
 *
 * Pure: no I/O, no clock.
 */
import type { GoogleScopeTable } from "../google/scopes.js";

/** The Gmail capability a verb needs. One capability maps to exactly one scope URI. */
export type GmailCapability = "read" | "modify" | "compose" | "send" | "identity" | "docs";

/** The scope URI granted for each capability. */
export const GMAIL_SCOPES: Readonly<Record<GmailCapability, string>> = {
  compose: "https://www.googleapis.com/auth/gmail.compose",
  // NOT a Gmail scope, and that is the whole point of it being here. A Gemini meeting-notes email carries
  // an inline summary and a LINK to a Google Doc that holds the notes and the transcript, so the transcript
  // is only reachable with a Docs grant. `documents.readonly` is the narrowest scope that reads a document
  // the owner can already open — narrower than `drive.readonly`, which would grant every file in the Drive
  // rather than the ones a mail actually names. The Drive DOOR asks for that wider scope on its own grant
  // (`src/live/drive/scopes.ts`), which is exactly why the two doors do not share a grant file.
  docs: "https://www.googleapis.com/auth/documents.readonly",
  identity: "https://www.googleapis.com/auth/userinfo.email",
  modify: "https://www.googleapis.com/auth/gmail.modify",
  read: "https://www.googleapis.com/auth/gmail.readonly",
  send: "https://www.googleapis.com/auth/gmail.send",
} as const;

/** The mail door's scope vocabulary, in the shape every shared grant helper reads. */
export const GMAIL_SCOPE_TABLE: GoogleScopeTable<GmailCapability> = {
  identity: "identity",
  /**
   * The scopes that ALSO satisfy a capability. `gmail.modify` implies read access; nothing implies compose
   * or send, and nothing implies identity.
   */
  impliedBy: {
    compose: [],
    // The DRIVE door asks for `documents` — Docs read AND write — so an install that approved it there is
    // never told to re-consent here for the narrower read. Google's rule, not this repo's.
    docs: ["https://www.googleapis.com/auth/documents"],
    identity: [],
    modify: [],
    read: [GMAIL_SCOPES.modify],
    send: [],
  },
  scopes: GMAIL_SCOPES,
};

/** The capability each Gmail verb needs — the single place a verb's minimum grant is declared. */
export const VERB_CAPABILITIES: Readonly<Record<string, readonly GmailCapability[]>> = {
  archive: ["modify"],
  attachment: ["read"],
  draft: ["compose"],
  label: ["modify"],
  labels: ["read"],
  list: ["read"],
  mark: ["modify"],
  read: ["read"],
  send: ["send"],
} as const;
