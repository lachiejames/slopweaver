/**
 * `org show|set` over injected seams: what each prints, the exit code each refusal earns, and that `set` hands the
 * store the record its flags stated — validated first, so a bad flag reaches no write at all.
 */
import { describe, expect, it } from "vitest";

import { type OrgRunDeps, runOrgSetWith, runOrgShowWith } from "../../../../../cli/commands/org/run.js";
import { ORG_SET_USAGE, ORG_SHOW_USAGE } from "../../../../../cli/commands/org/usage.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { err, ok, type Result } from "../../../../../lib/result.js";
import type { Organisation, OrganisationRecord } from "../../../../../organisation/core.js";
import { type OrganisationError, OrganisationErrors } from "../../../../../organisation/errors.js";
import { ACME_ORGANISATION, FIXTURE_SELF_REPOSITORY, GLOBEX_ORGANISATION } from "../../../../organisationFixture.js";

const HOME = "/fixture/home";

/** A recording harness: every line printed, every diagnostic, and every read and write the verb asked for. */
function harness({
  read = ok(ACME_ORGANISATION),
  write,
}: { read?: Result<Organisation, OrganisationError>; write?: OrganisationError } = {}): {
  deps: OrgRunDeps;
  out: string[];
  errs: string[];
  reads: string[];
  writes: { home: string; record: OrganisationRecord }[];
} {
  const out: string[] = [];
  const errs: string[] = [];
  const reads: string[] = [];
  const writes: { home: string; record: OrganisationRecord }[] = [];
  const deps: OrgRunDeps = {
    err: ({ msg }) => {
      errs.push(msg);
    },
    out: ({ line }) => {
      out.push(line);
    },
    readOrganisation: ({ home }) => {
      reads.push(home);
      return Promise.resolve(read);
    },
    writeOrganisation: ({ home, record }) => {
      writes.push({ home, record });
      if (write !== undefined) {
        return Promise.resolve(err(write));
      }
      return Promise.resolve(
        ok({
          ...record,
          revision: 4,
          selfRepository: FIXTURE_SELF_REPOSITORY,
          updatedAtIso: "2026-10-30T01:00:00.000Z",
        }),
      );
    },
  };
  return { deps, errs, out, reads, writes };
}

const GLOBEX_SET = [
  "--display-name",
  "Globex",
  "--github-owner",
  "globex",
  "--without-google",
  "--slack-host",
  "globex.slack.com",
  "--slack-host",
  "globex-eng.slack.com",
  "--without-linear",
  "--without-vanta",
  "--repository",
  "globex/web",
  "--repository",
  "globex/api",
  "--home",
  HOME,
];

describe("org show", () => {
  it("prints the organisation the read returned as one JSON document, read under the named home", async () => {
    const run = harness({ read: ok(GLOBEX_ORGANISATION) });
    const code = await runOrgShowWith({ deps: run.deps, rest: ["--json", "--home", HOME] });
    expect(code).toBe(EXIT_OK);
    expect(run.reads).toEqual([HOME]);
    expect(run.out.map((line) => JSON.parse(line) as unknown)).toEqual([GLOBEX_ORGANISATION]);
    expect(run.errs).toEqual([]);
  });

  it("prints one line per field for a person, opening on the name and revision", async () => {
    const run = harness();
    expect(await runOrgShowWith({ deps: run.deps, rest: ["--home", HOME] })).toBe(EXIT_OK);
    expect(run.out[0]).toBe("organisation Acme (revision 1, 2026-10-30T00:00:00.000Z)");
    expect(run.out.length).toBe(9);
  });

  it("reads an install that never ran `org set` as expected-empty, naming the command", async () => {
    const run = harness({ read: err(OrganisationErrors.notConfigured({ missing: "organisation" })) });
    expect(await runOrgShowWith({ deps: run.deps, rest: ["--home", HOME] })).toBe(EXIT_EXPECTED_EMPTY);
    expect(run.out).toEqual([]);
    expect(run.errs.length).toBe(1);
    expect(run.errs[0]).toContain("slopweaver org set");
  });

  it("fails on any other refusal — a fault, not an absence", async () => {
    const run = harness({ read: err(OrganisationErrors.selfUnresolved({ reasons: ["no origin"] })) });
    expect(await runOrgShowWith({ deps: run.deps, rest: ["--home", HOME] })).toBe(EXIT_ERROR);
    expect(run.errs).toEqual(["this build's own repository could not be read off its checkout's origin: no origin"]);
  });

  it("refuses an unknown flag with the usage, before any read", async () => {
    const run = harness();
    expect(await runOrgShowWith({ deps: run.deps, rest: ["--bogus"] })).toBe(EXIT_USAGE);
    expect(run.reads).toEqual([]);
    expect(run.errs.at(-1)).toBe(ORG_SHOW_USAGE);
  });
});

describe("org set", () => {
  it("writes exactly the record its flags stated and prints the row the write returned", async () => {
    const run = harness();
    const code = await runOrgSetWith({ deps: run.deps, rest: [...GLOBEX_SET, "--json"] });
    expect(code).toBe(EXIT_OK);
    expect(run.writes).toEqual([
      {
        home: HOME,
        record: {
          dependencyBots: [],
          displayName: "Globex",
          githubOwner: "globex",
          googleDomain: null,
          linearWorkspace: null,
          repositories: ["globex/web", "globex/api"],
          slackHosts: ["globex.slack.com", "globex-eng.slack.com"],
          vantaWorkspace: null,
        },
      },
    ]);
    expect(run.out.map((line) => JSON.parse(line) as unknown)).toEqual([
      { ...GLOBEX_ORGANISATION, revision: 4, updatedAtIso: "2026-10-30T01:00:00.000Z" },
    ]);
  });

  it("writes an organisation with no Slack as zero hosts, and prints that it has none", async () => {
    const run = harness();
    const rest = [
      ...GLOBEX_SET.filter((one) => one !== "--slack-host" && !one.endsWith(".slack.com")),
      "--without-slack",
    ];
    expect(await runOrgSetWith({ deps: run.deps, rest })).toBe(EXIT_OK);
    expect(run.writes.map((write) => write.record.slackHosts)).toEqual([[]]);
    expect(run.out[3]).toBe("  slack hosts       (none — the organisation has no Slack)");
    expect(run.errs).toEqual([]);
  });

  it("fails a write the store refused, printing nothing as written", async () => {
    const run = harness({ write: OrganisationErrors.conflict({ actual: 3, expected: 2 }) });
    expect(await runOrgSetWith({ deps: run.deps, rest: GLOBEX_SET })).toBe(EXIT_ERROR);
    expect(run.out).toEqual([]);
    expect(run.errs.length).toBe(1);
    expect(run.errs[0]).toContain("moved from revision 2 to 3");
  });

  it("refuses an incomplete record with the usage, before any write", async () => {
    const run = harness();
    expect(await runOrgSetWith({ deps: run.deps, rest: ["--display-name", "Globex", "--home", HOME] })).toBe(
      EXIT_USAGE,
    );
    expect(run.writes).toEqual([]);
    expect(run.errs.at(-1)).toBe(ORG_SET_USAGE);
  });
});
