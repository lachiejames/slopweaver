/**
 * The real session ledger the recorder writes through, over a throwaway home: a row it holds answers its key, a
 * session it never held answers nothing, and a row that names the session but does not READ throws — so the
 * recorder warns rather than taking an unreadable row for an untracked session.
 */
import { appendFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { sessionFromCmux } from "../../../sessionHarness/cmuxSession.js";
import type { HarnessLaunchSpec } from "../../../sessionHarness/launch.js";
import { linesNamingSession, sessionLedgerDeps } from "../../../sessionHarness/sessionLedger.js";
import { spawnedEventOf } from "../../../sessionHarness/spawnedEvent.js";
import { sessionLogPath } from "../../../sessions/sessionStore.js";
import { workspaceRow } from "./fakeCmux.js";

const SPEC: HarnessLaunchSpec = {
  baseBranch: undefined,
  branch: "a-branch",
  directory: "/work/tree-2",
  directoryExists: true,
  host: "claude-code",
  initialMessage: "read the doc, then start it",
  launchKey: "a-doc",
  ledgerKey: "a-doc",
  model: "opus",
  openedAtIso: "2026-11-07T02:59:00.000Z",
  registeredName: undefined,
  repoRoot: "/work/repo",
  respondingToHandle: undefined,
  slug: "a-doc",
  template: "code",
  title: "a-doc",
};

const SESSION = sessionFromCmux({ workspace: workspaceRow({ n: 2 }) });

const homes: string[] = [];

/** One backslash, so a fixture can spell a JSON escape that survives any formatter. */
const BACKSLASH = String.fromCodePoint(92);

/** A fresh state home, removed after the test. */
function freshHome(): string {
  const home = mkdtempSync(join(tmpdir(), "sw-ledger-"));
  homes.push(home);
  return home;
}

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

describe("linesNamingSession", () => {
  it("picks only the unreadable lines carrying the session's quoted id or quoted handle", () => {
    const text = [
      '{"sessionId":"id-2","openedBy":"reopen"}',
      '{"sessionId":"id-22"}',
      "not json id-2",
      '{"workspaceRef":"workspace:2","slug":42}',
      '{"workspaceRef":"workspace:22","slug":42}',
      // An escaped spelling names the same id, so it is judged decoded. The escape
      // is built from a lone backslash so no editor or formatter can fold it back to a plain `-`.
      `{"sessionId":"id${BACKSLASH}u002d2","slug":42}`,
      'not json but "workspace:2" quoted',
      // A line that decodes to a bare string or an array is judged decoded too.
      `"id${BACKSLASH}u002d2"`,
      `[1, ["workspace${BACKSLASH}u003a2"]]`,
      `"id${BACKSLASH}u002d22"`,
    ].join("\n");
    const lines = linesNamingSession({
      handle: "workspace:2",
      lineNumbers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      sessionId: "id-2",
      text,
    });

    expect(text).toContain("u002d");
    expect(lines).toEqual([1, 4, 6, 7, 8, 9]);
  });

  it("answers nothing when every line read", () => {
    const text = '{"sessionId":"id-2"}';

    expect(linesNamingSession({ handle: "workspace:2", lineNumbers: [], sessionId: "id-2", text })).toEqual([]);
  });
});

describe("sessionLedgerDeps — openSessionKey", () => {
  it("answers the key of the open row the session holds", () => {
    const home = freshHome();
    const ledger = sessionLedgerDeps({ home });
    ledger.append({
      event: spawnedEventOf({
        address: { endpointHandle: "surface:2", handle: "workspace:2", sessionId: "id-2" },
        implementation: "cmux",
        operation: "open",
        spec: SPEC,
        tsIso: "2026-11-07T03:00:00.000Z",
      }),
    });
    expect(ledger.openSessionKey({ session: SESSION })).toBe("a-doc");
  });

  it("answers nothing for a home with no ledger, and past an unrelated unreadable line", () => {
    const home = freshHome();
    expect(sessionLedgerDeps({ home }).openSessionKey({ session: SESSION })).toBe(undefined);
    sessionLedgerDeps({ home }).append({
      event: { kind: "closed", sessionKey: "other", tsIso: "2026-11-07T03:00:00.000Z", workspaceRef: "workspace:9" },
    });
    appendFileSync(sessionLogPath({ home }), '{"kind":"spawned","sessionId":"id-9","openedBy":"reopen"}\n');
    expect(sessionLedgerDeps({ home }).openSessionKey({ session: SESSION })).toBe(undefined);
  });

  it("throws when the only row naming the session does not read", () => {
    const home = freshHome();
    sessionLedgerDeps({ home }).append({
      event: { kind: "closed", sessionKey: "other", tsIso: "2026-11-07T03:00:00.000Z", workspaceRef: "workspace:9" },
    });
    appendFileSync(sessionLogPath({ home }), '{"kind":"spawned","sessionId":"id-2","openedBy":"reopen"}\n');
    expect(() => sessionLedgerDeps({ home }).openSessionKey({ session: SESSION })).toThrow(
      "line(s) 2 name session id-2 (workspace:2) and do not read",
    );
  });

  // Counterexample: a row written before the session harness carries no id, so
  // only its handle can tie it to the session being parked.
  it("throws when the only row naming the session's handle is an id-less one that does not read", () => {
    const home = freshHome();
    sessionLedgerDeps({ home }).append({
      event: { kind: "closed", sessionKey: "other", tsIso: "2026-11-07T03:00:00.000Z", workspaceRef: "workspace:9" },
    });
    appendFileSync(
      sessionLogPath({ home }),
      '{"schemaVersion":1,"kind":"spawned","sessionKey":"a-doc","tsIso":"t","workspaceRef":"workspace:2","surfaceRef":"surface:2","cwd":"/tmp/wt","branch":"b","slug":42}\n',
    );
    expect(() => sessionLedgerDeps({ home }).openSessionKey({ session: SESSION })).toThrow(
      "line(s) 2 name session id-2 (workspace:2) and do not read",
    );
  });
});
