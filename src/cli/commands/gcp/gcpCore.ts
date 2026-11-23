/**
 * The PURE core of `slopweaver gcp`: which flags each action takes, parsing an invocation into a closed union,
 * the `--edit-existing` guard and the exit code each failure earns. No fs, no clock, no network — `gcpRun.ts`
 * does every read, every call and every door request, and `gcpLines.ts` owns what is printed.
 *
 * Each action names exactly the flags it reads, so a flag it would ignore is refused rather than silently
 * dropped: `--approve` on a describe, `--edit-existing` on a write that can only ever add, `--image` on a
 * secret. A secret payload never enters argv — `--data-file` names a file, and only its path is parsed here.
 */
import { err, ok, type Result } from "#lib/result.js";
import type { DoorAcknowledgement } from "../../../admit/types.js";
import { type GcpDoorError, GcpDoorErrors } from "../../../gcp/errors.js";
import { checkName } from "../../../gcp/names.js";
import type { GcpWriteOptions } from "../../../gcp/operations.js";
import { editExistingSteps, type GcpWritePlan, planUnprintable } from "../../../gcp/plan.js";
import { cutValues } from "../../../gcp/redact.js";
import type { RunServiceRef, SecretRef } from "../../../gcp/request.js";
import { hatchFor } from "../../../hatch/lookup.js";
import { hatchRefusalLines } from "../../../hatch/render.js";
import { EXIT_DEFERRED, EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_USAGE } from "../../exitCodes.js";
import { parseFlags } from "../../parseFlags.js";
import { familyOptions, invalid } from "./gcpOptions.js";

/** The `gcp` families, each a manifest verb. */
export type GcpFamily = "run" | "secret" | "service-account" | "services" | "artifacts";

/** One action's flags: those it reads, and those it cannot run without. */
interface ActionSpec {
  readonly flags: readonly string[];
  readonly required: readonly string[];
}

/** The boolean flags; every other flag takes a value. */
const BOOLEAN_FLAGS = ["json", "allow-unauthenticated"] as const;

/** The flags every write shares. */
const WRITE_FLAGS = ["approve", "home", "json"] as const;

/** Every action of every family, and its flags. */
const ACTIONS: Readonly<Record<GcpFamily, Readonly<Record<string, ActionSpec>>>> = {
  artifacts: {
    create: {
      flags: ["project", "region", "repository", "description", ...WRITE_FLAGS],
      required: ["project", "region", "repository"],
    },
    describe: { flags: ["project", "region", "repository", "json"], required: ["project", "region", "repository"] },
  },
  run: {
    deploy: {
      flags: [
        "project",
        "region",
        "service",
        "image",
        "service-account",
        "remove-env",
        "allow-unauthenticated",
        "edit-existing",
        ...WRITE_FLAGS,
      ],
      required: ["project", "region", "service", "image"],
    },
    describe: { flags: ["project", "region", "service", "json"], required: ["project", "region", "service"] },
  },
  secret: {
    access: { flags: ["project", "secret", "version", "to-file", "json"], required: ["project", "secret"] },
    "add-iam-policy-binding": {
      flags: ["project", "secret", "role", "member", "edit-existing", ...WRITE_FLAGS],
      required: ["project", "secret", "role", "member"],
    },
    "add-version": {
      flags: ["project", "secret", "data-file", "edit-existing", ...WRITE_FLAGS],
      required: ["project", "secret", "data-file"],
    },
    create: { flags: ["project", "secret", "data-file", ...WRITE_FLAGS], required: ["project", "secret"] },
    describe: { flags: ["project", "secret", "json"], required: ["project", "secret"] },
    "disable-version": {
      flags: ["project", "secret", "version", "edit-existing", ...WRITE_FLAGS],
      required: ["project", "secret", "version"],
    },
  },
  "service-account": {
    create: {
      flags: ["project", "account-id", "display-name", "description", ...WRITE_FLAGS],
      required: ["project", "account-id"],
    },
    describe: { flags: ["project", "email", "json"], required: ["project", "email"] },
  },
  services: {
    describe: { flags: ["project", "service", "json"], required: ["project", "service"] },
    enable: { flags: ["project", "service", ...WRITE_FLAGS], required: ["project", "service"] },
  },
};

/**
 * The flag spec the tokeniser reads for one family: every flag any of its actions takes.
 *
 * @returns the string and boolean flag names
 */
function gcpFlagSpec({ family }: { family: GcpFamily }): { string: string[]; boolean: string[] } {
  const all = new Set(Object.values(ACTIONS[family]).flatMap((action) => action.flags));
  const booleans = BOOLEAN_FLAGS.filter((flag) => all.has(flag));
  return {
    boolean: [...booleans],
    string: [...all].filter((flag) => !(BOOLEAN_FLAGS as readonly string[]).includes(flag)),
  };
}

