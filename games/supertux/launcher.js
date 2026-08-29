const button = document.getElementById('localPlay');
const label = document.getElementById('localPlayLabel');
const note = document.getElementById('runtimeNote');

try {
  const response = await fetch('./runtime/supertux2.html', {
    method: 'HEAD',
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  if (!window.crossOriginIsolated) {
    label.textContent = 'Preparing secure browser runtime…';
    note.textContent =
      'SuperTux is enabling the browser isolation required by its WebAssembly build. This page will reload once, then Play will unlock.';
    setTimeout(() => {
      if (!window.crossOriginIsolated) {
        label.textContent = 'Browser isolation did not activate';
        note.innerHTML =
          'Reload this page once. If Play remains locked, use the <a href="https://play.supertux.org/">official SuperTux browser build</a>.';
      }
    }, 8_000);
  } else {
    button.disabled = false;
    label.textContent = 'Launch hosted SuperTux';
    button.addEventListener('click', () => {
      location.href = './runtime/supertux2.html?ecgaming=1';
    });
  }
} catch {
  label.textContent = 'Hosted runtime is not prepared';
  note.innerHTML =
    'The small launcher works locally, but the 246 MB runtime is added only by <code>npm run build:hosted</code>. ' +
    '<a href="https://play.supertux.org/">Open the official web build</a> without ECG jump injection.';
}
