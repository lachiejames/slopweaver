/**
 * The `outbound-privacy-closure` gate's pure analyser, driven over inline fixtures so every failure shape is shown
 * able to fire, plus the real registry's own shape. The real-tree run is the gate's (`yarn lint --only
 * outbound-privacy-closure`), never this file's.
 */
import { describe, expect, it } from "vitest";

import type { VerbManifestEntry } from "../../../cli/manifest.js";
import { NOUN_GROUPS } from "../../../cli/nounGroups.js";
import type { NounGroups } from "../../../cli/router.js";
import { analyzeOutboundPrivacyClosure, callsCheckPrivacy } from "../../../devLint/outboundPrivacyClosure.js";
import { externalWriteVerbsOf } from "../../../devLint/outboundPrivacyDenominator.js";
import { OUTBOUND_PRIVACY_FAMILIES, type OutboundWriteFamily } from "../../../devLint/outboundPrivacyRegistry.js";
import { SANCTIONED_CLIENT_FACTORIES } from "../../../devLint/schedulerBypass.js";

/** One registry entry carrying only the effect the analyser reads. */
function entry({ effect }: { effect: "external-write" | "external-read" }): VerbManifestEntry {
  const real = NOUN_GROUPS["github"]!["push"]!;
  return { ...real, meta: { ...real.meta, effect } };
}

const GROUPS: NounGroups = {
  acme: {
    "": entry({ effect: "external-write" }),
    read: entry({ effect: "external-read" }),
    send: entry({ effect: "external-write" }),
  },
};

const GUARD = [
  'import { checkPrivacy } from "../privacyCheck.js";',
  "export const judge = (content: string) => checkPrivacy({ content });",
].join("\n");

const FACTORY = "src/corpus/acme/writeClient.ts";
const READ_FACTORY = "src/corpus/acme/readClient.ts";

const ACME: OutboundWriteFamily = {
  classification: { checks: ["src/outbound/acme/writePrivacyPayload.ts"], kind: "guarded" },
  factories: [FACTORY],
  id: "acme",
  selectors: [{ noun: "acme", verbs: "all" }],
  transports: [FACTORY],
};

const ACME_READ: OutboundWriteFamily = {
  classification: { kind: "read-only", reason: "the acme read lane" },
  factories: [READ_FACTORY],
  id: "acme-read",
  selectors: [],
  transports: [],
};

const GUARDED_TREE: Readonly<Record<string, string>> = {
  [FACTORY]: 'import { judge } from "../../outbound/acme/writePrivacyPayload.js";\nexport const send = judge;',
  [READ_FACTORY]: "export const read = () => fetch('x');",
  "src/outbound/acme/writePrivacyPayload.ts": GUARD,
  "src/outbound/privacyCheck.ts": "export function checkPrivacy() {}",
};

/** The analyser over a fixture tree, with both acme factories sanctioned unless a case says otherwise. */
function analyse({
  families,
  files = GUARDED_TREE,
  groups = GROUPS,
  sanctioned = [FACTORY, READ_FACTORY],
}: {
  families: readonly OutboundWriteFamily[];
  files?: Readonly<Record<string, string>>;
  groups?: NounGroups;
  sanctioned?: readonly string[];
}): readonly { readonly code: string; readonly subject: string }[] {
  return analyzeOutboundPrivacyClosure({
    exists: (path) => path in files,
    families,
    groups,
    readText: (path) => files[path]!,
    sanctioned,
  }).issues.map(({ code, subject }) => ({ code, subject }));
}

describe("externalWriteVerbsOf", () => {
  it("lists each external-write verb sorted, skipping the noun's alias and every read", () => {
    const hidden: NounGroups = {
      zorvane: Object.defineProperty({}, "post", { enumerable: false, value: entry({ effect: "external-write" }) }),
      ...GROUPS,
    };
    expect(externalWriteVerbsOf({ groups: hidden })).toStrictEqual(["acme send", "zorvane post"]);
  });
});

describe("callsCheckPrivacy", () => {
  it("credits a named runtime import that is called, an aliased one included", () => {
    expect(callsCheckPrivacy({ content: GUARD, path: "src/outbound/acme/writePrivacyPayload.ts" })).toBe(true);
    expect(
      callsCheckPrivacy({
        content: 'import { checkPrivacy as judge } from "../privacyCheck.js";\njudge({});',
        path: "src/outbound/acme/x.ts",
      }),
    ).toBe(true);
  });

  it.each([
    ["an import never called", 'import { checkPrivacy } from "../privacyCheck.js";\nexport { checkPrivacy };'],
    ["a type import", 'import type { checkPrivacy } from "../privacyCheck.js";\ncheckPrivacy({});'],
    ["a call with no import", "checkPrivacy({});"],
    ["a comment and a string", '// checkPrivacy({})\nexport const note = "checkPrivacy({})";'],
    ["the same name from another module", 'import { checkPrivacy } from "../quillfeather.js";\ncheckPrivacy({});'],
    [
      "a parameter shadowing the import",
      'import { checkPrivacy } from "../privacyCheck.js";\nexport function judge(checkPrivacy: () => void) { checkPrivacy(); }',
    ],
    [
      "a local shadowing the import",
      'import { checkPrivacy } from "../privacyCheck.js";\nexport function judge() { const checkPrivacy = () => 0; return checkPrivacy(); }',
    ],
  ])("refuses %s", (_label, content) => {
    expect(callsCheckPrivacy({ content, path: "src/outbound/acme/x.ts" })).toBe(false);
  });
});

