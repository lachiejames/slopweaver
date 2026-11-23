/**
 * The one effect `./codexSessions.ts` needs: a read-only `lsof` over the files Codex processes hold open.
 *
 * `lsof -a -c codex -F pcfn` matches every command starting `codex` (so `codex-code-mode-host` too) and took 0.13 s,
 * MEASURED (repro: `time lsof -a -c codex -F pcfn`). The descriptor field `f` is asked for by name:
 * the parser keeps only a name on a numeric descriptor, and an lsof from 4.94 prints only the fields requested
 * It exits 1 when no process matches, so exit 1 is an
 * empty or partial read rather than a failure: a scan is only ever used as POSITIVE evidence, and a partial one
 * can still prove a thread live.
 */
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { resolveCodexHome } from "../codex/quotaLog.js";
import {
  type CodexOpenFilesScan,
  type CodexThreadObserver,
  observeCodexThread,
  parseCodexOpenFiles,
} from "./codexSessions.js";

/** More stdout than every Codex process's open files produce, so a read never dies of ENOBUFS. */
const MAX_BUFFER = 8 * 1024 * 1024;

/** How long the scan may block. One local snapshot — quick, or broken. */
const READ_TIMEOUT_MS = 10_000;

/**
 * The Codex homes a held path is judged against: the resolved `$CODEX_HOME`, and every `~/.codex` or
 * `~/.codex-<name>` directory, which is where this machine's registered homes live (`~/.codex-two`, …). A home
 * outside them is missed, which leaves its writers UNKNOWN, never dead — the safe direction.
 *
 * @returns each home, absolute
 */
function codexHomes(): readonly string[] {
  // The user's own directory, never `$SLOPWEAVER_HOME`: each Codex home is a sibling of `~/.codex`.
  const userDir = homedir();
  const homes = new Set<string>([resolveCodexHome()]);
  try {
    for (const entry of readdirSync(userDir, { withFileTypes: true })) {
      if (entry.isDirectory() && (entry.name === ".codex" || entry.name.startsWith(".codex-"))) {
        homes.add(join(userDir, entry.name));
      }
    }
  } catch {
    // An unreadable home directory leaves only `$CODEX_HOME` to judge against: fewer homes, fewer lives, never a death.
  }
  return [...homes];
}

/**
 * Every file a Codex process holds open on this machine, with the homes they are judged against, or why the scan
 * could not be taken.
 *
 * @returns the scan
 */
function readCodexOpenFiles(): CodexOpenFilesScan {
  const result = spawnSync("lsof", ["-a", "-c", "codex", "-F", "pcfn"], {
    encoding: "utf8",
    maxBuffer: MAX_BUFFER,
    timeout: READ_TIMEOUT_MS,
  });
  if (result.error !== undefined) {
    return { kind: "failed", why: result.error.message };
  }
  if (result.status !== 0 && result.status !== 1) {
    const how = result.status === null ? `signal ${String(result.signal)}` : `exit ${String(result.status)}`;
    return { kind: "failed", why: `lsof ended with ${how}` };
  }
  return { files: parseCodexOpenFiles({ text: result.stdout }), homes: codexHomes(), kind: "read" };
}

/**
 * A Codex-thread observer that scans at most ONCE, on its first question — so a caller judging no Codex writer
 * never runs `lsof`, and one judging many runs it once.
 *
 * @param read the scan, injectable so a test can count how often it runs; `lsof` by default
 * @returns the observer `classifyWriterLiveness` takes as its `codexThread` seam
 */
export function codexThreadObserver({
  read = readCodexOpenFiles,
}: { read?: () => CodexOpenFilesScan } = {}): CodexThreadObserver {
  let taken: CodexOpenFilesScan | undefined;
  const scanOnce = (): CodexOpenFilesScan => {
    if (taken !== undefined) {
      return taken;
    }
    const scan = read();
    taken = scan;
    return scan;
  };
  return ({ threadId }) => observeCodexThread({ scan: scanOnce(), threadId });
}
