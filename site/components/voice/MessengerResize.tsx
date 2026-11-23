"use client";

/**
 * Resizing the messenger, both ways: the edges away from the orb and
 * the corner between them, dragged directly with no mode to enter, and ONE size menu in the header — Small, Large, Full
 * screen and "Reset size and position". Minimise stays its own control. In the corner those are the left and top edges,
 * since the card hangs off the orb's top left; beside an orb the owner dragged elsewhere they are whichever face the
 * middle of the screen (`messengerPlace.ts` `messengerResizeEdges`). An older shell, one that cannot widen its window,
 * cannot hold the pointer past the card either, so under it no edge draws and the size menu is the way to resize.
 */
import { Scaling } from "lucide-react";
import type { ReactElement, PointerEvent as ReactPointerEvent } from "react";

import { type MessengerResizeEdge, type MessengerSizePick, messengerSizeMenu } from "../../lib/messengerSize";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../ui/dropdown-menu";

/** Each edge's grab strip, inside the card's border, and the cursor it wears. */
const EDGE_CLASS: Readonly<Record<MessengerResizeEdge, string>> = {
  bottom: "absolute inset-x-3 bottom-0 z-10 h-1.5 cursor-ns-resize touch-none",
  "bottom-left": "absolute bottom-0 left-0 z-10 size-3 cursor-nesw-resize touch-none",
  "bottom-right": "absolute right-0 bottom-0 z-10 size-3 cursor-nwse-resize touch-none",
  left: "absolute inset-y-3 left-0 z-10 w-1.5 cursor-ew-resize touch-none",
  right: "absolute inset-y-3 right-0 z-10 w-1.5 cursor-ew-resize touch-none",
  top: "absolute inset-x-3 top-0 z-10 h-1.5 cursor-ns-resize touch-none",
  "top-left": "absolute top-0 left-0 z-10 size-3 cursor-nwse-resize touch-none",
  "top-right": "absolute top-0 right-0 z-10 size-3 cursor-nesw-resize touch-none",
};

/**
 * The grab strips on the card's edges away from the orb, and their corner.
 *
 * @param canDrag the shell can grow its window and hold the pointer through a drag, and the screen has room, so the
 *   edges draw
 * @param edges the edges away from the orb, on the side the card opens on
 * @param begin starts a drag of one edge
 * @returns the strips, none under an older shell
 */
export function MessengerResizeHandles({
  canDrag,
  edges,
  begin,
}: {
  canDrag: boolean;
  edges: readonly MessengerResizeEdge[];
  begin: (input: { edge: MessengerResizeEdge; event: ReactPointerEvent<HTMLElement> }) => void;
}): ReactElement {
  let drawn: readonly MessengerResizeEdge[] = [];
  if (canDrag) {
    drawn = edges;
  }
  return (
    <>
      {drawn.map((edge) => (
        <span
          key={edge}
          aria-hidden="true"
          data-resize-edge={edge}
          className={EDGE_CLASS[edge]}
          onPointerDown={(event) => {
            begin({ edge, event });
          }}
        />
      ))}
    </>
  );
}

/**
 * The header's size menu.
 *
 * @param choose keeps a preset, or resets the size and the orb's place
 * @param onFullscreen opens the call on the stage
 * @param canFullscreen a call is up, which the stage is for
 * @returns the menu's button and its rows
 */
export function MessengerSizeMenu({
  choose,
  onFullscreen,
  canFullscreen,
}: {
  choose: (input: { pick: MessengerSizePick }) => void;
  onFullscreen: () => void;
  canFullscreen: boolean;
}): ReactElement {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="grid size-8 shrink-0 cursor-pointer place-items-center rounded-full border-0 bg-transparent text-muted-foreground hover:bg-(--c-panel) hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary"
          aria-label="size"
          title="size (or drag an edge away from the orb)"
        >
          <Scaling aria-hidden="true" className="size-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" collisionPadding={8} data-overlay-interactive="">
        {messengerSizeMenu().map(({ action, label }) => (
          <DropdownMenuItem
            key={action}
            disabled={action === "fullscreen" && !canFullscreen}
            onSelect={() => {
              if (action === "fullscreen") {
                onFullscreen();
                return;
              }
              choose({ pick: action });
            }}
          >
            {label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
