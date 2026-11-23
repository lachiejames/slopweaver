/**
 * Releasing a create reservation a guard refused before the wire: only this invocation's own still-unconfirmed
 * record goes, matched by id and reservation instant, in every ledger a Linear create reserves in. And the reading
 * that decides it: only an explicit `refusedBeforeWire` marker, found along the `cause` chain, settles a failure.
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { IngestError } from "../../../../lib/ingestError.js";
import { InvalidDatadogHostRefusedError } from "../../../../outbound/invalidDatadogHost.js";
import {
  confirmAppend,
  readAppendRecord,
  releaseAppendReservation,
  reserveAppend,
} from "../../../../outbound/linear/commentLedger.js";
import {
  readDocumentRecord,
  releaseDocumentReservation,
  reserveDocument,
} from "../../../../outbound/linear/documentLedger.js";
import {
  confirmIssue,
  readIssueRecord,
  releaseIssueReservation,
  reserveIssue,
} from "../../../../outbound/linear/issueLedger.js";
import {
  readProjectRecord,
  releaseObjectReservation,
  reserveProject,
} from "../../../../outbound/linear/projectLedger.js";
import { releaseUnconfirmedRecord } from "../../../../outbound/linear/reservationRelease.js";
import { refusedBeforeWire, settledBeforeWire } from "../../../../outbound/linear/sendFailure.js";
import { LinearPrivacyRefusedError } from "../../../../outbound/linear/writePrivacy.js";

const homes: string[] = [];

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

function tempHome(): string {
  const home = mkdtempSync(join(tmpdir(), "linear-release-"));
  homes.push(home);
  return home;
}

const AT = "2026-08-02T10:00:00.000Z";
const LATER = "2026-08-02T10:05:00.000Z";

describe("releaseUnconfirmedRecord", () => {
  const OWN = JSON.stringify({ id: "r1", reservedIso: AT });
  const parse = ({ raw }: { raw: string }): { id: string; reservedIso: string } | undefined => {
    const value: unknown = JSON.parse(raw);
    return typeof value === "object" && value !== null && "id" in value && "reservedIso" in value
      ? { id: String(value.id), reservedIso: String(value.reservedIso) }
      : undefined;
  };

  it("releases nothing for an update, which reserved nothing, and leaves the record in place", () => {
    const dir = tempHome();
    const path = join(dir, "r1.json");
    writeFileSync(path, OWN);
    expect(releaseUnconfirmedRecord({ id: "r1", parse, path, reservedIso: undefined })).toBe(false);
    expect(readFileSync(path, "utf8")).toBe(OWN);
  });

  it("puts a record its parser cannot read back exactly where it was, leaving no claimed copy", () => {
    const dir = tempHome();
    const path = join(dir, "r1.json");
    writeFileSync(path, '{"unrelated":true}');
    expect(releaseUnconfirmedRecord({ id: "r1", parse, path, reservedIso: AT })).toBe(false);
    expect(readFileSync(path, "utf8")).toBe('{"unrelated":true}');
    expect(readdirSync(dir)).toEqual(["r1.json"]);
  });

  it("removes its own unconfirmed reservation and leaves nothing behind", () => {
    const dir = tempHome();
    const path = join(dir, "r1.json");
    writeFileSync(path, OWN);
    expect(releaseUnconfirmedRecord({ id: "r1", parse, path, reservedIso: AT })).toBe(true);
    expect(readdirSync(dir)).toEqual([]);
  });
});

describe("releaseIssueReservation", () => {
  it("removes this invocation's own fresh reservation, so a retry reserves fresh", () => {
    const home = tempHome();
    reserveIssue({ home, id: "i1", nowIso: AT });
    expect(releaseIssueReservation({ home, id: "i1", reservedIso: AT })).toBe(true);
    expect(readIssueRecord({ home, id: "i1" })).toBe(undefined);
    expect(reserveIssue({ home, id: "i1", nowIso: LATER }).kind).toBe("fresh");
  });

  it("keeps a reservation another run took at a different instant", () => {
    const home = tempHome();
    reserveIssue({ home, id: "i1", nowIso: AT });
    expect(releaseIssueReservation({ home, id: "i1", reservedIso: LATER })).toBe(false);
    expect(readIssueRecord({ home, id: "i1" })!.reservedIso).toBe(AT);
  });

  it("keeps a confirmed record even at the same instant", () => {
    const home = tempHome();
    reserveIssue({ home, id: "i1", nowIso: AT });
    confirmIssue({ description: "d", home, id: "i1", identifier: "AAA-1", nowIso: LATER, updatedAt: LATER });
    expect(releaseIssueReservation({ home, id: "i1", reservedIso: AT })).toBe(false);
    expect(readIssueRecord({ home, id: "i1" })!.confirmedIso).toBe(LATER);
  });

  it("releases nothing when there is no record", () => {
    expect(releaseIssueReservation({ home: tempHome(), id: "i1", reservedIso: AT })).toBe(false);
  });

  it("never removes a record another process confirmed after this one looked, before it claimed", () => {
    const home = tempHome();
    reserveIssue({ home, id: "i1", nowIso: AT });
    const released = releaseIssueReservation({
      home,
      id: "i1",
      interleave: ({ stage }) => {
        if (stage === "before-claim") {
          confirmIssue({ description: "d", home, id: "i1", identifier: "AAA-1", nowIso: LATER, updatedAt: LATER });
        }
      },
      reservedIso: AT,
    });
    expect(released).toBe(false);
    expect(readIssueRecord({ home, id: "i1" })!.confirmedIso).toBe(LATER);
  });

  it("never touches a confirm that lands after the claim, removing only its own claimed reservation", () => {
    const home = tempHome();
    reserveIssue({ home, id: "i1", nowIso: AT });
    const released = releaseIssueReservation({
      home,
      id: "i1",
      interleave: ({ stage }) => {
        if (stage === "after-claim") {
          confirmIssue({ description: "d", home, id: "i1", identifier: "AAA-1", nowIso: LATER, updatedAt: LATER });
        }
      },
      reservedIso: AT,
    });
    expect(released).toBe(true);
    expect(readIssueRecord({ home, id: "i1" })!.confirmedIso).toBe(LATER);
  });
});

describe("the other create ledgers", () => {
  it("releases a fresh project reservation and nothing at another instant", () => {
    const home = tempHome();
    reserveProject({ home, id: "p1", nowIso: AT });
    expect(releaseObjectReservation({ home, id: "p1", kind: "linear-projects", reservedIso: LATER })).toBe(false);
    // An update reserved nothing, so it releases nothing.
    expect(releaseObjectReservation({ home, id: "p1", kind: "linear-projects", reservedIso: undefined })).toBe(false);
    expect(releaseObjectReservation({ home, id: "p1", kind: "linear-projects", reservedIso: AT })).toBe(true);
    expect(readProjectRecord({ home, id: "p1" })).toBe(undefined);
  });

  it("releases a fresh document reservation", () => {
    const home = tempHome();
    reserveDocument({ destination: { id: "p1", kind: "project" }, home, id: "d1", nowIso: AT });
    expect(releaseDocumentReservation({ home, id: "d1", reservedIso: AT })).toBe(true);
    expect(readDocumentRecord({ home, id: "d1" })).toBe(undefined);
  });

  it("releases a fresh append reservation and keeps a confirmed one", () => {
    const home = tempHome();
    reserveAppend({ home, id: "c1", kind: "linear-comments", nowIso: AT, subject: "i1" });
    reserveAppend({ home, id: "c2", kind: "linear-comments", nowIso: AT, subject: "i1" });
    confirmAppend({ home, id: "c2", kind: "linear-comments", nowIso: LATER, subject: "i1" });
    expect(releaseAppendReservation({ home, id: "c1", kind: "linear-comments", reservedIso: AT })).toBe(true);
    expect(releaseAppendReservation({ home, id: "c2", kind: "linear-comments", reservedIso: AT })).toBe(false);
    expect(readAppendRecord({ home, id: "c1", kind: "linear-comments" })).toBe(undefined);
    expect(readAppendRecord({ home, id: "c2", kind: "linear-comments" })!.confirmedIso).toBe(LATER);
  });
});

describe("refusedBeforeWire and settledBeforeWire", () => {
  const refused: IngestError = {
    cause: new LinearPrivacyRefusedError("refused"),
    kind: "network",
    message: "refused",
    operation: "linear.issueCreate",
    provider: "linear",
  };
  const lost: IngestError = {
    cause: new Error("socket hang up"),
    kind: "network",
    message: "socket hang up",
    operation: "linear.issueCreate",
    provider: "linear",
  };

  it("reads the marker through the IngestError's cause", () => {
    expect(refusedBeforeWire({ error: refused })).toBe(true);
    expect(refusedBeforeWire({ error: lost })).toBe(false);
    expect(refusedBeforeWire({ error: undefined })).toBe(false);
  });

  it("settles the dead-Datadog-host refusal too, since it also stops the mutation before the wire", () => {
    const deadHost: IngestError = { ...lost, cause: new InvalidDatadogHostRefusedError("refused") };
    expect(refusedBeforeWire({ error: deadHost })).toBe(true);
  });

  it("never trusts a bare refusedBeforeWire property: a lost reply carrying one still releases nothing", () => {
    const masquerading: IngestError = {
      ...lost,
      cause: Object.assign(new Error("timeout"), { refusedBeforeWire: true }),
    };
    const released: string[] = [];
    expect(refusedBeforeWire({ error: masquerading })).toBe(false);
    expect(
      settledBeforeWire({
        error: masquerading,
        release: () => {
          released.push("released");
        },
      }),
    ).toBe(false);
    expect(released).toEqual([]);
  });

  it("stops on a cause cycle rather than looping", () => {
    const cyclic: { cause?: unknown } = {};
    cyclic.cause = cyclic;
    expect(refusedBeforeWire({ error: cyclic })).toBe(false);
  });

  it("releases only for a refusal before the wire, and only when a release was taken", () => {
    const released: string[] = [];
    const release = (): void => {
      released.push("released");
    };
    expect(settledBeforeWire({ error: lost, release })).toBe(false);
    expect(settledBeforeWire({ error: refused, release: undefined })).toBe(true);
    expect(settledBeforeWire({ error: refused, release })).toBe(true);
    expect(released).toEqual(["released"]);
  });
});
