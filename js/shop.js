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
import { hasHaptics, isHapticsOn, toggleHaptics } from './effects.js';
import { iconCanvas } from './icons.js';

// Tiers sampled for the little skin swatch previews.
const SWATCH_TIERS = [0, 3, 6, 8];

export function renderMenu(root, state, onStart) {
  renderShopScreen(root, state, {
    title: 'Poof Poof',
    // Coins moved to the Cart button's own badge (7.1) -- the home screen
    // carries only the four things the brief specifies: title, best score,
    // Play, the icon row.
    lead: `
      <p class="subtitle">Drag falling fruit, merge matching pairs, chase the watermelon.</p>
      <p class="stat">Best score: <strong>${state.highScore}</strong></p>
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

// 9.3: the in-run pause panel -- Resume, Music, Sound, Back to menu. No
// master mute (removed in phase 3, host owns it) and no quit/exit control of
// any kind (Playables requirement) -- "Back to menu" only ever returns to
// this game's OWN menu screen, never closes the Playable itself.
//
// Deliberately NOT built on renderShopScreen: that screen is mutually
// exclusive with the canvas by design (its own Escape-handler comment says
// so), whereas this one has to render WHILE a run is live and the canvas is
// still showing -- frozen -- behind it. It reuses the same Sound/Music
// toggle markup and wiring the Gear panel uses (soundButtonHTML/
// wireSoundButton, musicButtonHTML/wireMusicButton below) rather than a
// second copy of that logic.
//
// main.js owns actually stopping/resuming the run (the same
// pauseRun/resumeRun platform.onPause/onResume use) and hiding/showing this
// panel's root -- this function only ever manages its OWN DOM content and
// its OWN Escape listener, mirroring renderShopScreen's own division of
// responsibility with its caller.
export function renderPausePanel(root, state, { onResume, onBackToMenu }) {
  function onKeyDown(evt) {
    if (evt.key !== 'Escape') return;
    window.removeEventListener('keydown', onKeyDown);
    onResume();
  }
  window.addEventListener('keydown', onKeyDown);

  function draw() {
    root.innerHTML = `
      <div class="screen pause-card">
        <h1>Paused</h1>
        <button class="primary" id="pause-resume-btn">Resume</button>
        <div class="toggle-row">
          ${soundButtonHTML()}
          ${musicButtonHTML()}
        </div>
        <button class="sound-btn" id="pause-menu-btn">Back to menu</button>
      </div>
    `;
    root.querySelector('#pause-resume-btn').addEventListener('click', () => {
      window.removeEventListener('keydown', onKeyDown);
      onResume();
    });
    root.querySelector('#pause-menu-btn').addEventListener('click', () => {
      window.removeEventListener('keydown', onKeyDown);
      onBackToMenu();
    });
    wireSoundButton(root, draw, state);
    wireMusicButton(root, draw, state);
  }

  draw();
}

// 7.1: the menu used to put everything on one page -- title, stats, six shop
// cards, five skin cards, three run toggles, Play, three audio buttons, a
// build stamp -- eleven cards deep before the button that starts the game.
// Now the first screen carries exactly four things (title, best score/result,
// Play, an icon row); the icon row opens one of three panels within the same
// overlay, each with its own back control. The overlay still fully replaces
// the canvas either way -- this only restructures what's inside it.
function renderShopScreen(root, state, { title, lead, playLabel, onStart }) {
  // Held across redraws so buying something does not clear the toggles.
  const opts = { useSlowDrop: false, useExtraRow: false, useRainbow: false };
  let panel = 'home'; // 'home' | 'cart' | 'palette' | 'gear'

  // Esc closes an open panel back to the home screen. This module never
  // renders alongside a run (the overlay and the canvas are mutually
  // exclusive), so there is no armed-power-up state to conflict with here --
  // input.js's own Escape handler covers that case independently. Removed
  // when this screen instance is torn down (start()), so repeated
  // menu/game-over cycles never accumulate listeners.
  function onKeyDown(evt) {
    if (evt.key !== 'Escape' || panel === 'home') return;
    panel = 'home';
    draw();
  }
  window.addEventListener('keydown', onKeyDown);

  function openPanel(name) {
    return () => {
      unlockAudio();
      playUiTick();
      panel = name;
      draw();
    };
  }

  function start() {
    window.removeEventListener('keydown', onKeyDown);
    unlockAudio();
    startRun(state, opts); // marks state.dirty
    onStart();
  }

  function homeHTML() {
    // A shop the player cannot afford anything from should say so before
    // they tap into it, not after -- the coin badge dims rather than reading
    // as just another number.
    const canAffordAnything = POWERUPS.some((p) => isUnlockedByScore(p, state.highScore) && state.coins >= p.cost);
    return `
      <div class="screen screen-home">
        <h1>${title}</h1>
        ${lead}
        <button class="primary" id="play-btn">${playLabel}</button>
        <div class="icon-row">
          <button class="icon-btn" id="open-cart">
            <span class="icon-slot" data-icon="cart"></span>
            <span class="icon-btn-label">Cart</span>
            <span class="icon-btn-badge ${canAffordAnything ? '' : 'badge-muted'}">${state.coins}</span>
          </button>
          <button class="icon-btn" id="open-palette">
            <span class="icon-slot" data-icon="palette"></span>
            <span class="icon-btn-label">Palette</span>
          </button>
          <button class="icon-btn" id="open-gear">
            <span class="icon-slot" data-icon="gear"></span>
            <span class="icon-btn-label">Gear</span>
          </button>
        </div>
        <p class="build-stamp">v${BUILD_VERSION}</p>
      </div>
    `;
  }

  function panelHeaderHTML(label) {
    return `
      <div class="panel-header">
        <button class="back-btn" id="back-btn"><span class="icon-slot" data-icon="back"></span></button>
        <h1>${label}</h1>
      </div>
    `;
  }

  function cartPanelHTML() {
    return `
      <div class="screen screen-panel">
        ${panelHeaderHTML('Cart')}
        <p class="coin-balance">Coins: <strong>${state.coins}</strong></p>
        <p class="hint">Remover, Swap and Bomb are tapped from the bar at the top of the screen during a run.</p>
        <div class="shop-grid">
          ${POWERUPS.map((p) => shopItemHTML(state, p)).join('')}
        </div>
        <h2>Next run</h2>
        ${runToggleHTML(state, 'slowDrop', 'toggle-slowdrop', 'Use Slow Drop', opts.useSlowDrop)}
        ${runToggleHTML(state, 'extraRow', 'toggle-extrarow', 'Use Extra Row', opts.useExtraRow)}
        ${runToggleHTML(state, 'rainbow', 'toggle-rainbow', 'Use Rainbow Fruit', opts.useRainbow)}
      </div>
    `;
  }

  function palettePanelHTML() {
    return `
      <div class="screen screen-panel">
        ${panelHeaderHTML('Palette')}
        <div class="skin-grid">
          ${SKINS.map((skin) => skinItemHTML(state, skin)).join('')}
        </div>
      </div>
    `;
  }

  function gearPanelHTML() {
    return `
      <div class="screen screen-panel">
        ${panelHeaderHTML('Gear')}
        <div class="toggle-row">
          ${soundButtonHTML()}
          ${musicButtonHTML()}
          ${hapticsButtonHTML()}
        </div>
        <p class="build-stamp">v${BUILD_VERSION}</p>
      </div>
    `;
  }

  function draw() {
    if (panel === 'home') root.innerHTML = homeHTML();
    else if (panel === 'cart') root.innerHTML = cartPanelHTML();
    else if (panel === 'palette') root.innerHTML = palettePanelHTML();
    else root.innerHTML = gearPanelHTML();

    mountIcons(root);

    if (panel === 'home') {
      root.querySelector('#open-cart').addEventListener('click', openPanel('cart'));
      root.querySelector('#open-palette').addEventListener('click', openPanel('palette'));
      root.querySelector('#open-gear').addEventListener('click', openPanel('gear'));
      root.querySelector('#play-btn').addEventListener('click', start);
      return;
    }

    root.querySelector('#back-btn').addEventListener('click', openPanel('home'));

    if (panel === 'cart') {
      root.querySelectorAll('.buy-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          unlockAudio();
          const item = POWERUPS.find((p) => p.id === btn.dataset.key);
          if (item && buyPowerUp(state, item.id, item.cost)) playUiTick(); // marks state.dirty
          draw();
        });
      });
      bindToggle(root, '#toggle-slowdrop', (v) => { opts.useSlowDrop = v; });
      bindToggle(root, '#toggle-extrarow', (v) => { opts.useExtraRow = v; });
      bindToggle(root, '#toggle-rainbow', (v) => { opts.useRainbow = v; });
    } else if (panel === 'palette') {
      root.querySelectorAll('.skin-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          unlockAudio();
          if (selectSkin(state, btn.dataset.skin)) playUiTick(); // marks state.dirty
          draw();
        });
      });
    } else if (panel === 'gear') {
      wireSoundButton(root, draw, state);
      wireMusicButton(root, draw, state);
      wireHapticsButton(root, draw, state);
    }
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

// Hidden entirely where the device cannot vibrate at all -- a toggle for
// something that can never do anything is worse than no toggle.
function hapticsButtonHTML() {
  if (!hasHaptics()) return '';
  return `<button class="sound-btn" id="haptics-btn">${isHapticsOn() ? 'Haptics: on' : 'Haptics: off'}</button>`;
}

// Mute/music/haptics live in audio.js/music.js/effects.js, not state.js, so
// unlike the buttons above these have no state.js export to get state.dirty
// from for free.
function wireSoundButton(root, redraw, state) {
  const btn = root.querySelector('#sound-btn');
  if (!btn) return;
  btn.addEventListener('click', () => {
    unlockAudio();
    toggleMuted();
    playUiTick();
    state.dirty = true;
    if (redraw) redraw();
  });
}

function wireMusicButton(root, redraw, state) {
  const btn = root.querySelector('#music-btn');
  if (!btn) return;
  btn.addEventListener('click', () => {
    unlockAudio();
    toggleMusic();
    playUiTick();
    state.dirty = true;
    if (redraw) redraw();
  });
}

// Follows exactly the pattern above -- same toggle/tick/dirty/redraw shape,
// no second mechanism invented for a third toggle.
function wireHapticsButton(root, redraw, state) {
  const btn = root.querySelector('#haptics-btn');
  if (!btn) return;
  btn.addEventListener('click', () => {
    unlockAudio();
    toggleHaptics();
    playUiTick();
    state.dirty = true;
    if (redraw) redraw();
  });
}
