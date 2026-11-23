/**
 * The PreToolUse hook's runner (effectful core, testable). Reads the tool-call payload, evaluates it, and
 * returns the exit code (2 = block, 0 = allow). FAIL-CLOSED: a malformed payload blocks loudly rather than
 * silently allowing, and a thrown evaluation error is left to reject so the thin entry's top-level catch
 * exits 2 — no silent fail-open. `readStdin`/`env`/`writeError`/`evaluate` are injected so this is unit-tested.
 */
import { ARTIFACT_OVERRIDE_ENV } from "./artifactTool.js";
import { evaluateHookPayload } from "./hookPayload.js";
import { PYTHON_OVERRIDE_ENV } from "./pythonInvocation.js";
import { activeReachGrant, reachGrantsTaken } from "./reachGrant.js";
import { readReachGrants } from "./reachGrantStore.js";
import { readScriptSource } from "./scriptSourceReader.js";

/**
 * Read the reach-grant journal and answer both questions the classifier asks about one tool: is a grant
 * live, and how many has this session taken. One read serves both, so a compound command naming the same
 * tool twice does not re-open the file per segment.
 *
 * @param claudeSessionId the session the hook is judging
 * @param tool the production-facing tool the blocked segment names
 * @param nowIso the instant to judge expiry against
 * @returns whether a live grant opens that tool, and how many this session has taken for it
 */
function reachGrantState({
  claudeSessionId,
  tool,
  nowIso,
}: {
  claudeSessionId: string;
  tool: string;
  nowIso: string;
}): { granted: boolean; grantsTaken: number } {
  const grants = readReachGrants();
  return {
    granted: activeReachGrant({ claudeSessionId, grants, nowIso, tool }) !== undefined,
    grantsTaken: reachGrantsTaken({ claudeSessionId, grants, tool }),
  };
}

/**
 * Run the hook: read + parse the payload, evaluate, and return the exit code. Blocks (2) on a malformed
 * payload or a blocked command; allows (0) otherwise. A thrown `evaluate` error propagates (fail closed at
 * the entry). Scripts the command runs are opened through {@link readScriptSource} — the one disk read
 * this hook performs, and the reason a checked-in `gh` wrapper no longer walks past it by name.
 *
 * @param readStdin reads the raw payload
 * @param env the environment (for `SLOPWEAVER_ALLOW_RAW`, `SLOPWEAVER_ALLOW_PYTHON` and
 *   `SLOPWEAVER_ALLOW_ARTIFACT` — three independent hatches, none of which opens another)
 * @param writeError writes a diagnostic line (to stderr in production)
 * @param evaluate the pure payload evaluator (defaults to {@link evaluateHookPayload})
 * @param readScript the script reader (defaults to {@link readScriptSource}); inject a fake to test
 * @param nowIso the instant reach grants are judged expired against; injected so a test owns the clock
 * @returns the exit code (2 block, 0 allow)
 */
export async function runPreToolUseAdmit({
  readStdin: read,
  env,
  writeError,
  evaluate = evaluateHookPayload,
  readScript = readScriptSource,
  nowIso = new Date().toISOString(),
}: {
  readStdin: () => Promise<string>;
  env: Readonly<Record<string, string | undefined>>;
  writeError: (line: string) => void;
  evaluate?: typeof evaluateHookPayload;
  readScript?: typeof readScriptSource;
  nowIso?: string;
}): Promise<number> {
  let payload: unknown;
  try {
    payload = JSON.parse(await read());
  } catch {
    writeError("pretooluse-admit: malformed PreToolUse JSON payload — blocking (fail closed)\n");
    return 2;
  }
  const decision = evaluate({
    allowArtifact: env[ARTIFACT_OVERRIDE_ENV] === "1",
    allowPython: env[PYTHON_OVERRIDE_ENV] === "1",
    allowRaw: env["SLOPWEAVER_ALLOW_RAW"] === "1",
    env,
    payload,
    readReachGrantState: ({ claudeSessionId, tool }) => reachGrantState({ claudeSessionId, nowIso, tool }),
    readScript,
  });
  if (decision.block) {
    writeError(`${decision.message}\n`);
    return 2;
  }
  return 0;
}
