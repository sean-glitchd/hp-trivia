// ─── cards.js: Chocolate Frog card catalog, hp_cards, reveal ceremony, Gallery ─
// Imports fx/audio/dialogue (leaf-ish) plus quiz.js's switchScreen/
// updateWelcomeScreen/showToast for the Gallery screen transition — quiz.js
// never imports this module, so cards -> quiz is a one-way edge, no cycle.
// journey.js and daily.js/hedwig.js import Cards (award wiring); cards.js
// imports neither of them.

import { FX } from './fx.js';
import { AudioEngine } from './audio.js';
import * as Dialogue from './dialogue.js';
import { switchScreen, updateWelcomeScreen } from './quiz.js';

// ─── CATALOG (30: 5 legendary / 10 rare / 15 common) ────────────────────────
export const CARDS = [
  // ── legendary (5) ──
  { id: 'dumbledore', name: 'Albus Dumbledore', emoji: '🧙‍♂️', rarity: 'legendary', flavor: 'Headmaster of Hogwarts and defeater of Grindelwald, widely considered the greatest wizard of his age.' },
  { id: 'harry',      name: 'Harry Potter',     emoji: '⚡',   rarity: 'legendary', flavor: 'The Boy Who Lived — and the Chosen One who lived to tell the tale a second time.' },
  { id: 'merlin',     name: 'Merlin',           emoji: '🔮',   rarity: 'legendary', flavor: 'Order of Merlin, First Class. The most famous wizard in history, older than Hogwarts itself.' },
  { id: 'fawkes',     name: 'Fawkes',           emoji: '🐦‍🔥', rarity: 'legendary', flavor: "Dumbledore's phoenix companion, reborn from his own ashes and famed for his healing tears." },
  { id: 'elder-wand', name: 'The Elder Wand',   emoji: '🪄',   rarity: 'legendary', flavor: 'The most powerful wand ever made, passed hand to hand through history — its true master wins by more than force.' },

  // ── rare (10) ──
  { id: 'hermione',       name: 'Hermione Granger',  emoji: '📚', rarity: 'rare', flavor: 'Widely regarded the brightest witch of her age, rarely seen without a book close at hand.' },
  { id: 'ron',            name: 'Ron Weasley',       emoji: '♟️', rarity: 'rare', flavor: "A masterful wizard's chess player whose loyalty has saved his friends more times than his strategy." },
  { id: 'mcgonagall',     name: 'Minerva McGonagall', emoji: '🐈‍⬛', rarity: 'rare', flavor: "Deputy Headmistress and Transfiguration professor, equally at home as a tabby cat on a garden wall." },
  { id: 'snape',          name: 'Severus Snape',     emoji: '🧪', rarity: 'rare', flavor: 'A Potions master of unmatched skill, and a man whose true loyalties were hidden until the very end.' },
  { id: 'sirius',         name: 'Sirius Black',      emoji: '🐕', rarity: 'rare', flavor: 'An Animagus who escaped Azkaban as a great black dog, fiercely loyal to those he called family.' },
  { id: 'dobby',          name: 'Dobby',             emoji: '🧦', rarity: 'rare', flavor: 'A free elf, once bound to the House of Malfoy, who chose his own path — and a sock.' },
  { id: 'hedwig',         name: 'Hedwig',            emoji: '🦉', rarity: 'rare', flavor: 'A snowy owl of uncommon intelligence, forever finding her way home no matter the distance.' },
  { id: 'sorting-hat',    name: 'The Sorting Hat',   emoji: '🎩', rarity: 'rare', flavor: 'Once worn by Godric Gryffindor himself, it has sorted every student at Hogwarts for a thousand years.' },
  { id: 'marauders-map',  name: "The Marauder's Map", emoji: '🗺️', rarity: 'rare', flavor: 'Shows every footstep within the walls of Hogwarts — "I solemnly swear that I am up to no good."' },
  { id: 'buckbeak',       name: 'Buckbeak',          emoji: '🦅', rarity: 'rare', flavor: 'A proud Hippogriff who demands respect first and friendship second — bow, and he may just bow back.' },

  // ── common (15) ──
  { id: 'neville',       name: 'Neville Longbottom',  emoji: '🌿', rarity: 'common', flavor: 'A gifted Herbologist whose courage bloomed later than most, but blazed brighter for it.' },
  { id: 'luna',          name: 'Luna Lovegood',       emoji: '🌙', rarity: 'common', flavor: 'A Ravenclaw who sees what others miss, and believes in a good deal more besides.' },
  { id: 'ginny',         name: 'Ginny Weasley',       emoji: '🔥', rarity: 'common', flavor: 'A formidable Chaser and duellist, never one to be underestimated by her enemies.' },
  { id: 'weasley-twins', name: 'Fred & George Weasley', emoji: '🎆', rarity: 'common', flavor: "Founders of Weasleys' Wizard Wheezes, and Hogwarts' most inventive troublemakers." },
  { id: 'draco',         name: 'Draco Malfoy',        emoji: '🐍', rarity: 'common', flavor: 'A Slytherin prefect raised on old prejudice, who ultimately chose not to finish what he started.' },
  { id: 'hagrid',        name: 'Rubeus Hagrid',       emoji: '🗝️', rarity: 'common', flavor: 'Keeper of Keys and Grounds at Hogwarts, with a fondness for creatures most wizards fear.' },
  { id: 'crookshanks',   name: 'Crookshanks',         emoji: '🐈', rarity: 'common', flavor: 'A half-Kneazle cat with an uncanny nose for finding out who — or what — cannot be trusted.' },
  { id: 'scabbers',      name: 'Scabbers',            emoji: '🐀', rarity: 'common', flavor: 'A rat that lived twelve suspiciously long years in the Weasley family — with good reason.' },
  { id: 'trevor',        name: 'Trevor',              emoji: '🐸', rarity: 'common', flavor: "Neville Longbottom's toad, forever escaping — and forever found again." },
  { id: 'fluffy',        name: 'Fluffy',              emoji: '🐶', rarity: 'common', flavor: 'A three-headed guard dog, easily soothed by a spot of music.' },
  { id: 'nimbus-2000',   name: 'Nimbus 2000',         emoji: '🧹', rarity: 'common', flavor: 'A racing broom capable of nought to seventy in ten seconds, once the finest money could buy.' },
  { id: 'golden-snitch', name: 'The Golden Snitch',   emoji: '🏅', rarity: 'common', flavor: 'Walnut-sized and silver-winged, worth 150 points to whichever Seeker can catch it.' },
  { id: 'howler',        name: 'The Howler',          emoji: '✉️', rarity: 'common', flavor: 'A scarlet envelope that delivers its message at top volume, then bursts into flame.' },
  { id: 'bertie-botts',  name: "Bertie Bott's Every Flavour Beans", emoji: '🍬', rarity: 'common', flavor: "Every flavour imaginable — and several you'd rather not, like earwax or vomit." },
  { id: 'mandrake',      name: 'Mandrake',            emoji: '🌱', rarity: 'common', flavor: "A restorative plant whose cry can be fatal to anyone who hears it unprotected." },
];

