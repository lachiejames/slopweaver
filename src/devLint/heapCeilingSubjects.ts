/**
 * The SUBJECTS of the `heap-ceiling-ratchet` gate: every memory number this repository spends, read out of
 * the files that hold one. Pure — each reader takes a file's text and returns its ceilings.
 *
 * Three kinds of place, and each is a separate reader because each spells its number a different way:
 *
 *  - every manifest that pins TypeScript (`TYPESCRIPT_PIN_MANIFESTS`) — each script whose command carries
 *    `--max-old-space-size` (today the root `build` and `typecheck`, both 10,240 MiB), read with the same
 *    tokenizer `tsc-heap-contract` judges them by, so the two gates cannot disagree about which word of a
 *    command is the ceiling. Key `package-script.<name>`, a V8 heap ceiling. A script running under
 *    `scripts/tsc-owner.sh` instead carries a PROCESS-TREE RSS ceiling, its `--rss-ceiling-mib`, keyed
 *    `package-script.<name>.process-tree-rss` — a different metric, so a different key, and the ratchet lets
 *    one replace the other only downwards (`predecessorCeiling`). A manifest outside the root prefixes its
 *    directory: `desktop.package-script.build`.
 *  - `src/devLint/gateGroups.ts` — every lint gate spawned with the flag on its own argv (today
 *    `named-object-params`, 8,192 MiB), read off the TypeScript AST. Key `lint-gate.<name>`.
 *  - `src/devLint/namedObjectParamsHeap.ts` — `HEAP_BUDGET_MIB`, the live-heap budget the
 *    `named-object-params` gate holds itself to (6,543 MiB). Key `named-object-params.budget`.
 *
 * Every reader FAILS CLOSED. A ceiling spelled somewhere a reader cannot follow — a gate whose `args` is
 * not one array of plain string literals (a concatenation, a template, a hoisted constant, a shorthand, an
 * object spread), a flag literal outside any gate, a budget that is not one numeric literal — is `unread`,
 * never skipped: a gate that pins the numbers it can see and passes the one it cannot is a gate whose
 * evasion is "spell it differently". A ceiling the readers cannot SEE is indistinguishable from one deleted,
 * so the readers, not the judgement, are where a hidden one has to be caught; a ceiling deleted from a
 * script or gate that still runs is the judgement's, through `uncapped`.
 *
 * Blind spots, stated: a gate registered outside `gateGroups.ts`; a package script that assembles the flag
 * through shell expansion (`$VAR`), which the compiler scripts cannot do because `tsc-heap-contract`
 * demands one readable argument; and `bin/slopweaver`'s AMBIENT `NODE_OPTIONS` ceiling, sized from the
 * host's RAM and clamped at 12,288 MiB — a shell computation `ambient-heap-ceiling` owns. And memory no
 * V8 flag bounds at all: `slopweaver dev build`'s one esbuild process is a Go binary, so it spends no number
 * this gate could pin (`docs/toolchain/build.md` carries its measured peak). Its bounds are TypeScript constants
 * (`src/cli/commands/dev/buildOwner.ts`'s RSS ceiling, `src/lib/esbuildBounds.ts`'s Go soft limit, which the
 * `runtime-dependencies` gate's `env` also carries), and a ceiling held in a constant is outside every reader
 * here by construction: raising one passes this gate, and only their own unit tests pin them.
 *
 * **Where the chase stopped, and what closes the rest.** Five Codex review passes each built a new spelling
 * (a concatenated flag, `NODE_OPTIONS` beside a direct flag, a backslash-newline, a dropped flag, a name
 * declared twice, a computed key); each is a test above. The reader stays SYNTAX-ONLY, so two shapes are
 * left by construction. A gate entry this reader does not recognise as gate-shaped at all (built by a
 * function call, say) that carries NO flag reads as deleted rather than uncapped, so dropping a base gate's
 * flag by also moving it into that shape passes; a flag in such an entry is still refused, as a mention
 * outside any gate. And anything that changes a RECOGNISED gate's argv after its literal is written — a
 * `splice` on its `args`, a reassignment, a wrapper that rebuilds the entry — leaves the literal this reader
 * pins unchanged while the spawned process runs without it. Neither is written by
 * accident. Closing both means reading the gate registry at RUN time — importing `gateGroups.ts` and
 * reading each spawned argv — instead of parsing its text.
 */
