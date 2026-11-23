/**
 * `slopweaver write vanta edit-policy-draft` — the one route a policy change can take at Vanta.
 *
 * ## Why a browser verb, and why this one
 *
 * Vanta's Manage API declares 240 operations and exactly two touch policies, both GET (measured;
 * `yarn tsx tools/generateVantaEndpoints.ts --verify --fetch`). There is no upload-a-version operation, so a
 * policy change is unreachable from this program except through the web client. So the fleet must be able to write into the Vanta browser:
 * it is the only way to upload a new policy version, and writing in Vanta is the fleet's job.
 *
 * ## The order, and why each step is where it is
 *
 * 1. Read the draft in their Chrome, through the relay, under the Vanta lane's own lease.
 * 2. Check it is an editable draft at all — judged on the page's own controls, not on a synced status.
 * 3. Resolve the substitution and compute the digest. `--dry-run` prints the diff and returns HERE, before
 *    the door, so a preview never lands in the ledger as a mutation that did not happen.
 * 4. Through the door as an `external-write` with the approval gate. Only on `pass` is anything typed.
 *
 * The read happens BEFORE the door rather than inside it, deliberately: a read is not the effect, and the
 * digest has to cover the draft as it actually stands or an approval would be transplantable onto a
 * document that had changed. The cost is that the draft can move between the read and the write, which is
 * what the snippet's own in-page uniqueness check is for — it types nothing if the text is no longer there.
 *
 * ## THE EDITOR AUTOSAVES
 *
 * Measured from a live capture: the toolbar reads *Auto-save enabled*. So the external write
 * boundary is the substitution, not the Save click, and a run whose outcome is unknown has left a real
 * compliance document in an unknown state. Every failure path here says so and none of them retries.
 *
 * ## The exit-code contract
 *
 * | situation                                                                         | code |
 * | --------------------------------------------------------------------------------- | ---- |
 * | a bad flag, or a tenant that could not be resolved                                | `2`  |
 * | the read before the door failed: the browser could not be attached or read, the   | `2`  |
 * | page is not an editable draft, or the substitution resolved to nothing            |      |
 * | the door refused                                                                  | `1`  |
 * | the write failed: a dead-host refusal, the browser could not be attached, or the  | `1`  |
 * | edit errored, was refused in the page, or is not in the reopened draft            |      |
 * | `--help`, a dry run, or a substitution the reopened draft holds                   | `0`  |
 */
import { join } from "node:path";

import { type DoorLedgerPort, doorLedgerPort } from "../../../admit/doorLedgerPort.js";
import { notPerformedLines } from "../../../admit/doorRefusal.js";
import { throughDoor } from "../../../admit/effects.js";
import { relayDepsAt } from "../../../atlas/kit/walkTransport.js";
import { VANTA_WEB_ORIGIN } from "../../../atlas/vanta/browserPages.js";
import { vantaDraftEditDeadHostRefusal } from "../../../atlas/vanta/deadHostRefusal.js";
import {
  buildVantaDraftEditPlan,
  checkEditableDraft,
  type VantaDraftEditPlan,
  type VantaDraftSnapshot,
  vantaDraftEditDigest,
} from "../../../atlas/vanta/policyDraft.js";
import { vantaEditPolicyDraftApprovalGate } from "../../../atlas/vanta/policyDraftApproval.js";
import { vantaAtlasPaths } from "../../../atlas/vanta/store.js";
import { resolveVantaTenantSlug } from "../../../atlas/vanta/tenantSlug.js";
import { type RecordedProfilePort, recordedProfilePort } from "../../../browser/recordedProfile.js";
import {
  createVantaPolicyEditorTransport,
  type VantaEditorMutation,
  type VantaPolicyEditorTransport,
} from "../../../browser/vantaPolicyEditor.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome, verbTail } from "../../optionParsers.js";
import {
  parseVantaEditPolicyDraftOptions,
  renderVantaEditDryRun,
  VANTA_EDIT_POLICY_DRAFT_USAGE,
  type VantaEditPolicyDraftOptions,
  vantaPolicyEditorUrl,
} from "./policyDraftCore.js";

