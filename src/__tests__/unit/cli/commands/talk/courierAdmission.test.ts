/**
 * The courier's admission over scripted cmux lookups: a first start refuses on the first failed one, as it always has,
 * and a follower a re-exec started asks again until cmux names the chair, ending at once only on a definite refusal.
 */
import { describe, expect, it } from "vitest";

import { admitCourier, type CourierAdmission } from "../../../../../cli/commands/talk/courierAdmission.js";

const AT = "2026-10-31T06:30:00.000Z";

describe("admitCourier", () => {
  const unreachable: CourierAdmission = { kind: "undecided", why: "talk courier could not reach cmux: ECONNREFUSED" };
  const unpinned: CourierAdmission = {
    kind: "undecided",
    why: "talk courier types into the pinned chair, and no workspace is pinned",
  };
  const refused: CourierAdmission = {
    kind: "refused",
    why: "talk courier runs only inside the pinned supervisor chair",
  };

  /** Admission over scripted lookups, recording every sleep and every line said. */
  async function admitOver({
    lookups,
    reexecAtIso,
  }: {
    lookups: CourierAdmission[];
    reexecAtIso: string | undefined;
  }): Promise<{
    readonly refusal: string | undefined;
    readonly asked: number;
    readonly sleeps: number[];
    readonly said: string[];
  }> {
    const sleeps: number[] = [];
    const said: string[] = [];
    let asked = 0;
    const refusal = await admitCourier({
      admit: async () => {
        asked += 1;
        return lookups.shift()!;
      },
      error: ({ line }) => {
        said.push(line);
      },
      reexecAtIso,
      sleep: async ({ ms }) => {
        sleeps.push(ms);
      },
    });
    return { asked, refusal, said, sleeps };
  }

  it("refuses a first start on the first failed lookup, as before", async () => {
    const run = await admitOver({ lookups: [unreachable, { kind: "admitted" }], reexecAtIso: undefined });
    expect(run.refusal).toBe("talk courier could not reach cmux: ECONNREFUSED");
    expect(run.asked).toBe(1);
    expect(run.sleeps).toEqual([]);
  });

  it("asks a re-executed follower's cmux again until it answers, saying so once", async () => {
    const run = await admitOver({ lookups: [unreachable, unreachable, { kind: "admitted" }], reexecAtIso: AT });
    expect(run.refusal).toBe(undefined);
    expect(run.asked).toBe(3);
    expect(run.sleeps).toEqual([5_000, 5_000]);
    expect(run.said).toEqual([
      "talk courier could not reach cmux: ECONNREFUSED — re-executed a moment ago, so asking again every 5s until cmux names the chair",
    ]);
  });

  it("waits a re-executed follower through a moment with no chair pinned, as the follower it replaced would", async () => {
    const run = await admitOver({ lookups: [unpinned, unpinned, { kind: "admitted" }], reexecAtIso: AT });
    expect(run.refusal).toBe(undefined);
    expect(run.asked).toBe(3);
  });

  it("refuses a first start with no chair pinned on the first lookup, as before", async () => {
    const run = await admitOver({ lookups: [unpinned, { kind: "admitted" }], reexecAtIso: undefined });
    expect(run.refusal).toBe("talk courier types into the pinned chair, and no workspace is pinned");
    expect(run.asked).toBe(1);
  });

  it("never gives a re-executed follower up while cmux is unreachable, as the follower it replaced would not", async () => {
    const outage: CourierAdmission[] = Array.from({ length: 200 }, () => unreachable);
    const run = await admitOver({ lookups: [...outage, { kind: "admitted" }], reexecAtIso: AT });
    expect(run.refusal).toBe(undefined);
    expect(run.asked).toBe(201);
    expect(run.sleeps.length).toBe(200);
    expect(run.said.length).toBe(1);
  });

  it("ends a re-executed follower at once when cmux comes back and names another chair", async () => {
    const run = await admitOver({ lookups: [unreachable, unreachable, refused], reexecAtIso: AT });
    expect(run.refusal).toBe("talk courier runs only inside the pinned supervisor chair");
    expect(run.asked).toBe(3);
  });

  it("never retries a definite refusal, re-executed or not", async () => {
    const run = await admitOver({ lookups: [refused, { kind: "admitted" }], reexecAtIso: AT });
    expect(run.refusal).toBe("talk courier runs only inside the pinned supervisor chair");
    expect(run.asked).toBe(1);
  });
});
