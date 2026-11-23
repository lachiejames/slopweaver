/**
 * The dispatcher's effectful shell: read stdin ONCE, find the tool name, run the registry, print what the
 * pure rule decided.
 *
 * Reading stdin once is not an optimisation, it is the only thing a single process CAN do — ten processes
 * each got their own copy of the payload from the harness, and one process has one pipe. Every check is
 * handed the same raw string through `readStdin: () => Promise.resolve(raw)`, which is exactly the seam
 * each of them already declared for its own tests.
 *
 * ## The one thing the dispatcher itself judges: a payload no check could read
 *
 * An unparseable payload, one that is not an object, or one carrying no `tool_name` is not a tool call any
 * check can decide — `appliesTo` is a question about a tool name, so with no tool name the registry is
 * empty and a silent exit 0 would be the gate reporting that it passed when it never ran.
 *
 * So this BLOCKS, taking `pretooluseAdmit`'s own reasoning verbatim: a door that cannot read what it is
 * being asked about must not wave it through. That is stricter than eight of the ten entries were
 * individually — each of them exited 0 on a payload it could not parse — and it has to be, because those
 * eight were exiting 0 next to a ninth that was exiting 2 on the same payload, and the harness took the
 * refusal. One process cannot be both, and the refusal is the one that was winning.
 *
 * ## `--only <id>`, and why a fold needs it
 *
 * The plugin mirror (`scripts/plugin-mirror-sync.sh`) is ONE tree shared by every worktree on the machine,
 * and a seat runs the `hooks.json` ITS OWN checkout carried against whatever that mirror currently holds. So
 * for as long as `main` names ten script paths, those ten paths have to keep working — MEASURED, a sync from this branch removed them and seven seats on `main` lost every PreToolUse guard at once,
 * failing non-blocking, with no symptom on any of them.
 *
 * `--only` is what makes both layouts safe against either mirror: each old path survives as a one-line shim
 * that runs this dispatcher with its own check and no other. A main seat then gets ten processes doing one
 * check each — no CPU win for that seat, and the same verdicts it always had — while a seat on the folded
 * `hooks.json` gets one process doing all ten. Running the WHOLE registry from each of ten shims would have
 * been the obvious spelling and is a defect: ten poll-gate passes over one tool call means the second
 * process refuses the call the first one recorded.
 *
 * The shims are migration scaffolding with a named end: they go when `main`'s `hooks.json` is the folded one.
 */
import { errorMessage } from "#lib/errorMessage.js";
import { isRecord } from "#lib/parsers.js";

import { preToolUseChecks } from "./preToolUseChecks.js";
import {
  denyDocument,
  dispatchPreToolUse,
  EXIT_ALLOW,
  EXIT_BLOCK,
  type PreToolUseCheck,
} from "./preToolUseDispatch.js";

/** What a refusal the dispatcher makes for ITSELF — a payload no check could read — is attributed to. */
const DISPATCHER_CHECK_ID = "pretooluse-dispatch";

/**
 * The check ids `--only` names, in the order they appear on the command line.
 *
 * Unknown flags are IGNORED rather than refused: this argv comes from a shim in a mirrored tree that may be
 * older or newer than the code reading it, and a hook that dies on an argument it does not recognise is the
 * fail-open-by-crash shape this whole change exists to remove.
 *
 * @param argv the process arguments after the script name
 * @returns the ids named, or `null` when `--only` was not given at all
 */
export function onlyChecksIn({ argv }: { argv: readonly string[] }): readonly string[] | null {
  const ids: string[] = [];
  let sawFlag = false;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] !== "--only") {
      continue;
    }
    sawFlag = true;
    const id = argv[i + 1];
    if (id !== undefined && !id.startsWith("--")) {
      ids.push(id);
    }
  }
  return sawFlag ? ids : null;
}

/**
 * Read the tool name out of a raw payload, or the reason no check could decide it.
 *
 * @param raw the payload exactly as stdin carried it
 * @returns the tool name, or the fail-closed refusal reason
 */
function payloadToolName({
  raw,
}: {
  raw: string;
}): { readonly kind: "read"; readonly toolName: string } | { readonly kind: "unread"; readonly reason: string } {
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch (error: unknown) {
    return {
      kind: "unread",
      reason: `pretooluse: malformed PreToolUse JSON payload (${errorMessage({ error })}) — blocking (fail closed)\n`,
    };
  }
  if (!isRecord(payload)) {
    return { kind: "unread", reason: "pretooluse: PreToolUse payload is not an object — blocking (fail closed)\n" };
  }
  const toolName = payload["tool_name"];
  if (typeof toolName !== "string") {
    return { kind: "unread", reason: "pretooluse: PreToolUse payload names no tool — blocking (fail closed)\n" };
  }
  return { kind: "read", toolName };
}

/**
 * Run every applicable check over one `PreToolUse` payload and print the combined verdict.
 *
 * @param readStdin reads the raw payload, once
 * @param env the process environment, handed to every check that reads a hatch
 * @param writeError writes stderr (the refusing check's own message), every byte before it returns
 * @param writeOut writes stdout (the merged advisory document), every byte before it returns
 * @param argv the process arguments, read for `--only <id>`
 * @param checks the registry; injected so a test owns it without a mock
 * @returns the process exit code
 */
export async function runPreToolUseDispatch({
  readStdin,
  env,
  writeError,
  writeOut,
  argv = [],
  checks = preToolUseChecks({ env }),
}: {
  readStdin: () => Promise<string>;
  env: Record<string, string | undefined>;
  writeError: (line: string) => void;
  writeOut: (line: string) => void;
  argv?: readonly string[];
  checks?: readonly PreToolUseCheck[];
}): Promise<number> {
  const only = onlyChecksIn({ argv });
  const selected = only === null ? checks : checks.filter((check) => only.includes(check.id));
  const raw = await readStdin();
  const read = payloadToolName({ raw });
  // A refusal goes out TWICE on purpose: the deny document is what Claude Code actually renders — the reason first, with
  // no 300-character hook command in front of it (`denyDocument`) — and stderr with exit 2 is the fail-closed backstop a
  // host that ignores stdout still honours. The document is written FIRST, so a stderr sink that throws cannot suppress
  // it. Only exit 2 is a refusal: another non-zero code is a non-blocking hook error to the host, and dressing it as a
  // deny would turn a warning into a block.
  if (read.kind === "unread") {
    writeOut(denyDocument({ checkId: DISPATCHER_CHECK_ID, reason: read.reason }));
    writeError(read.reason);
    return EXIT_BLOCK;
  }
  const result = await dispatchPreToolUse({ checks: selected, raw, toolName: read.toolName });
  if (result.code === EXIT_BLOCK && result.refusedBy !== undefined) {
    writeOut(denyDocument({ checkId: result.refusedBy, reason: result.stderr }));
  } else if (result.stdout !== "") {
    writeOut(result.stdout);
  }
  if (result.stderr !== "") {
    writeError(result.stderr);
  }
  // Only now, with both writes returned: production's sinks write every byte before returning (`hooks/pretooluse.ts`),
  // so a commit — the `profile-held` delivery marker — never vouches for output that did not leave this process. A
  // sink that throws (the harness closed the pipe) skips them all, and the session stays unmarked.
  for (const commit of result.commits) {
    commit();
  }
  if (result.code === EXIT_ALLOW) {
    return EXIT_ALLOW;
  }
  return result.code;
}
