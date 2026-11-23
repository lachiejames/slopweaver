/**
 * The pure memory builder: both identities, the placement gate, and the facets each kind may carry.
 *
 * Every case here is a property the register's value rests on. The identity tests in particular are the
 * ones that would let a refactor silently delete the owner's consolidation signal while every query kept
 * working — so they assert the exact id rather than that two ids are equal.
 */
import { describe, expect, it } from "vitest";

import { noInstallDomains } from "../../../knowledge/domainVocabulary.js";
import { MEMORY_PLACEMENT_DESTINATIONS, MEMORY_PLACEMENTS, RETAINED_PLACEMENT } from "../../../knowledge/memory.js";
import { buildMemoryRecording, type MemoryInput, memoryId } from "../../../knowledge/memoryRow.js";
import { unwrap } from "../../../lib/result.js";

const INSTALL_HOME = "/tmp/sw-home";
const NONE = noInstallDomains({ home: INSTALL_HOME });

const RECORDING_ID = "a0000075-0000-4000-8000-000000000081";
const RECORDED_AT = new Date("2026-09-12T10:00:00.000Z");

/** A complete, valid lesson input. Fields are overridden per test rather than rebuilt. */
const lesson = (over: Partial<MemoryInput> = {}): MemoryInput =>
  ({
    behaviourChange: "check the agent sample rate before writing a retention filter",
    claim: "APM adaptive sampling sits upstream of retention filters",
    domain: "datadog",
    evidence: "a 100%-error retention filter kept 0 of 412 traces over 7d",
    kind: "lesson",
    learner: "fleet",
    placement: "retrieved",
    retrievalCue: "a task mentioning datadog tracing or sampling",
    run: "ad-hoc",
    surface: "api",
    tier: 2,
    verdict: "confirmed",
    ...over,
  }) as MemoryInput;

/** A complete, valid preference input. */
const preference = (over: Partial<MemoryInput> = {}): MemoryInput =>
  ({
    behaviourChange: "route every question through the supervisor, never the owner's own tab",
    claim: "The owner only speaks to the pinned supervisor chat",
    domain: "doctrine",
    evidence: "owner turn 240-14, 12 Sep 2026",
    kind: "preference",
    learner: "owner",
    placement: "retrieved",
    retrievalCue: "any task about reaching the owner",
    run: "ad-hoc",
    verdict: "confirmed",
    ...over,
  }) as MemoryInput;

describe("the placement vocabulary", () => {
  it("carries the three destinations AND the two exits that store nothing", () => {
    expect([...MEMORY_PLACEMENTS]).toEqual(["retrieved", "always-loaded", "skill", "board", "nowhere"]);
  });

  it("names a real destination for every value, so a refusal always says where to go instead", () => {
    expect(MEMORY_PLACEMENTS.filter((value) => MEMORY_PLACEMENT_DESTINATIONS[value].length > 0).length).toBe(
      MEMORY_PLACEMENTS.length,
    );
  });

  it("retains exactly one of them in this table", () => {
    expect(RETAINED_PLACEMENT).toBe("retrieved");
  });
});

describe("memoryId", () => {
  it("is stable across casing, spacing and terminal punctuation", () => {
    const a = memoryId({ claim: "APM sampling sits upstream", domain: "datadog", kind: "lesson" });
    const b = memoryId({ claim: "  apm   SAMPLING sits upstream.  ", domain: "datadog", kind: "lesson" });
    expect(a).toBe(b);
  });

  it("differs when the domain differs, so one wording in two systems is two claims", () => {
    const a = memoryId({ claim: "the id truncates", domain: "datadog", kind: "lesson" });
    const b = memoryId({ claim: "the id truncates", domain: "linear", kind: "lesson" });
    expect(a === b).toBe(false);
  });

  it("carries the kind's prefix, so a claim id says which contract produced it", () => {
    expect(memoryId({ claim: "x", domain: "datadog", kind: "lesson" }).slice(0, 2)).toBe("l-");
    expect(memoryId({ claim: "x", domain: "datadog", kind: "preference" }).slice(0, 2)).toBe("p-");
  });

  it("is an 18-character id — a two-character prefix and 16 hex", () => {
    expect(memoryId({ claim: "x", domain: "datadog", kind: "lesson" }).length).toBe(18);
  });
});

