/**
 * `atlas trelica sync` over injected effects: one ordered event log of every tenant read, session read,
 * sign-in wall, compile, clock sample, first-party run, publish, stdout line and stderr line, so each case
 * pins exactly what the verb did, in what order, and the exit code it graded it as.
 */
import { describe, expect, it } from "vitest";

import { type TrelicaAtlasError, TrelicaAtlasErrors } from "../../../../../atlas/trelica/errors.js";
import type { TrelicaFirstPartyRun } from "../../../../../atlas/trelica/firstPartyRun.js";
import type { TrelicaPublishedSurface } from "../../../../../atlas/trelica/publishedSpec.js";
import type { TrelicaSession } from "../../../../../atlas/trelica/session.js";
import type { TrelicaSyncOutcome } from "../../../../../atlas/trelica/sync.js";
import { runTrelicaAtlasSync, type TrelicaAtlasSyncDeps } from "../../../../../cli/commands/trelicaAtlas/syncRun.js";
import { err, ok, type Result } from "../../../../../lib/result.js";
import { memoryRecordedProfilePort } from "../../../../recordedProfileFixture.js";

const USAGE = "usage: slopweaver atlas trelica sync [--json] [--home <dir>]";
const TENANT = "https://tenant.example.test";
const AT = "2026-10-13T01:02:03.000Z";

/** The process argv for `slopweaver atlas trelica sync <tail…>`. */
function argvOf({ tail }: { tail: readonly string[] }): readonly string[] {
  return ["node", "slopweaver", "atlas", "trelica", "sync", ...tail];
}

const SESSION: TrelicaSession = { antiforgery: "af-token", cookie: "c=1", profileDirectory: "Profile 2" };

const SURFACE: TrelicaPublishedSurface = { documents: [], unreadable: [] };

const RUN: TrelicaFirstPartyRun = {
  entities: { calls: [], reads: [], steps: { firstFailure: null, read: 0, reused: 0, unread: 0 } },
  failures: [],
  results: [],
  usage: [],
  window: { endDate: "2026-10-13", startDate: "2026-09-13" },
};

const OUTCOME: TrelicaSyncOutcome = {
  aiAlerts: 2,
  aiUsage: 7,
  apps: 40,
  entities: { person: 9, workflow: 2 },
  openGaps: 4,
  publishedDocumentsRead: 3,
  publishedDocumentsUnreadable: 1,
  publishedOperations: 12,
  roles: 5,
  runSteps: { read: 3, reused: 4, unread: 1 },
  written: ["kinds/method.json"],
};

/** Deps answering the given tenant, session and publish results, logging every call into one ordered list. */
function harness({
  tenant = ok(TENANT),
  session = ok(SESSION),
  published = ok(OUTCOME),
}: {
  tenant?: Result<string>;
  session?: Result<TrelicaSession, TrelicaAtlasError>;
  published?: Result<TrelicaSyncOutcome>;
}): { deps: TrelicaAtlasSyncDeps; events: string[]; handed: { surface: unknown[]; run: unknown[] } } {
  const events: string[] = [];
  const handed: { surface: unknown[]; run: unknown[] } = { run: [], surface: [] };
  const compileSurface: TrelicaAtlasSyncDeps["compileSurface"] = async () => {
    events.push("compile");
    return SURFACE;
  };
  const resolveSession: TrelicaAtlasSyncDeps["resolveSession"] = async ({ home, tenantOrigin }) => {
    events.push(`session: ${home} ${tenantOrigin}`);
    return session;
  };
  const runFirstParty: TrelicaAtlasSyncDeps["runFirstParty"] = async ({ at }) => {
    events.push(`first-party: ${at}`);
    return RUN;
  };
  return {
    deps: {
      compileSurface,
      error: ({ msg }) => {
        events.push(`err: ${msg}`);
      },
      noteSignInWall: ({ origin }) => {
        events.push(`wall: ${origin}`);
      },
      now: () => {
        events.push("now");
        return AT;
      },
      out: ({ line }) => {
        events.push(`out: ${line}`);
      },
      profiles: memoryRecordedProfilePort(),
      publish: ({ at, paths, run, surface }) => {
        events.push(`publish: ${at} ${paths.home}`);
        handed.surface.push(surface);
        handed.run.push(run);
        return published;
      },
      resolveSession,
      resolveTenant: ({ home }) => {
        events.push(`tenant: ${home}`);
        return tenant;
      },
      runFirstParty,
    },
    events,
    handed,
  };
}

