/**
 * The `gcp` verb's pure core and what it prints: the parser refusing every flag an action would ignore, the
 * `--edit-existing` guard attaching a waiver only when an edit is planned, each failure's exit code, and the
 * printed lines never carrying a payload or an env value.
 */
import { describe, expect, it } from "vitest";

import { doorRefusalLines } from "../../../../../admit/doorRefusal.js";
import {
  editExistingGuard,
  type GcpFamily,
  gcpErrorExit,
  parseGcpInvocation,
} from "../../../../../cli/commands/gcp/gcpCore.js";
import {
  accessReport,
  heldLines,
  outcomeDocument,
  outcomeLines,
  payloadValues,
  previewCommand,
  previewLines,
  redactedRunDescription,
  runDescribeLines,
} from "../../../../../cli/commands/gcp/gcpLines.js";
import { EXIT_DEFERRED, EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import type { RunDescription } from "../../../../../gcp/describe.js";
import { GcpDoorErrors } from "../../../../../gcp/errors.js";
import { gcpWriteDigest } from "../../../../../gcp/plan.js";
import { planServiceEnable } from "../../../../../gcp/planProject.js";
import { planRunDeploy } from "../../../../../gcp/planRun.js";
import { planSecretAddVersion, planSecretCreate, planSecretDisableVersion } from "../../../../../gcp/planSecret.js";
import type { GcpDoorRequest } from "../../../../../gcp/request.js";
import { encodeSecretPayload } from "../../../../../gcp/secretPayload.js";
import { redactedDetail } from "../../../../../gcp/transport.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

const SECRET = ["--project", "my-project-01", "--secret", "desktop_client_id"] as const;
const RUN = ["--project", "my-project-01", "--region", "australia-southeast1", "--service", "desktop-api"] as const;
const SECRET_REF = { project: "my-project-01", secret: "desktop_client_id" } as const;

/** The refusal message one invocation earns. */
function refusal({ family, rest }: { family: GcpFamily; rest: readonly string[] }): string {
  return unwrapErr(parseGcpInvocation({ family, rest })).message;
}

describe("parseGcpInvocation", () => {
  it("parses a read, defaulting an access to the latest version", () => {
    expect(unwrap(parseGcpInvocation({ family: "secret", rest: ["access", ...SECRET] }))).toEqual({
      json: false,
      kind: "read",
      options: { read: "secret access", ref: SECRET_REF, toFile: undefined, version: "latest" },
    });
  });

  it("parses a write carrying its approval, its reason and its home", () => {
    const rest = [
      "disable-version",
      ...SECRET,
      "--version",
      "2",
      "--approve",
      "gcp-0123456789abcdef",
      "--edit-existing",
      "rotated",
    ];
    expect(unwrap(parseGcpInvocation({ family: "secret", rest }))).toEqual({
      approve: "gcp-0123456789abcdef",
      editExisting: "rotated",
      home: undefined,
      json: false,
      kind: "write",
      spec: { kind: "ready", options: { ...SECRET_REF, command: "secret disable-version", version: "2" } },
    });
  });

  it("leaves a payload as the path the shell reads, never its bytes", () => {
    const parsed = unwrap(
      parseGcpInvocation({ family: "secret", rest: ["add-version", ...SECRET, "--data-file", "/tmp/value"] }),
    );
    expect(parsed).toMatchObject({
      kind: "write",
      spec: { command: "secret add-version", dataFile: "/tmp/value", kind: "payload", ref: SECRET_REF },
    });
  });

  it("refuses an unknown action, naming the ones there are", () => {
    expect(refusal({ family: "services", rest: ["disable", "--project", "my-project-01"] })).toBe(
      "gcp services needs one of: describe, enable — got disable",
    );
  });

  it("refuses a flag the action would ignore and a missing required flag together", () => {
    expect(
      refusal({
        family: "run",
        rest: ["describe", "--project", "my-project-01", "--image", "x", "--region", "australia-southeast1"],
      }),
    ).toBe("--image means nothing to gcp run describe; gcp run describe needs --service");
  });

  it("refuses --approve on a describe and --edit-existing on a write that only adds", () => {
    expect([
      refusal({ family: "secret", rest: ["describe", ...SECRET, "--approve", "gcp-0123456789abcdef"] }),
      refusal({
        family: "services",
        rest: ["enable", "--project", "my-project-01", "--service", "run.googleapis.com", "--edit-existing", "x"],
      }),
    ]).toEqual([
      "--approve means nothing to gcp secret describe",
      // No services action takes it, so the family's own tokeniser refuses it before the action table is read.
      "unknown flag: --edit-existing; unexpected argument: x",
    ]);
  });

  it("refuses an approval that is not digest-shaped without echoing what was typed", () => {
    const message = refusal({
      family: "secret",
      rest: ["disable-version", ...SECRET, "--version", "2", "--approve", "env-leak-7x"],
    });
    expect(message).toBe("--approve takes the digest a preview printed: gcp- and 16 hex characters");
    expect(message).not.toContain("env-leak-7x");
  });

  it("refuses disabling latest, a blank value and a member that is not one", () => {
    expect([
      refusal({ family: "secret", rest: ["disable-version", ...SECRET, "--version", "latest"] }),
      refusal({ family: "run", rest: ["deploy", ...RUN, "--image", " "] }),
    ]).toEqual(["--version: disable names an exact version number, never latest", "--image is blank"]);
    const member = parseGcpInvocation({
      family: "secret",
      rest: [
        "add-iam-policy-binding",
        ...SECRET,
        "--role",
        "roles/secretmanager.secretAccessor",
        "--member",
        "a@b.com",
      ],
    });
    expect(unwrapErr(member).code).toBe("INPUT_INVALID");
  });
});

describe("editExistingGuard", () => {
  const editing = unwrap(
    planSecretDisableVersion({
      ref: SECRET_REF,
      version: { etag: '"v2"', name: "projects/1/secrets/desktop_client_id/versions/2", state: "ENABLED" },
    }),
  );
  const adding = unwrap(
    planServiceEnable({ project: "my-project-01", service: "run.googleapis.com", state: "DISABLED" }),
  );

  it("refuses an edit with no reason, in the four-line refusal shape", () => {
    const error = unwrapErr(editExistingGuard({ editExisting: undefined, plan: editing }));
    expect(error.code).toBe("EDIT_EXISTING_REFUSED");
    expect(error.message.split("\n").length).toBe(4);
    expect(error.message).toContain(editing.steps[0]!.summary);
  });

  it("acknowledges a given reason, trimmed, only when an edit is planned", () => {
    expect([
      unwrap(editExistingGuard({ editExisting: " rotated to v3 ", plan: editing })),
      unwrap(editExistingGuard({ editExisting: "unneeded", plan: adding })),
    ]).toEqual([[{ reason: "rotated to v3", subject: "gcp-edit-existing" }], []]);
  });

  it("cuts an env value byte-equal to the image out of the refusal it prints", () => {
    const image = "us-docker.pkg.dev/my-project-01/repo/new:v2";
    const deploying = unwrap(
      planRunDeploy({
        options: {
          allowUnauthenticated: false,
          image,
          project: "my-project-01",
          region: "australia-southeast1",
          removeEnv: [],
          service: "desktop-api",
          serviceAccount: undefined,
        },
        policy: null,
        service: {
          etag: '"svc"',
          name: "projects/my-project-01/locations/australia-southeast1/services/desktop-api",
          template: { containers: [{ env: [{ name: "API_TOKEN", value: image }], image: "old" }] },
        },
      }),
    );
    const error = unwrapErr(editExistingGuard({ editExisting: undefined, plan: deploying }));
    expect(error.message).toContain("<env API_TOKEN>");
    expect(error.message).not.toContain(image);
  });

  it("cuts a reason that carries the payload, since the reason rides the door ledger", () => {
    const rotating = unwrap(
      planSecretAddVersion({
        payload: unwrap(encodeSecretPayload({ bytes: new TextEncoder().encode("s3cret") })),
        ref: SECRET_REF,
        versions: [{ name: "projects/1/secrets/desktop_client_id/versions/1", state: "ENABLED" }],
      }),
    );
    expect(unwrap(editExistingGuard({ editExisting: "rotate s3cret", plan: rotating }))).toEqual([
      { reason: "rotate <payload>", subject: "gcp-edit-existing" },
    ]);
  });
});

describe("gcpErrorExit", () => {
  it("answers usage, expected-empty, deferred and error by what the failure means", () => {
    expect([
      gcpErrorExit({ error: GcpDoorErrors.inputInvalid({ why: "x" }) }),
      gcpErrorExit({ error: GcpDoorErrors.noChange({ what: "x" }) }),
      gcpErrorExit({ error: GcpDoorErrors.operationDeferred({ operation: "operations/1" }) }),
      gcpErrorExit({ error: GcpDoorErrors.transportFailed({ detail: "x", operation: "y", status: 500 }) }),
    ]).toEqual([EXIT_USAGE, EXIT_EXPECTED_EMPTY, EXIT_DEFERRED, EXIT_ERROR]);
  });
});

describe("redactedDetail", () => {
  it("cuts a version add's payload out of a failure's detail, and leaves any other detail alone", () => {
    const add = { data: "czNjcmV0", dataCrc32c: "1", kind: "secret-version-add", ...SECRET_REF } as const;
    expect([
      redactedDetail({ detail: "bad payload czNjcmV0 rejected", request: add }),
      redactedDetail({ detail: "czNjcmV0", request: { kind: "secret-get", ...SECRET_REF } }),
    ]).toEqual(["bad payload <payload> rejected", "czNjcmV0"]);
  });

  it("cuts every literal env value a deploy carries forward, the longer one first", () => {
    const patch: GcpDoorRequest = {
      etag: "e",
      kind: "run-service-patch",
      project: "my-project-01",
      region: "australia-southeast1",
      service: "desktop-api",
      template: {
        containers: [
          {
            env: [
              { name: "SHORT", value: "tok" },
              { name: "API_TOKEN", value: "tok-literal-7x" },
              { name: "FROM_SECRET", valueSource: { secretKeyRef: { secret: "s", version: "latest" } } },
            ],
            image: "a",
          },
        ],
      },
    };
    expect(redactedDetail({ detail: "invalid env value tok-literal-7x near tok", request: patch })).toBe(
      "invalid env value <env API_TOKEN> near <env SHORT>",
    );
  });
});

describe("the printed lines", () => {
  it("drop every env value from a run description, keeping names and secret references", () => {
    const description: RunDescription = {
      policy: { bindings: [], etag: "p" },
      service: {
        conditions: [{ message: "revision rejected for plain-text-credential", type: "Ready" }],
        etag: "s",
        name: "projects/my-project-01/locations/australia-southeast1/services/desktop-api",
        template: {
          containers: [
            {
              env: [
                { name: "API_TOKEN", value: "plain-text-credential" },
                { name: "FROM_SECRET", valueSource: { secretKeyRef: { secret: "s", version: "latest" } } },
              ],
              image: "a",
            },
          ],
          labels: { "plain-text-credential": "x" },
        },
        terminalCondition: { message: "rejected env value plain-text-credential", state: "CONDITION_FAILED" },
      },
    };
    const redacted = redactedRunDescription({ description });
    expect(redacted).toEqual({
      policy: { bindings: [], etag: "p" },
      service: {
        conditions: [{ message: "revision rejected for <env API_TOKEN>", type: "Ready" }],
        etag: "s",
        name: "projects/my-project-01/locations/australia-southeast1/services/desktop-api",
        template: {
          containers: [
            {
              env: [
                { name: "API_TOKEN", valueSource: undefined },
                { name: "FROM_SECRET", valueSource: { secretKeyRef: { secret: "s", version: "latest" } } },
              ],
              image: "a",
            },
          ],
          labels: { "<env API_TOKEN>": "x" },
        },
        terminalCondition: { message: "rejected env value <env API_TOKEN>", state: "CONDITION_FAILED" },
      },
    });
    expect(JSON.stringify(redacted)).not.toContain("plain-text-credential");
    expect(runDescribeLines({ description }).find((line) => line.startsWith("  state:"))).toBe(
      "  state: CONDITION_FAILED — rejected env value <env API_TOKEN>",
    );
    expect(runDescribeLines({ description }).join("\n")).not.toContain("plain-text-credential");
    expect(JSON.stringify(description)).toContain("plain-text-credential");
  });

  it("name an accessed secret by its fingerprint and the file it went to", () => {
    const fingerprint = { length: 4, sha256: "abc", trailingNewline: true };
    expect(
      accessReport({
        fingerprint,
        name: "projects/1/secrets/s/versions/3",
        toFile: "/tmp/out",
        values: payloadValues({ bytes: new TextEncoder().encode("s3cret") }),
      }),
    ).toEqual({
      lines: [
        "projects/1/secrets/s/versions/3: 4 bytes, sha256 abc, ends in a newline — CRC32C checked",
        "  written to /tmp/out (new file, mode 0600)",
      ],
      value: { ...fingerprint, name: "projects/1/secrets/s/versions/3", toFile: "/tmp/out" },
    });
  });

  it("cut the payload out of an echoed path that is byte-equal to it, in text and JSON alike", () => {
    const report = accessReport({
      fingerprint: { length: 12, sha256: "abc", trailingNewline: false },
      name: "projects/1/secrets/s/versions/3",
      toFile: "/tmp/leak-me",
      values: payloadValues({ bytes: new TextEncoder().encode("/tmp/leak-me") }),
    });
    expect(report.lines.at(-1)).toBe("  written to <payload> (new file, mode 0600)");
    expect(JSON.stringify(report)).not.toContain("/tmp/leak-me");
  });

  it("cut a payload byte-equal to the target out of a sent write's lines and its --json document", () => {
    const target = "projects/my-project-01/secrets/desktop_client_id";
    const plan = unwrap(
      planSecretCreate({
        exists: false,
        payload: unwrap(encodeSecretPayload({ bytes: new TextEncoder().encode(target) })),
        ref: SECRET_REF,
      }),
    );
    const outcomes = [{ detail: `created ${target}`, id: "create-secret" }];
    expect(outcomeLines({ outcomes, plan })).toEqual([
      "gcp secret create on <payload> — sent, each step recorded in the door ledger",
      "  ✓ create-secret: created <payload>",
    ]);
    expect(outcomeDocument({ digest: "gcp-1111", outcomes, plan })).toEqual({
      digest: "gcp-1111",
      outcomes: [{ detail: "created <payload>", id: "create-secret" }],
      sent: true,
    });
  });

  it("preview every step and the exact command that sends it, asking for a reason only on an edit", () => {
    const plan = unwrap(
      planSecretDisableVersion({
        ref: SECRET_REF,
        version: { etag: '"v2"', name: "projects/1/secrets/desktop_client_id/versions/2", state: "ENABLED" },
      }),
    );
    const digest = gcpWriteDigest({ plan });
    expect(previewLines({ digest, plan, preview: "slopweaver gcp secret disable-version" })).toEqual([
      `gcp secret disable-version on ${plan.target} — PREVIEW, nothing was sent`,
      `  1. [edit-existing] ${plan.steps[0]!.summary}`,
      `digest: ${digest}`,
      `to send exactly this: slopweaver gcp secret disable-version --approve ${digest} --edit-existing "<why>"`,
    ]);
  });

  it("cut an env value byte-equal to the image asked for out of every preview line, the echoed command included", () => {
    // The quote is the point: shell quoting escapes it, so only a cut made before quoting still finds the value.
    const image = "us-docker.pkg.dev/my-project-01/repo/new:it's";
    const plan = unwrap(
      planRunDeploy({
        options: {
          allowUnauthenticated: false,
          image,
          project: "my-project-01",
          region: "australia-southeast1",
          removeEnv: [],
          service: "desktop-api",
          serviceAccount: undefined,
        },
        policy: null,
        service: {
          etag: '"svc"',
          name: "projects/my-project-01/locations/australia-southeast1/services/desktop-api",
          template: { containers: [{ env: [{ name: "API_TOKEN", value: image }], image: "old" }] },
        },
      }),
    );
    const lines = previewLines({ digest: "gcp-0", plan, preview: `slopweaver gcp run deploy --image ${image}` });
    expect(lines.at(-1)).toBe(
      'to send exactly this: slopweaver gcp run deploy --image <env API_TOKEN> --approve gcp-0 --edit-existing "<why>"',
    );
    expect(lines.join("\n")).not.toContain(image);
    // A one-byte value never touches the digest, the one token the approval is typed with.
    const short = unwrap(
      planSecretAddVersion({
        payload: unwrap(encodeSecretPayload({ bytes: new TextEncoder().encode("1") })),
        ref: SECRET_REF,
        versions: [],
      }),
    );
    const shortLines = previewLines({ digest: "gcp-1111", plan: short, preview: "slopweaver gcp secret add-version" });
    expect(shortLines.slice(-2)).toEqual([
      "digest: gcp-1111",
      "to send exactly this: slopweaver gcp secret add-version --approve gcp-1111",
    ]);
    // A version add's plan carries its own payload, so a `--data-file` path equal to it is cut from the echo.
    const echoed = unwrap(
      planSecretAddVersion({
        payload: unwrap(encodeSecretPayload({ bytes: new TextEncoder().encode("leak-me") })),
        ref: SECRET_REF,
        versions: [],
      }),
    );
    expect(previewCommand({ family: "secret", plan: echoed, rest: ["add-version", "--data-file", "leak-me"] })).toBe(
      "slopweaver gcp secret add-version --data-file '<payload>'",
    );
    // The command an approval hold and the door's refusal echo is built cut, approval and reason dropped.
    expect(
      previewCommand({
        family: "run",
        plan,
        rest: ["deploy", "--image", image, "--approve", "gcp-0000000000000000", "--edit-existing=ship"],
      }),
    ).toBe("slopweaver gcp run deploy --image '<env API_TOKEN>'");
    // A door hold's finding text is cut too: the door's and the caller's text, rendered by the one renderer.
    const decision = {
      findings: [
        { code: "PROFILE_NOT_LOADED", correction: "reload the profile", severity: "hold" as const, summary: image },
      ],
      overridden: [],
      status: "hold" as const,
    };
    expect(doorRefusalLines({ command: "slopweaver gcp run deploy", decision }).join("\n")).toContain(image);
    expect(heldLines({ decision, plan, preview: "slopweaver gcp run deploy" })[1]).toBe(
      "slopweaver gcp run deploy blocked because <env API_TOKEN> [PROFILE_NOT_LOADED].",
    );
    expect(heldLines({ decision, plan, preview: "slopweaver gcp run deploy" }).join("\n")).not.toContain(image);
  });
});
