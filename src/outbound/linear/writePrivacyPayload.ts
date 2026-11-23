/**
 * What the Linear write transport's privacy guard judges in one GraphQL operation or one asset upload, and the
 * verdict over it. Pure: the effectful half — loading the policy from a home and refusing before anything is sent —
 * is `./writePrivacy.ts`, called by `../../corpus/linear/writeGraphql.ts`'s `sendGraphql` and by the upload's PUT.
 *
 * ## Which operations are writes
 *
 * A document `isGraphqlMutation` (`../../lib/graphqlOperation.ts`) calls a mutation: any mutation definition, a
 * mutation after a fragment, a mixed document, and a document that does not parse. A query is a read, an authored
 * search included, and never loads the policy.
 *
 * ## What is judged
 *
 * The mutation DOCUMENT itself and every string leaf of its variables, at any depth, with no key skipped: an
 * argument written inline in the document is sent as surely as a variable. Today every write document is a
 * `String(LinearDocument.…)` from the pinned SDK and none interpolates an authored value, but that is a fact about
 * the current callers, not a property this guard relies on. The cost is stated: a private-term pattern that matches
 * committed GraphQL syntax refuses the mutation.
 *
 * An upload's BYTES are judged when its filename has a text-like extension (`TEXT_UPLOAD_EXTENSIONS`, shared with
 * the Slack guard), decoded as strict UTF-8; a text-like file that is not valid UTF-8 refuses. Every other file
 * passes with its bytes unread — an image, a PDF, an archive, OCR-visible text, EXIF — and only its name is judged.
 *
 * ## Where it goes
 *
 * The installation's own Linear workspace ({@link LINEAR_IDENTIFIER_AUDIENCE}), which forgives forbidden-identifier
 * findings only: installation state, credentials, the denylist and private terms refuse exactly as anywhere else.
 * The residue: a guest, or an externally shared Linear surface, receives what that audience forgives.
 */
import { isGraphqlMutation } from "../../lib/graphqlOperation.js";
import { err, ok, type Result } from "../../lib/result.js";
import {
  checkPrivacy,
  type PrivacyDestination,
  type PrivacyFinding,
  type PrivacyPolicy,
  UNASSESSED_PERSONAL_MATERIAL,
} from "../privacyCheck.js";
import { TEXT_UPLOAD_EXTENSIONS } from "../slack/writePrivacyPayload.js";
import { payloadLeaves } from "../writePrivacyLeaves.js";

/** One string the guard judges, and the locus a refusal names it by. */
export interface LinearWriteLeaf {
  readonly locus: string;
  readonly text: string;
}

/** Who reads a forbidden identifier in Linear: the installation's own organisation workspace. One line to change. */
export const LINEAR_IDENTIFIER_AUDIENCE: PrivacyDestination["identifierAudience"] = "installation-workspace";

/** The destination every Linear write is judged under. */
export const LINEAR_WORKSPACE_DESTINATION: PrivacyDestination = {
  identifierAudience: LINEAR_IDENTIFIER_AUDIENCE,
  installationIdentifiers: undefined,
  ownRepository: undefined,
};

/**
 * Every string one GraphQL operation would send that the guard judges, each under its locus: none for a query.
 *
 * @param operation the door's label for the operation, `linear.issueCreate`
 * @param query the GraphQL document as sent
 * @param variables the operation's variables as sent
 * @returns the document first, then every variable leaf in walk order; empty when the document is a read
 */
export function linearGraphqlLeaves({
  operation,
  query,
  variables,
}: {
  operation: string;
  query: string;
  variables: Readonly<Record<string, unknown>>;
}): readonly LinearWriteLeaf[] {
  if (!isGraphqlMutation({ document: query })) {
    return [];
  }
  const leaves = payloadLeaves({ path: "", skipKey: () => false, value: variables }).map(({ path, text }) => ({
    locus: `linear ${operation} ${path}`,
    text,
  }));
  return [{ locus: `linear ${operation} document`, text: query }, ...leaves];
}

/**
 * The filename and, for a text-like file, the decoded bytes of one asset upload, each under its locus.
 *
 * @param fileName the name the file is uploaded under
 * @param bytes the file's contents
 * @returns the leaves, or the refusal for a text-like file that is not valid UTF-8
 */
export function linearUploadLeaves({
  fileName,
  bytes,
}: {
  fileName: string;
  bytes: Uint8Array;
}): Result<readonly LinearWriteLeaf[], string> {
  const name: LinearWriteLeaf = { locus: "linear attach upload fileName", text: fileName };
  const dot = fileName.lastIndexOf(".");
  if (dot < 0 || !TEXT_UPLOAD_EXTENSIONS.has(fileName.slice(dot + 1).toLowerCase())) {
    return ok([name]);
  }
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return ok([name, { locus: "linear attach upload file", text }]);
  } catch {
    return err("linear attach upload file: a text-like file that is not valid UTF-8, so it cannot be judged");
  }
}

/**
 * Judge every leaf of one write against the outbound privacy check, in the installation's own Linear workspace.
 *
 * @param leaves the operation's or upload's leaves
 * @param policy the denylist, identifier rules and private terms the check reads
 * @returns every finding, leaf by leaf in walk order; empty when the write may be sent
 */
export function linearWriteFindings({
  leaves,
  policy,
}: {
  leaves: readonly LinearWriteLeaf[];
  policy: PrivacyPolicy;
}): readonly PrivacyFinding[] {
  return leaves.flatMap(
    (leaf) =>
      checkPrivacy({
        content: leaf,
        destination: LINEAR_WORKSPACE_DESTINATION,
        personalMaterial: UNASSESSED_PERSONAL_MATERIAL,
        policy,
      }).findings,
  );
}
