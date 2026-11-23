/**
 * `turn freeze`'s pure edges: the argv parse, the `<channel>/<messageTs>` split, and the scan that decides
 * whether a fixture may be written at all.
 */
import { describe, expect, it } from "vitest";

import {
  fixtureSlug,
  freezeSlug,
  outDirectoryName,
  requiredFreezeFlagProblems,
} from "../../../../../cli/commands/turn/core.js";
import { parseTurnFreezeArgs } from "../../../../../cli/commands/turn/freeze.js";
import { scanFrozenFiles } from "../../../../../cli/commands/turn/freezeCollect.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { parseAskArgument } from "../../../../../live/ask/askArgument.js";

const NO_DENYLIST: readonly string[] = [];

/**
 * Assembled rather than written: a workspace-id-shaped literal and an absolute home path are the leak
 * CLASSES this verb's own scan refuses in a committed file, so a test that spelled one out could not be
 * committed either. Every value here is invented.
 */
const CHANNEL = `C${"0QWERTY12"}`;
const A_USER = `U${"0ZXCVBN34"}`;
const A_HOME_PATH = ["", "Users", "tester", "x"].join("/");

describe("parseTurnFreezeArgs", () => {
  it("accepts the full flag set", () => {
    const parsed = unwrap(
      parseTurnFreezeArgs({
        rest: [
          "--ask",
          "C1/1.1",
          "--out",
          "d",
          "--incident",
          "x",
          "--through",
          "dispatched",
          "--slug",
          "s",
          "--home",
          "h",
        ],
      }),
    );
    expect(parsed.values["ask"]).toBe("C1/1.1");
    expect(parsed.values["through"]).toBe("dispatched");
  });

  it("refuses a flag this verb does not have", () => {
    expect(unwrapErr(parseTurnFreezeArgs({ rest: ["--sweep"] })).join(" ")).toContain("--sweep");
  });
});

describe("outDirectoryName", () => {
  it("names the fixture after --out's last segment, trailing slash or not", () => {
    expect(unwrap(outDirectoryName({ out: "src/__tests__/fixtures/replay/stuck-lease/" }))).toBe("stuck-lease");
  });

  it("refuses an --out that names no directory, rather than freezing under an invented name", () => {
    expect(unwrapErr(outDirectoryName({ out: "/" }))).toEqual(['--out must name a directory, got "/"']);
  });
});

describe("fixtureSlug", () => {
  it("takes --slug when one was passed, so an --out of / is still a fixture directory", () => {
    expect(unwrap(fixtureSlug({ out: "/", slug: "root-fixture" }))).toBe("root-fixture");
  });

  it("falls to --out's last segment only when --slug was not passed", () => {
    expect(unwrap(fixtureSlug({ out: "fixtures/stuck-lease", slug: undefined }))).toBe("stuck-lease");
  });

  it("refuses an empty --slug apart from a missing one", () => {
    expect(unwrapErr(fixtureSlug({ out: "fixtures/x", slug: "" }))).toEqual([
      "--slug was given an empty value — pass the value itself",
    ]);
  });
});

describe("requiredFreezeFlagProblems", () => {
  it("names an empty flag beside a missing one rather than letting the missing one hide it", () => {
    expect(requiredFreezeFlagProblems({ ask: "C123/123.456", incident: undefined, out: "" })).toEqual([
      "--out was given an empty value — pass the value itself",
      "--incident is required",
    ]);
  });

  it("names every missing flag in one pass", () => {
    expect(requiredFreezeFlagProblems({ ask: undefined, incident: undefined, out: undefined })).toEqual([
      "--ask is required",
      "--out is required",
      "--incident is required",
    ]);
  });

  it("answers no problem once all three are usable", () => {
    expect(requiredFreezeFlagProblems({ ask: "C123/123.456", incident: "defect", out: "fixtures/x" })).toEqual([]);
  });
});

describe("freezeSlug", () => {
  it("refuses an empty --out even when --slug names the fixture", () => {
    expect(unwrapErr(freezeSlug({ incident: "defect", out: "", slug: "named" }))).toEqual([
      "--out was given an empty value — pass the value itself",
    ]);
  });

  it("refuses an empty --incident apart from a missing one", () => {
    expect(unwrapErr(freezeSlug({ incident: "", out: "fixtures/x", slug: undefined }))).toEqual([
      "--incident was given an empty value — pass the value itself",
    ]);
  });

  it("answers the slug once both values are usable", () => {
    expect(unwrap(freezeSlug({ incident: "defect", out: "/", slug: "named" }))).toBe("named");
  });
});

describe("parseAskArgument", () => {
  it("splits a well-formed ask", () => {
    expect(parseAskArgument({ ask: `${CHANNEL}/1787878821.099679` })).toEqual({
      channel: CHANNEL,
      messageTs: "1787878821.099679",
    });
  });

  it("refuses an ask with no separator", () => {
    expect(parseAskArgument({ ask: CHANNEL })).toBeUndefined();
  });

  it("refuses an ask with no channel", () => {
    expect(parseAskArgument({ ask: "/1787878821.099679" })).toBeUndefined();
  });

  it("refuses an ask with no timestamp", () => {
    expect(parseAskArgument({ ask: `${CHANNEL}/` })).toBeUndefined();
  });

  it("splits on the FIRST separator, so a timestamp keeps any tail it has", () => {
    expect(parseAskArgument({ ask: "C1/1.1/extra" })).toEqual({ channel: "C1", messageTs: "1.1/extra" });
  });
});

describe("scanFrozenFiles", () => {
  it("passes a fixture carrying only synthetic ids", () => {
    expect(
      scanFrozenFiles({
        denylist: NO_DENYLIST,
        files: [{ contents: '{"channel":"CFIXTUREAA"}', relativePath: "home/live/slack/asks.jsonl" }],
      }),
    ).toEqual([]);
  });

  it("reports a real workspace id that survived redaction, with its file and line", () => {
    expect(
      scanFrozenFiles({
        denylist: NO_DENYLIST,
        files: [{ contents: `a\n{"channel":"${CHANNEL}"}`, relativePath: "fixture.json" }],
      }),
    ).toEqual([`fixture.json:2: [raw-workspace-id] ${CHANNEL}`]);
  });

  it("reports an absolute home path", () => {
    expect(scanFrozenFiles({ denylist: NO_DENYLIST, files: [{ contents: A_HOME_PATH, relativePath: "f" }] })).toEqual([
      `f:1: [absolute-home-path] ${["", "Users", "tester"].join("/")}`,
    ]);
  });

  it("reports a denylist word", () => {
    expect(scanFrozenFiles({ denylist: ["acme"], files: [{ contents: "live-acme-loop", relativePath: "f" }] })).toEqual(
      ["f:1: [denylist] acme"],
    );
  });

  it("scans every file, not only the first that hits", () => {
    expect(
      scanFrozenFiles({
        denylist: NO_DENYLIST,
        files: [
          { contents: CHANNEL, relativePath: "a" },
          { contents: A_USER, relativePath: "b" },
        ],
      }),
    ).toHaveLength(2);
  });
});