import { posix } from "node:path";

import { forEachChild, isStringLiteralLikeNode, type NodeVisitor, ts, withSourceFile } from "#lib/tsSyntax.js";

import { type GateArgs, gatesIn } from "./heapCeilingGateEntries.js";
import { heapArgument, readSimpleCommand } from "./tscHeapContract.js";
import { readScripts } from "./tscHeapContractRun.js";
import { mentionsHeapFlag, mentionsOwner, readCompilerOwner } from "./tscOwnerContract.js";
import { TYPESCRIPT_PIN_MANIFESTS } from "./typescriptPin.js";

/** The repo-relative source files, other than the manifests, this gate reads its subjects from. */
export const CEILING_SOURCE_PATHS = {
  gateGroups: "src/devLint/gateGroups.ts",
  heapBudget: "src/devLint/namedObjectParamsHeap.ts",
} as const;

/** The manifests this gate reads script ceilings from: every one that pins TypeScript. */
export const CEILING_MANIFESTS: readonly string[] = TYPESCRIPT_PIN_MANIFESTS;

/** The suffix on a key whose ceiling is a process tree's resident memory rather than a V8 heap. */
export const RSS_KEY_SUFFIX = ".process-tree-rss";

/** The key `HEAP_BUDGET_MIB` is pinned under. */
const BUDGET_KEY = "named-object-params.budget";

/**
 * The ceilings one source holds, keyed, plus the keys of the subjects it holds with NO ceiling (a script or
 * gate that names no flag runs at V8's own default) — or the one line saying why this gate could not read
 * them. `uncapped` is what lets the judgement tell a ceiling DROPPED from a still-running process, which
 * is a rise to that default, from one whose script or gate is gone.
 */
export type CeilingReading =
  | {
      readonly kind: "read";
      readonly ceilings: ReadonlyMap<string, number>;
      readonly uncapped: ReadonlySet<string>;
    }
  | { readonly kind: "unread"; readonly why: string };

/** One heap value read off a token list, or why there is none to read. */
type HeapValue = { readonly kind: "mib"; readonly mib: number } | { readonly kind: "wrong"; readonly why: string };

/**
 * Read the one heap value a token list carries, through `tsc-heap-contract`'s own reader. A second word
 * naming the flag is refused before that reader runs, whatever it is: `NODE_OPTIONS=--max-old-space-size=N`
 * beside a direct flag leaves the process itself at the direct number while every child it spawns inherits
 * N, so reading only the direct one would pass a raise no process here reports.
 *
 * @param tokens the command's words
 * @returns the ceiling in MiB, or why the tokens carry no single readable one
 */
function heapValueOf({ tokens }: { tokens: readonly string[] }): HeapValue {
  if (tokens.filter((token) => mentionsHeapFlag({ text: token })).length > 1) {
    return {
      kind: "wrong",
      why: "it names the heap flag in more than one word, so a child it spawns can inherit a ceiling other than the one its own argv sets",
    };
  }
  const heap = heapArgument({ tokens });
  if (heap.kind === "wrong") {
    return heap;
  }
  // heapArgument answered `at`, so the index is inside the list by its own construction.
  const token = tokens[heap.lastIndex]!;
  const equals = token.indexOf("=");
  return { kind: "mib", mib: Number(equals === -1 ? token : token.slice(equals + 1)) };
}

/**
 * The key prefix of one manifest's scripts: none for the root, the manifest's directory otherwise.
 *
 * @param manifest the manifest, repo-relative
 * @returns `package-script.` for `package.json`, `desktop.package-script.` for `desktop/package.json`
 */
