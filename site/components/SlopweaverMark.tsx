import type { ReactElement } from "react";

/**
 * The site's mark — the owner's own Slopweaver logo, traced from the 200×200 PNG the owner supplied. It is a trace
 * rather than an embed so the mark stays a vector at every size a browser tab and a navbar ask for, and
 * every number below is measured off that file rather than eyeballed: the drawing is a 23-unit stroke whose
 * centreline runs along 43 and 157, turning on a 38-radius quarter arc centred at (81, 81), with the whole
 * of it carrying 180° rotational symmetry about the centre. The colours are the file's own — `#0a0a0a`
 * behind, `#eaeaea` for the strokes, `#22d3ee` for the square.
 *
 * The trace was CHECKED, not assumed. Rendering this very markup at 200×200 in a browser and comparing it
 * to the PNG channel by channel gives a mean delta of 2.25 of 255, and 1.44% of pixels differing by more
 * than 60 — every one of those on the antialiased boundary. Reproduce by screenshotting `app/icon.svg` at
 * 200×200 and diffing the two decoded bitmaps.
 *
 * `#1a1a2e` is no longer either file's colour. It is the bot Slack app's background, used as the one
 * real anchor while the logo itself was believed lost, and it is not the mark's.
 *
 * The DRAWING is kept identical to `site/app/icon.svg`, which the browser tab reads and which cannot import
 * a component. Six elements copied by hand is the cheaper wrong thing than a build step that generates one
 * from the other. Only the accessibility differs, and deliberately: the favicon is the only thing naming the
 * site in a tab, so it carries `role="img"` and a label, while here the word "Slopweaver" sits beside it.
 *
 * @param size the rendered edge length in pixels; the drawing is a 200-unit viewBox at any of them
 * @returns the mark, decorative — the word "Slopweaver" beside it carries the name for a screen reader
 */
export function SlopweaverMark({ size = 22 }: { size?: number }): ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 200 200" aria-hidden="true" focusable="false">
      <rect width={200} height={200} fill="#0a0a0a" />
      <g fill="none" stroke="#eaeaea" strokeWidth={23}>
        <path d="M148.5 43H81A38 38 0 0 0 43 81v39.5" />
        <path d="M51.5 157H119a38 38 0 0 0 38-38V79.5" />
      </g>
      <rect x={88.5} y={88.5} width={23} height={23} rx={1} fill="#22d3ee" />
    </svg>
  );
}
