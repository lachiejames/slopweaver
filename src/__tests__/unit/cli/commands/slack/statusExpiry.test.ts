import { describe, expect, it } from "vitest";

import { renderExpiry, resolveStatusExpiry } from "../../../../../cli/commands/slack/statusExpiry.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

const MELBOURNE = "Australia/Melbourne";

/** End of the local day containing `nowIso`, in Melbourne, as an ISO instant. */
function endOfDay({ nowIso }: { nowIso: string }): string {
  const atMs = unwrap(
    resolveStatusExpiry({ nowMs: Date.parse(nowIso), request: { kind: "end-of-day", zone: MELBOURNE } }),
  );
  return new Date(atMs!).toISOString();
}

describe("resolveStatusExpiry — end of day", () => {
  it("ends the holiday at the next Melbourne midnight", () => {
    expect(endOfDay({ nowIso: "2026-09-25T03:00:00Z" })).toBe("2026-09-25T14:00:00.000Z");
  });

  it("rolls to the following midnight once the local day has turned", () => {
    expect(endOfDay({ nowIso: "2026-09-25T14:01:00Z" })).toBe("2026-09-26T14:00:00.000Z");
  });

  it("ends the spring-forward day an hour earlier in UTC, at its own midnight", () => {
    expect(endOfDay({ nowIso: "2026-10-03T03:00:00Z" })).toBe("2026-10-03T14:00:00.000Z");
    expect(endOfDay({ nowIso: "2026-10-04T03:00:00Z" })).toBe("2026-10-04T13:00:00.000Z");
  });

  it("ends the fall-back day at its own midnight", () => {
    expect(endOfDay({ nowIso: "2026-04-05T03:00:00Z" })).toBe("2026-04-05T14:00:00.000Z");
  });

  it("refuses a zone the runtime does not know", () => {
    const result = resolveStatusExpiry({ nowMs: 0, request: { kind: "end-of-day", zone: "Mars/Olympus" } });
    expect(unwrapErr(result).code).toBe("ZONE_UNKNOWN");
  });
});

describe("resolveStatusExpiry — instants", () => {
  it("answers never as undefined", () => {
    expect(unwrap(resolveStatusExpiry({ nowMs: 0, request: { kind: "never" } }))).toBe(undefined);
  });

  it("keeps a future instant and refuses one already past", () => {
    const atMs = Date.parse("2026-09-26T00:00:00+10:00");
    expect(unwrap(resolveStatusExpiry({ nowMs: atMs - 1, request: { atMs, kind: "instant" } }))).toBe(atMs);
    expect(unwrapErr(resolveStatusExpiry({ nowMs: atMs, request: { atMs, kind: "instant" } })).code).toBe(
      "UNTIL_NOT_FUTURE",
    );
  });
});

describe("renderExpiry", () => {
  it("reads 0 as never", () => {
    expect(renderExpiry({ expirationSeconds: 0, zone: MELBOURNE })).toBe("never");
  });

  it("renders the UTC instant when no zone was named, never a guessed one", () => {
    expect(renderExpiry({ expirationSeconds: 1790344800, zone: undefined })).toBe("2026-09-25T14:00:00.000Z");
  });

  it("renders local wall clock in a named zone beside the instant", () => {
    expect(renderExpiry({ expirationSeconds: 1790344800, zone: MELBOURNE })).toBe(
      "2026-09-26 Sat 00:00 Australia/Melbourne (2026-09-25T14:00:00.000Z)",
    );
  });
});
