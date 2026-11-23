/**
 * `atlas github report` over injected edges: one ordered event log of every read, stdout line and stderr
 * line, so each case pins exactly what the verb did, in what order, and the exit code it graded it as.
 *
 * The generation is built from every kind's empty file, with the two kinds this verb reads filled per case:
 * one declared operation the installed client lacks, one it exposes, one web request the description
 * declares and one it does not.
 */
import { describe, expect, it } from "vitest";

import type { GithubRestOperation, GithubWebRequest } from "../../../../../atlas/github/entities.js";
import { emptyGithubKindFiles, type GithubKindFile } from "../../../../../atlas/github/kindFiles.js";
import { GITHUB_SCHEMA_VERSION, type GithubKind } from "../../../../../atlas/github/model.js";
import { type GithubAtlasReportDeps, runGithubAtlasReport } from "../../../../../cli/commands/githubAtlas/reportRun.js";
import { err, ok, type Result } from "../../../../../lib/result.js";

const USAGE = "usage: slopweaver atlas github report [--json] [--home <dir>]";
const AT = "2026-09-05T00:00:00.000Z";
const SOURCE = {
  artifacts: [],
  deepLink: null,
  deepLinkStatus: "unavailable" as const,
  endpoint: "@octokit/openapi-types",
  observedAt: AT,
  surface: "rest-openapi",
};

type Files = Readonly<Record<GithubKind, GithubKindFile | null>>;

/** The process argv for `slopweaver atlas github report <tail…>`. */
function argvOf({ tail }: { tail: readonly string[] }): readonly string[] {
  return ["node", "slopweaver", "atlas", "github", "report", ...tail];
}

/** One stored operation, exposed by the installed client or not. */
function operation({ route, sdkMethod }: { route: string; sdkMethod: string | null }): GithubRestOperation {
  const [method = "GET", path = "/"] = route.split(" ");
  return {
    documentationUrl: null,
    firstSeenAt: AT,
    id: route,
    method,
    mutating: false,
    operationId: `op${path}`,
    pathParams: [],
    pathTemplate: path,
    providerId: route,
    queryParams: [],
    responseFields: [],
    responseSchema: null,
    sdkMethod,
    source: SOURCE,
    state: "observed",
    summary: "Example",
  };
}

/** One observed web request, declared in the description or not. */
function request({ pathShape, declared }: { pathShape: string; declared: boolean }): GithubWebRequest {
  return {
    callability: "browser-observed-only",
    declaredInOpenApi: declared,
    firstSeenAt: AT,
    id: pathShape,
    method: "GET",
    observedOnPages: ["/settings/profile", "/settings/admin"],
    paramNames: [],
    pathShape,
    providerId: `GET ${pathShape}`,
    responseFieldPaths: ["a", "b", "c"],
    source: { ...SOURCE, surface: "github-web" },
    state: "observed",
    statusCodes: [200],
  };
}

/** Every kind's empty file, with the operation and request files holding the given entities. */
function generation({
  operations,
  requests,
}: {
  operations: readonly GithubRestOperation[];
  requests: readonly GithubWebRequest[];
}): Files {
  const restFile: GithubKindFile = {
    coverage: [],
    entities: [...operations],
    gaps: [],
    kind: "rest-operation",
    schemaVersion: GITHUB_SCHEMA_VERSION,
    updatedAt: AT,
  };
  const webFile: GithubKindFile = {
    coverage: [],
    entities: [...requests],
    gaps: [],
    kind: "web-request",
    schemaVersion: GITHUB_SCHEMA_VERSION,
    updatedAt: AT,
  };
  return { ...emptyGithubKindFiles({ at: AT }), "rest-operation": restFile, "web-request": webFile };
}

/** Both kinds holding entities, and neither in disagreement. */
const AGREEING = generation({
  operations: [operation({ route: "GET /orgs/{org}", sdkMethod: "orgs.get" })],
  requests: [request({ declared: true, pathShape: "/orgs/{org}" })],
});

/** Both kinds holding one disagreeing and one agreeing entity. */
const DISAGREEING = generation({
  operations: [
    operation({ route: "GET /orgs/{org}", sdkMethod: "orgs.get" }),
    operation({ route: "GET /orgs/{org}/hidden", sdkMethod: null }),
  ],
  requests: [
    request({ declared: true, pathShape: "/orgs/{org}" }),
    request({ declared: false, pathShape: "/_side-panels/user.json" }),
  ],
});

/** Deps whose read answers `read`, logging every call into one ordered list. */
function harness({ read }: { read: Result<{ files: Files }> }): { deps: GithubAtlasReportDeps; events: string[] } {
  const events: string[] = [];
  return {
    deps: {
      error: ({ msg }) => {
        events.push(`err: ${msg}`);
      },
      out: ({ line }) => {
        events.push(`out: ${line}`);
      },
      readAtlas: ({ paths }) => {
        events.push(`read: ${paths.home}`);
        return read;
      },
    },
    events,
  };
}

