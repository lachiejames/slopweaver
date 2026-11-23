/**
 * Which Codex account this machine is signed in as, read WITHOUT ever holding a token.
 *
 * ## What this file will not do — stated exactly, because a looser version of it was false
 *
 * `$CODEX_HOME/auth.json` holds live OAuth material — an `id_token`, an access token, a refresh token. No
 * token value LEAVES this module: {@link CodexAuthReport} has no field that can hold one, nothing here
 * returns, logs, renders or interpolates one, and {@link renderCodexAuth} can only print booleans and
 * `auth_mode`.
 *
 * **Nothing here EXTRACTS a value, and the two jobs are split to keep that true.** `readJsonFile` used to do
 * both, and two Codex reviews in a row said what that means: `JSON.parse` builds every value in the document,
 * so the access token and the refresh token became live strings in a retained object graph any later reader
 * could print. Narrowing the header's claim to "nothing escapes" did not change the code, and the second
 * review said so.
 *
 * So the work is divided. **Validity** — is this JSON at all, which is the whole content of the
 * `readable: false` promise — comes from the platform's own `JSON.parse`, whose result is discarded on the
 * spot and never bound, inspected or returned. Three further review rounds proved why: every re-derivation of
 * the JSON grammar in `./authScan.ts` left a hole (a bare token, a nested bare token, a trailing comma), and
 * writing a third JSON parser to avoid the one the platform ships is how that list keeps growing.
 * **Content** — which keys are present, and the `auth_mode` value — comes from `./authScan.ts`, which walks
 * the text and SKIPS values by index. It captures a value only for a key named here as non-sensitive.
 *
 * What remains true and is not glossed: the document's bytes sit in a read buffer, and the parser materialises
 * its values for the duration of one call — exactly as for anything that opens the file at all, the Codex CLI
 * included. What does not happen is extraction: no credential value is located, kept, bound to a name,
 * returned, rendered, logged or stored.
 *
 * That is the same line `src/claude/gaugeProbe.ts` draws for Claude credentials, and the stakes are lower
 * here because a Codex token has nowhere legitimate to go: Slopweaver never presents one, it shells `codex`,
 * which reads the file itself.
 *
 * ## Presence is not validity, and the report says so
 *
 * A readable `auth.json` with an `access_token` key proves a sign-in HAPPENED. It proves nothing about
 * whether the token still works — that is a question only the provider can answer, and answering it would
 * mean spending a real Codex turn. So this reports what the file says and labels it as exactly that;
 * `codex signin` never claims a session is live.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { absentAs } from "#lib/absent.js";
import { keyShape, scanJsonShape } from "./authScan.js";

/** What `$CODEX_HOME/auth.json` says, with nothing sensitive in it. */
export interface CodexAuthReport {
  /** The file this was read from — a path, useful to a reader and carrying no secret. */
  readonly path: string;
  /** Whether the file was there and parsed at all. */
  readonly readable: boolean;
  /** `auth_mode` verbatim — `chatgpt` on this machine — or undefined when absent or not a string. */
  readonly authMode: string | undefined;
  /** Whether a `tokens` object is present with at least one key. NEVER which keys, and never their values. */
  readonly hasTokens: boolean;
  /**
   * Whether an `OPENAI_API_KEY` is configured in the file.
   *
   * Answered from the key's PRESENCE and whether its value is the literal `null` — no property of the value
   * itself, not even its length, is inspected, and the value is never assembled.
   */
  readonly hasApiKey: boolean;
}

/**
 * The one top-level key whose value this module reads as text.
 *
 * Named, and passed to the scanner, so that "which values may be captured" is a declaration at the top of
 * the file rather than a property of whichever branch happens to run. `auth_mode` is `chatgpt` or `apikey` —
 * a mode, not a secret.
 */
const NON_SENSITIVE_KEYS: ReadonlySet<string> = new Set(["auth_mode"]);