function scriptKeyPrefix({ manifest }: { manifest: string }): string {
  const directory = posix.dirname(manifest);
  return directory === "." ? "package-script." : `${directory.replaceAll("/", ".")}.package-script.`;
}

/**
 * Whether a key names a package script of a manifest this gate reads, the only subject an RSS ceiling can
 * belong to — so a lint gate or the budget can never take the heap-to-RSS move.
 *
 * @param key a ceiling's key
 * @returns true when the key starts with one {@link CEILING_MANIFESTS} entry's script prefix
 */
export function isPackageScriptKey({ key }: { key: string }): boolean {
  return CEILING_MANIFESTS.some((manifest) => key.startsWith(scriptKeyPrefix({ manifest })));
}

/** One script's ceiling, keyed with its metric, or that it carries none, or why it cannot be read. */
type ScriptCeiling =
  | { readonly kind: "ceiling"; readonly key: string; readonly mib: number }
  | { readonly kind: "none" }
  | { readonly kind: "wrong"; readonly why: string };

/**
 * Read one script's ceiling. The owner is checked FIRST: an owner command that also names a V8 flag is
 * refused by the owner reader, rather than read as a V8 ceiling on a process V8 does not run.
 *
 * @param manifest the manifest, repo-relative
 * @param base the script's key without a metric suffix
 * @param command the script's command text
 * @returns the ceiling, none, or why the command cannot be read
 */
function scriptCeiling({
  manifest,
  base,
  command,
}: {
  manifest: string;
  base: string;
  command: string;
}): ScriptCeiling {
  if (mentionsOwner({ command })) {
    const owner = readCompilerOwner({ command, manifest });
    if (owner.isErr()) {
      return { kind: "wrong", why: `it runs the TypeScript compiler and ${owner.error.message}` };
    }
    return { key: `${base}${RSS_KEY_SUFFIX}`, kind: "ceiling", mib: owner.value.rssCeilingMiB };
  }
  if (!mentionsHeapFlag({ text: command })) {
    return { kind: "none" };
  }
  const words = readSimpleCommand({ command });
  if (words.kind === "unreadable") {
    return { kind: "wrong", why: words.why };
  }
  const value = heapValueOf({ tokens: words.tokens });
  if (value.kind === "wrong") {
    return value;
  }
  return { key: base, kind: "ceiling", mib: value.mib };
}

/**
 * Every ceiling one manifest's scripts carry: a V8 heap flag keyed `<prefix>package-script.<name>`, or the
 * owner's process-tree RSS ceiling keyed with {@link RSS_KEY_SUFFIX}. A script carrying neither is uncapped
 * under BOTH keys, so dropping either kind from a script that still runs is caught. A script on a V8 flag is
 * also uncapped under its RSS key, so moving one back off the owner drops that bound visibly; the reverse
 * move, onto the owner, is the sanctioned one and leaves the V8 key out.
 *
 * @param manifest the manifest, repo-relative
 * @param text the file's whole contents
 * @returns one ceiling per script that names one, or why the file cannot be judged
 */
export function packageScriptCeilings({ manifest, text }: { manifest: string; text: string }): CeilingReading {
  const reading = readScripts({ path: manifest, text });
  if (reading.isErr()) {
    return { kind: "unread", why: reading.error.message };
  }
  const ceilings = new Map<string, number>();
  const uncapped = new Set<string>();
  const prefix = scriptKeyPrefix({ manifest });
  for (const [script, command] of Object.entries(reading.value)) {
    if (script.endsWith(RSS_KEY_SUFFIX)) {
      // Its V8 key would BE another script's RSS key, so one could inherit the other's pin.
      return {
        kind: "unread",
        why: `${manifest} script \`${script}\` ends in \`${RSS_KEY_SUFFIX}\`, the suffix this gate reserves for an RSS ceiling's key — rename the script`,
      };
    }
    const base = `${prefix}${script}`;
    const found = scriptCeiling({ base, command, manifest });
    if (found.kind === "wrong") {
      return { kind: "unread", why: `${manifest} script \`${script}\`: ${found.why}` };
    }
    if (found.kind === "none") {
      uncapped.add(base);
      uncapped.add(`${base}${RSS_KEY_SUFFIX}`);
      continue;
    }
    ceilings.set(found.key, found.mib);
    if (found.key === base) {
      // One-way: a script back on a V8 flag no longer carries its RSS bound, so dropping that is caught.
      uncapped.add(`${base}${RSS_KEY_SUFFIX}`);
    }
  }
  return { ceilings, kind: "read", uncapped };
}

