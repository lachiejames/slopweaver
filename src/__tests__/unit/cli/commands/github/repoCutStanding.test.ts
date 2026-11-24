import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { writePushRootBinding } from "../../../../../admit/pushRootStore.js";
import { refusePublicUnlessCutClear } from "../../../../../cli/commands/github/repoCutStanding.js";
import { emptyAcceptedOnAnchor } from "../../../../../freshCut/anchoredAcceptance.js";
import { writeFreshCutRecord, writeFreshCutVerification } from "../../../../../freshCut/store.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

const FIRST = "0b6f1c2e-3d4a-4b5c-8d6e-7f8091a2b3c4";
const SECOND = "1c7a2d3f-4e5b-4c6d-9e7f-8091a2b3c4d5";
const ROOT = "a".repeat(40);
const REPOSITORIES = ["acme/widget"];

const homes: string[] = [];

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

/** A home holding a binding of `acme/widget` to {@link ROOT} unless `bound` is false, and a record per id. */
function homeWith({ bound = true, recordIds }: { bound?: boolean; recordIds: readonly string[] }): string {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-cut-standing-"));
  homes.push(home);
  if (bound) {
    unwrap(
      writePushRootBinding({
        binding: { recordedAtIso: "2026-11-23T10:05:00.000Z", repository: "acme/widget", rootSha: ROOT },
        home,
      }),
    );
  }
  for (const recordId of recordIds) {
    unwrap(
      writeFreshCutRecord({
        home,
        record: {
          destination: `/cut/${recordId}`,
          login: "acme",
          producedAtIso: "2026-11-23T10:00:00.000Z",
          recordId,
          rootSha: ROOT,
          schemaVersion: 1,
          source: "/checkout/acme-widget",
          sourceCommitterDate: "1763892000 +0000",
          sourceSha: "d".repeat(40),
          treeSha: "b".repeat(40),
        },
      }),
    );
  }
  return home;
}

/** Write one verification of a cut, as `fresh-cut verify` would. */
function verified({
  home,
  recordId,
  status,
  at,
}: {
  home: string;
  recordId: string;
  status: "clear" | "refused";
  at: string;
}): void {
  unwrap(
    writeFreshCutVerification({
      home,
      verification: {
        destinationTreeSha: "b".repeat(40),
        exemptions: { "code-owner": 0, "documentation-address": 0, "own-address": 0, "owner-reference": 0 },
        filesScanned: 3,
        // A real verify refuses exactly when something is left found.
        findings: status === "refused" ? [{ kind: "hygiene", label: "token", line: 1, path: "a.ts" }] : [],
        recordId,
        reviewedAccepted: 0,
        acceptedOnAnchor: emptyAcceptedOnAnchor(),
        reviewedResidueSha256: "e".repeat(64),
        schemaVersion: 3,
        sourceTreeSha: "b".repeat(40),
        status,
        verifiedAtIso: at,
      },
    }),
  );
}

