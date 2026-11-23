/**
 * Process reads for a monitor pass in a test: a table with launchd in it and no fseventsd, so `fseventsd-bloated`
 * reads clear and no test judges the machine it runs on.
 */
import type { FseventsdSeams } from "../monitor/fseventsdBloatedSource.js";

/**
 * A process table holding launchd alone; `top` is never asked, since there is no fseventsd pid to ask about, and
 * the onset capture is never reached. Each onset seam throws, so a test that did reach it fails loudly rather
 * than running `log` on this machine.
 */
export const NO_FSEVENTSD: FseventsdSeams = {
  comms: () => [{ comm: "/sbin/launchd", pid: 1 }],
  onset: {
    exists: () => {
      throw new Error("NO_FSEVENTSD reads no fseventsd, so its onset capture is never taken");
    },
    readLog: () => {
      throw new Error("NO_FSEVENTSD reads no fseventsd, so its onset capture is never taken");
    },
    readPs: () => {
      throw new Error("NO_FSEVENTSD reads no fseventsd, so its onset capture is never taken");
    },
    createExclusive: () => {
      throw new Error("NO_FSEVENTSD reads no fseventsd, so its onset capture is never taken");
    },
  },
  watchedTopReport: () => undefined,
};
