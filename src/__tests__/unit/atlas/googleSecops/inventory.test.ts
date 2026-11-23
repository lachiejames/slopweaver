/**
 * Compiling the inventory from fixture protos and a fixture service config: which services become rows,
 * what the config itself binds, every refusal, and the census the lock pins.
 */
import { describe, expect, it } from "vitest";

import { GoogleSecopsInventoryErrors } from "../../../../atlas/googleSecops/errors.js";
import {
  compileGoogleSecopsInventory,
  type GoogleSecopsProtoText,
  googleSecopsCensusMatches,
  googleSecopsInventoryCensus,
  googleSecopsScopeClass,
} from "../../../../atlas/googleSecops/inventory.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

const READONLY = "https://www.googleapis.com/auth/chronicle.readonly";
const PLATFORM = "https://www.googleapis.com/auth/cloud-platform";

/** A published service with a read and a write, and an unpublished one with a read. */
const PROTOS: readonly GoogleSecopsProtoText[] = [
  {
    document: "rule.proto",
    text: `package google.cloud.chronicle.v1;
service RuleService {
  rpc ListRules(ListRulesRequest) returns (ListRulesResponse) {
    option (google.api.http) = { get: "/v1/{parent=projects/*/locations/*/instances/*}/rules" };
  }
  rpc CreateRule(CreateRuleRequest) returns (Rule) {
    option (google.api.http) = { post: "/v1/{parent=projects/*/locations/*/instances/*}/rules" body: "rule" };
  }
}`,
  },
  {
    document: "dashboard_chart.proto",
    text: `package google.cloud.chronicle.v1;
service DashboardChartService {
  rpc GetDashboardChart(GetDashboardChartRequest) returns (DashboardChart) {
    option (google.api.http) = { get: "/v1/{name=projects/*/locations/*/instances/*/dashboardCharts/*}" };
  }
}`,
  },
];

const CONFIG = `name: chronicle.googleapis.com
apis:
- name: google.cloud.chronicle.v1.RuleService
- name: google.longrunning.Operations
http:
  rules:
  - selector: google.longrunning.Operations.ListOperations
    get: '/v1/{name=projects/*/locations/*/instances/*}/operations'
authentication:
  rules:
  - selector: 'google.cloud.chronicle.v1.RuleService.*'
    oauth:
      canonical_scopes: |-
        ${PLATFORM}
  - selector: google.cloud.chronicle.v1.DashboardChartService.GetDashboardChart
    oauth:
      canonical_scopes: |-
        ${READONLY},
        ${PLATFORM}
  - selector: 'google.longrunning.Operations.*'
    oauth:
      canonical_scopes: |-
        ${PLATFORM}
`;

/**
 * Compile the fixtures with a substituted config.
 *
 * @param serviceConfig the config text
 * @param protos the proto texts
 * @returns the compile result
 */
function compile({
  serviceConfig = CONFIG,
  protos = PROTOS,
}: {
  serviceConfig?: string;
  protos?: readonly GoogleSecopsProtoText[];
} = {}): ReturnType<typeof compileGoogleSecopsInventory> {
  return compileGoogleSecopsInventory({ protos, serviceConfig, serviceConfigDocument: "chronicle_v1.yaml" });
}

