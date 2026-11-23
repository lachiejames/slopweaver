/**
 * `slopweaver gcp` driven at its real command boundary over a plain fake sender: help and a bad flag send
 * nothing, a read goes out once billed to its project, a preview reads and sends no write, a stale approval is
 * held by the door, and a matching one sends the write — every step under a temp home.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { DoorLedgerPort } from "../../../../../admit/doorLedgerPort.js";
import { familyOptions, invalid } from "../../../../../cli/commands/gcp/gcpOptions.js";
import { printed, reportError } from "../../../../../cli/commands/gcp/gcpPrint.js";
import { readProject, runRead } from "../../../../../cli/commands/gcp/gcpRead.js";
import { type GcpDeps, runGcpWith } from "../../../../../cli/commands/gcp/gcpRun.js";
import { GCP_RUN_USAGE, GCP_SERVICES_USAGE } from "../../../../../cli/commands/gcp/gcpUsage.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { gcpManifest } from "../../../../../cli/manifests/gcp.js";
import { type GcpDoorError, GcpDoorErrors } from "../../../../../gcp/errors.js";
import { gcpWriteDigest } from "../../../../../gcp/plan.js";
import { planServiceEnable } from "../../../../../gcp/planProject.js";
import type { GcpDoorRequest } from "../../../../../gcp/request.js";
import type { GcpDoorSend } from "../../../../../gcp/transport.js";
import { GCP_HATCHES } from "../../../../../hatch/gcpHatches.js";
import { err, ok, type Result, unwrap, unwrapErr } from "../../../../../lib/result.js";
import { memoryDoorLedger, unreachableDoorLedger } from "../../../../doorLedgerFixture.js";

const PROJECT = "my-project-01";
const API = "run.googleapis.com";

/** Deps whose sender answers each request kind from its own queue, recording every project bound and request sent. */
function scriptedDeps({
  answers,
  doorLedger = memoryDoorLedger().port,
}: {
  answers: Readonly<Record<string, readonly Result<unknown, GcpDoorError>[]>>;
  doorLedger?: DoorLedgerPort;
}): {
  deps: GcpDeps;
  projects: string[];
  sent: GcpDoorRequest[];
} {
  const queues = new Map(Object.entries(answers).map(([kind, queue]) => [kind, [...queue]]));
  const projects: string[] = [];
  const sent: GcpDoorRequest[] = [];
  const send: GcpDoorSend = async ({ request }) => {
    sent.push(request);
    const next = queues.get(request.kind)?.shift();
    if (next === undefined) {
      throw new Error(`no scripted answer for ${request.kind}`);
    }
    return next;
  };
  const deps: GcpDeps = {
    createSend: ({ project }) => {
      projects.push(project);
      return send;
    },
    doorLedger,
    wait: { attempts: 1, intervalMs: 0, sleep: async () => undefined },
  };
  return { deps, projects, sent };
}

/** The process argv for one `gcp services` invocation. */
function servicesArgv({ rest }: { rest: readonly string[] }): readonly string[] {
  return ["node", "slopweaver", "gcp", "services", ...rest];
}

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "gcp-run-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

