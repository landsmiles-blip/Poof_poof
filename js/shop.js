// DOM-based menu / game-over / shop screens. Canvas is only used for
// active gameplay; these overlay screens are plain HTML for accessible,
// easy-to-hit buttons on touch devices.
//
// The menu and the game-over screen render the SAME shop body. They used to
// differ: only game-over had the shop and the run toggles, which meant coins
// could not be spent and Slow Drop / Extra Row / Rainbow could not be armed
// until the player had already lost a run. After a page load the first run was
// always unequipped, no matter how full the inventory was.

import { POWERUPS, SKINS, TIERS, BUILD_VERSION } from './constants.js';
import { buyPowerUp, startRun, selectSkin, isUnlockedByScore } from './state.js';
import { unlockAudio, toggleMuted, isMuted, playUiTick } from './audio.js';
import { isMusicOn, toggleMusic } from './music.js';
import { iconCanvas } from './icons.js';

// Tiers sampled for the little skin swatch previews.
const SWATCH_TIERS = [0, 3, 6, 8];

export function renderMenu(root, state, onStart) {
  renderShopScreen(root, state, {
    title: 'Poof Poof',
    lead: `
      <p class="subtitle">Drag falling fruit, merge matching pairs, chase the watermelon.</p>
      <p class="stat">Best score: <strong>${state.highScore}</strong></p>
      <p class="stat">Coins: <strong>${state.coins}</strong></p>
    `,
    playLabel: 'Play',
    onStart,
  });
}

export function renderGameOver(root, state, onPlayAgain) {
  renderShopScreen(root, state, {
    title: 'Game Over',
    lead: `
      <p class="stat">Score: <strong>${state.score}</strong></p>
      <p class="stat">Best: <strong>${state.highScore}</strong></p>
      ${state.bestComboThisRun >= 2 ? `<p class="stat">Best combo: <strong>${state.bestComboThisRun}x chain</strong></p>` : ''}
      <p class="stat">Coins earned: <strong>+${state.lastRunCoinsEarned}</strong></p>
      <p class="stat">Coin balance: <strong>${state.coins}</strong></p>
      ${renderUnlockBanner(state)}
    `,
    playLabel: 'Play Again',
    onStart: onPlayAgain,
  });
}

function renderShopScreen(root, state, { title, lead, playLabel, onStart }) {
  // Held across redraws so buying something does not clear the toggles.
  const opts = { useSlowDrop: false, useExtraRow: false, useRainbow: false };

  function draw() {
    root.innerHTML = `
      <div class="screen">
        <h1>${title}</h1>
        ${lead}

        <h2>Power-ups</h2>
        <p class="hint">Remover, Magnet and Bomb are tapped from the bar at the top of the screen during a run.</p>
        <div class="shop-grid">
          ${POWERUPS.map((p) => shopItemHTML(state, p)).join('')}
        </div>

        <h2>Fruit skins</h2>
        <div class="skin-grid">
          ${SKINS.map((skin) => skinItemHTML(state, skin)).join('')}
        </div>

        <h2>Next run</h2>
        ${runToggleHTML(state, 'slowDrop', 'toggle-slowdrop', 'Use Slow Drop', opts.useSlowDrop)}
        ${runToggleHTML(state, 'extraRow', 'toggle-extrarow', 'Use Extra Row', opts.useExtraRow)}
        ${runToggleHTML(state, 'rainbow', 'toggle-rainbow', 'Use Rainbow Fruit', opts.useRainbow)}

        <button class="primary" id="play-btn">${playLabel}</button>
        <div class="toggle-row">
          ${soundButtonHTML()}
          ${musicButtonHTML()}
        </div>
        <p class="build-stamp">v${BUILD_VERSION}</p>
      </div>
    `;

    mountIcons(root);

    root.querySelectorAll('.buy-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        unlockAudio();
        const item = POWERUPS.find((p) => p.id === btn.dataset.key);
        if (item && buyPowerUp(state, item.id, item.cost)) playUiTick();
        draw();
      });
    });

    root.querySelectorAll('.skin-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        unlockAudio();
        if (selectSkin(state, btn.dataset.skin)) playUiTick();
        draw();
      });
    });

    bindToggle(root, '#toggle-slowdrop', (v) => { opts.useSlowDrop = v; });
    bindToggle(root, '#toggle-extrarow', (v) => { opts.useExtraRow = v; });
    bindToggle(root, '#toggle-rainbow', (v) => { opts.useRainbow = v; });

    root.querySelector('#play-btn').addEventListener('click', () => {
      unlockAudio();
      startRun(state, opts);
      onStart();
    });

    wireSoundButton(root, draw);
    wireMusicButton(root, draw);
  }

  draw();
}

