/**
 * Turning one `gcp <family> <action>`'s already-tokenised, already-shape-checked flags into its read options or
 * write spec. Pure. `gcpCore.ts` has proven every required flag present and every flag known to the action before
 * anything here runs, so a required flag is read with an honest non-null assertion.
 */
import { err, ok, type Result } from "#lib/result.js";
import { type GcpDoorError, GcpDoorErrors } from "../../../gcp/errors.js";
import { checkMember, checkName } from "../../../gcp/names.js";
import type { RunServiceRef, SecretRef } from "../../../gcp/request.js";
import type { GcpFamily, GcpReadOptions, GcpWriteSpec } from "./gcpCore.js";

/**
 * A refusal of the invocation itself.
 *
 * @param why what is wrong with the argv
 * @returns `INPUT_INVALID`
 */
export function invalid({ why }: { why: string }): Result<never, GcpDoorError> {
  return err(GcpDoorErrors.inputInvalid({ why }));
}

/** A required flag's value, which the table has already proven present. */
function required({ values, flag }: { values: Readonly<Record<string, string>>; flag: string }): string {
  return values[flag]!;
}

/** A `run` action's options. */
function runOptions({
  action,
  values,
  booleans,
}: {
  action: string;
  values: Readonly<Record<string, string>>;
  booleans: Readonly<Record<string, boolean>>;
}): Result<GcpReadOptions | GcpWriteSpec, GcpDoorError> {
  const ref: RunServiceRef = {
    project: required({ flag: "project", values }),
    region: required({ flag: "region", values }),
    service: required({ flag: "service", values }),
  };
  const service = checkName({ kind: "run-service", value: ref.service });
  if (service.isErr()) {
    return err(service.error);
  }
  if (action === "describe") {
    return ok({ read: "run describe", ref });
  }
  const removeEnv = values["remove-env"] === undefined ? [] : values["remove-env"].split(",").map((key) => key.trim());
  for (const key of removeEnv) {
    const env = checkName({ kind: "env-key", value: key });
    if (env.isErr()) {
      return err(GcpDoorErrors.inputInvalid({ why: `--remove-env: ${env.error.message}` }));
    }
  }
  return ok({
    kind: "ready",
    options: {
      ...ref,
      allowUnauthenticated: booleans["allow-unauthenticated"] === true,
      command: "run deploy",
      image: required({ flag: "image", values }),
      removeEnv,
      serviceAccount: values["service-account"],
    },
  });
}

/** The version `secret access` reads: the one `--version` names, else `latest`, the newest enabled one. */
function accessVersion({ values }: { values: Readonly<Record<string, string>> }): string {
  const named = values["version"];
  if (named === undefined) {
    return "latest";
  }
  return named;
}

/** A `secret` action's options. */
function secretOptions({
  action,
  values,
}: {
  action: string;
  values: Readonly<Record<string, string>>;
}): Result<GcpReadOptions | GcpWriteSpec, GcpDoorError> {
  const ref: SecretRef = {
    project: required({ flag: "project", values }),
    secret: required({ flag: "secret", values }),
  };
  switch (action) {
    case "describe":
      return ok({ read: "secret describe", ref });
    case "access":
      return ok({
        read: "secret access",
        ref,
        toFile: values["to-file"],
        version: accessVersion({ values }),
      });
    case "create":
    case "add-version":
      return ok({
        command: action === "create" ? "secret create" : "secret add-version",
        dataFile: values["data-file"],
        kind: "payload",
        ref,
      });
    case "disable-version": {
      const version = required({ flag: "version", values });
      if (version === "latest") {
        return invalid({ why: "--version: disable names an exact version number, never latest" });
      }
      return ok({ kind: "ready", options: { ...ref, command: "secret disable-version", version } });
    }
    default: {
      const member = checkMember({ member: required({ flag: "member", values }) });
      if (member.isErr()) {
        return err(member.error);
      }
      return ok({
        kind: "ready",
        options: {
          ...ref,
          command: "secret add-iam-policy-binding",
          member: member.value,
          role: required({ flag: "role", values }),
        },
      });
    }
  }
}

/** The options of a family with one coordinate set and no payload. */
function simpleOptions({
  family,
  action,
  values,
}: {
  family: "service-account" | "services" | "artifacts";
  action: string;
  values: Readonly<Record<string, string>>;
}): Result<GcpReadOptions | GcpWriteSpec, GcpDoorError> {
  const project = required({ flag: "project", values });
  if (family === "service-account") {
    return action === "describe"
      ? ok({ email: required({ flag: "email", values }), project, read: "service-account describe" })
      : ok({
          kind: "ready",
          options: {
            accountId: required({ flag: "account-id", values }),
            command: "service-account create",
            description: values["description"],
            displayName: values["display-name"],
            project,
          },
        });
  }
  if (family === "services") {
    const service = checkName({ kind: "api-service", value: required({ flag: "service", values }) });
    if (service.isErr()) {
      return err(service.error);
    }
    return action === "describe"
      ? ok({ project, read: "services describe", service: service.value })
      : ok({ kind: "ready", options: { command: "services enable", project, service: service.value } });
  }
  const region = required({ flag: "region", values });
  const repository = required({ flag: "repository", values });
  return action === "describe"
    ? ok({ project, read: "artifacts describe", region, repository })
    : ok({
        kind: "ready",
        options: { command: "artifacts create", description: values["description"], project, region, repository },
      });
}

/**
 * One family's options, dispatched by family.
 *
 * @param action the action the argv named, already proven one of the family's
 * @param values every string flag given, already shape-checked
 * @param booleans every boolean flag, given or not
 * @returns the read options or write spec, or `INPUT_INVALID`
 */
export function familyOptions({
  family,
  action,
  values,
  booleans,
}: {
  family: GcpFamily;
  action: string;
  values: Readonly<Record<string, string>>;
  booleans: Readonly<Record<string, boolean>>;
}): Result<GcpReadOptions | GcpWriteSpec, GcpDoorError> {
  if (family === "run") {
    return runOptions({ action, booleans, values });
  }
  if (family === "secret") {
    return secretOptions({ action, values });
  }
  return simpleOptions({ action, family, values });
}
