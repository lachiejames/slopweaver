/**
 * Everything `slopweaver gcp` prints, as pure functions of what was read or planned. Secret-safe by
 * construction: no function here is ever handed a payload's bytes — an accessed secret arrives as its
 * fingerprint, a version add as its plan step's summary — and an env var is printed by NAME, never value.
 */
import { shellCommandLine } from "#lib/shellCommandLine.js";

import { doorRefusalLines } from "../../../admit/doorRefusal.js";
import type { DoorDecision } from "../../../admit/types.js";
import type { RunDescription, SecretDescription } from "../../../gcp/describe.js";
import type { GcpStepOutcome } from "../../../gcp/execute.js";
import { bindingsOf, containersOf, membersOf } from "../../../gcp/lists.js";
import { type GcpWritePlan, planUnprintable, policyGrants, RUN_INVOKER } from "../../../gcp/plan.js";
import { cutValues, cutValuesDeep, literalEnvValues, type UnprintableValue } from "../../../gcp/redact.js";
import type { SecretFingerprint } from "../../../gcp/secretPayload.js";
import type { IamPolicy, RunService } from "../../../gcp/wire.js";

import type { GcpFamily } from "./gcpCore.js";

/**
 * A policy's grants, one line per role.
 *
 * @returns `  role: member, member` lines, a conditional grant marked with its title
 */
function policyLines({ policy }: { policy: IamPolicy }): readonly string[] {
  const bindings = bindingsOf({ policy });
  if (bindings.length === 0) {
    return ["  (no bindings)"];
  }
  return bindings.map((binding) => {
    const members = membersOf({ binding });
    const condition = binding.condition === undefined ? "" : ` [if ${String(binding.condition.title)}]`;
    return `  ${binding.role}${condition}: ${members.join(", ")}`;
  });
}

/** The account a service runs as; a template naming none runs as the project's default compute account. */
function serviceAccountText({ template }: { template: RunService["template"] }): string {
  if (template.serviceAccount === undefined) {
    return "(default compute)";
  }
  return template.serviceAccount;
}

/** A service's terminal condition as one phrase. */
function conditionText({ condition }: { condition: RunService["terminalCondition"] }): string {
  if (condition === undefined) {
    return "unknown";
  }
  return condition.message === undefined
    ? String(condition.state)
    : `${String(condition.state)} — ${condition.message}`;
}

/**
 * A Cloud Run service, its env by name only.
 *
 * @param description the service and its policy
 * @returns the lines
 */
export function runDescribeLines({ description }: { description: RunDescription }): readonly string[] {
  const { service, policy } = description;
  const containers = containersOf({ template: service.template });
  const condition = service.terminalCondition;
  // Every line is cut, not only the env one: Google's free text — the terminal condition above all — can quote
  // an env value back, and a line that never carries one costs nothing to cut.
  const values = literalEnvValues({ template: service.template });
  const lines = [
    `service ${service.name}`,
    `  url: ${String(service.uri)}`,
    ...containers.map(
      (container) =>
        `  image: ${container.image}` +
        `${container.env === undefined ? "" : ` (env: ${container.env.map((entry) => entry.name).join(", ")})`}`,
    ),
    `  service account: ${serviceAccountText({ template: service.template })}`,
    `  ready revision: ${String(service.latestReadyRevision)}`,
    `  state: ${conditionText({ condition })}`,
    `  ingress: ${String(service.ingress)}`,
    `  updated: ${String(service.updateTime)} by ${String(service.lastModifier)}`,
    `  public: ${policyGrants({ member: "allUsers", policy, role: RUN_INVOKER }) ? "yes (allUsers holds roles/run.invoker)" : "no"}`,
    "iam:",
    ...policyLines({ policy }),
  ];
  return lines.map((line) => cutValues({ text: line, values }));
}