function bindToggle(root, selector, set) {
  const el = root.querySelector(selector);
  if (el) el.addEventListener('change', (e) => set(e.target.checked));
}

// Only offered when the power-up is both unlocked and owned.
function runToggleHTML(state, id, domId, label, checked) {
  const item = POWERUPS.find((p) => p.id === id);
  if (!isUnlockedByScore(item, state.highScore)) return '';
  const owned = state.inventory[id] || 0;
  return `
    <label class="toggle">
      <input type="checkbox" id="${domId}" ${checked ? 'checked' : ''} ${owned > 0 ? '' : 'disabled'}>
      ${label} (${owned} owned)
    </label>
  `;
}

function renderUnlockBanner(state) {
  const parts = [];
  if (state.newlyUnlockedSkins && state.newlyUnlockedSkins.length > 0) {
    const names = state.newlyUnlockedSkins
      .map((id) => SKINS.find((s) => s.id === id)?.name)
      .filter(Boolean);
    parts.push(...names.map((n) => `${n} skin`));
  }
  // A milestone unlocks a skin and a power-up together, so surface both.
  if (state.newlyUnlockedPowerUps && state.newlyUnlockedPowerUps.length > 0) {
    const names = state.newlyUnlockedPowerUps
      .map((id) => POWERUPS.find((p) => p.id === id)?.name)
      .filter(Boolean);
    parts.push(...names);
  }
  if (parts.length === 0) return '';
  return `<p class="unlock-banner">Unlocked: ${parts.join(' + ')}!</p>`;
}

function shopItemHTML(state, item) {
  const unlocked = isUnlockedByScore(item, state.highScore);
  const affordable = state.coins >= item.cost;

  const action = unlocked
    ? `<button class="buy-btn" data-key="${item.id}" ${affordable ? '' : 'disabled'}>Buy for ${item.cost}</button>`
    : `<button class="buy-btn" disabled>Reach ${item.unlockScore}</button>`;

  return `
    <div class="shop-item ${unlocked ? '' : 'locked'}">
      <div class="shop-item-head">
        <span class="icon-slot" data-icon="${item.icon}"></span>
        <span class="shop-item-title">${item.name}</span>
      </div>
      <div class="shop-item-desc">${item.desc}</div>
      <div class="shop-item-owned">Owned: ${state.inventory[item.id] || 0}</div>
      ${action}
    </div>
  `;
}

// Icons are canvases drawn in code, so they are injected after the HTML lands.
function mountIcons(root) {
  root.querySelectorAll('.icon-slot').forEach((slot) => {
    const name = slot.dataset.icon;
    if (!name) return;
    const color = getComputedStyle(document.documentElement)
      .getPropertyValue('--text-color').trim() || '#3a2b20';
    slot.replaceChildren(iconCanvas(name, 22, color));
  });
}

function skinItemHTML(state, skin) {
  const unlocked = state.unlockedSkins.includes(skin.id);
  const selected = state.selectedSkin === skin.id;
  const swatches = SWATCH_TIERS.map((t) => {
    const shape = TIERS[t].shape === 'flower' ? 'swatch-flower' : 'swatch-circle';
    return `<span class="swatch ${shape}" style="background:${skin.colors[t]}"></span>`;
  }).join('');

  let action;
  if (!unlocked) {
    action = `<button class="skin-btn" data-skin="${skin.id}" disabled>Reach ${skin.unlockScore}</button>`;
  } else if (selected) {
    action = `<button class="skin-btn selected" data-skin="${skin.id}" disabled>Selected</button>`;
  } else {
    action = `<button class="skin-btn" data-skin="${skin.id}">Use</button>`;
  }

  return `
    <div class="skin-item ${unlocked ? '' : 'locked'} ${selected ? 'is-selected' : ''}">
      <div class="skin-name">${skin.name}</div>
      <div class="swatches">${swatches}</div>
      ${action}
    </div>
  `;
}

function soundButtonHTML() {
  return `<button class="sound-btn" id="sound-btn">${isMuted() ? 'Sound: off' : 'Sound: on'}</button>`;
}

function musicButtonHTML() {
  return `<button class="sound-btn" id="music-btn">${isMusicOn() ? 'Music: on' : 'Music: off'}</button>`;
}

function wireSoundButton(root, redraw) {
  const btn = root.querySelector('#sound-btn');
  if (!btn) return;
  btn.addEventListener('click', () => {
    unlockAudio();
    toggleMuted();
    playUiTick();
    if (redraw) redraw();
  });
}

function wireMusicButton(root, redraw) {
  const btn = root.querySelector('#music-btn');
  if (!btn) return;
  btn.addEventListener('click', () => {
    unlockAudio();
    toggleMusic();
    playUiTick();
    if (redraw) redraw();
  });
}
