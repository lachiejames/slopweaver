import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { unwrap, unwrapErr } from "#lib/result.js";
import { MAX_TRACKED_SESSIONS } from "../../../cli/skillReminder.js";
import {
  parseStaleSeatNoticesDocument,
  readStaleSeatNoticesFile,
  StaleSeatNoticesErrors,
  withNoticedSession,
} from "../../../cli/staleSeatNotices.js";
import { FIXTURE_OUTAGE_REASON, memorySingletonStore } from "../../singletonRegisterFixture.js";
import { memoryStaleSeatNoticesPort, unavailableStaleSeatNoticesPort } from "../../staleSeatNoticesFixture.js";

/*
 * The noticed sessions' document, the retired file's one-time import and the port's compare-and-set, over an
 * in-memory store standing in for the database alone.
 */

const dirs: string[] = [];

function newDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "stale-notices-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  dirs.splice(0).forEach((dir) => {
    rmSync(dir, { force: true, recursive: true });
  });
});

describe("parseStaleSeatNoticesDocument", () => {
  test("reads a schemaVersion 1 list of session ids", () => {
    const parsed = parseStaleSeatNoticesDocument({ value: { noticedSessions: ["a", "b"], schemaVersion: 1 } });
    expect(unwrap(parsed)).toEqual({ noticedSessions: ["a", "b"], schemaVersion: 1 });
  });

  test("refuses another schema version, naming the row", () => {
    const parsed = parseStaleSeatNoticesDocument({ value: { noticedSessions: [], schemaVersion: 2 } });
    expect(unwrapErr(parsed).message).toBe(
      "the store's stale-seat-notices row is not a stale-seat notices document (it is not a schemaVersion 1 object)",
    );
  });

  test("refuses a list carrying anything but a non-empty session id", () => {
    const parsed = parseStaleSeatNoticesDocument({ value: { noticedSessions: ["a", ""], schemaVersion: 1 } });
    expect(unwrapErr(parsed).code).toBe("STALE_SEAT_NOTICES_MALFORMED");
  });

  test("refuses noticedSessions that is not a list", () => {
    const parsed = parseStaleSeatNoticesDocument({ value: { noticedSessions: "a", schemaVersion: 1 } });
    expect(unwrapErr(parsed).message).toContain("noticedSessions is not a list of session ids");
  });
});

describe("readStaleSeatNoticesFile", () => {
  test("answers undefined when no file is there", () => {
    expect(unwrap(readStaleSeatNoticesFile({ path: join(newDir(), "stale-seat-notices.json") }))).toBe(undefined);
  });

  test("keeps only the sessions shown the stale-seat notice, in the file's own order", () => {
    const path = join(newDir(), "stale-seat-notices.json");
    writeFileSync(
      path,
      JSON.stringify({ "session-1": ["stale-seat"], "session-2": ["other"], "session-3": ["other", "stale-seat"] }),
    );
    expect(unwrap(readStaleSeatNoticesFile({ path }))).toEqual({
      noticedSessions: ["session-1", "session-3"],
      schemaVersion: 1,
    });
  });

  test("refuses a session that does not hold a key list, naming the file", () => {
    const path = join(newDir(), "stale-seat-notices.json");
    writeFileSync(path, JSON.stringify({ "session-1": "stale-seat" }));
    expect(unwrapErr(readStaleSeatNoticesFile({ path }))).toEqual(
      StaleSeatNoticesErrors.malformed({ detail: "session session-1 does not hold a key list", source: path }),
    );
  });

  test("refuses text that is not JSON", () => {
    const path = join(newDir(), "stale-seat-notices.json");
    writeFileSync(path, "{not json");
    expect(unwrapErr(readStaleSeatNoticesFile({ path })).code).toBe("STALE_SEAT_NOTICES_MALFORMED");
  });

  test("refuses a path that cannot be read as a file", () => {
    const path = join(newDir(), "stale-seat-notices.json");
    mkdirSync(path);
    const refused = unwrapErr(readStaleSeatNoticesFile({ path }));
    expect(refused.code).toBe("STALE_SEAT_NOTICES_UNREADABLE");
    expect(refused.message).toContain("; move it out of the home");
  });
});

describe("withNoticedSession", () => {
  test("appends the session at the newest end", () => {
    expect(withNoticedSession({ noticedSessions: ["a"], sessionId: "b" })).toEqual({
      noticedSessions: ["a", "b"],
      schemaVersion: 1,
    });
  });

  test("evicts the oldest session once the bound is reached", () => {
    const full = Array.from({ length: MAX_TRACKED_SESSIONS }, (_, index) => `session-${String(index)}`);
    const next = withNoticedSession({ noticedSessions: full, sessionId: "newest" });
    expect(next.noticedSessions).toHaveLength(MAX_TRACKED_SESSIONS);
    expect(next.noticedSessions[0]).toBe("session-1");
    expect(next.noticedSessions[MAX_TRACKED_SESSIONS - 1]).toBe("newest");
  });
});

describe("the notices port", () => {
  test("reads nothing noticed, at no revision, when there is no row and no file", async () => {
    const home = newDir();
    const store = memorySingletonStore();
    expect(unwrap(await memoryStaleSeatNoticesPort({ store }).read({ home }))).toEqual({
      noticedSessions: [],
      revision: null,
    });
    expect(store.rows.has(home)).toBe(false);
  });

  test("a replace pinned to a stale revision is refused and leaves the row as it was", async () => {
    const home = newDir();
    const store = memorySingletonStore();
    const port = memoryStaleSeatNoticesPort({ store });
    unwrap(
      await port.replace({ document: { noticedSessions: ["a"], schemaVersion: 1 }, expectedRevision: null, home }),
    );
    const stale = await port.replace({
      document: { noticedSessions: ["b"], schemaVersion: 1 },
      expectedRevision: null,
      home,
    });
    expect(unwrapErr(stale).code).toBe("STALE_SEAT_NOTICES_REVISION_CONFLICT");
    expect(store.rows.get(home)).toEqual({ document: { noticedSessions: ["a"], schemaVersion: 1 }, revision: 1 });
  });

  test("a replace at the current revision bumps it", async () => {
    const home = newDir();
    const port = memoryStaleSeatNoticesPort();
    unwrap(
      await port.replace({ document: { noticedSessions: ["a"], schemaVersion: 1 }, expectedRevision: null, home }),
    );
    const next = await port.replace({
      document: { noticedSessions: ["a", "b"], schemaVersion: 1 },
      expectedRevision: 1,
      home,
    });
    expect(unwrap(next)).toEqual({ noticedSessions: ["a", "b"], revision: 2 });
  });

  test("an outage is a typed refusal, even with the retired file present", async () => {
    const home = newDir();
    writeFileSync(join(home, "stale-seat-notices.json"), JSON.stringify({ "session-1": ["stale-seat"] }));
    const refused = unwrapErr(await unavailableStaleSeatNoticesPort().read({ home }));
    expect(refused.code).toBe("STALE_SEAT_NOTICES_STORE_UNAVAILABLE");
    expect(refused.message).toContain(FIXTURE_OUTAGE_REASON);
  });
});