const DECLARED_DETAIL =
  "GitHub's published description declares op/orgs/{org}/hidden; the installed Octokit exposes no named method for it, so it is reachable only through request()";
const CALLED_DETAIL =
  "the first-party web client calls this on 2 page(s) and GitHub's published description declares no matching operation; it returned 3 distinct response field path(s)";

describe("runGithubAtlasReport", () => {
  it("refuses an unknown flag as usage, naming it then printing the usage, before any read", () => {
    const { deps, events } = harness({ read: ok({ files: DISAGREEING }) });

    expect(runGithubAtlasReport({ argv: argvOf({ tail: ["--nope"] }), deps })).toBe(2);
    expect(events).toEqual(["err: unknown flag: --nope", `err: ${USAGE}`]);
  });

  it("fails with every reason the generation could not be read", () => {
    const { deps, events } = harness({ read: err(["manifest.json is not JSON", "rerun the sync"]) });

    expect(runGithubAtlasReport({ argv: argvOf({ tail: ["--home", "/h"] }), deps })).toBe(1);
    expect(events).toEqual(["read: /h", "err: manifest.json is not JSON", "err: rerun the sync"]);
  });

  it("is expected-empty, naming the sync and walk verbs, when neither surface holds anything", () => {
    const { deps, events } = harness({ read: ok({ files: generation({ operations: [], requests: [] }) }) });

    expect(runGithubAtlasReport({ argv: argvOf({ tail: ["--home", "/h"] }), deps })).toBe(3);
    expect(events).toEqual([
      "read: /h",
      "out: the github atlas holds no operations and no observed requests — run `slopweaver atlas github sync`, then `walk`",
    ]);
  });

  it("is expected-empty, naming the sync and walk verbs, when neither kind file was published at all", () => {
    const empty: Files = { ...emptyGithubKindFiles({ at: AT }), "rest-operation": null, "web-request": null };
    const { deps, events } = harness({ read: ok({ files: empty }) });

    expect(runGithubAtlasReport({ argv: argvOf({ tail: ["--home", "/h"] }), deps })).toBe(3);
    expect(events).toEqual([
      "read: /h",
      "out: the github atlas holds no operations and no observed requests — run `slopweaver atlas github sync`, then `walk`",
    ]);
  });

  it("takes the report path, not the no-surface path, when stored surfaces agree, and is expected-empty", () => {
    const { deps, events } = harness({ read: ok({ files: AGREEING }) });

    expect(runGithubAtlasReport({ argv: argvOf({ tail: ["--home", "/h"] }), deps })).toBe(3);
    expect(events).toEqual([
      "read: /h",
      "out: 0 operation(s) GitHub declares and the installed client does not expose; 0 endpoint(s) its own web client calls and its description does not declare",
      "out: this verb resolves none of them; which surface wins is the owner's call",
    ]);
  });

  it("prints an empty disagreement list as JSON and is expected-empty under --json", () => {
    const { deps, events } = harness({ read: ok({ files: AGREEING }) });

    expect(runGithubAtlasReport({ argv: argvOf({ tail: ["--home", "/h", "--json"] }), deps })).toBe(3);
    expect(events).toEqual(["read: /h", 'out: {"disagreements":[]}']);
  });

  it("prints both disagreement kinds as JSON and succeeds under --json", () => {
    const { deps, events } = harness({ read: ok({ files: DISAGREEING }) });

    expect(runGithubAtlasReport({ argv: argvOf({ tail: ["--home", "/h", "--json"] }), deps })).toBe(0);
    expect(events).toEqual([
      "read: /h",
      `out: {"disagreements":[{"detail":"${DECLARED_DETAIL}","kind":"declared-not-exposed","subject":"GET /orgs/{org}/hidden","surfaces":["rest-openapi","rest-live"]},{"detail":"${CALLED_DETAIL}","kind":"called-not-declared","subject":"GET /_side-panels/user.json","surfaces":["github-web","rest-openapi"]}]}`,
    ]);
  });

  it("prints the headline, the non-resolution line and both disagreement kinds' details, and succeeds", () => {
    const { deps, events } = harness({ read: ok({ files: DISAGREEING }) });

    expect(runGithubAtlasReport({ argv: argvOf({ tail: ["--home", "/h"] }), deps })).toBe(0);
    expect(events).toEqual([
      "read: /h",
      "out: 1 operation(s) GitHub declares and the installed client does not expose; 1 endpoint(s) its own web client calls and its description does not declare",
      "out: this verb resolves none of them; which surface wins is the owner's call",
      "out:   declared-not-exposed  GET /orgs/{org}/hidden",
      `out:       ${DECLARED_DETAIL}`,
      "out:   called-not-declared  GET /_side-panels/user.json",
      `out:       ${CALLED_DETAIL}`,
    ]);
  });
});
