import { describe, expect, it } from "vitest";

import {
  applyUpdate,
  blockedDeletes,
  checkDeletable,
  deleteMonitors,
  readMonitors,
  validateUpdate,
} from "../../../datadog/monitorApi.js";
import { planMonitorUpdate } from "../../../datadog/monitorWrite.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import { cpuMonitor, fakeMonitorApi } from "../../monitorApiFake.js";

const EXCLUDED = "avg(last_5m):avg:system.cpu.user{!host:adaowner-macbook-pro} by {host} > 90";
const DISK = cpuMonitor({ id: 50792, name: "Host disk usage high" });

describe("readMonitors", () => {
  it("reads every id in the order given", async () => {
    const { api } = fakeMonitorApi({ monitors: [cpuMonitor(), DISK] });
    const monitors = unwrap(await readMonitors({ api, ids: [50792, 50100] }));
    expect(monitors.map((monitor) => monitor.id)).toEqual([50792, 50100]);
  });

  it("names the monitor it could not read, with Datadog's status", async () => {
    const { api } = fakeMonitorApi({ monitors: [cpuMonitor()] });
    const error = unwrapErr(await readMonitors({ api, ids: [50100, 1] }));
    expect(error.code).toBe("READ_FAILED");
    expect(error.message).toContain("could not read monitor 1: HTTP 404");
  });

  it("refuses a body that is not a monitor rather than guessing at it", async () => {
    const { api } = fakeMonitorApi({ monitors: [] });
    const error = unwrapErr(await readMonitors({ api: { ...api, get: () => Promise.resolve({ id: 7 }) }, ids: [7] }));
    expect(error.message).toContain("the response is not a monitor");
  });
});

describe("validateUpdate and applyUpdate", () => {
  it("surfaces Datadog's validator refusal and writes nothing", async () => {
    const { api, writes } = fakeMonitorApi({ behaviour: { validateStatus: 400 }, monitors: [cpuMonitor()] });
    const plan = unwrap(planMonitorUpdate({ live: cpuMonitor(), patch: { query: EXCLUDED } }));
    expect(unwrapErr(await validateUpdate({ api, plan })).code).toBe("VALIDATE_REJECTED");
    expect(writes).toEqual([]);
  });

  it("sends only the planned body and answers with the monitor as it now stands", async () => {
    const { api, writes } = fakeMonitorApi({ monitors: [cpuMonitor()] });
    const plan = unwrap(planMonitorUpdate({ live: cpuMonitor(), patch: { query: EXCLUDED } }));
    const after = unwrap(await applyUpdate({ api, plan }));
    expect(writes).toEqual([{ body: { query: EXCLUDED }, id: 50100, kind: "update" }]);
    expect(after.query).toBe(EXCLUDED);
  });
});

describe("blockedDeletes", () => {
  it("gives a refused id its reasons, and one with none a stated reason rather than nothing", () => {
    expect(blockedDeletes({ deletability: { errors: { "2": ["used in SLO 9"] }, ok: [1] }, ids: [1, 2, 3] })).toEqual({
      "2": ["used in SLO 9"],
      "3": ["not cleared by can_delete, with no reason given"],
    });
  });
});

describe("checkDeletable and deleteMonitors", () => {
  it("refuses the whole list when can_delete refuses any one of it", async () => {
    const { api } = fakeMonitorApi({
      behaviour: { referenced: { "50792": ["used in SLO 9"] } },
      monitors: [cpuMonitor(), DISK],
    });
    const error = unwrapErr(await checkDeletable({ api, ids: [50100, 50792] }));
    expect(error.code).toBe("CANNOT_DELETE");
    expect(error.message).toContain("50792 (used in SLO 9)");
  });

  it("names a can_delete call that failed as unknown, never as cleared", async () => {
    const { api } = fakeMonitorApi({ monitors: [] });
    const failing = { ...api, canDelete: () => Promise.reject(new Error("socket hang up")) };
    expect(unwrapErr(await checkDeletable({ api: failing, ids: [1] })).code).toBe("DELETE_CHECK_FAILED");
  });

  it("stops at the first refused delete and names what had already gone", async () => {
    const { api, store } = fakeMonitorApi({ behaviour: { refuseRemove: [50792] }, monitors: [cpuMonitor(), DISK] });
    const error = unwrapErr(await deleteMonitors({ api, ids: [50100, 50792] }));
    expect(error).toMatchObject({ code: "WRITE_REJECTED", doneBefore: [50100], id: 50792 });
    expect([...store.keys()]).toEqual([50792]);
  });
});