describe("buildMemoryRecording placement gate", () => {
  it("refuses a placement of skill and names where it actually belongs", () => {
    const built = buildMemoryRecording({
      installDomains: NONE,
      input: lesson({ placement: "skill" }),
      recordedAt: RECORDED_AT,
      recordingId: RECORDING_ID,
    });
    expect(built.isErr()).toBe(true);
    expect(built._unsafeUnwrapErr().code).toBe("PLACEMENT_REFUSED");
    expect(built._unsafeUnwrapErr().message).toContain("skills/<name>/reference");
  });

  it("refuses a placement of always-loaded and points at the Claude memory corpus", () => {
    const built = buildMemoryRecording({
      installDomains: NONE,
      input: preference({ placement: "always-loaded" }),
      recordedAt: RECORDED_AT,
      recordingId: RECORDING_ID,
    });
    expect(built._unsafeUnwrapErr().message).toContain("Claude project memory corpus");
  });

  it("refuses a placement of board and points at handover ask", () => {
    const built = buildMemoryRecording({
      installDomains: NONE,
      input: lesson({ placement: "board" }),
      recordedAt: RECORDED_AT,
      recordingId: RECORDING_ID,
    });
    expect(built._unsafeUnwrapErr().message).toContain("slopweaver handover ask");
  });

  it("refuses BEFORE checking the other fields, so the writer is told the destination first", () => {
    const built = buildMemoryRecording({
      installDomains: NONE,
      input: lesson({ claim: "", placement: "nowhere" }),
      recordedAt: RECORDED_AT,
      recordingId: RECORDING_ID,
    });
    expect(built._unsafeUnwrapErr().code).toBe("PLACEMENT_REFUSED");
  });
});

describe("buildMemoryRecording lesson", () => {
  it("keeps both identities and every facet", () => {
    const row = unwrap(
      buildMemoryRecording({
        installDomains: NONE,
        input: lesson(),
        recordedAt: RECORDED_AT,
        recordingId: RECORDING_ID,
      }),
    );
    expect(row.recordingId).toBe(RECORDING_ID);
    expect(row.id).toBe(memoryId({ claim: lesson().claim, domain: "datadog", kind: "lesson" }));
    expect(row.kind).toBe("lesson");
    expect(row.tier).toBe(2);
    expect(row.surface).toBe("api");
    expect(row.learner).toBe("fleet");
    expect(row.behaviourChange).toBe("check the agent sample rate before writing a retention filter");
    expect(row.retrievalCue).toBe("a task mentioning datadog tracing or sampling");
    expect(row.recordedAt).toBe(RECORDED_AT);
  });

  it("gives two recordings of one claim the same id and different recording ids", () => {
    const first = unwrap(
      buildMemoryRecording({
        installDomains: NONE,
        input: lesson(),
        recordedAt: RECORDED_AT,
        recordingId: RECORDING_ID,
      }),
    );
    const second = unwrap(
      buildMemoryRecording({
        installDomains: NONE,
        input: lesson({ run: "another-run", verdict: "changed" }),
        recordedAt: new Date("2026-09-13T10:00:00.000Z"),
        recordingId: "99999999-2222-3333-4444-555555555555",
      }),
    );
    expect(second.id).toBe(first.id);
    expect(second.recordingId).toBe("99999999-2222-3333-4444-555555555555");
  });

  it("nulls an absent repro rather than storing an empty string", () => {
    const row = unwrap(
      buildMemoryRecording({
        installDomains: NONE,
        input: lesson({ repro: "   " }),
        recordedAt: RECORDED_AT,
        recordingId: RECORDING_ID,
      }),
    );
    expect(row.repro).toBe(null);
  });
});

describe("buildMemoryRecording preference", () => {
  it("carries no lesson facet at all — the shape the CHECK constraint enforces", () => {
    const row = unwrap(
      buildMemoryRecording({
        installDomains: NONE,
        input: preference(),
        recordedAt: RECORDED_AT,
        recordingId: RECORDING_ID,
      }),
    );
    expect(row.kind).toBe("preference");
    expect(row.tier).toBe(null);
    expect(row.surface).toBe(null);
    expect(row.repro).toBe(null);
    expect(row.learner).toBe("owner");
  });
});

