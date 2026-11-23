/**
 * `audit publications` over injected edges: a synthetic repository answered by a plain-function seam, synthetic
 * private terms, a throwaway home. What it prints is counts — never a matched term, never a finding's link — and it
 * exits 0 only for a complete read with no finding and every expectation met.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { parseAuditPublicationsArgs } from "../../../../../cli/commands/audit/publicationsArgs.js";
import { type AuditPublicationsDeps, runAuditPublications } from "../../../../../cli/commands/audit/publicationsRun.js";
import { AUDIT_PUBLICATIONS_USAGE } from "../../../../../cli/commands/audit/publicationsUsage.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { SOURCE_REPOSITORY } from "../../../../../hygiene/ownRepository.js";
import { parsePrivateTerms } from "../../../../../hygiene/privateTerms.js";
import { err, ok, unwrap, unwrapErr } from "../../../../../lib/result.js";
import { readLatestPublicationAudit } from "../../../../../live/publicationAudit/store.js";
import {
  doorCoverage,
  type PublicationDoor,
  type PublicationRead,
} from "../../../../../live/publicationAudit/types.js";

const REPO = "https://github.com/acme/widgets";
const TERM = "glimmerfund";
const SESSION = "0123abcd-4567-89ab-cdef-0123456789ab";
const TERMS = unwrap(parsePrivateTerms({ text: `class\tflags\tpattern\tsource\nmoney\ti\t${TERM}\tsynthetic\n` }));

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "pubrun-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** A door that read nothing and missed nothing: complete and empty. */
const emptyDoor = ({ door }: { door: PublicationDoor }): PublicationRead => ({
  coverage: doorCoverage({ attachmentsNotSwept: 0, door, gaps: [], objects: 0, texts: 0 }),
  texts: [],
});

/** Edges answering a fixed set of pulls, recording what was printed and every monitor pass fired. */
function deps({
  pulls,
  issuesFail = false,
  fireExit = EXIT_OK,
}: {
  pulls: unknown[];
  issuesFail?: boolean;
  fireExit?: number;
}): {
  deps: AuditPublicationsDeps;
  out: string[];
  diagnostics: string[];
  fired: string[];
} {
  const out: string[] = [];
  const diagnostics: string[] = [];
  const fired: string[] = [];
  return {
    deps: {
      denylist: () => ({ kind: "absent" }),
      firePublicationLeak: ({ bySession, home: firedHome }) => {
        fired.push(`${bySession} ${String(firedHome === home)}`);
        return Promise.resolve(fireExit);
      },
      home: () => home,
      readLinear: () => Promise.resolve(emptyDoor({ door: "linear" })),
      readNotion: () => Promise.resolve(emptyDoor({ door: "notion" })),
      readSlack: () => Promise.resolve(emptyDoor({ door: "slack" })),
      makeSeam: () => ({
        get: ({ call, params }) => {
          if (params["page"] !== 1) {
            return Promise.resolve(ok([]));
          }
          if (call === "issues" && issuesFail) {
            return Promise.resolve(err({ message: "synthetic outage", status: 502 }));
          }
          return Promise.resolve(ok(call === "pulls" ? pulls : []));
        },
        graphql: () => Promise.resolve(err({ message: "unused", status: undefined })),
      }),
      nonce: () => "abcd1234",
      nowIso: () => "2026-11-20T02:00:00.000Z",
      out: ({ line }) => {
        out.push(line);
      },
      privateTerms: () => ok(TERMS),
      token: () => "synthetic-token",
      writeDiagnostic: ({ line }) => {
        diagnostics.push(line);
      },
    },
    diagnostics,
    fired,
    out,
  };
}

const LEAKY = [
  { body: `session ${SESSION} resumed`, html_url: `${REPO}/pull/46`, number: 46, title: "a fix" },
  { body: `pays into ${TERM}`, html_url: `${REPO}/pull/57`, number: 57, title: "another fix" },
];

describe("parseAuditPublicationsArgs", () => {
  it("defaults to the own repository with no expectation", () => {
    const [owner, repo] = SOURCE_REPOSITORY.split("/");
    expect(unwrap(parseAuditPublicationsArgs({ rest: [] }))).toEqual({
      expectations: [],
      fireAs: undefined,
      home: undefined,
      json: false,
      owner,
      repo,
    });
  });

  it("refuses a malformed --repo and a malformed --expect, each by name", () => {
    expect(unwrapErr(parseAuditPublicationsArgs({ rest: ["--repo", "acme"] }))).toEqual(["--repo takes owner/repo"]);
    expect(unwrapErr(parseAuditPublicationsArgs({ rest: ["--expect", "github:money"] }))).toEqual([
      "--expect takes <door>:<class>:<link>, e.g. github:private-term/money:<pull request address>",
    ]);
  });

  it("pairs --fire with --by-session, refusing either alone", () => {
    expect(unwrap(parseAuditPublicationsArgs({ rest: ["--fire", "--by-session", "recipe:x"] })).fireAs).toBe(
      "recipe:x",
    );
    expect(unwrapErr(parseAuditPublicationsArgs({ rest: ["--fire"] }))).toEqual([
      "--fire takes --by-session <session>: every card the pass writes names who ran it",
    ]);
    expect(unwrapErr(parseAuditPublicationsArgs({ rest: ["--by-session", "recipe:x"] }))).toEqual([
      "--by-session names who fires the monitor pass, so it goes with --fire",
    ]);
  });
});

