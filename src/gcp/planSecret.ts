/**
 * Planning the Secret Manager writes: a secret create, a version added or disabled, and one IAM member granted.
 * The classification rule and the digest are `./plan.ts`'s; this file only plans the steps.
 */
import { err, ok, type Result } from "#lib/result.js";

import { type GcpDoorError, GcpDoorErrors } from "./errors.js";
import { addIamMember } from "./iam.js";
import { PUBLIC_MEMBERS } from "./names.js";
import { type GcpWriteClass, type GcpWritePlan, type GcpWriteStep, grantEtag, secretName } from "./plan.js";
import type { UnprintableValue } from "./redact.js";
import type { SecretRef } from "./request.js";
import type { EncodedSecretPayload } from "./secretPayload.js";
import type { IamPolicy, SecretVersion } from "./wire.js";

/**
 * Plan a secret create, and its first version when a payload was given.
 *
 * @param ref the secret
 * @param exists whether Google already holds it
 * @param payload the first version's payload, when `--data-file` named one
 * @returns the plan, or `NO_CHANGE` when the secret exists
 */
export function planSecretCreate({
  ref,
  exists,
  payload,
}: {
  ref: SecretRef;
  exists: boolean;
  payload: EncodedSecretPayload | undefined;
}): Result<GcpWritePlan, GcpDoorError> {
  const target = secretName({ ref });
  if (exists) {
    return err(
      GcpDoorErrors.noChange({
        what: `${target} already exists — add a version with \`slopweaver gcp secret add-version\``,
      }),
    );
  }
  const steps: GcpWriteStep[] = [
    {
      action: { kind: "send", request: { kind: "secret-create", ...ref } },
      classification: "additive",
      id: "create-secret",
      summary: `create secret ${target} (automatic replication)`,
    },
  ];
  if (payload === undefined) {
    return ok({ command: "secret create", project: ref.project, read: { exists }, steps, target });
  }
  steps.push(addVersionStep({ classification: "additive", payload, ref }));
  return ok({
    command: "secret create",
    project: ref.project,
    read: { exists },
    steps,
    target,
    unprintable: payloadUnprintable({ payload }),
  });
}

/**
 * A payload as the values a print of its plan must cut: its text, the way a terminal would show it, and its
 * base64 — a `--data-file` path the preview echoes is the caller's text, and nothing stops it equalling either.
 *
 * @returns the text and the base64, both labelled `<payload>`
 */
export function payloadUnprintable({ payload }: { payload: EncodedSecretPayload }): readonly UnprintableValue[] {
  return [
    { label: "<payload>", value: Buffer.from(payload.data, "base64").toString("utf8") },
    { label: "<payload>", value: payload.data },
  ];
}

/** The step adding one version, its summary naming the payload by length and hash only. */
function addVersionStep({
  ref,
  payload,
  classification,
}: {
  ref: SecretRef;
  payload: EncodedSecretPayload;
  classification: GcpWriteClass;
}): GcpWriteStep {
  const { length, sha256, trailingNewline } = payload.fingerprint;
  const tail = classification === "edit-existing" ? " — `latest` MOVES for every reader of this secret" : "";
  return {
    action: {
      kind: "send",
      request: { data: payload.data, dataCrc32c: payload.dataCrc32c, kind: "secret-version-add", ...ref },
    },
    classification,
    id: "add-version",
    summary:
      `add a version to ${secretName({ ref })}: ${String(length)} bytes, sha256 ${sha256}` +
      `${trailingNewline ? ", ENDS IN A NEWLINE" : ""}${tail}`,
  };
}

/**
 * Plan adding a version: additive when the secret has no enabled version, edit-existing when it does.
 *
 * @param ref the secret
 * @param versions every version as listed
 * @returns the plan
 */
export function planSecretAddVersion({
  ref,
  versions,
  payload,
}: {
  ref: SecretRef;
  versions: readonly SecretVersion[];
  payload: EncodedSecretPayload;
}): Result<GcpWritePlan, GcpDoorError> {
  const enabled = versions.filter((version) => version.state === "ENABLED").map((version) => version.name);
  return ok({
    command: "secret add-version",
    project: ref.project,
    read: { enabled: enabled.join(","), versions: versions.length },
    steps: [addVersionStep({ classification: enabled.length > 0 ? "edit-existing" : "additive", payload, ref })],
    target: secretName({ ref }),
    unprintable: payloadUnprintable({ payload }),
  });
}

/**
 * Plan disabling one version. Always edit-existing: whatever reads it stops working.
 *
 * @param ref the secret
 * @param version the version as read
 * @returns the plan, `NO_CHANGE` when it is already disabled, or `INPUT_INVALID` when it is destroyed
 */
export function planSecretDisableVersion({
  ref,
  version,
}: {
  ref: SecretRef;
  version: SecretVersion;
}): Result<GcpWritePlan, GcpDoorError> {
  if (version.state === "DISABLED") {
    return err(GcpDoorErrors.noChange({ what: `${version.name} is already disabled` }));
  }
  if (version.state !== "ENABLED") {
    return err(GcpDoorErrors.inputInvalid({ why: `${version.name} is ${String(version.state)}, not ENABLED` }));
  }
  const id = version.name.split("/").at(-1)!;
  if (version.etag === undefined) {
    return err(GcpDoorErrors.requestRefused({ what: version.name, why: "the version read carried no etag" }));
  }
  return ok({
    command: "secret disable-version",
    project: ref.project,
    read: { etag: version.etag, state: version.state },
    steps: [
      {
        action: { kind: "send", request: { etag: version.etag, kind: "secret-version-disable", ...ref, version: id } },
        classification: "edit-existing",
        id: "disable-version",
        summary: `disable ${version.name} — anything still reading it stops working`,
      },
    ],
    target: version.name,
  });
}

/**
 * Plan one IAM member on a secret: additive, except a public member, which is edit-existing.
 *
 * @param ref the secret
 * @param policy its policy as read
 * @returns the plan, or `NO_CHANGE` when the member already holds the role
 */
export function planSecretBinding({
  ref,
  policy,
  role,
  member,
}: {
  ref: SecretRef;
  policy: IamPolicy;
  role: string;
  member: string;
}): Result<GcpWritePlan, GcpDoorError> {
  const merged = addIamMember({ member, policy, role });
  if (merged.isErr()) {
    return err(merged.error);
  }
  const target = secretName({ ref });
  const isPublic = PUBLIC_MEMBERS.has(member);
  return ok({
    command: "secret add-iam-policy-binding",
    project: ref.project,
    read: { policyEtag: grantEtag({ policy }) },
    steps: [
      {
        action: { kind: "grant", member, readEtag: grantEtag({ policy }), resource: { kind: "secret", ref }, role },
        classification: isPublic ? "edit-existing" : "additive",
        id: "grant",
        summary: `grant ${role} to ${member} on ${target}${isPublic ? ", making it PUBLIC" : ""}`,
      },
    ],
    target,
  });
}
