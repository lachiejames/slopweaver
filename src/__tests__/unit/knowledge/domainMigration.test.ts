/**
 * The domain fold's plan: a retired spelling moves to its canonical domain AND its derived id, every
 * `supersedes` and recall follows the id, an install's own aliases fold exactly as the committed ones do, and
 * an unmapped domain is listed rather than guessed.
 */
import { describe, expect, it } from "vitest";

import { migrationLines } from "../../../cli/commands/knowledge/domains.js";
import { type MigratableRecording, planDomainMigration } from "../../../knowledge/domainMigration.js";
import { type InstallKnowledgeDomains, noInstallDomains } from "../../../knowledge/domainVocabulary.js";
import { memoryId } from "../../../knowledge/memoryRow.js";

const CLAIM = "a required check that never reports blocks the merge queue";
const UNDER_ALIAS = memoryId({ claim: CLAIM, domain: "github-ci", kind: "lesson" });
const UNDER_CANONICAL = memoryId({ claim: CLAIM, domain: "ci", kind: "lesson" });
const INSTALL_HOME = "/tmp/sw-home";
const NONE = noInstallDomains({ home: INSTALL_HOME });

/** A synthetic install: its own domain and one retired spelling folding into it. */
const ACME: InstallKnowledgeDomains = {
  aliases: { "acme-e2e": "acme" },
  domains: [{ holds: "the synthetic team monorepo", slug: "acme" }],
  home: INSTALL_HOME,
};

/** One stored recording. */
const row = (over: Partial<MigratableRecording> = {}): MigratableRecording => ({
  claim: CLAIM,
  domain: "github-ci",
  id: UNDER_ALIAS,
  kind: "lesson",
  recordingId: "r-1",
  supersedes: null,
  ...over,
});

describe("planDomainMigration", () => {
  it("moves a retired spelling to its canonical domain and the id that domain derives", () => {
    const plan = planDomainMigration({ installDomains: NONE, rows: [row()] });
    expect(plan.rewrites).toEqual([{ domain: "ci", id: UNDER_CANONICAL, recordingId: "r-1", supersedes: null }]);
    expect(plan.idMap).toEqual([{ from: UNDER_ALIAS, to: UNDER_CANONICAL }]);
    expect(plan.folds).toEqual([{ from: "github-ci", recordings: 1, to: "ci" }]);
  });

  it("merges one claim filed under two spellings into one series, and counts the merge", () => {
    const plan = planDomainMigration({
      installDomains: NONE,
      rows: [row({ domain: "ci", id: UNDER_CANONICAL, recordingId: "r-0" }), row()],
    });
    expect(plan.rewrites.map((rewrite) => rewrite.id)).toEqual([UNDER_CANONICAL]);
    expect(plan.merges).toBe(1);
  });

  it("rewrites a canonical recording's supersedes when the claim it names moves", () => {
    const retiring = row({
      claim: "a later reading",
      domain: "ci",
      id: "l-retiring",
      recordingId: "r-2",
      supersedes: UNDER_ALIAS,
    });
    const plan = planDomainMigration({ installDomains: NONE, rows: [row(), retiring] });
    expect(plan.rewrites.at(1)).toEqual({
      domain: "ci",
      id: "l-retiring",
      recordingId: "r-2",
      supersedes: UNDER_CANONICAL,
    });
  });

  it("drops a retirement the merge made point at its own claim", () => {
    const refiled = row({ domain: "ci", id: UNDER_CANONICAL, recordingId: "r-2", supersedes: UNDER_ALIAS });
    const plan = planDomainMigration({ installDomains: NONE, rows: [row(), refiled] });
    expect(plan.rewrites.at(1)).toEqual({ domain: "ci", id: UNDER_CANONICAL, recordingId: "r-2", supersedes: null });
  });

  it("leaves a register already canonical untouched", () => {
    const plan = planDomainMigration({ installDomains: NONE, rows: [row({ domain: "ci", id: UNDER_CANONICAL })] });
    expect([plan.rewrites.length, plan.idMap.length, plan.unmapped.length]).toEqual([0, 0, 0]);
  });

  it("lists an unmapped domain and leaves its recordings where they are", () => {
    const plan = planDomainMigration({ installDomains: NONE, rows: [row({ domain: "made-up-system", id: "l-x" })] });
    expect(plan.unmapped).toEqual(["made-up-system"]);
    expect(plan.rewrites).toEqual([]);
  });

  it("folds an install's own alias onto the install's domain, id and all", () => {
    const underInstallAlias = memoryId({ claim: CLAIM, domain: "acme-e2e", kind: "lesson" });
    const underInstallDomain = memoryId({ claim: CLAIM, domain: "acme", kind: "lesson" });
    const plan = planDomainMigration({
      installDomains: ACME,
      rows: [row({ domain: "acme-e2e", id: underInstallAlias })],
    });
    expect(plan.rewrites).toEqual([{ domain: "acme", id: underInstallDomain, recordingId: "r-1", supersedes: null }]);
    expect(plan.folds).toEqual([{ from: "acme-e2e", recordings: 1, to: "acme" }]);
    expect(plan.unmapped).toEqual([]);
  });

  it("calls the install's domain and alias unmapped when the install file does not hold them", () => {
    const plan = planDomainMigration({
      installDomains: NONE,
      rows: [row({ domain: "acme-e2e", id: "l-e" }), row({ domain: "acme", id: "l-a", recordingId: "r-3" })],
    });
    expect(plan.unmapped).toEqual(["acme", "acme-e2e"]);
    expect(plan.rewrites).toEqual([]);
  });
});

describe("migrationLines", () => {
  it("says so when there is nothing to fold", () => {
    expect(
      migrationLines({ home: INSTALL_HOME, plan: planDomainMigration({ installDomains: NONE, rows: [] }) }),
    ).toEqual(["knowledge domains: every stored recording already names a canonical domain"]);
  });

  it("prints each fold and every unmapped domain, naming the store each is added to", () => {
    const plan = planDomainMigration({
      installDomains: NONE,
      rows: [row(), row({ domain: "made-up-system", id: "l-x", recordingId: "r-9" })],
    });
    expect(migrationLines({ home: INSTALL_HOME, plan })).toEqual([
      "knowledge domains: 1 recording(s) to rewrite, 1 claim id(s) to move, 0 merge(s) into an existing claim",
      "  github-ci → ci  (1)",
      "  UNMAPPED (1) — add each to this install's store before --apply, saying what it holds:",
      '    slopweaver knowledge domains add --slug made-up-system --holds "<what it holds>" --home /tmp/sw-home',
    ]);
  });

  it("prints no add command for a stored domain that is not a slug, because the add verb would refuse it", () => {
    const plan = planDomainMigration({ installDomains: NONE, rows: [row({ domain: "--tenant", id: "l-t" })] });
    expect(migrationLines({ home: INSTALL_HOME, plan }).slice(-1)).toEqual([
      '    "--tenant" is not a domain slug, so it cannot be added — its recordings need another domain',
    ]);
  });
});
