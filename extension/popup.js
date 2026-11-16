import { Birdbook, renderBook, BOOK_CSS } from './core/book.js';
import { getPortraits } from './core/portraits.js';
import { SPECIES, RARITY, RARITY_ORDER } from './core/species.js';
import { chromeBookStore, loadSettings, SETTINGS_KEY } from './perch-ext.js';

const style = document.createElement('style');
style.textContent = BOOK_CSS;
document.head.append(style);

const book = await new Birdbook(chromeBookStore).load();
renderBook(document.getElementById('book'), { book, species: SPECIES, portraits: getPortraits(SPECIES), embedded: true });

const $ = (id) => document.getElementById(id);
let settings = await loadSettings();
const save = (patch) => {
  settings = { ...settings, ...patch };
  return chrome.storage.local.set({ [SETTINGS_KEY]: settings });
};

// Everyday switches.
for (const id of ['enabled', 'sound', 'photos']) {
  $(id).checked = !!settings[id];
  $(id).onchange = () => save({ [id]: $(id).checked });
}

// Dev tools: hidden until asked for, and remembered.
const showDev = (on) => { $('dev').hidden = !on; $('devToggle').setAttribute('aria-expanded', String(on)); };
showDev(settings.devTools);
$('devToggle').onclick = () => { showDev($('dev').hidden); save({ devTools: !$('dev').hidden }); };

$('idle').value = settings.idleThreshold;
$('idle').onchange = () => save({ idleThreshold: Math.min(600, Math.max(3, +$('idle').value || 10)) });
$('perches').checked = !!settings.perches;
$('perches').onchange = () => save({ perches: $('perches').checked });

for (const r of RARITY_ORDER) {
  const group = document.createElement('optgroup');
  group.label = RARITY[r].label;
  for (const sp of SPECIES.filter((s) => s.rarity === r)) group.append(new Option(sp.name, sp.id));
  $('species').append(group);
}
$('summon').onclick = async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id != null) chrome.tabs.sendMessage(tab.id, { type: 'perch:summon', species: $('species').value || null }).catch(() => {});
  window.close();
};
