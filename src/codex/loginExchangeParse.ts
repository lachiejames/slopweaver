/**
 * What a Codex sign-in ended as, read from the lines `./loginProgram.ts` printed — the pure half of a Connect.
 *
 * The program tags every provider line it forwards (`start`, `opened`, `completed`, `account`, `cancelsent`,
 * `cancelanswer`) and prints a `!<word>` marker for every way the exchange itself ended early. This module decides
 * the outcome from those alone, so every branch is a unit test and none needs an app-server.
 *
 * The JSON lines are the app-server's v2 protocol — `account/login/start` answering `{type, loginId, authUrl}`,
 * the `account/login/completed` notification carrying `{loginId, success, error}`, and `account/read` answering
 * `{account: {type, email, planType}}` — MEASURED against the vendored codex-cli in a throwaway
 * `CODEX_HOME` (start, cancel and the completion notification; a finished sign-in needs a person).
 */
import { z } from "zod";

import type { ConnectionFailure } from "../plans/connection.js";

/** Where a sign-in ended. */
export type CodexLoginOutcome =
  | {
      readonly kind: "connected";
      /** The address the signed-in account reports, or undefined when its read did not answer one. */
      readonly email: string | undefined;
    }
  | { readonly kind: "cancelled" }
  | { readonly kind: "failed"; readonly failure: ConnectionFailure; readonly detail?: string };

/** The JSON-RPC request ids the program and this parser agree on. */
const LOGIN_REQUEST_IDS = { account: 3, cancel: 4, initialize: 1, start: 2 } as const;

/** The first part of every sign-in page the program will open — the provider's own sign-in host. */
export const CODEX_SIGN_IN_PREFIX = "https://auth.openai.com/";

const errorWire = z.object({ message: z.string() });
const startWire = z.object({
  error: errorWire.optional(),
  result: z.object({ authUrl: z.string(), loginId: z.string(), type: z.string() }).partial().optional(),
});
const completedWire = z.object({
  params: z.object({ error: z.string().nullable().optional(), success: z.boolean() }),
});
const accountWire = z.object({
  result: z.object({ account: z.looseObject({ email: z.string().nullable().optional() }).nullable() }).optional(),
});

/** What each early-end marker means. */
const MARKERS: Readonly<Record<string, { readonly failure: ConnectionFailure; readonly detail?: string }>> = {
  browser: { failure: "BROWSER_FAILED" },
  deadline: { failure: "TIMED_OUT" },
  eof: { detail: "the Codex CLI stopped before the sign-in finished", failure: "EXITED" },
  open: { detail: "the Codex CLI could not be launched", failure: "EXITED" },
  overflow: { detail: "the Codex CLI wrote far more than a sign-in ever does", failure: "EXITED" },
  pagefile: { detail: "the sign-in page could not be recorded for the console", failure: "BROWSER_FAILED" },
  url: { failure: "URL_REFUSED" },
};

/** The markers that mean the attempt was cancelled rather than failed. */
const CANCEL_MARKERS: ReadonlySet<string> = new Set(["cancelled", "cancelquiet"]);

/** One provider line by its tag, parsed as JSON, or undefined when absent or not JSON. */
function tagged({ lines, tag }: { lines: readonly string[]; tag: string }): unknown {
  const prefix = `${tag}\t`;
  const line = lines.find((candidate) => candidate.startsWith(prefix));
  if (line === undefined) {
    return undefined;
  }
  try {
    return JSON.parse(line.slice(prefix.length));
  } catch {
    return undefined;
  }
}

/** The outcome a start answer forces, when it refused or handed over no page; undefined when it was fine. */
function startRefusal({ lines }: { lines: readonly string[] }): CodexLoginOutcome | undefined {
  const parsed = startWire.safeParse(tagged({ lines, tag: "start" }));
  if (!parsed.success) {
    return undefined;
  }
  if (parsed.data.error !== undefined) {
    return { detail: parsed.data.error.message, failure: "START_REFUSED", kind: "failed" };
  }
  const result = parsed.data.result;
  if (result?.authUrl === undefined || result.loginId === undefined) {
    return { detail: "Codex answered without a sign-in page", failure: "START_REFUSED", kind: "failed" };
  }
  return undefined;
}

/** The address an account answer reports, when it reports one. */
function accountEmail({ lines }: { lines: readonly string[] }): string | undefined {
  const parsed = accountWire.safeParse(tagged({ lines, tag: "account" }));
  if (!parsed.success) {
    return undefined;
  }
  const email = parsed.data.result?.account?.email;
  if (email == null || email.trim() === "") {
    return undefined;
  }
  return email.trim();
}

/**
 * Decide where a sign-in ended.
 *
 * @param lines every line the program printed, in order
 * @returns connected (with the address when the account read answered one), cancelled, or failed with a code
 */
export function parseCodexLoginExchange({ lines }: { lines: readonly string[] }): CodexLoginOutcome {
  const markers = lines.filter((line) => line.startsWith("!")).map((line) => line.slice(1).trim());
  if (lines.some((line) => line.startsWith("cancelsent\t")) || markers.some((word) => CANCEL_MARKERS.has(word))) {
    return { kind: "cancelled" };
  }
  const completed = completedWire.safeParse(tagged({ lines, tag: "completed" }));
  if (completed.success && completed.data.params.success) {
    return { email: accountEmail({ lines }), kind: "connected" };
  }
  if (completed.success) {
    // Codex's own words, carried verbatim and shown attributed ("Codex said: …"), never as Slopweaver's instruction.
    // Residue, stated: an app-server that put a terminal command in this field would have it quoted to
    // the owner. Slopweaver's own wording reaches a record only through closed clauses (`registerReason`); closing this
    // too would take a closed wording per provider failure, losing the provider's diagnosis.
    const said = completed.data.params.error;
    return {
      failure: "SIGN_IN_FAILED",
      kind: "failed",
      ...(said == null || said === "" ? {} : { detail: said }),
    };
  }
  const refused = startRefusal({ lines });
  if (refused !== undefined) {
    return refused;
  }
  const marker = markers.map((word) => MARKERS[word]).find((meaning) => meaning !== undefined);
  if (marker !== undefined) {
    return { kind: "failed", ...marker };
  }
  return { detail: "the Codex CLI ended without answering", failure: "EXITED", kind: "failed" };
}

/**
 * The JSON lines a sign-in sends, in the order the program sends them.
 *
 * @returns the handshake plus `account/login/start`, the `account/read` sent after success, and the cancel request
 *   as a Tcl `format` template whose one `%s` is the login id
 */
export function codexLoginRequests(): {
  readonly start: readonly string[];
  readonly account: string;
  readonly cancelTemplate: string;
} {
  return {
    account: JSON.stringify({ id: LOGIN_REQUEST_IDS.account, method: "account/read", params: { refreshToken: false } }),
    cancelTemplate: JSON.stringify({
      id: LOGIN_REQUEST_IDS.cancel,
      method: "account/login/cancel",
      params: { loginId: "%s" },
    }),
    start: [
      JSON.stringify({
        id: LOGIN_REQUEST_IDS.initialize,
        method: "initialize",
        params: { clientInfo: { name: "slopweaver", version: "0" } },
      }),
      JSON.stringify({ method: "initialized" }),
      JSON.stringify({ id: LOGIN_REQUEST_IDS.start, method: "account/login/start", params: { type: "chatgpt" } }),
    ],
  };
}
