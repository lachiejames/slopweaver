/**
 * The bot's own answer never resolves a bare pull-request number against the checkout it was composed in.
 *
 * MEASURED: the bisect turn cited five acme-admin pull requests as bare numbers and `turn review`
 * linked all five into this repository, because the turn lane built its context with `bareRefContext`,
 * whose one repo is the checkout's `origin`. `botAnswerBareRefContext` carries no repo, so the pure
 * resolver refuses a bare reference unless the answer's own text names the repository — the structural
 * fix the owner asked for, in place of the reviewer catching it afterwards.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { botAnswerBareRefContext } from "../../../cli/bareRefContext.js";
import { silverStructuresPath } from "../../../corpus/corpusPaths.js";
import { unwrap } from "../../../lib/result.js";
import { parseAnswerArm } from "../../../outbound/assistant/answerForm.js";

const homes: string[] = [];

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

/** A throwaway home carrying one derived Linear directory, so the Linear half of the context has something to read. */
function homeWithLinearDirectory(): string {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-bot-answer-bare-ref-"));
  homes.push(home);
  const structures = silverStructuresPath({ home });
  mkdirSync(dirname(structures), { recursive: true });
  writeFileSync(
    structures,
    JSON.stringify({
      directory: {
        orgs: [{ slug: "acme-test", source: "linear" }],
        teams: [
          { slug: "SUP", source: "linear" },
          { slug: "INFR", source: "linear" },
        ],
      },
    }),
  );
  return home;
}

/** A minimal valid `answer` arm — conversation-grounded, so only the body text varies. */
function answerRaw({ bodyText }: { bodyText: string }): unknown {
  return {
    body: [{ runs: [{ text: bodyText, type: "text" }], type: "paragraph" }],
    citations: [],
    grounding: {
      evidence: {
        consultedEmpty: [],
        couldNotSee: { blindSpots: [], reason: "no live check needed" },
        premiseChecks: [],
        read: [],
      },
      kind: "conversation",
      provenance: { model: "claude-sonnet-5", skillsLoaded: [], verbsLoaded: [] },
      reason: "context and judgement alone were sufficient",
    },
    images: [],
    index: [],
    kind: "answer",
    lead: "the culprit list",
  };
}

describe("botAnswerBareRefContext", () => {
  it("carries no repo at all, whatever checkout the process runs in", () => {
    const context = botAnswerBareRefContext({ env: {}, home: homeWithLinearDirectory() });
    expect(context.repos).toEqual([]);
  });

  it("still carries the install's Linear workspace and team keys", () => {
    const context = botAnswerBareRefContext({ env: {}, home: homeWithLinearDirectory() });
    expect(context.linearWorkspaceSlug).toBe("acme-test");
    expect(context.linearTeamKeys).toEqual(["SUP", "INFR"]);
  });

  it("refuses the incident's bare pull-request numbers before they can post, naming each one", () => {
    const context = botAnswerBareRefContext({ env: {}, home: homeWithLinearDirectory() });
    const result = parseAnswerArm({
      context,
      env: {},
      raw: answerRaw({ bodyText: "the release was 16 PRs; #17254 and #17259 touch the request path" }),
    });
    expect(result.isErr()).toBe(true);
    const refusals = result.isErr() ? result.error : [];
    expect(refusals.length).toBe(2);
    expect(refusals[0]).toContain('body.0: "#17254" is a bare reference (renders as #17254) with no single repo');
    expect(refusals[0]).toContain('write it as "owner/repo#<number>", or put one full github.com/<owner>/<repo> link');
    expect(refusals[1]).toContain('body.0: "#17259" is a bare reference');
  });

  it("resolves the same numbers once the answer's own text names the repository in full", () => {
    const context = botAnswerBareRefContext({ env: {}, home: homeWithLinearDirectory() });
    const answer = unwrap(
      parseAnswerArm({
        context,
        env: {},
        raw: answerRaw({
          bodyText: "https://github.com/acme/acme-admin/pull/17254 and #17259 touch the request path",
        }),
      }),
    );
    expect(answer.body).toEqual([
      {
        runs: [
          {
            label: "https://github.com/acme/acme-admin/pull/17254",
            type: "link",
            url: "https://github.com/acme/acme-admin/pull/17254",
          },
          { text: " and ", type: "text" },
          { label: "#17259", type: "link", url: "https://github.com/acme/acme-admin/issues/17259" },
          { text: " touch the request path", type: "text" },
        ],
        type: "paragraph",
      },
    ]);
  });

  it("resolves an explicit owner/repo reference with no link beside it", () => {
    const context = botAnswerBareRefContext({ env: {}, home: homeWithLinearDirectory() });
    const answer = unwrap(
      parseAnswerArm({ context, env: {}, raw: answerRaw({ bodyText: "acme/acme-admin#17254 is the one" }) }),
    );
    expect(answer.body).toEqual([
      {
        runs: [
          {
            label: "acme/acme-admin#17254",
            type: "link",
            url: "https://github.com/acme/acme-admin/issues/17254",
          },
          { text: " is the one", type: "text" },
        ],
        type: "paragraph",
      },
    ]);
  });
});
