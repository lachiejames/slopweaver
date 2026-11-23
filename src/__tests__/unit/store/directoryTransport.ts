/**
 * A fake destination for the backup tests: a directory the transport writes into and lists from. A seam, not a
 * mock — every method does the real thing to a real directory.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { ok } from "../../../lib/result.js";
import { placeWithin } from "../../../store/backup/realPlace.js";
import type { BackupTransport } from "../../../store/backup/transport.js";

/**
 * A transport that copies uploads into a directory and lists what landed. It honours the BYTE BOUND and
 * reports the digest of what it wrote, exactly as the real one does, so a test can drive the rewritten-file
 * and grew-while-running paths without reaching a real destination. It stores whatever bytes it is handed:
 * wrapped in `encryptingTransport` those are ciphertext, used bare they are the plaintext.
 *
 * @returns a transport whose destination is the directory `root`, and which names `root` as its location
 */
export function directoryTransport({
  root,
}: {
  root: string;
}): BackupTransport & { readonly uploaded: string[]; readonly sizeListings: string[] } {
  const uploaded: string[] = [];
  const sizeListings: string[] = [];
  return {
    download: async ({ objectName, path }) => {
      writeFileSync(path, readFileSync(join(root, objectName)));
      return ok(undefined);
    },
    holds: ({ path }) => placeWithin({ place: path, root }),
    list: async ({ prefix }) => ok(uploaded.filter((name) => name.startsWith(prefix)).toSorted()),
    // Reads the DIRECTORY rather than `uploaded`, so a blob a test planted by hand is listed like a real one.
    objectSizes: async ({ prefix }) => {
      sizeListings.push(prefix);
      const sizes = new Map<string, number>();
      const directory = join(root, prefix);
      if (existsSync(directory)) {
        for (const name of readdirSync(directory)) {
          sizes.set(`${prefix}${name}`, statSync(join(directory, name)).size);
        }
      }
      return ok(sizes);
    },
    probe: async () => ok({ location: root }),
    remove: async ({ objectName }) => {
      rmSync(join(root, objectName), { force: true });
      return ok(undefined);
    },
    upload: async ({ path, objectName, bytes }) => {
      const whole = readFileSync(path);
      const sent = bytes === undefined ? whole : whole.subarray(0, bytes);
      mkdirSync(join(root, objectName, ".."), { recursive: true });
      writeFileSync(join(root, objectName), sent);
      uploaded.push(objectName);
      return ok({
        bytes: sent.length,
        name: objectName,
        sha256: createHash("sha256").update(sent).digest("hex"),
      });
    },
    sizeListings,
    uploaded,
  };
}
