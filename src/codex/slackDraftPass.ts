/**
 * One bounded, SEALED Codex pass that drafts the as-me message beside the original (`./slackDraft.ts` says what it is
 * asked and why it is blind to the original).
 *
 * Sealed, because the pass composes from its prompt alone: a read-only sandbox, no network and no web search
 * (`./client.ts` `SEALED_POLICY`), over a throwaway working directory under the OS temp root that is removed when the
 * pass returns. The sandbox's reads are unbounded and the original is already parked, so a pass that used any tool
 * yields no draft (`./slackDraft.ts` `draftPassReached`). The sandbox writes nothing into it, so a process killed mid-pass, which no `finally` survives, leaves
 * only the empty directory. Nothing is written to an orchestration artifact — the prompt carries a Slack conversation
 * and the owner's voice brief, and the one durable record of the pass is the register's `compared` event. What still leaves
 * the machine is the prompt itself, to OpenAI under the routed account, and the routed home keeps its session file
 * (`docs/security/codex-boundary.md`, which also names the MCP-server process this does not bound).
 */
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { makePassBound } from "./bounds.js";
import type { LockedCodexClient } from "./client.js";
import { type DeadlineRuntime, runBoundedPass } from "./runPass.js";
import {
  draftPassReached,
  parseSlackDraftAnswer,
  SLACK_DRAFT_OUTPUT_SCHEMA,
  type SlackDraftBrief,
  slackDraftPrompt,
} from "./slackDraft.js";
import type { CodexEventSink } from "./types.js";

/**
 * How long the pass may take. A record waits on it after the original has parked, inside a session's own tool call,
 * so it is short: a draft from a prompt needs no investigation, and a pass that runs out leaves the row `pending` for
 * `slack draft compare` rather than holding the recording session. Exported so the routing that reserves this pass's
 * weekly point dates the reservation off the same bound the pass runs under.
 */
export const SLACK_DRAFT_PASS_SECONDS = 90;

/** What one pass produced: Codex's draft form, or why there is none. */
export type CodexDraftAnswer =
  | { readonly kind: "answered"; readonly form: string; readonly requestedModel: string; readonly elapsedMs: number }
  | { readonly kind: "unavailable"; readonly reason: string };

/**
 * Why a pass's workspace is no longer the empty directory it was handed, or `undefined` when it still is. Codex loads
 * an `AGENTS.md` from its workspace before the prompt, so a file another process wrote there between creation and the
 * pass could carry A without a tool ever running. A writer that also removes its file
 * before the pass ends is not seen: a hostile process on the owner's machine is the stated residue.
 *
 * @param directory the pass's working directory
 * @returns why no B may come of the pass, or `undefined`
 */
export function workspaceTouched({ directory }: { directory: string }): string | undefined {
  const entries = readdirSync(directory);
  if (entries.length === 0) {
    return undefined;
  }
  return `the pass's empty workspace held ${String(entries.length)} file(s) by its end, which Codex may have read`;
}

/**
 * Run the pass.
 *
 * @param brief what the recording session was handed
 * @param client the routed, sealed client
 * @param runtime the clock and timers the bound runs on
 * @param onEvent receives each step, for the progress line on stderr
 * @returns Codex's draft form, or why there is none
 */
export async function runSlackDraftPass({
  brief,
  client,
  runtime,
  onEvent,
}: {
  brief: SlackDraftBrief;
  client: LockedCodexClient;
  runtime: DeadlineRuntime;
  onEvent?: CodexEventSink | undefined;
}): Promise<CodexDraftAnswer> {
  const bound = makePassBound({ boundSeconds: SLACK_DRAFT_PASS_SECONDS });
  if (bound.isErr()) {
    return { kind: "unavailable", reason: bound.error.message };
  }
  const workingDirectory = mkdtempSync(join(tmpdir(), "sw-draft-"));
  try {
    const result = await runBoundedPass({
      bound: bound.value,
      client,
      onEvent,
      outputSchema: SLACK_DRAFT_OUTPUT_SCHEMA,
      prompt: slackDraftPrompt({ brief }),
      repoRoot: workingDirectory,
      runtime,
      validate: parseSlackDraftAnswer,
      workingDirectory,
    });
    const { outcome } = result;
    const reached = draftPassReached({ attempts: result.attempts });
    if (outcome.kind === "answered" && reached !== undefined) {
      return { kind: "unavailable", reason: reached };
    }
    const touched = workspaceTouched({ directory: workingDirectory });
    if (outcome.kind === "answered" && touched !== undefined) {
      return { kind: "unavailable", reason: touched };
    }
    if (outcome.kind === "answered") {
      return {
        elapsedMs: result.observedElapsedMs,
        form: outcome.answer.form,
        kind: "answered",
        requestedModel: client.model,
      };
    }
    if (outcome.kind === "no-verdict") {
      return { kind: "unavailable", reason: `Codex gave no usable draft (${outcome.reason})` };
    }
    // What the transport reported when it said anything, else what it threw.
    if (outcome.cause.reported !== null) {
      return { kind: "unavailable", reason: `the Codex transport failed: ${outcome.cause.reported}` };
    }
    return { kind: "unavailable", reason: `the Codex transport failed: ${outcome.cause.thrown}` };
  } finally {
    rmSync(workingDirectory, { force: true, recursive: true });
  }
}