describe("compileGoogleSecopsInventory", () => {
  it("makes rows of published services and the config's own bindings, sorted by id", () => {
    const inventory = unwrap(compile());
    expect(inventory.rows.map((row) => [row.id, row.httpMethod, row.disposition, row.document])).toStrictEqual([
      ["google.cloud.chronicle.v1.RuleService.CreateRule", "POST", "excluded", "rule.proto"],
      ["google.cloud.chronicle.v1.RuleService.ListRules", "GET", "entity", "rule.proto"],
      ["google.longrunning.Operations.ListOperations", "GET", "entity", "chronicle_v1.yaml"],
    ]);
    expect(inventory.rows.map((row) => row.scopes)).toStrictEqual([[PLATFORM], [PLATFORM], [PLATFORM]]);
  });

  it("counts an unpublished service's rpcs but makes no row of them", () => {
    const inventory = unwrap(compile());
    expect(inventory.unpublished).toStrictEqual([
      { rpcs: 1, service: "google.cloud.chronicle.v1.DashboardChartService" },
    ]);
    expect(inventory.declaredByDocument).toStrictEqual({
      "chronicle_v1.yaml": 1,
      "dashboard_chart.proto": 1,
      "rule.proto": 2,
    });
  });

  it("lists unpublished services sorted by name, whatever order their files come in", () => {
    const watchlist: GoogleSecopsProtoText = {
      document: "watchlist.proto",
      text: `package google.cloud.chronicle.v1;
service WatchlistService {
  rpc GetWatchlist(GetWatchlistRequest) returns (Watchlist) {
    option (google.api.http) = { get: "/v1/{name=projects/*/locations/*/instances/*/watchlists/*}" };
  }
}`,
    };
    const inventory = unwrap(compile({ protos: [watchlist, ...PROTOS] }));
    expect(inventory.unpublished.map((entry) => entry.service)).toStrictEqual([
      "google.cloud.chronicle.v1.DashboardChartService",
      "google.cloud.chronicle.v1.WatchlistService",
    ]);
  });

  it("refuses a published method no authentication rule matches as AUTH_RULE_MISSING", () => {
    const serviceConfig = CONFIG.replace(
      "'google.cloud.chronicle.v1.RuleService.*'",
      "google.cloud.chronicle.v1.RuleService.ListRules",
    );
    const error = unwrapErr(compile({ serviceConfig }));
    expect(error.code).toBe("AUTH_RULE_MISSING");
    expect(error.message).toContain("google.cloud.chronicle.v1.RuleService.CreateRule");
  });

  it("refuses a published custom GET nobody judged as DISPOSITION_UNDECIDED, rather than a row", () => {
    const protos = PROTOS.map((proto) => ({
      ...proto,
      text: proto.text.replace("rpc ListRules(ListRulesRequest)", "rpc FetchRules(ListRulesRequest)"),
    }));
    const error = unwrapErr(compile({ protos }));
    expect(error.code).toBe("DISPOSITION_UNDECIDED");
    expect(error.message).toContain("google.cloud.chronicle.v1.RuleService.FetchRules");
  });

  it("refuses a later matching rule whose canonical_scopes is ',', empty or blank, rather than a row with no scope", () => {
    const blocks = ["','", "''", "' '"];
    const codes = blocks.map((block) => {
      const serviceConfig = CONFIG.replace(
        "  - selector: google.cloud.chronicle.v1.DashboardChartService.GetDashboardChart",
        `  - selector: google.cloud.chronicle.v1.RuleService.CreateRule\n    oauth:\n      canonical_scopes: ${block}\n  - selector: google.cloud.chronicle.v1.DashboardChartService.GetDashboardChart`,
      );
      expect(serviceConfig).toContain(`canonical_scopes: ${block}`);
      return unwrapErr(compile({ serviceConfig })).code;
    });
    // An empty string never reaches the split: the schema's min(1) refuses it first, as a config fault.
    expect(codes).toStrictEqual([
      "AUTH_RULE_GRANTS_NO_SCOPE",
      "SERVICE_CONFIG_UNPARSEABLE",
      "AUTH_RULE_GRANTS_NO_SCOPE",
    ]);
  });

  it("refuses a published service nothing declares as SERVICE_CONFIG_INCONSISTENT", () => {
    const serviceConfig = CONFIG.replace(
      "- name: google.longrunning.Operations",
      "- name: google.longrunning.Operations\n- name: google.cloud.chronicle.v1.GhostService",
    );
    const error = unwrapErr(compile({ serviceConfig }));
    expect(error.code).toBe("SERVICE_CONFIG_INCONSISTENT");
    expect(error.message).toBe(
      "chronicle_v1.yaml and the pinned protos disagree: apis lists google.cloud.chronicle.v1.GhostService, which no pinned proto or http rule declares",
    );
  });

  it("refuses an authentication rule that matches no method as SERVICE_CONFIG_INCONSISTENT", () => {
    const serviceConfig = CONFIG.replace(
      "google.cloud.chronicle.v1.DashboardChartService.GetDashboardChart",
      "google.cloud.chronicle.v1.DashboardChartService.RenamedAway",
    );
    const error = unwrapErr(compile({ serviceConfig }));
    expect(error.code).toBe("SERVICE_CONFIG_INCONSISTENT");
    expect(error.message).toContain(
      "authentication rule google.cloud.chronicle.v1.DashboardChartService.RenamedAway matches no method",
    );
  });

  it("refuses a config binding that rebinds a proto method as SERVICE_CONFIG_INCONSISTENT", () => {
    const serviceConfig = CONFIG.replace(
      "google.longrunning.Operations.ListOperations",
      "google.cloud.chronicle.v1.RuleService.ListRules",
    );
    const error = unwrapErr(compile({ serviceConfig }));
    expect(error.code).toBe("SERVICE_CONFIG_INCONSISTENT");
    expect(error.message).toContain("http.rules rebinds google.cloud.chronicle.v1.RuleService.ListRules");
  });

  it("refuses a config binding for a method the proto declaring its service lacks, rather than a phantom row", () => {
    const serviceConfig = CONFIG.replace(
      "  - selector: google.longrunning.Operations.ListOperations",
      "  - selector: google.cloud.chronicle.v1.RuleService.GetPhantom\n    get: '/v1/{name=projects/*/locations/*/instances/*/rules/*}:phantom'\n  - selector: google.longrunning.Operations.ListOperations",
    );
    expect(serviceConfig).toContain("GetPhantom");
    expect(unwrapErr(compile({ serviceConfig }))).toStrictEqual(
      GoogleSecopsInventoryErrors.serviceConfigInconsistent({
        detail:
          "http.rules binds google.cloud.chronicle.v1.RuleService.GetPhantom, but rule.proto declares google.cloud.chronicle.v1.RuleService without that method",
      }),
    );
  });

  it("refuses a config binding whose service apis does not list, rather than silently counting it unpublished", () => {
    const serviceConfig = CONFIG.replace(
      "  - selector: google.longrunning.Operations.ListOperations",
      "  - selector: google.longrunning.Operation.DeleteOperation\n    delete: '/v1/{name=projects/*/locations/*/instances/*/operations/*}'\n  - selector: google.longrunning.Operations.ListOperations",
    );
    expect(serviceConfig).toContain("Operation.DeleteOperation");
    expect(unwrapErr(compile({ serviceConfig }))).toStrictEqual(
      GoogleSecopsInventoryErrors.serviceConfigInconsistent({
        detail: "http.rules binds google.longrunning.Operation.DeleteOperation, whose service apis does not list",
      }),
    );
  });

  it("refuses a config binding for any service but the named mixin, wherever the rule sits", () => {
    // Each stand-in is listed in apis and has its own auth rule, as every real method does — so this refusal
    // is the only thing between it and a row. A Chronicle service whose proto is not pinned would get one row
    // where Google publishes all of them; another mixin is refused until it is named. Each is placed both
    // before and after the accepted Operations rule, so a check reading only the first or last rule fails.
    const listOperations = "  - selector: google.longrunning.Operations.ListOperations\n";
    const standIns = [
      {
        get: "/v1/{name=projects/*/locations/*/instances/*/referenceLists/*}",
        id: "google.cloud.chronicle.v1.ReferenceListService.GetReferenceList",
        service: "google.cloud.chronicle.v1.ReferenceListService",
      },
      {
        get: "/v1/{resource=projects/*/locations/*/instances/*}:getIamPolicy",
        id: "google.iam.v1.IAMPolicy.GetIamPolicy",
        service: "google.iam.v1.IAMPolicy",
      },
    ];
    const operationsGet = "    get: '/v1/{name=projects/*/locations/*/instances/*}/operations'\n";
    const cases = standIns.flatMap((standIn) => [
      { ...standIn, before: true, side: -1 },
      { ...standIn, before: false, side: 1 },
    ]);
    const outcomes = cases.map(({ before, get, id, service }) => {
      const rule = `  - selector: ${id}\n    get: '${get}'\n`;
      const placed = before
        ? CONFIG.replace(listOperations, `${rule}${listOperations}`)
        : CONFIG.replace(`${listOperations}${operationsGet}`, `${listOperations}${operationsGet}${rule}`);
      const serviceConfig = placed
        .replace(
          "- name: google.longrunning.Operations\n",
          `- name: google.longrunning.Operations\n- name: ${service}\n`,
        )
        .replace(
          "authentication:\n  rules:\n",
          `authentication:\n  rules:\n  - selector: ${id}\n    oauth:\n      canonical_scopes: ${READONLY}\n`,
        );
      // -1 when the stand-in's binding really sits before ListOperations, 1 when after.
      const side = Math.sign(
        serviceConfig.indexOf(`selector: ${id}\n    get:`) - serviceConfig.indexOf(listOperations),
      );
      return { error: unwrapErr(compile({ serviceConfig })), side };
    });
    expect(outcomes).toStrictEqual(
      cases.map(({ id, service, side }) => ({
        error: GoogleSecopsInventoryErrors.serviceConfigInconsistent({
          detail: `http.rules binds ${id}, but only google.longrunning.Operations is bound by config — a pinned proto must declare ${service}`,
        }),
        side,
      })),
    );
  });

  it("refuses one method declared by two pinned files, naming both, rather than two rows for one id", () => {
    const protos = [
      ...PROTOS,
      {
        document: "rule_copy.proto",
        text: `package google.cloud.chronicle.v1;
service RuleService {
  rpc ListRules(ListRulesRequest) returns (ListRulesResponse) {
    option (google.api.http) = { post: "/v1/{parent=projects/*/locations/*/instances/*}/rules:list" body: "*" };
  }
}`,
      },
    ];
    const error = unwrapErr(compile({ protos }));
    expect(error.code).toBe("PROTO_UNPARSEABLE");
    expect(error.message).toBe(
      "rule_copy.proto could not be parsed: declares google.cloud.chronicle.v1.RuleService.ListRules, already declared in rule.proto",
    );
  });

  it("refuses one service declared by two pinned files, rather than merging a new method into it", () => {
    const protos = [
      ...PROTOS,
      {
        document: "rule_extra.proto",
        text: `package google.cloud.chronicle.v1;
service RuleService {
  rpc PurgeRule(PurgeRuleRequest) returns (Rule) {
    option (google.api.http) = { delete: "/v1/{name=projects/*/locations/*/instances/*/rules/*}:purge" };
  }
}`,
      },
    ];
    expect(unwrapErr(compile({ protos }))).toStrictEqual(
      GoogleSecopsInventoryErrors.protoUnparseable({
        detail: "declares service google.cloud.chronicle.v1.RuleService, already declared in rule.proto",
        document: "rule_extra.proto",
      }),
    );
  });

  it("reads an import of another pinned file and refuses one of an unpinned file in the same directory", () => {
    // The import under test sits between two accepted ones, so a check of only the first or last would pass it.
    const importing = ({ path }: { path: string }) =>
      compile({
        protos: [
          ...PROTOS,
          {
            document: "note.proto",
            text: `package google.cloud.chronicle.v1;\nimport "google/api/annotations.proto";\nimport "${path}";\nimport "google/cloud/chronicle/v1/dashboard_chart.proto";\nmessage Note {}`,
          },
        ],
      });
    expect(unwrap(importing({ path: "google/cloud/chronicle/v1/rule.proto" })).rows.length).toBe(3);
    const unpinned = ["google/cloud/chronicle/v1/http_scope.proto", "google/cloud/chronicle/v1/xrule.proto"];
    expect(unpinned.map((path) => unwrapErr(importing({ path })))).toStrictEqual(
      unpinned.map((path) =>
        GoogleSecopsInventoryErrors.protoUnparseable({
          detail: `imports ${path}, which is not one of the pinned files`,
          document: "note.proto",
        }),
      ),
    );
  });

  it("carries a proto parse refusal through unchanged", () => {
    const protos = [{ document: "rule.proto", text: "package a.b;\nservice S {\n  rpc X(Y) returns (Z);\n}" }];
    expect(unwrapErr(compile({ protos })).code).toBe("HTTP_BINDING_MISSING");
  });
});

