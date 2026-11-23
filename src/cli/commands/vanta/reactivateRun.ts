/**
 * `slopweaver write vanta reactivate --ids <id[,id...]>` — puts deactivated Vanta findings back under
 * monitoring, through the admit door. The reverse of {@link ./deactivateRun}, and built the same way: a
 * `--dry-run` that prints the exact bytes and the digest, an `--approve <digest>` the door holds on, and a
 * per-finding reconciliation of what Vanta answered.
 *
 * ## Why `--dry-run` returns BEFORE the door
 *
 * A dry run performs no external write, so routing it would record a decision in the ledger for something
 * that never happened. It resolves the exact request, prints it with its digest, and returns.
 *
 * ## The exit-code contract
 *
 * | situation                                          | code |
 * | -------------------------------------------------- | ---- |
 * | a bad flag, or a batch Vanta's own rules refuse    | `2`  |
 * | credentials genuinely not configured               | `3`  |
 * | the door refused, or any item in the batch did     | `1`  |
 * | a dry run, or a batch every item of which landed   | `0`  |
 */
import { type DoorLedgerPort, doorLedgerPort } from "../../../admit/doorLedgerPort.js";
import { notPerformedLines } from "../../../admit/doorRefusal.js";
import { throughDoor } from "../../../admit/effects.js";
import { vantaCredentialErrorsLines } from "../../../atlas/vanta/credentialErrors.js";
import { vantaReactivateApprovalGate, vantaReactivateDigest } from "../../../atlas/vanta/reactivateApproval.js";
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
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { verbTail } from "../../optionParsers.js";
import { bindVanta } from "./binding.js";
import {
  parseVantaReactivateOptions,
  renderVantaReactivateDryRun,
  type VantaReactivateOptions,
} from "./reactivateCore.js";
import { exitCodeForVantaVulnerabilityBatch, renderVantaVulnerabilityBatchOutcome } from "./vulnerabilityBatchLines.js";

/** Where a Vanta write verb sits: past the runtime, the script, the `write` noun and the `vanta` platform. */
const VANTA_VERB_INDEX = 4;

/** The one copy. The manifest row names the platform's verbs; each verb's own usage lives with the verb. */
export const VANTA_REACTIVATE_USAGE =
  "usage: slopweaver write vanta reactivate --ids <id[,id...]> [--approve <digest>] [--dry-run] [--json]\n" +
  "       [--home <dir>]\n" +
  "       [--client-id-file <path> --client-secret-file <path>]\n" +
  "  Puts the named deactivated findings BACK UNDER MONITORING. Every control that counts them sees them\n" +
  "  again, and the deactivation it undoes — its reason, author and until-date — is not restored by\n" +
  "  deactivating again\n" +
  "  --ids        the findings, comma-separated; Vanta takes at most 50 in one call\n" +
  "  --approve    the digest printed by --dry-run, which covers that exact batch. Without it the door\n" +
  "               HOLDS and nothing is sent; the refusal is recorded, and the digest is in it\n" +
  "  --dry-run    resolve and print the exact request, send nothing, touch no ledger\n" +
  "  Run --dry-run first: it prints the bytes, not a description of them";

/** The request this batch would send, and the digest an approval of it must carry. */
function resolveBatch({ options }: { options: VantaReactivateOptions }): {
  readonly request: ReturnType<typeof resolveVantaWriteRequest>;
  readonly digest: string;
} {
  const request = resolveVantaWriteRequest({
    input: { updates: options.updates },
    kind: "reactivate-vulnerabilities",
  });
  return { digest: vantaReactivateDigest({ request }), request };
}

/** Print the resolved request and change nothing. */
function reportDryRun({ options }: { options: VantaReactivateOptions }): number {
  const { request, digest } = resolveBatch({ options });
  if (options.json) {
    logger.out({
      line: JSON.stringify({ approve: digest, request, sent: false, updates: options.updates }, null, 2),
    });
    return EXIT_OK;
  }
  for (const line of renderVantaReactivateDryRun({ digest, request, updates: options.updates })) {
    logger.out({ line });
  }
  return EXIT_OK;
}

/** The door request this write makes — the ids it would reactivate, which is all the batch carries. */
function reactivateDoorRequest({
  options,
}: {
  options: VantaReactivateOptions;
}): Parameters<typeof throughDoor>[0]["request"] {
  return {
    action: { kind: "verb", noun: "write", verb: "vanta reactivate" },
    artifact: { findings: options.updates.map((update) => update.id) },
    meta: { createsWorkItem: false, effect: "external-write", home: options.home, requiresApproval: true },
  };
}

