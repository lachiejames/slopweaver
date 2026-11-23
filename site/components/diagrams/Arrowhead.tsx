import type { ReactElement } from "react";
/**
 * The one arrowhead every diagram points with.
 *
 * It fills with `currentColor`, so an arrow inherits the figure's ink instead of carrying a hue of its
 * own — a colour in these drawings means a stage, and an arrowhead is not a stage.
 */
export function Arrowhead({ id }: { id: string }): ReactElement {
  return (
    <defs>
      <marker id={id} markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto">
        <polygon points="0,0 9,4.5 0,9" fill="currentColor" />
      </marker>
    </defs>
  );
}
