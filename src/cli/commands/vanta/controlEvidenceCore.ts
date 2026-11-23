/**
 * The PURE core of `slopweaver atlas vanta controls-evidence|control-evidence`: flag parsing, the artifact
 * path each verb files under when the caller names none, and the report lines that wrap the evidence
 * document's own. No fs, no clock, no network — the shells ({@link ./controlsEvidenceRun},
 * {@link ./controlEvidenceRun}) do every read, write and credential resolution.
 *
 * Both verbs share one options shape because they share one channel: the Manage API, a workspace slug for
 * the citation, and a filed JSON document. What differs is a single control id, so `control-evidence`
 * extends the plural verb's options rather than declaring a second parallel set that would drift.
 */
import { join } from "node:path";

import { controlLabel } from "../../../atlas/vanta/controlLinks.js";
import type { VantaFailingControlRow } from "../../../atlas/vanta/controlsEvidence.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { flagValue, flagValueOr, parseFlagTail, parsePositiveInteger } from "../../optionParsers.js";
import type { VantaCredentialFlags } from "./vulnerabilityCore.js";

/**
 * A validated `vanta controls-evidence` invocation.
 *
 * @internal
 */
export interface VantaControlsEvidenceOptions extends VantaCredentialFlags {
  readonly home: string;
  readonly json: boolean;
  /** Where the evidence document is filed, or `null` to let the shell derive one under the atlas root. */
  readonly artifactPath: string | null;
  /** The `--tenant` value, or `null` to fall through to the environment and the secrets store. */
  readonly tenant: string | null;
}

/**
 * A validated `vanta control-evidence` invocation.
 *
 * @internal
 */
export interface VantaControlEvidenceOptions extends VantaControlsEvidenceOptions {
  readonly controlId: string;
  /** How many failing entities to sample per failing test — Vanta's own bound for this read is 10. */
  readonly entitySample: number;
}

/** The largest entity sample `client.ts`'s `getTestEntitySample` accepts. */
export const VANTA_ENTITY_SAMPLE_MAX = 10;

/** The default entity sample: enough rows to name the offenders, never enough to be a data export. */
export const VANTA_ENTITY_SAMPLE_DEFAULT = 5;

/**
 * Every flag each control-evidence verb accepts, keyed by verb. Exported so the verb-flag ratchet can probe
 * the REAL parser with each one rather than compare two declarations.
 *
 * @internal
 */
export const VANTA_CONTROL_EVIDENCE_FLAG_NAMES: Readonly<Record<string, readonly string[]>> = {
  "control-evidence": [
    "--artifact",
    "--client-id-file",
    "--client-secret-file",
    "--control",
    "--entity-sample",
    "--home",
    "--json",
    "--tenant",
  ],
  "controls-evidence": ["--artifact", "--client-id-file", "--client-secret-file", "--home", "--json", "--tenant"],
};

/** The shared tail both verbs parse, before either verb's own additions. */
function parseSharedTail({
  rest,
  defaultHome,
  extraValues,
}: {
  rest: readonly string[];
  defaultHome: string;
  extraValues: readonly string[];
}): Result<{ options: VantaControlsEvidenceOptions; values: Readonly<Record<string, string>> }> {
  const parsed = parseFlagTail({
    rest,
    spec: {
      boolean: ["json"],
      value: ["home", "tenant", "artifact", "client-id-file", "client-secret-file", ...extraValues],
    },
  });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { values, flags } = parsed.value;
  return ok({
    options: {
      artifactPath: flagValue({ name: "artifact", parsed: parsed.value }),
      clientIdFile: flagValue({ name: "client-id-file", parsed: parsed.value }),
      clientSecretFile: flagValue({ name: "client-secret-file", parsed: parsed.value }),
      home: flagValueOr({ fallback: defaultHome, name: "home", parsed: parsed.value }),
      json: flags.has("json"),
      tenant: flagValue({ name: "tenant", parsed: parsed.value }),
    },
    values,
  });
}

/**
 * Parse the tail of `vanta controls-evidence`.
 *
 * @param rest the argv tail after the verb
 * @param defaultHome the home to use when `--home` is absent
 * @returns the validated options, or every rejection
 */
export function parseVantaControlsEvidenceOptions({
  rest,
  defaultHome,
}: {
  rest: readonly string[];
  defaultHome: string;
}): Result<VantaControlsEvidenceOptions> {
  const shared = parseSharedTail({ defaultHome, extraValues: [], rest });
  return shared.isErr() ? err(shared.error) : ok(shared.value.options);
}

