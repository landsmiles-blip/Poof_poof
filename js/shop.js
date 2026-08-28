// DOM-based menu / game-over / shop screens. Canvas is only used for
// active gameplay; these overlay screens are plain HTML for accessible,
// easy-to-hit buttons on touch devices.

import { POWERUP_COSTS, SKINS, TIERS } from './constants.js';
import { buyPowerUp, startRun, selectSkin } from './state.js';
import { unlockAudio, toggleMuted, isMuted, playUiTick } from './audio.js';

const POWERUP_LABELS = {
  slowDrop: { title: 'Slow Drop', desc: 'Fruits fall slower for one run.' },
  remover: { title: 'Fruit Remover', desc: 'Tap to delete one fruit mid-run.' },
  extraRow: { title: 'Extra Row', desc: 'One extra row of headroom for one run.' },
};

// Tiers sampled for the little skin swatch previews.
const SWATCH_TIERS = [0, 3, 6, 8];

export function renderMenu(root, state, onStart) {
  root.innerHTML = `
    <div class="screen">
      <h1>Poof Poof</h1>
      <p class="subtitle">Drag falling fruit, merge matching pairs, chase the watermelon.</p>
      <p class="stat">Best score: <strong>${state.highScore}</strong></p>
      <p class="stat">Coins: <strong>${state.coins}</strong></p>
      ${renderInventorySummary(state)}
      <button class="primary" id="start-btn">Play</button>
      ${soundButtonHTML()}
    </div>
  `;
  root.querySelector('#start-btn').addEventListener('click', () => {
    unlockAudio();
    onStart();
  });
  wireSoundButton(root);
}

export function renderGameOver(root, state, onPlayAgain) {
  const opts = { useSlowDrop: false, useExtraRow: false };

  function draw() {
    root.innerHTML = `
      <div class="screen">
        <h1>Game Over</h1>
        <p class="stat">Score: <strong>${state.score}</strong></p>
        <p class="stat">Best: <strong>${state.highScore}</strong></p>
        ${state.bestComboThisRun >= 2 ? `<p class="stat">Best combo: <strong>${state.bestComboThisRun}x chain</strong></p>` : ''}
        <p class="stat">Coins earned: <strong>+${state.lastRunCoinsEarned}</strong></p>
        <p class="stat">Coin balance: <strong>${state.coins}</strong></p>
        ${renderUnlockBanner(state)}

        <h2>Power-ups</h2>
        <div class="shop-grid">
          ${Object.keys(POWERUP_COSTS).map((key) => shopItemHTML(state, key)).join('')}
        </div>

        <h2>Fruit skins</h2>
        <div class="skin-grid">
          ${SKINS.map((skin) => skinItemHTML(state, skin)).join('')}
        </div>

        <h2>Next run</h2>
        <label class="toggle">
          <input type="checkbox" id="toggle-slowdrop" ${opts.useSlowDrop ? 'checked' : ''} ${state.inventory.slowDrop > 0 ? '' : 'disabled'}>
          Use Slow Drop (${state.inventory.slowDrop} owned)
        </label>
        <label class="toggle">
          <input type="checkbox" id="toggle-extrarow" ${opts.useExtraRow ? 'checked' : ''} ${state.inventory.extraRow > 0 ? '' : 'disabled'}>
          Use Extra Row (${state.inventory.extraRow} owned)
        </label>
        <p class="hint">Fruit Remover: ${state.inventory.remover} charge${state.inventory.remover === 1 ? '' : 's'} in stock, usable any time during a run until spent.</p>

        <button class="primary" id="play-again-btn">Play Again</button>
        ${soundButtonHTML()}
      </div>
    `;

    root.querySelectorAll('.buy-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        unlockAudio();
        const key = btn.dataset.key;
        if (buyPowerUp(state, key, POWERUP_COSTS[key])) playUiTick();
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

    root.querySelector('#toggle-slowdrop').addEventListener('change', (e) => {
      opts.useSlowDrop = e.target.checked;
    });
    root.querySelector('#toggle-extrarow').addEventListener('change', (e) => {
      opts.useExtraRow = e.target.checked;
    });

    root.querySelector('#play-again-btn').addEventListener('click', () => {
      unlockAudio();
      startRun(state, opts);
      onPlayAgain();
    });

    wireSoundButton(root, draw);
  }

  draw();
}

function renderUnlockBanner(state) {
  if (!state.newlyUnlockedSkins || state.newlyUnlockedSkins.length === 0) return '';
  const names = state.newlyUnlockedSkins
    .map((id) => SKINS.find((s) => s.id === id)?.name)
    .filter(Boolean)
    .join(', ');
  if (!names) return '';
  return `<p class="unlock-banner">New skin unlocked: ${names}!</p>`;
}

function shopItemHTML(state, key) {
  const cost = POWERUP_COSTS[key];
  const label = POWERUP_LABELS[key];
  const affordable = state.coins >= cost;
  return `
    <div class="shop-item">
      <div class="shop-item-title">${label.title}</div>
      <div class="shop-item-desc">${label.desc}</div>
      <div class="shop-item-owned">Owned: ${state.inventory[key] || 0}</div>
      <button class="buy-btn" data-key="${key}" ${affordable ? '' : 'disabled'}>Buy for ${cost}</button>
    </div>
  `;
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

function wireSoundButton(root, redraw) {
  const btn = root.querySelector('#sound-btn');
  if (!btn) return;
  btn.addEventListener('click', () => {
    unlockAudio();
    toggleMuted();
    playUiTick();
    if (redraw) redraw();
    else btn.textContent = isMuted() ? 'Sound: off' : 'Sound: on';
  });
}

function renderInventorySummary(state) {
  const owned = Object.entries(state.inventory).filter(([, n]) => n > 0);
  if (owned.length === 0) return '';
  const parts = owned.map(([key, n]) => `${POWERUP_LABELS[key].title} x${n}`).join(', ');
  return `<p class="stat small">Owned: ${parts}</p>`;
}
