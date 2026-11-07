const seed = globalThis.PAUSE_SEED || {};
const defaults = {
  shortMinutes: Number(seed.shortMinutes) || 5,
  longMinutes: Number(seed.longMinutes) || 60,
  youtube: seed.youtube !== false,
  instagram: seed.instagram !== false,
  snoozeMinutes: Number(seed.snoozeMinutes) || 5,
  friction: ["light","medium","strong"].includes(seed.friction) ? seed.friction : "medium",
  ideas: Array.isArray(seed.ideas) ? seed.ideas : []
};

const ideasBox = document.getElementById('ideas');
const count = document.getElementById('ideaCount');
const activeSection = document.getElementById('activeSection');
const timerIdle = document.getElementById('timerIdle');
const timerTime = document.getElementById('timerTime');
const timerFill = document.getElementById('timerFill');
const sessionName = document.getElementById('sessionName');
const elapsedText = document.getElementById('elapsedText');
const limitText = document.getElementById('limitText');
const snoozeState = document.getElementById('snoozeState');
let timerState = null;
let timerInterval = null;

function parseIdeas() {
  return ideasBox.value.split('\n').map(x => x.trim()).filter(Boolean).slice(0, 100);
}
function updateCount() {
  count.textContent = `${parseIdeas().length} ideas`;
}
function formatTime(totalSeconds) {
  const safe = Math.max(0, Math.ceil(Number(totalSeconds) || 0));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}
function conciseDuration(totalSeconds) {
  const safe = Math.max(0, Math.round(Number(totalSeconds) || 0));
  if (safe < 60) return `${safe}s`;
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return secs ? `${mins}m ${secs}s` : `${mins}m`;
}
function renderTimer() {
  if (!timerState?.active) {
    activeSection.hidden = true;
    timerIdle.hidden = false;
    return;
  }

  activeSection.hidden = false;
  timerIdle.hidden = true;
  sessionName.textContent = timerState.label || 'Current session';
  const limit = Math.max(1, Number(timerState.limitSeconds) || 1);
  const snoozeUntil = Number(timerState.snoozedUntil) || 0;
  const isSnoozing = snoozeUntil > Date.now();

  if (isSnoozing) {
    const snoozeLeft = Math.max(0, Math.ceil((snoozeUntil - Date.now()) / 1000));
    timerTime.textContent = `${formatTime(snoozeLeft)} left`;
    elapsedText.textContent = 'Extra time active';
    limitText.textContent = `Snooze: +${document.getElementById('snoozeMinutes').value || defaults.snoozeMinutes}m`;
    timerFill.style.width = `${Math.max(0, Math.min(100, (1 - snoozeLeft / Math.max(1, Number(document.getElementById('snoozeMinutes').value || defaults.snoozeMinutes) * 60)) * 100))}%`;
    snoozeState.hidden = false;
    snoozeState.textContent = 'Extra time is active. When it ends, a fresh intent check appears immediately. You can snooze again after solving it.';
    return;
  }

  snoozeState.hidden = true;
  const remaining = Math.max(0, Number(timerState.remainingSeconds) || 0);
  const elapsed = Math.max(0, limit - remaining);
  timerTime.textContent = timerState.blocked ? 'Time is up' : `${formatTime(remaining)} left`;
  elapsedText.textContent = `${conciseDuration(elapsed)} elapsed`;
  limitText.textContent = `Limit: ${conciseDuration(limit)}`;
  timerFill.style.width = `${Math.min(100, Math.max(0, elapsed / limit * 100))}%`;
}
function requestTimer() {
  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    const tab = tabs?.[0];
    if (!tab?.id) {
      timerState = { active: false };
      renderTimer();
      return;
    }
    chrome.tabs.sendMessage(tab.id, { type: 'PAUSE_GET_TIMER' }, response => {
      if (chrome.runtime.lastError || !response) timerState = { active: false };
      else timerState = response;
      renderTimer();
    });
  });
}

chrome.storage.sync.get(defaults, s => {
  for (const k of ['youtube', 'instagram', 'shortMinutes', 'longMinutes', 'snoozeMinutes', 'friction']) {
    const el = document.getElementById(k);
    if (el.type === 'checkbox') el.checked = s[k];
    else el.value = s[k];
  }
  ideasBox.value = (Array.isArray(s.ideas) ? s.ideas : defaults.ideas).join('\n');
  updateCount();
  renderTimer();
});

ideasBox.addEventListener('input', updateCount);
document.getElementById('closePopup').addEventListener('click', () => window.close());
document.getElementById('save').addEventListener('click', () => {
  const values = {
    youtube: document.getElementById('youtube').checked,
    instagram: document.getElementById('instagram').checked,
    shortMinutes: Math.min(60, Math.max(1, Number(document.getElementById('shortMinutes').value) || 5)),
    longMinutes: Math.min(240, Math.max(10, Number(document.getElementById('longMinutes').value) || 60)),
    snoozeMinutes: Math.min(60, Math.max(1, Number(document.getElementById('snoozeMinutes').value) || 5)),
    friction: document.getElementById('friction').value || 'medium',
    ideas: parseIdeas()
  };
  chrome.storage.sync.set(values, () => {
    const s = document.getElementById('saved');
    s.textContent = 'Saved ✓';
    updateCount();
    setTimeout(() => s.textContent = '', 1400);
  });
});

requestTimer();
timerInterval = setInterval(requestTimer, 1000);
window.addEventListener('unload', () => clearInterval(timerInterval));