/**
 * One family's flags in `--flag` form, for the help ratchet.
 *
 * @returns every flag any of its actions accepts
 */
export function gcpFlagNames({ family }: { family: GcpFamily }): readonly string[] {
  const spec = gcpFlagSpec({ family });
  return [...spec.string, ...spec.boolean].map((name) => `--${name}`);
}

/** Every read the door performs. */
export type GcpReadOptions =
  | { readonly read: "run describe"; readonly ref: RunServiceRef }
  | { readonly read: "secret describe"; readonly ref: SecretRef }
  | {
      readonly read: "secret access";
      readonly ref: SecretRef;
      readonly version: string;
      readonly toFile: string | undefined;
    }
  | { readonly read: "service-account describe"; readonly project: string; readonly email: string }
  | { readonly read: "services describe"; readonly project: string; readonly service: string }
  | {
      readonly read: "artifacts describe";
      readonly project: string;
      readonly region: string;
      readonly repository: string;
    };

/** A write whose payload, if it has one, is still a file path the shell reads. */
export type GcpWriteSpec =
  | {
      readonly kind: "ready";
      readonly options: Exclude<GcpWriteOptions, { readonly command: "secret create" | "secret add-version" }>;
    }
  | {
      readonly kind: "payload";
      readonly command: "secret create" | "secret add-version";
      readonly ref: SecretRef;
      readonly dataFile: string | undefined;
    };

/** One validated `gcp` invocation. */
export type GcpInvocation =
  | { readonly kind: "read"; readonly options: GcpReadOptions; readonly json: boolean }
  | {
      readonly kind: "write";
      readonly spec: GcpWriteSpec;
      readonly approve: string | undefined;
      readonly editExisting: string | undefined;
      readonly home: string | undefined;
      readonly json: boolean;
    };

/** A write invocation. */
export type GcpWriteInvocation = Extract<GcpInvocation, { readonly kind: "write" }>;

/** The string-valued flags the tokeniser read. */
function stringValues({ parsed }: { parsed: Readonly<Record<string, unknown>> }): Readonly<Record<string, string>> {
  const values: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value === "string") {
      values[key] = value;
    }
  }
  return values;
}

/** The common coordinates, each checked against its shape. */
function checked({
  values,
  pairs,
}: {
  values: Readonly<Record<string, string>>;
  pairs: readonly (readonly [string, Parameters<typeof checkName>[0]["kind"]])[];
}): Result<void, GcpDoorError> {
  for (const [flag, kind] of pairs) {
    const value = values[flag];
    if (value !== undefined) {
      const result = checkName({ kind, value });
      if (result.isErr()) {
        return err(GcpDoorErrors.inputInvalid({ why: `--${flag}: ${result.error.message}` }));
      }
    }
  }
  return ok(undefined);
}

/** The one shape `gcpWriteDigest` answers in. */
const APPROVAL_DIGEST = /^gcp-[0-9a-f]{16}$/;

/** The shape each value flag must take. */
const FLAG_SHAPES: readonly (readonly [string, Parameters<typeof checkName>[0]["kind"]])[] = [
  ["project", "project"],
  ["region", "region"],
  ["image", "image"],
  ["service-account", "service-account"],
  ["email", "service-account"],
  ["secret", "secret"],
  ["version", "secret-version"],
  ["role", "role"],
  ["account-id", "account-id"],
  ["repository", "repository"],
  ["display-name", "text"],
  ["description", "text"],
];

/** Every flag an action does not take, every required one missing, and every one given blank. */
function flagProblems({
  verb,
  spec,
  values,
  booleans,
}: {
  verb: string;
  spec: { readonly flags: readonly string[]; readonly required: readonly string[] };
  values: Readonly<Record<string, string>>;
  booleans: Readonly<Record<string, boolean>>;
}): readonly string[] {
  const given = [...Object.keys(values), ...Object.keys(booleans).filter((flag) => booleans[flag] === true)];
  return [
    ...given.filter((flag) => !spec.flags.includes(flag)).map((flag) => `--${flag} means nothing to ${verb}`),
    ...spec.required.filter((flag) => values[flag] === undefined).map((flag) => `${verb} needs --${flag}`),
    ...Object.entries(values)
      .filter(([, value]) => value.trim() === "")
      .map(([flag]) => `--${flag} is blank`),
  ];
}

/**
 * Parse one `gcp <family>` invocation.
 *
 * @param family the family the manifest dispatched
 * @param rest the argv tail after the family: the action, then its flags
 * @returns the validated invocation, or `INPUT_INVALID` naming every flag problem
 */