describe("runGcpWith", () => {
  it("answers --help with no sender bound", async () => {
    const { deps, projects } = scriptedDeps({ answers: {} });
    expect(await runGcpWith({ argv: servicesArgv({ rest: ["--help"] }), deps, family: "services" })).toBe(EXIT_OK);
    expect(projects).toEqual([]);
  });

  it("refuses an unknown flag as a usage error with no sender bound", async () => {
    const { deps, projects } = scriptedDeps({ answers: {} });
    const argv = servicesArgv({ rest: ["describe", "--project", PROJECT, "--service", API, "--nope", "x"] });
    expect(await runGcpWith({ argv, deps, family: "services" })).toBe(EXIT_USAGE);
    expect(projects).toEqual([]);
  });

  it("sends a read once, billed to the project it reads", async () => {
    const { deps, projects, sent } = scriptedDeps({
      answers: { "api-service-get": [ok({ name: `projects/1/services/${API}`, state: "ENABLED" })] },
    });
    const argv = servicesArgv({ rest: ["describe", "--project", PROJECT, "--service", API] });
    expect(await runGcpWith({ argv, deps, family: "services" })).toBe(EXIT_OK);
    expect(projects).toEqual([PROJECT]);
    expect(sent).toEqual([{ kind: "api-service-get", project: PROJECT, service: API }]);
  });

  it("previews a write by reading only, and exits 3 when there is nothing to change", async () => {
    const disabled = scriptedDeps({ answers: { "api-service-get": [ok({ name: API, state: "DISABLED" })] } });
    const argv = servicesArgv({ rest: ["enable", "--project", PROJECT, "--service", API] });
    expect(await runGcpWith({ argv, deps: disabled.deps, family: "services" })).toBe(EXIT_OK);
    expect(disabled.sent.map((request) => request.kind)).toEqual(["api-service-get"]);
    const enabled = scriptedDeps({ answers: { "api-service-get": [ok({ name: API, state: "ENABLED" })] } });
    expect(await runGcpWith({ argv, deps: enabled.deps, family: "services" })).toBe(EXIT_EXPECTED_EMPTY);
  });

  it("holds an approval that is not this plan's digest, sending no write", async () => {
    const { deps, sent } = scriptedDeps({ answers: { "api-service-get": [ok({ name: API, state: "DISABLED" })] } });
    const argv = servicesArgv({
      rest: ["enable", "--project", PROJECT, "--service", API, "--approve", "gcp-0000000000000000", "--home", home],
    });
    expect(await runGcpWith({ argv, deps, family: "services" })).toBe(EXIT_EXPECTED_EMPTY);
    expect(sent.map((request) => request.kind)).toEqual(["api-service-get"]);
  });

  it("sends the write when the approval is the digest of the plan as it stands", async () => {
    const digest = gcpWriteDigest({
      plan: unwrap(planServiceEnable({ project: PROJECT, service: API, state: "DISABLED" })),
    });
    const { deps, sent } = scriptedDeps({
      answers: {
        "api-service-enable": [ok({ done: true, name: "operations/acat.p2-123" })],
        "api-service-get": [ok({ name: API, state: "DISABLED" })],
      },
    });
    const argv = servicesArgv({
      rest: ["enable", "--project", PROJECT, "--service", API, "--approve", digest, "--home", home],
    });
    expect(await runGcpWith({ argv, deps, family: "services" })).toBe(EXIT_OK);
    expect(sent.map((request) => request.kind)).toEqual(["api-service-get", "api-service-enable"]);
  });

  it("sends no write and exits 1, not as a hold, when the store cannot record the step", async () => {
    const digest = gcpWriteDigest({
      plan: unwrap(planServiceEnable({ project: PROJECT, service: API, state: "DISABLED" })),
    });
    const { deps, sent } = scriptedDeps({
      answers: { "api-service-get": [ok({ name: API, state: "DISABLED" })] },
      doorLedger: unreachableDoorLedger(),
    });
    const argv = servicesArgv({
      rest: ["enable", "--project", PROJECT, "--service", API, "--approve", digest, "--home", home],
    });
    expect(await runGcpWith({ argv, deps, family: "services" })).toBe(EXIT_ERROR);
    expect(sent.map((request) => request.kind)).toEqual(["api-service-get"]);
  });
});

describe("runRead and readProject", () => {
  it("bills a read to its ref's project or its own", () => {
    expect([
      readProject({ options: { read: "secret describe", ref: { project: "p-one-01", secret: "s" } } }),
      readProject({ options: { project: "p-two-02", read: "services describe", service: API } }),
    ]).toEqual(["p-one-01", "p-two-02"]);
  });

  it("exits on the failure's own code when Google refuses the read", async () => {
    const { deps } = scriptedDeps({
      answers: { "repository-get": [err(GcpDoorErrors.notFound({ operation: "gcp.artifactregistry.get" }))] },
    });
    const send = deps.createSend({ project: PROJECT });
    expect(
      await runRead({
        json: true,
        options: { project: PROJECT, read: "artifacts describe", region: "australia-southeast1", repository: "r" },
        send,
      }),
    ).toBe(EXIT_EXPECTED_EMPTY);
  });
});

