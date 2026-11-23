/**
 * The `linear-document` destination of `proposal publish`: the proposal becomes a Linear document, written by
 * the `linear document` command rather than by a second Linear writer.
 *
 * ## Which document a publish writes
 *
 * A first publish CREATES under the install's Linear target. That door derives the document's id from the form
 * itself, so this adapter knows the id before the write and records it whatever the door's report looks like —
 * and an identical form published twice is refused by the door as the duplicate it is. A re-publish UPDATES the
 * recorded document by its id, and the door refuses it when the page was edited in Linear since slopweaver
 * wrote it, or when the install's target has moved: an update never moves a document.
 *
 * ## What is recorded
 *
 * The address is recorded only when the door reports the write landed. A write the door could not confirm is
 * left unrecorded: the next identical publish is then refused as a duplicate rather than creating a second
 * document, and an edited one needs the operator to reconcile with the door's own report.
 */
import type { ProposalAddress } from "../../../outbound/proposal/address.js";
import { proposalLinearDocumentForm } from "../../../outbound/proposal/linearDocument.js";
import { EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { documentIntentId } from "../linear/documentCore.js";
import type { LinearDocumentWriteDeps } from "../linear/documentDeps.js";
import type { PublishTarget } from "./publishCore.js";
import type { PublishOutcome } from "./publishRunShared.js";

/**
 * The Linear entity a publish writes under: the install's configured target. On an update it must still be the
 * one the document was created under, which the door itself checks against its own ledger.
 *
 * @param target the reconciled publish target
 * @returns the Linear destination the form names
 */
export function linearPublishDestination({ target }: { target: PublishTarget }): {
  readonly kind: "initiative" | "issue" | "project" | "team";
  readonly id: string;
} {
  if (target.destination.kind !== "linear-document") {
    throw new Error(`a ${target.destination.kind} destination was dispatched to the Linear door`);
  }
  return target.destination.target;
}

/** The `linear document create|update` argv a publish runs: an update names the recorded document by id. */
function linearDocumentArgv({
  target,
  id,
  dryRun,
  home,
}: {
  target: PublishTarget;
  id: string;
  dryRun: boolean;
  home: string;
}): readonly string[] {
  return [
    "node",
    "slopweaver",
    "linear",
    "document",
    target.kind,
    "--form",
    "-",
    ...(target.kind === "update" ? ["--document-id", id] : []),
    ...(dryRun ? ["--dry-run"] : []),
    "--home",
    home,
  ];
}

/**
 * Publish one proposal as a Linear document.
 *
 * @param target the reconciled publish target; a create goes under the install's Linear target, an update to the
 *   recorded document
 * @param markdown the linted proposal markdown
 * @param home the state home
 * @param title the proposal's title; `proposal publish` refuses before this without one, and this refuses again
 * @param icon an emoji shown before the title
 * @param dryRun preview through the door, writing nothing
 * @param runDocument the `linear document` command, taking its argv and its edges
 * @param documentDeps that command's production edges, whose form source this replaces
 * @param err where refusal lines go
 * @returns the exit code, and the address written — none on a dry run, a refusal or an unconfirmed write
 */
export async function publishLinearProposal({
  target,
  markdown,
  home,
  title,
  icon,
  dryRun,
  runDocument,
  documentDeps,
  err,
}: {
  target: PublishTarget;
  markdown: string;
  home: string;
  title: string | undefined;
  icon: string | undefined;
  dryRun: boolean;
  runDocument: (args: { argv: readonly string[]; deps: LinearDocumentWriteDeps }) => Promise<number>;
  documentDeps: LinearDocumentWriteDeps;
  err: (line: string) => void;
}): Promise<PublishOutcome> {
  if (title === undefined || title.trim().length === 0) {
    err('--title "<text>" is required to publish to a linear-document. Nothing was published.');
    return { address: undefined, code: EXIT_USAGE };
  }
  const form = proposalLinearDocumentForm({ destination: linearPublishDestination({ target }), icon, markdown, title });
  if (form.isErr()) {
    err(`${form.error.message}. Nothing was published.`);
    return { address: undefined, code: EXIT_USAGE };
  }
  const id = target.kind === "update" ? target.address.id : documentIntentId({ form: form.value });
  let url: string | undefined;
  const code = await runDocument({
    argv: linearDocumentArgv({ dryRun, home, id, target }),
    deps: {
      ...documentDeps,
      out: (line) => {
        // The URL is read out of the door's OWN report, so the two can never disagree about what was written.
        if (line.startsWith("https://")) {
          url = line.trim();
        }
        documentDeps.out(line);
      },
      readForm: () => JSON.stringify(form.value),
    },
  });
  if (dryRun || code !== EXIT_OK) {
    return { address: undefined, code };
  }
  const address: ProposalAddress = url === undefined ? { id, provider: "linear" } : { id, provider: "linear", url };
  return { address, code };
}
