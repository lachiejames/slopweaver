import type { ReactElement } from "react";

import { DesktopVoiceOverlay } from "../../../components/voice/DesktopVoiceOverlay";

/**
 * The desktop shell's voice window, and the one place a call runs. In a browser it draws nothing at all: the voice
 * lives in the desktop app only, and a browser tab has no orb and starts no call.
 *
 * @returns the overlay
 */
export default function VoicePage(): ReactElement {
  return <DesktopVoiceOverlay />;
}
