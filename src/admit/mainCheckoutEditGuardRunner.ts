/**
 * The main-checkout edit guard's runner (effectful core, testable). Reads the tool-call payload, evaluates
 * it, and returns the exit code (2 = block, 0 = allow). Supports Claude Code's direct `Edit`/`Write`
 * payload and Codex's canonical `apply_patch` payload; Codex matches the existing `Edit|Write` hook alias
 * but still reports `tool_name: "apply_patch"` and carries the patch in `tool_input.command`. FAILS OPEN on a
 * malformed or unrelated payload, same shape as the Bash dirty guard's runner — a broken toolchain or an
 * unrelated tool call must never wedge on this. `readStdin`/`writeError`/`evaluate` are injected so this is
 * unit-tested.
 */
import { isRecord } from "../lib/parsers.js";
import { MAIN_CHECKOUT_WRITE_OVERRIDE_ENV } from "./mainCheckoutDirtyGuard.js";
import { evaluateMainCheckoutEditGuard } from "./mainCheckoutEditGuard.js";

/** Claude Code's direct file-write tools. Codex reports the separate canonical `apply_patch` name. */
const DIRECT_EDIT_TOOLS = new Set(["Edit", "Write"]);

/**
 * Extract every target path named by Codex's `apply_patch` grammar. Move patches name both the original
 * `Update File` target and the `Move to` destination, and both must be evaluated: either side can cross the
 * main-checkout boundary. Unknown patch directives are ignored rather than guessed.
 *
 * @param command the `tool_input.command` patch text
 * @returns target paths in patch order
 */
export function codexApplyPatchPaths({ command }: { command: string }): readonly string[] {
  const paths: string[] = [];
  for (const line of command.split(/\r?\n/)) {
    const match = /^\*\*\* (?:(?:Add|Update|Delete) File|Move to): (.+)$/.exec(line);
    const path = match?.[1]?.trim();
    if (path !== undefined && path.length > 0) {
      paths.push(path);
    }
  }
  return paths;
}

/**
 * Resolve one supported hook payload to the file paths it targets.
 *
 * @param toolName the hook's canonical tool name
 * @param input the hook's tool-specific input object
 * @returns target paths, or an empty list when the payload is unsupported or malformed
 */
function targetPaths({
  toolName,
  input,
}: {
  toolName: string;
  input: Readonly<Record<string, unknown>>;
}): readonly string[] {
  if (DIRECT_EDIT_TOOLS.has(toolName)) {
    return typeof input["file_path"] === "string" ? [input["file_path"]] : [];
  }
  if (toolName === "apply_patch") {
    return typeof input["command"] === "string" ? codexApplyPatchPaths({ command: input["command"] }) : [];
  }
  return [];
}

/**
 * Run the guard: read + parse the payload, evaluate, and return the exit code. Allows (0) on anything
 * malformed, an unguarded tool, or missing the fields this needs — blocks (2) when any direct edit or patch
 * target resolves inside the main checkout.
 *
 * @param readStdin reads the raw payload
 * @param env the environment (for {@link MAIN_CHECKOUT_WRITE_OVERRIDE_ENV})
 * @param writeError writes a diagnostic line (to stderr in production)
 * @param evaluate the payload evaluator (defaults to {@link evaluateMainCheckoutEditGuard})
 * @returns the exit code (2 block, 0 allow)
 */
export async function runMainCheckoutEditGuard({
  readStdin: read,
  env,
  writeError,
  evaluate = evaluateMainCheckoutEditGuard,
}: {
  readStdin: () => Promise<string>;
  env: Readonly<Record<string, string | undefined>>;
  writeError: (line: string) => void;
  evaluate?: typeof evaluateMainCheckoutEditGuard;
}): Promise<number> {
  let payload: unknown;
  try {
    payload = JSON.parse(await read());
  } catch {
    return 0; // fail open: a malformed payload should never wedge an unrelated tool call
  }
  if (!isRecord(payload)) {
    return 0;
  }
  const toolName = payload["tool_name"];
  if (typeof toolName !== "string") {
    return 0;
  }
  const input = payload["tool_input"];
  const cwd = payload["cwd"];
  if (!isRecord(input) || typeof cwd !== "string") {
    return 0;
  }
  const filePaths = targetPaths({ input, toolName });
  const allowOverride = env[MAIN_CHECKOUT_WRITE_OVERRIDE_ENV] === "1";
  for (const filePath of filePaths) {
    const decision = evaluate({ allowOverride, cwd, filePath });
    if (decision.block) {
      writeError(`${decision.message}\n`);
      return 2;
    }
  }
  return 0;
}
