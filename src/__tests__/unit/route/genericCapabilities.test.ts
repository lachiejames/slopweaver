/** The generic capability table: its decisive order, its row invariants, and the rows that carry a distinction. */
import { describe, expect, it } from "vitest";

import { MEETING_ARTIFACT_TERMS } from "../../../integrations/routing.js";
import { GENERIC_SOURCE_CAPABILITIES } from "../../../route/genericCapabilities.js";
import type { SourceCapability } from "../../../route/profile.js";

/** The fields of one row that decide how a plan treats it, without the prose a reader skims. */
function projection({ row }: { row: SourceCapability }): Record<string, unknown> {
  return {
    availability: row.availability,
    command: row.command,
    coverageKind: row.coverage.kind,
    effect: row.effect,
    freshnessKind: row.freshness.kind,
    id: row.id,
    owner: row.owner,
    sourceClass: row.sourceClass,
    truthMode: row.truthMode,
  };
}

/** The one row carrying `id`. */
function rowById({ id }: { id: string }): SourceCapability {
  return GENERIC_SOURCE_CAPABILITIES.find((row) => row.id === id)!;
}

describe("GENERIC_SOURCE_CAPABILITIES", () => {
  it("places the three live investigation reads directly behind attachments", () => {
    const at = GENERIC_SOURCE_CAPABILITIES.findIndex((row) => row.id === "hex");
    expect(GENERIC_SOURCE_CAPABILITIES[at - 1]!.id).toBe("attachments");
    expect(GENERIC_SOURCE_CAPABILITIES.slice(at, at + 3).map((row) => row.id)).toEqual(["hex", "twilio", "knock"]);
    expect(GENERIC_SOURCE_CAPABILITIES.slice(at, at + 3).map((row) => row.command)).toEqual([
      ["slopweaver", "hex", "verify"],
      ["slopweaver", "twilio", "verify"],
      ["slopweaver", "knock", "verify"],
    ]);
  });

  it("places the four live provider reads between browser and attachments", () => {
    const at = GENERIC_SOURCE_CAPABILITIES.findIndex((row) => row.id === "github-live");
    expect(GENERIC_SOURCE_CAPABILITIES[at - 1]!.id).toBe("browser");
    expect(GENERIC_SOURCE_CAPABILITIES.slice(at, at + 4).map((row) => row.id)).toEqual([
      "github-live",
      "linear-live",
      "notion-live",
      "slack-live",
    ]);
    expect(GENERIC_SOURCE_CAPABILITIES[at + 4]!.id).toBe("attachments");
    expect(GENERIC_SOURCE_CAPABILITIES.slice(at, at + 4).map((row) => row.command)).toEqual([
      ["slopweaver", "connect", "github", "--check"],
      ["slopweaver", "connect", "linear", "--check"],
      ["slopweaver", "connect", "notion", "--check"],
      ["slopweaver", "connect", "slack", "--check"],
    ]);
  });

  it("holds 27 rows in decisive order", () => {
    expect(GENERIC_SOURCE_CAPABILITIES.length).toBeGreaterThan(0);
    expect(GENERIC_SOURCE_CAPABILITIES.length).toBe(27);
    expect(GENERIC_SOURCE_CAPABILITIES.map((row) => row.id)).toEqual([
      "telemetry",
      "production-data",
      "billing",
      "saas-spend",
      "atlas-estate",
      "fleet-status",
      "handover-list",
      "queue-list",
      "audit",
      "catalog",
      "drive",
      "gmail",
      "outlook",
      "calendar",
      "browser",
      "github-live",
      "linear-live",
      "notion-live",
      "slack-live",
      "attachments",
      "hex",
      "twilio",
      "knock",
      "identity-directory",
      "knowledge-register",
      "session-transcripts",
      "corpus",
    ]);
  });

  it("places the Drive row directly ahead of Gmail", () => {
    const at = GENERIC_SOURCE_CAPABILITIES.findIndex((row) => row.id === "drive");
    expect(at).toBeGreaterThan(0);
    expect(GENERIC_SOURCE_CAPABILITIES[at + 1]!.id).toBe("gmail");
  });

  it("gives the meeting-artifact words to Drive and both mailboxes, and none to the session-log row", () => {
    expect(MEETING_ARTIFACT_TERMS).toEqual([
      "transcript",
      "transcripts",
      "recording",
      "recordings",
      "note",
      "notes",
      "meeting-transcript",
      "meeting-transcripts",
      "meeting-recording",
      "meeting-recordings",
      "meeting-note",
      "meeting-notes",
    ]);
    const holders = GENERIC_SOURCE_CAPABILITIES.filter((row) =>
      MEETING_ARTIFACT_TERMS.some((term) => row.terms.includes(term)),
    );
    expect(holders.map((row) => row.id)).toEqual(["drive", "gmail", "outlook"]);
    expect(rowById({ id: "session-transcripts" }).terms).toEqual([
      "session",
      "sessions",
      "session transcript",
      "session transcripts",
      "agent transcript",
      "agent transcripts",
      "claude transcript",
      "claude transcripts",
      "what did the agent do",
      "tool error",
      "tool errors",
    ]);
  });

  it("gives every row a distinct id", () => {
    expect(GENERIC_SOURCE_CAPABILITIES.length).toBeGreaterThan(0);
    expect(new Set(GENERIC_SOURCE_CAPABILITIES.map((row) => row.id)).size).toBe(27);
  });

  it("gives every available row a command and every unavailable row none, with a reason instead", () => {
    expect(GENERIC_SOURCE_CAPABILITIES.length).toBeGreaterThan(0);
    const unavailable = GENERIC_SOURCE_CAPABILITIES.filter((row) => row.availability.kind === "unavailable");
    expect(unavailable.map((row) => row.id)).toEqual(["production-data", "billing"]);
    expect(unavailable.map((row) => row.command)).toEqual([[], []]);
    expect(
      unavailable.filter((row) => row.availability.kind === "unavailable" && row.availability.reason.length === 0),
    ).toEqual([]);
    expect(
      GENERIC_SOURCE_CAPABILITIES.filter((row) => row.availability.kind === "available" && row.command.length === 0),
    ).toEqual([]);
  });

  it("gives every row at least one selecting term, an owner of slopweaver and a read effect", () => {
    expect(GENERIC_SOURCE_CAPABILITIES.length).toBeGreaterThan(0);
    expect(GENERIC_SOURCE_CAPABILITIES.filter((row) => row.terms.length === 0)).toEqual([]);
    expect([...new Set(GENERIC_SOURCE_CAPABILITIES.map((row) => row.owner))]).toEqual(["slopweaver"]);
    expect([...new Set(GENERIC_SOURCE_CAPABILITIES.map((row) => row.effect))]).toEqual(["read"]);
  });

  it("reads telemetry live and current through the credential check", () => {
    expect(projection({ row: rowById({ id: "telemetry" }) })).toEqual({
      availability: { kind: "available" },
      command: ["slopweaver", "datadog", "verify"],
      coverageKind: "bounded",
      effect: "read",
      freshnessKind: "live",
      id: "telemetry",
      owner: "slopweaver",
      sourceClass: "provider",
      truthMode: "current",
    });
  });

  it("states production data unavailable and points at governed access", () => {
    expect(projection({ row: rowById({ id: "production-data" }) })).toEqual({
      availability: {
        kind: "unavailable",
        reason:
          "Slopweaver has no direct production-database connector; use the installation's governed data access. " +
          "Where that access is a Hex workspace over the warehouse, the `hex` capability on this same roster is " +
          "the reader — masked and access-controlled by Hex itself, never ingested",
      },
      command: [],
      coverageKind: "unknown",
      effect: "read",
      freshnessKind: "unknown",
      id: "production-data",
      owner: "slopweaver",
      sourceClass: "provider",
      truthMode: "current",
    });
  });

  it("classes the audit as an artifact snapshot rather than a corpus history source", () => {
    expect(projection({ row: rowById({ id: "audit" }) })).toEqual({
      availability: { kind: "available" },
      command: ["slopweaver", "audit", "run"],
      coverageKind: "complete",
      effect: "read",
      freshnessKind: "snapshot",
      id: "audit",
      owner: "slopweaver",
      sourceClass: "artifact",
      truthMode: "current",
    });
  });

  it("scopes attachments with a live provider read", () => {
    expect(projection({ row: rowById({ id: "attachments" }) })).toEqual({
      availability: { kind: "available" },
      command: ["slopweaver", "pdf", "check"],
      coverageKind: "bounded",
      effect: "read",
      freshnessKind: "live",
      id: "attachments",
      owner: "slopweaver",
      sourceClass: "provider",
      truthMode: "current",
    });
  });

  it("reads the corpus as a history snapshot that takes the question itself", () => {
    expect(projection({ row: rowById({ id: "corpus" }) })).toEqual({
      availability: { kind: "available" },
      command: ["slopweaver", "store", "read", "{question}"],
      coverageKind: "bounded",
      effect: "read",
      freshnessKind: "snapshot",
      id: "corpus",
      owner: "slopweaver",
      sourceClass: "corpus",
      truthMode: "history",
    });
  });

  it("holds exactly three history rows: the knowledge register, the session transcripts and the corpus", () => {
    expect(GENERIC_SOURCE_CAPABILITIES.length).toBeGreaterThan(0);
    expect(GENERIC_SOURCE_CAPABILITIES.filter((row) => row.truthMode === "history").map((row) => row.id)).toEqual([
      "knowledge-register",
      "session-transcripts",
      "corpus",
    ]);
  });
});
