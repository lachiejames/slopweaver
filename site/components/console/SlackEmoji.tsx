/*
 * A Slack emoji drawn the way the desktop client draws it, rather than as its `:name:` text form — the whole rule lives in `../../lib/slackEmoji.ts`. Text only: a glyph is a character in a
 * span, never an image and never markup, and a name the standard set does not hold (a workspace custom emoji) draws as
 * the words its author typed.
 */

import { Fragment, type ReactElement } from "react";
import { type EmojiPiece, emojiElementGlyph, emojiPieces, type SlackSkinTone } from "../../lib/slackEmoji";

/** One drawn emoji, its shortcode as the hover, as Slack's own hover shows it. */
function Glyph({ glyph, written }: { glyph: string; written: string }): ReactElement {
  return <span title={written}>{glyph}</span>;
}

/**
 * A rich-text `emoji` element: the emoji Slack's own `unicode` spells, else the standard set's by name and tone, else
 * — a workspace custom emoji, whose image the console does not have — its `:name:`, muted.
 *
 * @param unicode the element's own hex spelling, when Slack recorded one
 * @param skinTone the element's `skin_tone`, when it carried one
 * @returns the emoji, or its name
 */
export function SlackEmoji({
  name,
  unicode,
  skinTone,
}: {
  name: string;
  unicode: string | undefined;
  skinTone: SlackSkinTone | undefined;
}): ReactElement {
  const written = `:${name}:`;
  const glyph = emojiElementGlyph({ name, skinTone, unicode });
  if (glyph !== undefined) {
    return <Glyph glyph={glyph} written={written} />;
  }
  return <span className="text-muted-foreground">{written}</span>;
}

/**
 * Text with each standard shortcode in it drawn as its emoji, everything else — an unknown `:name:` and code included —
 * exactly as written.
 *
 * @param text the text as drawn, its wire escapes already read
 * @returns the text and its emoji
 */
export function EmojiText({ text }: { text: string }): ReactElement {
  return <EmojiPieces pieces={emojiPieces({ text })} />;
}

/**
 * Pieces already decided — words as written, emoji as their glyph with the shortcode on hover.
 *
 * @param pieces what `emojiPieces` or `draftTextPieces` read the text as
 * @returns the drawn pieces
 */
export function EmojiPieces({ pieces }: { pieces: readonly EmojiPiece[] }): ReactElement {
  return (
    <>
      {pieces.map((piece, at) =>
        piece.kind === "text" ? (
          // eslint-disable-next-line react/no-array-index-key -- a piece's position is its identity
          <Fragment key={at}>{piece.text}</Fragment>
        ) : (
          // eslint-disable-next-line react/no-array-index-key -- same
          <Glyph glyph={piece.glyph} key={at} written={piece.written} />
        ),
      )}
    </>
  );
}
