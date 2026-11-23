import { describe, expect, it } from "vitest";
import { endedLandingPr } from "../../../../../cli/commands/github/landingEnded.js";
import { EXIT_ERROR, EXIT_OK } from "../../../../../cli/exitCodes.js";
import { err, ok, type Result } from "../../../../../lib/result.js";
import { type GithubLiveError, GithubLiveErrors } from "../../../../../live/github/errors.js";
import type { PrClosure } from "../../../../../live/github/prClosure.js";

const URL_42 = "https://github.com/acme/widgets/pull/42";

/**
 * Run `endedLandingPr` over one canned closure read, collecting what it asked and printed.
 *
 * @param read what the fake ended-pull-request read answers
 * @param number the `--pr` value, undefined for the fleet read
 * @returns the settled exit code, the lines on each channel, and every read it asked for
 */
async function settle({
  read,
  number,
}: {
  read: Result<PrClosure, GithubLiveError>;
  number: number | undefined;
}): Promise<{
  readonly code: number | undefined;
  readonly out: readonly string[];
  readonly diagnostics: readonly string[];
  readonly asked: readonly string[];
}> {
  const out: string[] = [];
  const diagnostics: string[] = [];
  const asked: string[] = [];
  const code = await endedLandingPr({
    deps: {
      prClosure: (request) => {
        asked.push(`${request.repoSlug}#${String(request.number)} home=${String(request.home)}`);
        return Promise.resolve(read);
      },
      writeDiagnostic: (line) => diagnostics.push(line),
      writeOut: (line) => out.push(line),
    },
    home: "/fixture-home",
    number,
    slug: "acme/widgets",
  });
  return { asked, code, diagnostics, out };
}

describe("endedLandingPr", () => {
  it("settles a MERGED pull request with its merge commit and when it merged", async () => {
    const r = await settle({
      number: 42,
      read: ok({
        mergeCommitOid: "4b10e610d0aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        mergedAt: "2026-09-09T12:20:00Z",
        state: "MERGED",
        url: URL_42,
      }),
    });

    expect(r.code).toBe(EXIT_OK);
    expect(r.out).toEqual([
      `acme/widgets#42 has ended — ${URL_42} merged at 4b10e610d0aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa ` +
        "(2026-09-09T12:20:00Z) — so there is nothing to land",
    ]);
    expect(r.diagnostics).toEqual([]);
    expect(r.asked).toEqual(["acme/widgets#42 home=/fixture-home"]);
  });

  it("settles a CLOSED pull request with its close instant", async () => {
    const r = await settle({
      number: 42,
      read: ok({ closedAt: "2026-09-09T12:20:00Z", state: "CLOSED", url: URL_42 }),
    });

    expect(r.code).toBe(EXIT_OK);
    expect(r.out).toEqual([
      `acme/widgets#42 has ended — ${URL_42} closed unmerged at 2026-09-09T12:20:00Z — so there is nothing to land`,
    ]);
  });

  it("leaves an OPEN pull request to the landing read, printing nothing", async () => {
    const r = await settle({ number: 42, read: ok({ state: "OPEN", url: URL_42 }) });

    expect(r.code).toBe(undefined);
    expect(r.out).toEqual([]);
    expect(r.diagnostics).toEqual([]);
  });

  it("asks GitHub nothing and leaves the fleet read to run when no --pr was named", async () => {
    const r = await settle({
      number: undefined,
      read: ok({
        mergedAt: "2026-09-09T12:20:00Z",
        state: "MERGED",
        url: URL_42,
        mergeCommitOid: "4b10e610d0aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      }),
    });

    expect(r.code).toBe(undefined);
    expect(r.asked).toEqual([]);
    expect(r.out).toEqual([]);
  });

  it("refuses with exit 1 and names the cause when the state read fails", async () => {
    const r = await settle({ number: 42, read: err(GithubLiveErrors.readFailed({ message: "GitHub answered 502" })) });

    expect(r.code).toBe(EXIT_ERROR);
    expect(r.out).toEqual([]);
    expect(r.diagnostics).toEqual([
      "landing: could not read whether acme/widgets#42 is still open, so no landing row is printed for it: " +
        "GitHub answered 502",
    ]);
  });
});
