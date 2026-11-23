/**
 * `github pr release-reservation` — the operator's door onto a held create reservation.
 *
 * A `mkdtempSync` home is the sanctioned exception in `.claude/rules/testing.md`: the thing under test IS the
 * on-disk record, and every case asserts what the file says afterwards rather than only what was printed. The
 * client is injected as one function, because the verb reads exactly one endpoint and nothing here is a mock.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { errAsync, okAsync } from "neverthrow";
import { afterEach, describe, expect, it } from "vitest";

import type { GithubPrReleaseReservationDeps } from "../../../../../cli/commands/github/releaseReservationRun.js";
import { runGithubPrReleaseReservation } from "../../../../../cli/commands/github/releaseReservationRun.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import type { GithubWriteApi, WrittenPr } from "../../../../../corpus/github/write.js";
import { EXAMPLE_PR_FORM } from "../../../../../outbound/github/formExample.js";
import { confirmPr, locusOf, readPrRecord, reservePr } from "../../../../../outbound/github/prLedger.js";

const HTTP_ERROR = { kind: "http" as const, message: "other side closed", operation: "github.pulls.list" };
const TARGET = { base: "main", head: "a-branch", owner: "octo-self", repo: "slopweaver" };
const LOCUS = locusOf({ target: TARGET });
const ADDRESS = ["--repo", "octo-self/slopweaver", "--base", "main", "--head", "a-branch"] as const;

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

function tempHome(): string {
  const home = mkdtempSync(join(tmpdir(), "release-reservation-home-"));
  fixtureDirs.push(home);
  return home;
}

function pr({ number, state }: { number: number; state: string }): WrittenPr {
  return {
    authorId: 1,
    baseRef: "main",
    baseRepoFullName: "octo-self/slopweaver",
    body: "the body github holds",
    commits: undefined,
    draft: false,
    head: {
      label: "octo-self:a-branch",
      ref: "a-branch",
      repoFullName: "octo-self/slopweaver",
      sha: "a".repeat(40),
    },
    htmlUrl: `https://github.com/octo-self/slopweaver/pull/${String(number)}`,
    mergedAtIso: undefined,
    nodeId: `PR_${String(number)}`,
    number,
    stack: undefined,
    state,
    title: "a title",
    updatedAtIso: "2026-09-01T00:00:00Z",
  };
}

/** The injected edges, the heads each listing was asked for, and the two output channels kept apart. */
function harness({ listPrs, token = "a-token" }: { listPrs: GithubWriteApi["listPrs"]; token?: string | undefined }): {
  deps: GithubPrReleaseReservationDeps;
  errLines: string[];
  outLines: string[];
} {
  const outLines: string[] = [];
  const errLines: string[] = [];
  const resolvedToken = token === "" ? undefined : token;
  return {
    deps: {
      home: () => {
        throw new Error("unreachable: every case passes --home");
      },
      makeApi: () => ({ listPrs }),
      now: () => new Date("2026-08-24T02:25:00Z"),
      out: ({ line }) => {
        outLines.push(line);
      },
      token: () => resolvedToken,
      writeDiagnostic: ({ line }) => {
        errLines.push(line);
      },
    },
    errLines,
    outLines,
  };
}

describe("before any read", () => {
  it("prints the usage on an unusable address and touches nothing", async () => {
    const { deps, errLines } = harness({
      listPrs: () => {
        throw new Error("unreachable: the address never parsed");
      },
    });
    const code = await runGithubPrReleaseReservation({ deps, rest: ["--repo", "slopweaver"] });
    expect(code).toBe(EXIT_USAGE);
    expect(errLines.some((line) => line.includes("--base <ref> is required"))).toBe(true);
    expect(errLines.some((line) => line.includes("usage: slopweaver github pr release-reservation"))).toBe(true);
  });

  it("says there is no reservation, rather than reading GitHub about nothing", async () => {
    const home = tempHome();
    const { deps, outLines } = harness({
      listPrs: () => {
        throw new Error("unreachable: no record means nothing to verify");
      },
    });
    const code = await runGithubPrReleaseReservation({ deps, rest: [...ADDRESS, "--home", home] });
    expect(code).toBe(EXIT_OK);
    expect(outLines).toStrictEqual([`release-reservation: no reservation held for ${LOCUS}`]);
  });

  it("refuses a reservation that already carries a number, because that one is not stranded", async () => {
    const home = tempHome();
    reservePr({ home, locus: LOCUS, nowIso: "2026-08-01T00:00:00Z" });
    confirmPr({
      form: { ...EXAMPLE_PR_FORM, target: TARGET },
      home,
      locus: LOCUS,
      nodeId: "PR_15",
      nowIso: "2026-08-01T00:05:00Z",
      number: 15,
      storedBody: "b",
    });
    const { deps, outLines } = harness({
      listPrs: () => {
        throw new Error("unreachable: a numbered record is the create path's own business");
      },
    });
    const code = await runGithubPrReleaseReservation({ deps, rest: [...ADDRESS, "--home", home] });
    expect(code).toBe(EXIT_OK);
    expect(outLines.some((line) => line.includes("is held for #15, which is not stranded"))).toBe(true);
    expect(readPrRecord({ home, locus: LOCUS })!.number).toBe(15);
  });

  it("refuses without a token, because the verdict depends on a read it cannot make", async () => {
    const home = tempHome();
    reservePr({ home, locus: LOCUS, nowIso: "2026-08-24T02:20:00Z" });
    const { deps, errLines } = harness({
      listPrs: () => {
        throw new Error("unreachable: there is no token to build a client with");
      },
      token: "",
    });
    const code = await runGithubPrReleaseReservation({ deps, rest: [...ADDRESS, "--home", home] });
    expect(code).toBe(EXIT_ERROR);
    expect(errLines.some((line) => line.includes("no GitHub token"))).toBe(true);
    expect(readPrRecord({ home, locus: LOCUS })!.reservedIso).toBe("2026-08-24T02:20:00Z");
  });
});

