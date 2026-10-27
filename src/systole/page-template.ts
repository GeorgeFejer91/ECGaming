/** Vite renders one control document into two independently addressable games. */
export function renderSystolePage(source: string) {
  return source
    .replace('<html lang="en">', '<html lang="en" data-game-theme="systole">')
    .replace(/<title>[^<]*<\/title>/, '<title>Systole · The Quiet Vessel — EC Games</title>')
    .replace(/href="\.\.\//g, 'href="../../')
    .replace('/src/ground-control.ts', '/src/systole/entry.ts')
    .replace('ECG FLIGHT SYSTEM', 'SYSTOLE / DEEP SPACE NAVIGATION')
    .replace('CONTROL SIGNAL & AIRCRAFT', 'THE QUIET VESSEL')
    .replace(/>Ground Control</g, '>Mission Control<')
    .replace(/>Cockpit</g, '>Navigation<')
    .replace('COCKPIT · AIRCRAFT VIEW', 'SYSTOLE · NAVIGATION VIEW')
    .replace('Waiting at the runway.', 'The vessel awaits a pulse.')
    .replace('Manual airplane steering', 'Manual spacecraft steering')
    .replaceAll('steer airplane', 'steer spacecraft')
    .replace('RING CLEARED!', 'PASSAGE FOUND!');
}
