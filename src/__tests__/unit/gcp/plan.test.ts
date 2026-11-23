/**
 * The planners' additive/edit-existing classification, the deploy's template patch, and the digest: stable for
 * the same reads, moved by any drift, and never holding a secret byte or an env value.
 */
import { describe, expect, it } from "vitest";

import { editExistingSteps, gcpWriteDigest, planView, printablePlanView } from "../../../gcp/plan.js";
import { planServiceAccountCreate, planServiceEnable } from "../../../gcp/planProject.js";
import { patchedTemplate, planRunDeploy, type RunDeployOptions } from "../../../gcp/planRun.js";
import {
  planSecretAddVersion,
  planSecretBinding,
  planSecretCreate,
  planSecretDisableVersion,
} from "../../../gcp/planSecret.js";
import { encodeSecretPayload } from "../../../gcp/secretPayload.js";
import type { RunService } from "../../../gcp/wire.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

const IMAGE = "australia-southeast1-docker.pkg.dev/my-project-01/desktop/api:new";
const OLD_IMAGE = "australia-southeast1-docker.pkg.dev/my-project-01/desktop/api:old";
const SECRET_REF = { project: "my-project-01", secret: "desktop_client_id" } as const;
const PAYLOAD = unwrap(encodeSecretPayload({ bytes: new TextEncoder().encode("s3cret-value") }));

const deploy = (over: Partial<RunDeployOptions> = {}): RunDeployOptions => ({
  allowUnauthenticated: false,
  image: IMAGE,
  project: "my-project-01",
  region: "australia-southeast1",
  removeEnv: [],
  service: "desktop-api",
  serviceAccount: undefined,
  ...over,
});

const SERVICE: RunService = {
  etag: '"svc-etag"',
  name: "projects/my-project-01/locations/australia-southeast1/services/desktop-api",
  template: {
    client: "gcloud",
    containers: [
      {
        env: [
          { name: "API_TOKEN", value: "plain-text-credential" },
          { name: "OLD_FLAG", value: "1" },
          { name: "FROM_SECRET", valueSource: { secretKeyRef: { secret: "s", version: "latest" } } },
        ],
        image: OLD_IMAGE,
        resources: { limits: { memory: "512Mi" } },
      },
    ],
    scaling: { maxInstanceCount: 3 },
    serviceAccount: "desktop-api@my-project-01.iam.gserviceaccount.com",
  },
};

describe("patchedTemplate", () => {
  it("changes the image and drops the named env, carrying every other key verbatim", () => {
    const { template, changed } = unwrap(
      patchedTemplate({ options: deploy({ removeEnv: ["OLD_FLAG"] }), template: SERVICE.template }),
    );
    expect(template).toEqual({
      client: "gcloud",
      containers: [
        {
          env: [
            { name: "API_TOKEN", value: "plain-text-credential" },
            { name: "FROM_SECRET", valueSource: { secretKeyRef: { secret: "s", version: "latest" } } },
          ],
          image: IMAGE,
          resources: { limits: { memory: "512Mi" } },
        },
      ],
      scaling: { maxInstanceCount: 3 },
      serviceAccount: "desktop-api@my-project-01.iam.gserviceaccount.com",
    });
    expect(changed).toEqual([`image ${OLD_IMAGE} → ${IMAGE}`, "remove env OLD_FLAG"]);
  });

  it("refuses an env key the service does not have, and a service with two containers", () => {
    expect([
      unwrapErr(patchedTemplate({ options: deploy({ removeEnv: ["NOPE"] }), template: SERVICE.template })).message,
      unwrapErr(patchedTemplate({ options: deploy(), template: { containers: [{ image: "a" }, { image: "b" }] } }))
        .message,
    ]).toEqual([
      "--remove-env names no variable on the service: NOPE",
      "the service runs 2 containers; the door deploys to a service with exactly one",
    ]);
  });
});

