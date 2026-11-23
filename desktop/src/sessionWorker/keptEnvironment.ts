/**
 * The scrub both vendors' environment policies share: an inherited environment copied onto a null-prototype object,
 * minus the names a policy drops and any name a child would read back as something else. Pure.
 */

/**
 * Whether a name is one the child would read back as itself. The kernel splits `NAME=value` at the FIRST `=`, so an
 * inherited name such as `OPENAI_API_KEY=x` passes an exact-name check here and arrives as `OPENAI_API_KEY`; a NUL
 * ends the entry early the same way. Neither is a name a real environment holds, so both are dropped.
 *
 * @param name an inherited variable's name
 * @returns true when the name carries neither separator
 */
function isPlainName({ name }: { name: string }): boolean {
  return name.length > 0 && !name.includes("=") && !name.includes("\0");
}

/**
 * The inherited environment with the dropped names gone.
 *
 * @param inherited the environment a child would otherwise inherit
 * @param dropped the names a policy removes, compared exactly
 * @returns a fresh environment with no prototype
 */
export function keptEnvironment({
  inherited,
  dropped,
}: {
  inherited: Readonly<Record<string, string | undefined>>;
  dropped: readonly string[];
}): Record<string, string> {
  // No prototype: `spawn` reads inherited enumerable keys into the child's environment too, so a credential set on
  // `Object.prototype` by anything in this process would otherwise ride along past the scrub below.
  const environment: Record<string, string> = {};
  Object.setPrototypeOf(environment, null);
  for (const [name, value] of Object.entries(inherited)) {
    if (value !== undefined && isPlainName({ name }) && !dropped.includes(name)) {
      environment[name] = value;
    }
  }
  return environment;
}