/**
 * Every text-bearing node in a file that names the heap flag — string literals and every template part.
 *
 * @param source the parsed file
 * @returns the nodes, in source order
 */
function flagMentions({ source }: { source: ts.SourceFile }): readonly ts.Node[] {
  const found: ts.Node[] = [];
  const visit: NodeVisitor = (node) => {
    const textBearing = isStringLiteralLikeNode(node) || ts.isTemplateLiteralToken(node);
    if (textBearing && mentionsHeapFlag({ text: node.text })) {
      found.push(node);
    }
    forEachChild({ node, visit });
  };
  visit(source);
  return found;
}

/** What one gate entry's `args` say about its ceiling. */
type GateCeiling =
  | { readonly kind: "none" }
  | { readonly kind: "ceiling"; readonly mib: number; readonly carries: readonly ts.Node[] }
  | { readonly kind: "wrong"; readonly why: string };

/**
 * Read one gate's ceiling. A gate whose argv is not one array of plain string literals is `wrong` whether
 * or not a flag is visible in it: MEASURED on this gate, `"--max-old-" + "space-size=12288"`
 * names the flag in no single literal, so a reader that only judged arrays it could SEE a flag in let that
 * ceiling, and the deletion of its pin, through clean.
 *
 * @param gate the entry
 * @param mentions every flag-naming node in the file
 * @returns the ceiling and the nodes that spell it, none, or why the argv cannot be read
 */
function gateCeiling({ gate, mentions }: { gate: GateArgs; mentions: readonly ts.Node[] }): GateCeiling {
  if (gate.words === undefined) {
    return {
      kind: "wrong",
      why: "its entry is not plain identifier keys with `args` one array of plain string literals, so the name or argv reaching the child cannot be read",
    };
  }
  const carries = gate.elements.filter((element) => mentions.includes(element));
  if (carries.length === 0) {
    return { kind: "none" };
  }
  const value = heapValueOf({ tokens: gate.words });
  if (value.kind === "wrong") {
    return value;
  }
  return { carries, kind: "ceiling", mib: value.mib };
}

/**
 * Every lint gate `gateGroups.ts` spawns with a heap ceiling on its own argv, keyed `lint-gate.<name>`.
 *
 * A gate is an object literal carrying a string `name` and an `args` array. Every flag mention in the file
 * must sit inside one such array of plain string literals; one that does not — a template, a computed word,
 * a constant hoisted out of the literal — makes the whole file `unread`.
 *
 * @param text the file's whole contents
 * @returns one ceiling per gate that carries one, or why the file cannot be judged
 */
