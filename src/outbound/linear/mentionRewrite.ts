/**
 * Turning `@{key}` into Linear's own mention markup, across a whole issue body or comment.
 *
 * Two passes, and they are separate on purpose. Collecting every key FIRST means one resolution covers the
 * whole body, so a refusal names every unresolvable person at once rather than sending the caller round
 * again for the second one — the same reason `../../cli/commands/linear/run.ts` concatenates the assignee
 * and workflow-state refusals instead of short-circuiting between them.
 *
 * The substitution never guesses: a key with no resolution is left EXACTLY as it was written, because the
 * caller is about to be refused and a half-rewritten body is not a thing anyone should be shown. See
 * `./mentionIndex.ts` for the markup, the token and why the caller may not write the markup directly.
 */
import type { LinearCommentArtifact } from "./commentTypes.js";
import { mapCommentArtifactText, mapDocumentContentText, mapIssueArtifactText, type TextMapper } from "./mapText.js";
import { type LinearMentionResolution, mentionKeysOfText, mentionToken, renderLinearMention } from "./mentionIndex.js";
import type { FreeformBlock, LinearIssueArtifact } from "./types.js";

/** A mapper that changes nothing and reports every mention key it saw, into the array it closes over. */
function collectingMapper({ into }: { into: string[] }): TextMapper {
  return ({ text }) => {
    for (const key of mentionKeysOfText({ text })) {
      if (!into.includes(key)) {
        into.push(key);
      }
    }
    return { issues: [], text };
  };
}

/** A mapper that replaces each resolved token with Linear's markup, leaving an unresolved one untouched. */
function rewritingMapper({ resolution }: { resolution: LinearMentionResolution }): TextMapper {
  return ({ text }) => ({
    issues: [],
    text: text.replaceAll(mentionToken(), (whole: string, key: string) => {
      const target = resolution.resolved.get(key.trim());
      return target === undefined ? whole : renderLinearMention({ target });
    }),
  });
}

/**
 * Every mention key an issue body names, in first-appearance order.
 *
 * @param artifact the composed issue body
 * @returns each distinct key, once
 */
export function mentionKeysOfIssue({ artifact }: { artifact: LinearIssueArtifact }): readonly string[] {
  const keys: string[] = [];
  mapIssueArtifactText({ artifact, map: collectingMapper({ into: keys }) });
  return keys;
}

/**
 * Every mention key a comment names, in first-appearance order.
 *
 * @param artifact the composed comment
 * @returns each distinct key, once
 */
export function mentionKeysOfComment({ artifact }: { artifact: LinearCommentArtifact }): readonly string[] {
  const keys: string[] = [];
  mapCommentArtifactText({ artifact, map: collectingMapper({ into: keys }) });
  return keys;
}

/**
 * Every mention key a document body names, in first-appearance order.
 *
 * @param content the document's blocks
 * @returns each distinct key, once
 */
export function mentionKeysOfDocument({ content }: { content: readonly FreeformBlock[] }): readonly string[] {
  const keys: string[] = [];
  mapDocumentContentText({ content, map: collectingMapper({ into: keys }) });
  return keys;
}

/**
 * Rewrite every resolved mention in a document body into Linear's markup.
 *
 * @param content the document's blocks
 * @param resolution what each key resolved to
 * @returns the rewritten blocks
 */
export function rewriteDocumentMentions({
  content,
  resolution,
}: {
  content: readonly FreeformBlock[];
  resolution: LinearMentionResolution;
}): readonly FreeformBlock[] {
  return mapDocumentContentText({ content, map: rewritingMapper({ resolution }) }).content;
}

/**
 * Rewrite every resolved mention in an issue body into Linear's markup.
 *
 * @param artifact the composed issue body
 * @param resolution what each key resolved to
 * @returns the rewritten body
 */
export function rewriteIssueMentions({
  artifact,
  resolution,
}: {
  artifact: LinearIssueArtifact;
  resolution: LinearMentionResolution;
}): LinearIssueArtifact {
  return mapIssueArtifactText({ artifact, map: rewritingMapper({ resolution }) }).artifact;
}

/**
 * Rewrite every resolved mention in a comment into Linear's markup.
 *
 * @param artifact the composed comment
 * @param resolution what each key resolved to
 * @returns the rewritten comment
 */
export function rewriteCommentMentions({
  artifact,
  resolution,
}: {
  artifact: LinearCommentArtifact;
  resolution: LinearMentionResolution;
}): LinearCommentArtifact {
  return mapCommentArtifactText({ artifact, map: rewritingMapper({ resolution }) }).artifact;
}
