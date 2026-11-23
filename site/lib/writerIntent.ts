/**
 * The transcript route's HANDOFF intent, published before it spawns `slopweaver talk transcript` and withdrawn once the
 * verb has exited — the site's half of `src/talk/callWriteIntent.ts`'s intents, which the site cannot import. A batch
 * is admitted once this is published, so a fence binding the owner's words (`src/talk/callFence.ts`) waits for it from
 * here, not from the moment the verb reaches the call's lock: the verb's start, its stdin read and its masking all sit
 * in between.
 *
 * One file per batch and path, `<file>.intent.handoff.<pid>.<n>`, holding this server's pid and `-` for its start
 * stamp, the line `src/talk/relayLease.ts`'s `holderLine` writes for a holder `ps` gave no stamp. A handoff counts
 * while this server runs and, once it is gone, until it is `HANDOFF_MS` old — so a server killed after spawning the
 * verb leaves it counting — and the verb, handed its path as `--handoff`, writes nothing once it has lapsed.
 * `src/__tests__/unit/talk/writerRunIntent.test.ts` binds this shape to the reader.
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** A counter keeping two of this server's intents apart. */
let issued = 0;

/**
 * Publish that a write of `path` is coming, creating its directory as the verb would.
 *
 * @param path the call file or ledger the spawned verb will write
 * @returns the handoff's own path, which the verb is handed, and what withdraws it once the verb has exited
 */
export function announceWriterIntent({ path }: { path: string }): {
  readonly intent: string;
  readonly withdraw: () => void;
} {
  issued += 1;
  const intent = `${path}.intent.handoff.${String(process.pid)}.${String(issued)}`;
  mkdirSync(dirname(path), { mode: 0o700, recursive: true });
  writeFileSync(intent, `${String(process.pid)} -\n`, { flag: "wx", mode: 0o600 });
  return {
    intent,
    withdraw: () => {
      rmSync(intent, { force: true });
    },
  };
}
