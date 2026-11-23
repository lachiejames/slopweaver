/**
 * `slopweaver write vanta deactivate [...]` — the write leg. Applies the owner's ignore rulings to Vanta
 * findings, each carrying the reason they gave, through the admit door.
 *
 * ## This is the verb that makes Vanta a doored provider
 *
 * Before it existed, driving app.vanta.com by hand was merely unwise. After it, it is a rule-3 violation:
 * a doored provider is never reached through its web client, reads included. `admit/browserSurface.ts`
 * carries the enforcement half, and it was extended in the same change rather than left to a later one —
 * a door nothing points at is not a door.
 *
 * ## The approval is real, and it is the door that enforces it
 *
 * The door request has always declared `requiresApproval: true`. It used to pass `DEFAULT_GATES`, which is
 * empty, so the claim was decoration on the one verb here that mutates a compliance provider. It now passes
 * {@link ../../../atlas/vanta/deactivateApproval.vantaDeactivateApprovalGate}, which HOLDS unless
 * `--approve` carries the digest of this exact batch — and `admitDoor` refuses the claim outright when no
 * approval gate is in the list, so the two can never come apart again.
 *
 * ## Why `--dry-run` returns BEFORE the door
 *
 * A dry run performs no external write, so routing it would record a decision in the ledger for something
 * that never happened, and the ledger would over-count real mutations. It returns after resolving the exact
 * request, and says so. This mirrors `gmail/modifyRun.ts`, whose header states the same reasoning.
 *
 * ## The exit-code contract
 *
 * | situation                                          | code |
 * | -------------------------------------------------- | ---- |
 * | a bad flag, or a batch that could not be assembled | `2`  |
 * | credentials genuinely not configured               | `3`  |
 * | the door refused, or any item in the batch did     | `1`  |
 * | a dry run, or a batch every item of which landed   | `0`  |
 */
import { readFileSync } from "node:fs";

import { throughDoor } from "../../../admit/effects.js";
import { vantaCredentialErrorsLines } from "../../../atlas/vanta/credentialErrors.js";
import { vantaDeactivateApprovalGate, vantaDeactivateDigest } from "../../../atlas/vanta/deactivateApproval.js";
import type { VantaDeactivateUpdate } from "../../../atlas/vanta/vulnerabilityApiSchemas.js";
import {
  checkVantaVulnerabilityBatch,
  createVantaVulnerabilityWriteClient,
  summariseVantaVulnerabilityBatch,
  type VantaVulnerabilityWriteClient,
} from "../../../atlas/vanta/vulnerabilityWriteClient.js";
import { resolveVantaWriteRequest } from "../../../atlas/vanta/writePreview.js";
import { slopweaverHome } from "../../../homeDir.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { type VantaVerbError, VantaVerbErrors, vantaVerbErrorLines } from "./errors.js";

/** Where a Vanta verb sits: past the runtime, the script, the `atlas` noun and the `vanta` platform. */
const VANTA_VERB_INDEX = 4;

import { type DoorLedgerPort, doorLedgerPort } from "../../../admit/doorLedgerPort.js";
import { notPerformedLines } from "../../../admit/doorRefusal.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { verbTail } from "../../optionParsers.js";
import { bindVanta } from "./binding.js";
import { exitCodeForVantaVulnerabilityBatch, renderVantaVulnerabilityBatchOutcome } from "./vulnerabilityBatchLines.js";
import {
  batchFromFlags,
  batchFromForm,
  parseVantaDeactivateOptions,
  renderVantaDeactivateDryRun,
  type VantaDeactivateBatchSource,
  type VantaDeactivateOptions,
} from "./vulnerabilityCore.js";

/** The one copy. The manifest row names the platform's verbs; each verb's own usage lives with the verb. */
export const VANTA_DEACTIVATE_USAGE =
  "usage: slopweaver write vanta deactivate (--ids <id[,id...]> --reason <text> | --form <path|->)\n" +
  "       [--until <iso-date>] [--reactivate-when-fixable] [--approve <digest>] [--dry-run] [--json]\n" +
  "       [--home <dir>]\n" +
  "       [--client-id-file <path> --client-secret-file <path>]\n" +
  "  Stops Vanta monitoring the named findings and RECORDS THE REASON against each one. This changes a\n" +
  "  real compliance posture and is visible to anyone reading the Vanta workspace\n" +
  "  --ids        the findings, comma-separated; every one gets the same --reason\n" +
  "  --reason     why the finding does not apply here — Vanta stores this verbatim\n" +
  '  --form       a JSON document {"updates":[{id,deactivateReason,shouldReactivateWhenFixable,...}]},\n' +
  "               or `-` for stdin — the spelling that carries a DIFFERENT reason per finding\n" +
  "  --until      the ISO date monitoring resumes; omit it to deactivate indefinitely\n" +
  "  --reactivate-when-fixable   let Vanta reopen the finding once a fix exists\n" +
  "  --approve    the digest printed by --dry-run, which covers that exact batch. Without it the door\n" +
  "               HOLDS and nothing is sent; the refusal is recorded, and the digest is in it\n" +
  "  --dry-run    resolve and print the exact request, send nothing, touch no ledger\n" +
  "  Run --dry-run first: it prints the bytes, not a description of them";

