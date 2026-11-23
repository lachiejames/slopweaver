/**
 * `slopweaver atlas vanta controls-evidence [...]` — the live read that answers "which of our controls are
 * failing", and files the durable evidence document behind the answer.
 *
 * ## Why it costs one request per control
 *
 * `GET /v1/controls` hands back no status at all — the field lives only on `GET /v1/controls/{id}`. So the
 * `NEEDS_ATTENTION` set is assembled by reading every control's detail, {@link DETAIL_CONCURRENCY} at a
 * time. The alternative was to report a framework's `numControlsTotal - numControlsCompleted`, which is a
 * different number: it counts a framework's own mapping, names no control, and cannot be clicked through
 * to. A verb whose whole point is that the reader can SEE the failing controls has to name them.
 *
 * ## Why the filed document is version 1, and says `NOT_COMPLETED`
 *
 * `controlsEvidence.ts`'s builder carries that reasoning: version 2's focus block is browser-corroborated
 * by construction, and this verb runs no browser. The failing controls themselves are printed rather than
 * filed for the same reason a version is durable — see `buildVantaControlsEvidenceV1`.
 *
 * The filter it records is `NOT_COMPLETED`, not the web client's `NEEDS_ATTENTION`, and that distinction is
 * MEASURED rather than cautious — see {@link COMPLETED}. The first cut of this verb assumed the two were the
 * same word and reported every posture as clean.
 *
 * ## The exit-code contract
 *
 * | situation                                            | code |
 * | ---------------------------------------------------- | ---- |
 * | a bad flag                                           | `2`  |
 * | credentials or the workspace slug not configured     | `3`  |
 * | the read, the document or the artifact write failed  | `1`  |
 * | the read succeeded, failing controls or not          | `0`  |
 *
 * An empty result is `0`, not `3`, for the reason `vulnerabilitiesRun.ts` states: a clean posture is an
 * ANSWER, and the day it is clean is the worst possible day for the verb to look broken.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { vantaControlsCitation } from "../../../atlas/vanta/browserPages.js";
import { createVantaManageClient, type VantaManageClient } from "../../../atlas/vanta/client.js";
import {
  buildVantaControlsEvidenceV1,
  controlsEvidenceLines,
  type VantaControlsEvidence,
  type VantaFailingControlRow,
} from "../../../atlas/vanta/controlsEvidence.js";
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
  failingControlsSection,
  parseVantaControlsEvidenceOptions,
  type VantaControlsEvidenceOptions,
  vantaEvidenceFilingPath,
} from "./controlEvidenceCore.js";
import { isVantaVerbUnconfigured, type VantaVerbError, VantaVerbErrors, vantaVerbErrorLines } from "./errors.js";

/** Where a Vanta verb sits: past the runtime, the script, the `atlas` noun and the `vanta` platform. */
const VANTA_VERB_INDEX = 4;

/** How many control-detail reads are in flight at once. */
const DETAIL_CONCURRENCY = 6;

/** How many failing controls the human-readable report prints before deferring to `--json`. */
const PRINTED_ROWS = 25;

/**
 * The one control grade that means nothing is owed.
 *
 * MEASURED over a tenant's whole control set: `GET /v1/controls/{id}` grades a control
 * `COMPLETED`, `IN_PROGRESS`, `NOT_STARTED` or `NO_EVIDENCE_MAPPED`. `NEEDS_ATTENTION` — the web client's
 * own list filter — is not a member of that enum at all; it is a TEST status. So "needs attention" over
 * this channel is the complement of this one value, and the filed document says `NOT_COMPLETED` rather
 * than claiming a filter it did not apply. Reproduce with `slopweaver atlas vanta controls-evidence --json`
 * and count the `status` values in `failing`.
 */
const COMPLETED = "COMPLETED";

/** The one copy. The manifest row names the platform's verbs; each verb's own usage lives with the verb. */
export const VANTA_CONTROLS_EVIDENCE_USAGE =
  "usage: slopweaver atlas vanta controls-evidence [--tenant <slug>] [--artifact <path>] [--json]\n" +
  "       [--home <dir>] [--client-id-file <path> --client-secret-file <path>]\n" +
  "  Reads every control LIVE and files the evidence document behind the count. Nothing is published into\n" +
  "  the stored atlas — a compliance posture's whole value is that it is current\n" +
  "  --tenant     the workspace segment after /c/ in your app.vanta.com URL, used for the citation only.\n" +
  "               Else VANTA_TENANT_SLUG, else: slopweaver secrets set vanta-tenant-slug\n" +
  "  --artifact   where to file the evidence document; the default is under $SLOPWEAVER_HOME/atlas/vanta\n" +
  "  --json       emit the document and every failing control as one machine-readable report\n" +
  "  Costs one request per control: GET /v1/controls carries no status, so the NEEDS_ATTENTION set is\n" +
  "  assembled from each control's own detail read";

/** What the read came to, before anything is printed or filed. */
interface ControlsEvidenceReading {
  readonly evidence: VantaControlsEvidence;
  readonly failing: readonly VantaFailingControlRow[];
}

