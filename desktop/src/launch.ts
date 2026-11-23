/**
 * The shell's first act: decide where this process keeps its saved state, take that folder's single-instance lock,
 * and boot — or hand the launch to the copy already holding it. A run from source and a test instance each keep
 * their own folder and so their own lock (`./e2eMode.ts`): sharing the installed app's would let a worktree's dev run
 * overwrite the checkout the installed app reopens, or a walk quit silently into the owner's running copy. Split from
 * `main.ts`, which sits at its 300-line cap.
 */
import { app } from "electron";
import type { Result } from "neverthrow";

import { DEV_USER_DATA } from "./buildIdentity";
import { dropCmuxEnv } from "./consoleEndpoint";
import { type DeepLinkAction, deepLinkAction, deepLinkTarget } from "./deepLink";
import { type DesktopE2eMode, E2E_SWITCH_REFUSED, ownUserData } from "./e2eMode";
import { QUEUE_PATH } from "./shellState";
import { PINNED, showWindow } from "./tabRouting";

/**
 * Whether the boot has started the tabs. Nothing shows a page before then: `showWindow` routes into tabs that do not
 * exist yet. It flips at `startTabs`, never at the end of the boot, which waits on
 * the console's recovery and the fleet — a Dock click during a slow recovery still shows the window.
 */
let tabsStarted = false;

/** The menu bar's Start voice: the shell's overlay command, treated as asked for, to activate the voice. */
type StartVoice = (options: { readonly asked: true; readonly command: "activate" }) => void;

/** Deep-linked actions that arrived before the tabs, in arrival order. */
const waiting: DeepLinkAction[] = [];

/**
 * Launch the shell, or refuse a malformed test switch before anything is touched.
 *
 * @param mode the test switch as read off argv
 * @param boot the whole boot, once the app is ready; it calls the `tabsReady` it is handed once its tabs exist
 * @param startVoice starts the voice as the menu bar's Start voice does, for a launcher's `slopweaver://voice`
 */
export function launchDesktop({
  mode,
  boot,
  startVoice,
}: {
  mode: Result<DesktopE2eMode | undefined, readonly string[]>;
  boot: (options: { readonly tabsReady: () => void }) => Promise<void>;
  startVoice: StartVoice;
}): void {
  dropCmuxEnv({ env: process.env });
  if (mode.isErr()) {
    process.stderr.write(`${mode.error.join("\n")}\n`);
    app.exit(E2E_SWITCH_REFUSED);
    return;
  }
  // A floating note's or the voice's console link, or a launcher's `open`/`voice` (`./deepLink.ts`), acts here.
  // Registered before the lock and `ready`, because macOS hands a cold launch its address before `ready`; one that
  // arrives before the tabs exist waits for them.
  app.on("open-url", (event, url) => {
    event.preventDefault();
    const action = deepLinkAction({ url });
    if (action === undefined) {
      return;
    }
    if (!tabsStarted) {
      waiting.push(action);
      return;
    }
    actOnDeepLink({ action, startVoice });
  });
  const userData = ownUserData({
    appData: app.getPath("appData"),
    devDir: DEV_USER_DATA,
    mode: mode.value,
    packaged: app.isPackaged,
  });
  if (userData !== undefined) {
    app.setPath("userData", userData);
  }
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }
  app.setName("Slopweaver");
  // A second launch of this folder's copy brings the Queue forward and a Dock click shows the window where the owner left it —
  // once there are tabs; until then the boot itself is about to.
  app.on("second-instance", () => {
    if (tabsStarted) {
      showWindow({ path: QUEUE_PATH, target: PINNED });
    }
  });
  app.on("activate", () => {
    if (tabsStarted) {
      showWindow({});
    }
  });
  // The menu bar keeps the app alive: closing the last window is not quitting.
  app.on("window-all-closed", () => undefined);
  // The boot's word that its tabs exist: the window shows the pinned Queue, from here every launch event shows a page,
  // and each deep link that arrived before now acts in front of it, in the order it came.
  const tabsReady = (): void => {
    showWindow({ path: QUEUE_PATH, target: PINNED });
    tabsStarted = true;
    for (const action of waiting.splice(0)) {
      actOnDeepLink({ action, startVoice });
    }
  };
  void app.whenReady().then(async () => boot({ tabsReady }));
}

/**
 * Do what one deep link asked: open its page, show the window where the owner left it as a Dock click does, or start the
 * voice. The voice is the menu bar's own Start voice, so it refuses a second call beside one the console window holds,
 * waits for the voice's page to listen, brings back a voice they hid, and only lifts a fold when a call is already up.
 * It never raises the console window itself — starting a call is no window move (`VoiceWidget.tsx`) — though a cold launch's boot still shows the Queue.
 *
 * @param action what `deepLinkAction` accepted
 * @param startVoice the menu bar's Start voice
 */
function actOnDeepLink({ action, startVoice }: { action: DeepLinkAction; startVoice: StartVoice }): void {
  switch (action.kind) {
    case "page":
      openDeepLink({ path: action.path });
      return;
    case "window":
      showWindow({});
      return;
    case "voice":
      startVoice({ asked: true, command: "activate" });
      return;
    default: {
      const unhandled: never = action;
      return unhandled;
    }
  }
}

/**
 * Open a console page a deep link asked for, and bring the window forward: a Queue address in the pinned Queue tab,
 * shown, never a second one, and any other page in a new tab in front, so a briefing link opens a new tab inside the
 * desktop app. Which is which is `deepLinkTarget`'s.
 *
 * @param path the console path `deepLinkPath` accepted
 */
function openDeepLink({ path }: { path: string }): void {
  if (deepLinkTarget({ path }) === "pinned") {
    showWindow({ path, target: PINNED });
    return;
  }
  showWindow({ path, target: { foreground: true, kind: "new", opener: undefined } });
}
