/**
 * The gate that makes the escape-hatch structure structural.
 *
 * The blocks and the escape hatches are formalised so that it is structurally impossible to deviate from
 * them. Three ways to deviate exist, and this gate closes all three.
 *
 * ## The three criteria
 *
 * **1 · An undeclared hatch.** A `SLOPWEAVER_ALLOW_<SUFFIX>` mention, or any quoted name or property key
 * shaped like an override (an `ALLOW` or `OVERRIDE` component, `./overrideVariable.ts`), anywhere in `src/`,
 * `desktop/` (its `__tests__` excluded), `hooks/` or `eval/`, that no row in `src/hatch/registry.ts` carries as its env key. The
 * family alone once let `ALLOW_FABLE_OVERRIDE` and the responder break-glass sit outside the register. A hatch nobody declared is a hatch the
 * artifact the owner reacts to cannot list, and the register is what that artifact is generated from. A name no single
 * token spells — concatenated, templated, or built at runtime — is the blind spot (`./overrideNameReads.ts`).
 *
 * **2 · An undeclared door token.** A `*_OVERRIDE = "<token>"` constant whose token carries no row. Every
 * door `warn` is waivable by contract, so every one of them has to be a row an agent can read the
 * exceptions off.
 *
 * **3 · A refusal rendered by hand.** A `decision.findings` mapped, spread or iterated, or the bare
 * `decision.status` verdict read into text (`./bareDoorVerdict.ts`), outside {@link RENDER_OWNERS}. This is the one that was actually broken: 29 sites rendered door
 * findings to a caller and ZERO printed the override token the finding was carrying. Routing every one
 * through `src/admit/doorRefusal.ts` is what makes ruling 1 — print the token, always — impossible to
 * forget rather than easy to forget.
 *
 * ## Two owners, and why they are owners rather than an allowlist
 *
 * `src/admit/doorRefusal.ts` IS the renderer, and `src/admit/ledger.ts` writes a JOURNAL ROW rather than a
 * message to a caller — a record whose fields are read back by a later query, never text a reader has to
 * act on. Nothing else in the tree has either property. This mirrors `epochArithmetic.ts`'s
 * `CONVERSION_OWNERS`: not a list of blessed sites, a statement of what the routing destination is.
 *
 * Deliberately text-and-line based rather than checker-backed: every criterion here is about a LITERAL a
 * gate author writes, so a resolved type would buy nothing and cost the whole-repo `ts.Program` that
 * `namedObjectParams.ts` had to be measured for. Three things are read off a per-file parse instead, because
 * a line of text kept losing to shapes Prettier leaves alone: the bare verdict, every comment (blanked by the
 * compiler's own ranges, `./blankComments.ts`), and every override NAME outside the `SLOPWEAVER_ALLOW_` family
 * (`./overrideNameReads.ts`), which a wrapped `process.env\n  .NAME` once hid from a line regex.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ESCAPE_HATCHES } from "../hatch/registry.js";
import type { EscapeHatch, HatchKey } from "../hatch/types.js";
import { workingTreeFilesOf } from "../lib/gitRepo.js";
import { reportScanIntegrity, scanTextFiles } from "../lib/textFileScan.js";
import { bareVerdictLines } from "./bareDoorVerdict.js";
import { blankComments } from "./blankComments.js";
import { REGISTER_PATH, undeclaredDoorTokens, undeclaredEnvHatches } from "./escapeHatchUndeclared.js";
import { JOURNALLED_IDS } from "./journalledIds.js";
import { overrideNameSpansByLine, type ShapedName } from "./overrideNameReads.js";
import { type LintGateRefusalId, lintDeclarationFor } from "./refusal/registry.js";
import { gateOutcome, lintGateRefusal } from "./refusal/render.js";
import { scanLintRefusalWrites } from "./refusal/scan.js";
import {
  gateSelfPaths,
  repoRoot,
  type ScanScope,
  scopedScanFiles,
  isScannablePath as scopeIsScannablePath,
} from "./scanScope.js";

/**
 * One violation: where it is and what is wrong.
 *
 * @internal — the scanner's own return shape; nothing outside this gate names it.
 */
export interface EscapeHatchHit {
  readonly path: string;
  readonly line: number;
  readonly message: string;
  /**
   * Which of this gate's criteria produced the hit. One gate, several genuinely different rules — an
   * undeclared hatch is not a hand-rendered door refusal is not a lane that disagrees with the ruling — and
   * each renders under the declaration that actually describes it. They shared one row until an adversarial
   * pass pointed out that a lint-shape hit was being answered with the door renderer's correction.
   */
  readonly criterion: EscapeHatchCriterion;
}

