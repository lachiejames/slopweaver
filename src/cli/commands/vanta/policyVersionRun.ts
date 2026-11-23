/**
 * `slopweaver atlas vanta policy-versions` — describe ONE policy's version workflow in the owner's own
 * Chrome, so an upload arm can be written against what the page offers rather than against a guess.
 *
 * ## Why this exists, and what it corrects
 *
 * `write vanta edit-policy-draft` drives Vanta's in-app rich-text editor, and that editor cannot touch a
 * policy loaded as a file: MEASURED, read-only, on a policy whose approved version reads **"Via
 * file upload (.docx)"**, `…/policies/<id>/edit` bounces back to the policy page with **"Policy draft is not
 * editable"**. Such a policy's route is uploading a new VERSION. It is per policy: one written in Vanta's own
 * editor reads **"Created in Vanta"** and takes the editor. This read is
 * how a session tells which a given policy is — the source line sits under the approved version in its
 * screenshot.
 *
 * ## It is a READ, and it is still a click
 *
 * A menu's items do not exist in the DOM until the menu is opened, so describing one means opening it. The
 * snippet opens a control that declares `aria-haspopup`, reads the item labels, photographs, and presses
 * Escape. It clicks no item, touches no file input and submits nothing — so this is `external-read` at the
 * door, and the upload it exists to inform is a separate, approval-gated arm that does not exist yet.
 *
 * ## The exit-code contract
 *
 * | situation                                     | code |
 * | --------------------------------------------- | ---- |
 * | a bad flag                                    | `2`  |
 * | the browser could not be reached              | `1`  |
 * | the page was described                        | `0`  |
 */
import { join } from "node:path";

import { doorLedgerPort } from "../../../admit/doorLedgerPort.js";
import { notPerformedLines } from "../../../admit/doorRefusal.js";
import { throughDoor } from "../../../admit/effects.js";
import { relayDepsAt } from "../../../atlas/kit/walkTransport.js";
import { VANTA_WEB_ORIGIN, vantaTenantRootFromSlug } from "../../../atlas/vanta/browserPages.js";
import { vantaAtlasPaths } from "../../../atlas/vanta/store.js";
import { resolveVantaTenantSlug } from "../../../atlas/vanta/tenantSlug.js";
import { type RecordedProfilePort, recordedProfilePort } from "../../../browser/recordedProfile.js";
import {
  createVantaPolicyVersionTransport,
  type VantaPolicyVersionObservation,
  type VantaPolicyVersionTransport,
} from "../../../browser/vantaPolicyVersion.js";
import { slopweaverHome } from "../../../homeDir.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { type FlagTailSpec, flagValue, flagValueOr, parseFlagTail, verbTail } from "../../optionParsers.js";
import { type VantaVerbError, VantaVerbErrors, vantaVerbErrorLines } from "./errors.js";

/** Where the verb sits in the full argv: `[node, cli, "atlas", "vanta", "policy-versions", …]`. */
const VANTA_VERB_INDEX = 4;

/** What this verb prints when asked how to use it.
 * @internal
 */
export const VANTA_POLICY_VERSIONS_USAGE = [
  "usage: slopweaver atlas vanta policy-versions --policy <id> [--tenant <slug>] [--json] [--home <dir>]",
  "  Opens the policy page in your own Chrome, opens its overflow menu, and reports what that menu offers.",
  "  Reads only: it clicks no menu item, touches no file input and submits nothing.",
].join("\n");

/**
 * The policy page one observation is bound to.
 *
 * @param tenantSlug the organisation's own Vanta workspace segment
 * @param policyId the policy this page belongs to
 * @returns the policy page's address
 */
export function vantaPolicyPageUrl({ tenantSlug, policyId }: { tenantSlug: string; policyId: string }): string {
  return `${vantaTenantRootFromSlug({ tenantSlug })}/policies/${encodeURIComponent(policyId)}`;
}

/** What this invocation was asked for. */
interface PolicyVersionsOptions {
  readonly policyId: string;
  readonly tenant: string | null;
  readonly home: string;
  readonly json: boolean;
}

/** Every flag this verb knows; an unknown one, or a value flag with no value after it, is refused by name. */
const POLICY_VERSIONS_FLAGS: FlagTailSpec = { boolean: ["json"], value: ["policy", "tenant", "home"] };

/**
 * Parse this verb's flags, refusing a value-taking flag passed with nothing after it rather than reading it as
 * never passed — a dangling `--home` would otherwise fall silently to the default home, and `--home --json`
 * would read a home called `--json`.
 *
 * @param rest the verb tail
 * @param defaultHome the resolved state home to use when `--home` is absent
 * @returns the options, or every reason they were refused
 */
export function parsePolicyVersionsOptions({
  rest,
  defaultHome,
}: {
  rest: readonly string[];
  defaultHome: string;
}): Result<PolicyVersionsOptions, VantaVerbError> {
  const parsed = parseFlagTail({ rest, spec: POLICY_VERSIONS_FLAGS });
  if (parsed.isErr()) {
    return err(VantaVerbErrors.flagsRefused({ reasons: parsed.error }));
  }
  const policyId = flagValue({ name: "policy", parsed: parsed.value });
  if (policyId === null) {
    return err(VantaVerbErrors.policyMissing());
  }
  if (policyId.length === 0) {
    return err(VantaVerbErrors.policyEmpty());
  }
  return ok({
    home: flagValueOr({ fallback: defaultHome, name: "home", parsed: parsed.value }),
    json: parsed.value.flags.has("json"),
    policyId,
    tenant: flagValue({ name: "tenant", parsed: parsed.value }),
  });
}