/**
 * Parse the tail of `vanta control-evidence`.
 *
 * @param rest the argv tail after the verb
 * @param defaultHome the home to use when `--home` is absent
 * @returns the validated options, or every rejection
 */
export function parseVantaControlEvidenceOptions({
  rest,
  defaultHome,
}: {
  rest: readonly string[];
  defaultHome: string;
}): Result<VantaControlEvidenceOptions> {
  const shared = parseSharedTail({ defaultHome, extraValues: ["control", "entity-sample"], rest });
  if (shared.isErr()) {
    return err(shared.error);
  }
  const errors: string[] = [];
  const controlId = shared.value.values["control"]?.trim();
  if (controlId === undefined || controlId === "") {
    errors.push("--control names the control to explain — pass the id Vanta knows it by");
  }
  let entitySample = VANTA_ENTITY_SAMPLE_DEFAULT;
  const rawSample = shared.value.values["entity-sample"];
  if (rawSample !== undefined) {
    const parsed = parsePositiveInteger({ errors, label: "--entity-sample", value: rawSample });
    if (parsed !== undefined && parsed > VANTA_ENTITY_SAMPLE_MAX) {
      errors.push(`--entity-sample must be at most ${String(VANTA_ENTITY_SAMPLE_MAX)} (got ${rawSample})`);
    } else if (parsed !== undefined) {
      entitySample = parsed;
    }
  }
  if (errors.length > 0) {
    return err(errors);
  }
  return ok({ ...shared.value.options, controlId: controlId!, entitySample });
}

/**
 * Where an evidence document is filed when the caller named no `--artifact`.
 *
 * Under the platform's own atlas root rather than a new home key: this is Vanta state, and a document that
 * needs a fresh directory in the home contract to exist is a document nobody will find again.
 *
 * @param atlasRoot the `$home/atlas/vanta` root
 * @param kind the document's own `kind` field, which is already unique per document shape
 * @param generatedAt the ISO instant the evidence was gathered
 * @returns the absolute path to file it at
 */
export function vantaEvidenceArtifactPath({
  atlasRoot,
  kind,
  generatedAt,
}: {
  atlasRoot: string;
  kind: string;
  generatedAt: string;
}): string {
  return join(atlasRoot, "evidence", `${kind}-${generatedAt.replace(/[:.]/g, "-")}.json`);
}

/**
 * Where an evidence document is filed: the caller's own `--artifact`, or {@link vantaEvidenceArtifactPath}
 * under the atlas root when they named nowhere — the documented default of both verbs' `--artifact` flag.
 *
 * @param artifactPath the `--artifact` value, or `null` when the flag was not passed
 * @param atlasRoot the `$home/atlas/vanta` root the derived path sits under
 * @param kind the document's own `kind` field, which is already unique per document shape
 * @param generatedAt the ISO instant the evidence was gathered
 * @returns the absolute path to file it at
 */
export function vantaEvidenceFilingPath({
  artifactPath,
  atlasRoot,
  kind,
  generatedAt,
}: {
  artifactPath: string | null;
  atlasRoot: string;
  kind: string;
  generatedAt: string;
}): string {
  if (artifactPath === null) {
    return vantaEvidenceArtifactPath({ atlasRoot, generatedAt, kind });
  }
  return artifactPath;
}

/**
 * The rows the plural verb prints beneath its document's own lines.
 *
 * @param rows the controls Vanta grades anything other than `COMPLETED`
 * @param shown how many of them the report prints
 * @returns the heading and its rows, or a single line saying the whole posture is complete
 */
export function failingControlsSection({
  rows,
  shown,
}: {
  rows: readonly VantaFailingControlRow[];
  shown: number;
}): readonly string[] {
  if (rows.length === 0) {
    return ["every control this workspace holds is COMPLETED"];
  }
  const head = rows.slice(0, shown);
  const remainder = rows.length - head.length;
  return [
    `${String(rows.length)} control(s) are not COMPLETED${remainder > 0 ? `, showing ${String(head.length)}` : ""}:`,
    ...head.map(
      (row) =>
        `- ${controlLabel({ control: row })}: ${row.name} — ${row.status}, ${String(row.testsPassing)}/${String(row.testsTotal)} tests passing`,
    ),
    ...(remainder > 0 ? [`… and ${String(remainder)} more — pass --json for every row`] : []),
  ];
}
