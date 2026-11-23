/**
 * `slopweaver atlas vanta control-evidence --control <id> [...]` — the live read that explains ONE control:
 * what Vanta tests for it, which of those tests are failing, what Vanta says the failure and its remediation
 * are, when it must be remediated by, and a bounded sample of the entities actually failing.
 *
 * Three Manage API reads compose it — `getControl`, `listControlTests`, and one `getTestEntitySample` per
 * FAILING test. The sample is per failing test rather than per test on purpose: a passing test's entities
 * are the whole estate, so sampling them would turn an explanation into a data export.
 *
 * ## The exit-code contract
 *
 * | situation                                            | code |
 * | ---------------------------------------------------- | ---- |
 * | a bad flag, or no `--control`                        | `2`  |
 * | credentials or the workspace slug not configured     | `3`  |
 * | the read, the document or the artifact write failed  | `1`  |
 * | the control was explained, failing tests or not      | `0`  |
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { recordAtlasLiveRead } from "../../../atlas/kit/liveReadStamp.js";
import { atlasSidecarErrorLines } from "../../../atlas/kit/sidecarErrors.js";
import { vantaControlsCitation } from "../../../atlas/vanta/browserPages.js";
import { createVantaManageClient, type VantaManageClient } from "../../../atlas/vanta/client.js";
import {
  buildVantaControlEvidence,
  controlEvidenceLines,
  type VantaControlEvidence,
  type VantaTestEntitiesOutcome,
} from "../../../atlas/vanta/controlEvidence.js";
import { controlLabel } from "../../../atlas/vanta/controlLinks.js";
import { resolveVantaTenantSlugTyped } from "../../../atlas/vanta/tenantSlug.js";
import { slopweaverHome } from "../../../homeDir.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { stateHomePaths } from "../../../stateHome.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { verbTail } from "../../optionParsers.js";
import { bindVanta } from "./binding.js";
import {
  parseVantaControlEvidenceOptions,
  VANTA_ENTITY_SAMPLE_DEFAULT,
  VANTA_ENTITY_SAMPLE_MAX,
  type VantaControlEvidenceOptions,
  vantaEvidenceFilingPath,
} from "./controlEvidenceCore.js";
import { isVantaVerbUnconfigured, type VantaVerbError, VantaVerbErrors, vantaVerbErrorLines } from "./errors.js";

/** Where a Vanta verb sits: past the runtime, the script, the `atlas` noun and the `vanta` platform. */
const VANTA_VERB_INDEX = 4;

/** The status Vanta puts on a test that is not passing. */
const NEEDS_ATTENTION = "NEEDS_ATTENTION";

/** The one copy. The manifest row names the platform's verbs; each verb's own usage lives with the verb. */
export const VANTA_CONTROL_EVIDENCE_USAGE =
  "usage: slopweaver atlas vanta control-evidence --control <id> [--entity-sample <1..10>]\n" +
  "       [--tenant <slug>] [--artifact <path>] [--json] [--home <dir>]\n" +
  "       [--client-id-file <path> --client-secret-file <path>]\n" +
  "  Explains ONE control LIVE — its mapped tests, what is failing, what Vanta says to do about it, when it\n" +
  "  must be remediated by, and a bounded sample of the entities actually failing\n" +
  "  --control        the control's Vanta id, as `controls-evidence` prints it\n" +
  `  --entity-sample  how many failing entities to sample per failing test (1..${String(VANTA_ENTITY_SAMPLE_MAX)}, default ${String(VANTA_ENTITY_SAMPLE_DEFAULT)})\n` +
  "  --tenant         the workspace segment after /c/ in your app.vanta.com URL, used for the citation only.\n" +
  "                   Else VANTA_TENANT_SLUG, else: slopweaver secrets set vanta-tenant-slug\n" +
  "  --artifact       where to file the evidence document; the default is under $SLOPWEAVER_HOME/atlas/vanta\n" +
  "  --json           emit the whole document as one machine-readable report";

/** Sample the failing entities behind each failing test, recording a refused read rather than dropping it. */
async function sampleFailingEntities({
  client,
  tests,
  limit,
}: {
  client: VantaManageClient;
  tests: readonly { readonly id: string; readonly status: string }[];
  limit: number;
}): Promise<ReadonlyMap<string, VantaTestEntitiesOutcome>> {
  const outcomes = new Map<string, VantaTestEntitiesOutcome>();
  for (const test of tests) {
    if (test.status !== NEEDS_ATTENTION) {
      continue;
    }
    const sampled = await client.getTestEntitySample({ limit, testId: test.id });
    if (sampled.isErr()) {
      outcomes.set(test.id, { kind: "unavailable", reason: sampled.error.join("; ") });
      continue;
    }
    outcomes.set(test.id, { hasMore: sampled.value.hasMore, kind: "captured", sample: sampled.value.entities });
  }
  return outcomes;
}

