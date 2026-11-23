import { describe, expect, it } from "vitest";

import {
  CROWDSTRIKE_CALLS,
  type CrowdstrikeCallId,
  callsRequiringScope,
  findCrowdstrikeCall,
  isCrowdstrikeCallId,
} from "../../../../atlas/crowdstrike/inventory.js";
import { CROWDSTRIKE_KINDS } from "../../../../atlas/crowdstrike/model.js";

describe("CROWDSTRIKE_CALLS", () => {
  it("admits no method other than GET or POST", () => {
    const methods = [...new Set(CROWDSTRIKE_CALLS.map((call) => call.method))].toSorted();
    expect(methods).toEqual(["GET", "POST"]);
  });

  it("admits no path that names a containment, response or action endpoint", () => {
    const forbidden = CROWDSTRIKE_CALLS.filter((call) =>
      /contain|real-time-response|\/actions?\/|action-v|\/rtr\//i.test(call.path),
    );
    expect(forbidden.map((call) => call.id)).toEqual([]);
  });

  it("gives every admitted POST an individual read justification", () => {
    const posts = CROWDSTRIKE_CALLS.filter((call) => call.method === "POST");
    expect(posts.map((call) => call.id)).toEqual(["oauth-token", "host-login-history", "alert-entities"]);
    const unjustified = posts.filter((call) => call.whyRead.length < 30);
    expect(unjustified.map((call) => call.id)).toEqual([]);
  });

  it("uses a unique id for every call", () => {
    const ids = CROWDSTRIKE_CALLS.map((call) => call.id);
    expect(ids.length).toBe(new Set(ids).size);
  });

  it("names only declared kinds", () => {
    const kinds = CROWDSTRIKE_CALLS.map((call) => call.kind).filter((kind) => kind !== null);
    const undeclared = kinds.filter((kind) => !CROWDSTRIKE_KINDS.includes(kind));
    expect(undeclared).toEqual([]);
  });

  it("requires a scope on every call except the token mint and the console document", () => {
    const scopeless = CROWDSTRIKE_CALLS.filter((call) => call.scope === null).map((call) => call.id);
    expect(scopeless).toEqual(["oauth-token", "console-sitemap"]);
  });

  it("gives every id-batch call a positive batch limit", () => {
    const batched = CROWDSTRIKE_CALLS.filter((call) => call.paging === "id-batch");
    const unbounded = batched.filter((call) => call.idBatchLimit === null || call.idBatchLimit <= 0);
    expect(unbounded.map((call) => call.id)).toEqual([]);
  });

  it("gives a batch limit only to id-batch calls", () => {
    // An explicit `boolean` stops TypeScript inferring a predicate no literal row satisfies, which types `stray` as never[].
    const stray = CROWDSTRIKE_CALLS.filter((call): boolean => call.paging !== "id-batch" && call.idBatchLimit !== null);
    expect(stray.map((call) => call.id)).toEqual([]);
  });
});

describe("findCrowdstrikeCall", () => {
  it("resolves an admitted call", () => {
    expect(findCrowdstrikeCall({ id: "hosts-visible-ids" }).path).toBe("/devices/queries/devices/v1");
  });

  it("resolves every admitted id to the row that declares it", () => {
    expect(CROWDSTRIKE_CALLS.length).toBeGreaterThan(0);
    const strays = CROWDSTRIKE_CALLS.filter((call) => findCrowdstrikeCall({ id: call.id }) !== call);
    expect(strays.map((call) => call.id)).toEqual([]);
  });

  // Before: an unknown id answered null at run time; the id is now closed, so the lookup cannot be asked it.
  it("refuses an undeclared id at compile time", () => {
    // @ts-expect-error -- "contain" is not an admitted call id
    const unknown: CrowdstrikeCallId = "contain";
    expect(isCrowdstrikeCallId(unknown)).toBe(false);
  });
});

describe("isCrowdstrikeCallId", () => {
  it("admits every inventory id", () => {
    expect(CROWDSTRIKE_CALLS.filter((call) => !isCrowdstrikeCallId(call.id)).map((call) => call.id)).toEqual([]);
  });

  it("refuses an id that is not admitted", () => {
    expect(isCrowdstrikeCallId("/devices/entities/devices-actions/v2")).toBe(false);
  });

  it("refuses a containment endpoint asked for by path, and a prototype member", () => {
    expect(isCrowdstrikeCallId("contain")).toBe(false);
    expect(isCrowdstrikeCallId("constructor")).toBe(false);
  });
});

describe("callsRequiringScope", () => {
  it("lists what one refused scope costs", () => {
    const ids = callsRequiringScope({ scope: "alerts:read" }).map((call) => call.id);
    expect(ids).toEqual(["alert-ids", "alert-entities"]);
  });

  it("returns nothing for a scope no admitted call needs", () => {
    expect(callsRequiringScope({ scope: "host-group:read" }).map((call) => call.kind)).toEqual([
      "host-group",
      "host-group",
    ]);
  });
});
