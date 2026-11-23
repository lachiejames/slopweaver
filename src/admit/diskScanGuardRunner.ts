/**
 * The disk-scan reader gate's runner: read the `PreToolUse` payload, classify the command, and refuse a `find`
 * or `bfs` rooted at `/` or at the home directory, or a search inside the corpus or recursing from one of
 * those roots. Each row has its own hatch, ambient here or inline per segment in `./diskScan.ts`.
 *
 * FAILS OPEN on anything it cannot read — a malformed payload, a tool it does not judge, a missing command.
 * It is a spend guard, not a security boundary, and the same reasoning `./pollGateRunner.ts` states applies
 * here: a bug that failed closed would wedge every `Bash` call in every session on the machine.
 *
 * The decision is entirely in `./diskScan.ts`; nothing here judges anything, so the whole criterion is
 * unit-tested without a payload, a filesystem or a mock.
 */
import { homedir } from "node:os";

import { hatchFor } from "../hatch/lookup.js";
import { hatchRefusal } from "../hatch/render.js";
import { slopweaverHome } from "../homeDir.js";
import { isRecord } from "../lib/parsers.js";
import { classifyDiskScan } from "./diskScan.js";
import { EXIT_ALLOW, EXIT_BLOCK } from "./preToolUseDispatch.js";

/**
 * The refusal, naming what was about to be walked and the two places to look first instead.
 *
 * The replacement clause is the whole point of the gate rather than a courtesy: the overwhelmingly likely
 * reason a session is scanning is that a brief named a path relative to the state home, and in that case
 * the answer is one `ls` away. A refusal that only said no would send the session to the hatch.
 *
 * @internal — {@link runDiskScanGuard} is this module's public surface; exported for its own unit test.
 * @param binary the scanner that was about to run
 * @param root the root it was about to walk
 * @param stateHome the resolved state home, named in the replacement
 * @returns the four-line refusal followed by the two places to look
 */
export function diskScanRefusal({
  binary,
  root,
  stateHome,
}: {
  binary: string;
  root: string;
  stateHome: string;
}): string {
  const hatch = hatchFor({ id: "disk-wide-scan" });
  const detail = `${binary} was about to walk ${root}`;
  return [
    hatchRefusal({ detail, hatch }),
    `Look in the two places it is actually likely to be first: \`ls ${stateHome}/<first-segment-of-the-path>\` ` +
      "for anything a brief named relatively, and the repository you are already in. To find a FILE by name, name the " +
      "one folder it is likely in: `rg --files <folder> -g '*<name>*'` lists it, skipping ignored trees such as node_modules.",
  ].join("\n");
}

/**
 * The refusal for an unbounded search, naming what it was about to read and the verb that reads it instead.
 *
 * @internal — {@link runDiskScanGuard} is this module's public surface; exported for its own unit test.
 * @param binary the search program that was about to run
 * @param target the corpus path or root it was about to read
 * @param scope whether the target is inside the corpus or a whole-world root
 * @returns the four-line refusal followed by the replacement
 */
export function unboundedSearchRefusal({
  binary,
  target,
  scope,
}: {
  binary: string;
  target: string;
  scope: "corpus" | "home";
}): string {
  const hatch = hatchFor({ id: "unbounded-search" });
  if (scope === "corpus") {
    return [
      hatchRefusal({ detail: `${binary} was about to read ${target}, inside the corpus`, hatch }),
      "Read the corpus through its verb, which is indexed and bounded: `slopweaver store cite <question>`, or " +
        "`slopweaver store read <question> --search <terms> --contains <literal>`. A bronze `compact.jsonl` is one " +
        "file of up to 17.5 GB, and six greps over them held the machine at 0% idle for an hour.",
    ].join("\n");
  }
  return [
    hatchRefusal({ detail: `${binary} was about to search everything under ${target}`, hatch }),
    "Name the directory the text is actually in — the repository you are in, or one folder under the state home — " +
      "and search that. To find a FILE by name, `rg --files <folder> -g '*<name>*'` lists that one folder, skipping " +
      "ignored trees such as node_modules.",
  ].join("\n");
}

/**
 * Run the gate over one `PreToolUse` payload.
 *
 * @param readStdin reads the raw payload
 * @param writeError writes the refusal (stderr in production)
 * @param env the hook process's environment, for the hatch
 * @param homeDir the session's home directory (defaults to the real one)
 * @param stateHome the resolved state home (defaults to the real one)
 * @returns the exit code (2 refuse, 0 allow)
 */
export async function runDiskScanGuard({
  readStdin: read,
  writeError,
  env,
  homeDir = homedir(),
  stateHome = slopweaverHome(),
}: {
  readStdin: () => Promise<string>;
  writeError: (line: string) => void;
  env: Readonly<Record<string, string | undefined>>;
  homeDir?: string;
  stateHome?: string;
}): Promise<number> {
  let payload: unknown;
  try {
    payload = JSON.parse(await read());
  } catch {
    return EXIT_ALLOW;
  }
  if (!isRecord(payload)) {
    return EXIT_ALLOW;
  }
  const toolInput = payload["tool_input"];
  if (payload["tool_name"] !== "Bash" || !isRecord(toolInput)) {
    return EXIT_ALLOW;
  }
  const command = toolInput["command"];
  if (typeof command !== "string") {
    return EXIT_ALLOW;
  }
  // A payload without a cwd still judges every absolute operand; only a relative one goes unresolved.
  const rawCwd = payload["cwd"];
  const cwd = typeof rawCwd === "string" ? rawCwd : undefined;
  const scan = classifyDiskScan({ command, cwd, env, homeDir, stateHome });
  if (scan.kind === "scan") {
    writeError(`${diskScanRefusal({ binary: scan.binary, root: scan.root, stateHome })}\n`);
    return EXIT_BLOCK;
  }
  if (scan.kind === "search") {
    writeError(`${unboundedSearchRefusal({ binary: scan.binary, scope: scan.scope, target: scan.target })}\n`);
    return EXIT_BLOCK;
  }
  return EXIT_ALLOW;
}
