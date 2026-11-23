/**
 * The console window's chrome, as data the main process applies. Pure.
 *
 * The sidebar blends into the window the way the ChatGPT, Linear and Raycast desktop apps do — no
 * separate top bar, the macOS window dots embedded beside the sidebar's controls, a full-screen feel. So the console
 * window keeps its native frame (resizing, Spaces, full-screen and the three buttons stay the system's) but hides
 * the title strip.
 *
 * The owner wants a tab bar at the top, as some apps have. So the top row is the
 * tab strip (`tabStrip.ts`) and the buttons sit at its left, as in a browser: the strip is told to make room for them
 * while windowed, and every console page is told they are not over it, so its sidebar no longer reserves their space.
 * In full-screen macOS hides them and the strip closes the gap; the voice overlay and a browser tab never have them.
 */

/** Whether the window's own buttons sit over a view's top-left corner. */
export type WindowControlsState = "inset" | "none";

/** The renderer argument carrying the state the window opens in; the preload spells its own copy. */
export const WINDOW_CONTROLS_ARGUMENT = "--slopweaver-window-controls=";

/** The channel a later change of state travels on, main process to page. */
export const WINDOW_CONTROLS_CHANNEL = "slopweaver:window-controls";

/**
 * Where the three buttons sit, from the window's top-left, in points: centred on the tab strip's 38-point row
 * (`STRIP_HEIGHT`), the cluster about 14 points tall, and clear of the strip's 84-point left gap.
 */
export const TRAFFIC_LIGHT_POSITION = { x: 14, y: 12 } as const;

/**
 * The console window's chrome options.
 *
 * @param platform the process's platform — only macOS has a title strip to fold into the page
 * @returns the `BrowserWindow` options that hide the title strip and place the buttons, empty elsewhere
 */
export function consoleWindowChrome({ platform }: { platform: string }): {
  readonly titleBarStyle?: "hiddenInset";
  readonly trafficLightPosition?: { readonly x: number; readonly y: number };
} {
  if (platform !== "darwin") {
    return {};
  }
  return { titleBarStyle: "hiddenInset", trafficLightPosition: TRAFFIC_LIGHT_POSITION };
}

/**
 * Whether a window's buttons stand over a view.
 *
 * @param role which view: the tab strip, a console page in a tab, or the voice overlay
 * @param fullscreen whether it is full-screen, where macOS hides the buttons
 * @returns `inset` only for the console window's tab strip while windowed on macOS
 */
export function windowControlsState({
  role,
  fullscreen,
  platform,
}: {
  role: "strip" | "main" | "overlay";
  fullscreen: boolean;
  platform: string;
}): WindowControlsState {
  if (role !== "strip" || fullscreen || platform !== "darwin") {
    return "none";
  }
  return "inset";
}

/**
 * The renderer argument for a state.
 *
 * @returns the `--slopweaver-window-controls=…` argument
 */
export function windowControlsArgument({ state }: { state: WindowControlsState }): string {
  return `${WINDOW_CONTROLS_ARGUMENT}${state}`;
}
