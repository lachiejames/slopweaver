/**
 * BARE REFERENCES in a Notion page body — a thin wrapper over `../linkify/bareRefs.ts`'s `linkifyMarkdown`,
 * because `./markdownBody.ts`'s whole body is already one raw markdown string with nothing else to walk.
 */
import { type BareRefContext, type BareRefIssue, bareRefRefusalMessage, linkifyMarkdown } from "../linkify/bareRefs.js";

/** The result of linkifying a page body: the rewritten markdown, plus every reference still bare. */
interface LinkifiedMarkdownBody {
  readonly markdown: string;
  readonly issues: readonly BareRefIssue[];
}

/**
 * A Notion page body, with every resolvable bare reference rewritten as a markdown link.
 *
 * @param markdown the composed page body, without its H1 title line
 * @param context what the caller knows about the destination
 * @returns the rewritten body, plus every reference still bare afterward, addressed to `body`
 */
export function linkifyPageBody({
  markdown,
  context,
}: {
  markdown: string;
  context: BareRefContext;
}): LinkifiedMarkdownBody {
  const linkified = linkifyMarkdown({ context, text: markdown });
  return {
    issues: linkified.unresolved.map((span) => ({
      message: bareRefRefusalMessage({ context: linkified.context, span }),
      path: ["body"],
    })),
    markdown: linkified.text,
  };
}
