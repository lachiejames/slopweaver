/**
 * `private-terms answer` over a throwaway home: the owner's yes or no to one waiting proposal is kept beside it and
 * names no word, `list` shows it, `confirm` lands a yes and removes the answer with the proposal, and refuses one
 * answered no. Every term here is synthetic.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { runPrivateTermsAnswer } from "../../../../../cli/commands/privateTerms/answer.js";
import {
  type PrivateTermsEditDeps,
  runPrivateTermsAdd,
  runPrivateTermsConfirm,
} from "../../../../../cli/commands/privateTerms/edit.js";
import { runPrivateTermsList } from "../../../../../cli/commands/privateTerms/list.js";
import { privateTermAnswerPath } from "../../../../../hygiene/privateTermAnswers.js";
import { err, ok } from "../../../../../lib/result.js";
import { stateHomePaths } from "../../../../../stateHome.js";
import { writePrivateTerms } from "../../../../privateTermsFixture.js";

const homes: string[] = [];

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

/** The synthetic word the proposal adds; no output may carry it. */
const WORD = "quillfeather";

/** Deps writing to two line lists; the pattern file holds {@link WORD}. */
function depsOf(): { deps: PrivateTermsEditDeps; out: string[]; diagnostics: string[] } {
  const out: string[] = [];
  const diagnostics: string[] = [];
  return {
    deps: {
      mintProposalId: () => "pp-00000000000a",
      mintTermId: () => "pt-00000000000a",
      nowIso: () => "2026-11-23T00:00:00.000Z",
      out: ({ line }) => {
        out.push(line);
      },
      readPatternFile: ({ path }) => (path === "/fixture/term.txt" ? ok(`${WORD}\n`) : err(`${path} unread`)),
      writeDiagnostic: ({ line }) => {
        diagnostics.push(line);
      },
    },
    diagnostics,
    out,
  };
}

const argvOf = ({ verb, rest }: { verb: string; rest: readonly string[] }): readonly string[] => [
  "node",
  "slopweaver",
  "private-terms",
  verb,
  ...rest,
];

/** A home holding one waiting `add` proposal, `pp-00000000000a`. */
function homeWithProposal(): string {
  const home = mkdtempSync(join(tmpdir(), "private-terms-answer-"));
  homes.push(home);
  // A header-only file, so `list` has a file to read and the proposal is decided over it.
  writePrivateTerms({ home });
  const rest = [
    "--class",
    "person",
    "--case",
    "insensitive",
    "--pattern-file",
    "/fixture/term.txt",
    "--meaning",
    "a colleague at acme",
    "--allowed-where",
    "nowhere",
    "--source",
    "relay:acme-row",
    "--home",
    home,
  ];
  expect(runPrivateTermsAdd({ argv: argvOf({ rest, verb: "add" }), deps: depsOf().deps })).toBe(0);
  return home;
}

/** Answer the waiting proposal. */
function answer({ home, as }: { home: string; as: string }): ReturnType<typeof depsOf> & { code: number } {
  const run = depsOf();
  const rest = ["pp-00000000000a", "--as", as, "--via", "console", "--by-session", "work-console", "--home", home];
  return { ...run, code: runPrivateTermsAnswer({ argv: argvOf({ rest, verb: "answer" }), deps: run.deps }) };
}