describe("planRunDeploy", () => {
  it("creates a missing service as an additive step, and its public grant as additive too", () => {
    const plan = unwrap(
      planRunDeploy({ options: deploy({ allowUnauthenticated: true }), policy: null, service: null }),
    );
    expect(plan.steps.map((step) => [step.id, step.classification])).toEqual([
      ["create-service", "additive"],
      ["grant-public-invoker", "additive"],
    ]);
  });

  it("deploys onto an existing service as edit-existing, carrying its etag", () => {
    const plan = unwrap(planRunDeploy({ options: deploy(), policy: null, service: SERVICE }));
    expect(plan.steps.map((step) => [step.id, step.classification])).toEqual([["patch-service", "edit-existing"]]);
    expect(plan.steps[0]!.action).toMatchObject({ request: { etag: '"svc-etag"', kind: "run-service-patch" } });
  });

  it("makes an existing service public only as edit-existing", () => {
    const plan = unwrap(
      planRunDeploy({
        options: deploy({ allowUnauthenticated: true, image: OLD_IMAGE }),
        policy: { bindings: [], etag: "p1" },
        service: SERVICE,
      }),
    );
    expect(plan.steps.map((step) => [step.id, step.classification])).toEqual([
      ["grant-public-invoker", "edit-existing"],
    ]);
  });

  it("refuses a public grant on an existing service whose policy was read without an etag", () => {
    const error = unwrapErr(
      planRunDeploy({
        options: deploy({ allowUnauthenticated: true, image: OLD_IMAGE }),
        policy: { bindings: [] },
        service: SERVICE,
      }),
    );
    expect(error.code).toBe("REQUEST_REFUSED");
    expect(error.message).toContain("carried no etag");
  });

  it("answers NO_CHANGE when the service already runs the image and is already public as asked", () => {
    const error = unwrapErr(
      planRunDeploy({
        options: deploy({ allowUnauthenticated: true, image: OLD_IMAGE }),
        policy: { bindings: [{ members: ["allUsers"], role: "roles/run.invoker" }], etag: "p1" },
        service: SERVICE,
      }),
    );
    expect(error.code).toBe("NO_CHANGE");
  });

  it("cuts a literal env value out of the summary and the read even when it is byte-equal to the image", () => {
    const echoing: RunService = {
      ...SERVICE,
      template: { containers: [{ env: [{ name: "TOKEN", value: OLD_IMAGE }], image: OLD_IMAGE }] },
    };
    const plan = unwrap(planRunDeploy({ options: deploy(), policy: null, service: echoing }));
    expect(plan.steps[0]!.summary).toBe(
      `deploy a new revision of EXISTING service ${plan.target}, and traffic moves to it: image <env TOKEN> → ${IMAGE}`,
    );
    expect(plan.read).toMatchObject({ image: "<env TOKEN>" });
    expect(JSON.stringify(planView({ plan }))).not.toContain(OLD_IMAGE);
    expect(JSON.stringify(echoing)).toContain(OLD_IMAGE);
  });

  it("keeps the values out of the digest view, and cuts one byte-equal to the image asked for from the print", () => {
    const echoing: RunService = {
      ...SERVICE,
      template: { containers: [{ env: [{ name: "TOKEN", value: IMAGE }], image: OLD_IMAGE }] },
    };
    const plan = unwrap(planRunDeploy({ options: deploy(), policy: null, service: echoing }));
    expect(Object.keys(planView({ plan })).toSorted()).toEqual(["command", "project", "read", "steps", "target"]);
    expect(JSON.stringify(planView({ plan }))).toContain(IMAGE);
    expect(JSON.stringify(printablePlanView({ plan }))).not.toContain(IMAGE);
    expect(printablePlanView({ plan })).toMatchObject({
      steps: [{ action: { request: { template: { containers: [{ image: "<env TOKEN>" }] } } } }],
    });
  });

  it("cuts a read env value out of a --remove-env refusal that quotes the caller's name back", () => {
    const error = unwrapErr(
      planRunDeploy({ options: deploy({ removeEnv: ["plain-text-credential"] }), policy: null, service: SERVICE }),
    );
    expect(error.message).toBe("--remove-env names no variable on the service: <env API_TOKEN>");
  });

  it("refuses --remove-env on a service that does not exist", () => {
    expect(unwrapErr(planRunDeploy({ options: deploy({ removeEnv: ["A"] }), policy: null, service: null })).code).toBe(
      "INPUT_INVALID",
    );
  });
});