/**
 * The gate's criteria, each with its own row in the lint-gate register.
 *
 * @internal — the gate's own vocabulary; nothing outside this gate names it.
 */
export type EscapeHatchCriterion = "undeclared" | "door" | "reader" | "lane" | "lint-shape";

/**
 * Where a door refusal may legitimately be built from findings — see this file's header for why this one.
 *
 * @internal — the gate's own criterion; nothing outside this gate names it.
 */
export const RENDER_OWNERS: ReadonlySet<string> = new Set(["src/admit/doorRefusal.ts"]);

/**
 * A findings list turned into a RECORD rather than a message — `.map((f) => ({ … }))`. The ledger's journal
 * row and `slack post --json`'s `refusal` document are both this, and neither is text a reader acts on, so
 * the criterion excludes the shape rather than listing the two files. That is the sharpening the
 * false-positive doctrine asks for: a record has an object-literal arrow body, a refusal never does.
 */
const MAPPED_TO_RECORD = /=>\s*\(\{/;

/** A findings list rendered by hand: mapped or spread into text. */
const HAND_RENDER = [/decision\.findings\s*\.\s*(?:map|flatMap|forEach)\b/, /\.\.\.\s*[\w.]*decision\.findings\b/];

/**
 * The head of a `for (const … of …)`. Deliberately NOT one regex spanning the binding to the iterable: the
 * `[^;]*` that would need is polynomial backtracking, which `redos-check` refuses. Paired with a plain
 * substring test for the iterable instead, which is both cheaper and exact.
 */
const FOR_OF_HEAD = /for\s*\(\s*const\b/;

/**
 * Every line terminator the TypeScript scanner counts — CRLF first so it is one break rather than two, then a
 * lone CR, U+2028 and U+2029, built from code points so the source carries no invisible separator.
 */
const LINE_BREAKS = new RegExp(`\\r\\n|[\\r${String.fromCodePoint(0x2028, 0x2029)}]`, "g");

/**
 * Whether a line turns a door decision's findings into TEXT rather than into a record.
 *
 * @param line the source line
 * @returns true when the line maps, spreads or iterates `decision.findings` outside a record literal
 */
function rendersFindingsByHand({ line }: { line: string }): boolean {
  const iterated = FOR_OF_HEAD.test(line) && line.includes("decision.findings");
  const matchesShape = iterated || HAND_RENDER.some((pattern) => pattern.test(line));
  return matchesShape && !MAPPED_TO_RECORD.test(line);
}

/**
 * The one hit a hand-rendered door refusal earns.
 *
 * @param at the 1-indexed line number
 * @param path the repo-relative path
 * @returns the door criterion hit for that line
 */
function handRendered({ at, path }: { at: number; path: string }): EscapeHatchHit {
  const message = `door refusal rendered by hand — call doorRefusalLines({ command, decision }) from src/admit/doorRefusal.ts instead, so the refusal carries its override token`;
  return { criterion: "door", line: at, message, path };
}

/**
 * Every violation on one line of code.
 *
 * @param line the source line, comments already blanked
 * @param shaped the override names the syntax tree found starting on this line
 * @param at the 1-indexed line number
 * @param path the repo-relative path, which decides which criteria apply
 * @returns the hits on that line
 */
function scanLine({
  line,
  shaped,
  at,
  path,
}: {
  line: string;
  shaped: readonly ShapedName[];
  at: number;
  path: string;
}): readonly EscapeHatchHit[] {
  const declarations = [
    ...undeclaredEnvHatches({ at, line, path, shaped }),
    ...undeclaredDoorTokens({ at, line, path }),
  ];
  if (RENDER_OWNERS.has(path) || !rendersFindingsByHand({ line })) {
    return declarations;
  }
  return [...declarations, handRendered({ at, path })];
}

/**
 * Every violation in one file's text. The bare verdict is read off the AST (`./bareDoorVerdict.ts`) and
 * joins the line it sits on, once, beside whatever that line already earned.
 *
 * @param content the file's source
 * @param path the repo-relative path, which decides which criteria apply
 * @returns the hits, in line order
 */
export function scanEscapeHatch({ content: raw, path }: { content: string; path: string }): readonly EscapeHatchHit[] {
  // Every line break the compiler counts (CRLF, a lone CR, U+2028, U+2029) becomes `\n` first, so the syntax
  // tree's line numbers and this scan's `split("\n")` index the same lines.
  const content = raw.replace(LINE_BREAKS, "\n");
  const verdicts = new Set(RENDER_OWNERS.has(path) ? [] : bareVerdictLines({ content, path }));
  // Override names come off the syntax tree and comments are blanked by the compiler's own ranges, never
  // guessed from a line's text: `/* … */ code`, a generator's `*values()` and a wrapped `process.env\n.X`
  // each got past a line guess once (`./overrideNameReads.ts`, `./blankComments.ts`).
  const shapedByLine = overrideNameSpansByLine({ content, path });
  return blankComments({ content, path })
    .split("\n")
    .flatMap((code, index) => {
      const hits =
        code.trim() === ""
          ? []
          : scanLine({ at: index + 1, line: code, path, shaped: shapedOn({ at: index + 1, byLine: shapedByLine }) });
      const earned = verdicts.has(index + 1) && !hits.some((hit) => hit.criterion === "door");
      return earned ? [...hits, handRendered({ at: index + 1, path })] : hits;
    });
}

/**
 * The override names one line spells. A line absent from the map spells none BY DESIGN — the map holds only
 * lines that carry a name — so absence answers an empty list here rather than a fallback.
 *
 * @param at the 1-indexed line
 * @param byLine `overrideNameSpansByLine`'s map for the file
 * @returns that line's names with their spans, empty when it spells none
 */
function shapedOn({
  at,
  byLine,
}: {
  at: number;
  byLine: ReadonlyMap<number, readonly ShapedName[]>;
}): readonly ShapedName[] {
  const shaped = byLine.get(at);
  if (shaped === undefined) {
    return [];
  }
  return shaped;
}

/**
 * The literal a row's reader module must actually contain, per key family.
 *
 * A `command` row is checked on its FLAG alone — `--acknowledge`, `--scrub` — because the verb path is
 * assembled by the CLI runner rather than written in the module that implements the escape, and the
 * placeholder after it (`<path>`, `<subject,...>`) is what the operator types. Checking the whole
 * incantation would fail every honest row; checking the flag is the part the reader really does carry.
 * A row with no flag at all falls back to the incantation up to its first placeholder. A `grant` row is read
 * by its id — `hatchOpen({ id: "wall" })` — so the reader must carry that id as a quoted literal. An `env`
 * row may carry either its variable or its quoted id, because `hatchOpen` derives the variable from the id
 * and a reader asking through it never spells the variable at all.
 *
 * @param key the row's key
 * @param id the row's register id, which is what a `grant` row's reader names
 * @returns the substrings the reader may carry, any one of which satisfies the claim
 */
function readerKeysOf({ key, id }: { key: HatchKey; id: string }): readonly string[] {
  if (key.kind === "env") {
    return [key.variable, `"${id}"`];
  }
  if (key.kind === "door-token") {
    return [key.token];
  }
  if (key.kind === "grant") {
    return [`"${id}"`];
  }
  const flag = /--[a-z][a-z-]*/.exec(key.incantation);
  return [flag === null ? key.incantation.split("<")[0]!.trimEnd() : flag[0]];
}

/**
 * Every register row whose declared reader does not actually name its own key.
 *
 * A `reader` that has drifted is the register lying about where a hatch lives, which is the exact failure
 * `secrets/registry.ts` was built to stop for credentials.
 *
 * @param readFile reads a repo-relative path, returning `undefined` when it is not there
 * @returns one hit per row whose reader does not name its key, in register order
 */
export function scanReaderClaims({
  readFile,
}: {
  readFile: (args: { path: string }) => string | undefined;
}): readonly EscapeHatchHit[] {
  return ESCAPE_HATCHES.flatMap((hatch) => {
    const source = readFile({ path: hatch.reader });
    const keys = readerKeysOf({ id: hatch.id, key: hatch.key });
    if (source === undefined) {
      return [
        {
          line: 1,
          criterion: "reader" as const,
          message: `hatch "${hatch.id}" names reader ${hatch.reader}, which is not there`,
          path: REGISTER_PATH,
        },
      ];
    }
    if (keys.some((key) => source.includes(key))) {
      return [];
    }
    return [
      {
        line: 1,
        criterion: "reader" as const,
        message: `hatch "${hatch.id}" names reader ${hatch.reader}, which does not mention ${keys.join(" or ")}`,
        path: REGISTER_PATH,
      },
    ];
  });
}

/**
 * Every row whose lane disagrees with {@link JOURNALLED_IDS}.
 *
 * Both directions fail. An outbound row left ambient is the rule unimplemented; a non-outbound row moved
 * into the journalled lane widens a mechanism scoped deliberately, and would be the quiet kind of
 * over-delivery a register exists to make visible.
 *
 * The KEY must agree with the lane too, in both directions. A journalled row keyed on an env variable is an
 * outbound rule an exported variable would waive for the rest of the shell, with no line left to read — the
 * exact shape that ruling ended. A `grant` key on an ambient row names a grant `hatch open` refuses to issue.
 *
 * @returns one hit per row on the wrong side, in register order
 */
export function scanLaneClaims(): readonly EscapeHatchHit[] {
  return ESCAPE_HATCHES.flatMap((hatch) => {
    const message = laneMismatchOf({ hatch });
    return message === undefined ? [] : [{ line: 1, criterion: "lane" as const, message, path: REGISTER_PATH }];
  });
}

/**
 * What is wrong with one row's lane, if anything — typed as any {@link EscapeHatch} rather than the register's
 * literal rows, because the compiler can see no journalled row is keyed on a variable TODAY, and a future row
 * that is one must still reach the comparison.
 *
 * @returns the hit's message, or undefined when the row's lane and key both agree with the rule
 */
function laneMismatchOf({ hatch }: { hatch: EscapeHatch }): string | undefined {
  if (hatch.lane === "journalled" && hatch.key.kind === "env") {
    return `hatch "${hatch.id}" is journalled but keyed on ${hatch.key.variable} — an outbound row opens on a journalled grant alone, so its key is { kind: "grant" }`;
  }
  if (hatch.lane === "ambient" && hatch.key.kind === "grant") {
    return `hatch "${hatch.id}" is ambient but keyed on a grant — \`hatch open\` issues grants for journalled rows only`;
  }
  const shouldBeJournalled = JOURNALLED_IDS.has(hatch.id);
  if (shouldBeJournalled === (hatch.lane === "journalled")) {
    return undefined;
  }
  const wanted = shouldBeJournalled ? "journalled" : "ambient";
  return `hatch "${hatch.id}" is lane "${hatch.lane}" but is ${wanted} — the outbound rows are journalled and nothing else is`;
}

/**
 * Every hand-written lint summary across the devLint modules — the fourth criterion: a lint gate's refusal
 * carries the same four lines as every other one.
 *
 * Lives here rather than in a gate of its own because the remit is identical: a policy refusal may not be
 * rendered by hand. `../devLint/refusal/scan.ts` owns the criterion; this is the file walk.
 *
 * This sub-scan owns its OWN file selection, so it counts what it never saw and hands that back beside the
 * hits. An empty selection and an unreadable module both produce zero hits, and zero hits read as clean —
 * the shape where a check that cannot fail reports a pass. Review found exactly that here.
 *
 * @param readFile reads a repo-relative path
 * @param root the repository root, for enumerating the devLint modules
 * @returns one hit per hand-written summary in path order, and how many modules went unread
 */
function lintShapeHits({
  readFile,
  root,
}: {
  readFile: (args: { path: string }) => string | undefined;
  root: string;
}): { readonly hits: readonly EscapeHatchHit[]; readonly unseen: number } {
  let paths: readonly string[];
  try {
    paths = workingTreeFilesOf({ root }).filter(
      (path) => path.startsWith("src/devLint/") && path.endsWith(".ts") && !path.startsWith("src/devLint/refusal/"),
    );
  } catch {
    return { hits: [], unseen: 1 };
  }
  if (paths.length === 0) {
    // devlint: not-a-refusal -- the selection came back empty, so this sub-scan judged nothing; that is a
    // broken filter to report, never a clean tree
    process.stderr.write("escape-hatch: the lint-shape scan selected ZERO devLint modules — a broken filter.\n");
    return { hits: [], unseen: 1 };
  }
  let unseen = 0;
  const hits = paths.flatMap((path) => {
    const content = readFile({ path });
    if (content === undefined) {
      unseen += 1;
      // devlint: not-a-refusal -- a module that was not read was not checked, so this reports the gap
      process.stderr.write(`  ${path}  (unreadable — its refusal shapes were NOT checked)\n`);
      return [];
    }
    return scanLintRefusalWrites({ content, path });
  });
  return { hits, unseen };
}

const SCOPE: ScanScope = {
  excludeTestsDir: true,
  extensions: [".ts", ".tsx"],
  selfFiles: gateSelfPaths({ stem: "escapeHatch" }),
  trees: ["src/", "eval/", "hooks/", "desktop/"],
};

/**
 * Whether a repo-relative path is in scope for this gate.
 *
 * @param path the repo-relative path
 * @returns true when the gate should scan it
 */
export function isScannablePath({ path }: { path: string }): boolean {
  return scopeIsScannablePath({ path, scope: SCOPE });
}

/**
 * IO edge: scan every source file plus the register's own reader claims, print each violation.
 *
 * @returns the process exit code (0 clean, 1 a violation found or not a git checkout)
 */
export function runEscapeHatch(): number {
  let root: string;
  let scanned: readonly string[];
  try {
    root = repoRoot();
    scanned = scopedScanFiles({ root, scope: SCOPE });
  } catch {
    // devlint: not-a-refusal -- the repository could not be READ — either the checkout was not found,
    // or its files could not be enumerated — so the gate has no subject to judge
    process.stderr.write("escape-hatch: not a git checkout (git ls-files failed)\n");
    return 1;
  }
  const readAt = ({ path }: { path: string }): string | undefined => {
    try {
      return readFileSync(join(root, path), "utf8");
    } catch {
      return undefined;
    }
  };
  const {
    hits,
    unreadable,
    scanned: readCount,
  } = scanTextFiles<EscapeHatchHit>({
    paths: scanned,
    readText: ({ path }) => readFileSync(join(root, path), "utf8"),
    scan: ({ content, path }) => scanEscapeHatch({ content, path }),
  });
  const complete = reportScanIntegrity({
    label: "escape-hatch",
    scanned: readCount,
    unreadable,
    write: (text) => {
      process.stderr.write(text);
    },
  });
  const lintShape = lintShapeHits({ readFile: readAt, root });
  const all = [...hits, ...scanReaderClaims({ readFile: readAt }), ...scanLaneClaims(), ...lintShape.hits];
  const unseen = lintShape.unseen + (complete ? 0 : 1);
  if (gateOutcome({ refused: all.length, unseen }) === "incomplete") {
    return 1;
  }
  return reportEscapeHatch({ hits: all, readCount });
}

/**
 * Print the verdict: a clean line on stdout, or every hit followed by the four-line refusal.
 *
 * Split from {@link runEscapeHatch} so that function stays under the body cap — the reporting half has no
 * decisions in it, which is exactly the half worth lifting out.
 *
 * @param hits every violation, across every criterion
 * @param readCount how many files were scanned, for the clean line
 * @returns 0 when there are no hits, else 1
 */
function reportEscapeHatch({ hits, readCount }: { hits: readonly EscapeHatchHit[]; readCount: number }): number {
  if (hits.length === 0) {
    // devlint: not-a-refusal -- the clean line, which stdout carries and no refusal shape applies to
    process.stdout.write(
      `escape-hatch: clean (${String(readCount)} file(s) scanned, ${String(ESCAPE_HATCHES.length)} hatch(es) registered)\n`,
    );
    return 0;
  }
  for (const hit of hits) {
    process.stderr.write(`  ${hit.path}:${String(hit.line)}: ${hit.message}\n`);
  }
  for (const [criterion, refusal] of Object.entries(CRITERION_REFUSALS)) {
    const found = hits.filter((hit) => hit.criterion === criterion);
    if (found.length > 0) {
      process.stderr.write(
        `${lintGateRefusal({
          declaration: lintDeclarationFor({ id: refusal.id }),
          detail: `${String(found.length)} ${refusal.noun}`,
        })}\n`,
      );
    }
  }
  return 1;
}

/** The declaration each criterion answers with, and the noun its count reads as. */
const CRITERION_REFUSALS: Record<EscapeHatchCriterion, { readonly id: LintGateRefusalId; readonly noun: string }> = {
  door: { id: "escape-hatch-door", noun: "hand-rendered door refusal(s)" },
  lane: { id: "escape-hatch-lane", noun: "row(s) whose lane disagrees with the ruling" },
  "lint-shape": { id: "escape-hatch-lint-shape", noun: "hand-written lint summar(y/ies)" },
  reader: { id: "escape-hatch-reader", noun: "row(s) naming a reader that does not read it" },
  undeclared: { id: "escape-hatch", noun: "undeclared hatch(es) or token(s)" },
};
