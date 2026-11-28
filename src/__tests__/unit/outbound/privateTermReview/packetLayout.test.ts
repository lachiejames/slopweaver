/**
 * THE PRIVATE-WORDS PACKET'S LAYOUT, over a throwaway home and a real packet repository: the matches in context ride
 * the diff a reviewer reads, while every meaning, allowed place and destination stays at the base commit, outside
 * the diff that a pass copies into its review packet. Every term here is synthetic.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { gitCommitDiffCommand } from "../../../../codex/diff.js";
import { runGitChecked } from "../../../../codex/gitRun.js";
import { FORBIDDEN_IDENTIFIER_RULES } from "../../../../hygiene/forbiddenIdentifiers.js";
import { PRIVATE_TERMS_HEADER_V2, parsePrivateTerms } from "../../../../hygiene/privateTerms.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { CALENDAR_DESTINATION } from "../../../../outbound/calendar/writePrivacyPayload.js";
import {
  decidePrivateTermWrite,
  type PrivateTermWriteInput,
  writeFindingsOf,
} from "../../../../outbound/privateTermReview/hold.js";
import { preparePrivateTermPacket } from "../../../../outbound/privateTermReview/packet.js";
import { preparationsDirectory, readHold, releaseOrHold } from "../../../../outbound/privateTermReview/store.js";
import { PRIVATE_TERM_REVIEW_PROPERTY } from "../../../../outbound/privateTermReview/types.js";
import type { VisibleSupervisorSession } from "../../../../supervisor/session.js";

const MEANING = "a colleague at acme";
const ALLOWED_WHERE = "the acme calendar";
const DESTINATION = "the owner's Google Calendar";
const SESSION: VisibleSupervisorSession = { host: "claude-code", id: "a0000003-0000-4000-8000-000000000003" };
const GIT_BINARY_MARKER = /^Binary files /m;

const homes: string[] = [];

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

/** Hold one calendar insert carrying `summary`, bound for `destination`, under a fresh home, then prepare its packet. */
function packetFor({ summary, destination = DESTINATION }: { summary: string; destination?: string }) {
  const home = mkdtempSync(join(tmpdir(), "private-term-layout-"));
  homes.push(home);
  const row = `pt-00000000000a\tperson\ti\tquillfeather\t${MEANING}\t${ALLOWED_WHERE}\trelay:acme-row`;
  const policy = {
    denylist: [],
    identifierRules: FORBIDDEN_IDENTIFIER_RULES,
    privateTerms: unwrap(parsePrivateTerms({ text: `${PRIVATE_TERMS_HEADER_V2}\n${row}\n` })),
  };
  const write: PrivateTermWriteInput = {
    command: "calendar calendar.events.insert",
    contents: [{ locus: "calendar calendar.events.insert summary", text: summary }],
    destination,
    family: "google-calendar",
    request: {
      body: { summary },
      operation: "calendar.events.insert",
      target: { calendarId: "primary", conferenceDataVersion: 0, sendUpdates: "none" },
    },
  };
  const findings = writeFindingsOf({ contents: write.contents, destination: CALENDAR_DESTINATION, policy });
  const decision = decidePrivateTermWrite({ findings, policy, privacyDestination: CALENDAR_DESTINATION, write });
  if (decision.kind !== "review") {
    throw new Error(`expected a held write, got ${decision.kind}`);
  }
  const { draft } = decision;
  const newHoldId = () => "ph-000000000001";
  unwrap(releaseOrHold({ draft, heldBy: SESSION, home, newHoldId, nowIso: "2026-11-22T00:00:00.000Z" }));
  const hold = unwrap(readHold({ holdId: "ph-000000000001", home }));
  const createdAtIso = "2026-11-22T00:01:00.000Z";
  const prepared = preparePrivateTermPacket({ createdAtIso, hold, home, preparationId: "prep-1", preparedBy: SESSION });
  return { home, prepared };
}

/** The exact diff a review reads, untrimmed, through the runner the packet's digest was taken under. */
function reviewDiff({
  repoRoot,
  baseSha,
  headSha,
  config = [],
}: {
  repoRoot: string;
  baseSha: string;
  headSha: string;
  config?: readonly string[];
}): string {
  const args = [...config, ...gitCommitDiffCommand({ commit: headSha, mergeBase: baseSha }).args];
  return runGitChecked({ args, cwd: repoRoot, label: "git diff" });
}

