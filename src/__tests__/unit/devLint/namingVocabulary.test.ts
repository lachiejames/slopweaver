/**
 * The naming-doctrine gate's vocabulary half (rule 11, the integration glossary). Three things it must
 * prove: a retired word in a declaration we own fails, a wire-shaped spelling passes, and the debt register
 * reddens when the tree stops holding what a row records. The last describe drives the whole gate composition
 * over a synthetic tree, so a scanner that is never wired in cannot pass here.
 */

import { describe, expect, it } from "vitest";
import { ok, unwrapErr } from "#lib/result.js";
import { DevLintInputErrors } from "../../../devLint/errors.js";
import { nameSegments } from "../../../devLint/namingDoctrine.js";
import { judgeNamingDoctrine, type NamingDoctrineInputs } from "../../../devLint/namingDoctrineRun.js";
import {
  carriesRetiredWord,
  isGeneratedPath,
  type NamingVocabularyHit,
  namingVocabularyBaselineOf,
  parseNamingVocabularyBaseline,
  partitionVocabularyAgainstDebt,
  vocabularyHits,
} from "../../../devLint/namingVocabulary.js";
import {
  isVocabularyScanned,
  judgeNamingVocabulary,
  NAMING_VOCABULARY_BASELINE,
} from "../../../devLint/namingVocabularyRun.js";

const names = ({ text, path = "src/x.ts" }: { text: string; path?: string }): readonly string[] =>
  vocabularyHits({ path, text }).map((hit) => `${hit.kind}:${hit.name}`);

describe("carriesRetiredWord", () => {
  it("fires on a whole segment in every casing and plural, acronym runs split", () => {
    expect(
      [
        "FooProviderSpec",
        "SDKProvider",
        "listPlatforms",
        "corpus_connector",
        "PROVIDER_ID",
        "FooProviderÉtat",
        "ǅProvider",
        "日本Provider",
        "$Provider",
        "FoóProvider",
        "ⅫProvider",
      ].map((name) => carriesRetiredWord({ name })),
    ).toEqual([true, true, true, true, true, true, true, true, true, true, true]);
  });

  it("never fires on a word that merely contains the letters", () => {
    expect(
      ["improvised", "platformer", "connectorish", "Providence"].map((name) => carriesRetiredWord({ name })),
    ).toEqual([false, false, false, false]);
  });

  it("splits an acronym run off the word after it", () => {
    expect(nameSegments({ name: "SDKProvider" })).toEqual(["sdk", "provider"]);
  });
});

