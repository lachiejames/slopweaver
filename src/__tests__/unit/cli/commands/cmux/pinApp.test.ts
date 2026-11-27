/**
 * `cmux pin` from inside an app-hosted session, over plain fakes: the app's answer, one cmux listing, the strict
 * record and a writer that records what it was asked to write. No socket, no cmux, no file.
 */
import { describe, expect, it } from "vitest";

import { type AppPinDeps, pinAppSession } from "../../../../../cli/commands/cmux/pinApp.js";
import { err, ok, type Result, unwrap, unwrapErr } from "../../../../../lib/result.js";
import type { AppHarnessResponse } from "../../../../../sessionHarness/appProtocol.js";
import type { AppSessionClaim } from "../../../../../sessionHarness/appSessionOrigin.js";
import type { AppTransport, AppTransportFailure } from "../../../../../sessionHarness/appSocketTransport.js";
import type { SupervisorPinDisposition } from "../../../../../sessions/supervisorPinStore.js";

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

/** The fakes, with every record call kept so a case can say whether anything was written. */
function fakes({
  answer = ok(VOUCHED),
  pinned = ok([]),
  disposition = { kind: "absent" },
  writes = true,
}: {
  answer?: Result<AppHarnessResponse, AppTransportFailure>;
  pinned?: Result<readonly string[], { readonly message: string }>;
  disposition?: SupervisorPinDisposition;
  writes?: boolean;
}): { deps: AppPinDeps; recorded: unknown[] } {
  const recorded: unknown[] = [];
  const transport: AppTransport = async () => answer;
  return {
    deps: {
      nowIso: () => NOW,
      pinnedWorkspaceRefs: async () => pinned,
      readDisposition: () => disposition,
      record: (options) => {
        recorded.push(options);
        return writes;
      },
      transport,
    },
    recorded,
  };
}

describe("pinAppSession", () => {
  it("records the vouched app session and says so", async () => {
    const { deps, recorded } = fakes({});
    expect(unwrap(await pinAppSession({ claim: CLAIM, deps }))).toEqual({
      label: `app:${APP_ID}`,
      plan: "record",
      wrote: true,
    });
    expect(recorded).toEqual([{ appSessionId: APP_ID, nowIso: NOW, session: CLAIM.session }]);
  });

  it("writes nothing when the app refuses the origin claim", async () => {
    const { deps, recorded } = fakes({
      answer: err({ code: "ORIGIN_REFUSED", kind: "refused", message: "that session runs another vendor id" }),
    });
    expect(unwrapErr(await pinAppSession({ claim: CLAIM, deps })).message).toBe(
      "the desktop app did not vouch for this session: that session runs another vendor id",
    );
    expect(recorded).toEqual([]);
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

  it("writes nothing for a re-pin of the session already recorded", async () => {
    const { deps, recorded } = fakes({
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
  });

  it("reports a record that would not write", async () => {
    const { deps } = fakes({ writes: false });
    expect(unwrapErr(await pinAppSession({ claim: CLAIM, deps })).message).toBe(
      `the supervisor pin record for app:${APP_ID} would not write`,
    );
  });
});
