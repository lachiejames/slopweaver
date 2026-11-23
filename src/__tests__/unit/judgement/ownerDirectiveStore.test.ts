/**
 * The owner-judgement port over the in-memory fake store: the one-time import of the legacy file, the counted
 * marker, versioned memory writes, and every refusal that must never read as "no directives".
 */
import { describe, expect, it } from "vitest";

import { OwnerDirectiveErrors } from "../../../judgement/ownerDirective.errors.js";
import type { OwnerCorrection, OwnerDirective } from "../../../judgement/ownerDirective.js";
import { ownerDirectivePort } from "../../../judgement/ownerDirectivePort.js";
import { err, ok, unwrap, unwrapErr } from "../../../lib/result.js";
import { parseMemoryLeaf } from "../../../memory/corpus.js";
import type { MemoryLeaf } from "../../../memory/types.js";
import { ownerJudgementFake } from "../../ownerJudgementFixture.js";

const HOME = "/acme/home";

const LEGACY_DIRECTIVE: OwnerDirective = {
  id: "acme-response-policy",
  source: { contentHash: `sha256:${"a".repeat(64)}`, file: "acme-response-policy.md", modified: null },
  text: "answer acme tickets from the runbook first",
};

const LEGACY_CORRECTION: OwnerCorrection = {
  id: "acme-ticket-correction",
  source: { contentHash: `sha256:${"b".repeat(64)}`, file: "acme-ticket-correction.md", modified: null },
  subject: { container: "C0ACME", source: "slack", sourceId: "1700000000.000100" },
  text: "the ABC-1 outage was the queue, not the database",
};

/** A legacy file holding one directive and one correction. */
const PRESENT_LEGACY = ok({
  records: [
    { directive: LEGACY_DIRECTIVE, kind: "directive" as const },
    { correction: LEGACY_CORRECTION, kind: "correction" as const },
  ],
  state: "present" as const,
});

/**
 * A feedback memory that opts into owner directives.
 *
 * @param name the memory's name, which becomes the directive id
 * @param description the ruling text
 * @param file the memory file that owns it
 * @param ownerDirective false to revoke
 * @returns the parsed leaf
 */
function directiveMemory({
  name = "acme-fallback-policy",
  description = "use the direct fallback",
  file = "acme-fallback-policy.md",
  ownerDirective = true,
}: { name?: string; description?: string; file?: string; ownerDirective?: boolean } = {}): MemoryLeaf {
  return parseMemoryLeaf({
    file,
    text:
      `---\nname: ${name}\ndescription: ${description}\nmetadata:\n  type: feedback\n` +
      `  slopweaver:\n    ownerDirective: ${String(ownerDirective)}\n---\n`,
  });
}

/** A feedback memory that corrects one Slack record. */
function correctionMemory(): MemoryLeaf {
  return parseMemoryLeaf({
    file: "acme-onboarding-correction.md",
    text:
      "---\nname: acme-onboarding-correction\ndescription: acme never said onboarding was the blocker\n" +
      "metadata:\n  type: feedback\n  slopweaver:\n    ownerDirective: true\n    correctionSubject:\n" +
      '      source: slack\n      container: C0ACME\n      sourceId: "1700000000.000200"\n---\n',
  });
}

