/**
 * Build step: write `build/icon.icns`, the app icon the electron-builder config names, from the logo asset
 * (`yarn app` runs it before packaging). Run as `node build/makeIcon.js`; a logo it cannot read stops the build
 * with the reason rather than packaging an app with no icon.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { appIconIcns } from "./appIcon";
import { LOGO_ASSET, readLogo } from "./logo";
import { menuBarGlyph } from "./trayIcon";

const outDir = join(__dirname);
// The menu bar mark is checked here too, so a logo too faint to show there stops the build, not the app.
const logo = readLogo({ bytes: readFileSync(join(__dirname, "..", LOGO_ASSET)) }).andThen((read) =>
  menuBarGlyph({ logo: read }).map(() => read),
);
if (logo.isErr()) {
  process.stderr.write(`makeIcon: ${logo.error.message}\n`);
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "icon.icns"), appIconIcns({ logo: logo.value }));
