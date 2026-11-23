/**
 * Performing an approved plan over a plain fake sender, each step through the real door into a temp home's
 * ledger: the order sent, a hold that sends nothing, a stop part way, a grant refused when the policy moved, and
 * an operation still running when the wait ends.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { describeRunService } from "../../../gcp/describe.js";
import { type GcpDoorError, GcpDoorErrors } from "../../../gcp/errors.js";
import { type GcpOperationWait, type GcpPlanOutcome, type GcpStepOutcome, performPlan } from "../../../gcp/execute.js";
import { planWrite } from "../../../gcp/operations.js";
import { type GcpWritePlan, gcpWriteDigest } from "../../../gcp/plan.js";
import { planServiceEnable } from "../../../gcp/planProject.js";
import { planRunDeploy } from "../../../gcp/planRun.js";
import {
  planSecretAddVersion,
  planSecretBinding,
  planSecretCreate,
  planSecretDisableVersion,
} from "../../../gcp/planSecret.js";
import type { GcpDoorRequest } from "../../../gcp/request.js";
import { encodeSecretPayload } from "../../../gcp/secretPayload.js";
import { callGcp, type GcpDoorSend } from "../../../gcp/transport.js";
import { SECRET, SECRET_ACCESS } from "../../../gcp/wire.js";
import { err, ok, type Result, unwrap, unwrapErr } from "../../../lib/result.js";
import { type MemoryDoorLedger, memoryDoorLedger, unreachableDoorLedger } from "../../doorLedgerFixture.js";

const SECRET_REF = { project: "my-project-01", secret: "desktop_client_id" } as const;
const SECRET_NAME = "projects/123/secrets/desktop_client_id";
const ACCESSOR = "roles/secretmanager.secretAccessor";
const MEMBER = "serviceAccount:a@my-project-01.iam.gserviceaccount.com";
const NO_WAIT: GcpOperationWait = { attempts: 2, intervalMs: 0, sleep: async () => undefined };

/** A sender answering each request kind from its own queue, in order, and recording every request it got. */
function scriptedSend({ answers }: { answers: Readonly<Record<string, readonly Result<unknown, GcpDoorError>[]>> }): {
  send: GcpDoorSend;
  sent: GcpDoorRequest[];
} {
  const queues = new Map(Object.entries(answers).map(([kind, queue]) => [kind, [...queue]]));
  const sent: GcpDoorRequest[] = [];
  const send: GcpDoorSend = async ({ request }) => {
    sent.push(request);
    const next = queues.get(request.kind)?.shift();
    if (next === undefined) {
      throw new Error(`no scripted answer for ${request.kind}`);
    }
    return next;
  };
  return { send, sent };
}

let home: string;
let door: MemoryDoorLedger;

/** The door ledger's records, in the order they were written. */
function ledgerRows(): readonly Readonly<Record<string, unknown>>[] {
  return door.records();
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "gcp-execute-"));
  door = memoryDoorLedger();
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** Perform a plan approved with its own digest. */
async function approved({
  plan,
  send,
  acknowledgements = [],
}: {
  plan: GcpWritePlan;
  send: GcpDoorSend;
  acknowledgements?: readonly { reason: string; subject: "gcp-edit-existing" }[];
}): ReturnType<typeof performPlan> {
  const digest = gcpWriteDigest({ plan });
  return performPlan({
    acknowledgements,
    approve: digest,
    digest,
    home,
    ledger: door.port,
    plan,
    preview: "slopweaver gcp …",
    send,
    wait: NO_WAIT,
  });
}

/** A performed plan's result, throwing when the door held it instead. */
function doneResult({ outcome }: { outcome: GcpPlanOutcome }): Result<readonly GcpStepOutcome[], GcpDoorError> {
  if (outcome.kind !== "done") {
    throw new Error(`the door stopped a plan this case approved: ${outcome.kind}`);
  }
  return outcome.result;
}

const payload = unwrap(encodeSecretPayload({ bytes: new TextEncoder().encode("s3cret") }));

