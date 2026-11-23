import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { handRegisterPath } from "../../../hand/store.js";
import { readOrgHealth } from "../../../monitor/orgHealthSource.js";
import type { OrgHealthPort } from "../../../orgHealth/port.js";
import {
  type MemoryOrgHealthStore,
  memoryOrgHealthPort,
  memoryOrgHealthStore,
  seedOrgHealthSnapshot,
  unavailableOrgHealthPort,
} from "../../orgHealthStoreFixture.js";
import { measuredSnapshot, NOW_MS, orgIncident } from "../orgHealth/orgIncidentFixture.js";

describe("readOrgHealth", () => {
  let home: string;
  let store: MemoryOrgHealthStore;
  let port: OrgHealthPort;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "org-health-source-"));
    store = memoryOrgHealthStore();
    port = memoryOrgHealthPort({ store });
  });
  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("is unmeasurable before any read has run", async () => {
    expect(await readOrgHealth({ home, nowMs: NOW_MS, port })).toEqual({
      because: "no incident read has run — `slopweaver org-health read` writes the snapshot this judges",
      monitorId: "org-health",
      state: "unmeasurable",
    });
  });

  it("fires on the snapshot a read published, with an empty register holding nothing", async () => {
    seedOrgHealthSnapshot({ home, snapshot: measuredSnapshot({ incidents: [orgIncident()] }), store });
    const reading = await readOrgHealth({ home, nowMs: NOW_MS, port });
    const firing = reading as Extract<typeof reading, { state: "firing" }>;
    expect([firing.state, firing.subjects[0]!.key, firing.subjects[0]!.delivery]).toEqual([
      "firing",
      "inc98-critical-20261004080000000",
      undefined,
    ]);
  });

  it("is unmeasurable, never clear, when the store cannot be reached", async () => {
    const reading = await readOrgHealth({ home, nowMs: NOW_MS, port: unavailableOrgHealthPort() });
    expect([reading.state, (reading as Extract<typeof reading, { state: "unmeasurable" }>).because]).toEqual([
      "unmeasurable",
      expect.stringContaining("the store could not be opened"),
    ]);
  });

  it("is unmeasurable when the hand register cannot be read, since a closed note would be re-posted", async () => {
    seedOrgHealthSnapshot({ home, snapshot: measuredSnapshot({ incidents: [orgIncident()] }), store });
    // A directory where the register file belongs: the read fails rather than finding no rows.
    mkdirSync(handRegisterPath({ home }), { recursive: true });
    const reading = await readOrgHealth({ home, nowMs: NOW_MS, port });
    expect(reading.state).toBe("unmeasurable");
    expect((reading as Extract<typeof reading, { state: "unmeasurable" }>).because).toContain(
      "the hand register could not be read",
    );
  });
});
