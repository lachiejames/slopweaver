/**
 * `datadog monitor` at the REAL command boundary, over an in-memory Datadog: a write reaches it only with an
 * `--approve` that matches the change as it stands at write time. The witness is the fake's `writes`, a value
 * that MOVES when Datadog is reached, and each refusal below has a sibling proving the same run does reach it.
 *
 * `--home` is a fresh temp directory on every run, because the door records its decision in that home's ledger.
 */
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { DoorLedgerPort } from "../../../../../admit/doorLedgerPort.js";
import { runDatadogMonitorWith } from "../../../../../cli/commands/datadog/monitorRun.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import {
  type MonitorSnapshot,
  monitorDeleteDigest,
  monitorUpdateDigest,
  planMonitorUpdate,
} from "../../../../../datadog/monitorWrite.js";
import { err, ok, type Result, unwrap } from "../../../../../lib/result.js";
import { type Profile, parseProfile } from "../../../../../profile.js";
import { type ProfileReadError, ProfileReadErrors } from "../../../../../profileStore.js";
import { type MemoryDoorLedger, memoryDoorLedger, unreachableDoorLedger } from "../../../../doorLedgerFixture.js";
import { cpuMonitor, fakeMonitorApi, type MonitorFakeBehaviour } from "../../../../monitorApiFake.js";

const EXCLUDED = "avg(last_5m):avg:system.cpu.user{!host:adaowner-macbook-pro} by {host} > 90";
const MANAGED = cpuMonitor({ tags: ["managed-by:acme-iac", "team:platform"] });
const DISK = cpuMonitor({ id: 50792, name: "Host disk usage high" });

/** A profile whose `datadog.iacManagedTags` arms the guard with the one synthetic tag {@link MANAGED} carries. */
const ARMED: Profile = unwrap(
  parseProfile({
    value: {
      datadog: { iacManagedTags: ["managed-by:acme-iac"] },
      displayName: "",
      gitNamespace: "",
      id: "me",
      schemaVersion: 1,
      sources: [],
    },
  }),
);

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "slopweaver-dd-monitor-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** Run the verb over a fake holding `monitors`, with the profile read answering `profile`. */
async function run({
  tail,
  monitors = [cpuMonitor()],
  behaviour = {},
  profile = ok(ARMED),
  door = memoryDoorLedger(),
  doorLedger = door.port,
}: {
  tail: readonly string[];
  monitors?: readonly MonitorSnapshot[];
  behaviour?: MonitorFakeBehaviour;
  profile?: Result<Profile | null, ProfileReadError>;
  door?: MemoryDoorLedger;
  doorLedger?: DoorLedgerPort;
}): Promise<{
  code: number;
  door: MemoryDoorLedger;
  fake: ReturnType<typeof fakeMonitorApi>;
  apiHomes: readonly string[];
  profileHomes: readonly string[];
}> {
  const fake = fakeMonitorApi({ behaviour, monitors });
  const apiHomes: string[] = [];
  const profileHomes: string[] = [];
  const code = await runDatadogMonitorWith({
    argv: ["node", "cli", "datadog", "monitor", ...tail, "--home", home],
    deps: {
      createApi: ({ home: seen }) => {
        apiHomes.push(seen);
        return ok(fake.api);
      },
      doorLedger,
      readProfile: ({ home: seen }) => {
        profileHomes.push(seen);
        return profile;
      },
    },
  });
  return { apiHomes, code, door, fake, profileHomes };
}

/** A profile read that never answers: `show` must not ask for one. */
const NO_PROFILE_READ = (): Result<Profile | null, ProfileReadError> => {
  throw new Error("show read the profile");
};

/** The digest a preview of `--query EXCLUDED` against `live` prints. */
function queryDigest({ live }: { live: MonitorSnapshot }): string {
  return monitorUpdateDigest({ plan: unwrap(planMonitorUpdate({ live, patch: { query: EXCLUDED } })) });
}