describe("the private-term packet's layout", () => {
  it("commits the meanings and the destination at the base and only the write at the head", () => {
    const { preparation, repoRoot } = unwrap(packetFor({ summary: "lunch with Quillfeather" }).prepared);
    const git = ({ args }: { args: readonly string[] }) => runGitChecked({ args, cwd: repoRoot, label: "git" });
    expect(git({ args: ["ls-tree", "-r", "--name-only", preparation.baseSha] }).split("\n")).toStrictEqual([
      ".gitattributes",
      "README.md",
      "terms/pt-00000000000a.md",
      "write/destination.txt",
      "",
    ]);
    const headOnly = git({ args: ["diff", "--name-only", preparation.baseSha, preparation.headSha] });
    expect(headOnly.split("\n")).toStrictEqual(["write/contents/01.txt", "write/contexts.md", ""]);
  });

  it("keeps every meaning, allowed place and destination out of the diff, while the base still holds them", () => {
    const { diffBytes, preparation, repoRoot } = unwrap(packetFor({ summary: "lunch with Quillfeather" }).prepared);
    const atBase = ({ path }: { path: string }) =>
      runGitChecked({ args: ["cat-file", "blob", `${preparation.baseSha}:${path}`], cwd: repoRoot, label: "git" });
    const term = atBase({ path: "terms/pt-00000000000a.md" });
    const destination = atBase({ path: "write/destination.txt" });
    expect([term.includes(MEANING), term.includes(ALLOWED_WHERE), destination.includes(DESTINATION)]).toStrictEqual([
      true,
      true,
      true,
    ]);
    const diff = reviewDiff({ baseSha: preparation.baseSha, headSha: preparation.headSha, repoRoot });
    expect([
      diff.includes(MEANING),
      diff.includes(ALLOWED_WHERE),
      diff.includes(DESTINATION),
      diff.includes("+lunch with Quillfeather"),
    ]).toStrictEqual([false, false, false, true]);
    expect(Buffer.byteLength(diff, "utf8")).toBe(diffBytes);
  });

  it("still diffs the write as text under a global attributes file marking it -diff", () => {
    const { home, prepared } = packetFor({ summary: "lunch with Quillfeather" });
    const { preparation, repoRoot } = unwrap(prepared);
    const attributes = join(home, "global-attributes");
    writeFileSync(attributes, "*.md -diff\n*.txt -diff\n");
    const diff = reviewDiff({
      baseSha: preparation.baseSha,
      config: ["-c", `core.attributesFile=${attributes}`],
      headSha: preparation.headSha,
      repoRoot,
    });
    expect([diff.includes("+lunch with Quillfeather"), GIT_BINARY_MARKER.test(diff)]).toStrictEqual([true, false]);
  });

  it("refuses a write whose sent string holds a NUL byte, naming only its packet path, and prepares nothing", () => {
    const { home, prepared } = packetFor({ summary: "lunch with Quillfeather\0" });
    const failure = unwrapErr(prepared);
    expect(failure.code).toBe("FILE_NOT_TEXT");
    expect(failure.message).toBe(
      "write/contexts.md holds a NUL byte, so the review's diff cannot carry it as text; nothing was prepared",
    );
    expect(existsSync(join(preparationsDirectory({ home }), "prep-1"))).toBe(false);
  });

  it("refuses a base file holding a NUL byte too, since the reviewer is told to open it as text", () => {
    const { home, prepared } = packetFor({ destination: "the owner's\0calendar", summary: "lunch with Quillfeather" });
    const failure = unwrapErr(prepared);
    expect(failure.message).toBe(
      "write/destination.txt holds a NUL byte, so the review's diff cannot carry it as text; nothing was prepared",
    );
    expect(existsSync(join(preparationsDirectory({ home }), "prep-1"))).toBe(false);
  });

  it("commits every packet file as text under a user's global excludes file and init template", () => {
    const userHome = mkdtempSync(join(tmpdir(), "private-term-user-home-"));
    homes.push(userHome);
    mkdirSync(join(userHome, "template", "info"), { recursive: true });
    writeFileSync(join(userHome, "template", "info", "attributes"), "*.md -diff\n*.txt -diff\n");
    writeFileSync(join(userHome, "ignored"), "*.md\n*.txt\n.gitattributes\n");
    writeFileSync(
      join(userHome, ".gitconfig"),
      `[core]\n\texcludesFile = ${join(userHome, "ignored")}\n[init]\n\ttemplateDir = ${join(userHome, "template")}\n`,
    );
    const saved = { HOME: process.env["HOME"], XDG_CONFIG_HOME: process.env["XDG_CONFIG_HOME"] };
    process.env["HOME"] = userHome;
    process.env["XDG_CONFIG_HOME"] = join(userHome, "xdg");
    try {
      const { preparation, repoRoot } = unwrap(packetFor({ summary: "lunch with Quillfeather" }).prepared);
      const git = ({ args }: { args: readonly string[] }) => runGitChecked({ args, cwd: repoRoot, label: "git" });
      expect([
        git({ args: ["ls-tree", "-r", "--name-only", preparation.baseSha] }).split("\n").length,
        git({ args: ["diff", "--name-only", preparation.baseSha, preparation.headSha] }).split("\n").length,
      ]).toStrictEqual([5, 3]);
      const { baseSha, headSha } = preparation;
      expect(GIT_BINARY_MARKER.test(reviewDiff({ baseSha, headSha, repoRoot }))).toBe(false);
    } finally {
      process.env["HOME"] = saved.HOME;
      if (saved.XDG_CONFIG_HOME === undefined) {
        delete process.env["XDG_CONFIG_HOME"];
      } else {
        process.env["XDG_CONFIG_HOME"] = saved.XDG_CONFIG_HOME;
      }
    }
  });

  it("opens its property on reading the base files the diff does not carry", () => {
    const opening =
      "Before answering, read every terms/<term-id>.md and write/destination.txt in the repository the review names";
    expect(PRIVATE_TERM_REVIEW_PROPERTY.startsWith(opening)).toBe(true);
  });
});