describe("buildMemoryRecording field checks", () => {
  it("refuses an empty behaviour-change by name", () => {
    const built = buildMemoryRecording({
      installDomains: NONE,
      input: lesson({ behaviourChange: "  " }),
      recordedAt: RECORDED_AT,
      recordingId: RECORDING_ID,
    });
    expect(built._unsafeUnwrapErr().code).toBe("INVALID_FIELD");
    expect(built._unsafeUnwrapErr().message).toBe("behaviour-change is empty");
  });

  it("refuses an empty retrieval-cue by name", () => {
    const built = buildMemoryRecording({
      installDomains: NONE,
      input: lesson({ retrievalCue: "" }),
      recordedAt: RECORDED_AT,
      recordingId: RECORDING_ID,
    });
    expect(built._unsafeUnwrapErr().message).toBe("retrieval-cue is empty");
  });

  it("refuses an empty learner, so an attribution is never silently blank", () => {
    const built = buildMemoryRecording({
      installDomains: NONE,
      input: lesson({ learner: "" }),
      recordedAt: RECORDED_AT,
      recordingId: RECORDING_ID,
    });
    expect(built._unsafeUnwrapErr().message).toBe("learner is empty");
  });

  it("refuses a claim over the 400-character bound, naming both numbers", () => {
    const built = buildMemoryRecording({
      installDomains: NONE,
      input: lesson({ claim: "x".repeat(401) }),
      recordedAt: RECORDED_AT,
      recordingId: RECORDING_ID,
    });
    expect(built._unsafeUnwrapErr().message).toBe("claim is 401 characters, over the 400 allowed");
  });

  it("refuses a domain that is not a slug", () => {
    const built = buildMemoryRecording({
      installDomains: NONE,
      input: lesson({ domain: "Data Dog!" }),
      recordedAt: RECORDED_AT,
      recordingId: RECORDING_ID,
    });
    expect(built._unsafeUnwrapErr().code).toBe("INVALID_DOMAIN");
  });

  it("refuses a retired spelling and names the domain it folded into, rather than rewriting it", () => {
    const built = buildMemoryRecording({
      installDomains: NONE,
      input: preference({ domain: "ways-of-working" }),
      recordedAt: RECORDED_AT,
      recordingId: RECORDING_ID,
    });
    expect(built._unsafeUnwrapErr().code).toBe("DOMAIN_RETIRED");
    expect(built._unsafeUnwrapErr().message).toBe(
      'domain "ways-of-working" folded into "doctrine" — record it under --domain doctrine',
    );
  });

  it("refuses a slug the vocabulary never held, naming the home whose store it could be added to", () => {
    const built = buildMemoryRecording({
      installDomains: NONE,
      input: lesson({ domain: "made-up-system" }),
      recordedAt: RECORDED_AT,
      recordingId: RECORDING_ID,
    });
    expect(built._unsafeUnwrapErr().code).toBe("DOMAIN_NOT_CONFIGURED");
    expect(built._unsafeUnwrapErr().message).toContain(`--home ${INSTALL_HOME}`);
  });

  it("accepts a domain the install holds", () => {
    const row = unwrap(
      buildMemoryRecording({
        input: lesson({ domain: "acme" }),
        installDomains: {
          aliases: {},
          domains: [{ holds: "the synthetic team monorepo", slug: "acme" }],
          home: INSTALL_HOME,
        },
        recordedAt: RECORDED_AT,
        recordingId: RECORDING_ID,
      }),
    );
    expect(row.domain).toBe("acme");
  });
});

describe("buildMemoryRecording supersedes", () => {
  it("carries the retired claim's id, trimmed", () => {
    const row = unwrap(
      buildMemoryRecording({
        installDomains: NONE,
        input: lesson({ supersedes: "  l-0123456789abcdef " }),
        recordedAt: RECORDED_AT,
        recordingId: RECORDING_ID,
      }),
    );
    expect(row.supersedes).toBe("l-0123456789abcdef");
  });

  it("stores null when the recording retires nothing", () => {
    const row = unwrap(
      buildMemoryRecording({
        installDomains: NONE,
        input: lesson(),
        recordedAt: RECORDED_AT,
        recordingId: RECORDING_ID,
      }),
    );
    expect(row.supersedes).toBe(null);
  });

  it("refuses a claim retiring itself, which would hide the recording that did it", () => {
    const own = memoryId({ claim: lesson().claim, domain: "datadog", kind: "lesson" });
    const built = buildMemoryRecording({
      installDomains: NONE,
      input: lesson({ supersedes: own }),
      recordedAt: RECORDED_AT,
      recordingId: RECORDING_ID,
    });
    expect(built._unsafeUnwrapErr().code).toBe("SUPERSEDES_REFUSED");
    expect(built._unsafeUnwrapErr().message).toBe(
      `cannot supersede ${own} — it is this recording's own claim — record a new verdict on it instead`,
    );
  });

  it("refuses an empty claim id rather than retiring nothing silently", () => {
    const built = buildMemoryRecording({
      installDomains: NONE,
      input: lesson({ supersedes: "   " }),
      recordedAt: RECORDED_AT,
      recordingId: RECORDING_ID,
    });
    expect(built._unsafeUnwrapErr().message).toBe("supersedes is empty");
  });
});
