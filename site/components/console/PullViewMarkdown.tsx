/** A body of markdown as GitHub renders it, over Streamdown: its link chips, its rehype chain and its body layout. */
import { type ComponentProps, type ReactElement } from "react";
import { defaultRehypePlugins } from "streamdown";

import { MessageResponse } from "@/components/ai-elements/message";

import { rehypeGithubBody } from "../../lib/githubMarkdown";
import { pictureCount } from "../../lib/pullView";
import { cn } from "../../lib/utils";
import { CitationChip } from "./CitationChip";

/**
 * A link inside rendered markdown: a footnote's own anchor stays an anchor, every other address is a cited record
 * drawn as its chip — so a pull request a comment names opens here too.
 */
function MarkdownLink({
  href,
  children,
  node: _node,
  ...rest
}: ComponentProps<"a"> & { node?: unknown }): ReactElement {
  if (href === undefined || href.startsWith("#")) {
    return (
      <a href={href} {...rest} className="text-gh-accent">
        {children}
      </a>
    );
  }
  // A chip truncates rather than wraps, so its whole text is its minimum width: capped, a long link sentence inside
  // a table cell cannot widen the table past its box.
  return (
    <CitationChip reference={{ kind: "address", url: href }} look="inline" className="max-w-[24rem]">
      {children}
    </CitationChip>
  );
}

/** Streamdown's overrides, one object for the module because `MessageResponse` memoises on its text. */
const MARKDOWN_COMPONENTS = { a: MarkdownLink };

/** One of Streamdown's own rehype passes, by name — a release that renames one fails here, never silently. */
function streamdownPass({ name }: { name: string }): (typeof defaultRehypePlugins)[string] {
  const pass = defaultRehypePlugins[name];
  if (pass === undefined) {
    throw new Error(`streamdown no longer ships its "${name}" rehype pass, so the pull request view's chain is wrong`);
  }
  return pass;
}

/**
 * Streamdown's own chain with GitHub's badges, anchor targets and alerts between sanitize and harden
 * (`lib/githubMarkdown.ts` says why there): a `rehypePlugins` prop REPLACES the chain, so all four are named.
 */
const GITHUB_REHYPE = [
  streamdownPass({ name: "raw" }),
  streamdownPass({ name: "sanitize" }),
  rehypeGithubBody,
  streamdownPass({ name: "harden" }),
];

/**
 * GitHub's own body layout over Streamdown's: lists with their markers outside a 2em indent, a heading's rule, an
 * upright quote. Aimed at the elements, never at a code block, whose colours `contrastSources.test.ts` holds.
 */
const GITHUB_BODY =
  "[&_ol]:list-outside! [&_ul]:list-outside! [&_ol]:pl-8! [&_ul]:pl-8! [&_li]:my-1 [&_h1]:border-b [&_h2]:border-b [&_h1]:border-gh-border [&_h2]:border-gh-border [&_h1]:pb-1.5 [&_h2]:pb-1.5 [&_blockquote]:not-italic [&_blockquote]:border-gh-border [&_blockquote]:text-gh-muted";

/** A body of markdown as GitHub renders it, with the pictures it would not fetch counted rather than dropped. */
export function Markdown({ text, url }: { text: string; url: string }): ReactElement {
  if (text.trim() === "") {
    return <p className="m-0 text-muted-foreground italic">No description provided.</p>;
  }
  const pictures = pictureCount({ body: text });
  return (
    <>
      {/* A code block inside a table cell scrolls within the cell, as on GitHub: its longest line is its minimum width,
          and a diagram in one cell widened the whole table past its box and clipped every row (acme-admin#17561's
          Risk table). `w-0` + `min-w-full` on Streamdown's own code-block wrapper takes it out of the cell's minimum
          width and still fills the cell. Streamdown also caps a table's height with an INLINE `maxHeight` and scrolls
          the rest, which hid every row past the third of a PR body's table; `!` is the only thing that beats an inline
          style. */}
      <div
        className={cn(
          "min-w-0 text-[0.88rem] leading-[1.5] [&_table]:w-full [&_td]:align-top [&_td_[data-streamdown=code-block]]:w-0 [&_td_[data-streamdown=code-block]]:min-w-full [&_td_[data-streamdown=code-block]]:overflow-x-auto [&_[data-streamdown=table-wrapper]_*]:max-h-none!",
          GITHUB_BODY,
        )}
      >
        {/* GitHub draws a table and a code block bare: no copy, download or fullscreen toolbar, no line numbers. */}
        <MessageResponse
          components={MARKDOWN_COMPONENTS}
          rehypePlugins={GITHUB_REHYPE}
          controls={false}
          lineNumbers={false}
        >
          {text}
        </MessageResponse>
      </div>
      {pictures > 0 && (
        <p className="mt-2 mb-0 text-[0.74rem] text-muted-foreground">
          {String(pictures)} picture{pictures === 1 ? "" : "s"} in this text {pictures === 1 ? "is" : "are"} not drawn
          here (the console never fetches a remote image);{" "}
          <a href={url} target="_blank" rel="noreferrer">
            see {pictures === 1 ? "it" : "them"} in GitHub
          </a>
        </p>
      )}
    </>
  );
}
