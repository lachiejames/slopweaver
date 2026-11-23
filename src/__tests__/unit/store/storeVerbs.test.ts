/**
 * The `store` verbs' shell, exercised on the paths that reach no database.
 *
 * Every verb here is dispatched through its real entry point rather than through its parser, which is the
 * property `manifest-loader-tests` is protecting: a command module the CLI can dispatch and no test ever
 * imports is "shipped but wired to nothing", and that is invisible to the whole suite.
 *
 * Two paths are reachable with no Postgres and they are the two that matter most before one exists. Every
 * verb refuses without `SLOPWEAVER_STORE_URL`, because a tool that picks its own database is a tool that
 * can run against the wrong one. And every verb answers `--help` with its usage without touching anything,
 * which is what `dryParseSafe` claims in the manifest — a claim nothing else checks.
 *
 * The variable is captured and restored around each case rather than assumed absent: this file runs beside
 * others in the same worker, and a leaked environment variable would make the refusals below pass or fail
 * for a reason that has nothing to do with the code.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runStoreCite } from "../../../cli/commands/store/cite.js";
import { runStoreIngest } from "../../../cli/commands/store/ingestRun.js";
import { runStoreLoad } from "../../../cli/commands/store/load.js";
import { runStoreCollect, runStoreRead } from "../../../cli/commands/store/read.js";
import { runStoreDetail, runStoreFacets, runStoreQuery } from "../../../cli/commands/store/run.js";
import { runStoreStatus } from "../../../cli/commands/store/statusRun.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../cli/exitCodes.js";
import { STORE_URL_ENV } from "../../../store/client.js";

/** The verbs, each with the argv that reaches it, so every case runs against all of them. */
const VERBS = [
  { argv: ["node", "cli", "store", "query"], name: "query", run: runStoreQuery },
  { argv: ["node", "cli", "store", "facets"], name: "facets", run: runStoreFacets },
  { argv: ["node", "cli", "store", "detail", "--source", "slack", "--id", "x"], name: "detail", run: runStoreDetail },
  {
    argv: ["node", "cli", "store", "ingest", "--file", "a.jsonl", "--limit", "1"],
    name: "ingest",
    run: runStoreIngest,
  },
  { argv: ["node", "cli", "store", "status"], name: "status", run: runStoreStatus },
  { argv: ["node", "cli", "store", "read", "a question"], name: "read", run: runStoreRead },
  { argv: ["node", "cli", "store", "load"], name: "load", run: runStoreLoad },
  { argv: ["node", "cli", "store", "cite", "a question"], name: "cite", run: runStoreCite },
] as const;

describe("every store verb refuses to pick its own database", () => {
  let saved: string | undefined;

  beforeEach(() => {
    saved = process.env[STORE_URL_ENV];
    delete process.env[STORE_URL_ENV];
  });

  afterEach(() => {
    if (saved === undefined) {
      delete process.env[STORE_URL_ENV];
      return;
    }
    process.env[STORE_URL_ENV] = saved;
  });

  it.each(VERBS)("$name refuses with no connection string", async ({ argv, run }) => {
    expect(await run(argv)).toBe(EXIT_ERROR);
  });
});

describe("every store verb answers --help without reaching anything", () => {
  let saved: string | undefined;

  beforeEach(() => {
    saved = process.env[STORE_URL_ENV];
    delete process.env[STORE_URL_ENV];
  });

  afterEach(() => {
    if (saved === undefined) {
      delete process.env[STORE_URL_ENV];
      return;
    }
    process.env[STORE_URL_ENV] = saved;
  });

  it.each(VERBS)("$name prints usage and exits clean", async ({ argv, run }) => {
    expect(await run([...argv, "--help"])).toBe(EXIT_OK);
  });
});

describe("a refused query never opens a connection", () => {
  let saved: string | undefined;

  beforeEach(() => {
    saved = process.env[STORE_URL_ENV];
    delete process.env[STORE_URL_ENV];
  });

  afterEach(() => {
    if (saved === undefined) {
      delete process.env[STORE_URL_ENV];
      return;
    }
    process.env[STORE_URL_ENV] = saved;
  });

  it("refuses a misspelled source as a USAGE error, not as an unreachable store", async () => {
    expect(await runStoreQuery(["node", "cli", "store", "query", "--source", "slak"])).toBe(EXIT_USAGE);
  });

  it("refuses a facet the store does not group by, before the connection is even attempted", async () => {
    expect(await runStoreFacets(["node", "cli", "store", "facets", "--facet", "body"])).toBe(EXIT_USAGE);
  });

  it("refuses an ingest with no ceiling", async () => {
    expect(await runStoreIngest(["node", "cli", "store", "ingest", "--file", "a.jsonl"])).toBe(EXIT_USAGE);
  });

  it("refuses a fan-out with no question, because a reader needs something to read FOR", async () => {
    expect(await runStoreRead(["node", "cli", "store", "read"])).toBe(EXIT_USAGE);
  });

  it("refuses a cite with no question, because there is nothing to select records FOR", async () => {
    expect(await runStoreCite(["node", "cli", "store", "cite"])).toBe(EXIT_USAGE);
  });

  it("refuses a load naming a platform it cannot pull", async () => {
    expect(await runStoreLoad(["node", "cli", "store", "load", "--source", "fathom"])).toBe(EXIT_USAGE);
  });

  it("refuses a load whose depth is not a number, rather than silently taking the default", async () => {
    expect(await runStoreLoad(["node", "cli", "store", "load", "--days", "seven"])).toBe(EXIT_USAGE);
  });
});

describe("collect reaches no database at all, and says what it could not read", () => {
  it("answers --help clean", () => {
    expect(runStoreCollect(["node", "cli", "store", "collect", "--help"])).toBe(EXIT_OK);
  });

  it("refuses without both a plan and the replies to check against it", () => {
    expect(runStoreCollect(["node", "cli", "store", "collect", "--plan", "p.json"])).toBe(EXIT_USAGE);
  });

  it("refuses a plan path that is not there, naming the path rather than reading as an empty harvest", () => {
    expect(
      runStoreCollect([
        "node",
        "cli",
        "store",
        "collect",
        "--plan",
        "/nonexistent/plan.json",
        "--replies",
        "/nonexistent/replies.json",
      ]),
    ).toBe(EXIT_USAGE);
  });
});