describe("runTrelicaAtlasSync", () => {
  it("prints its usage and touches no effect on --help", async () => {
    const { deps, events } = harness({});

    expect(await runTrelicaAtlasSync({ argv: argvOf({ tail: ["--help"] }), deps })).toBe(0);
    expect(events).toEqual([`out: ${USAGE}`]);
  });

  it("prints its usage and touches no effect on -h", async () => {
    const { deps, events } = harness({});

    expect(await runTrelicaAtlasSync({ argv: argvOf({ tail: ["-h"] }), deps })).toBe(0);
    expect(events).toEqual([`out: ${USAGE}`]);
  });

  it("refuses an unknown flag as usage, naming it then printing the usage, before any tenant or session read", async () => {
    const { deps, events } = harness({});

    expect(await runTrelicaAtlasSync({ argv: argvOf({ tail: ["--nope"] }), deps })).toBe(2);
    expect(events).toEqual(["err: unknown flag: --nope", `err: ${USAGE}`]);
  });

  it("fails with every tenant reason before any session work", async () => {
    const { deps, events } = harness({ tenant: err(["no tenant host configured", "set the secret"]) });

    expect(await runTrelicaAtlasSync({ argv: argvOf({ tail: ["--home", "/h"] }), deps })).toBe(1);
    expect(events).toEqual(["tenant: /h", "err: no tenant host configured", "err: set the secret"]);
  });

  it("records the sign-in wall for SESSION_LOST before printing its message, and compiles nothing", async () => {
    const lost = TrelicaAtlasErrors.sessionLost({ origin: TENANT });
    const { deps, events } = harness({ session: err(lost) });

    expect(await runTrelicaAtlasSync({ argv: argvOf({ tail: ["--home", "/h"] }), deps })).toBe(1);
    expect(lost.code).toBe("SESSION_LOST");
    expect(events).toEqual([
      "tenant: /h",
      `session: /h ${TENANT}`,
      `wall: ${TENANT}`,
      `err: the signed-in session for ${TENANT} is gone — open it in Chrome and sign in, then run this again`,
    ]);
  });

  it("records no sign-in wall for a session error other than SESSION_LOST", async () => {
    const { deps, events } = harness({
      session: err(TrelicaAtlasErrors.tenantUnresolved({ reasons: ["no Chrome profile is recorded"] })),
    });

    expect(await runTrelicaAtlasSync({ argv: argvOf({ tail: ["--home", "/h"] }), deps })).toBe(1);
    expect(events).toEqual(["tenant: /h", `session: /h ${TENANT}`, "err: no Chrome profile is recorded"]);
  });

  it("fails with every publication line after the whole run, printing no report", async () => {
    const { deps, events } = harness({ published: err(["the generation moved", "retry the sync"]) });

    expect(await runTrelicaAtlasSync({ argv: argvOf({ tail: ["--home", "/h"] }), deps })).toBe(1);
    expect(events).toEqual([
      "tenant: /h",
      `session: /h ${TENANT}`,
      "compile",
      "now",
      `first-party: ${AT}`,
      `publish: ${AT} /h`,
      "err: the generation moved",
      "err: retry the sync",
    ]);
  });

  it("samples the clock after the compile, then runs, publishes and prints the human report", async () => {
    const { deps, events, handed } = harness({});

    expect(await runTrelicaAtlasSync({ argv: argvOf({ tail: ["--home", "/h"] }), deps })).toBe(0);
    expect(events).toEqual([
      "tenant: /h",
      `session: /h ${TENANT}`,
      "compile",
      "now",
      `first-party: ${AT}`,
      `publish: ${AT} /h`,
      "out: trelica api surfaces — 12 published operation(s) from 3 document(s) (1 unreadable), 40 application(s), 5 role(s), 7 AI-usage row(s), 2 AI alert(s), 4 open gap(s)",
      "out:   entities — person 9, workflow 2; run steps 3 read, 4 reused unchanged, 1 unread",
    ]);
    expect(handed.surface.length).toBe(1);
    expect(handed.surface[0]).toBe(SURFACE);
    expect(handed.run.length).toBe(1);
    expect(handed.run[0]).toBe(RUN);
  });

  it("prints the whole outcome as one indented JSON document under --json", async () => {
    const { deps, events } = harness({});

    expect(await runTrelicaAtlasSync({ argv: argvOf({ tail: ["--home", "/h", "--json"] }), deps })).toBe(0);
    expect(events).toEqual([
      "tenant: /h",
      `session: /h ${TENANT}`,
      "compile",
      "now",
      `first-party: ${AT}`,
      `publish: ${AT} /h`,
      'out: {\n "aiAlerts": 2,\n "aiUsage": 7,\n "apps": 40,\n "entities": {\n  "person": 9,\n  "workflow": 2\n },\n "openGaps": 4,\n "publishedDocumentsRead": 3,\n "publishedDocumentsUnreadable": 1,\n "publishedOperations": 12,\n "roles": 5,\n "runSteps": {\n  "read": 3,\n  "reused": 4,\n  "unread": 1\n },\n "written": [\n  "kinds/method.json"\n ]\n}',
    ]);
  });
});
