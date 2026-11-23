import { describe, expect, it } from "vitest";

import { VantaSyncErrors, VantaSyncRunErrors, vantaSyncErrorLines } from "../../../../atlas/vanta/syncErrors.js";

describe("VantaSyncRunErrors — what a whole run's failure tells its exit code", () => {
  it("keeps a contended run's lines in order and joins them into its message", () => {
    expect(VantaSyncRunErrors.contended({ lines: ["a", "b"] })).toEqual({
      code: "SYNC_CONTENDED",
      lines: ["a", "b"],
      message: "a; b",
    });
  });

  it("keeps a refused run's lines in order and joins them into its message", () => {
    expect(VantaSyncRunErrors.refused({ lines: ["c", "d"] })).toEqual({
      code: "SYNC_REFUSED",
      lines: ["c", "d"],
      message: "c; d",
    });
  });
});

describe("VantaSyncErrors — the run", () => {
  it("refuses an untrusted generation in three lines, saying none for an empty side", () => {
    const error = VantaSyncErrors.generationUntrusted({ mismatched: ["control"], missing: [] });
    expect(error.code).toBe("GENERATION_UNTRUSTED");
    expect(vantaSyncErrorLines({ error })).toEqual([
      "the current Vanta atlas generation disagrees with itself (mismatched: control; missing: none)",
      "refusing to merge against a generation this reader cannot trust",
      "run: slopweaver atlas vanta reset --confirm archive, then sync again",
    ]);
  });

  it("lists two kinds on each side comma-separated", () => {
    const error = VantaSyncErrors.generationUntrusted({
      mismatched: ["control", "risk"],
      missing: ["vendor", "policy"],
    });
    expect(vantaSyncErrorLines({ error })[0]).toBe(
      "the current Vanta atlas generation disagrees with itself (mismatched: control, risk; missing: vendor, policy)",
    );
  });

  it("quotes the operation lock when the sync lock is held", () => {
    const error = VantaSyncErrors.syncLockHeld({ holder: "held by pid 42" });
    expect(error.code).toBe("SYNC_LOCK_HELD");
    expect(error.message).toBe("could not acquire the Vanta atlas sync lock: held by pid 42");
  });

  it("refuses an undeclared surface by naming its kind and surface, as one line", () => {
    const error = VantaSyncErrors.surfaceUndeclared({ kind: "policy", surface: "no-such-surface" });
    expect(error.code).toBe("SURFACE_UNDECLARED");
    expect(vantaSyncErrorLines({ error })).toEqual([
      "Vanta kind policy declares no manage-api surface no-such-surface in the inventory, so its evidence grade is unknown and the read is refused rather than graded authoritative",
    ]);
  });

  it("says credentials are not configured in the words gap classification matches", () => {
    const error = VantaSyncErrors.credentialsAbsent();
    expect(error.code).toBe("CREDENTIALS_ABSENT");
    expect(vantaSyncErrorLines({ error })).toEqual([
      "Vanta credentials are not configured — export VANTA_CLIENT_ID and VANTA_CLIENT_SECRET, or run `slopweaver secrets set vanta-client-id` and `vanta-client-secret` (see atlas/vanta/credentialFiles.ts)",
    ]);
  });
});

