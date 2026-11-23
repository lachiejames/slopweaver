/**
 * The memory write gate's runner: read the `PreToolUse` payload, decide it, and return the exit code
 * (2 = block, 0 = allow).
 *
 * FAILS OPEN on everything it cannot resolve — a malformed payload, a missing path, a missing text field.
 * That is not a hole in the gate: the name and wikilink criteria are fully decidable from the payload, so
 * there is no "unresolvable but actually bad" case. The overlap nomination reads the corpus and the canon too,
 * and fails open PER HALF: an unreadable corpus nominates no memory, a payload with no `cwd` no canon section. What failing open buys is that a bug here cannot wedge every file
 * write in every session at once, which is what an `Edit|Write` matcher makes possible.
 *
 * Every reader is injected, so the whole decision path is unit-tested without a mock — same shape as
 * `./agentToolBanGuardRunner.ts`.
 */
import { isRecord } from "../lib/parsers.js";
import type { CanonSection } from "../memory/overlapNomination.js";
import type { MemoryLeaf } from "../memory/types.js";
import { memoryWriteRefusal, memoryWriteTextField } from "./memoryWriteGuard.js";
import { EXIT_ALLOW, EXIT_BLOCK } from "./preToolUseDispatch.js";

/** The ambient variable this gate's register row names. */
const HATCH_ENV = "SLOPWEAVER_ALLOW_MEMORY_WRITE";

/**
 * The four fields of a `tool_input` this gate reads, or `null` when the payload does not carry a write it
 * can judge.
 *
 * `old_string` and `replace_all` are the `Edit` tool's own field names. A `Write` carries neither, and
 * their absence is exactly the `null`/`false` the whole-file path wants, so there is nothing to branch on.
 *
 * @param input the payload's `tool_input`
 * @param field which key carries the written text for this tool
 * @returns the target path, the written text, and the `Edit` half; `null` when either required field is
 *   missing or not a string
 */
function writtenTextIn({
  input,
  field,
}: {
  input: Record<string, unknown>;
  field: string;
}): { filePath: string; text: string; replacedText: string | null; replaceAll: boolean } | null {
  const filePath = input["file_path"];
  const text = input[field];
  if (typeof filePath !== "string" || typeof text !== "string") {
    return null;
  }
  const replaced = input["old_string"];
  return {
    filePath,
    replaceAll: input["replace_all"] === true,
    replacedText: typeof replaced === "string" ? replaced : null,
    text,
  };
}

/**
 * What one raw `PreToolUse` payload asks to write, or `null` for anything that is not a memory-shaped write —
 * a malformed payload included, because a gate that fails open must never wedge a tool call.
 */
function memoryWritePayload({ raw }: { raw: string }): {
  toolName: string;
  cwd: unknown;
  written: NonNullable<ReturnType<typeof writtenTextIn>>;
} | null {
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(payload)) {
    return null;
  }
  const toolName = payload["tool_name"];
  const input = payload["tool_input"];
  if (typeof toolName !== "string" || !isRecord(input)) {
    return null;
  }
  const field = memoryWriteTextField({ toolName });
  if (field === undefined) {
    return null;
  }
  const written = writtenTextIn({ field, input });
  return written === null ? null : { cwd: payload["cwd"], toolName, written };
}

/**
 * Run the gate over one `PreToolUse` payload.
 *
 * @param readStdin reads the raw payload
 * @param writeError writes the refusal (stderr in production)
 * @param env the environment the escape hatch is read from
 * @param userHome the current user's home directory, which scopes the auto-memory path predicate
 * @param holdsRootIndex answers "does this directory hold a `MEMORY.md`" — one of the gate's two filesystem
 *   questions, asked only for a `.md` written into a directory named `memory`
 * @param readLeaf reads a memory leaf's current content, `null` when there is none — the other, asked only
 *   once the path is known to be a leaf, so that an `Edit` is judged against the file it edits
 * @param readSiblings reads every leaf of the corpus directory the write lands in, for the overlap nomination —
 *   asked only once the path is known to be a leaf, and an empty list when the directory cannot be read
 * @param readCanon reads the always-on canon sections of the repository holding the payload's `cwd` — asked
 *   under the same condition, and never when the payload carries no `cwd`
 * @returns the exit code (2 block, 0 allow)
 */
export async function runMemoryWriteGuard({
  readStdin,
  writeError,
  env,
  userHome,
  holdsRootIndex,
  readLeaf,
  readSiblings,
  readCanon,
}: {
  readStdin: () => Promise<string>;
  writeError: (line: string) => void;
  env: Record<string, string | undefined>;
  userHome: string;
  holdsRootIndex: (args: { dir: string }) => boolean;
  readLeaf: (args: { path: string }) => string | null;
  readSiblings: (args: { dir: string }) => readonly MemoryLeaf[];
  readCanon: (args: { cwd: string }) => readonly CanonSection[];
}): Promise<number> {
  let raw: string;
  try {
    raw = await readStdin();
  } catch {
    return EXIT_ALLOW; // fail open: an unreadable payload must never wedge a tool call
  }
  const parsed = memoryWritePayload({ raw });
  if (parsed === null) {
    return EXIT_ALLOW;
  }
  const { cwd, toolName, written } = parsed;
  // Read as a local and OR it in, never as a parameter default: `hatch-release` refuses a default
  // initialiser, because a caller passing its own argument would silently close a hatch it must only widen.
  const hatchOpen = env[HATCH_ENV] === "1";
  const refusal = memoryWriteRefusal({
    ...written,
    hatchOpen,
    holdsRootIndex,
    overlapContext: ({ dir }) => ({
      sections: typeof cwd === "string" ? readCanon({ cwd }) : [],
      siblings: readSiblings({ dir }),
    }),
    priorText: readLeaf({ path: written.filePath }),
    toolName,
    userHome,
  });
  if (refusal === undefined) {
    return EXIT_ALLOW;
  }
  writeError(`${refusal}\n`);
  return EXIT_BLOCK;
}
