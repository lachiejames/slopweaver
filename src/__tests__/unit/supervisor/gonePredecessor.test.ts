/**
 * The one ledger row a GONE predecessor chair answers to, and the close that ends exactly that row — matched by the
 * exact id its pin record carries, never by slug, directory or recency.
 */
import { describe, expect, it } from "vitest";

import type { CmuxClient } from "../../../cmux/client.js";
import { listWorkspacesStrictOver } from "../../../cmux/strictInventory.js";
import type { CmuxCall } from "../../../cmux/workspaceAddresses.js";
import { ok, unwrap, unwrapErr } from "../../../lib/result.js";
import { foldSessions, type SessionEvent, type SessionItem } from "../../../sessions/session.js";
import type { SupervisorPinTarget } from "../../../sessions/supervisorPin.js";
import {
  goneCmuxConfirmation,
  gonePredecessorCloseEvent,
  gonePredecessorCloseReach,
  gonePredecessorLabel,
  gonePredecessorLedgerRow,
} from "../../../supervisor/gonePredecessor.js";
import { workspaceRow } from "../sessionHarness/fakeCmux.js";

const APP_ID = "5f0c2a1e-7d3b-4c8e-9a6f-1b2c3d4e5f60";
const APP_TARGET: SupervisorPinTarget = { appSessionId: APP_ID, kind: "app" };
const CMUX_TARGET = { kind: "cmux", workspaceId: "id-chair", workspaceRef: "workspace:9" } as const;
const AT = "2026-11-05T09:00:00.000Z";

/** One open ledger row with the fields the pairing reads. */
function row(over: Partial<SessionItem>): SessionItem {
  return { lastEventIso: AT, sessionKey: "fresh-supervisor-handoff-9290", spawnedIso: AT, status: "open", ...over };
}

describe("gonePredecessorLabel", () => {
  it("names an app chair by its app handle and a cmux chair by its recorded ref", () => {
    expect(gonePredecessorLabel({ target: APP_TARGET })).toBe(`app:${APP_ID}`);
    expect(gonePredecessorLabel({ target: CMUX_TARGET })).toBe("workspace:9");
  });
});

/** The strict inventory over a socket answering every call with one reply, decoded by the real strict reader. */
function strictInventoryOf({ reply }: { reply: unknown }): ReturnType<CmuxClient["listWorkspacesStrict"]> {
  const call: CmuxCall = () => Promise.resolve(ok(reply));
  return listWorkspacesStrictOver({ call })();
}

describe("goneCmuxConfirmation", () => {
  it("refuses when the window list carries a window with no id, which the everyday inventory drops silently", async () => {
    const refused = unwrapErr(
      goneCmuxConfirmation({
        inventory: await strictInventoryOf({ reply: { windows: [{}] } }),
        target: CMUX_TARGET,
      }),
    );
    expect(refused.code).toBe("GONE_PREDECESSOR_UNCONFIRMED");
    expect(refused.message).toContain("windows[0] carries no id");
  });

  it("refuses when the strict inventory lists the chair's workspace after all", () => {
    const listed = { ...workspaceRow({ n: 9 }), workspaceId: CMUX_TARGET.workspaceId };
    const refused = unwrapErr(goneCmuxConfirmation({ inventory: ok([listed]), target: CMUX_TARGET }));
    expect(refused.message).toContain("the strict inventory lists it");
  });

  it("confirms a chair the whole strict inventory does not list", async () => {
    const confirmed = goneCmuxConfirmation({
      inventory: await strictInventoryOf({ reply: { windows: [] } }),
      target: CMUX_TARGET,
    });
    expect(unwrap(confirmed)).toBeUndefined();
  });
});

