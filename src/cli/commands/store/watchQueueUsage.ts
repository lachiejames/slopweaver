/** `store watch-queue`'s usage, a leaf the manifest quotes and the command prints. */
export const STORE_WATCH_QUEUE_USAGE =
  "usage: slopweaver store watch-queue [--home <dir>] [--json]\n" +
  "  Holds a LISTEN on the store's Queue channel and prints one line per event until stopped: ready, a register\n" +
  "  that changed, and a heartbeat every 15s that is a real round trip. Refuses, exiting 3, when the store lacks a\n" +
  "  notify trigger (`store push` installs them). Shows what the console's Queue hears; the console holds its own\n" +
  "  LISTEN and never runs this. Writes nothing.";
