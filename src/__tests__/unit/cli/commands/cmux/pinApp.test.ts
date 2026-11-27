/**
 * `cmux pin` from inside an app-hosted session, over plain fakes: the supervisor-pin lock, the app's answer, one cmux
 * listing, the strict record and a writer that records what it was asked to write. No socket, no cmux, no file.
 */
import { describe, expect, it } from "vitest";

import { type AppPinDeps, pinAppSession } from "../../../../../cli/commands/cmux/pinApp.js";
import { err, ok, type Result, unwrap, unwrapErr } from "../../../../../lib/result.js";
import type { AppHarnessResponse } from "../../../../../sessionHarness/appProtocol.js";
import type { AppSessionClaim } from "../../../../../sessionHarness/appSessionOrigin.js";
import type { AppTransport, AppTransportFailure } from "../../../../../sessionHarness/appSocketTransport.js";
import type { SupervisorPinDisposition } from "../../../../../sessions/supervisorPinStore.js";
import { fakePinLock, HELD_LOCK_MESSAGE } from "./pinLockFake.js";

const APP_ID = "a0000107-0000-4000-8000-0000000000a1";
const CLAUDE_ID = "a0000107-0000-4000-8000-0000000000c1";
const CLAIM: AppSessionClaim = { appSessionId: APP_ID, session: { host: "claude-code", id: CLAUDE_ID } };
const NOW = "2026-11-09T02:00:00.000Z";

const VOUCHED: AppHarnessResponse = {
  kind: "session-origin",
  session: {
    directory: "/work/acme",
    handle: `app:${APP_ID}`,
    ledgerKey: "abc-1",
    openedAtIso: "2026-11-09T01:00:00.000Z",
    sessionId: APP_ID,
    state: "idle",
    title: "abc-1",
    vendor: "claude",
  },
};

/** The fakes, with every record call kept so a case can say whether anything was written, and every effect journalled. */
function fakes({
  answer = ok(VOUCHED),
  pinned = ok([]),
  disposition = { kind: "absent" },
  writes = true,
  held = false,
}: {
  answer?: Result<AppHarnessResponse, AppTransportFailure>;
  pinned?: Result<readonly string[], { readonly message: string }>;
  disposition?: SupervisorPinDisposition;
  writes?: boolean;
  held?: boolean;
}): { deps: AppPinDeps; recorded: unknown[]; events: string[] } {
  const recorded: unknown[] = [];
  const events: string[] = [];
  const transport: AppTransport = async () => {
    events.push("origin");
    return answer;
  };
  return {
    deps: {
      holdPinLock: fakePinLock({ events, held }),
      nowIso: () => NOW,
      pinnedWorkspaceRefs: async () => {
        events.push("cmux");
        return pinned;
      },
      readDisposition: () => {
        events.push("record-read");
        return disposition;
      },
      record: (options) => {
        events.push("record-write");
        recorded.push(options);
        return writes;
      },
      transport,
    },
    events,
    recorded,
  };
}

describe("pinAppSession", () => {
  it("records the vouched app session and says so, all under the supervisor-pin lock", async () => {
    const { deps, events, recorded } = fakes({});
    expect(unwrap(await pinAppSession({ claim: CLAIM, deps }))).toEqual({
      label: `app:${APP_ID}`,
      plan: "record",
      wrote: true,
    });
    expect(recorded).toEqual([{ appSessionId: APP_ID, nowIso: NOW, session: CLAIM.session }]);
    expect(events).toEqual(["lock", "origin", "cmux", "record-read", "record-write", "release"]);
  });

  it("refuses on a held lock before the app, cmux or the record is read", async () => {
    const { deps, events, recorded } = fakes({ held: true });
    expect(unwrapErr(await pinAppSession({ claim: CLAIM, deps })).message).toBe(HELD_LOCK_MESSAGE);
    expect(recorded).toEqual([]);
    expect(events).toEqual(["lock"]);
  });

  it("writes nothing when the app refuses the origin claim, and releases the lock", async () => {
    const { deps, events, recorded } = fakes({
      answer: err({ code: "ORIGIN_REFUSED", kind: "refused", message: "that session runs another vendor id" }),
    });
    expect(unwrapErr(await pinAppSession({ claim: CLAIM, deps })).message).toBe(
      "the desktop app did not vouch for this session: that session runs another vendor id",
    );
    expect(recorded).toEqual([]);
    expect(events).toEqual(["lock", "origin", "release"]);
  });

  it("writes nothing when cmux cannot be read and nothing is recorded, since an unrecorded cmux pin cannot be ruled out", async () => {
    const { deps, recorded } = fakes({ pinned: err({ message: "cmux is not running" }) });
    expect(unwrapErr(await pinAppSession({ claim: CLAIM, deps })).message).toBe(
      "cmux could not be read, so a pinned cmux supervisor cannot be ruled out: cmux is not running",
    );
    expect(recorded).toEqual([]);
  });

  it("writes nothing when cmux cannot be read and the record names a cmux workspace, the refusal that stands", async () => {
    const { deps, recorded } = fakes({
      disposition: {
        kind: "pin",
        record: {
          pinnedAtIso: "2026-11-09T01:30:00.000Z",
          session: CLAIM.session,
          workspaceId: "id-chair",
          workspaceRef: "workspace:7",
        },
      },
      pinned: err({ message: "cmux refused this process its socket" }),
    });
    expect(unwrapErr(await pinAppSession({ claim: CLAIM, deps })).message).toBe(
      "cmux could not be read, so a pinned cmux supervisor cannot be ruled out: cmux refused this process its socket",
    );
    expect(recorded).toEqual([]);
  });

  it("writes nothing while cmux holds a pinned workspace", async () => {
    const { deps, recorded } = fakes({ pinned: ok(["workspace:7"]) });
    expect(unwrapErr(await pinAppSession({ claim: CLAIM, deps })).message).toContain(
      "cmux already has workspace:7 pinned",
    );
    expect(recorded).toEqual([]);
  });

  it("writes nothing for a re-pin of the session already recorded, and releases the lock", async () => {
    const { deps, events, recorded } = fakes({
      disposition: {
        kind: "pin",
        record: { appSessionId: APP_ID, pinnedAtIso: "2026-11-09T01:30:00.000Z", session: CLAIM.session },
      },
    });
    expect(unwrap(await pinAppSession({ claim: CLAIM, deps }))).toEqual({
      label: `app:${APP_ID}`,
      plan: "already-recorded",
      wrote: false,
    });
    expect(recorded).toEqual([]);
    expect(events).toEqual(["lock", "origin", "cmux", "record-read", "release"]);
  });

  it("reports a record that would not write", async () => {
    const { deps } = fakes({ writes: false });
    expect(unwrapErr(await pinAppSession({ claim: CLAIM, deps })).message).toBe(
      `the supervisor pin record for app:${APP_ID} would not write`,
    );
  });
});
