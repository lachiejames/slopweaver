/**
 * The browser-door guard's runner (effectful shell, testable): the `PreToolUse` check that refuses every
 * `mcp__claude-in-chrome__*` call, because the extension is retired outright.
 *
 * The decision is `./chromeRetirement.ts`'s; this file reads the hook payload, journals the verdict and
 * answers the exit code. There is no override and no second half: the refusal is categorical, so nothing
 * here consults a tab, a grant or a break-glass.
 *
 * ## This one fails CLOSED, unlike its main-checkout siblings
 *
 * The other `PreToolUse` guards allow on a payload they cannot parse, and they are right to: their matcher
 * is `Bash`, so failing closed would wedge every command in the session. This matcher is
 * `mcp__claude-in-chrome__.*`, so the whole cost of failing closed is that a retired call stops — and the
 * thing being guarded is a post under the owner's name with no door, no ledger and no preview. A guard that
 * shrugs at a payload it cannot read is not a guard, so an unreadable payload for a policed tool refuses.
 *
 * ## Every refusal is journalled
 *
 * One line per refused call in `ledgers/browser-verdicts.jsonl` (`./browserVerdictJournal.ts`), carrying the
 * tool and its `chrome-retired` reason code, read back with `slopweaver browser verdicts`.
 */
import { isRecord } from "../lib/parsers.js";
import { appendBrowserVerdict, browserVerdictRecord } from "./browserVerdictJournal.js";
import { CHROME_TOOL_PREFIX } from "./browserVerdictVocabulary.js";
import { retiredChromeCall } from "./chromeRetirement.js";

/** Exit code Claude Code reads as "this tool call is refused, show the stderr to the model". */
const EXIT_BLOCK = 2;
/** Exit code Claude Code reads as "carry on". */
const EXIT_ALLOW = 0;

/**
 * Pull the `session_id` a hook payload carries, falling back to a fixed key so a payload without one still
 * journals under a name rather than an empty string.
 *
 * @param payload the parsed hook payload
 * @returns the session id, or `"unknown-session"`
 */
function sessionIdOf({ payload }: { payload: Readonly<Record<string, unknown>> }): string {
  const id = payload["session_id"];
  return typeof id === "string" && id.length > 0 ? id : "unknown-session";
}

/**
 * Run the PreToolUse check: read the payload, refuse a Claude-in-Chrome call, and return the exit code.
 *
 * A tool this guard does not police (anything without the chrome prefix) allows immediately — the matcher
 * should never send one, and a hook that judged the wrong tool would be worse than one that judged none. It
 * is also the one exit that journals nothing: there was no verdict to record.
 *
 * @param readStdin reads the raw payload
 * @param writeError writes the refusal (to stderr in production)
 * @param home the Slopweaver home, injected so this is testable against a temp directory
 * @returns the exit code (2 block, 0 allow)
 */
export async function runBrowserDoorPreToolUse({
  readStdin,
  writeError,
  home,
}: {
  readStdin: () => Promise<string>;
  writeError: (line: string) => void;
  home?: string;
}): Promise<number> {
  const raw = await readStdin();
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    writeError(
      "browser-door: unreadable PreToolUse payload — refusing (this guard's matcher is browser-only, so failing closed costs browser calls and nothing else)\n",
    );
    return EXIT_BLOCK;
  }
  if (!isRecord(payload)) {
    writeError("browser-door: PreToolUse payload is not an object — refusing (fail closed)\n");
    return EXIT_BLOCK;
  }
  const toolName = payload["tool_name"];
  if (typeof toolName !== "string" || !toolName.startsWith(CHROME_TOOL_PREFIX)) {
    return EXIT_ALLOW;
  }
  const retired = retiredChromeCall({ toolName });
  if (retired === undefined) {
    // Unreachable while both tests are the same prefix; refused rather than allowed if they ever drift.
    writeError(`browser-door: ${toolName} carries the Claude-in-Chrome prefix but was not classified — refusing\n`);
    return EXIT_BLOCK;
  }
  appendBrowserVerdict({
    record: browserVerdictRecord({
      decision: retired,
      sessionId: sessionIdOf({ payload }),
      toolName,
      tsIso: new Date().toISOString(),
    }),
    ...(home === undefined ? {} : { home }),
  });
  writeError(`${retired.message}\n`);
  return EXIT_BLOCK;
}
