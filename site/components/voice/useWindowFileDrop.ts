/**
 * A file dragged anywhere over the console page drops into Messenger's composer, the way a file dragged anywhere over
 * ChatGPT lands in its box. A drop taken only on the one-line box is a target too small to find.
 *
 * Listened for on the window, so a drop on the conversation above the box lands too. Only a drag carrying files is
 * touched: dragging text or a link about the page behaves as it always did. A file drop is always cancelled, taken or
 * not, so a browser tab never navigates away to the dropped file. When two composers are mounted at once, the first
 * listener takes the drop and the second sees it already cancelled, so a file is never kept twice.
 */
import { useEffect, useEffectEvent, useState } from "react";

/**
 * Whether a drag event carries files from outside the page.
 *
 * @param event the drag event
 * @returns true when its transfer lists `Files`
 */
function carriesFiles(event: DragEvent): boolean {
  return event.dataTransfer?.types.includes("Files") === true;
}

/**
 * Take a file dropped anywhere on the window, and say while one is being dragged over it.
 *
 * @param onFiles takes the dropped transfer's files
 * @returns whether a file drag is over the window right now
 */
export function useWindowFileDrop({ onFiles }: { onFiles: (transfer: DataTransfer) => void }): boolean {
  const [dragging, setDragging] = useState(false);
  // The newest handler, so the listeners are bound once and still see the composer's current render.
  const dropped = useEffectEvent(onFiles);
  useEffect(() => {
    // Enter and leave fire for every element the drag crosses; the count reaches zero only when it leaves the window.
    let depth = 0;
    const onEnter = (event: DragEvent): void => {
      if (carriesFiles(event)) {
        depth += 1;
        setDragging(true);
      }
    };
    const onLeave = (event: DragEvent): void => {
      if (!carriesFiles(event)) {
        return;
      }
      depth = Math.max(0, depth - 1);
      if (depth === 0) {
        setDragging(false);
      }
    };
    const onOver = (event: DragEvent): void => {
      // A drop fires only on a target whose dragover was cancelled.
      if (carriesFiles(event) && event.dataTransfer !== null) {
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }
    };
    const onDrop = (event: DragEvent): void => {
      depth = 0;
      setDragging(false);
      if (!carriesFiles(event) || event.dataTransfer === null || event.defaultPrevented) {
        return;
      }
      event.preventDefault();
      dropped(event.dataTransfer);
    };
    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("dragover", onOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("drop", onDrop);
    };
  }, []);
  return dragging;
}