/** Read a `--form` document from a path, or from stdin when the path is `-`. */
function readFormText({ path }: { path: string }): Result<string, VantaVerbError> {
  try {
    return ok(readFileSync(path === "-" ? 0 : path, "utf8"));
  } catch (error: unknown) {
    return err(VantaVerbErrors.formUnreadable({ cause: error, path }));
  }
}

/** Assemble the batch from whichever spelling was used, then apply Vanta's own batch rules to it. */
function assembleBatch({ source }: { source: VantaDeactivateBatchSource }): Result<readonly VantaDeactivateUpdate[]> {
  const assembled = assembleUnchecked({ source });
  if (assembled.isErr()) {
    return err(assembled.error);
  }
  const updates = assembled.value;
  return checkVantaVulnerabilityBatch({ ids: updates.map((update) => update.id), verb: "deactivate" }).map(
    () => updates,
  );
}

/** Build the batch from whichever spelling was used, before Vanta's batch rules are applied. */
function assembleUnchecked({
  source,
}: {
  source: VantaDeactivateBatchSource;
}): Result<readonly VantaDeactivateUpdate[]> {
  if (source.kind === "form") {
    const text = readFormText({ path: source.path });
    if (text.isErr()) {
      return err(vantaVerbErrorLines({ error: text.error }));
    }
    return batchFromForm({ text: text.value }).mapErr((error) => vantaVerbErrorLines({ error }));
  }
  return batchFromFlags({
    ids: source.ids,
    reactivateWhenFixable: source.reactivateWhenFixable,
    reason: source.reason,
    until: source.until,
  }).mapErr((error) => vantaVerbErrorLines({ error }));
}

/** Print the resolved request and change nothing. */
function reportDryRun({
  base,
  updates,
}: {
  base: Omit<VantaDeactivateOptions, "updates">;
  updates: readonly VantaDeactivateUpdate[];
}): number {
  const request = resolveVantaWriteRequest({ input: { updates }, kind: "deactivate-vulnerabilities" });
  const digest = vantaDeactivateDigest({ updates });
  if (base.json) {
    logger.out({ line: JSON.stringify({ approve: digest, request, sent: false, updates }, null, 2) });
    return EXIT_OK;
  }
  for (const line of renderVantaDeactivateDryRun({ digest, request, updates })) {
    logger.out({ line });
  }
  return EXIT_OK;
}

/**
 * The door request this write makes.
 *
 * The artifact carries IDS AND SHAPE ONLY — never a reason. A deactivation reason is the owner's own words
 * about a security finding, and the ledger is a record that a write happened, not a copy of what it said.
 */
function deactivateDoorRequest({
  base,
  updates,
}: {
  base: Omit<VantaDeactivateOptions, "updates">;
  updates: readonly VantaDeactivateUpdate[];
}): Parameters<typeof throughDoor>[0]["request"] {
  return {
    action: { kind: "verb", noun: "write", verb: "vanta deactivate" },
    artifact: {
      findings: updates.map((update) => update.id),
      indefinite: updates.every((update) => update.deactivateUntilDate === undefined),
    },
    meta: { createsWorkItem: false, effect: "external-write", home: base.home, requiresApproval: true },
  };
}

/**
 * The one seam this verb injects: how a bound write client is obtained.
 *
 * It exists so the door's refusal can be proved at the REAL command boundary — a test hands in a client
 * that records whether Vanta was reached, runs the verb with no `--approve`, and asserts it never was. The
 * alternative was a mock, which this repo's testing rule bans and which would have proved only that a
 * different function was not called.
 *
 * @internal
 */
