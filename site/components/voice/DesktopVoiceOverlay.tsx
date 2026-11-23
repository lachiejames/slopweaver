"use client";

/**
 * The voice over the owner's whole desktop, expanded and collapsed at will. The desktop shell (`desktop/`) loads
 * `/voice` into a transparent window above every other one, and this is that page: the console's own provider and
 * orb, owning the ONE call, with the shell driving it — the tray's and the console window's commands come in, the
 * view goes out so the shell can size its glass and let clicks through to whatever is beneath the orb, and the
 * widget's extent goes out so the window shrinks to the corner whenever nothing drawn needs more.
 *
 * The page the owner is talking about is the console window's, not this one's `/voice`, so it is carried across and handed
 * to the provider in place of its own. Outside the shell's overlay window this draws nothing at all.
 */
import { type ReactElement, useEffect, useLayoutEffect, useMemo, useState } from "react";

import { presentCardOnShell } from "../../lib/desktopCardPresent";
import { bridgeInstance, type DesktopBridge, type DesktopPageIdentity, pageIdentityOf } from "../../lib/desktopShell";
import {
  type OverlayShellCommand,
  overlayAreaOf,
  overlayCommandOf,
  overlayFloorOf,
  overlayInsetOf,
} from "../../lib/desktopShellOverlay";
import { type OverlayPlaceLink, overlayHomeOf, overlayOriginOf } from "../../lib/desktopShellPlace";
import { triageCommandOf } from "../../lib/triageBridge";
import type { DesktopVoiceSeam } from "./desktopVoiceSeam";
import { desktopBridge, useDesktopRole } from "./useDesktopShell";
import type { DesktopCardMove } from "./useOpenCardSeams";
import type { OverlayExtentLink } from "./useOverlayExtent";
import { VoiceProvider } from "./VoiceProvider";
import { VoiceWidget } from "./VoiceWidget";
import type { VoiceShellControl } from "./voiceShellControl";

/**
 * The overlay page.
 *
 * @returns the voice, or nothing outside the shell's overlay window
 */
export function DesktopVoiceOverlay(): ReactElement | null {
  const role = useDesktopRole();
  const bridge = desktopBridge();
  if (role !== "overlay" || bridge === undefined) {
    return null;
  }
  return <OverlayVoice bridge={bridge} />;
}

/**
 * The voice, wired to the shell.
 *
 * @param bridge the shell's object in the overlay window
 * @returns the provider and the orb
 */
