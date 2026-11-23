/**
 * The quality ratchets' refusal copy — the half of the declaration table that belongs to the instruments
 * holding today's measured state against a regression.
 *
 * ## Why this is a leaf of the declaration table
 *
 * `undeclaredGates` (`../gateRegistration.ts`) refuses a planned gate carrying NO declaration, and nothing
 * anywhere refuses a surplus row. The parity it protects is over the COMPOSED table, so a row defined here
 * and spread into `./declarations.ts` satisfies it exactly as a row written there would. What would be
 * drift is a row defined twice, and that is what the spread makes impossible.
 *
 * The cut is one the lint plan already draws: `qualityRatchets` in `../gateGroups.ts` names duplicate
 * windows, file size, internal exports and untested modules as one family, and every refusal id of each
 * moves together. A new quality gate's row goes here, and this file splits again when it nears the
 * 300-code-line cap.
 */
import type { LintGateDeclaration } from "./types.js";

/**
 * The quality-ratchet rows, keyed by refusal id. Spread into `./declarations.ts`'s
 * `LINT_GATE_DECLARATIONS`, which stays the one table every consumer reads.
 */
export const QUALITY_LINT_GATE_DECLARATIONS = {
  "duplicate-windows-rebaseline": {
    caught: "a rebaseline was asked to record MORE duplication than the committed floor, which moves the bar",
    correction: "extract the shared code first, then rebaseline once the count has actually come down",
    exceptions: ["a deliberate, reviewed floor change whose reason is in the same pull request"],
    gate: "duplicate-windows",
  },
  "duplicate-windows": {
    caught: "two corpus windows overlap beyond the recorded floor, so the same records are stored and read twice",
    correction: "compact the overlapping windows, then rebaseline the floor to what compaction achieved",
    exceptions: ["an overlap already recorded in the floor file"],
    gate: "duplicate-windows",
  },
  "file-size-ratchet": {
    caught: "a file grew past its recorded size, and a file nobody can hold in their head is one nobody reviews",
    correction:
      "split it along a real seam, and a test file by scenario or describe block into sibling files, never by moving a flow's steps into helpers; oversized files are always split",
    exceptions: [
      "a generated file, which carries the generated leading comment and is not edited by hand",
      "a non-test file carrying the exemption marker AND a row in the committed tradeoff register that names the tradeoff and the anchor of the owner's yes",
    ],
    gate: "file-size-ratchet",
  },
  "file-size-ratchet-debt": {
    caught:
      "a committed floor row names a file that is gone, has already fallen under the cap, or has changed which half of the floor holds it, or a tradeoff register row names a file that is gone or no longer declares the exemption marker, so a committed file describes something that is not there",
    correction:
      "tighten the floor with the rebaseline script named in this gate's own module header, which is how it only ever shrinks, and delete a tradeoff row whose marker is gone",
    exceptions: [
      "a row whose file is still over the cap in the same half, which is the floor doing its job",
      "a tradeoff row whose file still declares the exemption marker",
    ],
    gate: "file-size-ratchet",
  },
  "file-size-ratchet-rebaseline": {
    caught: "a rebaseline was asked to record a file GROWING, which moves the bar rather than measuring against it",
    correction: "shrink the file to at or under its recorded size, then rebaseline; a baseline only ratchets down",
    exceptions: ["a deliberate, reviewed cap change, which changes the cap rather than the baseline"],
    gate: "file-size-ratchet",
  },
  "file-size-ratchet-retired-marker": {
    caught:
      "a file declares the retired register marker, which no longer raises or exempts anything: a register is split by category like any other file",
    correction: "delete the marker, and split the file by category if it is over its cap",
    exceptions: ["prose that mentions the marker without a comment line opening on it, which declares nothing"],
    gate: "file-size-ratchet",
  },
  "file-size-ratchet-unrecorded-tradeoff": {
    caught:
      "a file declares the exemption marker but the committed tradeoff register holds no row for it, and oversized files are always split unless the owner signed a named tradeoff",
    correction:
      "delete the marker and split the file; only where splitting costs more than it buys, ask the owner and record their yes as a register row naming the tradeoff and its anchor",
    exceptions: [
      "a non-test file whose register row the owner signed, which this finding does not fire on",
      "prose that mentions the marker without a comment line opening on it, which declares nothing",
    ],
    gate: "file-size-ratchet",
  },
  "internal-exports": {
    caught:
      "a symbol is exported and nothing outside its own file names it, so the module's public surface claims more than it has",
    correction: "mark it internal in its JSDoc, or drop the export if nothing outside the file needs it",
    exceptions: ["a symbol a test legitimately imports, which is a real consumer"],
    gate: "internal-exports",
  },
  "untested-modules": {
    caught:
      "a module exports a value that no file in the test tree so much as imports, so nothing would notice it breaking",
    correction:
      "add a test under src/__tests__/ that imports it and asserts its behaviour, or fold the value into a module that already has one",
    exceptions: [
      "a module that exports only types or interfaces, which is outside the criterion rather than excused by it",
      "an entry point whose whole body is a top-level invocation, which exports nothing a test could call",
    ],
    gate: "untested-modules",
  },
  "untested-modules-rebaseline": {
    caught:
      "a rebaseline was asked to ADD a module to the debt list, which widens the bar rather than measuring against it",
    correction: "give the module a test, then rebaseline; a debt list only ever shrinks",
    exceptions: ["a module deliberately deleted, which removes an entry rather than adding one"],
    gate: "untested-modules",
  },
  "baseline-against-main": {
    caught:
      "a bump manifest main holds under .baselines/bumps/ is rewritten, so the bytes its Codex witness judged are no longer the bytes in the tree",
    correction:
      "restore the file to main's bytes or delete it, and declare the rise again with `slopweaver dev baseline-bump --reason`, which writes a new record into $SLOPWEAVER_HOME/ledgers/baseline-bumps/ and prints the Codex witness the landing verbs will require; a loosening itself passes this gate and is owed at landing",
    exceptions: [
      "a manifest the change adds under .baselines/bumps/, which the landing verbs read beside the state home's records",
      "one of main's manifests left byte-identical or deleted by the change, which the comparison passes over as history",
    ],
    gate: "baseline-against-main",
  },
  "test-enshittification": {
    caught:
      "a test file asserts less than it did at the base commit, so the suite still runs and no longer holds the same thing down",
    correction:
      "restore the assertions; where the cases went out WITH the production code, say so on the file with `deleted-with-code: <symbol>` in a comment and the gate checks that symbol really left non-test source in this diff; where several matchers merged into one, say in the pull request which stronger claim replaced them — that one is a legitimate refusal to argue with, not one to route around",
    exceptions: [
      "several assertions merged into one that covers the same fields, which lowers the count without lowering the claim",
      "a case deleted with the behaviour it tested, where the production code went in the same diff",
    ],
    gate: "test-enshittification",
  },
} as const satisfies Readonly<Record<string, LintGateDeclaration>>;
