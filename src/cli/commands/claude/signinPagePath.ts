/**
 * Where `claude signin --page` writes its local status page.
 *
 * `--out` is optional by design: absent, the page lands in the Slopweaver home under a fixed name, so a second
 * run overwrites the first rather than scattering copies. A given path is used exactly as typed.
 */
import { unsetFieldAsNull } from "#lib/absent.js";

/** Where the local status page is written when no path is given. */
const DEFAULT_PAGE_FILE = "claude-signin.html";

/**
 * The path the status page is written to.
 *
 * @param args the parsed verb arguments, of which only `--out` is read
 * @param home the Slopweaver home the default page lives in
 * @returns `--out` when given, else `<home>/claude-signin.html`
 */
export function signinPagePath({ args, home }: { args: { readonly out?: string }; home: string }): string {
  const out = unsetFieldAsNull({ key: "out", record: args });
  if (out === null) {
    return `${home}/${DEFAULT_PAGE_FILE}`;
  }
  return out;
}
