import { describe, expect, it } from "vitest";

import { seatPinnedStore } from "../../../../../cli/commands/cmux/reseatEffects.js";
import { err, unwrap, unwrapErr } from "../../../../../lib/result.js";
import { PlanRegisterErrors } from "../../../../../plans/errors.js";
import type { PlanRegisterPort } from "../../../../../plans/port.js";
import { unavailablePlanRegisterPort } from "../../../../planRegisterFixture.js";

const HOME = "/homes/selected";

describe("seatPinnedStore — the store a relaunched seat is judged on rather than routed", () => {
  it("boots the chair on the store --plan named, outranking its role pin", async () => {
    const pinned = await seatPinnedStore({
      chair: true,
      home: HOME,
      namedStoreDir: "/stores/plan-three",
      port: unavailablePlanRegisterPort(),
    });
    expect(unwrap(pinned)).toBe("/stores/plan-three");
  });

  it("boots a worker on the store --plan named", async () => {
    const pinned = await seatPinnedStore({
      chair: false,
      home: HOME,
      namedStoreDir: "/stores/plan-three",
      port: unavailablePlanRegisterPort(),
    });
    expect(unwrap(pinned)).toBe("/stores/plan-three");
  });

  it("pins nothing for a worker with no plan named, so routing decides", async () => {
    const pinned = await seatPinnedStore({
      chair: false,
      home: HOME,
      namedStoreDir: undefined,
      port: unavailablePlanRegisterPort(),
    });
    expect(unwrap(pinned)).toBe(undefined);
  });

  // The falsifiable partner of the three above, which pass the same outage port and never read it: the chair with
  // no plan named still READS the register (only a publisher pins, so a readable one answers undefined and the
  // chair routes), and an outage there refuses rather than booting the chair on a register nobody could read.
  it("refuses a chair with no plan named when the register's store could not answer", async () => {
    const pinned = await seatPinnedStore({
      chair: true,
      home: HOME,
      namedStoreDir: undefined,
      port: unavailablePlanRegisterPort(),
    });
    const error = unwrapErr(pinned);
    expect(error.code).toBe("ACCOUNT_CONFIG_STORE_UNAVAILABLE");
    expect(error.message).toContain("ECONNREFUSED");
  });

  // `cmux reseat --home <dir>` boots its credential from <dir>, so the chair's pin must be read from
  // <dir>'s register too. A read of the ambient home could pass while the register the seat boots under does not.
  it("reads the chair's pin from the home the seat boots under, never the ambient one", async () => {
    const homesRead: string[] = [];
    const port: PlanRegisterPort = {
      read: ({ home }) => {
        homesRead.push(home);
        return Promise.resolve(
          err(PlanRegisterErrors.registerStoreUnavailable({ doing: "be opened", reason: "a fixture outage" })),
        );
      },
      write: () =>
        Promise.resolve(err(PlanRegisterErrors.registerStoreUnavailable({ doing: "be opened", reason: "unused" }))),
    };
    const pinned = await seatPinnedStore({ chair: true, home: HOME, namedStoreDir: undefined, port });
    expect(unwrapErr(pinned).code).toBe("ACCOUNT_CONFIG_STORE_UNAVAILABLE");
    expect(homesRead).toEqual([HOME]);
  });
});
