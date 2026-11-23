/**
 * Every lint gate's standing refusal copy, declared once and composed from category files.
 *
 * ## What a row is for
 *
 * A gate knows its criterion; a reader hitting the refusal usually does not. Each row answers the three
 * questions the four-line shape asks and the gate itself cannot be trusted to remember: what the rule is,
 * which neighbouring shapes are legitimately outside it, and what a fix looks like. `./render.ts` owns the
 * wording around them and `./scan.ts` refuses a gate that writes its own summary instead.
 *
 * ## Prose, never a snippet
 *
 * A `correction` names the sanctioned helper or the transformation in words. It never quotes the pattern its
 * own gate refuses, and never quotes another gate's either. Gates here exclude only their own source, entry
 * and test triad (`../scanScope.ts`), so a table of illustrative snippets in one shared file is a table of
 * violations for every other gate — measured as a real risk in this change's planning pass, not a
 * hypothetical. If a row ever needs an example, it belongs in the gate's own module header.
 *
 * ## One row per distinct refusal, not per module
 *
 * Most gates refuse one thing. A few refuse two with genuinely different corrections — `whole-file-json`
 * separates a fresh violation from stale registered debt, `file-size-ratchet` and `agent-doc-size` separate
 * a regression from a refused rebaseline — and those get a row each, because flattening them would put a
 * correction in front of a reader that does not apply to what they hit.
 *
 * ## Where the rows live
 *
 * The rows live in six category files, and this module only composes them into the one table every
 * consumer reads. A new gate's row goes in the file of the family its gate belongs to, and a category file
 * nearing 300 code lines splits again:
 *
 * - `./contractDeclarations.ts` — the instruments asserting one machine honours a contract another declared
 *   (`contractRatchets` in `../gateGroups.ts`).
 * - `./qualityDeclarations.ts` — the instruments holding today's measured state against a regression
 *   (`qualityRatchets`).
 * - `./sourceShapeDeclarations.ts` — the shape of TypeScript source and the text it is written in.
 * - `./claimDeclarations.ts` — the statements the repository makes about itself: documents, copy, command
 *   and skill metadata, naming and the registers.
 * - `./reachDeclarations.ts` — what code reaches: processes, providers, channels, roots and transports.
 * - `./harnessDeclarations.ts` — the verification machinery: the test tree, the store schema and its
 *   migrations, proof paths and gate registration.
 *
 * `gate-registration` reads the COMPOSED table (`undeclaredGates` in `../gateRegistration.ts`), so a row
 * defined in a leaf satisfies it exactly as a row written here would. What the composition has to preserve
 * is that each refusal id is defined ONCE, which `registryComposition.test.ts` asserts across every leaf —
 * an object spread overwrites a duplicate key silently.
 */
import { CLAIM_LINT_GATE_DECLARATIONS } from "./claimDeclarations.js";
import { CONTRACT_LINT_GATE_DECLARATIONS } from "./contractDeclarations.js";
import { HARNESS_LINT_GATE_DECLARATIONS } from "./harnessDeclarations.js";
import { QUALITY_LINT_GATE_DECLARATIONS } from "./qualityDeclarations.js";
import { REACH_LINT_GATE_DECLARATIONS } from "./reachDeclarations.js";
import { SOURCE_SHAPE_LINT_GATE_DECLARATIONS } from "./sourceShapeDeclarations.js";
import type { LintGateDeclaration } from "./types.js";

/**
 * The declarations, keyed by refusal id. A gate imports its own row by name; nothing iterates this table at
 * runtime except the parity check in `../gateRegistration.ts`, which proves a registered gate has one.
 */
export const LINT_GATE_DECLARATIONS = {
  ...CONTRACT_LINT_GATE_DECLARATIONS,
  ...QUALITY_LINT_GATE_DECLARATIONS,
  ...SOURCE_SHAPE_LINT_GATE_DECLARATIONS,
  ...CLAIM_LINT_GATE_DECLARATIONS,
  ...REACH_LINT_GATE_DECLARATIONS,
  ...HARNESS_LINT_GATE_DECLARATIONS,
} as const satisfies Readonly<Record<string, LintGateDeclaration>>;