/** Where the verb sits: past the runtime, the script, the `write` noun and the `vanta` platform. */
const VANTA_VERB_INDEX = 4;

/**
 * Build the transport this edit drives, bound to one editor address for its whole life.
 *
 * The pin is resolved here rather than inside the transport because a missing recorded profile must stop
 * the run BEFORE anything launches: without it Chrome opens the connect page in whichever profile they last
 * used, which is what `src/browser/profilePin.ts` exists to prevent.
 *
 * @param home the state home the token, the atlas directory and the recorded profile live under
 * @param url the policy editor address
 * @param approvedDigest the substitution digest the door admitted, or `null` for a read-only transport
 * @param profiles the door the recorded work profile is read through
 * @returns a transport attached to the owner's own Chrome, or every reason there is none
 */
async function attachedEditor({
  home,
  url,
  approvedDigest,
  profiles,
}: {
  home: string;
  url: string;
  approvedDigest: string | null;
  profiles: RecordedProfilePort;
}): Promise<Result<VantaPolicyEditorTransport>> {
  const scratchDir = join(vantaAtlasPaths({ home }).directory, "_policy-draft");
  const deps = await relayDepsAt({ home, origins: [VANTA_WEB_ORIGIN], platform: "vanta", profiles, scratchDir });
  if (deps.isErr()) {
    return err(deps.error);
  }
  return ok(createVantaPolicyEditorTransport({ approvedDigest, deps: deps.value, url }));
}

/**
 * Read the draft and resolve the substitution against it.
 *
 * @param editor the bound transport
 * @param options the validated invocation
 * @param nowIso the instant the read is recorded at
 * @returns the snapshot and the plan, or every reason there is neither
 */
function resolveEdit({
  editor,
  options,
  nowIso,
}: {
  editor: VantaPolicyEditorTransport;
  options: VantaEditPolicyDraftOptions;
  nowIso: string;
}): Result<{ snapshot: VantaDraftSnapshot; plan: VantaDraftEditPlan }> {
  const observed = editor.readDraft();
  if (observed.isErr()) {
    return err([observed.error.message]);
  }
  const snapshot: VantaDraftSnapshot = {
    controls: observed.value.controls,
    finalUrl: observed.value.finalUrl,
    observedAtIso: nowIso,
    regionCount: observed.value.regionCount,
    regionTextLengths: observed.value.regions.map((region) => region.textLength),
    text: observed.value.text,
    title: observed.value.title,
  };
  const editable = checkEditableDraft({ snapshot });
  if (editable.isErr()) {
    return err([editable.error.message]);
  }
  const plan = buildVantaDraftEditPlan({ find: options.find, replace: options.replace, snapshot });
  if (plan.isErr()) {
    return err([plan.error.message]);
  }
  return ok({ plan: plan.value, snapshot });
}

/**
 * Say what the edit came to, whether or not it landed.
 *
 * A mutation the snippet REFUSED is reported as a refusal that typed nothing; anything else is reported
 * with what the editor actually holds now, because after an autosaving keystroke the reader's next question
 * is always "what is in there".
 *
 * @param mutation what the snippet reported
 * @param json whether machine-readable output was asked for
 * @returns the process exit code
 */
function reportMutation({ mutation, json }: { mutation: VantaEditorMutation; json: boolean }): number {
  if (json) {
    logger.out({ line: JSON.stringify(mutation, null, 1) });
    return mutation.refused === null && mutation.persisted ? EXIT_OK : EXIT_ERROR;
  }
  if (mutation.refused !== null) {
    logger.out({ line: `edit-policy-draft refused in the page and typed nothing: ${mutation.refused}` });
    return EXIT_ERROR;
  }
  if (mutation.persisted) {
    logger.out({ line: `edit-policy-draft applied and VERIFIED — ${mutation.finalUrl}` });
    logger.out({ line: "  the editor was reopened from scratch and holds the substitution" });
    if (mutation.screenshotPath !== null) {
      logger.out({ line: `  evidence: ${mutation.screenshotPath}` });
    }
    return EXIT_OK;
  }
  logger.out({ line: unpersistedLines({ mutation }).join("\n") });
  if (mutation.screenshotPath !== null) {
    logger.out({ line: `  evidence: ${mutation.screenshotPath}` });
  }
  return EXIT_ERROR;
}

