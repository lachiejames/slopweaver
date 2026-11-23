import { describe, expect, it } from "vitest";
import { CORE_REGISTERS } from "../../../../store/homeRegisters/coreRegisters.js";
import { CORPUS_REGISTERS } from "../../../../store/homeRegisters/corpusRegisters.js";
import { DECLARED_ONLY_REGISTERS } from "../../../../store/homeRegisters/declaredOnlyRegisters.js";
import { JUDGEMENT_REGISTERS } from "../../../../store/homeRegisters/judgementRegisters.js";
import { RUNTIME_REGISTERS } from "../../../../store/homeRegisters/runtimeRegisters.js";
import { HOME_REGISTERS } from "../../../../store/homeRegisters.js";

/*
 * The home registers are declared by category and composed in `homeRegisters.ts`. These cases hold the two
 * properties the split must keep: each category carries exactly its rows, in report order, and the one exported
 * array is the categories spread contiguously, with no row dropped, duplicated or reordered.
 */
describe("home register categories", () => {
  it("core registers are the board, runs, knowledge, identity, profile and plans", () => {
    expect(CORE_REGISTERS.length).toBeGreaterThan(0);
    expect(CORE_REGISTERS.map((register) => register.kind)).toEqual([
      "handover board",
      "run journals",
      "knowledge register",
      "identity roster",
      "owner profile",
      "plan register",
    ]);
  });

  it("runtime registers are the singletons, cmux, fleet and org-health files", () => {
    expect(RUNTIME_REGISTERS.length).toBeGreaterThan(0);
    expect(RUNTIME_REGISTERS.map((register) => register.kind)).toEqual([
      "gmail triage rules",
      "recorded browser profile",
      "stale-seat notices",
      "Codex sign-in observations",
      "cmux session-watch fold",
      "cmux event cursor",
      "fleet capacity",
      "fleet recovery journal",
      "cmux revive journal",
      "incident snapshot",
      "incident sightings",
      "incident acknowledgements",
    ]);
  });

  it("judgement registers are the landing and owner-judgement journals", () => {
    expect(JUDGEMENT_REGISTERS.length).toBeGreaterThan(0);
    expect(JUDGEMENT_REGISTERS.map((register) => register.kind)).toEqual([
      "landing presses",
      "landing reads",
      "codex supersessions",
      "knowledge domains",
      "owner directives and corrections",
      "standing asks",
      "steer measurements",
    ]);
  });

  it("corpus registers are the corpus, atlases, pages, measurement roots and Datadog caches", () => {
    expect(CORPUS_REGISTERS.length).toBeGreaterThan(0);
    expect(CORPUS_REGISTERS.map((register) => register.kind)).toEqual([
      "bronze corpus",
      "provider atlases",
      "published pages",
      "bakeoff measurements",
      "datadog screenshots",
      "evidence",
      "proof",
      "datadog hits cache",
      "datadog catalogue",
    ]);
  });

  it("declared-only registers are exactly the ones that take no measurement", () => {
    expect(DECLARED_ONLY_REGISTERS.length).toBeGreaterThan(0);
    expect(DECLARED_ONLY_REGISTERS.map((register) => register.kind)).toEqual([
      "owner turns",
      "supervisor scratch",
      "codex passes",
      "authored working state",
    ]);
    expect(DECLARED_ONLY_REGISTERS.map((register) => register.measure)).toEqual([
      "declared-only",
      "declared-only",
      "declared-only",
      "declared-only",
    ]);
  });

  it("HOME_REGISTERS is the five categories spread contiguously, in order", () => {
    expect(HOME_REGISTERS).toEqual([
      ...CORE_REGISTERS,
      ...RUNTIME_REGISTERS,
      ...JUDGEMENT_REGISTERS,
      ...CORPUS_REGISTERS,
      ...DECLARED_ONLY_REGISTERS,
    ]);
    expect(HOME_REGISTERS.length).toBe(38);
  });
});
