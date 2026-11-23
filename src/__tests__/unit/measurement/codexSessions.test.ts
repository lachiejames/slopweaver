/**
 * Codex thread liveness from the files Codex processes hold open: a match is live, everything else is not observed.
 */
import { describe, expect, it } from "vitest";

import {
  type CodexOpenFilesScan,
  codexThreadIdOfPath,
  observeCodexThread,
  parseCodexOpenFiles,
} from "../../../measurement/codexSessions.js";

const THREAD = "a0000065-0000-4000-8000-000000000071";
const OTHER = "0199ffff-0000-7111-8222-333344445555";
const ROLLOUT = `/Users/acme/.codex-two/sessions/2026/11/05/rollout-2026-11-05T09-12-33-${THREAD}.jsonl`;
const LOCK = `/Users/acme/.codex/thread-writer-locks/${THREAD}.lock`;
const HOMES = ["/Users/acme/.codex", "/Users/acme/.codex-two/"];

/** `lsof -a -c codex -F pcfn` output in the shape it prints: process, command, then descriptor and name lines. */
const LSOF = [
  "p501",
  "ccodex",
  "fcwd",
  "n/Users/acme/repo",
  "f12",
  `n${ROLLOUT}`,
  "p502",
  "ccodex-code-mode-host",
  "f9",
  `n/Users/acme/.codex/thread-writer-locks/${OTHER}.lock`,
  "p503",
  "ccodexbar",
  "f4",
  `n${LOCK}`,
  "",
].join("\n");

describe("codexThreadIdOfPath", () => {
  it("reads the thread id off a rollout under any of the given Codex homes, trailing slash or not", () => {
    expect(codexThreadIdOfPath({ homes: HOMES, path: ROLLOUT })).toBe(THREAD);
  });

  it("reads the thread id off a writer lock", () => {
    expect(codexThreadIdOfPath({ homes: HOMES, path: LOCK })).toBe(THREAD);
  });

  it("names no thread for a path of neither shape", () => {
    const of = ({ path }: { path: string }): string | undefined => codexThreadIdOfPath({ homes: HOMES, path });
    expect(of({ path: "/Users/acme/repo/src/index.ts" })).toBeUndefined();
    expect(of({ path: `/Users/acme/.codex/rollout-x-${THREAD}.jsonl` })).toBeUndefined();
    expect(of({ path: `/Users/acme/.codex/sessions/rollout-x-${THREAD}.jsonl` })).toBeUndefined();
    expect(of({ path: `/Users/acme/.codex/thread-writer-locks/${THREAD}.lock.tmp` })).toBeUndefined();
  });

  it("names no thread for the right shape under no Codex home, such as a project fixture", () => {
    const fixture = `/tmp/project/sessions/2026/11/05/rollout-decoy-${THREAD}.jsonl`;
    expect(codexThreadIdOfPath({ homes: HOMES, path: fixture })).toBeUndefined();
    expect(
      codexThreadIdOfPath({ homes: HOMES, path: `/tmp/project/thread-writer-locks/${THREAD}.lock` }),
    ).toBeUndefined();
    expect(codexThreadIdOfPath({ homes: ["/Users/acme/.cod"], path: ROLLOUT })).toBeUndefined();
    expect(codexThreadIdOfPath({ homes: [], path: ROLLOUT })).toBeUndefined();
  });

  it("treats a blank, root or relative home as no home, so an empty CODEX_HOME never makes / one", () => {
    const atRoot = `/thread-writer-locks/${THREAD}.lock`;
    expect(codexThreadIdOfPath({ homes: [""], path: atRoot })).toBeUndefined();
    expect(codexThreadIdOfPath({ homes: ["/"], path: atRoot })).toBeUndefined();
    expect(
      codexThreadIdOfPath({ homes: [".codex"], path: `.codex/thread-writer-locks/${THREAD}.lock` }),
    ).toBeUndefined();
    expect(codexThreadIdOfPath({ homes: ["", ...HOMES], path: LOCK })).toBe(THREAD);
  });
});

