import type { ReactElement, ReactNode } from "react";

import { PageVoice } from "../voice/PageVoice";
import { ContextChip } from "./workContextState";

/**
 * The content column under the bar: capped so a line stays readable on a wide screen, and inset the same
 * as the bar above it, narrowing with it on a small window.
 */
export const PAGE_BODY = "max-w-[1120px] px-8 pt-1 pb-12 max-[760px]:px-4";

/**
 * The bar every console page opens with: its name and one line of what it is. It also names the page to the
 * console voice, which is how the voice knows every page without each one saying so.
 *
 * In the desktop app's window, which has no title strip, the bar's blank gaps move the window the way a title bar
 * would; everything drawn in it stays clickable and selectable (`.sw-window-drag`, `console-tw.css`).
 *
 * When the bar runs out of width it wraps whole items onto a second row (a page's chips) rather than breaking the
 * one-line description mid-phrase.
 *
 * @param title the page's name
 * @param sub one sentence of what it shows
 * @param children anything drawn in the bar after the title — a count chip, a filter
 * @returns the bar
 */
export function PageHead({ title, sub, children }: { title: string; sub: string; children?: ReactNode }): ReactElement {
  return (
    <header className="sw-window-drag flex flex-wrap items-center gap-x-[0.8rem] gap-y-2 border-x-0 border-t-0 border-b border-solid border-border sw-glass-plane sw-glass-ground px-8 py-[0.9rem] max-[760px]:px-4">
      <PageVoice title={title} />
      <h1 className="m-0 whitespace-nowrap text-[1.15rem] font-[650] tracking-[-0.01em]">{title}</h1>
      <ContextChip />
      <span className="whitespace-nowrap text-[0.82rem] text-muted-foreground max-[760px]:whitespace-normal">
        {sub}
      </span>
      {children}
    </header>
  );
}
