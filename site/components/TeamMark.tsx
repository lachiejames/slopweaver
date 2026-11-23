import type { ReactElement } from "react";

/**
 * The team's mark — three white figures, one forward and two behind, on a dark tile — for every place the console
 * names the team's context or a team-raised row.
 *
 * A ROLE drawing, not any organisation's logo: the team workspace is whichever organisation this installation works
 * for, so its mark names the role and never a name. It sits on the same dark tile as {@link SlopweaverMark} so the
 * two marks read as a pair in the context switcher.
 *
 * @param size the rendered edge length in pixels; the drawing is a 344-unit viewBox at any of them
 * @returns the mark, decorative — the context's name beside it carries it for a screen reader
 */
export function TeamMark({ size = 22 }: { size?: number }): ReactElement {
  return (
    <svg width={size} height={size} viewBox="-40 -40 424 424" aria-hidden="true" focusable="false">
      <rect x={-40} y={-40} width={424} height={424} fill="#0a0a0a" />
      <g fill="#ffffff">
        <circle cx={76} cy={118} r={38} />
        <path d="M8 262C8 210 38 178 76 178C114 178 144 210 144 262Z" />
        <circle cx={268} cy={118} r={38} />
        <path d="M200 262C200 210 230 178 268 178C306 178 336 210 336 262Z" />
      </g>
      <g fill="#ffffff" stroke="#0a0a0a" strokeWidth={14}>
        <circle cx={172} cy={128} r={50} />
        <path d="M82 320C82 248 122 206 172 206C222 206 262 248 262 320Z" />
      </g>
    </svg>
  );
}