describe("parseCodexOpenFiles", () => {
  it("attributes each open file to its process, keeping only Codex's own commands and numeric descriptors", () => {
    expect(parseCodexOpenFiles({ text: LSOF })).toEqual([
      { command: "codex", path: ROLLOUT, pid: 501 },
      { command: "codex-code-mode-host", path: `/Users/acme/.codex/thread-writer-locks/${OTHER}.lock`, pid: 502 },
    ]);
  });

  it("drops a name line that arrives before any process or descriptor", () => {
    expect(parseCodexOpenFiles({ text: `n${LOCK}\np9\nccodex\nn${LOCK}\n` })).toEqual([]);
  });

  it("never reads a working directory named like a rollout as a held file", () => {
    const decoy = `/tmp/project/sessions/2026/11/05/rollout-decoy-${THREAD}.jsonl`;
    expect(parseCodexOpenFiles({ text: `p7\nccodex\nfcwd\nn${decoy}\nftxt\nn${LOCK}\n` })).toEqual([]);
  });

  it("keeps the code-mode host under the fifteen-character name a MAXCOMLEN lsof cuts it to", () => {
    const text = `p8\nccodex-code-mode\nf9\nn${LOCK}\np9\nccodex-code-mod\nf9\nn${LOCK}\n`;
    expect(parseCodexOpenFiles({ text })).toEqual([{ command: "codex-code-mode", path: LOCK, pid: 8 }]);
  });

  it("refuses a cut of the code-mode host no kernel writes, longer than fifteen but short of whole", () => {
    const text = `p8\nccodex-code-mode-\nf9\nn${LOCK}\np9\nccodex-code-mode-hos\nf9\nn${LOCK}\n`;
    expect(parseCodexOpenFiles({ text })).toEqual([]);
  });

  it("reads nothing from empty output, which is what lsof prints when no Codex process runs", () => {
    expect(parseCodexOpenFiles({ text: "" })).toEqual([]);
  });
});

describe("observeCodexThread", () => {
  const scan: CodexOpenFilesScan = { files: parseCodexOpenFiles({ text: LSOF }), homes: HOMES, kind: "read" };

  it("says not observed for a decoy rollout a Codex process holds on a numeric descriptor outside every home", () => {
    const decoy = `/tmp/project/sessions/2026/11/05/rollout-decoy-${THREAD}.jsonl`;
    const held: CodexOpenFilesScan = { files: [{ command: "codex", path: decoy, pid: 7 }], homes: HOMES, kind: "read" };
    expect(observeCodexThread({ scan: held, threadId: THREAD }).kind).toBe("not-observed");
  });

  it("observes a thread live when a Codex process holds its rollout, naming the holder", () => {
    expect(observeCodexThread({ scan, threadId: THREAD })).toEqual({ kind: "live", path: ROLLOUT, pid: 501 });
  });

  it("matches a thread id given in upper case", () => {
    expect(observeCodexThread({ scan, threadId: THREAD.toUpperCase() }).kind).toBe("live");
  });

  it("observes a thread live off its writer lock alone", () => {
    expect(observeCodexThread({ scan, threadId: OTHER })).toEqual({
      kind: "live",
      path: `/Users/acme/.codex/thread-writer-locks/${OTHER}.lock`,
      pid: 502,
    });
  });

  it("says not observed, never dead, for a thread no Codex process holds", () => {
    const observed = observeCodexThread({ scan, threadId: "0199dead-0000-7000-8000-000000000000" });
    expect(observed.kind).toBe("not-observed");
    expect(observed).toEqual({
      kind: "not-observed",
      why:
        "no Codex process holds this thread's rollout or writer lock, and Codex has no live-thread registry, so " +
        "absence does not prove death (a rollout not yet created, mid I/O recovery or owned by an app server holds none)",
    });
  });

  it("says not observed, carrying why, when the scan itself failed", () => {
    expect(observeCodexThread({ scan: { kind: "failed", why: "lsof exited 2" }, threadId: THREAD })).toEqual({
      kind: "not-observed",
      why: "Codex's open files could not be read — lsof exited 2",
    });
  });
});