describe("private-terms answer", () => {
  it("keeps a yes beside the proposal, naming no word, and list shows it", () => {
    const home = homeWithProposal();
    const run = answer({ as: "yes", home });
    expect(run.code).toBe(0);
    expect(run.out).toStrictEqual([
      "recorded: the owner answered yes to pp-00000000000a on console; land it with: slopweaver private-terms confirm pp-00000000000a",
    ]);
    const kept = readFileSync(privateTermAnswerPath({ home, proposalId: "pp-00000000000a" }), "utf8");
    expect(JSON.parse(kept)).toStrictEqual({
      answer: "yes",
      answeredAtIso: "2026-11-23T00:00:00.000Z",
      bySession: "work-console",
      proposalId: "pp-00000000000a",
      schemaVersion: 1,
      via: "console",
    });
    expect(kept.toLowerCase()).not.toContain(WORD);
    const listed = depsOf();
    expect(runPrivateTermsList({ argv: argvOf({ rest: ["--home", home], verb: "list" }), deps: listed.deps })).toBe(0);
    expect(listed.out).toStrictEqual([
      "0 row(s)",
      "waiting: proposal pp-00000000000a to add pt-00000000000a, owner yes",
    ]);
  });

  it("lets confirm land a yes and removes the answer with the proposal", () => {
    const home = homeWithProposal();
    expect(answer({ as: "yes", home }).code).toBe(0);
    const confirmed = depsOf();
    const argv = argvOf({ rest: ["pp-00000000000a", "--home", home], verb: "confirm" });
    expect(runPrivateTermsConfirm({ argv, deps: confirmed.deps })).toBe(0);
    expect(existsSync(privateTermAnswerPath({ home, proposalId: "pp-00000000000a" }))).toBe(false);
    expect(readFileSync(stateHomePaths({ home }).privateTerms, "utf8")).toContain(WORD);
  });

  it("makes confirm refuse a proposal answered no, writing nothing", () => {
    const home = homeWithProposal();
    const run = answer({ as: "no", home });
    expect(run.out).toStrictEqual([
      "recorded: the owner answered no to pp-00000000000a on console; confirm now refuses it; nothing changes in the terms file",
    ]);
    const confirmed = depsOf();
    const argv = argvOf({ rest: ["pp-00000000000a", "--home", home], verb: "confirm" });
    expect(runPrivateTermsConfirm({ argv, deps: confirmed.deps })).toBe(2);
    expect(confirmed.diagnostics).toStrictEqual([
      "no proposal to confirm: the owner answered no to pp-00000000000a on console at 2026-11-23T00:00:00.000Z",
    ]);
    expect(readFileSync(stateHomePaths({ home }).privateTerms, "utf8")).not.toContain(WORD);
  });

  it("makes confirm refuse over an answer file that does not read, and list name it unreadable", () => {
    const home = homeWithProposal();
    const path = privateTermAnswerPath({ home, proposalId: "pp-00000000000a" });
    writeFileSync(path, "{not an answer", { mode: 0o600 });
    const confirmed = depsOf();
    const argv = argvOf({ rest: ["pp-00000000000a", "--home", home], verb: "confirm" });
    expect(runPrivateTermsConfirm({ argv, deps: confirmed.deps })).toBe(2);
    expect(confirmed.diagnostics).toStrictEqual([
      `no proposal to confirm: the owner's answer to pp-00000000000a at ${path} does not read; record it again with private-terms answer`,
    ]);
    const listed = depsOf();
    expect(runPrivateTermsList({ argv: argvOf({ rest: ["--home", home], verb: "list" }), deps: listed.deps })).toBe(0);
    expect(listed.out[1]).toBe("waiting: proposal pp-00000000000a to add pt-00000000000a, owner unreadable");
  });

  it("makes confirm refuse over a dangling answer link, which is an answer that does not read, not no answer", () => {
    const home = homeWithProposal();
    const path = privateTermAnswerPath({ home, proposalId: "pp-00000000000a" });
    symlinkSync(join(home, "nowhere"), path);
    const confirmed = depsOf();
    const argv = argvOf({ rest: ["pp-00000000000a", "--home", home], verb: "confirm" });
    expect(runPrivateTermsConfirm({ argv, deps: confirmed.deps })).toBe(2);
    expect(confirmed.diagnostics).toStrictEqual([
      `no proposal to confirm: the owner's answer to pp-00000000000a at ${path} does not read; record it again with private-terms answer`,
    ]);
    expect(readFileSync(stateHomePaths({ home }).privateTerms, "utf8")).not.toContain(WORD);
  });

  it("a later press replaces the earlier answer", () => {
    const home = homeWithProposal();
    expect(answer({ as: "no", home }).code).toBe(0);
    expect(answer({ as: "yes", home }).code).toBe(0);
    const confirmed = depsOf();
    const argv = argvOf({ rest: ["pp-00000000000a", "--home", home], verb: "confirm" });
    expect(runPrivateTermsConfirm({ argv, deps: confirmed.deps })).toBe(0);
  });

  it("refuses a proposal that is not waiting, writing nothing", () => {
    const home = homeWithProposal();
    const run = depsOf();
    const rest = ["pp-0000000000ff", "--as", "yes", "--via", "console", "--by-session", "work-console", "--home", home];
    expect(runPrivateTermsAnswer({ argv: argvOf({ rest, verb: "answer" }), deps: run.deps })).toBe(2);
    expect(run.diagnostics).toStrictEqual([
      "no proposal to confirm: pp-0000000000ff is not waiting: it was confirmed already, or never made under this home",
    ]);
    expect(existsSync(privateTermAnswerPath({ home, proposalId: "pp-0000000000ff" }))).toBe(false);
  });

  it("refuses an answer that is not yes or no, and a missing --via and --by-session", () => {
    const home = homeWithProposal();
    const run = depsOf();
    const rest = ["pp-00000000000a", "--as", "maybe", "--home", home];
    expect(runPrivateTermsAnswer({ argv: argvOf({ rest, verb: "answer" }), deps: run.deps })).toBe(2);
    expect(run.diagnostics.slice(0, 3)).toStrictEqual([
      '--as must be "yes" or "no": the owner\'s answer to that one proposal',
      "--via is required and is one of console, word: where the owner answered",
      "--by-session is required: who recorded the answer",
    ]);
  });

  it("refuses a --via outside its closed set without echoing it, so the word cannot reach either stream", () => {
    const home = homeWithProposal();
    const run = depsOf();
    const rest = ["pp-00000000000a", "--as", "yes", "--via", WORD, "--by-session", "work-console", "--home", home];
    expect(runPrivateTermsAnswer({ argv: argvOf({ rest, verb: "answer" }), deps: run.deps })).toBe(2);
    expect(run.diagnostics[0]).toBe("--via is required and is one of console, word: where the owner answered");
    expect([...run.out, ...run.diagnostics].join("\n").toLowerCase()).not.toContain(WORD);
    expect(rest).toContain(WORD);
    expect(existsSync(privateTermAnswerPath({ home, proposalId: "pp-00000000000a" }))).toBe(false);
  });

  it("writes no answer while another edit holds the terms file's lock", () => {
    const home = homeWithProposal();
    const lock = `${stateHomePaths({ home }).privateTerms}.lock`;
    // This test's own pid: a holder that is running.
    writeFileSync(lock, `${String(process.pid)}\n`, { mode: 0o600 });
    const run = answer({ as: "no", home });
    expect(run.code).toBe(1);
    expect(run.diagnostics).toStrictEqual([
      `the lock ${lock} is not ours to take: pid ${String(process.pid)} holds it and is running; run it again once that edit has finished`,
    ]);
    expect(existsSync(privateTermAnswerPath({ home, proposalId: "pp-00000000000a" }))).toBe(false);
    expect(readFileSync(lock, "utf8")).toBe(`${String(process.pid)}\n`);
  });

  it("makes confirm read the answer only under the lock, so a held lock refuses before any answer is weighed", () => {
    const home = homeWithProposal();
    const path = privateTermAnswerPath({ home, proposalId: "pp-00000000000a" });
    writeFileSync(path, "{not an answer", { mode: 0o600 });
    const lock = `${stateHomePaths({ home }).privateTerms}.lock`;
    writeFileSync(lock, `${String(process.pid)}\n`, { mode: 0o600 });
    const confirmed = depsOf();
    const argv = argvOf({ rest: ["pp-00000000000a", "--home", home], verb: "confirm" });
    expect(runPrivateTermsConfirm({ argv, deps: confirmed.deps })).toBe(1);
    expect(confirmed.diagnostics).toStrictEqual([
      `the lock ${lock} is not ours to take: pid ${String(process.pid)} holds it and is running; run it again once that edit has finished`,
    ]);
  });
});