/**
 * Build the transport this read drives, bound to one policy page for its whole life.
 *
 * The Chrome pin is resolved here rather than inside the transport for the reason `policyDraftRun.ts`
 * states: without a recorded profile Chrome opens the connect page in whichever profile they last used, and
 * that must stop the run before anything launches.
 *
 * @param home the state home the token, the atlas directory and the recorded profile live under
 * @param url the policy page address
 * @param profiles the door the recorded work profile is read through
 * @returns a transport attached to the owner's own Chrome, or every reason there is none
 */
async function attachedPolicyPage({
  home,
  url,
  profiles,
}: {
  home: string;
  url: string;
  profiles: RecordedProfilePort;
}): Promise<Result<VantaPolicyVersionTransport>> {
  const scratchDir = join(vantaAtlasPaths({ home }).directory, "_policy-version");
  const deps = await relayDepsAt({ home, origins: [VANTA_WEB_ORIGIN], platform: "vanta", profiles, scratchDir });
  if (deps.isErr()) {
    return err(deps.error);
  }
  return ok(createVantaPolicyVersionTransport({ approvedDigest: null, deps: deps.value, url }));
}

/** Which control the read opened as the version menu — the read clicks nothing when no control declares one. */
function menuOpened({ observation }: { observation: VantaPolicyVersionObservation }): string {
  const opened = observation.opened;
  if (opened === null) {
    return "no control declared aria-haspopup — nothing was clicked";
  }
  return opened;
}

/** The items the opened menu held, or `none` when it held no labelled one. */
function menuItemList({ observation }: { observation: VantaPolicyVersionObservation }): string {
  const items = observation.menuItems.join(" | ");
  if (items === "") {
    return "none";
  }
  return items;
}

/** The human report one observation prints.
 * @internal
 *
 * @param observation what the read found
 * @returns the lines to print, in order
 */
export function policyVersionLines({ observation }: { observation: VantaPolicyVersionObservation }): readonly string[] {
  const lines = [
    `policy page: ${observation.title}`,
    `  settled on ${observation.finalUrl}`,
    `  menu opened: ${menuOpened({ observation })}`,
    `  ${String(observation.menuItems.length)} menu item(s): ${menuItemList({ observation })}`,
    `  ${String(observation.fileInputs.length)} file input(s)`,
  ];
  for (const input of observation.fileInputs) {
    lines.push(`    accept="${input.accept}" name="${input.name}" hidden=${String(input.hidden)}`);
  }
  lines.push(`  page buttons: ${observation.buttons.join(" | ")}`);
  if (observation.screenshotPath !== null) {
    lines.push(`  screenshot: ${observation.screenshotPath}`);
  }
  return lines;
}

/** Print every problem to stderr, so a refusal names all of what is wrong rather than the first thing. */
function printProblems({ problems }: { problems: readonly string[] }): void {
  for (const problem of problems) {
    logger.error({ msg: problem });
  }
}

/**
 * Run the policy-versions read.
 *
 * @param argv the full process argv; the flags start after `atlas vanta policy-versions`
 * @returns the process exit code
 */
// max-lines-exempt: the same parse -> door -> report shell as `policyUploadRun.ts`, with its report and its transport already hoisted.
export async function runVantaPolicyVersions(argv: readonly string[]): Promise<number> {
  const rest = verbTail({ argv, at: VANTA_VERB_INDEX, verbs: ["policy-versions"] });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: VANTA_POLICY_VERSIONS_USAGE });
    return EXIT_OK;
  }
  const parsed = parsePolicyVersionsOptions({ defaultHome: slopweaverHome(), rest });
  if (parsed.isErr()) {
    printProblems({ problems: vantaVerbErrorLines({ error: parsed.error }) });
    logger.error({ msg: VANTA_POLICY_VERSIONS_USAGE });
    return EXIT_USAGE;
  }
  const options = parsed.value;
  const slug = resolveVantaTenantSlug({ env: process.env, flag: options.tenant, home: options.home });
  if (slug.isErr()) {
    printProblems({ problems: slug.error });
    return EXIT_ERROR;
  }
  const url = vantaPolicyPageUrl({ policyId: options.policyId, tenantSlug: slug.value });
  const profiles = recordedProfilePort();
  const admitted = await throughDoor({
    gates: [],
    home: options.home,
    ledger: doorLedgerPort(),
    perform: async () => {
      const transport = await attachedPolicyPage({ home: options.home, profiles, url });
      if (transport.isErr()) {
        return err(transport.error);
      }
      try {
        return transport.value.observe().mapErr((error) => [error.message]);
      } finally {
        transport.value.release();
      }
    },
    request: {
      action: { kind: "verb", noun: "atlas", verb: "vanta policy-versions" },
      artifact: { policy: options.policyId, url },
      meta: { createsWorkItem: false, effect: "external-read", home: options.home, requiresApproval: false },
    },
  });
  if (!admitted.performed) {
    printProblems({
      problems: notPerformedLines({
        command: "slopweaver atlas vanta policy-versions",
        through: admitted,
      }),
    });
    return EXIT_ERROR;
  }
  const outcome = admitted.result;
  if (outcome.isErr()) {
    printProblems({ problems: outcome.error });
    return EXIT_ERROR;
  }
  if (options.json) {
    logger.out({ line: JSON.stringify(outcome.value, null, 2) });
    return EXIT_OK;
  }
  for (const line of policyVersionLines({ observation: outcome.value })) {
    logger.info({ msg: line });
  }
  return EXIT_OK;
}
