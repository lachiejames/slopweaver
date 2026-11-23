import { describe, expect, it } from "vitest";

import {
  HEX_DEFAULT_LIMIT,
  hexRawOutputLines,
  parseHexObjectOptions,
  parseHexOutputOptions,
  parseHexProjectsOptions,
  parseHexRawOptions,
  repeatedFlag,
} from "../../../../cli/commands/hex/core.js";
import {
  HEX_CELLS_USAGE,
  HEX_CONNECTIONS_USAGE,
  HEX_OUTPUT_USAGE,
  HEX_PROJECT_USAGE,
  HEX_PROJECTS_USAGE,
  HEX_RAW_USAGE,
  HEX_RUNS_USAGE,
  HEX_VERIFY_USAGE,
} from "../../../../cli/commands/hex/usage.js";
import { hexManifest } from "../../../../cli/manifests/hex.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

describe("the manifest's usage strings are the ones the verbs print", () => {
  it("carries exactly the eight read verbs", () => {
    expect(Object.keys(hexManifest).toSorted()).toEqual([
      "cells",
      "connections",
      "output",
      "project",
      "projects",
      "raw",
      "runs",
      "verify",
    ]);
  });

  it("classifies every verb as an external READ that is not doored", () => {
    const meta = Object.values(hexManifest).map((entry) => entry.meta);
    expect(meta.filter((each) => each.effect !== "external-read")).toEqual([]);
    expect(meta.filter((each) => each.doorRouted)).toEqual([]);
  });

  it("matches the core's own usage lines", () => {
    expect(hexManifest["verify"]!.meta.usage).toBe(HEX_VERIFY_USAGE);
    expect(hexManifest["projects"]!.meta.usage).toBe(HEX_PROJECTS_USAGE);
    expect(hexManifest["project"]!.meta.usage).toBe(HEX_PROJECT_USAGE);
    expect(hexManifest["connections"]!.meta.usage).toBe(HEX_CONNECTIONS_USAGE);
    expect(hexManifest["cells"]!.meta.usage).toBe(HEX_CELLS_USAGE);
    expect(hexManifest["output"]!.meta.usage).toBe(HEX_OUTPUT_USAGE);
    expect(hexManifest["runs"]!.meta.usage).toBe(HEX_RUNS_USAGE);
    expect(hexManifest["raw"]!.meta.usage).toBe(HEX_RAW_USAGE);
  });
});

describe("repeatedFlag", () => {
  it("collects every value a repeated flag was given, in order", () => {
    expect(repeatedFlag({ name: "column", rest: ["--column", "a", "--column", "b"] })).toEqual(["a", "b"]);
  });

  it("ignores a flag whose value is another flag", () => {
    expect(repeatedFlag({ name: "column", rest: ["--column", "--json"] })).toEqual([]);
  });
});

describe("parseHexProjectsOptions", () => {
  it("splits --query into words and defaults the limit", () => {
    const parsed = parseHexProjectsOptions({ rest: ["--query", "booking cancellation"] });
    expect(unwrap(parsed).words).toEqual(["booking", "cancellation"]);
    expect(unwrap(parsed).limit).toBe(HEX_DEFAULT_LIMIT);
  });

  it("takes --owner and --include-archived", () => {
    const parsed = parseHexProjectsOptions({ rest: ["--owner", "a@example.com", "--include-archived"] });
    expect(unwrap(parsed).owner).toBe("a@example.com");
    expect(unwrap(parsed).includeArchived).toBe(true);
  });

  it("refuses a --limit that is not a whole number above zero", () => {
    expect(unwrapErr(parseHexProjectsOptions({ rest: ["--limit", "0"] }))[0]).toContain("at least 1");
    expect(unwrapErr(parseHexProjectsOptions({ rest: ["--limit", "two"] }))[0]).toContain("at least 1");
  });

  it("answers no words at all when --query is absent", () => {
    expect(unwrap(parseHexProjectsOptions({ rest: [] })).words).toEqual([]);
  });
});

describe("parseHexObjectOptions", () => {
  it("requires the id flag, naming what to pass", () => {
    const parsed = parseHexObjectOptions({
      extraFlag: "tables",
      idFlag: "project",
      rest: [],
      usageHint: "--project x",
    });
    expect(unwrapErr(parsed)[0]).toContain("--project is required");
  });

  it("takes the id and the verb's own boolean", () => {
    const parsed = parseHexObjectOptions({
      extraFlag: "tables",
      idFlag: "project",
      rest: ["--project", " p1 ", "--tables"],
      usageHint: "--project x",
    });
    expect(unwrap(parsed).id).toBe("p1");
    expect(unwrap(parsed).extra).toBe(true);
  });

  it("answers extra false for a verb that declares no boolean of its own", () => {
    const parsed = parseHexObjectOptions({
      extraFlag: null,
      idFlag: "project",
      rest: ["--project", "p1"],
      usageHint: "--project x",
    });
    expect(unwrap(parsed).extra).toBe(false);
  });
});

describe("parseHexOutputOptions", () => {
  it("requires --cell and points at where a cell id comes from", () => {
    expect(unwrapErr(parseHexOutputOptions({ rest: [] }))[0]).toContain("hex cells --project");
  });

  it("collects every --column and takes the retention flags", () => {
    const parsed = parseHexOutputOptions({
      rest: ["--cell", "c1", "--column", "id", "--column", "created_at", "--date-column", "created_at"],
    });
    expect(unwrap(parsed).columns).toEqual(["id", "created_at"]);
    expect(unwrap(parsed).dateColumn).toBe("created_at");
  });

  it("refuses a --now that is not an instant, so a replay cannot judge against nonsense", () => {
    expect(unwrapErr(parseHexOutputOptions({ rest: ["--cell", "c1", "--now", "yesterday"] }))[0]).toContain("ISO-8601");
  });

  it("carries a valid --now through", () => {
    const parsed = parseHexOutputOptions({ rest: ["--cell", "c1", "--now", "2026-09-16T00:00:00Z"] });
    expect(unwrap(parsed).nowIso).toBe("2026-09-16T00:00:00Z");
  });

  it("answers a null date column when the caller asked for no split", () => {
    expect(unwrap(parseHexOutputOptions({ rest: ["--cell", "c1"] })).dateColumn).toBeNull();
  });
});

describe("parseHexRawOptions", () => {
  it("requires --path", () => {
    expect(unwrapErr(parseHexRawOptions({ rest: [] }))[0]).toContain("--path is required");
  });

  it("trims the path it was given", () => {
    expect(unwrap(parseHexRawOptions({ rest: ["--path", " /v1/users/me "] })).path).toBe("/v1/users/me");
  });
});

describe("hexRawOutputLines", () => {
  it("prints a header and then the body exactly as Hex sent it, JSON or not", () => {
    expect(hexRawOutputLines({ bodyText: "not <json>", json: false, path: "/v1/context/topics", status: 200 })).toEqual(
      ["hex raw: GET /v1/context/topics → HTTP 200", "not <json>"],
    );
  });

  it("wraps the body under --json, leaving it a string the reader decodes", () => {
    const [line] = hexRawOutputLines({ bodyText: '{"a":1}', json: true, path: "/v1/x", status: 200 });
    expect(JSON.parse(line!)).toEqual({ bodyText: '{"a":1}', status: 200 });
  });
});