describe("vocabularyHits", () => {
  it("fails the proof-bar fixture: an interface named FooProviderSpec", () => {
    expect(vocabularyHits({ path: "src/a.ts", text: "export interface FooProviderSpec { id: string }" })).toEqual([
      { kind: "interface", line: 1, name: "FooProviderSpec", path: "src/a.ts" },
    ]);
  });

  it("reads every declaration shape it owns", () => {
    const text = [
      "type PlatformKind = string;",
      "class ConnectorStore {}",
      "enum ProviderMode { A }",
      'export namespace BillingProvider { export const id = "x"; }',
      'declare module "provider-sdk" {}',
      'export * as LedgerProvider from "./ledger.js";',
      'export * as "wire-provider" from "./wire.js";',
      "export import SpendPlatform = Sdk.Spend;",
      "export function listPlatforms(): void {}",
      "export const { providerId, nested: [platformName] } = source;",
      "export interface Bag { provider: string; nested: { connectors: number }; platformOf(): void }",
    ].join("\n");
    expect(names({ text })).toEqual([
      "type:PlatformKind",
      "class:ConnectorStore",
      "enum:ProviderMode",
      "namespace:BillingProvider",
      "variable:LedgerProvider",
      "variable:SpendPlatform",
      "function:listPlatforms",
      "variable:providerId",
      "variable:platformName",
      "field:provider",
      "field:connectors",
      "field:platformOf",
    ]);
  });

  it("reads a name exported through an export list, and an unrenamed re-export keeps its module's spelling", () => {
    const text = [
      "const BillingProvider = 1;",
      "export { BillingProvider };",
      "export { x as SpendPlatform };",
      'export { Provider } from "sdk";',
      'export { Provider as SdkProvider } from "sdk";',
      "const LedgerProvider = 2;",
      "export { LedgerProvider as ledgerIntegration };",
      'export { readFile as "FileProvider" } from "node:fs";',
    ].join("\n");
    // A quoted alias, like a quoted member, is the wire rule's spelling.
    // The last line exports a glossary-clean spelling; `LedgerProvider` stays a local, which is review's.
    expect(names({ text })).toEqual(["variable:BillingProvider", "variable:SpendPlatform", "variable:SdkProvider"]);
  });

  it("reads an accessor member of an interface or type literal as a field", () => {
    const text =
      "export interface Clean { get provider(): string; set platform(v: string) }\ntype T = { get connector(): string };";
    expect(names({ text })).toEqual(["field:provider", "field:platform", "field:connector"]);
  });

  it("reads an options bag's typed field, since that name is ours", () => {
    expect(names({ text: "export function f({ provider }: { provider: string }): void {}" })).toEqual([
      "field:provider",
    ]);
  });

  it("passes a quoted member name, the wire rule's spelling", () => {
    expect(names({ text: 'export interface SlackWireMessage { "provider": string; "platforms": string[] }' })).toEqual(
      [],
    );
  });

  it("passes what it does not own: locals, parameters, unexported functions, object-literal and schema keys", () => {
    const text = [
      "function providerOf(platform: string): string { const connector = platform; return connector; }",
      "const providerLocal = 1;",
      "export const schema = z.object({ provider: z.string() });",
      "export const row = { platform: process.platform };",
      "// a ProviderSpec in a comment",
      'export const label = "provider";',
    ].join("\n");
    expect(names({ text })).toEqual([]);
  });

  it("passes a React context provider component and fails one that renders no context", () => {
    const provider =
      "export function VoiceProvider({ children }: Props) { return <VoiceContext.Provider value={1}>{children}</VoiceContext.Provider>; }";
    const impostor = "export function VoiceProvider(): JSX.Element { return <div />; }";
    const nestedOnly =
      "export function DatabaseProvider() { function unused() { return <Ctx.Provider value={null} />; } return <div />; }";
    expect([
      names({ path: "site/a.tsx", text: provider }),
      names({ path: "site/b.tsx", text: impostor }),
      names({ path: "site/c.tsx", text: nestedOnly }),
    ]).toEqual([[], ["function:VoiceProvider"], ["function:DatabaseProvider"]]);
  });

  it("follows an unrenamed export list to a React context provider, and judges a renamed one", () => {
    const local = "function TooltipProvider() { return <Primitive.Provider />; }";
    expect([
      names({ path: "site/a.tsx", text: `${local}\nexport { TooltipProvider };` }),
      names({ path: "site/b.tsx", text: `${local}\nexport { TooltipProvider as HintProvider };` }),
    ]).toEqual([[], ["variable:HintProvider"]]);
  });

  it("names a generated file by a whole path segment", () => {
    expect(
      ["src/atlas/x/generated/methods.ts", "src/atlas/x/generatedMethods.ts", "src/generated.ts"].map((path) =>
        isGeneratedPath({ path }),
      ),
    ).toEqual([true, false, false]);
  });

  it("judges a declaration file's UMD global", () => {
    expect(names({ path: "src/umd.d.ts", text: "export = x;\nexport as namespace BillingProvider;" })).toEqual([
      "namespace:BillingProvider",
    ]);
  });

  it("reads an authored declaration file, skips a generated path and a test", () => {
    expect(
      ["src/new.d.ts", "site/css.d.ts", "src/atlas/x/generated/methods.ts", "src/__tests__/unit/a.test.ts"].map(
        (path) => isVocabularyScanned({ path }),
      ),
    ).toEqual([true, true, false, false]);
  });
});

const hit = (over: Partial<NamingVocabularyHit>): NamingVocabularyHit => ({
  kind: "field",
  line: 1,
  name: "provider",
  path: "src/a.ts",
  ...over,
});