describe("runAuditPublications", () => {
  it("finds both synthetic hits, prints counts only, meets both expectations, and exits 1 because something was found", async () => {
    const edges = deps({ pulls: LEAKY });
    const code = await runAuditPublications({
      deps: edges.deps,
      rest: [
        "--repo",
        "acme/widgets",
        "--expect",
        `github:installation-state/session-id:${REPO}/pull/46`,
        "--expect",
        `github:private-term/money:${REPO}/pull/57`,
      ],
    });
    expect(code).toBe(EXIT_ERROR);
    expect(edges.out).toEqual([
      "publication audit — read 2026-11-20T02:00:00.000Z",
      "  github: complete — 2 object(s), 4 text(s), 0 uploaded file(s) not swept",
      "  slack: complete — 0 object(s), 0 text(s), 0 uploaded file(s) not swept",
      "  linear: complete — 0 object(s), 0 text(s), 0 uploaded file(s) not swept",
      "  notion: complete — 0 object(s), 0 text(s), 0 uploaded file(s) not swept",
      "findings: 2",
      "  github installation-state/session-id: 1",
      "  github private-term/money: 1",
      "  by field: body 2",
      "expectations: 2 of 2 met",
      "report: evidence/publication-audit/20261120T020000000Z-abcd1234",
    ]);
    const printed = [...edges.out, ...edges.diagnostics].join("\n");
    expect(LEAKY.map((pull) => pull.body).join("\n")).toContain(TERM);
    expect([printed.includes(TERM), printed.includes(SESSION), printed.includes(`${REPO}/pull/`)]).toEqual([
      false,
      false,
      false,
    ]);
  });

  it("writes the sanitised report the monitor reads, with no matched text in any file", async () => {
    await runAuditPublications({ deps: deps({ pulls: LEAKY }).deps, rest: ["--repo", "acme/widgets"] });
    const report = unwrap(readLatestPublicationAudit({ home }));
    expect(report.findings.map((finding) => [finding.className, finding.link])).toEqual([
      ["installation-state/session-id", `${REPO}/pull/46`],
      ["private-term/money", `${REPO}/pull/57`],
    ]);
    const latest = readFileSync(join(home, "evidence", "publication-audit", "latest.json"), "utf8");
    expect([latest.includes(TERM), latest.includes(SESSION)]).toEqual([false, false]);
  });

  it("exits 0 for a complete clean read, and 1 for a missed expectation on the same read", async () => {
    const clean = [{ body: "nothing here", html_url: `${REPO}/pull/1`, number: 1, title: "clean" }];
    expect(await runAuditPublications({ deps: deps({ pulls: clean }).deps, rest: ["--repo", "acme/widgets"] })).toBe(
      EXIT_OK,
    );
    const edges = deps({ pulls: clean });
    const code = await runAuditPublications({
      deps: edges.deps,
      rest: ["--repo", "acme/widgets", "--expect", `github:private-term/money:${REPO}/pull/1`],
    });
    expect(code).toBe(EXIT_ERROR);
    expect(edges.out).toContain("expectations: 0 of 1 met (missed: #1)");
  });

  it("exits 1 on a partial read with nothing found, naming the gap by its fixed label", async () => {
    const edges = deps({ issuesFail: true, pulls: [] });
    expect(await runAuditPublications({ deps: edges.deps, rest: ["--repo", "acme/widgets"] })).toBe(EXIT_ERROR);
    expect(edges.out).toContain("    gap: issues: read failed");
    expect(edges.out.join("\n")).not.toContain("synthetic outage");
  });

  it("judges every door's texts in one pass, so a Slack hit is a finding beside GitHub's", async () => {
    const edges = deps({ pulls: [] });
    const slack: PublicationRead = {
      coverage: doorCoverage({ attachmentsNotSwept: 0, door: "slack", gaps: [], objects: 1, texts: 1 }),
      texts: [
        {
          door: "slack",
          field: "text",
          link: "https://acme.slack.com/archives/C1/p1",
          linkCarriesNoText: false,
          objectKey: "message C1 1",
          text: `paid from ${TERM}`,
        },
      ],
    };
    const code = await runAuditPublications({
      deps: { ...edges.deps, readSlack: () => Promise.resolve(slack) },
      rest: ["--repo", "acme/widgets"],
    });
    expect(code).toBe(EXIT_ERROR);
    expect(unwrap(readLatestPublicationAudit({ home })).counts).toEqual({ slack: { "private-term/money": 1 } });
    expect(edges.out.join("\n").includes(TERM)).toBe(false);
  });

  it("exits 1 on a clean read when any one door is partial, and reads the others when GitHub has no token", async () => {
    const edges = deps({ pulls: [] });
    const code = await runAuditPublications({
      deps: { ...edges.deps, token: () => undefined },
      rest: ["--repo", "acme/widgets"],
    });
    expect(code).toBe(EXIT_ERROR);
    expect(edges.out.slice(1, 4)).toEqual([
      "  github: partial — 0 object(s), 0 text(s), 0 uploaded file(s) not swept",
      "    gap: credential missing",
      "  slack: complete — 0 object(s), 0 text(s), 0 uploaded file(s) not swept",
    ]);
  });

  it("fires the publication-leak pass over a firing report, and exits 3: the run worked, the report is not clean", async () => {
    const edges = deps({ pulls: LEAKY });
    const code = await runAuditPublications({
      deps: edges.deps,
      rest: ["--repo", "acme/widgets", "--fire", "--by-session", "recipe:publication-audit-daily"],
    });
    expect([code, edges.fired]).toEqual([EXIT_EXPECTED_EMPTY, ["recipe:publication-audit-daily true"]]);
    expect(unwrap(readLatestPublicationAudit({ home })).findings).toHaveLength(2);
  });

  it("never exits 0 on a fired run over a door read only in part, even with no finding", async () => {
    const edges = deps({ pulls: [] });
    const absent: PublicationRead = {
      coverage: doorCoverage({
        attachmentsNotSwept: 0,
        door: "slack",
        gaps: ["message not found or not visible"],
        objects: 0,
        texts: 0,
      }),
      texts: [],
    };
    const code = await runAuditPublications({
      deps: { ...edges.deps, readSlack: () => Promise.resolve(absent) },
      rest: ["--repo", "acme/widgets", "--fire", "--by-session", "recipe:x"],
    });
    expect([code, edges.fired.length]).toEqual([EXIT_EXPECTED_EMPTY, 1]);
  });

  it("exits 0 on a fired run only when every door read whole and nothing was found", async () => {
    const clean = [{ body: "nothing here", html_url: `${REPO}/pull/1`, number: 1, title: "clean" }];
    const edges = deps({ pulls: clean });
    const code = await runAuditPublications({
      deps: edges.deps,
      rest: ["--repo", "acme/widgets", "--fire", "--by-session", "recipe:x"],
    });
    expect([code, edges.fired.length]).toEqual([EXIT_OK, 1]);
  });

  it("still exits 1 on a fired run that missed an expectation", async () => {
    const edges = deps({ pulls: [] });
    const code = await runAuditPublications({
      deps: edges.deps,
      rest: [
        "--repo",
        "acme/widgets",
        "--expect",
        `github:private-term/money:${REPO}/pull/1`,
        "--fire",
        "--by-session",
        "x",
      ],
    });
    expect([code, edges.fired.length]).toEqual([EXIT_ERROR, 1]);
  });

  it("fires nothing without --fire, and a failed pass turns a fired run's exit to 1", async () => {
    const clean = [{ body: "nothing here", html_url: `${REPO}/pull/1`, number: 1, title: "clean" }];
    const quiet = deps({ pulls: clean });
    expect(await runAuditPublications({ deps: quiet.deps, rest: ["--repo", "acme/widgets"] })).toBe(EXIT_OK);
    expect(quiet.fired).toEqual([]);
    const failing = deps({ fireExit: EXIT_ERROR, pulls: clean });
    const code = await runAuditPublications({
      deps: failing.deps,
      rest: ["--repo", "acme/widgets", "--fire", "--by-session", "recipe:x"],
    });
    expect([code, failing.fired.length]).toEqual([EXIT_ERROR, 1]);
    expect(failing.diagnostics.at(-1)).toContain("the publication-leak pass exited 1");
  });

  it("refuses fail-closed when the private terms cannot be read, writing no report", async () => {
    const edges = deps({ pulls: LEAKY });
    const code = await runAuditPublications({
      deps: { ...edges.deps, privateTerms: () => err("private terms unreadable") },
      rest: ["--repo", "acme/widgets"],
    });
    expect([code, edges.diagnostics, edges.out]).toEqual([EXIT_ERROR, ["private terms unreadable"], []]);
    expect(unwrapErr(readLatestPublicationAudit({ home })).code).toBe("REPORT_ABSENT");
  });

  it("refuses a usage error before any read, usage last", async () => {
    const edges = deps({ pulls: LEAKY });
    expect(await runAuditPublications({ deps: edges.deps, rest: ["--repo", "acme"] })).toBe(EXIT_USAGE);
    expect(edges.diagnostics).toEqual(["--repo takes owner/repo", AUDIT_PUBLICATIONS_USAGE]);
  });

  it("prints the counts as one JSON document under --json, still with no finding in it", async () => {
    const edges = deps({ pulls: LEAKY });
    await runAuditPublications({ deps: edges.deps, rest: ["--repo", "acme/widgets", "--json"] });
    const document = JSON.parse(edges.out.join("\n")) as Record<string, unknown>;
    expect([document["findings"], document["counts"], document["expectationsMet"]]).toEqual([
      2,
      { github: { "installation-state/session-id": 1, "private-term/money": 1 } },
      [],
    ]);
    expect(edges.out.join("\n").includes(`${REPO}/pull/`)).toBe(false);
  });
});