export function parseGcpInvocation({
  family,
  rest,
}: {
  family: GcpFamily;
  rest: readonly string[];
}): Result<GcpInvocation, GcpDoorError> {
  const [action, ...tail] = rest;
  const actions = ACTIONS[family];
  const spec = action === undefined ? undefined : actions[action];
  if (action === undefined || spec === undefined) {
    return invalid({
      why: `gcp ${family} needs one of: ${Object.keys(actions).join(", ")}${action === undefined ? "" : ` — got ${action}`}`,
    });
  }
  const parsed = parseFlags({ allowPositionals: false, args: tail, spec: gcpFlagSpec({ family }) });
  if (parsed.isErr()) {
    return invalid({ why: parsed.error.join("; ") });
  }
  const values = stringValues({ parsed: parsed.value.values });
  const booleans: Readonly<Record<string, boolean>> = {
    "allow-unauthenticated": parsed.value.values["allow-unauthenticated"] === true,
    json: parsed.value.values["json"] === true,
  };
  const problems = flagProblems({ booleans, spec, values, verb: `gcp ${family} ${action}` });
  if (problems.length > 0) {
    return invalid({ why: problems.join("; ") });
  }
  const shapes = checked({ pairs: FLAG_SHAPES, values });
  if (shapes.isErr()) {
    return err(shapes.error);
  }
  // Refused without echoing it: an approval only ever names a digest, so nothing else typed there — a value that
  // happens to equal an env value included — reaches a refusal or the ledger.
  const approve = values["approve"];
  if (approve !== undefined && !APPROVAL_DIGEST.test(approve)) {
    return invalid({ why: "--approve takes the digest a preview printed: gcp- and 16 hex characters" });
  }
  const options = familyOptions({ action, booleans, family, values });
  if (options.isErr()) {
    return err(options.error);
  }
  const json = booleans["json"] === true;
  const parsedAction = options.value;
  if ("read" in parsedAction) {
    return ok({ json, kind: "read", options: parsedAction });
  }
  return ok({
    approve,
    editExisting: values["edit-existing"],
    home: values["home"],
    json,
    kind: "write",
    spec: parsedAction,
  });
}

/**
 * Refuse a plan holding an edit-existing step unless `--edit-existing` named why, and turn a given reason into
 * the acknowledgement every step's door row records. The acknowledgement is attached ONLY when an
 * edit-existing step is actually planned — a waiver for a refusal that never fired would read in the ledger
 * exactly like a real one (`../../../admit/types.ts` § AcknowledgeableSubject).
 *
 * @param plan the plan, as just built from a fresh read
 * @param editExisting the reason given, if any
 * @returns the acknowledgements to attach, empty when none is needed, or the four-line refusal
 */
export function editExistingGuard({
  plan,
  editExisting,
}: {
  plan: GcpWritePlan;
  editExisting: string | undefined;
}): Result<readonly DoorAcknowledgement[], GcpDoorError> {
  const edits = editExistingSteps({ plan });
  if (edits.length === 0) {
    return ok([]);
  }
  // Both the refusal (on stderr) and the reason (in the door ledger) are cut like every other text the plan's
  // values could equal.
  const values = planUnprintable({ plan });
  if (editExisting === undefined) {
    const lines = hatchRefusalLines({
      detail: cutValues({ text: edits.map((step) => step.summary).join("; "), values }),
      hatch: hatchFor({ id: "gcp-edit-existing" }),
    });
    return err(GcpDoorErrors.editExistingRefused({ lines }));
  }
  const reason = cutValues({ text: editExisting.trim(), values });
  return ok([{ reason, subject: "gcp-edit-existing" }]);
}

/**
 * The exit code one failure earns: `2` for an invocation that is not one, `3` for nothing to do or a refusal
 * (the verb worked; the answer is no), `4` for an operation still running, `1` for a call that failed.
 *
 * @param error the failure
 * @returns the exit code
 */
export function gcpErrorExit({ error }: { error: GcpDoorError }): number {
  switch (error.code) {
    case "INPUT_INVALID":
      return EXIT_USAGE;
    case "NO_CHANGE":
    case "EDIT_EXISTING_REFUSED":
    case "NOT_FOUND":
      return EXIT_EXPECTED_EMPTY;
    case "OPERATION_DEFERRED":
      return EXIT_DEFERRED;
    case "REQUEST_REFUSED":
    case "TRANSPORT_FAILED":
    case "RESPONSE_CHANGED":
    case "OPERATION_FAILED":
    case "SECRET_INTEGRITY_FAILED":
    case "SECRET_FILE_FAILED":
    case "PARTIAL_WRITE":
      return EXIT_ERROR;
    default: {
      const unreachable: never = error;
      return unreachable;
    }
  }
}
