/*
 * What the `profile words` verb-body test files share: the turn, chair and clock ids, the two throwaway homes a
 * case runs over, the console turn each case stages, and the one run that collects every line the verb prints.
 *
 * `useWordsHomes()` mints `home` and `claudeHome` in a `beforeEach` — one chair, pinned before every window and
 * typed nothing — and removes both in the `afterEach` it registers, so read either only inside a case. Per
 * `testing.md`, every write goes to a `home` a case minted — never the ambient one. It moved here when the verb
 * body's one test file was split by behaviour.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach } from "vitest";

import { parseProfileWordsArgs } from "../../../../../../cli/commands/profile/wordsArgs.js";
import { profileWords } from "../../../../../../cli/commands/profile/wordsRun.js";
import { unwrap } from "../../../../../../lib/result.js";
import { writeSupervisorPin } from "../../../../../../sessions/supervisorPinStore.js";
import { appendSupervisorLink } from "../../../../../../supervisor/chainStore.js";
import { formRelayDraft } from "../../../../../../talk/relayDraft.js";
import { claimTurn } from "../../../../../../talk/relayStore.js";

export const NOW = "2026-10-04T12:00:00.000Z";
export const TURN = "a0000017-0000-4000-8000-000000000019";
export const OTHER_TURN = "a0000043-0000-4000-8000-000000000046";
export const CHAIR = "4c5d6e7f-8091-4a2b-9c3d-4e5f60718293";

/** The case's throwaway state home; a live binding, assigned before each case and read only inside one. */
export let home = "";
/** The case's throwaway `~/.claude`; a live binding, assigned before each case and read only inside one. */
export let claudeHome = "";

/**
 * Register the hooks that give every case its own state home and Claude home, seeded with one pinned chair, and
 * remove both after. Call it once, at the top of a test file whose cases read {@link home} or {@link claudeHome}.
 */
export function useWordsHomes(): void {
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "sw-words-home-"));
    claudeHome = mkdtempSync(join(tmpdir(), "sw-words-claude-"));
    // One chair, pinned before every window here and typed nothing, so the supervisor read covers the window.
    const chair = {
      session: { host: "claude-code" as const, id: CHAIR },
      pinnedAtIso: "2026-09-01T00:00:00.000Z",
      workspaceId: "ws-1",
      workspaceRef: "w:1",
    };
    appendSupervisorLink({ home, link: { ...chair, source: "pin" } });
    writeSupervisorPin({ home, record: chair });
    mkdirSync(join(claudeHome, "projects", "-repo"), { recursive: true });
    writeFileSync(join(claudeHome, "projects", "-repo", `${CHAIR}.jsonl`), "", "utf8");
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
    rmSync(claudeHome, { force: true, recursive: true });
  });
}

/** Stage one console turn of the owner's — a typed one carries no paraphrase, so its `say` stays empty. */
export function stage({
  heard,
  turnId,
  typed,
  atIso,
}: {
  heard: string;
  turnId: string;
  typed: boolean;
  atIso: string;
}): void {
  let say = "relay";
  if (typed) {
    say = "";
  }
  const draft = unwrap(
    formRelayDraft({
      about: "",
      heard,
      picture: { kind: "none", reason: "screen-not-shared" },
      readsAfter: [],
      say,
      turnId,
      typed,
      wordsAlone: false,
    }),
  );
  unwrap(claimTurn({ draft, home, nowIso: atIso }));
}

/**
 * Run the verb's body over a typed argv tail, collecting every line.
 *
 * @returns the exit code the verb returned, and every line it printed in order
 */
export function run({ rest }: { rest: readonly string[] }): {
  readonly code: number;
  readonly lines: readonly string[];
} {
  const lines: string[] = [];
  const code = profileWords({
    args: unwrap(parseProfileWordsArgs({ rest })),
    claudeHome,
    home,
    nowIso: NOW,
    out: (line) => {
      lines.push(line);
    },
  });
  return { code, lines };
}
