/**
 * A plain fake of the repo's atomic writer that DIES PART-WAY, for witnessing that a store's rewrite is routed
 * through the atomic primitive: it hands the real `writeFileAtomicStream` a producer that writes the first half
 * of the text and then throws, exactly as a full disk or a killed process would.
 *
 * Against an atomic store the target keeps its old bytes and no staged sibling survives. Against a store that
 * still overwrites in place the fake is never called, so the new bytes land and the old ones are gone — the
 * test then fails on its first assertion rather than passing on silence.
 */
import { type writeFileAtomic, writeFileAtomicStream } from "#lib/writeAtomic.js";

/** The error the dying writer throws once half the bytes are staged. */
export const DISK_FULL_MESSAGE = "ENOSPC: simulated disk full after a partial write";

/**
 * The writer, typed as the production seam so a store accepts it where it would take `writeFileAtomic`.
 *
 * @returns never; it always throws {@link DISK_FULL_MESSAGE} after staging half of `contents`
 */
export const dyingAtomicWriter: typeof writeFileAtomic = ({ contents, path }) => {
  const text = typeof contents === "string" ? contents : [...contents].join("");
  writeFileAtomicStream({
    path,
    produce: ({ write }) => {
      write({ text: text.slice(0, Math.floor(text.length / 2)) });
      throw new Error(DISK_FULL_MESSAGE);
    },
  });
};