describe("VantaSyncErrors — merges, documents and companions", () => {
  it("names the entity whose fresh channel was empty", () => {
    const api = VantaSyncErrors.entityWithoutApiChannel({ entityId: "vanta:control:c1" });
    expect(api.code).toBe("ENTITY_WITHOUT_API_CHANNEL");
    expect(api.message).toBe("entity vanta:control:c1 was observed this run with no manage-api channel populated");
    const browser = VantaSyncErrors.entityWithoutBrowserChannel({ entityId: "vanta:control:c1" });
    expect(browser.code).toBe("ENTITY_WITHOUT_BROWSER_CHANNEL");
    expect(browser.message).toBe("entity vanta:control:c1 was captured this run with no browser channel populated");
  });

  it("heads the unstored policy documents with a count, then one line per problem", () => {
    const error = VantaSyncErrors.policyDocumentsUnstored({ documentCount: 3, problems: ["d1: boom", "d2: bang"] });
    expect(error.code).toBe("POLICY_DOCUMENTS_UNSTORED");
    expect(vantaSyncErrorLines({ error })).toEqual([
      "2 of 3 policy document(s) could not be stored whole",
      "d1: boom",
      "d2: bang",
    ]);
  });

  it("refuses a presigned download by status, size or cause, never by its address", () => {
    const status = VantaSyncErrors.documentHttpStatus({ status: 403 });
    expect(status.code).toBe("DOCUMENT_HTTP_STATUS");
    expect(status.message).toBe("the presigned document URL answered HTTP 403");
    const large = VantaSyncErrors.documentTooLarge({ byteLength: 67108865, cap: 67108864 });
    expect(large.code).toBe("DOCUMENT_TOO_LARGE");
    expect(large.message).toBe(
      "the presigned document is 67108865 bytes, past the 67108864-byte cap this reader will hold in memory",
    );
    const unfetchable = VantaSyncErrors.documentUnfetchable({ cause: new Error("fetch failed") });
    expect(unfetchable.code).toBe("DOCUMENT_UNFETCHABLE");
    expect(unfetchable.message).toBe("could not fetch the presigned document: fetch failed");
  });

  it("names the companion file it could not write", () => {
    const error = VantaSyncErrors.companionUnwritable({ cause: new Error("EROFS"), path: "/tmp/x/v1.json" });
    expect(error.code).toBe("COMPANION_UNWRITABLE");
    expect(error.message).toBe("cannot write the sensitive companion file at /tmp/x/v1.json: EROFS");
  });
});

describe("VantaSyncErrors — the child fan-out", () => {
  it("keeps a failed parent's reasons on ONE line", () => {
    const error = VantaSyncErrors.childParentFailed({
      parentId: "v1",
      parentKind: "vendor",
      surface: "vendor-findings",
      upstream: ["a", "b"],
    });
    expect(error.code).toBe("CHILD_PARENT_FAILED");
    expect(vantaSyncErrorLines({ error })).toEqual(["vendor-findings for vendor v1: a; b"]);
  });

  it("heads an absent surface with the asked count and at most three refused parents", () => {
    const error = VantaSyncErrors.childSurfaceAbsent({
      asked: 4,
      parentKind: "vendor",
      refused: [
        { parentId: "v1", reason: "r1" },
        { parentId: "v2", reason: "r2" },
        { parentId: "v3", reason: "r3" },
        { parentId: "v4", reason: "r4" },
      ],
      surface: "vendor-findings",
    });
    expect(error.code).toBe("CHILD_SURFACE_ABSENT");
    expect(vantaSyncErrorLines({ error })).toEqual([
      "every one of the 4 vendor(s) refused vendor-findings — a surface no parent can serve is an absent surface, not an empty one",
      "  v1: r1",
      "  v2: r2",
      "  v3: r3",
    ]);
  });

  it("says a parent was not read at all when it carries no reasons of its own", () => {
    const error = VantaSyncErrors.parentFanOutRefused({
      parentKind: "vendor",
      parentReasons: null,
      surface: "vendor-findings",
    });
    expect(error.code).toBe("PARENT_FAN_OUT_REFUSED");
    expect(vantaSyncErrorLines({ error })).toEqual([
      "vendor-findings cannot be fanned out over vendor, which did not read completely this run — a partial fan-out would read as a tenant with fewer children than it has",
      "vendor was not read at all this run",
    ]);
  });

  it("carries a failed parent's own reasons under the fan-out refusal", () => {
    const error = VantaSyncErrors.parentFanOutRefused({
      parentKind: "vendor",
      parentReasons: ["x"],
      surface: "vendor-findings",
    });
    expect(vantaSyncErrorLines({ error })).toEqual([
      "vendor-findings cannot be fanned out over vendor, which did not read completely this run — a partial fan-out would read as a tenant with fewer children than it has",
      "x",
    ]);
  });
});