describe("datadog monitor update", () => {
  it("previews by default and writes nothing", async () => {
    const { code, fake } = await run({ tail: ["update", "50100", "--query", EXCLUDED] });
    expect(code).toBe(EXIT_OK);
    expect(fake.writes).toEqual([]);
  });

  it("holds an approval for a different change, and writes nothing", async () => {
    const other = monitorUpdateDigest({
      plan: unwrap(planMonitorUpdate({ live: cpuMonitor(), patch: { name: "x" } })),
    });
    const { code, fake } = await run({ tail: ["update", "50100", "--query", EXCLUDED, "--approve", other] });
    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(fake.writes).toEqual([]);
  });

  it("holds an approval given before the monitor was edited, and writes nothing", async () => {
    const stale = queryDigest({ live: cpuMonitor() });
    const edited = cpuMonitor({ modified: "2026-09-30T12:00:00.000000+00:00" });
    const { code, fake } = await run({
      monitors: [edited],
      tail: ["update", "50100", "--query", EXCLUDED, "--approve", stale],
    });
    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(fake.writes).toEqual([]);
  });

  it("sends exactly the previewed body with the matching digest — the witness fires", async () => {
    const approve = queryDigest({ live: cpuMonitor() });
    const { code, fake } = await run({ tail: ["update", "50100", "--query", EXCLUDED, "--approve", approve] });
    expect(code).toBe(EXIT_OK);
    expect(fake.writes).toEqual([{ body: { query: EXCLUDED }, id: 50100, kind: "update" }]);
  });

  it("exits 1 when Datadog accepts the update but the monitor reads otherwise", async () => {
    const approve = queryDigest({ live: cpuMonitor() });
    const { code } = await run({
      behaviour: { sticky: true },
      tail: ["update", "50100", "--query", EXCLUDED, "--approve", approve],
    });
    expect(code).toBe(EXIT_ERROR);
  });

  it("refuses an IaC-managed monitor without --iac-override, even with the right digest", async () => {
    const approve = queryDigest({ live: MANAGED });
    const { code, fake } = await run({
      monitors: [MANAGED],
      tail: ["update", "50100", "--query", EXCLUDED, "--approve", approve],
    });
    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(fake.writes).toEqual([]);
  });

  it("writes an IaC-managed monitor when --iac-override names why", async () => {
    const approve = queryDigest({ live: MANAGED });
    const tail = [
      "update",
      "50100",
      "--query",
      EXCLUDED,
      "--iac-override",
      "the stack no longer declares it",
      "--approve",
      approve,
    ];
    const { code, fake } = await run({ monitors: [MANAGED], tail });
    expect(code).toBe(EXIT_OK);
    expect(fake.writes).toHaveLength(1);
  });

  it("refuses a recovery block or a renotify interval with no override", async () => {
    const patch = join(home, "patch.json");
    writeFileSync(
      patch,
      JSON.stringify({ message: "{{#is_recovery}}ok{{/is_recovery}}", options: { renotify_interval: 60 } }),
    );
    const tail = ["update", "50100", "--patch", patch, "--iac-override", "no such thing for this rule"];
    const { code, fake } = await run({ tail });
    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(fake.writes).toEqual([]);
  });

  it("answers 3 when the monitor already reads that way", async () => {
    expect((await run({ tail: ["update", "50100", "--query", cpuMonitor().query] })).code).toBe(EXIT_EXPECTED_EMPTY);
  });

  it("answers 1 when Datadog's validator refuses the change, before any digest", async () => {
    expect(
      (await run({ behaviour: { validateStatus: 400 }, tail: ["update", "50100", "--query", EXCLUDED] })).code,
    ).toBe(EXIT_ERROR);
  });

  it("answers 2 for a --patch that is not JSON", async () => {
    const patch = join(home, "patch.json");
    writeFileSync(patch, "{not json");
    expect((await run({ tail: ["update", "50100", "--patch", patch] })).code).toBe(EXIT_USAGE);
  });
});

describe("datadog monitor delete", () => {
  it("previews by default and deletes nothing", async () => {
    const { code, fake } = await run({ monitors: [cpuMonitor(), DISK], tail: ["delete", "50100,50792"] });
    expect(code).toBe(EXIT_OK);
    expect(fake.writes).toEqual([]);
  });

  it("deletes exactly the approved list, in order — the witness fires", async () => {
    const approve = monitorDeleteDigest({ monitors: [cpuMonitor(), DISK] });
    const { code, fake } = await run({
      monitors: [cpuMonitor(), DISK],
      tail: ["delete", "50100,50792", "--approve", approve],
    });
    expect(code).toBe(EXIT_OK);
    expect(fake.writes).toEqual([
      { id: 50100, kind: "delete" },
      { id: 50792, kind: "delete" },
    ]);
  });

  it("holds an approval for a shorter list, and deletes nothing", async () => {
    const approve = monitorDeleteDigest({ monitors: [cpuMonitor()] });
    const { code, fake } = await run({
      monitors: [cpuMonitor(), DISK],
      tail: ["delete", "50100,50792", "--approve", approve],
    });
    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(fake.writes).toEqual([]);
  });

  it("refuses the whole list when can_delete refuses one", async () => {
    const approve = monitorDeleteDigest({ monitors: [cpuMonitor(), DISK] });
    const behaviour = { referenced: { "50792": ["used in SLO 9"] } };
    const { code, fake } = await run({
      behaviour,
      monitors: [cpuMonitor(), DISK],
      tail: ["delete", "50100,50792", "--approve", approve],
    });
    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(fake.writes).toEqual([]);
  });

  it("refuses an IaC-managed monitor in the list without --iac-override", async () => {
    const approve = monitorDeleteDigest({ monitors: [MANAGED] });
    const { code, fake } = await run({ monitors: [MANAGED], tail: ["delete", "50100", "--approve", approve] });
    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(fake.writes).toEqual([]);
  });
});