const RARITY_GLOW = { common: '#c9d3d8', rare: '#6c9fd8', legendary: '#f0d080' };
const RARITY_BURST = { common: 22, rare: 40, legendary: 70 };

// ─── PERSISTENCE (hp_cards v1) ───────────────────────────────────────────────
const KEY = 'hp_cards';
let owned = {};

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) { owned = {}; return; }
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.v !== 1 || typeof parsed.owned !== 'object' || parsed.owned === null) {
      owned = {}; return;
    }
    owned = { ...parsed.owned };
  } catch (e) {
    owned = {};
  }
}

function save() {
  try { localStorage.setItem(KEY, JSON.stringify({ v: 1, owned })); } catch (e) { /* storage full/blocked */ }
}

load();

// ─── own / count / total ─────────────────────────────────────────────────────
function own(id) {
  owned[id] = (owned[id] || 0) + 1;
  save();
  refreshWelcomeCount();
  return owned[id];
}

function count(id) {
  return owned[id] || 0;
}

function total() {
  return Object.keys(owned).filter(id => (owned[id] || 0) > 0).length;
}

// ─── roll ─────────────────────────────────────────────────────────────────────
// weights: common 70 / rare 25 / legendary 5. floor='rare' renormalizes over
// rare+legendary (25/30, 5/30); floor='legendary' always picks legendary.
function pickRarity(floor) {
  if (floor === 'legendary') return 'legendary';
  if (floor === 'rare') return Math.random() < (25 / 30) ? 'rare' : 'legendary';
  const r = Math.random() * 100;
  if (r < 70) return 'common';
  if (r < 95) return 'rare';
  return 'legendary';
}

function roll(floor) {
  const rarity = pickRarity(floor);
  const pool = CARDS.filter(c => c.rarity === rarity);
  const card = pool[Math.floor(Math.random() * pool.length)];
  own(card.id);
  return card;
}

// ─── award (+ reveal ceremony queue) ─────────────────────────────────────────
function award(id) {
  const card = CARDS.find(c => c.id === id);
  if (!card) return null;
  own(id);
  queueReveal(card);
  return card;
}

function awardRoll(floor) {
  const card = roll(floor);
  queueReveal(card);
  return card;
}

// ─── card visual (shared between reveal ceremony + gallery lightbox) ───────
function frogCardHTML(card, cardCount) {
  return `
    <div class="frog-card frog-card-${card.rarity}">
      <span class="frog-card-ribbon">${card.rarity}</span>
      ${cardCount > 1 ? `<span class="frog-card-dupe">×${cardCount}</span>` : ''}
      <div class="frog-card-portrait"><span class="frog-card-emoji">${card.emoji}</span></div>
      <div class="frog-card-name">${card.name}</div>
      <div class="frog-card-flavor">${card.flavor}</div>
    </div>`;
}

// ─── reveal ceremony (#card-reveal, built once) ──────────────────────────────
let revealQueue = [];
let currentReveal = null;
let flipped = false;