describe("the one-time import", () => {
  it("marks an absent legacy file as zero imported and answers an empty overlay", async () => {
    const fake = ownerJudgementFake();

    expect(unwrap(await fake.port.readActive({ home: HOME }))).toEqual({
      corrections: [],
      directives: [],
      schemaVersion: 2,
    });
    expect(fake.state.marker).toBe(0);
    expect(fake.state.closes).toBe(1);
  });

  it("imports a present legacy file once, directives and corrections both", async () => {
    const fake = ownerJudgementFake({ legacy: PRESENT_LEGACY });

    expect(unwrap(await fake.port.readActive({ home: HOME }))).toEqual({
      corrections: [LEGACY_CORRECTION],
      directives: [LEGACY_DIRECTIVE],
      schemaVersion: 2,
    });
    expect(fake.state.marker).toBe(2);
  });

  it("never reads the legacy file again once the marker exists, even when it changed", async () => {
    const fake = ownerJudgementFake({ legacy: PRESENT_LEGACY });
    unwrap(await fake.port.readActive({ home: HOME }));
    fake.state.legacy = ok({ records: [], state: "present" });

    expect(unwrap(await fake.port.readActive({ home: HOME })).directives).toEqual([LEGACY_DIRECTIVE]);
    expect(fake.state.legacyReads).toBe(1);
  });

  it("claims nothing from a legacy file that will not decode", async () => {
    const fake = ownerJudgementFake({
      legacy: err(
        OwnerDirectiveErrors.homeFileUnreadable({ path: "/acme/legacy.json", reason: "it is not valid JSON" }),
      ),
    });

    expect(unwrapErr(await fake.port.readActive({ home: HOME })).code).toBe("OWNER_DIRECTIVE_HOME_FILE_UNREADABLE");
    expect(fake.state.marker).toBe(undefined);
    expect(fake.state.closes).toBe(1);
  });

  it("claims nothing from an outdated legacy file, and names the version", async () => {
    const fake = ownerJudgementFake({
      legacy: err(OwnerDirectiveErrors.homeFileOutdated({ path: "/acme/legacy.json", reads: 2, version: 1 })),
    });

    expect(unwrapErr(await fake.port.readActive({ home: HOME })).message).toContain("is schemaVersion 1");
    expect(fake.state.marker).toBe(undefined);
  });

  it("refuses a marker whose rows were lost rather than reading fewer", async () => {
    const fake = ownerJudgementFake({ legacy: PRESENT_LEGACY });
    unwrap(await fake.port.readActive({ home: HOME }));
    fake.state.directives = [];

    expect(unwrapErr(await fake.port.readActive({ home: HOME }))).toEqual(
      OwnerDirectiveErrors.importMarkerInconsistent({ expected: 2, observed: 1 }),
    );
  });

  it("refuses a row lost after the import was checked, though the read still finds another", async () => {
    const fake = ownerJudgementFake({ legacy: PRESENT_LEGACY });
    unwrap(await fake.port.readActive({ home: HOME }));
    fake.state.loseBeforeRead = 1;

    expect(unwrapErr(await fake.port.readActive({ home: HOME }))).toEqual(
      OwnerDirectiveErrors.importMarkerInconsistent({ expected: 2, observed: 1 }),
    );
    expect(fake.state.corrections.map((row) => row.correctionId)).toEqual([LEGACY_CORRECTION.id]);
  });

  it("refuses a memory write whose plan would read a row lost after the import was checked, and writes nothing", async () => {
    const fake = ownerJudgementFake({ legacy: PRESENT_LEGACY });
    unwrap(await fake.port.readActive({ home: HOME }));
    fake.state.loseBeforeRead = 1;

    expect(unwrapErr(await fake.port.syncFromMemory({ home: HOME, leaves: [directiveMemory()] })).code).toBe(
      "OWNER_DIRECTIVE_IMPORT_MARKER_INCONSISTENT",
    );
    expect(fake.state.directives).toEqual([]);
  });

  it("refuses a second import behind a deleted marker rather than reading both files' rulings", async () => {
    const fake = ownerJudgementFake({
      legacy: ok({ records: [{ directive: LEGACY_DIRECTIVE, kind: "directive" as const }], state: "present" as const }),
    });
    unwrap(await fake.port.readActive({ home: HOME }));
    fake.state.marker = undefined;
    fake.state.legacy = ok({ records: [{ correction: LEGACY_CORRECTION, kind: "correction" }], state: "present" });

    expect(unwrapErr(await fake.port.readActive({ home: HOME }))).toEqual(
      OwnerDirectiveErrors.importMarkerInconsistent({ expected: 1, observed: 2 }),
    );
  });

  it("refuses a lost imported row even when a memory-written version stands beside it", async () => {
    const fake = ownerJudgementFake({
      legacy: ok({ records: [{ directive: LEGACY_DIRECTIVE, kind: "directive" as const }], state: "present" as const }),
    });
    unwrap(await fake.port.syncFromMemory({ home: HOME, leaves: [directiveMemory()] }));
    unwrap(await fake.port.syncFromMemory({ home: HOME, leaves: [directiveMemory({ ownerDirective: false })] }));
    fake.state.directives = fake.state.directives.filter((row) => row.directiveId !== LEGACY_DIRECTIVE.id);

    expect(fake.state.directives.map((row) => [row.directiveId, row.state, row.origin])).toEqual([
      ["acme-fallback-policy", "inactive", "memory"],
    ]);
    expect(unwrapErr(await fake.port.readActive({ home: HOME }))).toEqual(
      OwnerDirectiveErrors.importMarkerInconsistent({ expected: 1, observed: 0 }),
    );
  });

  it("keeps a replaced legacy version's origin, so the marker still counts it, and writes the new one as memory", async () => {
    const fake = ownerJudgementFake({ legacy: PRESENT_LEGACY });
    const replacement = directiveMemory({
      description: "answer acme tickets from the corpus first",
      file: LEGACY_DIRECTIVE.source.file,
      name: LEGACY_DIRECTIVE.id,
    });
    unwrap(await fake.port.syncFromMemory({ home: HOME, leaves: [replacement] }));

    expect(fake.state.directives.map((row) => [row.state, row.origin])).toEqual([
      ["inactive", "legacy-file"],
      ["active", "memory"],
    ]);
    expect(unwrap(await fake.port.readActive({ home: HOME })).directives.map((one) => one.text)).toEqual([
      "answer acme tickets from the corpus first",
    ]);
  });

  it("imports the legacy file before the first memory write, so the write never strands it", async () => {
    const fake = ownerJudgementFake({ legacy: PRESENT_LEGACY });

    expect(unwrap(await fake.port.syncFromMemory({ home: HOME, leaves: [directiveMemory()] }))).toEqual({
      directiveCount: 2,
      kind: "written",
    });
    expect(unwrap(await fake.port.readActive({ home: HOME })).directives.map((directive) => directive.id)).toEqual([
      "acme-fallback-policy",
      "acme-response-policy",
    ]);
  });
});