describe("performPlan", () => {
  it("sends every step in order, each through its own passing door row", async () => {
    const plan = unwrap(planSecretCreate({ exists: false, payload, ref: SECRET_REF }));
    const { send, sent } = scriptedSend({
      answers: {
        "secret-create": [ok({ name: SECRET_NAME })],
        "secret-version-add": [ok({ name: `${SECRET_NAME}/versions/1`, state: "ENABLED" })],
        "secret-version-list": [ok({})],
      },
    });
    const outcome = await approved({ plan, send });
    expect(unwrap(doneResult({ outcome }))).toEqual([
      { detail: `created ${SECRET_NAME}`, id: "create-secret" },
      { detail: `${SECRET_NAME}/versions/1 is ENABLED`, id: "add-version" },
    ]);
    expect(sent.map((request) => request.kind)).toEqual(["secret-create", "secret-version-list", "secret-version-add"]);
    expect(ledgerRows().map((row) => [row["action"], row["status"]])).toEqual([
      ["verb:gcp.secret create create-secret", "pass"],
      ["verb:gcp.secret create add-version", "pass"],
    ]);
  });

  it("holds a digest that does not match, sends nothing, and records the hold", async () => {
    const plan = unwrap(planSecretCreate({ exists: false, payload: undefined, ref: SECRET_REF }));
    const { send, sent } = scriptedSend({ answers: {} });
    const outcome = await performPlan({
      acknowledgements: [],
      approve: "gcp-0000000000000000",
      digest: gcpWriteDigest({ plan }),
      home,
      ledger: door.port,
      plan,
      preview: "slopweaver gcp secret create …",
      send,
      wait: NO_WAIT,
    });
    expect(outcome.kind).toBe("held");
    expect(sent).toEqual([]);
    expect(ledgerRows().map((row) => row["status"])).toEqual(["hold"]);
  });

  it("answers store-unavailable, not held, and sends nothing when the decision cannot be recorded", async () => {
    const plan = unwrap(planSecretCreate({ exists: false, payload: undefined, ref: SECRET_REF }));
    const { send, sent } = scriptedSend({ answers: {} });
    const digest = gcpWriteDigest({ plan });
    const outcome = await performPlan({
      acknowledgements: [],
      approve: digest,
      digest,
      home,
      ledger: unreachableDoorLedger(),
      plan,
      preview: "slopweaver gcp secret create …",
      send,
      wait: NO_WAIT,
    });
    expect(outcome.kind).toBe("store-unavailable");
    expect(sent).toEqual([]);
  });

  it("answers PARTIAL_WRITE naming the step that landed when a later one fails", async () => {
    const plan = unwrap(planSecretCreate({ exists: false, payload, ref: SECRET_REF }));
    const { send } = scriptedSend({
      answers: {
        "secret-create": [ok({ name: SECRET_NAME })],
        "secret-version-add": [
          err(
            GcpDoorErrors.transportFailed({
              detail: "quota",
              operation: "gcp.secretmanager.secrets.addVersion",
              status: 429,
            }),
          ),
        ],
        "secret-version-list": [ok({})],
      },
    });
    const outcome = await approved({ plan, send });
    const error = unwrapErr(doneResult({ outcome }));
    expect(error.message).toBe(
      `stopped at step add-version after create-secret (created ${SECRET_NAME}) had been performed — nothing was ` +
        "rolled back: gcp.secretmanager.secrets.addVersion failed (HTTP 429): quota",
    );
  });

  it("refuses an additive version add once a version was enabled since the plan, and never sends it", async () => {
    const plan = unwrap(planSecretAddVersion({ payload, ref: SECRET_REF, versions: [] }));
    const { send, sent } = scriptedSend({
      answers: { "secret-version-list": [ok({ versions: [{ name: `${SECRET_NAME}/versions/2`, state: "ENABLED" }] })] },
    });
    const outcome = await approved({ plan, send });
    expect(unwrapErr(doneResult({ outcome })).message).toBe(
      "refused to build a request for a version add to projects/my-project-01/secrets/desktop_client_id: a version " +
        "was enabled since the plan was read, so this add would now move `latest` — preview again",
    );
    expect(sent.map((request) => request.kind)).toEqual(["secret-version-list"]);
  });

  it("cuts a carried env value out of a failed operation's message, which the transport never saw", async () => {
    const service = {
      etag: '"svc"',
      name: "projects/my-project-01/locations/australia-southeast1/services/desktop-api",
      template: { containers: [{ env: [{ name: "API_TOKEN", value: "env-leak-7x" }], image: "old" }] },
    };
    const options = {
      allowUnauthenticated: false,
      image: "new",
      project: "my-project-01",
      region: "australia-southeast1",
      removeEnv: [],
      service: "desktop-api",
      serviceAccount: undefined,
    };
    const plan = unwrap(planRunDeploy({ options, policy: null, service }));
    const { send } = scriptedSend({
      answers: {
        "run-service-patch": [
          ok({ done: true, error: { message: "revision rejected for env value env-leak-7x" }, name: "operations/op1" }),
        ],
      },
    });
    const outcome = await approved({
      acknowledgements: [{ reason: "ship", subject: "gcp-edit-existing" }],
      plan,
      send,
    });
    expect(unwrapErr(doneResult({ outcome })).message).toBe(
      "operation operations/op1 failed: revision rejected for env value <env API_TOKEN>",
    );
    expect(JSON.stringify(plan)).toContain("env-leak-7x");
  });

  it("cuts a carried env value out of a succeeding step's Google-returned name", async () => {
    const service = {
      etag: '"svc"',
      name: "projects/my-project-01/locations/australia-southeast1/services/desktop-api",
      template: { containers: [{ env: [{ name: "API_TOKEN", value: "operations/leak-123" }], image: "old" }] },
    };
    const options = {
      allowUnauthenticated: false,
      image: "new",
      project: "my-project-01",
      region: "australia-southeast1",
      removeEnv: [],
      service: "desktop-api",
      serviceAccount: undefined,
    };
    const plan = unwrap(planRunDeploy({ options, policy: null, service }));
    const { send } = scriptedSend({
      answers: { "run-service-patch": [ok({ done: true, name: "operations/leak-123" })] },
    });
    const outcome = await approved({
      acknowledgements: [{ reason: "ship", subject: "gcp-edit-existing" }],
      plan,
      send,
    });
    expect(unwrap(doneResult({ outcome }))).toEqual([
      { detail: "operation <env API_TOKEN> done", id: "patch-service" },
    ]);
  });

  it("cuts the env values a describe already read out of the policy read's failure that follows it", async () => {
    const operation = "gcp.run.services.getIamPolicy";
    const { send } = scriptedSend({
      answers: {
        "run-iam-get": [
          err(
            GcpDoorErrors.transportFailed({ detail: "policy lookup failed for env-leak-7x", operation, status: 500 }),
          ),
        ],
        "run-service-get": [
          ok({
            etag: '"svc"',
            name: "projects/my-project-01/locations/australia-southeast1/services/desktop-api",
            template: { containers: [{ env: [{ name: "API_TOKEN", value: "env-leak-7x" }], image: "old" }] },
          }),
        ],
      },
    });
    const described = await describeRunService({
      ref: { project: "my-project-01", region: "australia-southeast1", service: "desktop-api" },
      send,
    });
    expect(unwrapErr(described).message).toBe(
      GcpDoorErrors.transportFailed({ detail: "policy lookup failed for <env API_TOKEN>", operation, status: 500 })
        .message,
    );
  });

  it("cuts an already-read payload out of a planning read's failure, though that read never carried it", async () => {
    const operation = "gcp.secretmanager.versions.list";
    const { send } = scriptedSend({
      answers: {
        "secret-version-list": [
          err(GcpDoorErrors.transportFailed({ detail: "permission denied on s3cret", operation, status: 403 })),
        ],
      },
    });
    const planned = await planWrite({
      options: { command: "secret add-version", payload, project: "my-project-01", secret: "s3cret" },
      send,
    });
    expect(unwrapErr(planned).message).toBe(
      GcpDoorErrors.transportFailed({ detail: "permission denied on <payload>", operation, status: 403 }).message,
    );
  });

  it("withholds a drifted access answer's validation detail, which names a key that can equal the payload", async () => {
    const answer = {
      name: "projects/my-project-01/secrets/s/versions/1",
      payload: { "123456789": true, data: "MTIzNDU2Nzg5", dataCrc32c: "3808858755" },
    };
    const { send } = scriptedSend({
      answers: {
        "secret-get": [ok({ "123456789": true, name: "projects/my-project-01/secrets/s" })],
        "secret-version-access": [ok(answer)],
      },
    });
    const ref = { project: "my-project-01", secret: "s" };
    const accessed = await callGcp({
      boundary: SECRET_ACCESS,
      request: { kind: "secret-version-access", ...ref, version: "1" },
      send,
    });
    expect(unwrapErr(accessed).message).toBe(
      GcpDoorErrors.responseChanged({
        detail: "detail withheld: this answer carries values the door never prints",
        endpoint: SECRET_ACCESS.endpoint,
      }).message,
    );
    // The witness that the withholding is what removed it: the same drift on a read carrying nothing names the key.
    const read = await callGcp({ boundary: SECRET, request: { kind: "secret-get", ...ref }, send });
    expect(unwrapErr(read).message).toContain("123456789");
  });

  it("refuses the public grant on a service it just created once another write has reached that service", async () => {
    const options = {
      allowUnauthenticated: true,
      image: "new",
      project: "my-project-01",
      region: "australia-southeast1",
      removeEnv: [],
      service: "desktop-api",
      serviceAccount: undefined,
    };
    const plan = unwrap(planRunDeploy({ options, policy: null, service: null }));
    const name = "projects/my-project-01/locations/australia-southeast1/services/desktop-api";
    const { send, sent } = scriptedSend({
      answers: {
        "run-service-create": [ok({ done: true, name: "operations/op1" })],
        "run-service-get": [ok({ etag: '"svc"', generation: "2", name, template: {} })],
      },
    });
    const outcome = await approved({ plan, send });
    expect(unwrapErr(doneResult({ outcome })).message).toBe(
      "stopped at step grant-public-invoker after create-service (operation operations/op1 done) had been performed — " +
        "nothing was rolled back: refused to build a request for roles/run.invoker for allUsers: the service this plan " +
        "created is at generation 2, so another write reached it first — preview again",
    );
    expect(sent.map((request) => request.kind)).toEqual(["run-service-create", "run-service-get"]);
  });

  it("cuts the env a grant's generation read found out of the policy read's failure after it", async () => {
    const options = {
      allowUnauthenticated: true,
      image: "new",
      project: "my-project-01",
      region: "australia-southeast1",
      removeEnv: [],
      service: "desktop-api",
      serviceAccount: undefined,
    };
    const plan = unwrap(planRunDeploy({ options, policy: null, service: null }));
    const name = "projects/my-project-01/locations/australia-southeast1/services/desktop-api";
    const { send } = scriptedSend({
      answers: {
        "run-iam-get": [
          err(
            GcpDoorErrors.transportFailed({
              detail: "policy lookup failed for env-leak-7x",
              operation: "gcp.run.services.getIamPolicy",
              status: 500,
            }),
          ),
        ],
        "run-service-create": [ok({ done: true, name: "operations/op1" })],
        "run-service-get": [
          ok({
            etag: '"svc"',
            generation: "1",
            name,
            template: { containers: [{ env: [{ name: "API_TOKEN", value: "env-leak-7x" }], image: "new" }] },
          }),
        ],
      },
    });
    const message = unwrapErr(doneResult({ outcome: await approved({ plan, send }) })).message;
    expect(message).toContain("policy lookup failed for <env API_TOKEN>");
    expect(message).not.toContain("env-leak-7x");
    // The generation refusal is cut against the same read: an env value equal to its own role text is gone.
    const raced = scriptedSend({
      answers: {
        "run-service-create": [ok({ done: true, name: "operations/op1" })],
        "run-service-get": [
          ok({
            etag: '"svc"',
            generation: "2",
            name,
            template: { containers: [{ env: [{ name: "API_TOKEN", value: "roles/run.invoker" }], image: "x" }] },
          }),
        ],
      },
    });
    const refusal = unwrapErr(doneResult({ outcome: await approved({ plan, send: raced.send }) })).message;
    expect(refusal).toContain("refused to build a request for <env API_TOKEN> for allUsers");
  });

  it("grants public invoker on a service it just created while that service is still at generation 1", async () => {
    const options = {
      allowUnauthenticated: true,
      image: "new",
      project: "my-project-01",
      region: "australia-southeast1",
      removeEnv: [],
      service: "desktop-api",
      serviceAccount: undefined,
    };
    const plan = unwrap(planRunDeploy({ options, policy: null, service: null }));
    const name = "projects/my-project-01/locations/australia-southeast1/services/desktop-api";
    const { send, sent } = scriptedSend({
      answers: {
        "run-iam-get": [ok({ etag: "p1" })],
        "run-iam-set": [ok({ etag: "p2" })],
        "run-service-create": [ok({ done: true, name: "operations/op1" })],
        "run-service-get": [ok({ etag: '"svc"', generation: "1", name, template: {} })],
      },
    });
    const outcome = await approved({ plan, send });
    expect(unwrap(doneResult({ outcome })).map((step) => step.id)).toEqual(["create-service", "grant-public-invoker"]);
    expect(sent.map((request) => request.kind)).toEqual([
      "run-service-create",
      "run-service-get",
      "run-iam-get",
      "run-iam-set",
    ]);
  });

  it("re-reads a policy at send time and sets exactly the one-member superset", async () => {
    const policy = { bindings: [{ members: ["user:b@example.com"], role: ACCESSOR }], etag: "p1", version: 1 };
    const plan = unwrap(planSecretBinding({ member: MEMBER, policy, ref: SECRET_REF, role: ACCESSOR }));
    const { send, sent } = scriptedSend({
      answers: { "secret-iam-get": [ok(policy)], "secret-iam-set": [ok(policy)] },
    });
    await approved({ plan, send });
    expect(sent[1]).toEqual({
      kind: "secret-iam-set",
      ...SECRET_REF,
      policy: { bindings: [{ members: ["user:b@example.com", MEMBER], role: ACCESSOR }], etag: "p1", version: 1 },
    });
  });

  it("refuses a grant whose policy moved since the preview, and never sets it", async () => {
    const policy = { bindings: [], etag: "p1" };
    const plan = unwrap(planSecretBinding({ member: MEMBER, policy, ref: SECRET_REF, role: ACCESSOR }));
    const { send, sent } = scriptedSend({ answers: { "secret-iam-get": [ok({ bindings: [], etag: "p2" })] } });
    const outcome = await approved({ plan, send });
    expect(unwrapErr(doneResult({ outcome })).message).toBe(
      `refused to build a request for ${ACCESSOR} for ${MEMBER}: the policy changed since it was planned against — preview again`,
    );
    expect(sent.map((request) => request.kind)).toEqual(["secret-iam-get"]);
  });

  it("answers OPERATION_DEFERRED when the operation is still running after the last attempt", async () => {
    const plan = unwrap(
      planServiceEnable({ project: "my-project-01", service: "run.googleapis.com", state: "DISABLED" }),
    );
    const running = ok({ done: false, name: "operations/acat.p2-123" });
    const { send, sent } = scriptedSend({
      answers: { "api-service-enable": [running], "operation-get": [running, running] },
    });
    const outcome = await approved({ plan, send });
    expect(unwrapErr(doneResult({ outcome })).code).toBe("OPERATION_DEFERRED");
    expect(sent.map((request) => request.kind)).toEqual(["api-service-enable", "operation-get", "operation-get"]);
  });

  it("records the edit-existing reason on the step's door row", async () => {
    const plan = unwrap(
      planSecretDisableVersion({
        ref: SECRET_REF,
        version: { etag: '"v2"', name: `${SECRET_NAME}/versions/2`, state: "ENABLED" },
      }),
    );
    const { send } = scriptedSend({
      answers: { "secret-version-disable": [ok({ name: `${SECRET_NAME}/versions/2`, state: "DISABLED" })] },
    });
    await approved({ acknowledgements: [{ reason: "rotated to v3", subject: "gcp-edit-existing" }], plan, send });
    expect(ledgerRows().map((row) => row["acknowledgements"])).toEqual([
      [{ reason: "rotated to v3", subject: "gcp-edit-existing" }],
    ]);
  });
});
