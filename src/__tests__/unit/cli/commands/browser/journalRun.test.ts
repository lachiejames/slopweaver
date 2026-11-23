/**
 * `browser break-glass`'s own shell — the two refusals it makes before appending anything, and the exact
 * grant row it journals once a reason and a live session are both established. The session id and the clock
 * are injected as functions, so the test can prove each is sampled only past the refusal before it.
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { browserBreakGlassPath } from "../../../../../browser/breakGlassStore.js";
import { runBreakGlass } from "../../../../../cli/commands/browser/journalRun.js";
import { type BrowserOptions, parseBrowserArgs } from "../../../../../cli/commands/browser/profileCore.js";
import { unwrap } from "../../../../../lib/result.js";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "journal-run-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** The resolved `browser break-glass` invocation for an argv tail, parsed by the verb's own parser. */
const optionsFor = ({ rest }: { rest: readonly string[] }): BrowserOptions =>
  unwrap(parseBrowserArgs({ rest: ["break-glass", ...rest] }));

/** Every path under the temp home, relative — the filesystem witness for "writes nothing". */
const homeContents = (): readonly string[] => readdirSync(home, { recursive: true }).map(String).toSorted();

/** A pair of counting seams, so a test can say which effect was sampled and how often. */
const countingSeams = ({ sessionId, iso }: { sessionId: string | undefined; iso: string }) => {
  const calls = { now: 0, readSessionId: 0 };
  return {
    calls,
    now: (): Date => {
      calls.now += 1;
      return new Date(iso);
    },
    readSessionId: (): string | undefined => {
      calls.readSessionId += 1;
      return sessionId;
    },
  };
};

describe("runBreakGlass — refusals before anything is appended", () => {
  it("refuses an absent or whitespace-only reason with exit 2, sampling neither seam and writing nothing", () => {
    const blank = countingSeams({ iso: "2026-10-13T01:00:00.000Z", sessionId: "session-a" });
    const absent = countingSeams({ iso: "2026-10-13T01:00:00.000Z", sessionId: "session-a" });

    expect(
      runBreakGlass({
        home,
        now: blank.now,
        options: optionsFor({ rest: ["--reason", "   "] }),
        readSessionId: blank.readSessionId,
      }),
    ).toBe(2);
    expect(
      runBreakGlass({ home, now: absent.now, options: optionsFor({ rest: [] }), readSessionId: absent.readSessionId }),
    ).toBe(2);

    expect(blank.calls).toEqual({ now: 0, readSessionId: 0 });
    expect(absent.calls).toEqual({ now: 0, readSessionId: 0 });
    expect(homeContents()).toEqual([]);
  });

  it("refuses an absent or empty session id with exit 1, never sampling the clock and writing nothing", () => {
    const unset = countingSeams({ iso: "2026-10-13T01:00:00.000Z", sessionId: undefined });
    const empty = countingSeams({ iso: "2026-10-13T01:00:00.000Z", sessionId: "" });
    const options = optionsFor({ rest: ["--reason", "the door cannot reach this console"] });

    expect(runBreakGlass({ home, now: unset.now, options, readSessionId: unset.readSessionId })).toBe(1);
    expect(runBreakGlass({ home, now: empty.now, options, readSessionId: empty.readSessionId })).toBe(1);

    expect(unset.calls).toEqual({ now: 0, readSessionId: 1 });
    expect(empty.calls).toEqual({ now: 0, readSessionId: 1 });
    expect(homeContents()).toEqual([]);
  });
});

describe("runBreakGlass — the grant it journals", () => {
  it("exits 0 and appends one grant, trimmed reason, expiring 30 minutes after the injected instant", () => {
    const seams = countingSeams({ iso: "2026-10-13T01:00:00.000Z", sessionId: "session-a" });

    const code = runBreakGlass({
      home,
      now: seams.now,
      options: optionsFor({ rest: ["--reason", "  the door cannot reach this console  "] }),
      readSessionId: seams.readSessionId,
    });

    expect(code).toBe(0);
    expect(seams.calls).toEqual({ now: 1, readSessionId: 1 });
    expect(homeContents()).toEqual(["ledgers", "ledgers/browser-break-glass.jsonl"]);
    expect(readFileSync(browserBreakGlassPath({ home }), "utf8")).toBe(
      '{"expiresAtIso":"2026-10-13T01:30:00.000Z","issuedAtIso":"2026-10-13T01:00:00.000Z",' +
        '"reason":"the door cannot reach this console","sessionId":"session-a"}\n',
    );
  });

  it("carries --page onto the grant when one is named", () => {
    const seams = countingSeams({ iso: "2026-10-13T02:15:00.000Z", sessionId: "session-b" });

    const code = runBreakGlass({
      home,
      now: seams.now,
      options: optionsFor({ rest: ["--reason", "one form", "--page", "https://example.test/form"] }),
      readSessionId: seams.readSessionId,
    });

    expect(code).toBe(0);
    expect(readFileSync(browserBreakGlassPath({ home }), "utf8")).toBe(
      '{"expiresAtIso":"2026-10-13T02:45:00.000Z","issuedAtIso":"2026-10-13T02:15:00.000Z",' +
        '"reason":"one form","sessionId":"session-b","page":"https://example.test/form"}\n',
    );
  });

  it("appends a second grant for the same session rather than overwriting the first", () => {
    const first = countingSeams({ iso: "2026-10-13T01:00:00.000Z", sessionId: "session-a" });
    const second = countingSeams({ iso: "2026-10-13T01:05:00.000Z", sessionId: "session-a" });
    const options = optionsFor({ rest: ["--reason", "again"] });

    expect(runBreakGlass({ home, now: first.now, options, readSessionId: first.readSessionId })).toBe(0);
    expect(runBreakGlass({ home, now: second.now, options, readSessionId: second.readSessionId })).toBe(0);

    expect(readFileSync(browserBreakGlassPath({ home }), "utf8")).toBe(
      '{"expiresAtIso":"2026-10-13T01:30:00.000Z","issuedAtIso":"2026-10-13T01:00:00.000Z","reason":"again","sessionId":"session-a"}\n' +
        '{"expiresAtIso":"2026-10-13T01:35:00.000Z","issuedAtIso":"2026-10-13T01:05:00.000Z","reason":"again","sessionId":"session-a"}\n',
    );
  });
});
