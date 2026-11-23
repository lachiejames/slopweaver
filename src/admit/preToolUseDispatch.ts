/**
 * The ONE `PreToolUse` process, and the pure rule for combining what its checks say.
 *
 * ## What this replaced, and the measurement that forced it
 *
 * `hooks/hooks.json` registered TEN `PreToolUse` entries. Each named a shim in `scripts/`, each shim
 * resolved `tsx` and booted TypeScript over a `.ts` file in `hooks/`, and the harness runs every matching
 * entry in PARALLEL — so one `Bash` tool call started six TypeScript compiles, and twenty seats issuing
 * tool calls started a hundred and twenty. MEASURED: the chair sat 27
 * minutes on hook 6 of 7 and seven seats sat 50 minutes to 2h19m on the same line. Repro for the unit cost,
 * from the repo root — the ten entries are gone from the working tree, so the "before" side reads one out of
 * the last commit that carried them:
 *
 * ```bash
 * PAYLOAD='{"session_id":"t","tool_name":"Bash","tool_input":{"command":"echo hi"}}'
 * git show <last-commit-carrying-them>:hooks/pretooluse-admit.ts > /tmp/before.ts   # one of the ten, as it stood
 * echo "$PAYLOAD" | /usr/bin/time -p ./node_modules/.bin/tsx /tmp/before.ts
 * echo "$PAYLOAD" | /usr/bin/time -p ./node_modules/.bin/tsx hooks/pretooluse.ts
 * ```
 *
 * 0.28s wall / 0.25s CPU for one boot; 0.99s wall / **2.15s CPU** for the six a single `Bash` call fired.
 * The same entry bundled once by esbuild and run on plain `node` is 0.11s wall / **0.04s CPU**. The
 * contended resource is CPU, not wall clock, which is why one process from prebuilt JS is the fix and the
 * twenty-second timeout is only the ceiling.
 *
 * ## Three rules this file owns, each of which was a decision rather than an implementation detail
 *
 * **First block wins, and it SHORT-CIRCUITS.** Ten independent processes each decided the same call, so a
 * call refused by the admit door was still recorded by the poll gate as a poll that happened. It did not
 * happen. Running in order and stopping at the first refusal is a behaviour CHANGE and it is the correct
 * one — a check's side effects now only fire for a call that will really run. `docs/hooks/registered-and-bounded.md` names it.
 *
 * **One check's exception never decides another's verdict.** Each check declares the code an unhandled
 * error means FOR IT — 2 for the two that defend a boundary, 0 for the eight that are workflow tripwires —
 * and the dispatcher catches per check. Folding ten processes into one must not fold ten failure policies
 * into one, which is the single most dangerous thing about doing this at all.
 *
 * **Advisories MERGE into one document.** Ten processes could each print their own stdout because each had
 * its own; one process printing two JSON documents prints something no reader can parse. Only
 * `sessionDepthWarningRunner` writes stdout today, so this is a latent defect rather than a live one — and
 * it is exactly the kind that appears the day a second advisory is added, which is why the rule is here
 * rather than waiting for that day.
 */
import { isRecord } from "#lib/parsers.js";

/** The exit code Claude Code reads as "refuse this tool call and show the model stderr". */
export const EXIT_BLOCK = 2;

/** The exit code that lets the call through. */
export const EXIT_ALLOW = 0;

/**
 * One folded check: the guard that used to be its own `PreToolUse` entry.
 *
 * `appliesTo` carries what that entry's `matcher` carried, so folding changes which calls a check sees not
 * at all. `onUnhandledError` carries what its `hooks/pretooluse-*.ts` rejection handler carried.
 */
export interface PreToolUseCheck {
  /** The check's stable id — what the registry gate names, and what a refusal is attributed to. */
  readonly id: string;
  /** Whether this check ran for a tool call naming this tool, exactly as its old `matcher` decided. */
  readonly appliesTo: (input: { toolName: string }) => boolean;
  /** The exit code an unhandled error from {@link run} means, for THIS check alone. */
  readonly onUnhandledError: number;
  /**
   * Run the check over the raw payload, writing through the two captured sinks. `afterEmit` queues an effect that may
   * only happen once what the check wrote has really been printed — the sinks here only collect.
   */
  readonly run: (input: {
    raw: string;
    writeError: (line: string) => void;
    writeOut: (line: string) => void;
    afterEmit: (commit: () => void) => void;
  }) => Promise<number>;
}

/** What the dispatcher decided, and everything the process should print before it exits. */
export interface PreToolUseDispatchResult {
  /** The process's exit code. */
  readonly code: number;
  /** stderr, verbatim — the refusing check's own message, or nothing. */
  readonly stderr: string;
  /** stdout — one merged hook document, or nothing. */
  readonly stdout: string;
  /** Which check refused, or `undefined` when none did. Carried for the journal, never for the model. */
  readonly refusedBy: string | undefined;
  /**
   * What the checks whose output is printed queued through `afterEmit`, to run only AFTER `stderr` and `stdout` were
   * written in full. A refused run carries the refusing check's alone: a check that ran before it printed nothing.
   */
  readonly commits: readonly (() => void)[];
}