describe("datadog monitor — the IaC tags come from the --home profile", () => {
  it("leaves the guard inert for a home with no profile: the tagged monitor is written", async () => {
    const approve = monitorDeleteDigest({ monitors: [MANAGED] });
    const { code, fake } = await run({
      monitors: [MANAGED],
      profile: ok(null),
      tail: ["delete", "50100", "--approve", approve],
    });
    expect(code).toBe(EXIT_OK);
    expect(fake.writes).toEqual([{ id: 50100, kind: "delete" }]);
  });

  it("exits 1 on a corrupt profile before Datadog is bound, and writes nothing", async () => {
    const approve = monitorDeleteDigest({ monitors: [cpuMonitor()] });
    const corrupt = ProfileReadErrors.unreadable({ detail: "not JSON: x", path: join(home, "profile.json") });
    const { apiHomes, code, fake } = await run({
      profile: err(corrupt),
      tail: ["delete", "50100", "--approve", approve],
    });
    expect(code).toBe(EXIT_ERROR);
    expect(apiHomes).toEqual([]);
    expect(fake.writes).toEqual([]);
  });

  it("reads the profile, binds Datadog and records the door decision all in the one --home", async () => {
    const approve = monitorDeleteDigest({ monitors: [cpuMonitor()] });
    expect(readdirSync(home)).toEqual([]);
    const { apiHomes, code, door, profileHomes } = await run({ tail: ["delete", "50100", "--approve", approve] });
    expect(code).toBe(EXIT_OK);
    expect(profileHomes).toEqual([home]);
    expect(apiHomes).toEqual([home]);
    expect(door.records().length).toBeGreaterThan(0);
  });

  it("deletes nothing and exits 1, not as a hold, when the store cannot record the door decision", async () => {
    const approve = monitorDeleteDigest({ monitors: [cpuMonitor()] });
    const { code, fake } = await run({
      doorLedger: unreachableDoorLedger(),
      tail: ["delete", "50100", "--approve", approve],
    });
    expect(code).toBe(EXIT_ERROR);
    expect(fake.writes).toEqual([]);
  });
});

describe("datadog monitor, before Datadog", () => {
  it("answers 3 when the credentials cannot be bound", async () => {
    const code = await runDatadogMonitorWith({
      argv: ["node", "cli", "datadog", "monitor", "show", "50100"],
      deps: {
        createApi: () => err(["DD_API_KEY is not set"]),
        doorLedger: memoryDoorLedger().port,
        readProfile: NO_PROFILE_READ,
      },
    });
    expect(code).toBe(EXIT_EXPECTED_EMPTY);
  });

  it("answers 2 for a change flag on delete", async () => {
    expect((await run({ tail: ["delete", "50100", "--query", EXCLUDED] })).code).toBe(EXIT_USAGE);
  });

  it("shows a monitor, and refuses a write flag on show", async () => {
    const { api } = fakeMonitorApi({ monitors: [cpuMonitor()] });
    const show = ({ tail }: { tail: readonly string[] }): Promise<number> =>
      runDatadogMonitorWith({
        argv: ["node", "cli", "datadog", "monitor", "show", ...tail],
        deps: { createApi: () => ok(api), doorLedger: memoryDoorLedger().port, readProfile: NO_PROFILE_READ },
      });
    expect(await show({ tail: ["50100"] })).toBe(EXIT_OK);
    expect(await show({ tail: ["50100", "--approve", "0123456789abcdef"] })).toBe(EXIT_USAGE);
  });
});