function OverlayVoice({ bridge }: { bridge: DesktopBridge }): ReactElement {
  const [page, setPage] = useState<DesktopPageIdentity | undefined>(undefined);
  // A renderer reloaded with the card open never ran its close, so the shell hears "closed" before the card's own report.
  useLayoutEffect(() => {
    bridge.reportMessengerOpen?.({ report: { open: false } });
  }, [bridge]);
  useEffect(
    () =>
      bridge.onPageIdentity((value) => {
        const identity = pageIdentityOf({ value });
        if (identity !== undefined) {
          setPage(identity);
        }
      }),
    [bridge],
  );
  const shell = useMemo((): VoiceShellControl => {
    const control: VoiceShellControl = {
      onCommand: (listener) =>
        bridge.onOverlayCommand((value) => {
          const command: OverlayShellCommand | undefined = overlayCommandOf({ value });
          if (command !== undefined) {
            listener(command);
          }
        }),
      onStatus: (status) => {
        bridge.reportOverlayStatus({ status });
      },
      ...(bridge.focusOverlay === undefined ? {} : { focus: bridge.focusOverlay }),
      // The X on the orb; an older shell has no way to hide its window, and its orb draws none.
      ...(bridge.hideOverlay === undefined ? {} : { hide: bridge.hideOverlay }),
      // The edge glow, drawn by the shell's screen-edge strips; an older shell leaves it to the page, over the display.
      ...(bridge.reportOverlayGlow === undefined ? {} : { glow: { report: bridge.reportOverlayGlow } }),
    };
    // A shell from before the extent report keeps its window over the whole work area, so there is none to send, and
    // one that takes the report always answers with its word on the area.
    const { onOverlayArea, onOverlayFloor, onOverlayInset, reportOverlayExtent } = bridge;
    if (reportOverlayExtent === undefined || onOverlayArea === undefined) {
      return control;
    }
    let link: OverlayExtentLink = {
      onArea: (listener) =>
        onOverlayArea((value) => {
          const area = overlayAreaOf({ value });
          if (area !== undefined) {
            listener(area);
          }
        }),
      report: (extent) => {
        reportOverlayExtent({ extent });
      },
    };
    // A shell whose whole window is still the work area sends no inset, and none is right under it.
    if (onOverlayInset !== undefined) {
      const onInset: NonNullable<OverlayExtentLink["onInset"]> = (listener) =>
        onOverlayInset((value) => {
          const inset = overlayInsetOf({ value });
          if (inset !== undefined) {
            listener(inset);
          }
        });
      link = { ...link, onInset };
    }
    // A shell that rests the corner on the work area itself sends no floor, and the inset's bottom is the floor there.
    if (onOverlayFloor !== undefined) {
      const onFloor: NonNullable<OverlayExtentLink["onFloor"]> = (listener) =>
        onOverlayFloor((value) => {
          const floor = overlayFloorOf({ value });
          if (floor !== undefined) {
            listener(floor);
          }
        });
      link = { ...link, onFloor };
    }
    // The orb's place, from a shell that both moves its window to a place and says where the work area sits in it.
    const { onOverlayHome, onOverlayOrigin, reportOverlayPlace } = bridge;
    if (onOverlayOrigin === undefined || reportOverlayPlace === undefined) {
      return { ...control, extent: link };
    }
    let onHome: OverlayPlaceLink["onHome"];
    if (onOverlayHome !== undefined) {
      onHome = (listener) =>
        onOverlayHome((value) => {
          const home = overlayHomeOf({ value });
          if (home !== undefined) {
            listener(home);
          }
        });
    }
    const place: OverlayPlaceLink = {
      onHome,
      onOrigin: (listener) =>
        onOverlayOrigin((value) => {
          const origin = overlayOriginOf({ value });
          if (origin !== undefined) {
            listener(origin);
          }
        }),
      report: (report) => {
        reportOverlayPlace({ report });
      },
    };
    return { ...control, extent: link, place };
  }, [bridge]);
  const desktop = useMemo((): DesktopVoiceSeam => {
    // `open_card` moves the console window, never this one; a shell built before the move says so.
    const cardMove: DesktopCardMove = {
      fromPath: page?.path,
      present: ({ path }) => presentCardOnShell({ bridge, path }),
    };
    // The shell looks at the owner's screen itself, so the voice asks for no share.
    const sight: Pick<DesktopVoiceSeam, "captureScreen" | "frontAppBand" | "supportsTypedScreenLook"> = {
      ...(bridge.captureScreen === undefined ? {} : { captureScreen: bridge.captureScreen }),
      ...(bridge.frontAppBand === undefined ? {} : { frontAppBand: bridge.frontAppBand }),
      ...(bridge.supportsTypedScreenLook === true ? { supportsTypedScreenLook: true } : {}),
    };
    // On the owner's ask it lifts one region of that look and dims the rest.
    const focus: Pick<DesktopVoiceSeam, "focusRegion"> =
      bridge.focusRegion === undefined ? {} : { focusRegion: bridge.focusRegion };
    // The one window a call runs in: every start, its own orb's or one handed over from the console window, runs here.
    const startRoute: DesktopVoiceSeam["startRoute"] = { kind: "local" };
    // A failure goes to the console window's toast, never beside the orb.
    const reportFailure: NonNullable<DesktopVoiceSeam["reportFailure"]> = ({ notice }) => {
      if (bridge.reportVoiceFailure === undefined) {
        return {
          kind: "unavailable",
          why: "this desktop app predates in-window failure toasts; restart it after a pull",
        };
      }
      bridge.reportVoiceFailure({ notice });
      return { kind: "reported" };
    };
    // Which window is in front, names only, for the drift watch while the owner holds a stated plan.
    const front: Pick<DesktopVoiceSeam, "frontWindow"> =
      bridge.frontWindow === undefined ? {} : { frontWindow: bridge.frontWindow };
    // The call it holds, and what the shell kept of one its renderer died under (`lib/overlayCrashRecovery.ts`).
    const { reportOverlayCall, takeOverlayRecovery } = bridge;
    const survives: Pick<DesktopVoiceSeam, "reportCall" | "takeRecovery"> =
      reportOverlayCall === undefined || takeOverlayRecovery === undefined
        ? {}
        : {
            reportCall: (call) => {
              reportOverlayCall({ call });
            },
            takeRecovery: takeOverlayRecovery,
          };
    // The desktop test instance marks every call it runs as the walk's, never the owner's (`slopweaver desktop e2e --call`).
    const marked: Pick<DesktopVoiceSeam, "instance"> = bridgeInstance({ bridge }) === "e2e" ? { instance: "e2e" } : {};
    // Rapid triage's countdown beside the menu bar item and its menu and note presses.
    const { onTriageCommand, reportTriageClock } = bridge;
    const triage: Pick<DesktopVoiceSeam, "triageClock"> =
      onTriageCommand === undefined || reportTriageClock === undefined
        ? {}
        : {
            triageClock: {
              onCommand: (listener) =>
                onTriageCommand((value) => {
                  const command = triageCommandOf({ value });
                  if (command !== undefined) {
                    listener(command);
                  }
                }),
              report: reportTriageClock,
            },
          };
    // The Queue a tool reads is the console window's, asked for at the tool, never this window's held copy.
    const queue: Pick<DesktopVoiceSeam, "requestVoiceQueue"> =
      bridge.requestVoiceQueue === undefined ? {} : { requestVoiceQueue: bridge.requestVoiceQueue };
    const seam: DesktopVoiceSeam = {
      cardMove,
      ...queue,
      ...sight,
      ...focus,
      ...front,
      ...survives,
      ...marked,
      ...triage,
      reportFailure,
      startRoute,
    };
    if (page === undefined) {
      return seam;
    }
    return { ...seam, pageIdentity: page };
  }, [bridge, page]);
  return (
    <VoiceProvider desktop={desktop}>
      <VoiceWidget shell={shell} />
    </VoiceProvider>
  );
}
