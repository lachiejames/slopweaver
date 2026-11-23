import { describe, expect, it } from "vitest";

import { parseIntakeMarkOptions } from "../../../cli/commands/supervisor/intakeMarkRun.js";
import { parseIntakeOptions } from "../../../cli/commands/supervisor/intakeRun.js";
import { unwrap } from "../../../lib/result.js";

const POINTER = "transcript:a0000013-0000-4000-8000-000000000014#0a335102-005d-4f3d-a2e3-cbbf3fd794c0";

describe("supervisor intake flags", () => {
  it("defaults to the pin, the whole grace clock and human output", () => {
    expect(unwrap(parseIntakeOptions({ rest: [] }))).toEqual({
      home: undefined,
      json: false,
      nowIso: undefined,
      sessionId: undefined,
      sinceIso: undefined,
    });
  });

  it("takes an explicit session, floor and clock", () => {
    expect(
      unwrap(
        parseIntakeOptions({
          rest: [
            "--session",
            "abc",
            "--since",
            "2026-09-02T14:00:00Z",
            "--now",
            "2026-09-02T17:00:00Z",
            "--json",
            "--home",
            "/h",
          ],
        }),
      ),
    ).toEqual({
      home: "/h",
      json: true,
      nowIso: "2026-09-02T17:00:00Z",
      sessionId: "abc",
      sinceIso: "2026-09-02T14:00:00Z",
    });
  });

  it("refuses a floor that is not an instant, rather than silently reading everything", () => {
    const result = parseIntakeOptions({ rest: ["--since", "yesterday"] });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toEqual(["--since yesterday is not an instant"]);
  });
});

describe("supervisor intake-mark flags", () => {
  it("needs the turn, the kind and the witness", () => {
    const result = parseIntakeMarkOptions({ rest: [] });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toHaveLength(3);
    expect(result._unsafeUnwrapErr()[1]).toBe("--as is required and must be one of card|answered|no-ask");
  });

  it("refuses a kind this ledger does not know", () => {
    const result = parseIntakeMarkOptions({ rest: ["--turn", POINTER, "--as", "done", "--witness", "x"] });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toEqual(["--as is required and must be one of card|answered|no-ask"]);
  });

  it("resolves a complete mark", () => {
    expect(
      unwrap(
        parseIntakeMarkOptions({
          rest: [
            "--turn",
            POINTER,
            "--as",
            "no-ask",
            "--witness",
            "the owner said brief me",
            "--now",
            "2026-09-02T17:00:00Z",
          ],
        }),
      ),
    ).toEqual({
      as: "no-ask",
      home: undefined,
      nowIso: "2026-09-02T17:00:00Z",
      turn: POINTER,
      witness: "the owner said brief me",
    });
  });
});