describe("familyOptions", () => {
  it("reads a services describe and a run deploy from their flags", () => {
    expect(
      unwrap(
        familyOptions({
          action: "describe",
          booleans: {},
          family: "services",
          values: { project: PROJECT, service: API },
        }),
      ),
    ).toEqual({ project: PROJECT, read: "services describe", service: API });
    expect(
      unwrap(
        familyOptions({
          action: "deploy",
          booleans: { "allow-unauthenticated": true },
          family: "run",
          values: {
            image: "i",
            project: PROJECT,
            region: "australia-southeast1",
            "remove-env": "A, B",
            service: "api",
          },
        }),
      ),
    ).toEqual({
      kind: "ready",
      options: {
        allowUnauthenticated: true,
        command: "run deploy",
        image: "i",
        project: PROJECT,
        region: "australia-southeast1",
        removeEnv: ["A", "B"],
        service: "api",
        serviceAccount: undefined,
      },
    });
  });

  it("refuses disabling latest, and a bad env key to remove", () => {
    expect(
      unwrapErr(
        familyOptions({
          action: "disable-version",
          booleans: {},
          family: "secret",
          values: { project: PROJECT, secret: "s", version: "latest" },
        }),
      ).message,
    ).toBe("--version: disable names an exact version number, never latest");
    expect(
      unwrapErr(
        familyOptions({
          action: "deploy",
          booleans: {},
          family: "run",
          values: {
            image: "i",
            project: PROJECT,
            region: "australia-southeast1",
            "remove-env": "1BAD",
            service: "api",
          },
        }),
      ).message,
    ).toBe('--remove-env: "1BAD" is not an environment variable name');
  });

  it("builds an invocation refusal as INPUT_INVALID", () => {
    expect(unwrapErr(invalid({ why: "no" }))).toEqual({ code: "INPUT_INVALID", message: "no" });
  });
});

describe("gcpPrint", () => {
  it("maps each failure to its exit code, and a printed result to 0", () => {
    expect([
      reportError({ error: GcpDoorErrors.inputInvalid({ why: "x" }) }),
      reportError({ error: GcpDoorErrors.noChange({ what: "x" }) }),
      reportError({ error: GcpDoorErrors.requestRefused({ what: "x", why: "y" }) }),
      printed({ json: false, lines: [], value: null }),
    ]).toEqual([EXIT_USAGE, EXIT_EXPECTED_EMPTY, EXIT_ERROR, EXIT_OK]);
  });
});

describe("the gcp manifest, usage and hatch", () => {
  it("declares every family as a door-routed external write", () => {
    expect(Object.keys(gcpManifest).toSorted()).toEqual(["artifacts", "run", "secret", "service-account", "services"]);
    expect(Object.values(gcpManifest).map((entry) => [entry.meta.effect, entry.meta.doorRouted])).toEqual(
      Array.from({ length: 5 }, () => ["external-write", true]),
    );
  });

  it("quotes each family's own usage", () => {
    expect([gcpManifest["run"]!.meta.usage, gcpManifest["services"]!.meta.usage]).toEqual([
      GCP_RUN_USAGE,
      GCP_SERVICES_USAGE,
    ]);
  });

  it("declares the one edit-existing hatch, read by gcpCore", () => {
    expect(GCP_HATCHES.map((hatch) => [hatch.id, hatch.lane, hatch.reader])).toEqual([
      ["gcp-edit-existing", "ambient", "src/cli/commands/gcp/gcpCore.ts"],
    ]);
  });
});