describe("memory writes", () => {
  it("activates a tagged feedback memory as a directive", async () => {
    const fake = ownerJudgementFake();

    expect(unwrap(await fake.port.syncFromMemory({ home: HOME, leaves: [directiveMemory()] }))).toEqual({
      directiveCount: 1,
      kind: "written",
    });
    const directives = unwrap(await fake.port.readActive({ home: HOME })).directives;
    expect(directives.map((directive) => [directive.id, directive.text, directive.source.file])).toEqual([
      ["acme-fallback-policy", "use the direct fallback", "acme-fallback-policy.md"],
    ]);
  });

  it("replaces a changed ruling with a new version and keeps the old one inactive", async () => {
    const fake = ownerJudgementFake();
    unwrap(await fake.port.syncFromMemory({ home: HOME, leaves: [directiveMemory()] }));

    expect(
      unwrap(
        await fake.port.syncFromMemory({
          home: HOME,
          leaves: [directiveMemory({ description: "use the verified fallback" })],
        }),
      ),
    ).toEqual({ directiveCount: 1, kind: "written" });
    expect(fake.state.directives.map((row) => [row.state, row.text])).toEqual([
      ["inactive", "use the direct fallback"],
      ["active", "use the verified fallback"],
    ]);
  });

  it("reports an identical event unchanged and writes no version", async () => {
    const fake = ownerJudgementFake();
    unwrap(await fake.port.syncFromMemory({ home: HOME, leaves: [directiveMemory()] }));

    expect(unwrap(await fake.port.syncFromMemory({ home: HOME, leaves: [directiveMemory()] }))).toEqual({
      directiveCount: 1,
      kind: "unchanged",
    });
    expect(fake.state.directives.length).toBe(1);
  });

  it("revokes a ruling only on an explicit false, keeping its version inactive", async () => {
    const fake = ownerJudgementFake();
    unwrap(await fake.port.syncFromMemory({ home: HOME, leaves: [directiveMemory()] }));

    expect(
      unwrap(await fake.port.syncFromMemory({ home: HOME, leaves: [directiveMemory({ ownerDirective: false })] })),
    ).toEqual({ directiveCount: 0, kind: "written" });
    expect(unwrap(await fake.port.readActive({ home: HOME })).directives).toEqual([]);
    expect(fake.state.directives.map((row) => row.state)).toEqual(["inactive"]);
  });

  it("persists a correcting memory as a correction, never a standing directive", async () => {
    const fake = ownerJudgementFake();
    unwrap(await fake.port.syncFromMemory({ home: HOME, leaves: [directiveMemory()] }));
    unwrap(await fake.port.syncFromMemory({ home: HOME, leaves: [correctionMemory()] }));

    const overlay = unwrap(await fake.port.readActive({ home: HOME }));
    expect(overlay.directives.map((directive) => directive.id)).toEqual(["acme-fallback-policy"]);
    expect(overlay.corrections.map((correction) => correction.subject)).toEqual([
      { container: "C0ACME", source: "slack", sourceId: "1700000000.000200" },
    ]);
  });

  it("refuses a second memory file replacing a ruling another file owns, and writes nothing", async () => {
    const fake = ownerJudgementFake();
    unwrap(await fake.port.syncFromMemory({ home: HOME, leaves: [directiveMemory()] }));

    const refused = unwrapErr(
      await fake.port.syncFromMemory({
        home: HOME,
        leaves: [directiveMemory({ description: "use any fallback", file: "acme-other.md" })],
      }),
    );
    expect(refused.code).toBe("OWNER_DIRECTIVE_CONFLICT");
    expect(fake.state.directives.length).toBe(1);
  });

  it("refuses a memory write whose import cannot read the home file, and writes nothing", async () => {
    const fake = ownerJudgementFake({
      legacy: err(
        OwnerDirectiveErrors.homeFileUnreadable({ path: "/acme/legacy.json", reason: "it is not valid JSON" }),
      ),
    });

    expect(unwrapErr(await fake.port.syncFromMemory({ home: HOME, leaves: [directiveMemory()] })).code).toBe(
      "OWNER_DIRECTIVE_HOME_FILE_UNREADABLE",
    );
    expect([fake.state.marker, fake.state.directives.length]).toEqual([undefined, 0]);
  });

  it("refuses an invalid opt-in before opening the store", async () => {
    const fake = ownerJudgementFake();
    const project = parseMemoryLeaf({
      file: "acme-project.md",
      text: "---\nname: acme-project\ndescription: a project note\nmetadata:\n  type: project\n  slopweaver:\n    ownerDirective: true\n---\n",
    });

    expect(unwrapErr(await fake.port.syncFromMemory({ home: HOME, leaves: [project] })).code).toBe(
      "OWNER_DIRECTIVE_MEMORY_INVALID",
    );
    expect(fake.state.connects).toBe(0);
  });

  it("does not touch the store for an untagged memory", async () => {
    const fake = ownerJudgementFake();
    const ordinary = parseMemoryLeaf({
      file: "acme-context.md",
      text: "---\nname: acme-context\ndescription: context only\nmetadata:\n  type: feedback\n---\n",
    });

    expect(unwrap(await fake.port.syncFromMemory({ home: HOME, leaves: [ordinary] }))).toEqual({
      directiveCount: 0,
      kind: "unchanged",
    });
    expect(fake.state.directives.length).toBe(0);
  });
});