/** Bind credentials, read the control live, and build the document it proves. */
async function readEvidence({
  options,
  generatedAt,
}: {
  options: VantaControlEvidenceOptions;
  generatedAt: string;
}): Promise<Result<VantaControlEvidence, VantaVerbError>> {
  const tenantSlug = resolveVantaTenantSlugTyped({ env: process.env, flag: options.tenant, home: options.home });
  if (tenantSlug.isErr()) {
    return err(VantaVerbErrors.credentialsUnresolved({ errors: [tenantSlug.error] }));
  }
  const bound = bindVanta({
    clientIdFile: options.clientIdFile,
    clientSecretFile: options.clientSecretFile,
    env: process.env,
    home: options.home,
  });
  if (bound.isErr()) {
    return err(VantaVerbErrors.credentialsUnresolved({ errors: bound.error }));
  }
  const client = createVantaManageClient(bound.value);
  const control = await client.getControl({ controlId: options.controlId });
  if (control.isErr()) {
    return err(VantaVerbErrors.readFailed({ reasons: control.error }));
  }
  const tests = await client.listControlTests({ controlId: options.controlId });
  if (tests.isErr()) {
    return err(VantaVerbErrors.readFailed({ reasons: tests.error }));
  }
  const evidence = buildVantaControlEvidence({
    citation: vantaControlsCitation({
      label: `${controlLabel({ control: { externalId: control.value.externalId, providerId: control.value.id } })} in Vanta's controls list`,
      tenantSlug: tenantSlug.value,
    }),
    control: control.value,
    entitiesByTestId: await sampleFailingEntities({ client, limit: options.entitySample, tests: tests.value }),
    generatedAt,
    screenshot: {
      reason: "this verb reads the Manage API only — run `slopweaver atlas vanta walk` for the browser channel",
      status: "unavailable",
    },
    tenantSlug: tenantSlug.value,
    tests: tests.value,
  });
  return evidence.mapErr((reasons) => VantaVerbErrors.readFailed({ reasons }));
}

/** File the document where the caller asked, or under the atlas root when they named nowhere. */
function fileEvidence({
  evidence,
  options,
}: {
  evidence: VantaControlEvidence;
  options: VantaControlEvidenceOptions;
}): Result<string, VantaVerbError> {
  const path = vantaEvidenceFilingPath({
    artifactPath: options.artifactPath,
    atlasRoot: stateHomePaths({ home: options.home }).atlas.vanta.root,
    generatedAt: evidence.generatedAt,
    kind: `${evidence.kind}-${evidence.control.providerId}`,
  });
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
    return ok(path);
  } catch (error: unknown) {
    return err(VantaVerbErrors.evidenceUnfileable({ cause: error, path }));
  }
}

/**
 * Record that this read reached Vanta, so the freshness ladder can count it.
 *
 * This verb IS the bounded live read Vanta's descriptor names, and such a
 * read count as fresh — but only if something writes it down. A stamp that could not be written is reported
 * and never fatal: the evidence document is already filed and the control is already explained, so failing
 * the whole verb over a companion file would discard an answer the caller has.
 *
 * @param evidence the control this run explained, whose own `generatedAt` is when Vanta was reached
 * @param options the resolved invocation, read for the home the atlas lives under
 */
function stampLiveRead({
  evidence,
  options,
}: {
  evidence: VantaControlEvidence;
  options: VantaControlEvidenceOptions;
}): void {
  const stamped = recordAtlasLiveRead({
    atIso: evidence.generatedAt,
    atlasDir: stateHomePaths({ home: options.home }).atlas.vanta.root,
    scope: `control ${evidence.control.providerId}`,
    verb: "atlas vanta control-evidence",
  });
  if (stamped.isErr()) {
    atlasSidecarErrorLines({ error: stamped.error }).forEach((problem) => {
      logger.error({ msg: problem });
    });
  }
}

/**
 * Run the `vanta control-evidence` verb.
 *
 * @param argv the full process argv (verb tail starts at index 3)
 * @returns the process exit code
 * @internal
 */
export async function runVantaControlEvidence(argv: readonly string[]): Promise<number> {
  const rest = verbTail({ argv, at: VANTA_VERB_INDEX, verbs: ["control-evidence"] });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: VANTA_CONTROL_EVIDENCE_USAGE });
    return EXIT_OK;
  }
  const parsed = parseVantaControlEvidenceOptions({ defaultHome: slopweaverHome(), rest });
  if (parsed.isErr()) {
    parsed.error.forEach((problem) => {
      logger.error({ msg: problem });
    });
    logger.error({ msg: VANTA_CONTROL_EVIDENCE_USAGE });
    return EXIT_USAGE;
  }
  const options = parsed.value;

  const read = await readEvidence({ generatedAt: new Date().toISOString(), options });
  if (read.isErr()) {
    vantaVerbErrorLines({ error: read.error }).forEach((problem) => {
      logger.error({ msg: problem });
    });
    return isVantaVerbUnconfigured({ error: read.error }) ? EXIT_EXPECTED_EMPTY : EXIT_ERROR;
  }

  const filed = fileEvidence({ evidence: read.value, options });
  if (filed.isErr()) {
    vantaVerbErrorLines({ error: filed.error }).forEach((problem) => {
      logger.error({ msg: problem });
    });
    return EXIT_ERROR;
  }

  stampLiveRead({ evidence: read.value, options });

  if (options.json) {
    logger.out({ line: JSON.stringify({ artifactPath: filed.value, evidence: read.value }, null, 2) });
    return EXIT_OK;
  }
  for (const line of controlEvidenceLines({ artifactPath: filed.value, evidence: read.value })) {
    logger.out({ line });
  }
  return EXIT_OK;
}

export const vantaControlEvidenceCommand = defineCommand({ run: runVantaControlEvidence });