describe("gonePredecessorLedgerRow", () => {
  it("pairs an app chair to the one open app row carrying its session id", () => {
    const chair = row({ harness: "app", sessionId: APP_ID });
    const other = row({ harness: "app", sessionId: "another", sessionKey: "seat" });
    expect(unwrap(gonePredecessorLedgerRow({ rows: [other, chair], target: APP_TARGET }))).toBe(chair);
  });

  it("pairs a cmux chair to the one open cmux row carrying its workspace id, whatever its ref became", () => {
    const chair = row({ harness: "cmux", workspaceId: "id-chair", workspaceRef: "workspace:164" });
    expect(unwrap(gonePredecessorLedgerRow({ rows: [chair], target: CMUX_TARGET }))).toBe(chair);
  });

  it("refuses when no open row carries the id, ignoring a closed one that does", () => {
    const closed = row({ harness: "app", sessionId: APP_ID, status: "closed" });
    const refused = unwrapErr(gonePredecessorLedgerRow({ rows: [closed], target: APP_TARGET }));
    expect(refused.code).toBe("GONE_PREDECESSOR_ROW_UNMATCHED");
    expect(refused.message).toContain("(0 open rows carry its id)");
  });

  it("refuses two open rows carrying the id rather than picking the newer", () => {
    const rows = [row({ harness: "app", sessionId: APP_ID }), row({ harness: "app", sessionId: APP_ID })];
    expect(unwrapErr(gonePredecessorLedgerRow({ rows, target: APP_TARGET })).message).toContain(
      "(2 open rows carry its id)",
    );
  });

  it("refuses when an open row carries the id under the other host", () => {
    const rows = [row({ harness: "cmux", sessionId: APP_ID })];
    expect(unwrapErr(gonePredecessorLedgerRow({ rows, target: APP_TARGET })).message).toContain(
      "an open row carries its id under another host",
    );
  });

  it("refuses when a cmux row carries the app id as its workspace id, which the fold reads as its session id", () => {
    const rows = [
      row({ harness: "app", sessionId: APP_ID, workspaceRef: `app:${APP_ID}` }),
      row({ harness: "cmux", workspaceId: APP_ID, workspaceRef: "workspace:9" }),
    ];
    expect(unwrapErr(gonePredecessorLedgerRow({ rows, target: APP_TARGET })).message).toContain(
      "an open row carries its id under another host",
    );
  });

  it("refuses a cmux row that never recorded a workspace id, which only a hand repair can pair", () => {
    const rows = [row({ harness: "cmux", workspaceRef: "workspace:9" })];
    expect(unwrapErr(gonePredecessorLedgerRow({ rows, target: CMUX_TARGET })).code).toBe(
      "GONE_PREDECESSOR_ROW_UNMATCHED",
    );
  });
});

/** One `spawned` event under the chair's key, with the fields the fold targets a close by. */
function spawnedEvent(over: Partial<Extract<SessionEvent, { kind: "spawned" }>>): SessionEvent {
  return {
    branch: "b",
    cwd: "/w",
    kind: "spawned",
    sessionKey: "fresh-supervisor-handoff-9290",
    surfaceRef: "surface:1",
    tsIso: AT,
    workspaceRef: "workspace:9",
    ...over,
  };
}

describe("gonePredecessorCloseReach", () => {
  it("counts the one row a close for the chair ends", () => {
    const events = [spawnedEvent({ harness: "app", sessionId: APP_ID, workspaceRef: `app:${APP_ID}` })];
    const chair = foldSessions({ events })[0]!;
    expect(gonePredecessorCloseReach({ events, row: chair })).toBe(1);
  });

  it("counts a sibling recording the same id as its workspace id at the same instant, which the close also ends", () => {
    const events = [
      spawnedEvent({ harness: "app", sessionId: APP_ID, workspaceRef: `app:${APP_ID}` }),
      spawnedEvent({ harness: "cmux", workspaceId: APP_ID, workspaceRef: "workspace:9" }),
    ];
    const chair = foldSessions({ events }).find((item) => item.harness === "app")!;
    expect(gonePredecessorCloseReach({ events, row: chair })).toBe(2);
  });
});

describe("gonePredecessorCloseEvent", () => {
  it("closes exactly the chosen row, never a sibling sharing its key and ref but spawned at another instant", () => {
    const spawned = ({ tsIso }: { tsIso: string }): SessionEvent => spawnedEvent({ harness: "cmux", tsIso });
    const later = "2026-11-05T10:00:00.000Z";
    const rows = foldSessions({ events: [spawned({ tsIso: AT }), spawned({ tsIso: later })] });
    const chosen = rows.find((item) => item.spawnedIso === AT)!;
    const close = gonePredecessorCloseEvent({ row: chosen, tsIso: "2026-11-05T11:00:00.000Z" });
    const after = foldSessions({ events: [spawned({ tsIso: AT }), spawned({ tsIso: later }), close] });
    expect(after.map((item) => [item.spawnedIso, item.status])).toEqual([
      [later, "open"],
      [AT, "closed"],
    ]);
  });

  it("names the row's session id, ref and spawn instant", () => {
    const chair = row({ harness: "app", sessionId: APP_ID, workspaceRef: `app:${APP_ID}` });
    expect(gonePredecessorCloseEvent({ row: chair, tsIso: "t" })).toEqual({
      kind: "closed",
      sessionId: APP_ID,
      sessionKey: "fresh-supervisor-handoff-9290",
      spawnedIso: AT,
      tsIso: "t",
      workspaceRef: `app:${APP_ID}`,
    });
  });
});
