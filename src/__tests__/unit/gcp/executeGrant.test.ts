/**
 * One planned IAM grant performed as a read-merge-write over a plain fake sender: the member added and nothing
 * else, a policy that moved since the plan refused, and a service the plan just created granted only at the
 * generation a create leaves.
 */
import { describe, expect, it } from "vitest";

import type { GcpDoorError } from "../../../gcp/errors.js";
import { performGrant } from "../../../gcp/executeGrant.js";
import type { GcpStepAction } from "../../../gcp/plan.js";
import type { GcpDoorRequest } from "../../../gcp/request.js";
import type { GcpDoorSend } from "../../../gcp/transport.js";
import { ok, type Result, unwrap, unwrapErr } from "../../../lib/result.js";

const ACCESSOR = "roles/secretmanager.secretAccessor";
const INVOKER = "roles/run.invoker";
const MEMBER = "serviceAccount:a@my-project-01.iam.gserviceaccount.com";
const RUN_REF = { project: "my-project-01", region: "australia-southeast1", service: "desktop-api" } as const;
const SECRET_REF = { project: "my-project-01", secret: "desktop_client_id" } as const;

/** A sender answering each request kind from its own queue, recording every request it got. */
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

/** A Cloud Run service as Google answers it, at one generation. */
function service({ generation }: { generation: string }): unknown {
  return {
    etag: "s1",
    generation,
    name: "projects/my-project-01/locations/australia-southeast1/services/desktop-api",
    template: { containers: [{ env: [{ name: "TOKEN", value: "s3cr3t-value" }], image: "i" }] },
  };
}

const secretGrant: Extract<GcpStepAction, { kind: "grant" }> = {
  kind: "grant",
  member: MEMBER,
  readEtag: "e1",
  resource: { kind: "secret", ref: SECRET_REF },
  role: ACCESSOR,
};

describe("performGrant", () => {
  it("adds exactly the one member and sets the policy carrying the etag it read", async () => {
    const { send, sent } = scriptedSend({
      answers: {
        "secret-iam-get": [ok({ bindings: [{ members: ["user:x@example.com"], role: "roles/viewer" }], etag: "e1" })],
        "secret-iam-set": [ok({ etag: "e2" })],
      },
    });
    expect(unwrap(await performGrant({ action: secretGrant, send }))).toBe(`granted ${ACCESSOR} to ${MEMBER}`);
    expect(sent).toEqual([
      { kind: "secret-iam-get", ...SECRET_REF },
      {
        kind: "secret-iam-set",
        ...SECRET_REF,
        policy: {
          bindings: [
            { members: ["user:x@example.com"], role: "roles/viewer" },
            { members: [MEMBER], role: ACCESSOR },
          ],
          etag: "e1",
        },
      },
    ]);
  });

  it("refuses a policy whose etag moved since the plan, and sets nothing", async () => {
    const { send, sent } = scriptedSend({ answers: { "secret-iam-get": [ok({ etag: "e9" })] } });
    const refused = unwrapErr(await performGrant({ action: secretGrant, send }));
    expect(refused.code).toBe("REQUEST_REFUSED");
    expect(refused.message).toContain("the policy changed since it was planned against");
    expect(sent.map((request) => request.kind)).toEqual(["secret-iam-get"]);
  });

  it("refuses to grant on a just-created service another write reached first, cutting its env out", async () => {
    const { send, sent } = scriptedSend({ answers: { "run-service-get": [ok(service({ generation: "2" }))] } });
    const refused = unwrapErr(
      await performGrant({
        action: {
          kind: "grant",
          member: "allUsers",
          readEtag: null,
          resource: { kind: "run", ref: RUN_REF },
          role: INVOKER,
        },
        send,
      }),
    );
    expect(refused.code).toBe("REQUEST_REFUSED");
    expect(refused.message).toContain("at generation 2, so another write reached it first");
    expect(sent.map((request) => request.kind)).toEqual(["run-service-get"]);
  });

  it("grants on a just-created service still at generation 1", async () => {
    const { send, sent } = scriptedSend({
      answers: {
        "run-iam-get": [ok({ etag: "p1" })],
        "run-iam-set": [ok({ etag: "p2" })],
        "run-service-get": [ok(service({ generation: "1" }))],
      },
    });
    expect(
      unwrap(
        await performGrant({
          action: {
            kind: "grant",
            member: "allUsers",
            readEtag: null,
            resource: { kind: "run", ref: RUN_REF },
            role: INVOKER,
          },
          send,
        }),
      ),
    ).toBe(`granted ${INVOKER} to allUsers`);
    expect(sent.map((request) => request.kind)).toEqual(["run-service-get", "run-iam-get", "run-iam-set"]);
  });
});
