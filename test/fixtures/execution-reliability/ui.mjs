import { normalizeLabels } from './labels.mjs';

document.getElementById('revision').textContent = 'Code revision: ' + (new URLSearchParams(location.search).get('revision') ?? 'baseline');
document.querySelector('form').addEventListener('submit', event => {
  event.preventDefault();
  const labels = normalizeLabels(document.getElementById('labels').value.split(','));
  document.getElementById('results').replaceChildren(...labels.map(label => {
    const entry = document.createElement('li');
    entry.textContent = label;
    return entry;
  }));
  document.getElementById('status').textContent = labels.length ? labels.length + ' normalized labels' : 'Enter at least one label.';
});
