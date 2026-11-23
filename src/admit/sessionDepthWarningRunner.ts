/**
 * The session depth advisory's runner: read the `PreToolUse` payload, measure how deep this session is, and
 * inject the advisory when it is past the line.
 *
 * It ALWAYS exits 0. There is no refusal path, no exit code 2 and no stderr writer, because the rule this
 * implements removed blocking entirely (`../sessions/sessionDepthAwareness.ts` carries the reason). A hook
 * that can only ever add context is one that cannot wedge a session, which is why the fail-open reasoning
 * that governed its blocking predecessor is now a property of the shape rather than a promise in a comment.
 *
 * It is also no longer scoped to anyone. The gate this replaces returned early unless
 * `sessions/supervisor-pin.json` named the calling session, which left every worker untouched — and
 * MEASURED: the pinned supervisor accounted for 11.2% of all above-600k spend while the sessions
 * the gate never spoke to accounted for the other 88.8%. Reproduce with `slopweaver session depth --json`.
 *
 * Every reader is injected, so the whole decision path is unit-tested without a mock.
 */
import { homedir } from "node:os";
import { join } from "node:path";

import { isRecord } from "../lib/parsers.js";
import { readContextDepth, readContextDepthAt } from "../sessions/depthStore.js";
import { evaluateSessionDepthAwareness } from "../sessions/sessionDepthAwareness.js";
import { EXIT_ALLOW } from "./preToolUseDispatch.js";

/**
 * This session's context depth, preferring the transcript the payload already named.
 *
 * @param transcriptPath `transcript_path` from the payload, when it carried one
 * @param sessionId `session_id` from the payload, the fallback route through `~/.claude/projects`
 * @returns the depth, or `undefined` when it could not be measured (which stays silent)
 */
function measureDepth({
  transcriptPath,
  sessionId,
}: {
  transcriptPath: string | undefined;
  sessionId: string;
}): number | undefined {
  const measured =
    transcriptPath === undefined
      ? readContextDepth({ projectsDir: join(homedir(), ".claude", "projects"), sessionId })
      : readContextDepthAt({ path: transcriptPath });
  return measured.known ? measured.value.depthTokens : undefined;
}

/**
 * Run the advisory over one `PreToolUse` payload.
 *
 * @param readStdin reads the raw payload
 * @param writeOut writes the hook's stdout (the JSON that injects the advisory into the model's context)
 * @param readDepth measures this session's depth (defaults to the real transcript read)
 * @returns the exit code, which is always {@link EXIT_ALLOW}
 */
export async function runSessionDepthWarning({
  readStdin: read,
  writeOut,
  readDepth = measureDepth,
}: {
  readStdin: () => Promise<string>;
  writeOut: (line: string) => void;
  readDepth?: (input: { transcriptPath: string | undefined; sessionId: string }) => number | undefined;
}): Promise<number> {
  let payload: unknown;
  try {
    payload = JSON.parse(await read());
  } catch {
    return EXIT_ALLOW;
  }
  if (!isRecord(payload) || payload["tool_name"] !== "Bash") {
    return EXIT_ALLOW;
  }
  const sessionId = payload["session_id"];
  if (typeof sessionId !== "string") {
    return EXIT_ALLOW;
  }
  const transcriptPath = payload["transcript_path"];
  const decision = evaluateSessionDepthAwareness({
    depthTokens: readDepth({
      sessionId,
      transcriptPath: typeof transcriptPath === "string" ? transcriptPath : undefined,
    }),
  });
  if (decision.kind === "warn") {
    writeOut(
      `${JSON.stringify({
        hookSpecificOutput: { additionalContext: decision.context, hookEventName: "PreToolUse" },
      })}\n`,
    );
  }
  return EXIT_ALLOW;
}