describe("an outage is never an empty overlay", () => {
  it("refuses a store that cannot be opened", async () => {
    const fake = ownerJudgementFake({ connection: "unavailable" });

    expect(unwrapErr(await fake.port.readActive({ home: HOME })).code).toBe("OWNER_DIRECTIVE_STORE_UNAVAILABLE");
  });

  it("refuses a connect seam that throws", async () => {
    const fake = ownerJudgementFake({ connection: "throws" });

    expect(unwrapErr(await fake.port.readActive({ home: HOME })).message).toBe(
      "the store could not be opened for owner directives: connection reset by acme-db",
    );
  });

  it("refuses a read that fails, and still closes the connection", async () => {
    const fake = ownerJudgementFake();
    fake.state.readFailure = "relation does not exist";

    expect(unwrapErr(await fake.port.readActive({ home: HOME })).message).toBe(
      "the store could not read the active owner directives for owner directives: relation does not exist",
    );
    expect(fake.state.closes).toBe(1);
  });

  it("refuses a memory write over a store that cannot be opened", async () => {
    const fake = ownerJudgementFake({ connection: "unavailable" });

    expect(unwrapErr(await fake.port.syncFromMemory({ home: HOME, leaves: [directiveMemory()] })).code).toBe(
      "OWNER_DIRECTIVE_STORE_UNAVAILABLE",
    );
  });
});

describe("the production port", () => {
  it("is built without opening anything, so importing a composition root costs no connection", () => {
    expect(Object.keys(ownerDirectivePort()).toSorted()).toEqual(["readActive", "syncFromMemory"]);
  });
});

describe("a home that selects no store", () => {
  it("reads empty when no legacy file waits either", async () => {
    const fake = ownerJudgementFake({ connection: "unselected" });

    expect(unwrap(await fake.port.readActive({ home: HOME }))).toEqual({
      corrections: [],
      directives: [],
      schemaVersion: 2,
    });
  });

  it("refuses a read while a legacy file still waits to be imported", async () => {
    const fake = ownerJudgementFake({ connection: "unselected", legacy: PRESENT_LEGACY });

    expect(unwrapErr(await fake.port.readActive({ home: HOME })).message).toBe(
      "owner directives wait in the legacy judgement/owner-directives.json to be imported, and no store is selected for this home — no store is configured",
    );
  });

  it("refuses a read whose home file will not decode, rather than reading it as absent", async () => {
    const fake = ownerJudgementFake({
      connection: "unselected",
      legacy: err(OwnerDirectiveErrors.homeFileOutdated({ path: "/acme/legacy.json", reads: 2, version: 1 })),
    });

    expect(unwrapErr(await fake.port.readActive({ home: HOME })).code).toBe("OWNER_DIRECTIVE_HOME_FILE_OUTDATED");
  });

  it("refuses a memory write that records a change", async () => {
    const fake = ownerJudgementFake({ connection: "unselected" });

    expect(unwrapErr(await fake.port.syncFromMemory({ home: HOME, leaves: [directiveMemory()] })).message).toBe(
      "owner directives were recorded by a memory, and no store is selected for this home — no store is configured",
    );
  });

  it("answers unchanged for an event that changes nothing", async () => {
    const fake = ownerJudgementFake({ connection: "unselected" });

    expect(unwrap(await fake.port.syncFromMemory({ home: HOME, leaves: [] }))).toEqual({
      directiveCount: 0,
      kind: "unchanged",
    });
  });
});
