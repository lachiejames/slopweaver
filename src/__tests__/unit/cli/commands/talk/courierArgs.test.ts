import { describe, expect, it } from "vitest";

import { parseCourierArgs } from "../../../../../cli/commands/talk/courierArgs.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

describe("parseCourierArgs", () => {
  it("parses --follow", () => {
    expect(unwrap(parseCourierArgs({ rest: ["--follow"] }))).toEqual({ json: false, mode: "follow" });
  });

  it("parses --once with --json", () => {
    expect(unwrap(parseCourierArgs({ rest: ["--once", "--json"] }))).toEqual({ json: true, mode: "once" });
  });

  it("refuses neither mode", () => {
    expect(unwrapErr(parseCourierArgs({ rest: [] })).message).toBe(
      "talk courier takes exactly one of --follow and --once",
    );
  });

  it("refuses both modes", () => {
    expect(unwrapErr(parseCourierArgs({ rest: ["--follow", "--once"] })).message).toBe(
      "talk courier takes exactly one of --follow and --once",
    );
  });

  it("refuses --json on a follower", () => {
    expect(unwrapErr(parseCourierArgs({ rest: ["--follow", "--json"] })).code).toBe("COURIER_FLAGS_INVALID");
  });

  it("refuses --home, which would hand the chair's courier another home's relays", () => {
    expect(unwrapErr(parseCourierArgs({ rest: ["--once", "--home", "/tmp/elsewhere"] })).code).toBe(
      "COURIER_FLAGS_INVALID",
    );
  });
});