describe("refusePublicUnlessCutClear", () => {
  it("lets a repository the push-root register does not bind go public as before", () => {
    const home = homeWith({ bound: false, recordIds: [] });

    expect(unwrap(refusePublicUnlessCutClear({ home, repositories: REPOSITORIES }))).toBe(undefined);
  });

  it("lets a bound repository go public when the latest verification of its root reads clear", () => {
    const home = homeWith({ recordIds: [FIRST] });
    verified({ at: "2026-11-23T11:00:00.000Z", home, recordId: FIRST, status: "clear" });

    expect(unwrap(refusePublicUnlessCutClear({ home, repositories: REPOSITORIES }))).toBe(undefined);
  });

  it("judges on the latest verification across every record carrying the root, not one record's", () => {
    const home = homeWith({ recordIds: [FIRST, SECOND] });
    verified({ at: "2026-11-23T11:00:00.000Z", home, recordId: FIRST, status: "clear" });
    verified({ at: "2026-11-23T12:00:00.000Z", home, recordId: SECOND, status: "refused" });
    const refused = unwrapErr(refusePublicUnlessCutClear({ home, repositories: REPOSITORIES }));

    expect(refused.code).toBe("FACT_REFUSED");
    expect(refused.message).toBe(
      `acme/widget stays private: the latest fresh-cut verify of cut ${SECOND} (2026-11-23T12:00:00.000Z) refused. ` +
        "A re-cut repository goes public only once the latest fresh-cut verify of its cut reads clear",
    );
  });

  it("refuses two latest verifications at one instant that disagree", () => {
    const home = homeWith({ recordIds: [FIRST, SECOND] });
    verified({ at: "2026-11-23T12:00:00.000Z", home, recordId: FIRST, status: "clear" });
    verified({ at: "2026-11-23T12:00:00.000Z", home, recordId: SECOND, status: "refused" });
    const refused = unwrapErr(refusePublicUnlessCutClear({ home, repositories: REPOSITORIES }));

    expect(refused.message).toContain(
      `cuts ${FIRST}, ${SECOND} carry the same root and were verified at the same instant 2026-11-23T12:00:00.000Z`,
    );
  });

  it("refuses a report carrying a clear status and none of what a verification writes", () => {
    const home = homeWith({ recordIds: [FIRST] });
    const partial = { recordId: FIRST, status: "clear", verifiedAtIso: "2026-11-23T13:00:00.000Z" };
    writeFileSync(join(home, "fresh-cuts", FIRST, "verify-partial.json"), JSON.stringify(partial));
    const refused = unwrapErr(refusePublicUnlessCutClear({ home, repositories: REPOSITORIES }));

    expect(refused.message).toContain(
      "verify-partial.json could not be read: it is not a whole verification of that cut",
    );
  });

  it("refuses a report whose clear status contradicts its own findings", () => {
    const home = homeWith({ recordIds: [FIRST] });
    verified({ at: "2026-11-23T11:00:00.000Z", home, recordId: FIRST, status: "clear" });
    const forged = {
      destinationTreeSha: "b".repeat(40),
      exemptions: { "code-owner": 0, "documentation-address": 0, "own-address": 0, "owner-reference": 0 },
      filesScanned: 3,
      findings: [{ kind: "hygiene", label: "token", line: 1, path: "a.ts" }],
      recordId: FIRST,
      reviewedAccepted: 0,
      reviewedResidueSha256: "e".repeat(64),
      schemaVersion: 2,
      sourceTreeSha: "b".repeat(40),
      status: "clear",
      verifiedAtIso: "2026-11-23T12:00:00.000Z",
    };
    writeFileSync(join(home, "fresh-cuts", FIRST, "verify-forged.json"), JSON.stringify(forged));
    const refused = unwrapErr(refusePublicUnlessCutClear({ home, repositories: REPOSITORIES }));

    expect(refused.message).toContain(
      "verify-forged.json could not be read: it is not a whole verification of that cut",
    );
  });

  it("still reads a version 2 report written before the anchored counts existed", () => {
    const home = homeWith({ recordIds: [FIRST] });
    const older = {
      destinationTreeSha: "b".repeat(40),
      exemptions: { "code-owner": 0, "documentation-address": 0, "own-address": 0, "owner-reference": 0 },
      filesScanned: 3,
      findings: [{ kind: "hygiene", label: "token", line: 1, path: "a.ts" }],
      recordId: FIRST,
      reviewedAccepted: 0,
      reviewedResidueSha256: "e".repeat(64),
      schemaVersion: 2,
      sourceTreeSha: "b".repeat(40),
      status: "refused",
      verifiedAtIso: "2026-11-23T12:00:00.000Z",
    };
    verified({ at: "2026-11-23T11:00:00.000Z", home, recordId: FIRST, status: "clear" });
    writeFileSync(join(home, "fresh-cuts", FIRST, "verify-older.json"), JSON.stringify(older));
    const refused = unwrapErr(refusePublicUnlessCutClear({ home, repositories: REPOSITORIES }));

    expect(refused.message).toContain(`the latest fresh-cut verify of cut ${FIRST} (2026-11-23T12:00:00.000Z) refused`);
  });

  it("refuses a version 3 report whose anchored counts are wrong in shape or sum past the total", () => {
    const base = {
      destinationTreeSha: "b".repeat(40),
      exemptions: { "code-owner": 0, "documentation-address": 0, "own-address": 0, "owner-reference": 0 },
      filesScanned: 3,
      findings: [],
      recordId: FIRST,
      reviewedResidueSha256: "e".repeat(64),
      schemaVersion: 3,
      sourceTreeSha: "b".repeat(40),
      status: "clear",
      verifiedAtIso: "2026-11-23T12:00:00.000Z",
    };
    const { topic: _dropped, ...missingClass } = emptyAcceptedOnAnchor();
    const forgeries = [
      { ...base, reviewedAccepted: 0 },
      { ...base, acceptedOnAnchor: missingClass, reviewedAccepted: 0 },
      { ...base, acceptedOnAnchor: { ...emptyAcceptedOnAnchor(), "owner-address": 0 }, reviewedAccepted: 0 },
      { ...base, acceptedOnAnchor: { ...emptyAcceptedOnAnchor(), money: 2 }, reviewedAccepted: 1 },
      { ...base, acceptedOnAnchor: emptyAcceptedOnAnchor(), reviewedAccepted: 0, schemaVersion: 2 },
    ];
    const messages = forgeries.map((forged) => {
      const home = homeWith({ recordIds: [FIRST] });
      writeFileSync(join(home, "fresh-cuts", FIRST, "verify-forged.json"), JSON.stringify(forged));
      return unwrapErr(refusePublicUnlessCutClear({ home, repositories: REPOSITORIES })).message;
    });

    expect(forgeries.length).toBe(5);
    expect(
      messages.filter((message) =>
        message.includes("verify-forged.json could not be read: it is not a whole verification of that cut"),
      ).length,
    ).toBe(5);
  });

  it("lets a bound repository go public on a clear that rests on anchored acceptances", () => {
    const home = homeWith({ recordIds: [FIRST] });
    const anchoredClear = {
      acceptedOnAnchor: { ...emptyAcceptedOnAnchor(), money: 2, topic: 1 },
      destinationTreeSha: "b".repeat(40),
      exemptions: { "code-owner": 0, "documentation-address": 0, "own-address": 0, "owner-reference": 0 },
      filesScanned: 3,
      findings: [],
      recordId: FIRST,
      reviewedAccepted: 3,
      reviewedResidueSha256: "e".repeat(64),
      schemaVersion: 3,
      sourceTreeSha: "b".repeat(40),
      status: "clear",
      verifiedAtIso: "2026-11-23T12:00:00.000Z",
    };
    writeFileSync(join(home, "fresh-cuts", FIRST, "verify-anchored.json"), JSON.stringify(anchoredClear));

    expect(unwrap(refusePublicUnlessCutClear({ home, repositories: REPOSITORIES }))).toBe(undefined);
  });

  it("refuses rather than skipping a verification report it cannot parse", () => {
    const home = homeWith({ recordIds: [FIRST] });
    verified({ at: "2026-11-23T11:00:00.000Z", home, recordId: FIRST, status: "clear" });
    writeFileSync(join(home, "fresh-cuts", FIRST, "verify-broken.json"), "{");
    const refused = unwrapErr(refusePublicUnlessCutClear({ home, repositories: REPOSITORIES }));

    expect(refused.message).toContain("what acme/widget's re-cut records say could not be read");
    expect(refused.message).toContain("verify-broken.json could not be read");
  });
});