export interface VantaDeactivateDeps {
  /** Bind credentials and build the write client, or report every reason it could not be built. */
  readonly createClient: (input: {
    base: Omit<VantaDeactivateOptions, "updates">;
  }) => Result<VantaVulnerabilityWriteClient>;
  /** The door ledger the batch's decision is recorded through. */
  readonly doorLedger: DoorLedgerPort;
}

/** The production seam: resolve the credential pair the usual way and build the real HTTP client. */
const PRODUCTION_DEPS: VantaDeactivateDeps = {
  createClient: ({ base }) => {
    const bound = bindVanta({
      clientIdFile: base.clientIdFile,
      clientSecretFile: base.clientSecretFile,
      env: process.env,
      home: base.home,
    });
    return bound.isErr()
      ? err(vantaCredentialErrorsLines({ errors: bound.error }))
      : ok(createVantaVulnerabilityWriteClient(bound.value));
  },
  doorLedger: doorLedgerPort(),
};

/** Route the real batch through the door and report both arms of what came back. */
async function applyBatch({
  base,
  updates,
  deps,
}: {
  base: Omit<VantaDeactivateOptions, "updates">;
  updates: readonly VantaDeactivateUpdate[];
  deps: VantaDeactivateDeps;
}): Promise<number> {
  const bound = deps.createClient({ base });
  if (bound.isErr()) {
    bound.error.forEach((problem) => {
      logger.error({ msg: problem });
    });
    return EXIT_EXPECTED_EMPTY;
  }
  const client = bound.value;
  const routed = await throughDoor({
    gates: [vantaDeactivateApprovalGate({ expected: vantaDeactivateDigest({ updates }), supplied: base.approve })],
    home: base.home,
    ledger: deps.doorLedger,
    perform: () => client.deactivateVulnerabilities({ updates }),
    request: deactivateDoorRequest({ base, updates }),
  });
  if (!routed.performed) {
    for (const line of notPerformedLines({ command: "slopweaver write vanta deactivate", through: routed })) {
      logger.error({ msg: line });
    }
    return EXIT_ERROR;
  }
  if (routed.result.isErr()) {
    routed.result.error.forEach((problem) => {
      logger.error({ msg: problem });
    });
    return EXIT_ERROR;
  }
  const summary = summariseVantaVulnerabilityBatch({
    results: routed.result.value.results,
    sentIds: updates.map((update) => update.id),
  });
  if (base.json) {
    logger.out({ line: JSON.stringify({ sent: true, summary }, null, 2) });
  } else {
    for (const line of renderVantaVulnerabilityBatchOutcome({ summary, verb: "deactivate" })) {
      logger.out({ line });
    }
  }
  return exitCodeForVantaVulnerabilityBatch({ exitError: EXIT_ERROR, exitOk: EXIT_OK, summary });
}

/**
 * Run the `vanta deactivate` verb against an injected provider seam.
 *
 * @param argv the full process argv (verb tail starts at index 3)
 * @param deps how the write client is obtained
 * @returns the process exit code
 * @internal
 */
export async function runVantaDeactivateWith({
  argv,
  deps,
}: {
  argv: readonly string[];
  deps: VantaDeactivateDeps;
}): Promise<number> {
  const rest = verbTail({ argv, at: VANTA_VERB_INDEX, verbs: ["deactivate"] });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: VANTA_DEACTIVATE_USAGE });
    return EXIT_OK;
  }
  const parsed = parseVantaDeactivateOptions({ defaultHome: slopweaverHome(), rest });
  if (parsed.isErr()) {
    parsed.error.forEach((problem) => {
      logger.error({ msg: problem });
    });
    logger.error({ msg: VANTA_DEACTIVATE_USAGE });
    return EXIT_USAGE;
  }
  const { base, source } = parsed.value;

  const batch = assembleBatch({ source });
  if (batch.isErr()) {
    batch.error.forEach((problem) => {
      logger.error({ msg: problem });
    });
    return EXIT_USAGE;
  }
  return base.dryRun ? reportDryRun({ base, updates: batch.value }) : applyBatch({ base, deps, updates: batch.value });
}

/**
 * Run the `vanta deactivate` verb against the real Vanta write client.
 *
 * @param argv the full process argv (verb tail starts at index 3)
 * @returns the process exit code
 * @internal
 */
export async function runVantaDeactivate(argv: readonly string[]): Promise<number> {
  return runVantaDeactivateWith({ argv, deps: PRODUCTION_DEPS });
}

export const vantaDeactivateCommand = defineCommand({ run: runVantaDeactivate });
