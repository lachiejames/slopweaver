/**
 * The screen-edge glow, drawn by four thin windows along the primary display's edges rather than by the voice's own
 * window, so a call no longer holds that window over the owner's whole desktop. Pure: `edgeGlowShell.ts` owns the windows.
 *
 * Why four strips. macOS's window picker (⌘⇧5 → Capture Selected Window) hit-tests a window by its layer's coverage,
 * not its pixels' alpha, and a Chromium window always carries one full-size layer — so a whole-display overlay is
 * picked wherever the owner points, and its shot is the overlay itself: a white canvas holding only the orb. MEASURED
 * on the owner's machine with a scripted `screencapture -iWox` click over a clear test panel:
 * no layer content → skipped; one full-size clear CALayer → picked. No window property changes that, so only bounds
 * can. Strips are picked only within {@link EDGE_STRIP_DEPTH} of an edge, and only while the glow is lit.
 *
 * What they draw, and why each, is the page's (`site/lib/edgeGlow.ts`): the speaking glow breathing with the voice's
 * level, the looking-colour border while the owner's screen is shared, one flash per frame the voice takes. The page reports
 * that state and owns the flash's lifetime (`site/components/voice/EdgeGlow.tsx`); main adds the amber "Sharing your
 * screen" frame its own capture ledger knows about (`mediaCounts.ts`), which the preload used to draw over the overlay.
 */
import { isRecord } from "./desktopBridge";
import type { Bounds } from "./persistedState";

/** What the page's edge shows (`site/lib/edgeGlow.ts` `EdgeGlowState`). `off` draws nothing. */
export type EdgeGlowState = "off" | "shared" | "speaking" | "shared-speaking";

/**
 * What the voice's page reports of its edge glow, restated from `site/lib/desktopShellGlow.ts` because the shell is a
 * separate project; parsed strictly here, never trusted.
 */
export interface OverlayGlowReport {
  readonly state: EdgeGlowState;
  /** The frame whose flash is drawing now, held for the flash's length by the page, or `null` for none. */
  readonly pulse: string | null;
  /** The voice's own level, 0 to 1, which the speaking glow breathes with. */
  readonly level: number;
}

/** What one strip draws: the page's glow, plus whether a share's capture is live by main's own ledger. */
export interface EdgeGlowView extends OverlayGlowReport {
  readonly sharing: boolean;
}

/** The four edges, each one window. */
export type Edge = "top" | "right" | "bottom" | "left";

/** Every edge, in the order the strips are made. */
export const EDGES: readonly Edge[] = ["top", "right", "bottom", "left"];

/**
 * How deep each strip reaches in from its edge, in screen points: past the widest inset shadow the glow draws (the
 * flash's 70px blur plus 14px spread, `site/components/voice/EdgeGlow.tsx`), with a margin.
 */
export const EDGE_STRIP_DEPTH = 96;

/** The longest pulse key taken: a tool call's id, with room to spare. */
const MAX_PULSE = 200;

const STATES: readonly EdgeGlowState[] = ["off", "shared", "speaking", "shared-speaking"];

/** Nothing reported yet: the edge is dark. */
export const DARK_REPORT: OverlayGlowReport = { level: 0, pulse: null, state: "off" };

/**
 * The page's glow report off the wire: exactly the three keys, a known state, a one-line bounded pulse key or `null`,
 * and a finite level from 0 to 1.
 *
 * @param value what the page sent
 * @returns the report, or `undefined` when it is anything else
 */
export function parseOverlayGlowReport({ value }: { value: unknown }): OverlayGlowReport | undefined {
  if (!isRecord(value) || Array.isArray(value) || Object.keys(value).length !== 3) {
    return undefined;
  }
  const { level, pulse, state } = value;
  const knownState = STATES.find((known) => known === state);
  if (knownState === undefined || typeof level !== "number" || !Number.isFinite(level) || level < 0 || level > 1) {
    return undefined;
  }
  if (pulse === null) {
    return { level, pulse, state: knownState };
  }
  if (typeof pulse !== "string" || pulse.length === 0 || pulse.length > MAX_PULSE || hasControl({ text: pulse })) {
    return undefined;
  }
  return { level, pulse, state: knownState };
}

/** Unicode's own line and paragraph separators, which break a line as a control character does. */
const LINE_BREAKS = new Set([0x2028, 0x2029]);

/** Whether a string carries a control character (below U+0020, DEL) or a line separator, so it is not one line. */
function hasControl({ text }: { text: string }): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code < 0x20 || code === 0x7f || LINE_BREAKS.has(code)) {
      return true;
    }
  }
  return false;
}

/**
 * Whether the strips have anything to draw, so they are shown: a steady state, a flash in flight, or a live share.
 *
 * @param view what the strips draw
 * @returns true while they are on screen
 */
export function edgeGlowLit({ view }: { view: EdgeGlowView }): boolean {
  return view.state !== "off" || view.pulse !== null || view.sharing;
}

/**
 * Each strip's bounds on a display: the top and bottom span its full width, and the left and right fit between them,
 * so no two strips overlap and no point is covered twice. A display shallower or narrower than two depths gets strips
 * that meet in the middle rather than cross.
 *
 * @param display the display's bounds, screen points
 * @param depth how far each strip reaches in
 * @returns the four strips' bounds
 */
