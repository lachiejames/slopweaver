/**
 * The owner's ChatGPT web session on disk: `$SLOPWEAVER_HOME/secrets/chatgpt-web-session.json`, written at
 * `0600` under a `0700` dir by `chatgpt import-request` and read by `chatgpt conversation` and `chatgpt list`.
 *
 * It holds the five request headers {@link ChatgptSessionHeaders} names and the bearer's expiry, nothing
 * else from the paste. Importing REMOVES the paste it read, because the paste is a second copy of the same
 * cookie sitting wherever they saved it. No value is ever returned to a caller that prints.
 */
import { chmodSync, existsSync, readFileSync, unlinkSync } from "node:fs";
import { z } from "zod";
import { err, ok, type Result } from "#lib/result.js";
import { safeJsonParse } from "#lib/safeJson.js";
import { writeFileAtomic } from "#lib/writeAtomic.js";

import { secretFilePath, stateHomePaths } from "../../../stateHome.js";
import { type ChatgptError, ChatgptErrors } from "./errors.js";
import { bearerExpiryIso, type ChatgptSessionHeaders, parseRequestPaste } from "./paste.js";

/** The credential's file name under `$SLOPWEAVER_HOME/secrets` — the `secrets` register's row. */
export const CHATGPT_SESSION_FILE = "chatgpt-web-session.json";

const sessionSchema = z.object({
  bearerExpiresIso: z.string().nullable(),
  headers: z.object({
    authorization: z.string().min(1),
    "chatgpt-account-id": z.string().min(1),
    cookie: z.string().min(1),
    "oai-did": z.string().min(1),
    "user-agent": z.string().min(1),
  }),
  importedAtIso: z.string(),
  schemaVersion: z.literal(1),
});

/** The stored session. */
type ChatgptSession = z.infer<typeof sessionSchema>;

/** What an import reports: names and instants only, never a header value. */
export interface ChatgptImportReport {
  readonly path: string;
  readonly kept: readonly string[];
  readonly bearerExpiresIso: string | null;
  readonly removedSource: string;
}

/**
 * Import a DevTools paste into the session file, then remove the paste.
 *
 * The paste is removed only once the session file is written, so a failed write leaves the owner's paste
 * where it was rather than losing the one copy.
 *
 * @param home the Slopweaver home
 * @param from the paste file
 * @param nowIso the import instant recorded in the file
 * @returns what was kept and where, or the first failure
 */
export function importRequestPaste({
  home,
  from,
  nowIso,
}: {
  home: string;
  from: string;
  nowIso: string;
}): Result<ChatgptImportReport, ChatgptError> {
  let text: string;
  try {
    text = readFileSync(from, "utf8");
  } catch (error: unknown) {
    return err(ChatgptErrors.fileFailed({ cause: error, path: from }));
  }
  const headers = parseRequestPaste({ text });
  if (headers.isErr()) {
    return err(headers.error);
  }
  const bearerExpiresIso = bearerExpiryIso({ authorization: headers.value.authorization });
  const session: ChatgptSession = { bearerExpiresIso, headers: headers.value, importedAtIso: nowIso, schemaVersion: 1 };
  const path = secretFilePath({ home, name: CHATGPT_SESSION_FILE });
  try {
    writeFileAtomic({
      contents: `${JSON.stringify(session, null, 1)}\n`,
      dirMode: 0o700,
      fileMode: 0o600,
      path,
    });
    chmodSync(stateHomePaths({ home }).secrets, 0o700);
    chmodSync(path, 0o600);
    unlinkSync(from);
  } catch (error: unknown) {
    return err(ChatgptErrors.fileFailed({ cause: error, path }));
  }
  return ok({ bearerExpiresIso, kept: Object.keys(headers.value), path, removedSource: from });
}

/**
 * The stored session's request headers.
 *
 * @param home the Slopweaver home
 * @returns the headers, `SESSION_ABSENT` before any import, or `SESSION_MALFORMED`
 */
export function readSessionHeaders({ home }: { home: string }): Result<ChatgptSessionHeaders, ChatgptError> {
  return readStoredSession({ home }).map((session) => session.headers);
}

/**
 * The stored session: its request headers and the bearer's own expiry, which a verb prints as a caveat.
 *
 * @param home the Slopweaver home
 * @returns the session, `SESSION_ABSENT` before any import, or `SESSION_MALFORMED`
 */
export function readStoredSession({
  home,
}: {
  home: string;
}): Result<{ headers: ChatgptSessionHeaders; bearerExpiresIso: string | null }, ChatgptError> {
  const path = secretFilePath({ home, name: CHATGPT_SESSION_FILE });
  if (!existsSync(path)) {
    return err(ChatgptErrors.sessionAbsent({ path }));
  }
  let body: unknown;
  try {
    body = safeJsonParse({ label: CHATGPT_SESSION_FILE, text: readFileSync(path, "utf8") });
  } catch {
    // Never the parser's own message: V8 quotes the offending text, and that text is a cookie.
    return err(ChatgptErrors.sessionMalformed({ path, problems: ["not JSON"] }));
  }
  const parsed = sessionSchema.safeParse(body);
  if (!parsed.success) {
    return err(
      ChatgptErrors.sessionMalformed({ path, problems: parsed.error.issues.map((issue) => issue.path.join(".")) }),
    );
  }
  return ok({ bearerExpiresIso: parsed.data.bearerExpiresIso, headers: parsed.data.headers });
}
