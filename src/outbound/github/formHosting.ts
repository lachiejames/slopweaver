/**
 * Where a C3 body's proof is hosted — one of the form rules `./formRules.ts` applies.
 *
 * Proof belongs on the description, uploaded as a GitHub user attachment, never in a release, a pull-request comment
 * or a file committed with git. So every screenshot is a `https://github.com/user-attachments/assets/<id>` upload,
 * and a link in any proof line, reason or check pointing at a release download, a comment or a committed media file
 * is refused, each naming `slopweaver github attach`.
 */
import type { FormRuleCode, FormRuleIssue } from "./formRules.js";
import type { Content, PrBody, ProofSlot } from "./types.js";

/** The one host a screenshot may point at: a GitHub user-attachments upload. */
const USER_ATTACHMENT = /^https:\/\/github\.com\/user-attachments\/assets\/[A-Za-z0-9-]+$/;

/**
 * Whether a URL is a GitHub user-attachments upload — the one predicate, so the form's hosting rule and the frozen
 * reading-order reader's pasted-media criterion (`./legacy/pastedMedia.ts`) can never disagree about it.
 *
 * @param url the address to judge
 * @returns true for exactly `https://github.com/user-attachments/assets/<id>`
 */
export function isUserAttachmentUrl({ url }: { url: string }): boolean {
  return USER_ATTACHMENT.test(url);
}

/** The fix every hosting refusal names. */
const ATTACH_FIX =
  "Upload the file with `slopweaver github attach <file>` and use the https://github.com/user-attachments/assets/<id> " +
  "URL it prints";

/** A committed media file's extension, at the end of a URL path. */
const MEDIA_EXTENSION = /\.(?:png|jpe?g|gif|webp|mp4|webm|mov)$/i;

/** Why a link's address is not where proof lives, or undefined when it may stand. */
function linkHostIssue({ url }: { url: string }): { code: FormRuleCode; why: string } | undefined {
  if (url.includes("/releases/download/")) {
    return { code: "EVIDENCE_RELEASE_DOWNLOAD", why: "a GitHub release download" };
  }
  if (/#(?:issuecomment-|discussion_r|pullrequestreview-)/.test(url)) {
    return { code: "EVIDENCE_COMMENT_LINK", why: "a pull-request or issue comment" };
  }
  const parsed = URL.parse(url);
  if (parsed === null) {
    return undefined;
  }
  const committedHost =
    parsed.hostname === "raw.githubusercontent.com" ||
    (parsed.hostname === "github.com" && /\/(?:blob|raw)\//.test(parsed.pathname));
  if (committedHost && MEDIA_EXTENSION.test(parsed.pathname)) {
    return { code: "EVIDENCE_COMMITTED_MEDIA", why: "a media file committed with git" };
  }
  return undefined;
}

/** The link issues of one cell. */
function contentLinkIssues({
  content,
  path,
}: {
  content: Content;
  path: readonly (string | number)[];
}): readonly FormRuleIssue[] {
  return content.flatMap((run, index): FormRuleIssue[] => {
    const issue = run.kind === "link" ? linkHostIssue({ url: run.url }) : undefined;
    if (run.kind !== "link" || issue === undefined) {
      return [];
    }
    const message = `the link ${run.url} points at ${issue.why}; proof lives on the description. ${ATTACH_FIX}`;
    return [{ code: issue.code, message, path: [...path, index] }];
  });
}

/** One proof slot's hosting issues: its picture off user-attachments, a link in its line to a refused host. */
function slotIssues({ slot, field }: { slot: ProofSlot; field: string }): readonly FormRuleIssue[] {
  if (slot.kind === "reason") {
    return contentLinkIssues({ content: slot.reason, path: [field, "reason"] });
  }
  const image: readonly FormRuleIssue[] = USER_ATTACHMENT.test(slot.image.url)
    ? []
    : [
        {
          code: "IMAGE_NOT_USER_ATTACHMENT",
          message: `the screenshot ${slot.image.url} is not a GitHub user-attachments upload. ${ATTACH_FIX}`,
          path: [field, "image", "url"],
        },
      ];
  return [...image, ...contentLinkIssues({ content: slot.proves, path: [field, "proves"] })];
}

/**
 * Where proof is hosted, across both proof slots and every check.
 *
 * @param body the body whose slots and checks are read
 * @returns every screenshot off user-attachments and every link to a refused host, each naming the fix
 */
export function hostingIssues({ body }: { body: PrBody }): readonly FormRuleIssue[] {
  return [
    ...slotIssues({ field: "problemProof", slot: body.problemProof }),
    ...slotIssues({ field: "solutionProof", slot: body.solutionProof }),
    ...body.checks.flatMap((content, index) => contentLinkIssues({ content, path: ["checks", index] })),
  ];
}
