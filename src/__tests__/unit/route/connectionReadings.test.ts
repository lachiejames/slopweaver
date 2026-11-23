/**
 * The effectful half of door grading — grant files under a throwaway home, and the recorded Chrome profile
 * through its port over an in-memory store, read back as readings.
 *
 * Filesystem only, and only into a `mkdtempSync` directory this file removes: no socket is opened and no
 * token is read back out of a grant, which is the property that lets every routing host grade its doors on
 * the way to answering one question.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { connectionRouteReadings } from "../../../route/connectionReadings.js";
import type { SourceCapability } from "../../../route/profile.js";
import { driveGrantStore } from "../../../secrets/driveGrant.js";
import { gmailGrantStore } from "../../../secrets/gmailGrant.js";
import { memoryRecordedProfilePort, unavailableRecordedProfilePort } from "../../recordedProfileFixture.js";
import { FIXTURE_OUTAGE_REASON, memorySingletonStore } from "../../singletonRegisterFixture.js";

const homes: string[] = [];

/** The recorded-profile door over an empty in-memory store, for every case that does not seed or watch it. */
const profiles = memoryRecordedProfilePort();

/** A throwaway state home, removed when the file finishes. */
function newHome(): string {
  const home = mkdtempSync(join(tmpdir(), "route-doors-"));
  homes.push(home);
  return home;
}

/** One door row, carrying only what this grading reads: its id. */
function row({ id }: { id: string }): SourceCapability {
  return {
    availability: { kind: "available" },
    command: ["slopweaver", id, "drives"],
    coverage: { detail: "the door's declared scope", kind: "bounded" },
    effect: "read",
    freshness: { detail: "live", kind: "live" },
    id,
    owner: "slopweaver",
    sourceClass: "provider",
    terms: ["file"],
    truthMode: "current",
    what: "a door",
  };
}

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

describe("connectionRouteReadings", async () => {
  it("reports a door with no grant file as not connected, naming the door", async () => {
    const readings = await connectionRouteReadings({ capabilities: [row({ id: "drive" })], home: newHome(), profiles });
    expect(readings.get("drive")).toEqual({
      connected: false,
      door: "drive",
      why: "no drive grant is stored on this install",
    });
  });

  it("reports a stored grant as connected, carrying the account and never the token", async () => {
    const home = newHome();
    const written = driveGrantStore.write({
      grant: {
        account: "owner@example.com",
        grantedAtIso: "2026-09-05T01:14:31.699Z",
        refreshToken: "never-read-back",
        scopes: ["https://www.googleapis.com/auth/drive.readonly"],
      },
      home,
    });
    expect(written.isOk()).toBe(true);
    const readings = await connectionRouteReadings({ capabilities: [row({ id: "drive" })], home, profiles });
    expect(readings.get("drive")).toEqual({ account: "owner@example.com", connected: true, door: "drive" });
    expect(JSON.stringify([...readings.values()])).not.toContain("never-read-back");
  });

  it("carries a corrupt grant's own message rather than calling it absent", async () => {
    const home = newHome();
    const path = gmailGrantStore.path({ home });
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "{ not json", "utf8");
    const reading = (await connectionRouteReadings({ capabilities: [row({ id: "gmail" })], home, profiles })).get(
      "gmail",
    )!;
    expect(reading.connected).toBe(false);
    expect(JSON.stringify(reading)).toContain("not valid JSON");
  });

  it("reads only the doors the table names, so a table with none opens nothing — the store included", async () => {
    const store = memorySingletonStore();
    const readings = await connectionRouteReadings({
      capabilities: [row({ id: "corpus" })],
      home: newHome(),
      profiles: memoryRecordedProfilePort({ store }),
    });
    expect([...readings.keys()]).toEqual([]);
    expect(store.opened).toBe(0);
  });

  it("reports a machine with no recorded Chrome profile as an unreachable browser door", async () => {
    const readings = await connectionRouteReadings({
      capabilities: [row({ id: "browser" })],
      home: newHome(),
      profiles,
    });
    expect(readings.get("browser")).toEqual({
      connected: false,
      door: "browser",
      why: "no Chrome profile has been recorded on this machine",
    });
  });

  it("reports a recorded Chrome profile as connected, carrying the directory the store's row names", async () => {
    const readings = await connectionRouteReadings({
      capabilities: [row({ id: "browser" })],
      home: newHome(),
      profiles: memoryRecordedProfilePort({ directory: "Profile 3" }),
    });
    expect(readings.get("browser")).toEqual({ account: "Profile 3", connected: true, door: "browser" });
  });

  it("imports a retired browser.json into the row once, then grades the door off the row", async () => {
    const home = newHome();
    const store = memorySingletonStore();
    writeFileSync(join(home, "browser.json"), JSON.stringify({ profileDirectory: "Default" }), "utf8");
    const readings = await connectionRouteReadings({
      capabilities: [row({ id: "browser" })],
      home,
      profiles: memoryRecordedProfilePort({ store }),
    });
    expect(readings.get("browser")).toEqual({ account: "Default", connected: true, door: "browser" });
    expect(store.rows.get(home)).toEqual({ document: { profileDirectory: "Default" }, revision: 1 });
  });

  it("grades the browser door unreachable with the store's own reason when the store is down", async () => {
    const reading = (
      await connectionRouteReadings({
        capabilities: [row({ id: "browser" })],
        home: newHome(),
        profiles: unavailableRecordedProfilePort(),
      })
    ).get("browser")!;
    expect(reading.connected).toBe(false);
    expect(JSON.stringify(reading)).toContain(FIXTURE_OUTAGE_REASON);
  });
});