/**
 * Pull the `additionalContext` out of one stdout line a check wrote.
 *
 * A line that is not a hook document contributes nothing: this returns `null` rather than passing the line
 * through, because stdout here is a JSON channel and a stray line would corrupt the merged document for
 * every advisory beside it. A check with something to say to a human says it on stderr.
 *
 * @param line one line a check wrote to its stdout sink
 * @returns the advisory text, or `null` when the line carries none
 */
function advisoryIn({ line }: { line: string }): string | null {
  if (line.trim() === "") {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) {
    return null;
  }
  const output = parsed["hookSpecificOutput"];
  if (!isRecord(output)) {
    return null;
  }
  const context = output["additionalContext"];
  if (typeof context !== "string" || context === "") {
    return null;
  }
  return context;
}

/**
 * Merge every advisory the run collected into the ONE document a single process may print.
 *
 * @param lines every stdout line every check wrote, in check order
 * @returns the document with a trailing newline, or the empty string when nothing advised
 */
export function mergeHookStdout({ lines }: { lines: readonly string[] }): string {
  const advisories: string[] = [];
  for (const line of lines) {
    const advisory = advisoryIn({ line });
    if (advisory !== null) {
      advisories.push(advisory);
    }
  }
  if (advisories.length === 0) {
    return "";
  }
  return `${JSON.stringify({
    hookSpecificOutput: { additionalContext: advisories.join("\n\n"), hookEventName: "PreToolUse" },
  })}\n`;
}

/**
 * The structured refusal Claude Code shows the model INSTEAD of `[<hook command>]: <stderr>`.
 *
 * A hook that exits 2 is rendered `PreToolUse:Bash hook error: [<the whole hooks.json command>]: <stderr>`, and
 * ours is about 300 characters of `${PLUGIN_DATA:-…}` before the first word of the reason. A `permissionDecision:
 * "deny"` document on stdout is rendered `PreToolUse:Bash hook error: <reason>`, with no command at all — and it
 * wins even when the process also exits 2, so the exit code stays as the fail-closed backstop. MEASURED on Claude
 * Code 2.1.316, with a throwaway hook in a live session's `.claude/settings.local.json` printing each
 * shape for a sentinel command: exit 2 alone → bracketed; exit 0 + this document → bare reason; exit 2 + this
 * document + stderr → bare reason; a 12,000-character, 121-line reason passed through whole.
 *
 * The reason comes first; which check refused is folded after it, on its own line.
 *
 * @param reason the refusing check's own text, exactly as it wrote it to stderr
 * @param checkId the refusing check's id, named after the reason
 * @returns one newline-terminated hook document
 */
export function denyDocument({ reason, checkId }: { reason: string; checkId: string }): string {
  // Only the trailing newline goes, so the reason opens on exactly the bytes the check wrote to stderr. An empty
  // reason would render as a bare attribution line; say plainly that the check gave none.
  const stated = reason.trim() === "" ? "refused with no reason given" : reason.trimEnd();
  return `${JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: `${stated}\n\n(refused by the slopweaver ${checkId} check)`,
    },
  })}\n`;
}

/**
 * Run every check that applies to this tool call, in order, and combine what they said.
 *
 * @param checks the folded checks, in the order their `hooks.json` entries used to be registered
 * @param raw the raw `PreToolUse` payload, read from stdin ONCE and handed to every check
 * @param toolName the payload's `tool_name`, which decides which checks apply
 * @returns the exit code and everything the process should print
 */
export async function dispatchPreToolUse({
  checks,
  raw,
  toolName,
}: {
  checks: readonly PreToolUseCheck[];
  raw: string;
  toolName: string;
}): Promise<PreToolUseDispatchResult> {
  const outLines: string[] = [];
  const commits: (() => void)[] = [];
  for (const check of checks) {
    if (!check.appliesTo({ toolName })) {
      continue;
    }
    const errLines: string[] = [];
    const myOutLines: string[] = [];
    const myCommits: (() => void)[] = [];
    let code: number;
    try {
      code = await check.run({
        afterEmit: (commit) => myCommits.push(commit),
        raw,
        writeError: (line) => errLines.push(line),
        writeOut: (line) => myOutLines.push(line),
      });
    } catch (error: unknown) {
      code = check.onUnhandledError;
      // A check that threw did not finish what it queued an effect for, so nothing it queued runs.
      myCommits.length = 0;
      if (code !== EXIT_ALLOW && errLines.length === 0) {
        // A refusal with no reason is the defect `escape-hatch`'s own ruling names: an agent told only that
        // it is blocked cannot correct its approach. A thrown guard has no refusal text of its own, so the
        // dispatcher says which check died and that this is a failure rather than a verdict.
        errLines.push(`${check.id}: guard failed to run (${String(error)}) — refusing rather than skipping the gate\n`);
      }
    }
    if (code !== EXIT_ALLOW) {
      return { code, commits: myCommits, refusedBy: check.id, stderr: errLines.join(""), stdout: "" };
    }
    outLines.push(...myOutLines);
    commits.push(...myCommits);
  }
  return { code: EXIT_ALLOW, commits, refusedBy: undefined, stderr: "", stdout: mergeHookStdout({ lines: outLines }) };
}
