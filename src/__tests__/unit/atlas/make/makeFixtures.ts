/**
 * Canned Make answers for one small organisation — one team, two folders, one scenario wired to KnowBe4,
 * its blueprint, one run, one connection and one hook — and a {@link MakeRead} that serves them.
 *
 * Every field the atlas must never keep carries a `FIXTURE-SECRET-*` marker, so a test can feed the secret
 * in and assert both halves: it was in the input, and it is nowhere on disk.
 */
import type { MakeRead, MakeReadRequest } from "../../../../atlas/make/client.js";
import { ok } from "../../../../lib/result.js";

export const SECRET_MARKERS = [
  "FIXTURE-SECRET-MAPPER",
  "FIXTURE-SECRET-PARAMETER",
  "FIXTURE-SECRET-CONNECTION-METADATA",
  "FIXTURE-SECRET-UID",
  "FIXTURE-SECRET-HOOK-URL",
  "FIXTURE-SECRET-UDID",
] as const;

const ORGANIZATIONS = [
  {
    countryId: 13,
    id: 1,
    license: { operations: 10000, teams: 3, users: 5 },
    name: "Fixture Org",
    timezoneId: 113,
    zone: "eu2.make.com",
  },
];

const TEAMS = [{ activeScenarios: 1, id: 10, name: "IT Ops", organizationId: 1 }];

const FOLDERS = [
  { children: [{ id: 101, name: "Offboarding", path: "IT/Offboarding" }], id: 100, name: "IT", path: "IT" },
];

const SCENARIOS = [
  {
    created: "2026-01-02T00:00:00.000Z",
    createdByUser: { email: "builder@example.test", id: 7, name: "A Builder" },
    description: "Removes a leaver from KnowBe4 and marks them offboarded in Vanta",
    folderId: 101,
    hookId: 55,
    id: 1000,
    isActive: true,
    isPaused: false,
    isinvalid: false,
    lastEdit: "2026-09-01T00:00:00.000Z",
    name: "Offboard leaver",
    scheduling: { type: "immediately" },
    teamId: 10,
    updatedByUser: { email: "editor@example.test", id: 8, name: "An Editor" },
    usedPackages: ["gateway", "knowbe4", "vanta"],
  },
];

export const BLUEPRINT = {
  flow: [
    { id: 1, mapper: { token: "FIXTURE-SECRET-MAPPER" }, module: "gateway:CustomWebHook" },
    {
      id: 2,
      module: "builtin:BasicRouter",
      routes: [
        { flow: [{ id: 3, module: "knowbe4:deleteUser", parameters: { apiKey: "FIXTURE-SECRET-PARAMETER" } }] },
        { flow: [{ id: 4, module: "vanta:updatePerson" }] },
      ],
    },
  ],
  metadata: { version: 1 },
  name: "Offboard leaver",
};

const EXECUTIONS = [
  { duration: 900, id: "exec-old", operations: 3, status: 3, timestamp: "2026-10-13T00:00:00.000Z" },
  { duration: 1200, id: "exec-new", operations: 4, status: 1, timestamp: "2026-10-14T00:00:00.000Z" },
];

export const CONNECTIONS = [
  {
    accountLabel: "KnowBe4",
    accountName: "knowbe4",
    accountType: "basic",
    expire: null,
    id: 500,
    metadata: { value: "FIXTURE-SECRET-CONNECTION-METADATA" },
    name: "KnowBe4 admin",
    packageName: null,
    scenarioUsages: [{ id: 1000, name: "Offboard leaver" }],
    teamId: 10,
    uid: "FIXTURE-SECRET-UID",
  },
];

export const HOOKS = [
  {
    data: { headers: false },
    enabled: true,
    id: 55,
    name: "Leaver webhook",
    packageName: null,
    queueCount: 0,
    scenarioId: 1000,
    teamId: 10,
    type: "web",
    udid: "FIXTURE-SECRET-UDID",
    url: "https://hook.eu2.make.com/FIXTURE-SECRET-HOOK-URL",
  },
];

/** The body each request kind answers in this fixture organisation. */
function bodyFor({ request }: { request: MakeReadRequest }): unknown {
  switch (request.op) {
    case "organizations.list":
      return ORGANIZATIONS;
    case "teams.list":
      return TEAMS;
    case "folders.list":
      return FOLDERS;
    case "scenarios.list":
      return SCENARIOS;
    case "blueprints.get":
      return BLUEPRINT;
    case "executions.list":
      return EXECUTIONS;
    case "connections.list":
      return CONNECTIONS;
    case "hooks.list":
      return HOOKS;
    default: {
      const unreachable: never = request;
      return unreachable;
    }
  }
}

/**
 * A read serving the fixture organisation, recording every request it was asked.
 *
 * @param seen where each request is appended, so a test can assert what the fill asked for
 * @returns the read
 */
export function fixtureRead({ seen }: { seen: MakeReadRequest[] }): MakeRead {
  return ({ request }) => {
    seen.push(request);
    return Promise.resolve(ok(bodyFor({ request })));
  };
}