describe("analyzeOutboundPrivacyClosure", () => {
  it("closes a guarded family whose roots reach a module calling the check, beside a read-only factory", () => {
    const report = analyzeOutboundPrivacyClosure({
      exists: (path) => path in GUARDED_TREE,
      families: [ACME, ACME_READ],
      groups: GROUPS,
      readText: (path) => GUARDED_TREE[path]!,
      sanctioned: [FACTORY, READ_FACTORY],
    });
    expect(report).toStrictEqual({ externalWrites: ["acme send"], issues: [] });
  });

  it("fails an external-write verb no family selects, and a selector naming none", () => {
    const family = { ...ACME, selectors: [{ noun: "acme", verbs: ["read"] }] };
    expect(analyse({ families: [family, ACME_READ] })).toStrictEqual([
      { code: "UNREGISTERED_EXTERNAL_WRITE", subject: "acme send" },
      { code: "STALE_SELECTOR", subject: "acme: acme read" },
    ]);
  });

  it("sees an external-write verb declared non-enumerable, which the router still dispatches", () => {
    const hidden: NounGroups = {
      ...GROUPS,
      zorvane: Object.defineProperty({}, "send", { enumerable: false, value: entry({ effect: "external-write" }) }),
    };
    expect(analyse({ families: [ACME, ACME_READ], groups: hidden })).toStrictEqual([
      { code: "UNREGISTERED_EXTERNAL_WRITE", subject: "zorvane send" },
    ]);
  });

  it("fails a whole-noun selector once its noun writes nothing", () => {
    const quiet: NounGroups = { ...GROUPS, zorvane: { read: entry({ effect: "external-read" }) } };
    const family = { ...ACME, selectors: [...ACME.selectors, { noun: "zorvane", verbs: "all" as const }] };
    expect(analyse({ families: [family, ACME_READ], groups: quiet })).toStrictEqual([
      { code: "STALE_SELECTOR", subject: "acme: zorvane" },
    ]);
  });

  it("fails a sanctioned factory no family owns, one owned that is no longer sanctioned, and one owned twice", () => {
    const fresh = "src/corpus/quillfeather/client.ts";
    expect(analyse({ families: [ACME, ACME_READ], sanctioned: [FACTORY, READ_FACTORY, fresh] })).toStrictEqual([
      { code: "UNCLASSIFIED_FACTORY", subject: fresh },
    ]);
    expect(analyse({ families: [ACME, ACME_READ], sanctioned: [FACTORY] })).toStrictEqual([
      { code: "STALE_FACTORY", subject: `acme-read: ${READ_FACTORY}` },
    ]);
    const twice = { ...ACME_READ, factories: [READ_FACTORY, FACTORY] };
    expect(analyse({ families: [ACME, twice] })).toStrictEqual([{ code: "DUPLICATE_FACTORY", subject: FACTORY }]);
  });

  it("fails a duplicated family, an empty reason, and a read-only family that names a write", () => {
    const blank = { ...ACME_READ, classification: { kind: "read-only" as const, reason: " " } };
    expect(analyse({ families: [ACME, ACME_READ, { ...ACME_READ, factories: [] }] })).toStrictEqual([
      { code: "DUPLICATE_FAMILY", subject: "acme-read" },
    ]);
    expect(analyse({ families: [ACME, blank] })).toStrictEqual([{ code: "EMPTY_REASON", subject: "acme-read" }]);
    const writes = { ...ACME_READ, transports: [READ_FACTORY] };
    expect(analyse({ families: [ACME, writes] })).toStrictEqual([
      { code: "READ_ONLY_REACHES_WRITE", subject: "acme-read" },
    ]);
  });

  it("fails a guarded family whose check module stops calling the check, or whose root stops reaching it", () => {
    const uncalled = { ...GUARDED_TREE, "src/outbound/acme/writePrivacyPayload.ts": "export const judge = () => [];" };
    const unreached = { ...GUARDED_TREE, [FACTORY]: "export const send = () => fetch('x');" };
    expect(analyse({ families: [ACME, ACME_READ], files: uncalled })).toStrictEqual([
      { code: "CHECK_NOT_CALLED", subject: "acme: src/outbound/acme/writePrivacyPayload.ts" },
    ]);
    expect(analyse({ families: [ACME, ACME_READ], files: unreached })).toStrictEqual([
      { code: "GUARD_NOT_REACHED", subject: `acme: ${FACTORY}` },
    ]);
  });

  it.each([
    ["an `import type` clause", 'import type { checkPrivacy } from "../privacyCheck.js";'],
    ["an inline `type` element", 'import { type checkPrivacy } from "../privacyCheck.js";'],
  ])("refuses a guarded family whose check module reaches checkPrivacy only through %s", (_label, importLine) => {
    const typeOnly = {
      ...GUARDED_TREE,
      "src/outbound/acme/writePrivacyPayload.ts": `${importLine}\nexport const judge = (content: string) => checkPrivacy({ content });`,
    };
    expect(analyse({ families: [ACME, ACME_READ], files: typeOnly })).toStrictEqual([
      { code: "CHECK_NOT_CALLED", subject: "acme: src/outbound/acme/writePrivacyPayload.ts" },
    ]);
  });

  it("fails a guarded family with no transport or factory, which would otherwise pass with nothing checked", () => {
    const rootless = { ...ACME, factories: [], transports: [] };
    expect(analyse({ families: [rootless, ACME_READ], sanctioned: [READ_FACTORY] })).toStrictEqual([
      { code: "NO_ROOT", subject: "acme" },
    ]);
  });

  it("fails a missing module, naming it", () => {
    const { [FACTORY]: _gone, ...files } = GUARDED_TREE;
    expect(analyse({ families: [ACME, ACME_READ], files })).toStrictEqual([
      { code: "MISSING_MODULE", subject: `acme: ${FACTORY}` },
    ]);
  });

  it("passes a residue family that reaches no check, and fails it the moment its guard lands", () => {
    const residue: OutboundWriteFamily = { ...ACME, classification: { kind: "residue", reason: "no guard yet" } };
    const unguarded = { ...GUARDED_TREE, [FACTORY]: "export const send = () => fetch('x');" };
    expect(analyse({ families: [residue, ACME_READ], files: unguarded })).toStrictEqual([]);
    expect(analyse({ families: [residue, ACME_READ] })).toStrictEqual([
      { code: "RESIDUE_IS_NOW_GUARDED", subject: "acme" },
    ]);
  });

  it.each([
    ["guarded", ACME.classification],
    ["residue", { kind: "residue" as const, reason: "no guard yet" }],
  ])("fails a %s family whose roots disagree", (_label, classification) => {
    const second = "src/corpus/acme/second.ts";
    const files = { ...GUARDED_TREE, [second]: "export const send = () => fetch('x');" };
    const family = { ...ACME, classification, transports: [FACTORY, second] };
    expect(analyse({ families: [family, ACME_READ], files })).toStrictEqual([
      { code: "PARTIAL_FAMILY", subject: "acme" },
    ]);
  });

  it.each([
    ["no families", { families: [] }],
    [
      "no external-write verbs",
      { families: [ACME, ACME_READ], groups: { acme: { read: entry({ effect: "external-read" }) } } },
    ],
    ["no sanctioned factories", { families: [ACME, ACME_READ], sanctioned: [] }],
  ])("reports no closure over %s", (_label, input) => {
    expect(analyse(input)).toStrictEqual([{ code: "EMPTY_DENOMINATOR", subject: "denominator" }]);
  });
});

describe("the real registry's shape", () => {
  const ids = OUTBOUND_PRIVACY_FAMILIES.map(({ id }) => id);
  const owned = OUTBOUND_PRIVACY_FAMILIES.flatMap(({ factories }) => factories);
  const sanctioned = Object.keys(SANCTIONED_CLIENT_FACTORIES);

  it("is non-empty, with at least one family of each classification", () => {
    expect(OUTBOUND_PRIVACY_FAMILIES.length).toBeGreaterThan(0);
    expect(new Set(OUTBOUND_PRIVACY_FAMILIES.map(({ classification }) => classification.kind))).toStrictEqual(
      new Set(["guarded", "read-only", "residue"]),
    );
  });

  it("declares each family once and owns each sanctioned factory exactly once", () => {
    expect(ids.filter((id, index) => ids.indexOf(id) !== index)).toStrictEqual([]);
    expect(owned.toSorted()).toStrictEqual(sanctioned.toSorted());
  });

  it("classifies Google Calendar guarded, now its guard is on main", () => {
    expect(OUTBOUND_PRIVACY_FAMILIES.find(({ id }) => id === "google-calendar")!.classification.kind).toBe("guarded");
  });
});