describe("partitionVocabularyAgainstDebt", () => {
  const debt = [{ count: 2, name: "provider", path: "src/a.ts" }];

  it("covers hits up to the recorded count", () => {
    expect(partitionVocabularyAgainstDebt({ debt, hits: [hit({}), hit({ line: 2 })] })).toEqual({
      fresh: [],
      stale: [],
    });
  });

  it("returns only the excess hit when the count grew", () => {
    const third = hit({ line: 3 });
    expect(partitionVocabularyAgainstDebt({ debt, hits: [hit({}), hit({ line: 2 }), third] }).fresh).toEqual([third]);
  });

  it("reddens when a declaration leaves the tree but its row stays", () => {
    expect(partitionVocabularyAgainstDebt({ debt, hits: [hit({})] }).stale).toEqual([
      { actual: 1, name: "provider", path: "src/a.ts", recorded: 2 },
    ]);
    expect(partitionVocabularyAgainstDebt({ debt, hits: [] }).stale).toEqual([
      { actual: 0, name: "provider", path: "src/a.ts", recorded: 2 },
    ]);
  });

  it("reads a rename as a fresh new name and a stale old row", () => {
    const renamed = hit({ name: "providerId" });
    expect(
      partitionVocabularyAgainstDebt({ debt: [{ count: 1, name: "provider", path: "src/a.ts" }], hits: [renamed] }),
    ).toEqual({
      fresh: [renamed],
      stale: [{ actual: 0, name: "provider", path: "src/a.ts", recorded: 1 }],
    });
  });
});

describe("the register", () => {
  it("measures one counted row per identity, sorted", () => {
    const hits = [hit({ path: "src/b.ts" }), hit({ name: "platform" }), hit({}), hit({ line: 4 })];
    expect(namingVocabularyBaselineOf({ hits })).toEqual({
      identifiers: [
        { count: 1, name: "platform", path: "src/a.ts" },
        { count: 2, name: "provider", path: "src/a.ts" },
        { count: 1, name: "provider", path: "src/b.ts" },
      ],
    });
  });

  it("refuses a duplicate identity and a non-positive count", () => {
    const row = { count: 1, name: "provider", path: "src/a.ts" };
    const duplicated = parseNamingVocabularyBaseline({ text: JSON.stringify({ identifiers: [row, row] }) });
    const zero = parseNamingVocabularyBaseline({ text: JSON.stringify({ identifiers: [{ ...row, count: 0 }] }) });
    expect([unwrapErr(duplicated).code, unwrapErr(zero).code]).toEqual([
      "BASELINE_SHAPE_INVALID",
      "BASELINE_SHAPE_INVALID",
    ]);
  });
});

describe("judgeNamingVocabulary", () => {
  it("claims no stale row when a source could not be read", () => {
    const lines: string[] = [];
    const verdict = judgeNamingVocabulary({
      baselineText: ok(JSON.stringify({ identifiers: [{ count: 1, name: "provider", path: "src/gone.ts" }] })),
      listing: ["src/gone.ts", "src/fine.ts"],
      readText: ({ path }) => {
        if (path === "src/gone.ts") {
          throw new Error("EACCES");
        }
        return "export const x = 1;";
      },
      write: (text) => lines.push(text),
    });
    expect({ measured: verdict.measured, stale: verdict.stale, unseen: verdict.unseen }).toEqual({
      measured: undefined,
      stale: [],
      unseen: 1,
    });
  });
});

