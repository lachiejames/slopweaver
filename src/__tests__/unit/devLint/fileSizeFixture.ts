import type { FileSize } from "../../../devLint/fileSizeMeasure.js";

/**
 * A measured file, spelled once so a case names only the field it is about.
 *
 * @returns a `FileSize` whose raw count sits ten lines above its code count
 */
export const size = ({
  path,
  codeLines,
  exempt = false,
  registerMarker = false,
}: {
  path: string;
  codeLines: number;
  exempt?: boolean;
  registerMarker?: boolean;
}): FileSize => ({
  codeLines,
  exempt,
  exemptMarker: false,
  path,
  rawLines: codeLines + 10,
  registerMarker,
});