/**
 * A Cloud Run description as `--json` prints it: every env var's literal `value` removed, its name and any
 * secret REFERENCE kept, and those values then cut out of every other string in the document, since Google's
 * free text (a terminal condition, a condition list) can quote one back.
 *
 * @param description the service and its policy
 * @returns the document `--json` prints, env values gone from every string in it
 */
export function redactedRunDescription({ description }: { description: RunDescription }): unknown {
  const values = literalEnvValues({ template: description.service.template });
  const containers = description.service.template.containers;
  const dropped =
    containers === undefined
      ? description
      : {
          ...description,
          service: {
            ...description.service,
            template: {
              ...description.service.template,
              containers: containers.map((container) =>
                container.env === undefined
                  ? container
                  : { ...container, env: container.env.map(({ name, valueSource }) => ({ name, valueSource })) },
              ),
            },
          },
        };
  return cutValuesDeep({ document: dropped, values });
}

/**
 * A secret, every version's state and its grants — never a payload.
 *
 * @param description what was read
 * @returns the lines
 */
export function secretDescribeLines({ description }: { description: SecretDescription }): readonly string[] {
  return [
    `secret ${description.name} (created ${String(description.createTime)})`,
    "versions:",
    ...(description.versions.length === 0
      ? ["  (none)"]
      : description.versions.map(
          (version) =>
            `  ${String(version.name.split("/").at(-1))}: ${String(version.state)} (created ${String(version.createTime)})`,
        )),
    "iam:",
    ...policyLines({ policy: description.policy }),
  ];
}

/**
 * An accessed payload as the one value its own report must cut, read as text the way a terminal would show it.
 *
 * @returns the payload, labelled `<payload>`
 */
export function payloadValues({ bytes }: { bytes: Uint8Array }): readonly UnprintableValue[] {
  return [{ label: "<payload>", value: Buffer.from(bytes).toString("utf8") }];
}

/**
 * An accessed secret, as its fingerprint, in text and as the `--json` document — the version name and the path
 * echoed cut against the payload, since nothing stops either being byte-equal to it.
 *
 * @param name the resolved version name
 * @param fingerprint its length, newline and hash
 * @param toFile the file it was written to, if any
 * @param values the payload, from `payloadValues`
 * @returns the lines and the document
 */
export function accessReport({
  name,
  fingerprint,
  toFile,
  values,
}: {
  name: string;
  fingerprint: SecretFingerprint;
  toFile: string | undefined;
  values: readonly UnprintableValue[];
}): { readonly lines: readonly string[]; readonly value: unknown } {
  const shownName = cutValues({ text: name, values });
  const shownFile = toFile === undefined ? null : cutValues({ text: toFile, values });
  return {
    lines: [
      `${shownName}: ${String(fingerprint.length)} bytes, sha256 ${fingerprint.sha256}` +
        `${fingerprint.trailingNewline ? ", ends in a newline" : ""} — CRC32C checked`,
      ...(shownFile === null ? [] : [`  written to ${shownFile} (new file, mode 0600)`]),
    ],
    value: { ...fingerprint, name: shownName, toFile: shownFile },
  };
}

/**
 * The invocation's tokens with `--approve` and `--edit-existing` and their values removed, as one shell line,
 * with every value the plan must never print cut out of it: an argv value can be byte-equal to a literal env value
 * the plan read, and this line is echoed by the preview, an approval hold and the door's refusal alike.
 *
 * @param rest the argv tail after the family
 * @returns the preview command, safe to print
 */
export function previewCommand({
  family,
  rest,
  plan,
}: {
  family: GcpFamily;
  rest: readonly string[];
  plan: GcpWritePlan;
}): string {
  const kept: string[] = [];
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index]!;
    if (token === "--approve" || token === "--edit-existing") {
      index += 1;
    } else if (!token.startsWith("--approve=") && !token.startsWith("--edit-existing=")) {
      kept.push(token);
    }
  }
  // Each token is cut BEFORE it is quoted, since quoting escapes a value's own quotes and the cut would then miss it.
  const values = planUnprintable({ plan });
  return shellCommandLine({
    command: ["slopweaver", "gcp", family, ...kept.map((token) => cutValues({ text: token, values }))],
  });
}

