/**
 * PostCSS for the console's Tailwind v4 entry (`app/console-tw.css`). Nextra's stylesheet carries no
 * Tailwind directive, so the plugin passes it through untouched.
 */
export default { plugins: { "@tailwindcss/postcss": {} } };