function ensureRevealOverlay() {
  if (document.getElementById('card-reveal')) return;
  const el = document.createElement('div');
  el.id = 'card-reveal';
  el.className = 'hidden';
  el.innerHTML = `
    <div class="frog-card-flip" id="card-reveal-flip">
      <div class="frog-card-flip-inner">
        <div class="frog-card-face frog-card-back">
          <div class="frog-card-back-crest">✦</div>
          <div class="frog-card-back-q">?</div>
        </div>
        <div class="frog-card-face frog-card-front" id="card-reveal-front"></div>
      </div>
    </div>
    <div class="card-reveal-hint" id="card-reveal-hint">Tap to reveal</div>`;
  document.body.appendChild(el);
  el.addEventListener('click', onRevealTap);
}

function queueReveal(card) {
  revealQueue.push(card);
  if (!currentReveal) advanceReveal();
}

function advanceReveal() {
  ensureRevealOverlay();
  const el = document.getElementById('card-reveal');
  if (!revealQueue.length) {
    currentReveal = null;
    el.classList.remove('show');
    setTimeout(() => el.classList.add('hidden'), FX.reduced ? 0 : 300);
    return;
  }
  currentReveal = revealQueue.shift();
  flipped = false;
  document.getElementById('card-reveal-front').innerHTML = frogCardHTML(currentReveal, count(currentReveal.id));
  document.getElementById('card-reveal-flip').classList.remove('flipped');
  document.getElementById('card-reveal-hint').textContent = 'Tap to reveal';
  el.classList.remove('hidden');
  void el.offsetWidth;
  el.classList.add('show');
}

function onRevealTap() {
  if (!currentReveal) return;
  if (!flipped) {
    flipped = true;
    const card = currentReveal;
    document.getElementById('card-reveal-flip').classList.add('flipped');
    document.getElementById('card-reveal-hint').textContent = 'Tap to continue';
    const fireFX = () => {
      const cx = window.innerWidth / 2, cy = window.innerHeight * 0.42;
      FX.burst(cx, cy, { color: RARITY_GLOW[card.rarity], count: RARITY_BURST[card.rarity] });
      FX.ringPulse(cx, cy, RARITY_GLOW[card.rarity]);
      if (card.rarity === 'legendary') {
        AudioEngine.playFanfare();
        Dialogue.say('card-legendary');
      } else {
        AudioEngine.playChime();
      }
    };
    if (FX.reduced) fireFX(); else setTimeout(fireFX, 800);
  } else {
    advanceReveal();
  }
}

// ─── Gallery screen (#screen-gallery) ────────────────────────────────────────
function renderGallery() {
  const header = document.getElementById('gallery-header-count');
  if (header) header.textContent = `${total()}/${CARDS.length}`;
  const grid = document.getElementById('gallery-grid');
  if (!grid) return;
  grid.innerHTML = '';
  CARDS.forEach(card => {
    const c = count(card.id);
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = `gallery-tile gallery-tile-${c > 0 ? card.rarity : 'unowned'}`;
    if (c > 0) {
      tile.innerHTML = `
        <span class="gallery-tile-emoji">${card.emoji}</span>
        <span class="gallery-tile-name">${card.name}</span>
        ${c > 1 ? `<span class="gallery-tile-dupe">×${c}</span>` : ''}`;
      tile.addEventListener('click', () => openLightbox(card, c));
    } else {
      tile.innerHTML = `
        <span class="gallery-tile-emoji gallery-tile-silhouette">${card.emoji}</span>
        <span class="gallery-tile-q">?</span>`;
      tile.disabled = true;
    }
    grid.appendChild(tile);
  });
}

function ensureLightbox() {
  if (document.getElementById('gallery-lightbox')) return;
  const el = document.createElement('div');
  el.id = 'gallery-lightbox';
  el.className = 'hidden';
  el.innerHTML = `<div class="gallery-lightbox-card" id="gallery-lightbox-card"></div>`;
  document.body.appendChild(el);
  el.addEventListener('click', () => el.classList.add('hidden'));
}

function openLightbox(card, c) {
  ensureLightbox();
  document.getElementById('gallery-lightbox-card').innerHTML = frogCardHTML(card, c);
  document.getElementById('gallery-lightbox').classList.remove('hidden');
}

function openGallery(fromId = 'screen-welcome') {
  AudioEngine.playClick();
  renderGallery();
  switchScreen(fromId, 'screen-gallery');
}

function refreshWelcomeCount() {
  const el = document.getElementById('gallery-count');
  if (el) el.textContent = `${total()}/${CARDS.length}`;
}

// ─── public API ──────────────────────────────────────────────────────────────
export const Cards = {
  CARDS,
  own,
  count,
  total,
  roll,
  award,
  awardRoll,
  openGallery,
  refreshWelcomeRow: refreshWelcomeCount,
  init() {
    ensureRevealOverlay();
    ensureLightbox();
    refreshWelcomeCount();
    document.getElementById('gallery-back')?.addEventListener('click', () => {
      AudioEngine.playClick();
      switchScreen('screen-gallery', 'screen-welcome', updateWelcomeScreen);
    });
  },
};