/** A synthetic tree the whole gate judges: one noun, one skill, a clean sidebar, and the given sources. */
function tree({ files, baseline }: { files: Readonly<Record<string, string>>; baseline: string | undefined }): {
  inputs: Omit<NamingDoctrineInputs, "rebaseline">;
  err: string[];
  written: string[];
} {
  const sidebar =
    'export const SIDEBAR_ENTRIES = [\n  { href: "/queue", key: "queue", label: "Queue" },\n] as const;\n';
  const all: Record<string, string> = { "site/lib/sidebarCounts.ts": sidebar, "skills/queue/SKILL.md": "", ...files };
  const errLines: string[] = [];
  const written: string[] = [];
  return {
    err: errLines,
    inputs: {
      listing: Object.keys(all),
      nouns: [{ name: "handover", path: "src/cli/manifests/index.ts", surface: "noun" }],
      out: () => undefined,
      readText: ({ path }) => {
        if (path === NAMING_VOCABULARY_BASELINE && baseline !== undefined) {
          return baseline;
        }
        const text = all[path];
        if (text === undefined) {
          throw new Error(`ENOENT ${path}`);
        }
        return text;
      },
      write: (text) => errLines.push(text),
      writeBaseline: ({ text }) => written.push(text),
    },
    written,
  };
}

describe("judgeNamingDoctrine, the whole gate", () => {
  const empty = JSON.stringify({ identifiers: [] });

  it("refuses a new …Provider… type in an untracked source", () => {
    const run = tree({ baseline: empty, files: { "src/new.ts": "export interface NewProvider {}" } });
    expect(judgeNamingDoctrine({ inputs: { ...run.inputs, rebaseline: false } })).toBe(1);
    expect(run.err.join("")).toContain("the `naming-doctrine` gate found a type, interface, class, enum");
    expect(run.err.join("")).toContain("src/new.ts:1: interface `NewProvider` carries a retired word");
  });

  it("refuses a concept named two ways, with no register that could hold it", () => {
    const run = tree({ baseline: empty, files: { "skills/handovers/SKILL.md": "" } });
    expect(judgeNamingDoctrine({ inputs: { ...run.inputs, rebaseline: false } })).toBe(1);
    expect(run.err.join("")).toContain("1 concept(s) named two ways");
    expect(run.err.join("")).toContain("identity: command-surface noun:handover skill:handovers");
  });

  it("is clean when the register records it", () => {
    const recorded = JSON.stringify({ identifiers: [{ count: 1, name: "NewProvider", path: "src/new.ts" }] });
    const run = tree({ baseline: recorded, files: { "src/new.ts": "export interface NewProvider {}" } });
    expect(judgeNamingDoctrine({ inputs: { ...run.inputs, rebaseline: false } })).toBe(0);
  });

  it("refuses a row the tree no longer fires", () => {
    const recorded = JSON.stringify({ identifiers: [{ count: 1, name: "NewProvider", path: "src/new.ts" }] });
    const run = tree({ baseline: recorded, files: { "src/new.ts": "export interface NewIntegration {}" } });
    expect(judgeNamingDoctrine({ inputs: { ...run.inputs, rebaseline: false } })).toBe(1);
    expect(run.err.join("")).toContain("`NewProvider` recorded 1 time(s)");
  });

  it("is incomplete, never clean, when the register is missing", () => {
    const run = tree({ baseline: undefined, files: { "src/ok.ts": "export const x = 1;" } });
    expect(judgeNamingDoctrine({ inputs: { ...run.inputs, rebaseline: false } })).toBe(1);
    expect(run.err.join("")).toContain(
      DevLintInputErrors.baselineUnreadable({ kind: "debt list", path: NAMING_VOCABULARY_BASELINE }).message,
    );
  });

  it("writes the exact register under --rebaseline", () => {
    const run = tree({ baseline: undefined, files: { "src/new.ts": "export interface NewProvider {}" } });
    expect(judgeNamingDoctrine({ inputs: { ...run.inputs, rebaseline: true } })).toBe(0);
    expect(run.written).toEqual([
      `${JSON.stringify({ identifiers: [{ count: 1, name: "NewProvider", path: "src/new.ts" }] }, null, 2)}\n`,
    ]);
  });

  it("writes nothing under --rebaseline over an unreadable source", () => {
    const run = tree({ baseline: undefined, files: {} });
    const inputs = { ...run.inputs, listing: [...run.inputs.listing, "src/unreadable.ts"], rebaseline: true };
    expect(judgeNamingDoctrine({ inputs })).toBe(1);
    expect(run.written).toEqual([]);
  });
});