export function lintGateCeilings({ text }: { text: string }): CeilingReading {
  return withSourceFile({
    fileName: CEILING_SOURCE_PATHS.gateGroups,
    text,
    use: (source): CeilingReading => {
      const mentions = flagMentions({ source });
      const accounted = new Set<ts.Node>();
      const ceilings = new Map<string, number>();
      const uncapped = new Set<string>();
      for (const gate of gatesIn({ source })) {
        const found = gateCeiling({ gate, mentions });
        if (found.kind === "wrong") {
          return { kind: "unread", why: `${CEILING_SOURCE_PATHS.gateGroups} gate \`${gate.name}\`: ${found.why}` };
        }
        const key = `lint-gate.${gate.name}`;
        // ANY second entry of a name is refused, capped or not: one capped and one uncapped would collapse to
        // a key in both sets, and the capped one would hide the flag dropped from the other.
        if (ceilings.has(key) || uncapped.has(key)) {
          const why = `${CEILING_SOURCE_PATHS.gateGroups} gate \`${gate.name}\` is declared twice`;
          return { kind: "unread", why };
        }
        if (found.kind === "none") {
          uncapped.add(key);
          continue;
        }
        ceilings.set(key, found.mib);
        found.carries.forEach((element) => accounted.add(element));
      }
      const first = mentions.find((node) => !accounted.has(node));
      if (first !== undefined) {
        const { line } = source.getLineAndCharacterOfPosition(first.getStart(source));
        return {
          kind: "unread",
          why: `${CEILING_SOURCE_PATHS.gateGroups}:${String(line + 1)} names the heap flag outside a gate's plain-literal \`args\`, so this gate cannot read the ceiling it sets`,
        };
      }
      return { ceilings, kind: "read", uncapped };
    },
  });
}

/**
 * `HEAP_BUDGET_MIB`, which must be declared exactly once and initialised with one numeric literal.
 *
 * @param text `namedObjectParamsHeap.ts`'s whole contents
 * @returns the budget under {@link BUDGET_KEY}, or why it cannot be read
 */
export function heapBudgetCeiling({ text }: { text: string }): CeilingReading {
  return withSourceFile({
    fileName: CEILING_SOURCE_PATHS.heapBudget,
    text,
    use: (source): CeilingReading => {
      const initializers: (ts.Expression | undefined)[] = [];
      const visit: NodeVisitor = (node) => {
        if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === "HEAP_BUDGET_MIB") {
          initializers.push(node.initializer);
        }
        forEachChild({ node, visit });
      };
      visit(source);
      const [only] = initializers;
      if (initializers.length !== 1 || only === undefined || !ts.isNumericLiteral(only)) {
        return {
          kind: "unread",
          why: `${CEILING_SOURCE_PATHS.heapBudget} must declare \`HEAP_BUDGET_MIB\` exactly once, as one numeric literal`,
        };
      }
      return {
        ceilings: new Map([[BUDGET_KEY, Number(only.text.replaceAll("_", ""))]]),
        kind: "read",
        uncapped: new Set<string>(),
      };
    },
  });
}

/** Every source's whole contents: the two named files, and each manifest keyed by its path. */
export interface CeilingSourceTexts {
  readonly gateGroups: string;
  readonly heapBudget: string;
  readonly manifests: ReadonlyMap<string, string>;
}

/**
 * Every ceiling the sources hold, merged, or the first reason one of them could not be read. Every manifest
 * in {@link CEILING_MANIFESTS} must be present: one missing is a subject this gate never saw.
 *
 * @param texts each source's whole contents
 * @returns the merged ceilings, or why the tree cannot be judged
 */
export function treeCeilings({ texts }: { texts: CeilingSourceTexts }): CeilingReading {
  const missing = CEILING_MANIFESTS.find((manifest) => !texts.manifests.has(manifest));
  if (missing !== undefined) {
    return { kind: "unread", why: `${missing} was not read, so its scripts' ceilings were never seen` };
  }
  const readings = [
    ...CEILING_MANIFESTS.map((manifest) => packageScriptCeilings({ manifest, text: texts.manifests.get(manifest)! })),
    lintGateCeilings({ text: texts.gateGroups }),
    heapBudgetCeiling({ text: texts.heapBudget }),
  ];
  const merged = new Map<string, number>();
  const uncapped = new Set<string>();
  for (const reading of readings) {
    if (reading.kind === "unread") {
      return reading;
    }
    reading.ceilings.forEach((mib, key) => merged.set(key, mib));
    reading.uncapped.forEach((key) => uncapped.add(key));
  }
  return { ceilings: merged, kind: "read", uncapped };
}
