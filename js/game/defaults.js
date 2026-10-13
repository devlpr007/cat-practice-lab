// The samurai game and its sound are ON for a new user (the user's choice, 2026-10-13); Settings
// switches them off. A device can start with them off instead (localStorage "cpl.gameDefault" =
// "off"); the automated tests use this so that the battle scene does not cover the result page.
export function gameOnByDefault() {
  try { return localStorage.getItem('cpl.gameDefault') !== 'off'; } catch { return true; }
}