describe("googleSecopsScopeClass", () => {
  it("names the narrowest of the two grants that reaches a method", () => {
    expect(googleSecopsScopeClass({ scopes: [READONLY, PLATFORM] })).toBe("chronicle-readonly");
    expect(googleSecopsScopeClass({ scopes: [PLATFORM] })).toBe("cloud-platform-only");
    expect(googleSecopsScopeClass({ scopes: ["https://www.googleapis.com/auth/chronicle"] })).toBe("other");
  });

  it("matches a scope as a whole element, in any position beside other scopes", () => {
    const classes = [
      [PLATFORM, "https://www.googleapis.com/auth/chronicle"],
      [`${PLATFORM}.read-only`],
      [`${READONLY}.x`],
      [`x${READONLY}`, `x${PLATFORM}`],
      ["https://www.googleapis.com/auth/chronicle", PLATFORM],
      [PLATFORM, READONLY],
    ].map((scopes) => googleSecopsScopeClass({ scopes }));
    expect(classes).toStrictEqual([
      "cloud-platform-only",
      "other",
      "other",
      "other",
      "cloud-platform-only",
      "chronicle-readonly",
    ]);
  });
});

describe("the census", () => {
  it("counts every pinned axis, with every member present at zero", () => {
    const census = googleSecopsInventoryCensus({ rows: unwrap(compile()).rows });
    expect(census).toStrictEqual({
      byDisposition: { entity: 2, excluded: 1, "probe-only": 0 },
      byExclusionReason: { mutating: 1, query: 0 },
      byHttpMethod: { DELETE: 0, GET: 2, PATCH: 0, POST: 1, PUT: 0 },
      distinctIds: 3,
      entitiesByScopeClass: { "chronicle-readonly": 0, "cloud-platform-only": 2, other: 0 },
      methods: 3,
      rowsByDocument: { "chronicle_v1.yaml": 1, "rule.proto": 2 },
    });
  });

  it("matches a census equal to itself whatever its key order, and names every axis that moved", () => {
    const census = googleSecopsInventoryCensus({ rows: unwrap(compile()).rows });
    const reordered = { ...census, rowsByDocument: { "rule.proto": 2, "chronicle_v1.yaml": 1 } };
    expect(googleSecopsCensusMatches({ census, pinned: reordered }).isOk()).toBe(true);
    // Every one of the seven axes moves, the two scalars by different amounts, so each comparison has a line
    // of its own to lose and none can be wired to another axis's values without changing what it prints.
    const moved = {
      byDisposition: { ...census.byDisposition, entity: 3 },
      byExclusionReason: { ...census.byExclusionReason, query: 1 },
      byHttpMethod: { ...census.byHttpMethod, GET: 3 },
      distinctIds: 5,
      entitiesByScopeClass: { ...census.entitiesByScopeClass, "chronicle-readonly": 1 },
      methods: 4,
      rowsByDocument: { ...census.rowsByDocument, "rule.proto": 3 },
    };
    const error = unwrapErr(googleSecopsCensusMatches({ census, pinned: moved }));
    expect(error.code).toBe("CENSUS_MISMATCH");
    expect(error.problems).toStrictEqual([
      "methods: read 3, pinned 4",
      "distinct ids: read 3, pinned 5",
      'rows by document: read [["chronicle_v1.yaml",1],["rule.proto",2]], pinned [["chronicle_v1.yaml",1],["rule.proto",3]]',
      'by HTTP method: read [["DELETE",0],["GET",2],["PATCH",0],["POST",1],["PUT",0]], pinned [["DELETE",0],["GET",3],["PATCH",0],["POST",1],["PUT",0]]',
      'by disposition: read [["entity",2],["excluded",1],["probe-only",0]], pinned [["entity",3],["excluded",1],["probe-only",0]]',
      'by exclusion reason: read [["mutating",1],["query",0]], pinned [["mutating",1],["query",1]]',
      'entities by scope class: read [["chronicle-readonly",0],["cloud-platform-only",2],["other",0]], pinned [["chronicle-readonly",1],["cloud-platform-only",2],["other",0]]',
    ]);
    // Each axis moved ALONE is refused too, so a check that tolerated one disagreement would fail here.
    const singles = Object.entries(moved).map(
      ([axis, value]) =>
        unwrapErr(googleSecopsCensusMatches({ census, pinned: { ...census, [axis]: value } })).problems.length,
    );
    expect(singles).toStrictEqual([1, 1, 1, 1, 1, 1, 1]);
  });
});