/**
 * The one seam this verb injects: how a bound write client is obtained, so the door's refusal is provable
 * at the real command boundary without a mock.
 *
 * @internal
 */
export interface VantaReactivateDeps {
  /** Bind credentials and build the write client, or report every reason it could not be built. */
  readonly createClient: (input: { options: VantaReactivateOptions }) => Result<VantaVulnerabilityWriteClient>;
  /** The door ledger the batch's decision is recorded through. */
  readonly doorLedger: DoorLedgerPort;
}

/** The production seam: resolve the credential pair the usual way and build the real HTTP client. */
const PRODUCTION_DEPS: VantaReactivateDeps = {
  createClient: ({ options }) => {
    const bound = bindVanta({
      clientIdFile: options.clientIdFile,
      clientSecretFile: options.clientSecretFile,
      env: process.env,
      home: options.home,
    });
    return bound.isErr()
      ? err(vantaCredentialErrorsLines({ errors: bound.error }))
      : ok(createVantaVulnerabilityWriteClient(bound.value));
  },
  doorLedger: doorLedgerPort(),
};

/** Route the real batch through the door and report both arms of what came back. */
async function applyBatch({
  options,
  deps,
}: {
  options: VantaReactivateOptions;
  deps: VantaReactivateDeps;
}): Promise<number> {
  const bound = deps.createClient({ options });
  if (bound.isErr()) {
    bound.error.forEach((problem) => {
      logger.error({ msg: problem });
    });
    return EXIT_EXPECTED_EMPTY;
  }
  const client = bound.value;
  const { digest } = resolveBatch({ options });
  const routed = await throughDoor({
    gates: [vantaReactivateApprovalGate({ expected: digest, supplied: options.approve })],
    home: options.home,
    ledger: deps.doorLedger,
    perform: () => client.reactivateVulnerabilities({ updates: options.updates }),
    request: reactivateDoorRequest({ options }),
  });
  if (!routed.performed) {
    for (const line of notPerformedLines({ command: "slopweaver write vanta reactivate", through: routed })) {
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
    sentIds: options.updates.map((update) => update.id),
  });
  if (options.json) {
    logger.out({ line: JSON.stringify({ sent: true, summary }, null, 2) });
  } else {
    for (const line of renderVantaVulnerabilityBatchOutcome({ summary, verb: "reactivate" })) {
      logger.out({ line });
    }
  }
  return exitCodeForVantaVulnerabilityBatch({ exitError: EXIT_ERROR, exitOk: EXIT_OK, summary });
}

/**
 * Run the `vanta reactivate` verb against an injected provider seam.
 *
 * @param argv the full process argv
 * @param deps how the write client is obtained
 * @returns the process exit code
 * @internal
 */
export async function runVantaReactivateWith({
  argv,
  deps,
}: {
  argv: readonly string[];
  deps: VantaReactivateDeps;
}): Promise<number> {
  const rest = verbTail({ argv, at: VANTA_VERB_INDEX, verbs: ["reactivate"] });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: VANTA_REACTIVATE_USAGE });
    return EXIT_OK;
  }
  const parsed = parseVantaReactivateOptions({ defaultHome: slopweaverHome(), rest });
  if (parsed.isErr()) {
    parsed.error.forEach((problem) => {
      logger.error({ msg: problem });
    });
    logger.error({ msg: VANTA_REACTIVATE_USAGE });
    return EXIT_USAGE;
  }
  const options = parsed.value;
  const checked = checkVantaVulnerabilityBatch({
    ids: options.updates.map((update) => update.id),
    verb: "reactivate",
  });
  if (checked.isErr()) {
    checked.error.forEach((problem) => {
      logger.error({ msg: problem });
    });
    return EXIT_USAGE;
  }
  return options.dryRun ? reportDryRun({ options }) : applyBatch({ deps, options });
}

/**
 * Run the `vanta reactivate` verb against the real Vanta write client.
 *
 * @param argv the full process argv
 * @returns the process exit code
 * @internal
 */
export async function runVantaReactivate(argv: readonly string[]): Promise<number> {
  return runVantaReactivateWith({ argv, deps: PRODUCTION_DEPS });
}

export const vantaReactivateCommand = defineCommand({ run: runVantaReactivate });