/** Why the keystroke never landed, as the snippet reported it — it may report the failure with no reason. */
function undeliveredBecause({ mutation }: { mutation: VantaEditorMutation }): string {
  const reason = mutation.typeError;
  if (reason === null) {
    return "no reason given";
  }
  return reason;
}

/**
 * What to say when the editor was typed into and the substitution is NOT in the reopened draft.
 *
 * Three different situations reach here and they are not interchangeable: the keystroke never landed
 * (nothing happened), it landed and the editor did not take it (nothing happened, and the verb has a
 * defect), or the reopened read could not be taken at all (the outcome is genuinely unknown, and the
 * editor autosaves). Only the last one leaves a real compliance document in a state nobody knows.
 *
 * @param mutation what the snippet reported
 * @returns the lines to print
 * @internal
 */
export function unpersistedLines({ mutation }: { mutation: VantaEditorMutation }): readonly string[] {
  if (mutation.persistError !== null) {
    return [
      "edit-policy-draft typed into the draft and then COULD NOT RE-READ IT: " + mutation.persistError,
      "  the editor autosaves, so the outcome is genuinely unknown. Open the draft and look before " +
        "running anything else against it. Do not repeat this command",
    ];
  }
  if (!mutation.typed) {
    return [
      `edit-policy-draft could not deliver the keystroke: ${undeliveredBecause({ mutation })}`,
      "  the reopened draft is unchanged, so nothing was written",
    ];
  }
  if (!mutation.matched) {
    return [
      "edit-policy-draft typed, and the editor's own text is not what the plan expected",
      "  the reopened draft does not hold the substitution either, so nothing was stored",
    ];
  }
  return [
    "edit-policy-draft typed, the editor took it, and the REOPENED draft does not hold it — Vanta stored nothing",
    "  nothing was written. This is the failure mode the reopened read exists to catch: a save that " +
      "reports success and persists the model it already had",
  ];
}

/**
 * Apply one exact substitution to a Vanta policy draft.
 *
 * @param argv the whole process argv
 * @returns the process exit code
 */
export async function runVantaEditPolicyDraft(argv: readonly string[]): Promise<number> {
  const rest = verbTail({ argv, at: VANTA_VERB_INDEX, verbs: ["edit-policy-draft"] });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: VANTA_EDIT_POLICY_DRAFT_USAGE });
    return EXIT_OK;
  }
  const options = parseVantaEditPolicyDraftOptions({ rest });
  if (options.isErr()) {
    options.error.forEach((problem) => {
      logger.error({ msg: problem });
    });
    logger.out({ line: VANTA_EDIT_POLICY_DRAFT_USAGE });
    return EXIT_USAGE;
  }
  const home = resolveHome({ named: options.value.home });
  const tenantSlug = resolveVantaTenantSlug({
    env: process.env,
    flag: options.value.tenant,
    home,
  });
  if (tenantSlug.isErr()) {
    tenantSlug.error.forEach((problem) => {
      logger.error({ msg: problem });
    });
    return EXIT_USAGE;
  }
  const url = vantaPolicyEditorUrl({ policy: options.value.policy, tenantSlug: tenantSlug.value });
  const profiles = recordedProfilePort();
  const resolved = await readAndResolve({ home, options: options.value, profiles, url });
  if (resolved.isErr()) {
    resolved.error.forEach((problem) => {
      logger.error({ msg: problem });
    });
    return EXIT_USAGE;
  }
  const { plan, snapshot } = resolved.value;
  const digest = vantaDraftEditDigest({ plan });
  if (options.value.dryRun) {
    renderVantaEditDryRun({ digest, plan, title: snapshot.title }).forEach((line) => {
      logger.out({ line });
    });
    return EXIT_OK;
  }
  return applyThroughDoor({ digest, home, ledger: doorLedgerPort(), options: options.value, plan, profiles, url });
}

