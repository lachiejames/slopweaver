/*
 * The control plane's answer to a `session.origin` claim, and the hidden vendor session id it compares against: the
 * registry takes the id from the worker's `ready` report, holds it beside the snapshot, matches a claim only on the
 * exact id for a reachable session of the claimed vendor, and never lets the id reach a list, card, picture, usage
 * report or refusal line the app renders.
 */
import { describe, expect, it } from "vitest";

import { sessionCardFrameUrl, sessionCardUrl } from "../../src/sessionCard";
import { sessionPictureOf } from "../../src/sessionFacts";
import { sessionOriginOf } from "../../src/sessionOrigin";
import { reduceRegistry } from "../../src/sessionRegistry";
import { EMPTY_REGISTRY, type RegistryEvent, type SessionRegistry } from "../../src/sessionRegistryShape";
import { usageReportOf } from "../../src/sessionUsage";

const AT = "2026-11-09T01:00:00.000Z";
const ID = "0b5e";
const HELD = "FIXTURE-THREAD-1";

function apply({ registry, events }: { registry: SessionRegistry; events: readonly RegistryEvent[] }): SessionRegistry {
  return events.reduce((held, event) => reduceRegistry({ event, registry: held }).registry, registry);
}

const PREPARED: RegistryEvent = {
  atIso: AT,
  kind: "prepared",
  launchToken: "token-1",
  sessionId: ID,
  spec: {
    codexHome: "/home/codex",
    directory: "/work/acme",
    judgedInstanceId: "instance-a",
    ledgerKey: "abc-1",
    title: "abc-1",
    vendor: "codex",
  },
};

const READY: RegistryEvent = {
  atIso: AT,
  kind: "worker",
  report: { kind: "ready", sessionId: ID, vendorSessionId: HELD },
};

const starting = apply({ events: [PREPARED], registry: EMPTY_REGISTRY });
const idle = apply({ events: [READY], registry: starting });
const closed = apply({ events: [{ atIso: AT, failed: false, kind: "gone", sessionId: ID }], registry: idle });

describe("the registry's hidden vendor session id", () => {
  it("is absent while the session starts, and is the worker's ready report's id once it is up", () => {
    expect(starting.get(ID)!.vendorSessionId).toBe(undefined);
    expect(idle.get(ID)!.vendorSessionId).toBe(HELD);
  });

  it("is never on the snapshot a list, a resolve or an origin answer carries", () => {
    const snapshot = idle.get(ID)!.snapshot;
    expect(Object.keys(snapshot).toSorted()).toEqual([
      "directory",
      "handle",
      "ledgerKey",
      "openedAtIso",
      "sessionId",
      "state",
      "title",
      "vendor",
    ]);
    expect(JSON.stringify([...idle.values()].map((entry) => entry.snapshot))).not.toContain(HELD);
  });

  it("never reaches the card, the picture or the usage report the app renders from the entry that holds it", () => {
    const entry = idle.get(ID)!;
    expect(JSON.stringify(entry)).toContain(HELD);
    const rendered = [
      sessionCardUrl({ note: undefined, snapshot: entry.snapshot }),
      sessionCardFrameUrl({ note: "a note", snapshot: entry.snapshot }),
      JSON.stringify(sessionPictureOf({ entry, readAtIso: AT })),
      JSON.stringify(usageReportOf({ atIso: AT, entries: idle.values() })),
    ];
    expect(rendered.map((surface) => surface.includes(HELD))).toEqual([false, false, false, false]);
  });
});

describe("sessionOriginOf", () => {
  it("answers the claimed session's snapshot when the vendor and the exact vendor session id match", () => {
    const matched = sessionOriginOf({ appSessionId: ID, registry: idle, vendor: "codex", vendorSessionId: HELD });
    expect(matched._unsafeUnwrap()).toEqual(idle.get(ID)!.snapshot);
  });

  it("refuses a vendor session id that is not exactly the one held, never saying which one is", () => {
    const claims = ["FIXTURE-THREAD-2", "FIXTURE-THREAD-10", "fixture-thread-1", ` ${HELD}`];
    const refusals = claims.map((vendorSessionId) =>
      sessionOriginOf({ appSessionId: ID, registry: idle, vendor: "codex", vendorSessionId })._unsafeUnwrapErr(),
    );
    expect(refusals).toEqual(
      claims.map(() => ({
        code: "ORIGIN_REFUSED",
        message: "app session 0b5e does not run the vendor session this caller is in",
      })),
    );
    expect(JSON.stringify(refusals)).not.toContain(HELD);
  });

  it("refuses a claim naming the session under the other vendor, even with the right id", () => {
    const refused = sessionOriginOf({ appSessionId: ID, registry: idle, vendor: "claude", vendorSessionId: HELD });
    expect(refused._unsafeUnwrapErr()).toEqual({
      code: "ORIGIN_REFUSED",
      message: "app session 0b5e is a codex session, not a claude one",
    });
  });

  it("refuses a session that has not reported its vendor session yet", () => {
    const refused = sessionOriginOf({ appSessionId: ID, registry: starting, vendor: "codex", vendorSessionId: HELD });
    expect(refused._unsafeUnwrapErr()).toEqual({
      code: "ORIGIN_REFUSED",
      message: "app session 0b5e has not reported its vendor session yet, so no claim on it can be matched",
    });
  });

  it("refuses an unknown session and a closed one alike, as unreachable", () => {
    const claims = [
      { appSessionId: "9f1c", registry: idle },
      { appSessionId: ID, registry: closed },
    ];
    expect(
      claims.map(
        ({ appSessionId, registry }) =>
          sessionOriginOf({ appSessionId, registry, vendor: "codex", vendorSessionId: HELD })._unsafeUnwrapErr()
            .message,
      ),
    ).toEqual(["no reachable app session 9f1c", "no reachable app session 0b5e"]);
  });
});