describe("settling a numberless reservation against the branch pair", () => {
  it("releases the record when GitHub reports nothing on the pair", async () => {
    const home = tempHome();
    reservePr({ home, locus: LOCUS, nowIso: "2026-08-24T02:20:00Z" });
    const { deps, outLines } = harness({ listPrs: () => okAsync([]) });
    const code = await runGithubPrReleaseReservation({ deps, rest: [...ADDRESS, "--home", home] });
    expect(code).toBe(EXIT_OK);
    expect(outLines.some((line) => line.includes("GitHub reports no pull request on these branches"))).toBe(true);
    expect(readPrRecord({ home, locus: LOCUS })).toBeUndefined();
  });

  it("qualifies the head with the owner, because GitHub ignores a bare ref", async () => {
    const home = tempHome();
    reservePr({ home, locus: LOCUS, nowIso: "2026-08-24T02:20:00Z" });
    const heads: string[] = [];
    const { deps } = harness({
      listPrs: ({ head }) => {
        heads.push(head);
        return okAsync([]);
      },
    });
    await runGithubPrReleaseReservation({ deps, rest: [...ADDRESS, "--home", home] });
    expect(heads).toStrictEqual(["octo-self:a-branch"]);
  });

  it("does NOT release an open pull request's locus — it recovers the number onto the record instead", async () => {
    const home = tempHome();
    reservePr({ home, locus: LOCUS, nowIso: "2026-08-24T02:20:00Z" });
    const { deps, outLines } = harness({ listPrs: () => okAsync([pr({ number: 4242, state: "open" })]) });
    const code = await runGithubPrReleaseReservation({ deps, rest: [...ADDRESS, "--home", home] });
    expect(code).toBe(EXIT_OK);
    expect(outLines.some((line) => line.includes("was NOT released — #4242 is open on these branches"))).toBe(true);
    const record = readPrRecord({ home, locus: LOCUS })!;
    expect(record.number).toBe(4242);
    expect(record.nodeId).toBe("PR_4242");
    expect(record.confirmedIso).toBe("2026-08-24T02:25:00.000Z");
  });

  it("recovers a CLOSED pull request's number too, so the create path releases it on the next attempt", async () => {
    const home = tempHome();
    reservePr({ home, locus: LOCUS, nowIso: "2026-08-24T02:20:00Z" });
    const { deps, outLines } = harness({ listPrs: () => okAsync([pr({ number: 4242, state: "closed" })]) });
    const code = await runGithubPrReleaseReservation({ deps, rest: [...ADDRESS, "--home", home] });
    expect(code).toBe(EXIT_OK);
    expect(outLines.some((line) => line.includes("recovered #4242 onto the reservation"))).toBe(true);
    expect(readPrRecord({ home, locus: LOCUS })!.number).toBe(4242);
  });

  it("refuses an ambiguous pair and leaves the record exactly as it found it", async () => {
    const home = tempHome();
    reservePr({ home, locus: LOCUS, nowIso: "2026-08-24T02:20:00Z" });
    const { deps, errLines } = harness({
      listPrs: () => okAsync([pr({ number: 1, state: "closed" }), pr({ number: 2, state: "open" })]),
    });
    const code = await runGithubPrReleaseReservation({ deps, rest: [...ADDRESS, "--home", home] });
    expect(code).toBe(EXIT_ERROR);
    expect(errLines.some((line) => line.includes("GitHub reports at least 2 pull requests on these branches"))).toBe(
      true,
    );
    expect(readPrRecord({ home, locus: LOCUS })).toStrictEqual({
      locus: LOCUS,
      reservedIso: "2026-08-24T02:20:00Z",
    });
  });

  it("refuses when the verifying read fails, carrying the provider's own message", async () => {
    const home = tempHome();
    reservePr({ home, locus: LOCUS, nowIso: "2026-08-24T02:20:00Z" });
    const { deps, errLines } = harness({ listPrs: () => errAsync(HTTP_ERROR) });
    const code = await runGithubPrReleaseReservation({ deps, rest: [...ADDRESS, "--home", home] });
    expect(code).toBe(EXIT_ERROR);
    expect(errLines.some((line) => line.includes("other side closed"))).toBe(true);
    expect(readPrRecord({ home, locus: LOCUS })).toStrictEqual({
      locus: LOCUS,
      reservedIso: "2026-08-24T02:20:00Z",
    });
  });
});