/**
 * Read the draft through a READ-ONLY transport and resolve the substitution against it.
 *
 * The transport is built with `approvedDigest: null`, so its edit arm cannot fire at all during the read —
 * and it is released before the door is reached, so the write opens its own lease against a page it reads
 * again. The snapshot is evidence, never authority.
 *
 * @param home the state home the token and the recorded profile live under
 * @param url the policy editor address
 * @param options the validated invocation
 * @param profiles the door the recorded work profile is read through
 * @returns the snapshot and the plan, or every reason there is neither
 */
async function readAndResolve({
  home,
  url,
  options,
  profiles,
}: {
  home: string;
  url: string;
  options: VantaEditPolicyDraftOptions;
  profiles: RecordedProfilePort;
}): Promise<Result<{ snapshot: VantaDraftSnapshot; plan: VantaDraftEditPlan }>> {
  const reader = await attachedEditor({ approvedDigest: null, home, profiles, url });
  if (reader.isErr()) {
    return err(reader.error);
  }
  try {
    return resolveEdit({ editor: reader.value, nowIso: new Date().toISOString(), options });
  } finally {
    reader.value.release();
  }
}

/**
 * Admit the substitution, then type it.
 *
 * The write transport is constructed INSIDE the admitted effect and bound to the digest the door just
 * admitted, so a refusal leaves no transport that could have typed.
 *
 * @param home the state home the ledger is written under
 * @param url the policy editor address
 * @param plan the resolved substitution
 * @param digest the approval digest over it
 * @param options the validated invocation
 * @param profiles the door the recorded work profile is read through
 * @param ledger the door ledger the decision is recorded through
 * @returns the process exit code
 */
async function applyThroughDoor({
  home,
  url,
  plan,
  digest,
  options,
  profiles,
  ledger,
}: {
  home: string;
  url: string;
  plan: VantaDraftEditPlan;
  digest: string;
  options: VantaEditPolicyDraftOptions;
  profiles: RecordedProfilePort;
  ledger: DoorLedgerPort;
}): Promise<number> {
  const admitted = await throughDoor({
    gates: [vantaEditPolicyDraftApprovalGate({ expected: digest, supplied: options.approve })],
    home,
    ledger,
    perform: async () => {
      // The dead-Datadog-host refusal: this write types into a browser, so no provider transport sees it.
      const refusal = vantaDraftEditDeadHostRefusal({ plan });
      if (refusal !== undefined) {
        return err(refusal);
      }
      const writer = await attachedEditor({ approvedDigest: digest, home, profiles, url });
      if (writer.isErr()) {
        return err(writer.error);
      }
      try {
        return writer.value.editDraft({ plan }).mapErr((error) => [error.message]);
      } finally {
        writer.value.release();
      }
    },
    request: {
      action: { kind: "verb", noun: "write", verb: "vanta edit-policy-draft" },
      artifact: { digest, policy: options.policy, url: plan.url },
      meta: { createsWorkItem: false, effect: "external-write", home, requiresApproval: true },
    },
  });
  if (!admitted.performed) {
    notPerformedLines({ command: "slopweaver write vanta edit-policy-draft", through: admitted }).forEach((line) => {
      logger.out({ line });
    });
    return EXIT_ERROR;
  }
  if (admitted.result.isErr()) {
    admitted.result.error.forEach((problem) => {
      logger.error({ msg: problem });
    });
    return EXIT_ERROR;
  }
  return reportMutation({ json: options.json, mutation: admitted.result.value });
}