/** Run `worker` over `items` with a fixed number in flight, preserving the input order in the output. */
async function mapWithConcurrency<TItem, TResult>({
  items,
  limit,
  worker,
}: {
  items: readonly TItem[];
  limit: number;
  worker: (item: TItem) => Promise<TResult>;
}): Promise<readonly TResult[]> {
  const done: { index: number; value: TResult }[] = [];
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (let index = next; index < items.length; index = next) {
      next = index + 1;
      const item = items[index];
      if (item !== undefined) {
        done.push({ index, value: await worker(item) });
      }
    }
  });
  await Promise.all(runners);
  return done.toSorted((left, right) => left.index - right.index).map((entry) => entry.value);
}

/** Read every control's detail and keep the ones Vanta says need attention. */
async function readFailingControls({
  client,
}: {
  client: VantaManageClient;
}): Promise<Result<readonly VantaFailingControlRow[]>> {
  const controls = await client.listControlsActive();
  if (controls.isErr()) {
    return err(controls.error.reasons);
  }
  const details = await mapWithConcurrency({
    items: controls.value,
    limit: DETAIL_CONCURRENCY,
    worker: (control) => client.getControl({ controlId: control.id }),
  });
  const failures = details.flatMap((detail) => (detail.isErr() ? detail.error : []));
  if (failures.length > 0) {
    return err(failures);
  }
  return ok(
    details.flatMap((detail) => {
      if (detail.isErr() || detail.value.status === COMPLETED) {
        return [];
      }
      return [
        {
          externalId: detail.value.externalId,
          name: detail.value.name,
          providerId: detail.value.id,
          status: detail.value.status,
          testsPassing: detail.value.numTestsPassing,
          testsTotal: detail.value.numTestsTotal,
        },
      ];
    }),
  );
}

/** Bind credentials, read the live posture, and build the document it proves. */
async function readEvidence({
  options,
  generatedAt,
}: {
  options: VantaControlsEvidenceOptions;
  generatedAt: string;
}): Promise<Result<ControlsEvidenceReading, VantaVerbError>> {
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
  const failing = await readFailingControls({ client: createVantaManageClient(bound.value) });
  if (failing.isErr()) {
    return err(VantaVerbErrors.readFailed({ reasons: failing.error }));
  }
  const evidence = buildVantaControlsEvidenceV1({
    citation: vantaControlsCitation({ label: "Vanta controls", tenantSlug: tenantSlug.value }),
    filter: "NOT_COMPLETED",
    generatedAt,
    screenshot: {
      reason: "this verb reads the Manage API only — run `slopweaver atlas vanta walk` for the browser channel",
      status: "unavailable",
    },
    tenantSlug: tenantSlug.value,
    total: failing.value.length,
  });
  return evidence.isErr()
    ? err(VantaVerbErrors.readFailed({ reasons: evidence.error }))
    : ok({ evidence: evidence.value, failing: failing.value });
}

/** File the document where the caller asked, or under the atlas root when they named nowhere. */
function fileEvidence({
  reading,
  options,
}: {
  reading: ControlsEvidenceReading;
  options: VantaControlsEvidenceOptions;
}): Result<string, VantaVerbError> {
  const path = vantaEvidenceFilingPath({
    artifactPath: options.artifactPath,
    atlasRoot: stateHomePaths({ home: options.home }).atlas.vanta.root,
    generatedAt: reading.evidence.generatedAt,
    kind: reading.evidence.kind,
  });
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(reading.evidence, null, 2)}\n`, "utf8");
    return ok(path);
  } catch (error: unknown) {
    return err(VantaVerbErrors.evidenceUnfileable({ cause: error, path }));
  }
}

/**
 * Run the `vanta controls-evidence` verb.
 *
 * @param argv the full process argv (verb tail starts at index 3)
 * @returns the process exit code
 * @internal
 */
export async function runVantaControlsEvidence(argv: readonly string[]): Promise<number> {
  const rest = verbTail({ argv, at: VANTA_VERB_INDEX, verbs: ["controls-evidence"] });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: VANTA_CONTROLS_EVIDENCE_USAGE });
    return EXIT_OK;
  }
  const parsed = parseVantaControlsEvidenceOptions({ defaultHome: slopweaverHome(), rest });
  if (parsed.isErr()) {
    parsed.error.forEach((problem) => {
      logger.error({ msg: problem });
    });
    logger.error({ msg: VANTA_CONTROLS_EVIDENCE_USAGE });
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

  const filed = fileEvidence({ options, reading: read.value });
  if (filed.isErr()) {
    vantaVerbErrorLines({ error: filed.error }).forEach((problem) => {
      logger.error({ msg: problem });
    });
    return EXIT_ERROR;
  }

  if (options.json) {
    logger.out({
      line: JSON.stringify(
        { artifactPath: filed.value, evidence: read.value.evidence, failing: read.value.failing },
        null,
        2,
      ),
    });
    return EXIT_OK;
  }
  for (const line of controlsEvidenceLines({ artifactPath: filed.value, evidence: read.value.evidence })) {
    logger.out({ line });
  }
  logger.out({ line: "" });
  for (const line of failingControlsSection({ rows: read.value.failing, shown: PRINTED_ROWS })) {
    logger.out({ line });
  }
  return EXIT_OK;
}

export const vantaControlsEvidenceCommand = defineCommand({ run: runVantaControlsEvidence });
