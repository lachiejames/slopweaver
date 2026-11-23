/**
 * `src/context/load.ts` — which owner reads leave the always-loaded read live. Every failure that renders the owner's
 * section `unavailable` must fall back, or the load ledger records a session loaded whose context holds no profile.
 */
import { describe, expect, it } from "vitest";

import { buildAlwaysLoadedContext, unavailableSection } from "../../../context/alwaysLoaded.js";
import { ownerUnavailableIn } from "../../../context/cachedContext.js";
import { ownerReadFailure } from "../../../context/load.js";
import { err, ok } from "../../../lib/result.js";
import { StoreErrors } from "../../../store/errors.js";
import { ProfileErrors } from "../../../store/profile/errors.js";

describe("ownerUnavailableIn", () => {
  const capturedAtIso = "2026-10-05T10:00:00.000Z";
  const owner = { provider: "owner-profile" as const, title: "About the owner" };
  const voice = { provider: "voice-register" as const, title: "Measured voice register" };

  it("is true for a context whose owner section was rendered unavailable, as a pre-fix checkout caches it", () => {
    const lines = buildAlwaysLoadedContext({
      capturedAtIso,
      sections: [unavailableSection({ ...owner, detail: "the payload does not match its schema: x" })],
    });
    expect(ownerUnavailableIn({ lines })).toBe(true);
  });

  it("is false for the owner's loaded profile, an empty fresh-install section, and an unavailable voice register alone", () => {
    const loaded = { ...owner, detail: "", lines: ["- a"], revision: 3, status: "loaded" as const };
    const empty = { ...owner, detail: "no owner row", lines: [], revision: null, status: "empty" as const };
    const voiceDown = unavailableSection({ ...voice, detail: "down" });
    expect([
      ownerUnavailableIn({ lines: buildAlwaysLoadedContext({ capturedAtIso, sections: [loaded, voiceDown] }) }),
      ownerUnavailableIn({ lines: buildAlwaysLoadedContext({ capturedAtIso, sections: [empty] }) }),
      ownerUnavailableIn({ lines: [] }),
    ]).toEqual([false, false, false]);
  });
});

describe("ownerReadFailure", () => {
  it("leaves a read live when the owner's row came back, or when no row has been written yet", () => {
    expect([
      ownerReadFailure({ owner: ok({ revision: 1 }) }),
      ownerReadFailure({ owner: err(ProfileErrors.absent({ subject: "owner" })) }),
    ]).toEqual(["", ""]);
  });

  it("fails a read whose row no longer parses, naming the issues, so it cannot report origin live", () => {
    const owner = err(ProfileErrors.payloadInvalid({ issues: ["selfDescription: Required"] }));
    expect(ownerReadFailure({ owner })).toBe("the payload does not match its schema: selfDescription: Required");
  });

  it("fails a read whose query failed, carrying the store's own reason", () => {
    const cause = StoreErrors.unreachable({ reason: "ECONNREFUSED" });
    const owner = err(ProfileErrors.queryFailed({ cause }));
    expect(ownerReadFailure({ owner })).toBe(cause.message);
  });
});
