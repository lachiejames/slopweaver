/**
 * `slopweaver write vanta <verb>` — the mutations this program performs at Vanta.
 *
 * Thin by design: it names which verb was asked for and hands the whole argv on. The verb itself keeps its
 * own parsing, its own door routing and its own dry-run, none of which moved when the noun did.
 *
 * Every member is the same shape: `external-write`, door-routed, holding behind an approval digest, and
 * with a `--dry-run` that returns BEFORE the door so a preview never lands in the ledger as a mutation that
 * did not happen.
 *
 * **Two of them reach Vanta through the owner's own Chrome rather than the Manage API**, because there is
 * no Manage API operation that touches a policy version at all. The rule is that writes in Vanta are allowed. They are not interchangeable, and which one applies is a property of
 * the POLICY: `edit-policy-draft` types one exact substitution into Vanta's in-app editor, and
 * `upload-policy-version` renders a policy markdown file to a PDF and attaches it as a new DRAFT version.
 * A policy loaded as a file (`Via file upload` on its page) is refused by the editor outright (`Policy draft
 * is not editable`), so the upload is the only route it has; one `Created in Vanta` takes the editor. Three
 * of five sampled were the latter (`slopweaver atlas vanta policy-versions --policy <id>`
 * shows which). Both write before their
 * final click — the editor autosaves, and starting a renewal creates a draft — and both say so.
 *
 * Deactivation stops Vanta monitoring a finding and records the stated reason against it, which is visible
 * to everyone reading that workspace and moves a control's own count. Reactivation is its reverse: it puts
 * a finding back in front of every control that counts it. The three document writes create an
 * evidence document, attach a file to it and submit it for review — an auditor's own reading material.
 *
 * `group-people` moves people into and out of ONE group, which is what Vanta hangs a person's
 * policy-acceptance obligations off, so it mints and retires real tasks against real people. It is the
 * answer to the rule that a card telling the owner to click through Vanta pages is a
 * capability gap. It does NOT change which documents a group assigns: the reviewed Manage API contract has
 * no operation that does, and `atlas/vanta/groupApiSchemas.ts` names the operations examined.
 *
 * `writeClient.ts`'s `deleteUpload` and `deleteDocument` are deliberately reached by NO verb here. That is
 * the standing decision `writePreview.ts`'s header records: destructive Vanta writes have no preview
 * anywhere, and a destructive verb whose `--dry-run` cannot show what it would remove is not one this
 * program ships. Nor is there an update-a-document verb — the Manage API surface has no such call at all,
 * so a document's title and description are settable at CREATE only.
 */
import { logger } from "../../../lib/logger.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";

/** Where the verb sits: past the runtime, the script, the `write` noun and the `vanta` platform. */
const WRITE_VERB_INDEX = 4;

/** The verbs `write vanta` answers. */
export const WRITE_VANTA_VERBS: readonly string[] = [
  "create-document",
  "deactivate",
  "edit-policy-draft",
  "group-people",
  "reactivate",
  "submit-document",
  "upload-evidence",
  "upload-policy-version",
];

/** The usage block printed when the verb is missing or unknown. */
export const WRITE_VANTA_USAGE = `usage: slopweaver write vanta <${WRITE_VANTA_VERBS.join(" | ")}>`;

/**
 * Dispatch one Vanta mutation, or explain what this platform answers.
 *
 * @param argv the whole process argv
 * @returns the process exit code
 */
export async function runWriteVanta(argv: readonly string[]): Promise<number> {
  const verb = argv[WRITE_VERB_INDEX];
  if (verb === "upload-policy-version") {
    const { runVantaUploadPolicyVersion } = await import("../vanta/policyUploadRun.js");
    return runVantaUploadPolicyVersion(argv);
  }
  if (verb === "edit-policy-draft") {
    const { runVantaEditPolicyDraft } = await import("../vanta/policyDraftRun.js");
    return runVantaEditPolicyDraft(argv);
  }
  if (verb === "group-people") {
    const { runVantaGroupPeople } = await import("../vanta/groupPeopleRun.js");
    return runVantaGroupPeople(argv);
  }
  if (verb === "deactivate") {
    const { vantaDeactivateCommand } = await import("../vanta/deactivateRun.js");
    return vantaDeactivateCommand(argv);
  }
  if (verb === "reactivate") {
    const { vantaReactivateCommand } = await import("../vanta/reactivateRun.js");
    return vantaReactivateCommand(argv);
  }
  if (verb === "create-document" || verb === "upload-evidence" || verb === "submit-document") {
    const { runVantaDocument } = await import("../vanta/documentRun.js");
    return runVantaDocument({ argv, verb });
  }
  const tail = new Set(argv.slice(WRITE_VERB_INDEX));
  if (tail.has("--help") || tail.has("-h")) {
    logger.out({ line: WRITE_VANTA_USAGE });
    return EXIT_OK;
  }
  logger.error({
    msg: verb === undefined ? "slopweaver write vanta needs a verb" : `slopweaver write vanta has no verb "${verb}"`,
  });
  logger.error({ msg: WRITE_VANTA_USAGE });
  return EXIT_USAGE;
}

export const writeVantaCommand = defineCommand({ run: runWriteVanta });
