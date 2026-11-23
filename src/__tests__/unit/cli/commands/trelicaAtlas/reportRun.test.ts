/**
 * `atlas trelica report` over injected edges: one ordered event log of every read, stdout line and stderr
 * line, so each case pins exactly what the verb did and in what order, and the exit code it graded it as.
 * The kind file is a small valid `method` generation with one row in each of the four channel sets.
 */
import { describe, expect, it } from "vitest";

import type { TrelicaAtlasEntity, TrelicaAtlasKindFile } from "../../../../../atlas/trelica/model.js";
import type { TrelicaAtlasSnapshot } from "../../../../../atlas/trelica/store.js";
import {
  runTrelicaAtlasReport,
  type TrelicaAtlasReportDeps,
} from "../../../../../cli/commands/trelicaAtlas/reportRun.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { err, ok, type Result } from "../../../../../lib/result.js";

const USAGE = "usage: slopweaver atlas trelica report [--offboarding] [--json] [--home <dir>]";

/** The process argv for `slopweaver atlas trelica report <tail…>`. */
function argvOf({ tail }: { tail: readonly string[] }): readonly string[] {
  return ["node", "slopweaver", "atlas", "trelica", "report", ...tail];
}

/** Deps whose kind read answers `read` and whose snapshot read answers `snapshot`, logging every call in order. */
function harness({
  read,
  snapshot = err(["no snapshot in this case"]),
}: {
  read: Result<TrelicaAtlasKindFile | null>;
  snapshot?: Result<TrelicaAtlasSnapshot>;
}): {
  deps: TrelicaAtlasReportDeps;
  events: string[];
} {
  const events: string[] = [];
  return {
    deps: {
      error: ({ msg }) => {
        events.push(`err: ${msg}`);
      },
      out: ({ line }) => {
        events.push(`out: ${line}`);
      },
      readKind: ({ home, kind }) => {
        events.push(`read ${kind}: ${home}`);
        return read;
      },
      readSnapshot: ({ home }) => {
        events.push(`snapshot: ${home}`);
        return snapshot;
      },
    },
    events,
  };
}

/** One channel's observation of a row. */
function seen({
  channel,
  detail = null,
}: {
  channel: "browser" | "first-party-api" | "published-api";
  detail?: unknown;
}): NonNullable<TrelicaAtlasEntity["channels"]["browser"]> {
  return {
    channel,
    detail,
    firstSeenAt: "2026-09-01T00:00:00.000Z",
    lastSeenAt: "2026-09-02T00:00:00.000Z",
    source: null,
    state: "observed",
  };
}

/** A method row with the given channels filled. */
function method({
  providerId,
  channels,
}: {
  providerId: string;
  channels: Partial<TrelicaAtlasEntity["channels"]>;
}): TrelicaAtlasEntity {
  return {
    channels: { browser: null, "first-party-api": null, "published-api": null, ...channels },
    id: `method:${providerId}`,
    kind: "method",
    providerId,
  };
}

/** A published `method` generation holding one row in each of the four channel sets. */
function methodFile(): TrelicaAtlasKindFile {
  return {
    coverage: [],
    entities: [
      method({ channels: { "published-api": seen({ channel: "published-api" }) }, providerId: "GET /api/apps/v1" }),
      method({
        channels: { "first-party-api": seen({ channel: "first-party-api", detail: { calledDirectly: true } }) },
        providerId: "POST /AppsApi/Apps/List",
      }),
      method({ channels: { browser: seen({ channel: "browser" }) }, providerId: "GET /AppsApi/Users/Get" }),
      method({
        channels: {
          browser: seen({ channel: "browser" }),
          "published-api": seen({ channel: "published-api" }),
        },
        providerId: "GET /api/people/v1",
      }),
    ],
    gaps: [],
    kind: "method",
    platform: "trelica",
    schemaVersion: 3,
    updatedAt: "2026-09-02T00:00:00.000Z",
  };
}

describe("runTrelicaAtlasReport", () => {
  it("prints its usage and reads nothing on --help", () => {
    const { deps, events } = harness({ read: ok(methodFile()) });

    expect(runTrelicaAtlasReport({ argv: argvOf({ tail: ["--help"] }), deps })).toBe(EXIT_OK);
    expect(events).toEqual([`out: ${USAGE}`]);
  });

  it("prints its usage and reads nothing on -h", () => {
    const { deps, events } = harness({ read: ok(methodFile()) });

    expect(runTrelicaAtlasReport({ argv: argvOf({ tail: ["-h"] }), deps })).toBe(EXIT_OK);
    expect(events).toEqual([`out: ${USAGE}`]);
  });

  it("refuses an unknown flag as a caller mistake, naming it then printing the usage, before any read", () => {
    const { deps, events } = harness({ read: ok(methodFile()) });

    expect(runTrelicaAtlasReport({ argv: argvOf({ tail: ["--nope"] }), deps })).toBe(EXIT_USAGE);
    expect(events).toEqual(["err: unknown flag: --nope", `err: ${USAGE}`]);
  });

  it("reports every reason a stored generation could not be read, as an error", () => {
    const { deps, events } = harness({ read: err(["method.json is not JSON", "the manifest names no method"]) });

    expect(runTrelicaAtlasReport({ argv: argvOf({ tail: ["--home", "/h"] }), deps })).toBe(EXIT_ERROR);
    expect(events).toEqual(["read method: /h", "err: method.json is not JSON", "err: the manifest names no method"]);
  });

  it("is expected-empty, naming the refresh verb, when no generation has been published", () => {
    const { deps, events } = harness({ read: ok(null) });

    expect(runTrelicaAtlasReport({ argv: argvOf({ tail: ["--home", "/h"] }), deps })).toBe(EXIT_EXPECTED_EMPTY);
    expect(events).toEqual([
      "read method: /h",
      "err: no trelica generation has been published — run: slopweaver atlas trelica refresh",
    ]);
  });

  it("prints the four channel sets as one indented JSON document under --json", () => {
    const { deps, events } = harness({ read: ok(methodFile()) });

    expect(runTrelicaAtlasReport({ argv: argvOf({ tail: ["--home", "/h", "--json"] }), deps })).toBe(EXIT_OK);
    expect(events).toEqual([
      "read method: /h",
      'out: {\n "calledUndocumented": [\n  "POST /AppsApi/Apps/List"\n ],\n "corroborated": [\n  "GET /api/people/v1"\n ],\n "observedUndocumented": [\n  "GET /AppsApi/Users/Get"\n ],\n "publishedOnly": [\n  "GET /api/apps/v1"\n ]\n}',
    ]);
  });

  it("prints the counts and the undocumented sample as human lines by default", () => {
    const { deps, events } = harness({ read: ok(methodFile()) });

    expect(runTrelicaAtlasReport({ argv: argvOf({ tail: ["--home", "/h"] }), deps })).toBe(EXIT_OK);
    expect(events).toEqual([
      "read method: /h",
      "out: trelica surface corroboration — 4 method row(s) held",
      "out:   corroborated          1  (more than one channel has looked at it)",
      "out:   published only        1  (a vendor document declares it; nothing here has called or observed it)",
      "out:   called, undocumented  1  (this atlas called it and got an answer; no vendor document declares it)",
      "out:   observed only         1  (the web client calls it; this atlas has not, and no document declares it)",
      "out:   the undocumented surface, first 2 of 2:",
      "out:     POST /AppsApi/Apps/List",
      "out:     GET /AppsApi/Users/Get",
    ]);
  });
});
