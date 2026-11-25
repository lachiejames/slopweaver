/**
 * The collision rule for an app-hosted session recording itself as the supervisor: one supervisor across both hosts,
 * an unreadable record never overwritten, and a re-pin of the same session a no-op.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import { AppPinErrors, appPinLabel, appPinPlan } from "../../../supervisor/appPin.js";

const APP_ID = "5f0c2a1e-7d3b-4c8e-9a6f-1b2c3d4e5f60";
const OTHER_APP_ID = "5f0c2a1e-7d3b-4c8e-9a6f-1b2c3d4e5f61";
const SESSION = { host: "claude-code", id: "a0000013-0000-4000-8000-000000000014" } as const;
const AT = "2026-11-09T01:00:00.000Z";

describe("appPinPlan", () => {
  it("records the caller when nothing is pinned in cmux and nothing is recorded", () => {
    expect(unwrap(appPinPlan({ appSessionId: APP_ID, disposition: { kind: "absent" }, pinnedWorkspaceRefs: [] }))).toBe(
      "record",
    );
  });

  it("is a no-op for a re-pin of the very app session recorded", () => {
    const disposition = { kind: "pin", record: { appSessionId: APP_ID, pinnedAtIso: AT, session: SESSION } } as const;
    expect(unwrap(appPinPlan({ appSessionId: APP_ID, disposition, pinnedWorkspaceRefs: [] }))).toBe("already-recorded");
  });

  it("refuses while cmux has a pinned workspace, naming it, whatever the record says", () => {
    const refused = unwrapErr(
      appPinPlan({ appSessionId: APP_ID, disposition: { kind: "absent" }, pinnedWorkspaceRefs: ["workspace:7"] }),
    );
    expect(refused).toEqual(AppPinErrors.cmuxHeld({ workspaceRefs: ["workspace:7"] }));
    expect(refused.message).toContain("cmux already has workspace:7 pinned");
  });

  it("refuses a record naming a different app session, rather than replacing it by precedence", () => {
    const disposition = {
      kind: "pin",
      record: { appSessionId: OTHER_APP_ID, pinnedAtIso: AT, session: SESSION },
    } as const;
    expect(unwrapErr(appPinPlan({ appSessionId: APP_ID, disposition, pinnedWorkspaceRefs: [] }))).toEqual(
      AppPinErrors.otherRecorded({ label: `app:${OTHER_APP_ID}` }),
    );
  });

  it("refuses a stale cmux record even when cmux reports nothing pinned", () => {
    const disposition = {
      kind: "pin",
      record: { pinnedAtIso: AT, session: SESSION, workspaceId: "W", workspaceRef: "workspace:3" },
    } as const;
    expect(unwrapErr(appPinPlan({ appSessionId: APP_ID, disposition, pinnedWorkspaceRefs: [] })).code).toBe(
      "OTHER_PIN_RECORDED",
    );
  });

  it("refuses an unreadable record, which could be either arm", () => {
    const refused = unwrapErr(
      appPinPlan({
        appSessionId: APP_ID,
        disposition: { kind: "unreadable", why: "the supervisor pin does not parse as one record shape" },
        pinnedWorkspaceRefs: [],
      }),
    );
    expect(refused.code).toBe("PIN_RECORD_UNREADABLE");
    expect(refused.message).toBe(
      "the supervisor pin does not parse as one record shape, and it could name either a cmux workspace or an app session, so it is not overwritten",
    );
  });
});

describe("appPinLabel", () => {
  it("is the harness handle", () => {
    expect(appPinLabel({ appSessionId: APP_ID })).toBe(`app:${APP_ID}`);
  });
});