export function edgeStripBounds({
  display,
  depth,
}: {
  display: Bounds;
  depth: number;
}): Readonly<Record<Edge, Bounds>> {
  const across = Math.min(depth, Math.floor(display.height / 2));
  const down = Math.min(depth, Math.floor(display.width / 2));
  const sideHeight = display.height - across * 2;
  return {
    bottom: { height: across, width: display.width, x: display.x, y: display.y + display.height - across },
    left: { height: sideHeight, width: down, x: display.x, y: display.y + across },
    right: { height: sideHeight, width: down, x: display.x + display.width - down, y: display.y + across },
    top: { height: across, width: display.width, x: display.x, y: display.y },
  };
}

/** The looking mood's colour (`site/components/voice/EdgeGlow.tsx` `LOOKING`). */
const LOOKING = "oklch(0.86 0.16 95)";

/** The speaking mood's ring (`site/components/voice/orbParts.tsx` `MOOD_RING`, `data-[mood=speaking]`). */
export const SPEAKING_RING = "oklch(0.77 0.17 325)";

/** The amber of a live share's frame and badge, as the preload drew it over the overlay before the strips. */
const SHARE_AMBER = "#f59e0b";

/**
 * The strips' one page. Each strip holds a box the size of the whole display, offset so the strip shows its own slice,
 * so the four together draw exactly the inset glow one whole-display layer drew — corners included. `glow(view)` is
 * the one entry point main calls; the flash restarts on a new key and is removed when the key clears.
 *
 * @returns the page, as a `data:` URL
 */
export function edgeGlowDocument(): string {
  const css = [
    "html,body{margin:0;background:transparent;overflow:hidden}",
    "#d{position:fixed;left:0;top:0}",
    "#d>span{position:absolute;inset:0}",
    `.spoken{box-shadow:inset 0 0 48px 6px color-mix(in oklch, ${SPEAKING_RING} 55%, transparent);`,
    "opacity:calc(0.25 + var(--edge-lvl) * 0.75);transition:opacity 140ms ease-out}",
    `.shared{box-shadow:inset 0 0 0 2px ${LOOKING}, inset 0 0 22px 2px color-mix(in oklch, ${LOOKING} 45%, transparent)}`,
    `.pulse{animation:p 900ms ease-out 1 both;box-shadow:inset 0 0 0 4px ${LOOKING},`,
    ` inset 0 0 70px 14px color-mix(in oklch, ${LOOKING} 70%, transparent)}`,
    "@keyframes p{0%{opacity:0}18%{opacity:1}100%{opacity:0}}",
    "@media (prefers-reduced-motion: reduce){#d[data-shared] .pulse{display:none}}",
    `.share{box-shadow:inset 0 0 0 5px ${SHARE_AMBER}, inset 0 0 28px rgba(245,158,11,0.45)}`,
    `#badge{position:absolute;top:8px;left:50%;transform:translateX(-50%);padding:4px 12px;border-radius:999px;`,
    `background:${SHARE_AMBER};color:#1c1206;font:600 12px/1.4 -apple-system, system-ui, sans-serif;`,
    "letter-spacing:0.01em;box-shadow:0 2px 10px rgba(0,0,0,0.25);white-space:nowrap}",
  ].join("");
  const script = [
    "var d=document.getElementById('d'),key=null,flash=null;",
    "function part(c,on){var e=d.querySelector('.'+c);e.hidden=!on;}",
    "window.glow=function(v){",
    "d.style.left=-v.x+'px';d.style.top=-v.y+'px';d.style.width=v.w+'px';d.style.height=v.h+'px';",
    "d.style.setProperty('--edge-lvl',v.level.toFixed(3));",
    "var shared=v.state==='shared'||v.state==='shared-speaking';",
    "d.toggleAttribute('data-shared',shared);",
    "part('spoken',v.state==='speaking'||v.state==='shared-speaking');part('shared',shared);",
    "part('share',v.sharing);document.getElementById('badge').hidden=!v.sharing;",
    "if(v.pulse!==key){if(flash!==null){flash.remove();flash=null;}key=v.pulse;",
    "if(key!==null){flash=document.createElement('span');flash.className='pulse';d.append(flash);}}",
    "};",
  ].join("");
  const html =
    `<!doctype html><html><head><meta charset="utf-8"><title>edge</title><style>${css}</style></head><body>` +
    `<div id="d" aria-hidden="true"><span class="spoken" hidden></span><span class="shared" hidden></span>` +
    `<span class="share" hidden></span><div id="badge" hidden>● Sharing your screen</div></div>` +
    `<script>${script}</script></body></html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

/**
 * The call main runs in one strip to draw a view: the strip's offset into the display and the display's size, so its
 * box lines up with the screen, beside the view itself. Every value is a parsed number, a known state or a bounded
 * string, and goes in through `JSON.stringify`, so nothing in it can close the expression.
 *
 * @param view what to draw
 * @param strip the strip's own bounds
 * @param display the display it lines
 * @returns the JavaScript to run in the strip's page
 */
export function edgeStripCall({
  view,
  strip,
  display,
}: {
  view: EdgeGlowView;
  strip: Bounds;
  display: Bounds;
}): string {
  const drawn = {
    h: display.height,
    level: view.level,
    pulse: view.pulse,
    sharing: view.sharing,
    state: view.state,
    w: display.width,
    x: strip.x - display.x,
    y: strip.y - display.y,
  };
  return `window.glow(${JSON.stringify(drawn)})`;
}
