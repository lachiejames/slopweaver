import { describe, expect, it } from "vitest";

import {
  parseSlackSnapshotOptions,
  SLACK_SNAPSHOT_FLAG_NAMES,
} from "../../../../../cli/commands/slack/snapshotOptions.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

const HOME = "/tmp/sw-default-home";

describe("parseSlackSnapshotOptions", () => {
  it("defaults to the given home, text output, no write and no frozen instant", () => {
    expect(unwrap(parseSlackSnapshotOptions({ defaultHome: HOME, rest: [] }))).toStrictEqual({
      home: HOME,
      json: false,
      write: false,
    });
  });

  it("reads every flag, --json and --write together included", () => {
    const options = parseSlackSnapshotOptions({
      defaultHome: HOME,
      rest: ["--json", "--write", "--home", "/tmp/elsewhere", "--now", "2026-09-26T08:55:00.000Z"],
    });
    expect(unwrap(options)).toStrictEqual({
      home: "/tmp/elsewhere",
      json: true,
      nowIso: "2026-09-26T08:55:00.000Z",
      write: true,
    });
  });

  it("normalises a parseable --now to a full ISO instant", () => {
    const options = parseSlackSnapshotOptions({ defaultHome: HOME, rest: ["--now", "2026-09-26T08:55:00Z"] });
    expect(unwrap(options).nowIso).toBe("2026-09-26T08:55:00.000Z");
  });

  it("refuses a --now that names no instant", () => {
    const refused = parseSlackSnapshotOptions({ defaultHome: HOME, rest: ["--now", "yesterday"] });
    expect(unwrapErr(refused)).toStrictEqual(['--now must be an ISO 8601 instant, got "yesterday"']);
  });

  it("refuses --now with no value", () => {
    expect(unwrapErr(parseSlackSnapshotOptions({ defaultHome: HOME, rest: ["--now"] })).length).toBe(1);
  });

  it("refuses --home with no value", () => {
    expect(unwrapErr(parseSlackSnapshotOptions({ defaultHome: HOME, rest: ["--home"] })).length).toBe(1);
  });

  it("refuses an unknown flag by name", () => {
    expect(unwrapErr(parseSlackSnapshotOptions({ defaultHome: HOME, rest: ["--draft"] }))[0]).toContain("--draft");
  });
});

describe("SLACK_SNAPSHOT_FLAG_NAMES", () => {
  it("names exactly the four flags both snapshot verbs accept", () => {
    expect(SLACK_SNAPSHOT_FLAG_NAMES).toStrictEqual(["--home", "--json", "--now", "--write"]);
  });
});