/**
 * A preview: every step, its class, and the digest to approve with.
 *
 * @param preview the invocation without `--approve`
 * @returns the lines
 */
export function previewLines({
  plan,
  digest,
  preview,
}: {
  plan: GcpWritePlan;
  digest: string;
  preview: string;
}): readonly string[] {
  const edits = plan.steps.some((step) => step.classification === "edit-existing");
  const values = planUnprintable({ plan });
  // Every piece of text is cut, the echoed command included — a literal env value can be byte-equal to the image
  // asked for. The digest never is: it is a hash, and a short value such as `1` would otherwise mangle the one token
  // the approval has to be typed with.
  const cut = ({ text }: { text: string }): string => cutValues({ text, values });
  return [
    cut({ text: `gcp ${plan.command} on ${plan.target} — PREVIEW, nothing was sent` }),
    ...plan.steps.map((step, index) =>
      cut({ text: `  ${String(index + 1)}. [${step.classification}] ${step.summary}` }),
    ),
    `digest: ${digest}`,
    `to send exactly this: ${cut({ text: preview })} --approve ${digest}${edits ? ' --edit-existing "<why>"' : ""}`,
  ];
}

/**
 * The door's refusal of an approved write, every line cut against the plan's unprintable values: a finding's
 * text is the door's and the caller's — an `--edit-existing` reason among it — and nothing stops it equalling a
 * value the plan already read.
 *
 * @param decision what the door held the write with
 * @param preview the already-cut invocation each finding echoes
 * @returns the refusal's lines
 */
export function heldLines({
  plan,
  decision,
  preview,
}: {
  plan: GcpWritePlan;
  decision: DoorDecision;
  preview: string;
}): readonly string[] {
  const values = planUnprintable({ plan });
  return doorRefusalLines({ command: preview, decision }).map((line) => cutValues({ text: line, values }));
}

/**
 * An approved write the store could not record: the failure is the store's, not a policy hold, and the step it
 * stopped at was not sent. Cut against the plan's unprintable values as {@link heldLines} is.
 *
 * @param plan the plan that was being performed
 * @param preview the already-cut invocation
 * @param message the store error's message
 * @returns the lines to print
 */
export function storeUnavailableLines({
  plan,
  preview,
  message,
}: {
  plan: GcpWritePlan;
  preview: string;
  message: string;
}): readonly string[] {
  const values = planUnprintable({ plan });
  return [`${preview} not performed: ${message}`].map((line) => cutValues({ text: line, values }));
}

/**
 * What an approved write did.
 *
 * @param outcomes each step's outcome, in order
 * @returns the lines
 */
export function outcomeLines({
  plan,
  outcomes,
}: {
  plan: GcpWritePlan;
  outcomes: readonly GcpStepOutcome[];
}): readonly string[] {
  // Cut as the preview is: a target or an outcome's detail can be byte-equal to a value the plan read.
  const values = planUnprintable({ plan });
  return [
    `gcp ${plan.command} on ${plan.target} — sent, each step recorded in the door ledger`,
    ...outcomes.map((outcome) => `  ✓ ${outcome.id}: ${outcome.detail}`),
  ].map((line) => cutValues({ text: line, values }));
}

/**
 * What an approved write did, as `--json` prints it, every string cut against the plan's unprintable values.
 *
 * @param digest the approved digest, a hash and so never cut
 * @param outcomes each step's outcome, in order
 * @returns the document
 */
export function outcomeDocument({
  plan,
  digest,
  outcomes,
}: {
  plan: GcpWritePlan;
  digest: string;
  outcomes: readonly GcpStepOutcome[];
}): unknown {
  return { digest, outcomes: cutValuesDeep({ document: outcomes, values: planUnprintable({ plan }) }), sent: true };
}