/**
 * The auth file's text, or undefined when it cannot be read.
 *
 * Bounded by nothing but the file itself, which Codex writes and keeps small; a missing file is an ordinary
 * state that must not throw, because reporting an absent sign-in is what the verb is for.
 *
 * @param path the auth file to read
 * @returns the file's contents, or undefined when it is missing or unreadable
 */
function authText({ path }: { path: string }): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}

/**
 * Whether the document is valid JSON — decided by the platform's own parser, whose result is DISCARDED.
 *
 * The division of labour here is the point, and it is what four review rounds converged on. `readable: false`
 * for an unparseable file is a claim about the JSON GRAMMAR, and every attempt to re-derive that grammar in
 * {@link ./authScan} left a hole a reviewer then found: a bare token, then a nested bare token, then a
 * trailing comma. Writing a third JSON parser to avoid the one the platform ships is how that list keeps
 * growing. So validity comes from `JSON.parse` and NOTHING ELSE does: the parsed value is never bound to a
 * name, never inspected, never returned — every reported field comes from the value-free scan that follows.
 *
 * The residue is the same one this module's header already states, and no smaller: the parser materialises
 * the document's values for the duration of the call, exactly as any reader of the file does. What does not
 * happen is extraction — no value is located, kept, returned, rendered, logged or stored.
 *
 * @param text the whole document
 * @returns true when the platform parser accepts it
 */
function isWellFormedJson({ text }: { text: string }): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Read the Codex auth file's shape.
 *
 * @param codexHome the Codex home to read (see {@link ../codex/quotaLog.resolveCodexHome})
 * @returns what the file says, with `readable: false` when it is missing or unparseable — never a throw,
 *   because an absent sign-in is an ordinary state this verb exists to report
 */
export function readCodexAuth({ codexHome }: { codexHome: string }): CodexAuthReport {
  const path = join(codexHome, "auth.json");
  const text = authText({ path });
  if (text === undefined) {
    return { authMode: undefined, hasApiKey: false, hasTokens: false, path, readable: false };
  }
  if (!isWellFormedJson({ text })) {
    return { authMode: undefined, hasApiKey: false, hasTokens: false, path, readable: false };
  }
  const scan = scanJsonShape({ captureText: NON_SENSITIVE_KEYS, text });
  if (!scan.wellFormed) {
    return { authMode: undefined, hasApiKey: false, hasTokens: false, path, readable: false };
  }
  const apiKey = keyShape({ key: "OPENAI_API_KEY", scan });
  return {
    authMode: keyShape({ key: "auth_mode", scan }).text,
    // Presence, minus the explicit null. Nothing about the value itself — not its length — is inspected, and
    // the scanner walked its characters by index rather than assembling them.
    hasApiKey: apiKey.present && !apiKey.isNull,
    hasTokens: keyShape({ key: "tokens", scan }).nonEmptyContainer,
    path,
    readable: true,
  };
}

/**
 * Render the auth report as lines.
 *
 * @param report what {@link readCodexAuth} found
 * @returns the lines to print, always ending in the sentence that stops presence being read as validity
 */
export function renderCodexAuth({ report }: { report: CodexAuthReport }): readonly string[] {
  if (!report.readable) {
    return [
      `codex signin: no readable auth at ${report.path}`,
      "  Sign in from Settings → Models in the console, or with `codex login` in your own terminal —",
      "  Slopweaver never handles a Codex token; the Codex CLI owns that file.",
    ];
  }
  return [
    `codex signin: auth present at ${report.path}`,
    `  mode: ${absentAs({ value: report.authMode, whenAbsent: "unnamed" })}`,
    `  oauth tokens: ${report.hasTokens ? "present" : "absent"}`,
    `  api key: ${report.hasApiKey ? "configured" : "not configured"}`,
    "  This says a sign-in HAPPENED. Whether it is still accepted is a question only the provider answers,",
    "  and answering it would cost a real Codex turn — so nothing here claims the session is live.",
  ];
}