describe("the secret planners", () => {
  it("creates a secret and its first version, both additive, and refuses one that exists", () => {
    const plan = unwrap(planSecretCreate({ exists: false, payload: PAYLOAD, ref: SECRET_REF }));
    expect(plan.steps.map((step) => [step.id, step.classification])).toEqual([
      ["create-secret", "additive"],
      ["add-version", "additive"],
    ]);
    expect(unwrapErr(planSecretCreate({ exists: true, payload: undefined, ref: SECRET_REF })).code).toBe("NO_CHANGE");
  });

  it("adds a version as additive beside none enabled, and as edit-existing beside an enabled one", () => {
    const name = "projects/1/secrets/desktop_client_id/versions/1";
    expect(
      [
        planSecretAddVersion({ payload: PAYLOAD, ref: SECRET_REF, versions: [{ name, state: "DISABLED" }] }),
        planSecretAddVersion({ payload: PAYLOAD, ref: SECRET_REF, versions: [{ name, state: "ENABLED" }] }),
      ].map((planned) => unwrap(planned).steps[0]!.classification),
    ).toEqual(["additive", "edit-existing"]);
  });

  it("names a payload by length and sha256 in its summary, never its bytes", () => {
    const summary = unwrap(planSecretAddVersion({ payload: PAYLOAD, ref: SECRET_REF, versions: [] })).steps[0]!.summary;
    expect(summary).toBe(
      `add a version to projects/my-project-01/secrets/desktop_client_id: 12 bytes, sha256 ${PAYLOAD.fingerprint.sha256}`,
    );
  });

  it("disables an enabled version as edit-existing, NO_CHANGE for a disabled one, INPUT_INVALID for a destroyed one", () => {
    const name = "projects/1/secrets/desktop_client_id/versions/2";
    const plan = unwrap(
      planSecretDisableVersion({ ref: SECRET_REF, version: { etag: '"v2"', name, state: "ENABLED" } }),
    );
    expect(plan.steps[0]!.action).toEqual({
      kind: "send",
      request: { etag: '"v2"', kind: "secret-version-disable", ...SECRET_REF, version: "2" },
    });
    expect([
      unwrapErr(planSecretDisableVersion({ ref: SECRET_REF, version: { etag: "e", name, state: "DISABLED" } })).code,
      unwrapErr(planSecretDisableVersion({ ref: SECRET_REF, version: { etag: "e", name, state: "DESTROYED" } })).code,
    ]).toEqual(["NO_CHANGE", "INPUT_INVALID"]);
  });

  it("grants a member as additive, and a public member as edit-existing", () => {
    const policy = { bindings: [], etag: "p" };
    expect(
      ["serviceAccount:a@my-project-01.iam.gserviceaccount.com", "allAuthenticatedUsers"].map(
        (member) =>
          unwrap(planSecretBinding({ member, policy, ref: SECRET_REF, role: "roles/secretmanager.secretAccessor" }))
            .steps[0]!.classification,
      ),
    ).toEqual(["additive", "edit-existing"]);
  });
});

describe("the additive-only planners", () => {
  it("answers NO_CHANGE for an account that exists and an API already enabled", () => {
    expect([
      unwrapErr(
        planServiceAccountCreate({
          accountId: "desktop-api",
          description: undefined,
          displayName: undefined,
          exists: true,
          project: "my-project-01",
        }),
      ).code,
      unwrapErr(planServiceEnable({ project: "my-project-01", service: "run.googleapis.com", state: "ENABLED" })).code,
    ]).toEqual(["NO_CHANGE", "NO_CHANGE"]);
  });
});

describe("the digest", () => {
  const plan = unwrap(planRunDeploy({ options: deploy(), policy: null, service: SERVICE }));

  it("is the same for the same reads, and moves when the service's etag moves", () => {
    const again = unwrap(planRunDeploy({ options: deploy(), policy: null, service: SERVICE }));
    const moved = unwrap(planRunDeploy({ options: deploy(), policy: null, service: { ...SERVICE, etag: '"other"' } }));
    expect(gcpWriteDigest({ plan: again })).toBe(gcpWriteDigest({ plan }));
    expect(gcpWriteDigest({ plan: moved })).not.toBe(gcpWriteDigest({ plan }));
    expect(gcpWriteDigest({ plan })).toMatch(/^gcp-[0-9a-f]{16}$/);
  });

  it("moves when an env value moves, while the view never holds the value", () => {
    const changedEnv: RunService = {
      ...SERVICE,
      template: {
        ...SERVICE.template,
        containers: [{ ...SERVICE.template.containers![0]!, env: [{ name: "API_TOKEN", value: "rotated" }] }],
      },
    };
    const other = unwrap(planRunDeploy({ options: deploy(), policy: null, service: changedEnv }));
    expect(gcpWriteDigest({ plan: other })).not.toBe(gcpWriteDigest({ plan }));
    const view = JSON.stringify(planView({ plan }));
    expect(view).toContain('"name":"API_TOKEN","value":"sha256:');
    expect(view).not.toContain("plain-text-credential");
  });

  it("binds a secret payload by its sha256, never its base64", () => {
    const secretPlan = unwrap(planSecretAddVersion({ payload: PAYLOAD, ref: SECRET_REF, versions: [] }));
    const view = JSON.stringify(planView({ plan: secretPlan }));
    expect(view).toContain(`"dataSha256":"${PAYLOAD.fingerprint.sha256}"`);
    expect(view).toContain(`"dataCrc32c":"${PAYLOAD.dataCrc32c}"`);
    expect(view).not.toContain(PAYLOAD.data);
  });
});

describe("editExistingSteps", () => {
  it("names exactly the steps that edit, in order", () => {
    const plan = unwrap(
      planRunDeploy({
        options: deploy({ allowUnauthenticated: true }),
        policy: { bindings: [], etag: "p" },
        service: SERVICE,
      }),
    );
    expect(editExistingSteps({ plan }).map((step) => step.id)).toEqual(["patch-service", "grant-public-invoker"]);
  });
});
