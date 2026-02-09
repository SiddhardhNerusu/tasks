const API_STATE_ENDPOINT = "/api/state";
const API_PUSH_PUBLIC_KEY_ENDPOINT = "/api/push/public-key";
const API_PUSH_SUBSCRIBE_ENDPOINT = "/api/push/subscribe";
const API_PUSH_DISPATCH_ENDPOINT = "/api/push/dispatch";
const REMOTE_PUSH_DEBOUNCE_MS = 320;
const REMOTE_POLL_MS = 4500;

const MAX_TASKS = 5;
const USERS = ["me", "partner"];
const USER_META = {
  me: { name: "Siddu" },
  partner: { name: "Sumi" },
};
const CALENDAR_VIEW_ORDER = ["week", "month", "year"];
const PLACEHOLDER_TEXT = {
  me: "e.g. gym, be handsome, be strong",
  partner: "MY BABBYYYY WABBYYYYYYY",
};

const SWIPE_MAX = 108;
const SWIPE_DELETE_THRESHOLD = 84;
const DEFAULT_MORNING_REMINDER_TIME = "09:00";
const TASK_REMINDER_LEAD_MINUTES = 10;
const MAX_REACTION_MESSAGE_CHARS = 120;
const LEAVE_GUARD_MESSAGES = [
  "are you sure? this will make you more productive",
  "are you reallyyyyy sure",
  "are you reallyyyyyyyyyyyyyyyyy sure",
];

const ui = {
  todayDate: document.getElementById("todayDate"),
  daysOnFire: document.getElementById("daysOnFire"),
  watermarkLayer: document.getElementById("watermarkLayer"),
  calendarTitle: document.getElementById("calendarTitle"),
  weekRange: document.getElementById("weekRange"),
  calendarViewport: document.getElementById("calendarViewport"),
  calendarExpandBtn: document.getElementById("calendarExpandBtn"),
  myTasksTitle: document.getElementById("myTasksTitle"),
  partnerTasksTitle: document.getElementById("partnerTasksTitle"),
  myTasks: document.getElementById("myTasks"),
  partnerTasks: document.getElementById("partnerTasks"),
  myTaskCount: document.getElementById("myTaskCount"),
  partnerSnapshot: document.getElementById("partnerSnapshot"),
  taskInput: document.getElementById("taskInput"),
  addTaskBtn: document.getElementById("addTaskBtn"),
  reminderToggle: document.getElementById("reminderToggle"),
  taskTimeInput: document.getElementById("taskTimeInput"),
  limitHint: document.getElementById("limitHint"),
  recapGrid: document.getElementById("recapGrid"),
  dailyMessage: document.getElementById("dailyMessage"),
  weekMessage: document.getElementById("weekMessage"),
  previewOverlay: document.getElementById("previewOverlay"),
  previewDate: document.getElementById("previewDate"),
  previewBody: document.getElementById("previewBody"),
  statsOverlay: document.getElementById("statsOverlay"),
  statsBody: document.getElementById("statsBody"),
  settingsOverlay: document.getElementById("settingsOverlay"),
  morningReminderTimeInput: document.getElementById("morningReminderTimeInput"),
  enablePushBtn: document.getElementById("enablePushBtn"),
  pushStatusText: document.getElementById("pushStatusText"),
  reactionImageOverlay: document.getElementById("reactionImageOverlay"),
  reactionImage: document.getElementById("reactionImage"),
  reactionImageCaption: document.getElementById("reactionImageCaption"),
  toast: document.getElementById("toast"),
};

let currentDateKey = getDateKey(new Date());
let toastTimer = null;
let state = createInitialState();
let swipeState = null;
let suppressTaskClickUntil = 0;
let countdownTicker = null;
let remotePushTimer = null;
let remotePollTimer = null;
let remoteSyncInFlight = false;
let remoteDirty = false;
let hasShownSyncUnavailableToast = false;
let swRegistration = null;
let pushSubscription = null;
let leaveGuardAttempts = 0;
let pushDispatchTimer = null;

initApp();

async function initApp() {
  state = await loadState();
  ensureDaySpace({ sync: false });
  await bootstrapRemoteState();
  renderWatermarks();
  bindEvents();
  render();
  swRegistration = await registerServiceWorker();
  await syncPushSubscription({ allowSubscribe: false });
  startCountdownTicker();
  updateCountdownChips();
  startRemoteSyncWatcher();
  startDayWatcher();
  startReminderWatcher();
  startClientPushDispatcher();
  checkReminderAlerts();
}

function bindEvents() {
  document.addEventListener("click", (event) => {
    if (Date.now() < suppressTaskClickUntil && event.target.closest(".swipe-item")) {
      event.preventDefault();
      return;
    }

    const actionEl = event.target.closest("[data-action]");
    if (!actionEl) {
      return;
    }

    const action = actionEl.dataset.action;

    if (action === "switch-profile") {
      switchProfile(actionEl.dataset.profile);
      return;
    }

    if (action === "toggle-calendar-view") {
      toggleCalendarView();
      return;
    }

    if (action === "toggle-task") {
      toggleTask(actionEl.dataset.owner, actionEl.dataset.taskId);
      return;
    }

    if (action === "open-reaction-image-picker") {
      openReactionImagePicker(actionEl);
      return;
    }

    if (action === "view-reaction-image") {
      openReactionImage(actionEl.dataset.owner, actionEl.dataset.taskId);
      return;
    }

    if (action === "close-reaction-image") {
      closeReactionImage();
      return;
    }

    if (action === "open-day-preview") {
      openDayPreview(actionEl.dataset.dayKey);
      return;
    }

    if (action === "close-day-preview") {
      closeDayPreview();
      return;
    }

    if (action === "open-stats") {
      openStatsModal();
      return;
    }

    if (action === "close-stats") {
      closeStatsModal();
      return;
    }

    if (action === "open-settings") {
      openSettingsModal();
      return;
    }

    if (action === "close-settings") {
      closeSettingsModal();
      return;
    }

    if (action === "save-settings") {
      void saveSettingsFromModal();
      return;
    }

    if (action === "enable-push") {
      void enablePushNotifications();
    }
  });

  ui.addTaskBtn.addEventListener("click", addTask);

  ui.taskInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      addTask();
    }
  });

  ui.reminderToggle.addEventListener("change", () => {
    if (ui.reminderToggle.checked) {
      if (!ui.taskTimeInput.value) {
        ui.taskTimeInput.value = buildDefaultReminderTime();
      }
    }

    ui.taskTimeInput.disabled = !ui.reminderToggle.checked;
  });

  ui.previewOverlay.addEventListener("click", (event) => {
    if (event.target === ui.previewOverlay) {
      closeDayPreview();
    }
  });

  ui.statsOverlay.addEventListener("click", (event) => {
    if (event.target === ui.statsOverlay) {
      closeStatsModal();
    }
  });

  ui.settingsOverlay.addEventListener("click", (event) => {
    if (event.target === ui.settingsOverlay) {
      closeSettingsModal();
    }
  });

  ui.reactionImageOverlay.addEventListener("click", (event) => {
    if (event.target === ui.reactionImageOverlay) {
      closeReactionImage();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeDayPreview();
      closeStatsModal();
      closeSettingsModal();
      closeReactionImage();
      return;
    }

    if ((event.key === "Enter" || event.key === "Done") && event.target.classList.contains("reaction-message-input")) {
      event.preventDefault();
      const owner = event.target.dataset.owner;
      const taskId = event.target.dataset.taskId;
      if (owner && taskId) {
        sendReactionMessage(owner, taskId);
      }
    }
  });

  document.addEventListener("pointerdown", onSwipePointerDown);
  document.addEventListener("pointermove", onSwipePointerMove, { passive: false });
  document.addEventListener("pointerup", onSwipePointerUp);
  document.addEventListener("pointercancel", onSwipePointerUp);
  document.addEventListener("touchstart", onSwipeTouchStart, { passive: true });
  document.addEventListener("touchmove", onSwipeTouchMove, { passive: false });
  document.addEventListener("touchend", onSwipeTouchEnd);
  document.addEventListener("touchcancel", onSwipeTouchCancel);

  window.addEventListener("focus", () => {
    checkForNewDay();
    checkReminderAlerts();
    pullRemoteState({ force: true });
    void syncPushSubscription({ allowSubscribe: false });
    void dispatchPushReminders();
  });

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      checkForNewDay();
      checkReminderAlerts();
      pullRemoteState({ force: true });
      void syncPushSubscription({ allowSubscribe: false });
      void dispatchPushReminders();
    }
  });

  window.addEventListener("beforeunload", handleBeforeUnload);
}

async function loadState() {
  return createInitialState();
}

function createInitialState() {
  return {
    version: 5,
    profile: "me",
    preferences: {
      calendarView: "week",
      morningReminderTimes: buildDefaultMorningReminderTimes(),
    },
    days: {},
  };
}

function normalizeState(value) {
  const normalized = createInitialState();

  if (!value || typeof value !== "object") {
    return normalized;
  }

  normalized.profile = value.profile === "partner" ? "partner" : "me";

  const calendarView = value.preferences && value.preferences.calendarView;
  normalized.preferences.calendarView = CALENDAR_VIEW_ORDER.includes(calendarView) ? calendarView : "week";
  normalized.preferences.morningReminderTimes = normalizeMorningReminderTimes(
    value.preferences && value.preferences.morningReminderTimes
  );

  if (value.settings && typeof value.settings === "object") {
    normalized.preferences.morningReminderTimes = normalizeMorningReminderTimes(value.settings.morningReminderTimes);
  }

  if (value.days && typeof value.days === "object") {
    Object.keys(value.days).forEach((dateKey) => {
      normalized.days[dateKey] = normalizeDay(value.days[dateKey], dateKey);
    });
  }

  return normalized;
}

function normalizeDay(value, dateKey) {
  const day = createDay(dateKey);

  if (!value || typeof value !== "object") {
    return day;
  }

  day.closed = Boolean(value.closed);
  day.closedAt = typeof value.closedAt === "string" ? value.closedAt : null;

  USERS.forEach((userId) => {
    const source = value.users && value.users[userId] ? value.users[userId] : {};
    const target = day.users[userId];

    target.checkedInAt = typeof source.checkedInAt === "string" ? source.checkedInAt : null;
    target.lastMorningReminderDate = typeof source.lastMorningReminderDate === "string" ? source.lastMorningReminderDate : null;

    const sourceTasks = Array.isArray(source.tasks) ? source.tasks : [];
    target.tasks = sourceTasks
      .map((task) => normalizeTask(task))
      .filter(Boolean);
  });

  return day;
}

function normalizeTask(task) {
  if (typeof task === "string") {
    const text = cleanText(task).slice(0, 52);
    if (!text) {
      return null;
    }

    const nowIso = new Date().toISOString();

    return {
      id: makeId(),
      text,
      done: false,
      doneAt: null,
      createdAt: nowIso,
      updatedAt: nowIso,
      deletedAt: null,
      reactions: createEmptyReactions(),
      reminderTime: null,
      lastReminderDate: null,
    };
  }

  if (!task || typeof task !== "object") {
    return null;
  }

  const text = cleanText(task.text || "").slice(0, 52);
  if (!text) {
    return null;
  }

  const nowIso = new Date().toISOString();
  const createdAt = typeof task.createdAt === "string" ? task.createdAt : nowIso;
  const updatedAt = typeof task.updatedAt === "string" ? task.updatedAt : createdAt;

  return {
    id: typeof task.id === "string" ? task.id : makeId(),
    text,
    done: Boolean(task.done),
    doneAt: typeof task.doneAt === "string" ? task.doneAt : null,
    createdAt,
    updatedAt,
    deletedAt: typeof task.deletedAt === "string" ? task.deletedAt : null,
    reactions: normalizeReactions(task.reactions),
    reminderTime: normalizeReminderTime(task.reminderTime),
    lastReminderDate: typeof task.lastReminderDate === "string" ? task.lastReminderDate : null,
  };
}

function normalizeReactions(reactions) {
  return {
    me: normalizeReactionEntry(reactions && reactions.me),
    partner: normalizeReactionEntry(reactions && reactions.partner),
  };
}

function createEmptyReactions() {
  return {
    me: createEmptyReactionEntry(),
    partner: createEmptyReactionEntry(),
  };
}

function createEmptyReactionEntry() {
  return {
    message: null,
    image: null,
    sentAt: null,
    imageConsumedAt: null,
  };
}

function normalizeReactionEntry(reaction) {
  if (typeof reaction === "string") {
    return {
      message: normalizeReactionMessage(reaction),
      image: null,
      sentAt: null,
      imageConsumedAt: null,
    };
  }

  if (!reaction || typeof reaction !== "object" || Array.isArray(reaction)) {
    return createEmptyReactionEntry();
  }

  return {
    message: normalizeReactionMessage(reaction.message),
    image: normalizeReactionImage(reaction.image),
    sentAt: typeof reaction.sentAt === "string" ? reaction.sentAt : null,
    imageConsumedAt: typeof reaction.imageConsumedAt === "string" ? reaction.imageConsumedAt : null,
  };
}

function normalizeReactionMessage(value) {
  if (typeof value !== "string") {
    return null;
  }

  const text = cleanText(value).slice(0, MAX_REACTION_MESSAGE_CHARS);
  return text || null;
}

function normalizeReactionImage(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const dataUrl = typeof value.dataUrl === "string" ? value.dataUrl : null;
  if (!dataUrl || !dataUrl.startsWith("data:image/")) {
    return null;
  }

  return {
    dataUrl,
    mimeType: typeof value.mimeType === "string" ? value.mimeType : "image/jpeg",
    sentAt: typeof value.sentAt === "string" ? value.sentAt : null,
  };
}

function normalizeReminderTime(value) {
  if (typeof value !== "string") {
    return null;
  }

  return /^\d{2}:\d{2}$/.test(value) ? value : null;
}

function createDay(dateKey) {
  return {
    dateKey,
    closed: false,
    closedAt: null,
    users: {
      me: { checkedInAt: null, lastMorningReminderDate: null, tasks: [] },
      partner: { checkedInAt: null, lastMorningReminderDate: null, tasks: [] },
    },
  };
}

function buildDefaultMorningReminderTimes() {
  return {
    me: DEFAULT_MORNING_REMINDER_TIME,
    partner: DEFAULT_MORNING_REMINDER_TIME,
  };
}

function normalizeMorningReminderTimes(value) {
  const defaults = buildDefaultMorningReminderTimes();

  if (!value || typeof value !== "object") {
    return defaults;
  }

  USERS.forEach((userId) => {
    const candidate = normalizeReminderTime(value[userId]);
    defaults[userId] = candidate || DEFAULT_MORNING_REMINDER_TIME;
  });

  return defaults;
}

function ensureDaySpace(options = {}) {
  const syncEnabled = options.sync !== false;
  let changed = false;
  const now = new Date();
  currentDateKey = getDateKey(now);

  Object.keys(state.days).forEach((dateKey) => {
    if (dateKey < currentDateKey && !state.days[dateKey].closed) {
      closeDay(dateKey, now.toISOString());
      changed = true;
    }
  });

  if (!state.days[currentDateKey]) {
    state.days[currentDateKey] = createDay(currentDateKey);
    changed = true;
  }

  if (changed) {
    saveState({ sync: syncEnabled });
  }

  return changed;
}

function closeDay(dateKey, closedAtIso) {
  const day = state.days[dateKey];
  if (!day || day.closed) {
    return;
  }

  day.closed = true;
  day.closedAt = closedAtIso;
}

function getDay() {
  return state.days[currentDateKey];
}

function getPartner(userId) {
  return userId === "me" ? "partner" : "me";
}

function saveState(options = {}) {
  const syncEnabled = options.sync !== false;
  const snapshot = JSON.parse(JSON.stringify(state));
  persistLocalState(snapshot);

  if (syncEnabled) {
    queueRemoteSync();
  }
}

function persistLocalState(snapshot) {
  void snapshot;
}

function switchProfile(profile) {
  if (!USERS.includes(profile) || state.profile === profile) {
    return;
  }

  state.profile = profile;
  saveState({ sync: false });
  render();
  checkReminderAlerts();
  void syncPushSubscription({ allowSubscribe: false });
}

function toggleCalendarView() {
  const current = state.preferences.calendarView;
  const index = CALENDAR_VIEW_ORDER.indexOf(current);
  const next = CALENDAR_VIEW_ORDER[(index + 1) % CALENDAR_VIEW_ORDER.length];

  state.preferences.calendarView = next;
  saveState({ sync: false });
  renderCalendar();
}

function addTask() {
  checkForNewDay();

  const day = getDay();
  if (day.closed) {
    showToast("This day is closed.");
    return;
  }

  const active = state.profile;
  const tasks = day.users[active].tasks;
  const visibleCount = getVisibleTasks(tasks).length;
  const text = cleanText(ui.taskInput.value).slice(0, 52);

  if (!text) {
    return;
  }

  if (visibleCount >= MAX_TASKS) {
    showToast("Today is capped at five tasks.");
    return;
  }

  const reminderTime = ui.reminderToggle.checked ? normalizeReminderTime(ui.taskTimeInput.value) : null;

  if (ui.reminderToggle.checked && !reminderTime) {
    showToast("Pick a reminder time first.");
    return;
  }

  const nowIso = new Date().toISOString();
  tasks.push({
    id: makeId(),
    text,
    done: false,
    doneAt: null,
    createdAt: nowIso,
    updatedAt: nowIso,
    deletedAt: null,
    reactions: createEmptyReactions(),
    reminderTime,
    lastReminderDate: null,
  });

  markCheckIn(active);
  ui.taskInput.value = "";

  saveState();
  render();
  leaveGuardAttempts = 0;
}

function toggleTask(owner, taskId) {
  const day = getDay();
  if (day.closed) {
    showToast("This day is closed.");
    return;
  }

  const active = state.profile;
  if (owner !== active) {
    showToast("Switch profile to update that task.");
    return;
  }

  const task = day.users[owner].tasks.find((item) => item.id === taskId && !item.deletedAt);
  if (!task) {
    return;
  }

  const nowIso = new Date().toISOString();
  task.done = !task.done;
  task.doneAt = task.done ? nowIso : null;
  task.updatedAt = nowIso;

  if (!task.done) {
    task.reactions = createEmptyReactions();
  }

  markCheckIn(owner);

  if (task.done) {
    showToast("Task completed");
  }

  saveState();
  render();
}

function deleteTask(owner, taskId) {
  const day = getDay();

  if (day.closed) {
    return;
  }

  if (owner !== state.profile) {
    return;
  }

  const tasks = day.users[owner].tasks;
  const task = tasks.find((item) => item.id === taskId && !item.deletedAt);
  if (!task) {
    return;
  }

  const nowIso = new Date().toISOString();
  task.deletedAt = nowIso;
  task.updatedAt = nowIso;
  saveState();
  render();
  showToast("Task cleared");
}

function sendReactionMessage(owner, taskId) {
  const day = getDay();
  if (day.closed) {
    return;
  }

  const active = state.profile;
  if (owner === active) {
    return;
  }

  const task = day.users[owner].tasks.find((item) => item.id === taskId && !item.deletedAt);
  if (!task || !task.done) {
    return;
  }

  const input = document.querySelector(
    `.reaction-message-input[data-owner="${owner}"][data-task-id="${taskId}"]`
  );
  const message = normalizeReactionMessage(input ? input.value : "");
  if (!message) {
    showToast("Type a reaction message first.");
    return;
  }

  const reaction = ensureReactionEntry(task, active);
  const nowIso = new Date().toISOString();
  reaction.message = message;
  reaction.sentAt = nowIso;
  task.updatedAt = nowIso;

  if (input) {
    input.value = "";
  }

  markCheckIn(active);
  saveState();
  render();
  showToast("Reaction sent.");
}

function openReactionImagePicker(button) {
  const actions = button.closest(".task-actions");
  if (!actions) {
    return;
  }

  const input = actions.querySelector(".reaction-image-input");
  if (!input) {
    return;
  }

  input.click();
}

async function handleReactionImageSelect(owner, taskId, fileInput) {
  const file = fileInput.files && fileInput.files[0];
  fileInput.value = "";

  if (!file) {
    return;
  }

  const day = getDay();
  if (day.closed) {
    showToast("This day is closed.");
    return;
  }

  const active = state.profile;
  if (owner === active) {
    return;
  }

  const task = day.users[owner].tasks.find((item) => item.id === taskId && !item.deletedAt);
  if (!task || !task.done) {
    showToast("Task must be completed first.");
    return;
  }

  if (!file.type.startsWith("image/")) {
    showToast("Only image files are supported.");
    return;
  }

  const dataUrl = await readFileAsDataUrl(file);
  if (!dataUrl) {
    showToast("Image could not be processed.");
    return;
  }

  const reaction = ensureReactionEntry(task, active);
  const nowIso = new Date().toISOString();
  reaction.image = {
    dataUrl,
    mimeType: file.type,
    sentAt: nowIso,
  };
  reaction.imageConsumedAt = null;
  reaction.sentAt = nowIso;
  task.updatedAt = nowIso;

  markCheckIn(active);
  saveState();
  render();
  showToast("Photo reaction sent.");
}

function openReactionImage(owner, taskId) {
  const day = getDay();
  const active = state.profile;
  if (owner !== active) {
    return;
  }

  const task = day.users[owner].tasks.find((item) => item.id === taskId && !item.deletedAt);
  if (!task || !task.done) {
    return;
  }

  const incomingUser = getPartner(owner);
  const incomingReaction = ensureReactionEntry(task, incomingUser);
  if (!incomingReaction.image || !incomingReaction.image.dataUrl) {
    return;
  }

  ui.reactionImage.src = incomingReaction.image.dataUrl;
  if (incomingReaction.message) {
    ui.reactionImageCaption.textContent = `${USER_META[incomingUser].name}: ${incomingReaction.message}`;
  } else {
    ui.reactionImageCaption.textContent = `${USER_META[incomingUser].name} sent a photo reaction`;
  }
  ui.reactionImageOverlay.hidden = false;
  syncModalState();

  incomingReaction.image = null;
  incomingReaction.imageConsumedAt = new Date().toISOString();
  task.updatedAt = new Date().toISOString();
  saveState();
  render();
}

function closeReactionImage() {
  if (ui.reactionImageOverlay.hidden) {
    return;
  }

  ui.reactionImageOverlay.hidden = true;
  ui.reactionImage.removeAttribute("src");
  ui.reactionImageCaption.textContent = "";
  syncModalState();
}

function ensureReactionEntry(task, userId) {
  if (!task.reactions || typeof task.reactions !== "object") {
    task.reactions = createEmptyReactions();
  }

  if (!task.reactions[userId]) {
    task.reactions[userId] = createEmptyReactionEntry();
  }

  task.reactions[userId] = normalizeReactionEntry(task.reactions[userId]);
  return task.reactions[userId];
}

function getReactionEntry(task, userId) {
  if (!task || !task.reactions || typeof task.reactions !== "object") {
    return createEmptyReactionEntry();
  }

  return normalizeReactionEntry(task.reactions[userId]);
}

function readFileAsDataUrl(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();

    reader.onload = () => {
      resolve(typeof reader.result === "string" ? reader.result : null);
    };

    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

function render() {
  const day = getDay();

  renderHeader(day);
  renderSettings();
  renderComposer(day);
  renderCalendar();
  renderTasks(day);
  renderRecap(day);
  updateCountdownChips();
}

function renderWatermarks() {
  ui.watermarkLayer.innerHTML = "";
}

function getMorningReminderTime(userId) {
  const times = state.preferences.morningReminderTimes || buildDefaultMorningReminderTimes();
  return times[userId] || DEFAULT_MORNING_REMINDER_TIME;
}

function setMorningReminderTime(userId, reminderTime) {
  if (!state.preferences.morningReminderTimes || typeof state.preferences.morningReminderTimes !== "object") {
    state.preferences.morningReminderTimes = buildDefaultMorningReminderTimes();
  }

  state.preferences.morningReminderTimes[userId] = reminderTime;
}

function renderSettings() {
  const active = state.profile;
  ui.morningReminderTimeInput.value = getMorningReminderTime(active);

  if (!isPushSupported()) {
    ui.enablePushBtn.disabled = true;
    ui.enablePushBtn.textContent = "Push Unsupported";
    ui.pushStatusText.textContent = "Push notifications are not supported on this device.";
    return;
  }

  const permission = Notification.permission;
  const linked = Boolean(pushSubscription);
  ui.enablePushBtn.disabled = false;
  ui.enablePushBtn.textContent = linked ? "Refresh Push Link" : "Enable Push";

  if (linked) {
    ui.pushStatusText.textContent = `Push linked for ${USER_META[active].name}.`;
    return;
  }

  if (permission === "denied") {
    ui.pushStatusText.textContent = "Push blocked in browser settings.";
    return;
  }

  if (permission === "granted") {
    ui.pushStatusText.textContent = "Push ready. Tap to finish linking.";
    return;
  }

  ui.pushStatusText.textContent = "Push not connected";
}

function renderHeader(day) {
  const streak = calculateCurrentStreak(state.profile);
  ui.todayDate.textContent = formatDateKey(currentDateKey);
  ui.daysOnFire.innerHTML = `<span class="days-on-fire-count">${streak}</span> days on fire!!`;
  document.body.classList.toggle("theme-siddu", state.profile === "me");
  document.body.classList.toggle("theme-sumi", state.profile === "partner");

  document.querySelectorAll(".profile-btn").forEach((button) => {
    const selected = button.dataset.profile === state.profile;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-selected", selected ? "true" : "false");
  });
}

function renderComposer(day) {
  const mine = getVisibleTasks(day.users[state.profile].tasks);
  const slotsLeft = MAX_TASKS - mine.length;
  const locked = day.closed || slotsLeft <= 0;
  ui.taskInput.placeholder = PLACEHOLDER_TEXT[state.profile];

  ui.taskInput.disabled = locked;
  ui.addTaskBtn.disabled = locked;

  ui.reminderToggle.disabled = day.closed;
  ui.taskTimeInput.disabled = day.closed || !ui.reminderToggle.checked;

  if (day.closed) {
    ui.limitHint.textContent = "Day wrapped. Fresh board tomorrow.";
    return;
  }

  if (slotsLeft <= 0) {
    ui.limitHint.textContent = "Task cap reached for today.";
    return;
  }

  ui.limitHint.textContent = `${slotsLeft} slot${slotsLeft === 1 ? "" : "s"} left`;
}

function renderCalendar() {
  const active = state.profile;
  const view = state.preferences.calendarView;
  const today = parseDateKey(currentDateKey);

  ui.calendarViewport.innerHTML = "";

  if (view === "week") {
    ui.calendarTitle.textContent = "This Week";
    ui.calendarExpandBtn.textContent = "Expand to Month";

    const weekDates = getWeekDates(today);
    ui.weekRange.textContent = `${formatMonthDay(weekDates[0])} - ${formatMonthDay(weekDates[6])}`;

    const grid = document.createElement("div");
    grid.className = "calendar-grid";

    weekDates.forEach((date) => {
      grid.appendChild(createCalendarDayCell(date, active, { showWeekday: true }));
    });

    ui.calendarViewport.appendChild(grid);
    return;
  }

  if (view === "month") {
    ui.calendarTitle.textContent = "This Month";
    ui.calendarExpandBtn.textContent = "Expand to Year";

    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    ui.weekRange.textContent = monthStart.toLocaleDateString(undefined, { month: "long", year: "numeric" });

    ui.calendarViewport.appendChild(createWeekdayHeader());

    const grid = document.createElement("div");
    grid.className = "calendar-grid";

    const gridStart = getWeekStart(monthStart);
    const gridEnd = getWeekEnd(monthEnd);

    for (let cursor = new Date(gridStart); cursor <= gridEnd; cursor = addDays(cursor, 1)) {
      const outside = cursor.getMonth() !== monthStart.getMonth();
      grid.appendChild(createCalendarDayCell(cursor, active, { outside }));
    }

    ui.calendarViewport.appendChild(grid);
    return;
  }

  ui.calendarTitle.textContent = "This Year";
  ui.calendarExpandBtn.textContent = "Back to Week";
  ui.weekRange.textContent = String(today.getFullYear());

  const yearGrid = document.createElement("div");
  yearGrid.className = "year-grid";

  for (let month = 0; month < 12; month += 1) {
    yearGrid.appendChild(createYearMonthCard(today.getFullYear(), month, active));
  }

  ui.calendarViewport.appendChild(yearGrid);
}

function createWeekdayHeader() {
  const row = document.createElement("div");
  row.className = "calendar-weekdays";

  ["M", "T", "W", "T", "F", "S", "S"].forEach((label) => {
    const span = document.createElement("span");
    span.textContent = label;
    row.appendChild(span);
  });

  return row;
}

function createYearMonthCard(year, month, activeUser) {
  const card = document.createElement("article");
  card.className = "year-month-card";

  const title = document.createElement("p");
  title.className = "year-month-title";
  title.textContent = new Date(year, month, 1).toLocaleDateString(undefined, { month: "long" });
  card.appendChild(title);

  const grid = document.createElement("div");
  grid.className = "year-month-grid";

  const monthStart = new Date(year, month, 1);
  const firstOffset = mondayIndex(monthStart);
  for (let i = 0; i < firstOffset; i += 1) {
    const gap = document.createElement("span");
    gap.className = "year-gap";
    grid.appendChild(gap);
  }

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = new Date(year, month, day);
    grid.appendChild(createCalendarDayCell(date, activeUser, { compact: true }));
  }

  card.appendChild(grid);
  return card;
}

function createCalendarDayCell(date, activeUser, options = {}) {
  const dayKey = getDateKey(date);
  const isFuture = dayKey > currentDateKey;
  const isToday = dayKey === currentDateKey;
  const status = getCompletionStatus(dayKey, activeUser, isFuture);

  const cell = document.createElement("button");
  cell.type = "button";
  cell.className = `calendar-day ${status}${isToday ? " today" : ""}${options.outside ? " outside" : ""}${options.compact ? " compact" : ""}`;

  if (isFuture) {
    cell.disabled = true;
  } else {
    cell.dataset.action = "open-day-preview";
    cell.dataset.dayKey = dayKey;
  }

  if (options.showWeekday) {
    const dow = document.createElement("span");
    dow.className = "dow";
    dow.textContent = formatWeekdayLetter(date);
    cell.appendChild(dow);
  }

  const dayNum = document.createElement("span");
  dayNum.className = "daynum";
  dayNum.textContent = String(date.getDate());
  cell.appendChild(dayNum);

  const dot = document.createElement("i");
  dot.className = "dot";
  cell.appendChild(dot);

  return cell;
}

function getCompletionStatus(dayKey, userId, isFuture) {
  if (isFuture) {
    return "future";
  }

  const day = state.days[dayKey];
  if (!day) {
    return "none";
  }

  const total = countUserTasks(day, userId);
  const done = countDoneTasks(day, userId);

  if (total === 0 || done === 0) {
    return "none";
  }

  if (done === total) {
    return "all";
  }

  return "some";
}

function renderTasks(day) {
  const active = state.profile;
  const partner = getPartner(active);

  const myTasks = getOrderedTasks(day.users[active].tasks);
  const partnerTasks = getOrderedTasks(day.users[partner].tasks);

  ui.myTasksTitle.textContent = `${USER_META[active].name}'s Tasks`;
  ui.partnerTasksTitle.textContent = `${USER_META[partner].name}'s Tasks`;
  ui.myTaskCount.textContent = `${myTasks.length}/${MAX_TASKS}`;

  const partnerDone = countDoneTasks(day, partner);
  ui.partnerSnapshot.textContent = `${partnerDone}/${partnerTasks.length} done`;

  renderTaskList(ui.myTasks, myTasks, active, day.closed);
  renderTaskList(ui.partnerTasks, partnerTasks, partner, day.closed);
}

function renderTaskList(root, tasks, owner, dayClosed) {
  root.innerHTML = "";

  if (!tasks.length) {
    const empty = document.createElement("li");
    empty.className = "empty-state";
    empty.textContent = owner === state.profile ? "Nothing added yet." : "No tasks added yet.";
    root.appendChild(empty);
    return;
  }

  tasks.forEach((task) => {
    const item = document.createElement("li");
    item.className = `task-item ${task.done ? "done" : ""}`;
    item.dataset.owner = owner;
    item.dataset.person = owner === "me" ? "siddu" : "sumi";

    const shell = document.createElement("div");
    shell.className = "task-shell";

    if (owner === state.profile && !dayClosed) {
      item.classList.add("swipe-item");
      item.dataset.taskId = task.id;

      const swipeBg = document.createElement("div");
      swipeBg.className = "swipe-bg";

      const swipeX = document.createElement("span");
      swipeX.className = "swipe-x";
      swipeX.textContent = "✕";

      swipeBg.appendChild(swipeX);
      item.appendChild(swipeBg);
    }

    if (item.classList.contains("swipe-item")) {
      shell.classList.add("swipe-content");
    }

    const main = document.createElement("div");
    main.className = "task-main";

    const left = document.createElement("div");
    left.className = "task-left";

    const text = document.createElement("p");
    text.className = "task-text";
    text.textContent = task.text;

    left.appendChild(text);

    const meta = document.createElement("div");
    meta.className = "task-meta";

    if (task.reminderTime) {
      const time = document.createElement("span");
      time.className = "time-chip";
      time.textContent = `Due ${formatTime12(task.reminderTime)}`;
      meta.appendChild(time);

      if (!task.done) {
        const countdown = document.createElement("span");
        countdown.className = "countdown-chip ticking";
        countdown.dataset.dateKey = currentDateKey;
        countdown.dataset.time = task.reminderTime;
        countdown.textContent = "Counting down";
        meta.appendChild(countdown);
      }
    }

    const incomingReaction = getReactionEntry(task, getPartner(owner));
    if (task.done && owner === state.profile) {
      if (incomingReaction.message) {
        const reaction = document.createElement("span");
        reaction.className = "task-reaction";
        reaction.textContent = `${USER_META[getPartner(owner)].name}: ${incomingReaction.message}`;
        meta.appendChild(reaction);
      }

      if (incomingReaction.image && incomingReaction.image.dataUrl) {
        const viewPhoto = document.createElement("button");
        viewPhoto.type = "button";
        viewPhoto.className = "reaction-view-btn";
        viewPhoto.dataset.action = "view-reaction-image";
        viewPhoto.dataset.owner = owner;
        viewPhoto.dataset.taskId = task.id;
        viewPhoto.textContent = "View photo";
        meta.appendChild(viewPhoto);
      }
    }

    if (meta.children.length) {
      left.appendChild(meta);
    }

    main.appendChild(left);

    const actions = document.createElement("div");
    actions.className = "task-actions";

    if (owner === state.profile) {
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = `complete-btn ${task.done ? "done" : ""}`;
      toggle.dataset.action = "toggle-task";
      toggle.dataset.owner = owner;
      toggle.dataset.taskId = task.id;
      toggle.textContent = task.done ? "Completed" : "Mark done";
      toggle.disabled = dayClosed;
      actions.appendChild(toggle);
    } else if (task.done) {
      const myReaction = getReactionEntry(task, state.profile);

      const input = document.createElement("input");
      input.type = "text";
      input.className = "reaction-message-input";
      input.maxLength = MAX_REACTION_MESSAGE_CHARS;
      input.placeholder = "Type your reaction and press done";
      input.setAttribute("enterkeyhint", "done");
      input.dataset.owner = owner;
      input.dataset.taskId = task.id;
      input.disabled = dayClosed;
      actions.appendChild(input);

      const photoWrap = document.createElement("span");
      photoWrap.className = "reaction-photo-wrap";

      const photo = document.createElement("button");
      photo.type = "button";
      photo.className = "reaction-btn reaction-camera-btn";
      photo.dataset.action = "open-reaction-image-picker";
      photo.dataset.owner = owner;
      photo.dataset.taskId = task.id;
      photo.setAttribute("aria-label", "Send photo reaction");
      photo.title = "Send photo reaction";
      photo.disabled = dayClosed;

      const cameraIcon = document.createElement("span");
      cameraIcon.className = "camera-icon";
      cameraIcon.setAttribute("aria-hidden", "true");
      photo.appendChild(cameraIcon);

      photoWrap.appendChild(photo);

      const imageInput = document.createElement("input");
      imageInput.type = "file";
      imageInput.accept = "image/*";
      imageInput.className = "reaction-image-input";
      imageInput.disabled = dayClosed;
      imageInput.addEventListener("change", () => {
        void handleReactionImageSelect(owner, task.id, imageInput);
      });
      photoWrap.appendChild(imageInput);
      actions.appendChild(photoWrap);

      if (myReaction.message) {
        const sentLabel = document.createElement("span");
        sentLabel.className = "reaction-note";
        sentLabel.textContent = "Message sent";
        actions.appendChild(sentLabel);
      }

      if (myReaction.image) {
        const sentPhoto = document.createElement("span");
        sentPhoto.className = "reaction-note";
        sentPhoto.textContent = "Photo attached";
        actions.appendChild(sentPhoto);
      }
    }

    shell.appendChild(main);
    shell.appendChild(actions);
    item.appendChild(shell);
    root.appendChild(item);
  });
}

function renderRecap(day) {
  const active = state.profile;
  const partner = getPartner(active);

  const activeDone = countDoneTasks(day, active);
  const activeTotal = countUserTasks(day, active);
  const partnerDone = countDoneTasks(day, partner);
  const partnerTotal = countUserTasks(day, partner);

  ui.recapGrid.innerHTML = "";
  ui.recapGrid.appendChild(createRecapBox(USER_META[active].name, `${activeDone}/${activeTotal}`));
  ui.recapGrid.appendChild(createRecapBox(USER_META[partner].name, `${partnerDone}/${partnerTotal}`));

  const latestClosedDay = findLatestClosedDay(currentDateKey);
  if (latestClosedDay) {
    const done = countDoneTasks(latestClosedDay, active);
    const messageDay = formatDateKey(latestClosedDay.dateKey);
    ui.dailyMessage.textContent = `${messageDay}: you did ${done} task${done === 1 ? "" : "s"}. You're doing great!`;
  } else {
    ui.dailyMessage.textContent = "";
  }

  const weekStats = getWeekStats(active, currentDateKey, true);
  ui.weekMessage.textContent = `This week so far: ${USER_META[active].name} completed ${weekStats.totalDone} task${weekStats.totalDone === 1 ? "" : "s"}.`;
}

function createRecapBox(title, value) {
  const box = document.createElement("article");
  box.className = "recap-box";

  const label = document.createElement("h3");
  label.textContent = title;

  const text = document.createElement("p");
  text.textContent = value;

  box.appendChild(label);
  box.appendChild(text);
  return box;
}

function openDayPreview(dayKey) {
  if (!dayKey || dayKey > currentDateKey) {
    return;
  }

  const day = state.days[dayKey] || createDay(dayKey);

  ui.previewDate.textContent = formatDateKey(dayKey);
  ui.previewBody.innerHTML = "";

  USERS.forEach((userId) => {
    ui.previewBody.appendChild(createPreviewSection(day, userId));
  });

  ui.previewOverlay.hidden = false;
  syncModalState();
}

function createPreviewSection(day, userId) {
  const section = document.createElement("section");
  section.className = "preview-section";

  const tasks = getVisibleTasks(day.users[userId].tasks);
  const done = tasks.filter((task) => task.done);

  const title = document.createElement("h3");
  title.textContent = USER_META[userId].name;

  const summary = document.createElement("p");
  summary.className = "preview-summary";
  summary.textContent = `${done.length}/${tasks.length} completed`;

  section.appendChild(title);
  section.appendChild(summary);

  if (!tasks.length) {
    const empty = document.createElement("p");
    empty.className = "preview-summary";
    empty.textContent = "No tasks logged.";
    section.appendChild(empty);
    return section;
  }

  const list = document.createElement("ul");
  list.className = "preview-list";

  tasks.forEach((task) => {
    const item = document.createElement("li");
    item.className = task.done ? "done" : "pending";

    let text = `${task.done ? "Done" : "Pending"}: ${task.text}`;
    if (task.reminderTime) {
      text += ` (${formatTime12(task.reminderTime)})`;
    }

    item.textContent = text;
    list.appendChild(item);
  });

  section.appendChild(list);
  return section;
}

function closeDayPreview() {
  if (ui.previewOverlay.hidden) {
    return;
  }

  ui.previewOverlay.hidden = true;
  syncModalState();
}

function openSettingsModal() {
  renderSettings();
  ui.settingsOverlay.hidden = false;
  syncModalState();
}

function closeSettingsModal() {
  if (ui.settingsOverlay.hidden) {
    return;
  }

  ui.settingsOverlay.hidden = true;
  syncModalState();
}

async function saveSettingsFromModal() {
  const reminderTime = normalizeReminderTime(ui.morningReminderTimeInput.value);
  if (!reminderTime) {
    showToast("Pick a valid morning reminder time.");
    return;
  }

  setMorningReminderTime(state.profile, reminderTime);
  saveState();
  closeSettingsModal();
  showToast(`Morning reminder set for ${formatTime12(reminderTime)}.`);

  if (pushSubscription) {
    await syncPushSubscription({ allowSubscribe: false });
  }
}

function openStatsModal() {
  renderStatsModal();
  ui.statsOverlay.hidden = false;
  syncModalState();
}

function closeStatsModal() {
  if (ui.statsOverlay.hidden) {
    return;
  }

  ui.statsOverlay.hidden = true;
  syncModalState();
}

function syncModalState() {
  const anyModalVisible = !ui.previewOverlay.hidden
    || !ui.statsOverlay.hidden
    || !ui.settingsOverlay.hidden
    || !ui.reactionImageOverlay.hidden;
  document.body.classList.toggle("modal-open", anyModalVisible);
}

function renderStatsModal() {
  const active = state.profile;
  const weekDates = getWeekDates(parseDateKey(currentDateKey));
  const weekDays = weekDates
    .map((date) => state.days[getDateKey(date)])
    .filter(Boolean);

  let weekAdded = 0;
  let weekDone = 0;
  let timedTasks = 0;
  let timedOnTime = 0;
  let topDay = null;

  const completedMap = new Map();
  const postponedMap = new Map();

  weekDays.forEach((day) => {
    const dayTasks = getVisibleTasks(day.users[active].tasks);
    const doneTasks = dayTasks.filter((task) => task.done);
    const pendingTasks = dayTasks.filter((task) => !task.done);
    const doneCount = doneTasks.length;

    weekAdded += dayTasks.length;
    weekDone += doneCount;

    if (!topDay || doneCount > topDay.doneCount) {
      topDay = { dateKey: day.dateKey, doneCount };
    }

    doneTasks.forEach((task) => {
      trackTaskCounter(completedMap, task.text);

      if (task.reminderTime) {
        timedTasks += 1;
        if (task.doneAt && wasTaskDoneOnTime(task, day.dateKey)) {
          timedOnTime += 1;
        }
      }
    });

    pendingTasks.forEach((task) => {
      if (!day.closed) {
        return;
      }

      trackTaskCounter(postponedMap, task.text);
    });
  });

  const completionRate = weekAdded ? Math.round((weekDone / weekAdded) * 100) : 0;
  const favoriteTask = pickTopEntry(completedMap);
  const postponedTask = pickTopEntry(postponedMap);
  const timerReliability = timedTasks ? Math.round((timedOnTime / timedTasks) * 100) : null;

  const rows = [
    { title: "Tasks Finished This Week", value: `${weekDone} completed out of ${weekAdded}` },
    { title: "Completion Rate", value: `${completionRate}%` },
    { title: "Favorite Task", value: favoriteTask ? `${favoriteTask.label} (${favoriteTask.count} times)` : "Not enough data yet" },
    { title: "Most Postponed Task", value: postponedTask ? `${postponedTask.label} (${postponedTask.count} times)` : "Nothing repeatedly postponed" },
    { title: "Timer Reliability", value: timerReliability === null ? "No timed tasks yet" : `${timerReliability}% completed on time` },
    {
      title: "Best Day",
      value: topDay && topDay.doneCount > 0 ? `${formatDateKey(topDay.dateKey)} with ${topDay.doneCount} completions` : "No completed tasks yet",
    },
  ];

  ui.statsBody.innerHTML = "";
  rows.forEach((row) => {
    const card = document.createElement("article");
    card.className = "stats-row";
    card.innerHTML = `<h3>${row.title}</h3><p>${row.value}</p>`;
    ui.statsBody.appendChild(card);
  });
}

function findLatestClosedDay(beforeDateKey) {
  const key = Object.keys(state.days)
    .filter((dateKey) => dateKey < beforeDateKey && state.days[dateKey].closed)
    .sort()
    .pop();

  return key ? state.days[key] : null;
}

function countDoneTasks(day, userId) {
  return getVisibleTasks(day.users[userId].tasks).filter((task) => task.done).length;
}

function countUserTasks(day, userId) {
  return getVisibleTasks(day.users[userId].tasks).length;
}

function getVisibleTasks(tasks) {
  return tasks.filter((task) => !task.deletedAt);
}

function didCompleteAllTasks(day, userId) {
  if (!day || !day.closed) {
    return false;
  }

  const total = countUserTasks(day, userId);
  if (total === 0) {
    return false;
  }

  return countDoneTasks(day, userId) === total;
}

function getOrderedTasks(tasks) {
  return getVisibleTasks(tasks)
    .map((task, index) => ({ task, index }))
    .sort((a, b) => {
      const aTimed = Boolean(a.task.reminderTime);
      const bTimed = Boolean(b.task.reminderTime);

      if (aTimed && bTimed) {
        const diff = toMinutes(a.task.reminderTime) - toMinutes(b.task.reminderTime);
        if (diff !== 0) {
          return diff;
        }
      }

      if (aTimed !== bTimed) {
        return aTimed ? -1 : 1;
      }

      return a.index - b.index;
    })
    .map((entry) => entry.task);
}

function calculateCurrentStreak(userId) {
  let streak = 0;
  let cursor = parseDateKey(currentDateKey);
  const today = state.days[currentDateKey];

  if (!today || !today.closed) {
    cursor = addDays(cursor, -1);
  }

  while (true) {
    const dateKey = getDateKey(cursor);
    const day = state.days[dateKey];

    if (!didCompleteAllTasks(day, userId)) {
      break;
    }

    streak += 1;
    cursor = addDays(cursor, -1);
  }

  return streak;
}

function getWeekStats(userId, anchorDateKey, onlyThroughAnchor) {
  const anchorDate = parseDateKey(anchorDateKey);
  const weekDates = getWeekDates(anchorDate);
  let totalDone = 0;

  weekDates.forEach((date) => {
    const dayKey = getDateKey(date);

    if (onlyThroughAnchor && dayKey > anchorDateKey) {
      return;
    }

    const day = state.days[dayKey];
    if (!day) {
      return;
    }

    totalDone += countDoneTasks(day, userId);
  });

  return { totalDone };
}

function normalizeTaskText(text) {
  return cleanText(text).toLowerCase();
}

function trackTaskCounter(counterMap, text) {
  const key = normalizeTaskText(text);
  if (!key) {
    return;
  }

  const existing = counterMap.get(key);
  if (existing) {
    existing.count += 1;
    return;
  }

  counterMap.set(key, { label: cleanText(text), count: 1 });
}

function pickTopEntry(counterMap) {
  let top = null;

  counterMap.forEach((entry) => {
    if (!top || entry.count > top.count) {
      top = entry;
    }
  });

  return top;
}

function wasTaskDoneOnTime(task, dayKey) {
  if (!task.doneAt || !task.reminderTime) {
    return false;
  }

  const due = parseDayTime(dayKey, task.reminderTime);
  return new Date(task.doneAt).getTime() <= due.getTime();
}

function markCheckIn(userId) {
  const day = getDay();
  if (!day.users[userId].checkedInAt) {
    day.users[userId].checkedInAt = new Date().toISOString();
  }
}

function onSwipePointerDown(event) {
  if (event.pointerType === "mouse" && event.button !== 0) {
    return;
  }

  if (event.pointerType === "touch") {
    return;
  }

  if (event.target.closest("button")) {
    return;
  }

  const swipeContent = getSwipeContentFromTarget(event.target);
  if (!swipeContent) {
    return;
  }

  startSwipeGesture(event.pointerId, event.clientX, event.clientY, swipeContent, "pointer");

  if (swipeContent.setPointerCapture) {
    swipeContent.setPointerCapture(event.pointerId);
  }
}

function onSwipePointerMove(event) {
  if (!swipeState || swipeState.pointerId !== event.pointerId || swipeState.inputType !== "pointer") {
    return;
  }

  const shouldPreventDefault = updateSwipeGesture(event.clientX, event.clientY);
  if (shouldPreventDefault) {
    event.preventDefault();
  }
}

function onSwipePointerUp(event) {
  if (!swipeState || swipeState.pointerId !== event.pointerId || swipeState.inputType !== "pointer") {
    return;
  }

  completeSwipeGesture();
}

function onSwipeTouchStart(event) {
  if (event.touches.length !== 1) {
    return;
  }

  if (event.target.closest("button")) {
    return;
  }

  const swipeContent = getSwipeContentFromTarget(event.target);
  if (!swipeContent) {
    return;
  }

  const touch = event.touches[0];
  startSwipeGesture(touch.identifier, touch.clientX, touch.clientY, swipeContent, "touch");
}

function onSwipeTouchMove(event) {
  if (!swipeState || swipeState.inputType !== "touch") {
    return;
  }

  const touch = getTouchById(event.touches, swipeState.pointerId);
  if (!touch) {
    return;
  }

  const shouldPreventDefault = updateSwipeGesture(touch.clientX, touch.clientY);
  if (shouldPreventDefault) {
    event.preventDefault();
  }
}

function onSwipeTouchEnd(event) {
  if (!swipeState || swipeState.inputType !== "touch") {
    return;
  }

  const touch = getTouchById(event.changedTouches, swipeState.pointerId);
  if (!touch) {
    return;
  }

  completeSwipeGesture();
}

function onSwipeTouchCancel() {
  if (!swipeState || swipeState.inputType !== "touch") {
    return;
  }

  resetSwipeState();
}

function getSwipeContentFromTarget(target) {
  const swipeContent = target.closest(".swipe-content");
  if (!swipeContent) {
    return null;
  }

  const item = swipeContent.closest(".swipe-item");
  return item ? swipeContent : null;
}

function getTouchById(touchList, id) {
  for (let i = 0; i < touchList.length; i += 1) {
    if (touchList[i].identifier === id) {
      return touchList[i];
    }
  }

  return null;
}

function startSwipeGesture(pointerId, startX, startY, swipeContent, inputType) {
  const item = swipeContent.closest(".swipe-item");
  if (!item) {
    return;
  }

  swipeState = {
    pointerId,
    inputType,
    startX,
    startY,
    currentX: 0,
    started: false,
    dragged: false,
    item,
    content: swipeContent,
  };
}

function updateSwipeGesture(clientX, clientY) {
  if (!swipeState) {
    return false;
  }

  const dx = clientX - swipeState.startX;
  const dy = clientY - swipeState.startY;

  if (!swipeState.started) {
    if (Math.abs(dx) < 7) {
      return false;
    }

    if (Math.abs(dy) > Math.abs(dx)) {
      resetSwipeState();
      return false;
    }

    swipeState.started = true;
    swipeState.item.classList.add("swiping");
  }

  swipeState.dragged = true;

  if (dx > 0) {
    setSwipeVisual(0);
    return true;
  }

  const clamped = Math.max(dx, -SWIPE_MAX);
  setSwipeVisual(clamped);
  return true;
}

function completeSwipeGesture() {
  if (!swipeState) {
    return;
  }

  const { item, content, currentX, dragged } = swipeState;

  if (dragged) {
    suppressTaskClickUntil = Date.now() + 240;
  }

  const shouldDelete = Math.abs(currentX) >= SWIPE_DELETE_THRESHOLD;

  if (shouldDelete) {
    content.style.transform = `translateX(-${SWIPE_MAX}px)`;
    item.classList.add("deleting");

    const owner = item.dataset.owner;
    const taskId = item.dataset.taskId;

    swipeState = null;
    setTimeout(() => {
      deleteTask(owner, taskId);
    }, 120);
    return;
  }

  item.classList.remove("swiping", "deleting");
  item.style.removeProperty("--swipe-progress");
  content.style.transform = "";
  swipeState = null;
}

function setSwipeVisual(x) {
  if (!swipeState) {
    return;
  }

  swipeState.currentX = x;
  swipeState.content.style.transform = `translateX(${x}px)`;

  const progress = Math.min(1, Math.abs(x) / SWIPE_DELETE_THRESHOLD);
  swipeState.item.style.setProperty("--swipe-progress", progress.toFixed(3));
}

function resetSwipeState() {
  if (!swipeState) {
    return;
  }

  swipeState.item.classList.remove("swiping", "deleting");
  swipeState.item.style.removeProperty("--swipe-progress");
  swipeState.content.style.transform = "";
  swipeState = null;
}

function startDayWatcher() {
  setInterval(checkForNewDay, 30000);
}

function startReminderWatcher() {
  setInterval(checkReminderAlerts, 30000);
}

function startClientPushDispatcher() {
  if (pushDispatchTimer) {
    clearInterval(pushDispatchTimer);
  }

  pushDispatchTimer = setInterval(() => {
    if (!document.hidden) {
      void dispatchPushReminders();
    }
  }, 90000);

  void dispatchPushReminders();
}

function startCountdownTicker() {
  if (countdownTicker) {
    clearInterval(countdownTicker);
  }

  countdownTicker = setInterval(updateCountdownChips, 1000);
}

function updateCountdownChips() {
  const now = Date.now();
  document.querySelectorAll(".countdown-chip[data-date-key][data-time]").forEach((chip) => {
    const dateKey = chip.dataset.dateKey;
    const timeValue = chip.dataset.time;
    if (!dateKey || !timeValue) {
      return;
    }

    const target = parseDayTime(dateKey, timeValue).getTime();
    const diffSeconds = Math.floor((target - now) / 1000);

    chip.classList.remove("late");

    if (diffSeconds >= 0) {
      chip.classList.add("ticking");
      chip.textContent = `${formatDuration(diffSeconds)} left`;
      return;
    }

    chip.classList.remove("ticking");
    chip.classList.add("late");
    chip.textContent = `Late by ${formatDuration(Math.abs(diffSeconds))}`;
  });
}

function checkForNewDay() {
  const latest = getDateKey(new Date());

  if (latest === currentDateKey) {
    return;
  }

  leaveGuardAttempts = 0;
  const previousDateKey = currentDateKey;
  currentDateKey = latest;
  ensureDaySpace();
  render();
  closeDayPreview();
  closeStatsModal();
  closeSettingsModal();
  closeReactionImage();

  const active = state.profile;
  const previousDay = state.days[previousDateKey];
  const dailyDone = previousDay ? countDoneTasks(previousDay, active) : 0;
  const dayMessage = `${formatDateKey(previousDateKey)}: you did ${dailyDone} task${dailyDone === 1 ? "" : "s"}. You're doing great!`;

  const previousWeekStart = getDateKey(getWeekStart(parseDateKey(previousDateKey)));
  const currentWeekStart = getDateKey(getWeekStart(parseDateKey(latest)));

  if (previousWeekStart !== currentWeekStart) {
    const weekTotal = getWeekStats(active, previousDateKey, false).totalDone;
    showToastSequence([dayMessage, `Last week total: ${weekTotal} tasks completed.`]);
    return;
  }

  showToast(dayMessage);
}

function checkReminderAlerts() {
  const day = getDay();

  if (!day || day.closed) {
    return;
  }

  const active = state.profile;
  const userDay = day.users[active];
  const tasks = getVisibleTasks(day.users[active].tasks);
  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  let changed = false;

  const morningReminderTime = getMorningReminderTime(active);
  if (userDay.lastMorningReminderDate !== currentDateKey) {
    const morningReminderMinutes = toMinutes(morningReminderTime);
    if (nowMinutes >= morningReminderMinutes) {
      userDay.lastMorningReminderDate = currentDateKey;
      changed = true;
      notifyMorningReminder(active, morningReminderTime);
    }
  }

  tasks.forEach((task) => {
    if (!task.reminderTime || task.done) {
      return;
    }

    if (task.lastReminderDate === currentDateKey) {
      return;
    }

    const taskReminderMinutes = toMinutes(task.reminderTime) - TASK_REMINDER_LEAD_MINUTES;
    if (taskReminderMinutes < 0 || taskReminderMinutes > nowMinutes) {
      return;
    }

    task.lastReminderDate = currentDateKey;
    changed = true;
    notifyTaskReminder(task, active);
  });

  if (changed) {
    saveState({ sync: false });
  }
}

function notifyMorningReminder(userId, reminderTime) {
  const timeText = formatTime12(reminderTime);
  showToast(`${timeText}: add your tasks for today.`);

  if (!shouldUseLocalNotificationFallback()) {
    return;
  }

  new Notification(`${USER_META[userId].name} morning reminder`, {
    body: `${timeText} - write your daily tasks.`,
    tag: `${currentDateKey}-${userId}-morning`,
  });
}

function notifyTaskReminder(task, userId) {
  const timeText = formatTime12(task.reminderTime);
  showToast(`${timeText} is coming up: ${task.text}`);

  if (!shouldUseLocalNotificationFallback()) {
    return;
  }

  new Notification(`${USER_META[userId].name} reminder`, {
    body: `Start ${task.text} in ${TASK_REMINDER_LEAD_MINUTES} minutes. Good luck.`,
    tag: `${currentDateKey}-${task.id}`,
  });
}

function shouldUseLocalNotificationFallback() {
  return "Notification" in window && Notification.permission === "granted" && !pushSubscription;
}

function showToastSequence(messages) {
  const valid = messages.filter(Boolean);
  if (!valid.length) {
    return;
  }

  showToast(valid[0]);

  if (valid.length > 1) {
    setTimeout(() => showToastSequence(valid.slice(1)), 1850);
  }
}

function showSyncUnavailableToast() {
  if (hasShownSyncUnavailableToast) {
    return;
  }

  hasShownSyncUnavailableToast = true;
  showToast("Cloud sync is not configured yet.");
}

function showToast(message) {
  if (!message) {
    return;
  }

  ui.toast.textContent = message;
  ui.toast.classList.add("show");

  if (toastTimer) {
    clearTimeout(toastTimer);
  }

  toastTimer = setTimeout(() => {
    ui.toast.classList.remove("show");
  }, 1650);
}

function handleBeforeUnload(event) {
  if (!shouldBlockLeaveAttempt()) {
    return undefined;
  }

  const message = LEAVE_GUARD_MESSAGES[Math.min(leaveGuardAttempts, LEAVE_GUARD_MESSAGES.length - 1)];
  leaveGuardAttempts += 1;

  setTimeout(() => {
    if (!document.hidden) {
      showToast(message);
    }
  }, 50);

  event.preventDefault();
  event.returnValue = message;
  return message;
}

function shouldBlockLeaveAttempt() {
  const day = getDay();
  if (!day || day.closed) {
    return false;
  }

  if (countUserTasks(day, state.profile) > 0) {
    return false;
  }

  return leaveGuardAttempts < LEAVE_GUARD_MESSAGES.length;
}

function buildDefaultReminderTime() {
  const now = new Date();
  const rounded = new Date(now.getTime() + 60 * 60000);
  rounded.setMinutes(0, 0, 0);
  const hh = String(rounded.getHours()).padStart(2, "0");
  const mm = String(rounded.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function cleanText(value) {
  return String(value).replace(/\s+/g, " ").trim();
}

function makeId() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return window.crypto.randomUUID();
  }

  return `id-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

function toMinutes(timeString) {
  const [hour, minute] = timeString.split(":").map(Number);
  return hour * 60 + minute;
}

function formatTime12(timeString) {
  const [hour, minute] = timeString.split(":").map(Number);
  const date = new Date();
  date.setHours(hour, minute, 0, 0);

  return date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

function parseDayTime(dateKey, timeString) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const [hour, minute] = timeString.split(":").map(Number);
  return new Date(year, month - 1, day, hour, minute, 0, 0);
}

function formatDuration(totalSeconds) {
  const safe = Math.max(0, totalSeconds);
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;

  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  }

  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

function getDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDateKey(dateKey) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function formatDateKey(dateKey) {
  const localDate = parseDateKey(dateKey);

  return localDate.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function formatMonthDay(date) {
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatWeekdayLetter(date) {
  return date.toLocaleDateString(undefined, { weekday: "short" }).slice(0, 1);
}

function getWeekDates(anchorDate) {
  const start = getWeekStart(anchorDate);
  const dates = [];

  for (let i = 0; i < 7; i += 1) {
    dates.push(addDays(start, i));
  }

  return dates;
}

function getWeekStart(date) {
  const copy = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = copy.getDay();
  const offset = day === 0 ? -6 : 1 - day;
  copy.setDate(copy.getDate() + offset);
  return copy;
}

function getWeekEnd(date) {
  const start = getWeekStart(date);
  return addDays(start, 6);
}

function mondayIndex(date) {
  const day = date.getDay();
  return day === 0 ? 6 : day - 1;
}

function addDays(date, days) {
  const copy = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  copy.setDate(copy.getDate() + days);
  return copy;
}

function startRemoteSyncWatcher() {
  if (remotePollTimer) {
    clearInterval(remotePollTimer);
  }

  remotePollTimer = setInterval(() => {
    pullRemoteState();

    if (remoteDirty) {
      scheduleRemoteSync(REMOTE_PUSH_DEBOUNCE_MS);
    }
  }, REMOTE_POLL_MS);
}

async function bootstrapRemoteState() {
  const remotePayload = await fetchRemoteState();
  const remoteDays = getRemoteDaysPayload(remotePayload);
  const remoteSettings = getRemoteSettingsPayload(remotePayload);
  const hasRemoteDays = remoteDays && Object.keys(remoteDays).length > 0;
  const hasRemoteSettings = Boolean(remoteSettings);

  if (hasRemoteDays || hasRemoteSettings) {
    applyRemotePayload(remotePayload);
    return;
  }

  if (Object.keys(state.days).length > 0) {
    remoteDirty = true;
    await syncWithServerNow({ force: true });
  }
}

function queueRemoteSync() {
  remoteDirty = true;
  scheduleRemoteSync(REMOTE_PUSH_DEBOUNCE_MS);
}

function scheduleRemoteSync(delayMs) {
  if (remotePushTimer) {
    clearTimeout(remotePushTimer);
  }

  remotePushTimer = setTimeout(() => {
    remotePushTimer = null;
    syncWithServerNow();
  }, delayMs);
}

async function syncWithServerNow(options = {}) {
  const force = options.force === true;
  const dirtyBeforeAttempt = remoteDirty;

  if (!force && !remoteDirty) {
    return;
  }

  if (remoteSyncInFlight) {
    remoteDirty = true;
    return;
  }

  remoteSyncInFlight = true;

  try {
    const response = await fetch(API_STATE_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      cache: "no-store",
      body: JSON.stringify({
        days: state.days,
        settings: {
          morningReminderTimes: state.preferences.morningReminderTimes,
        },
      }),
    });

    if (!response.ok) {
      if (response.status === 503) {
        showSyncUnavailableToast();
      }
      throw new Error("sync-failed");
    }

    const payload = await response.json();
    applyRemotePayload(payload);
    remoteDirty = false;
  } catch (_error) {
    remoteDirty = dirtyBeforeAttempt || !force;
  } finally {
    remoteSyncInFlight = false;

    if (remoteDirty && !remotePushTimer) {
      scheduleRemoteSync(2600);
    }
  }
}

async function pullRemoteState(options = {}) {
  const force = options.force === true;

  if (!force && (remoteSyncInFlight || remoteDirty)) {
    return;
  }

  try {
    const payload = await fetchRemoteState();
    applyRemotePayload(payload);
  } catch (_error) {
    // Keep local mode running if the sync server is unreachable.
  }
}

function applyRemotePayload(payload) {
  const remoteDays = getRemoteDaysPayload(payload);
  if (!remoteDays) {
    return;
  }

  const normalizedDays = normalizeDaysMap(remoteDays);
  const remoteReminderTimes = getRemoteSettingsPayload(payload);
  const normalizedReminderTimes = remoteReminderTimes
    ? normalizeMorningReminderTimes(remoteReminderTimes)
    : null;

  const daysChanged = !areDayMapsEqual(state.days, normalizedDays);
  const settingsChanged = normalizedReminderTimes
    ? !areReminderTimeMapsEqual(state.preferences.morningReminderTimes, normalizedReminderTimes)
    : false;

  if (!daysChanged && !settingsChanged) {
    return;
  }

  if (daysChanged) {
    state.days = normalizedDays;
  }

  if (settingsChanged) {
    state.preferences.morningReminderTimes = normalizedReminderTimes;
  }

  const daySpaceChanged = ensureDaySpace({ sync: false });
  persistLocalState(JSON.parse(JSON.stringify(state)));

  render();
  updateCountdownChips();
  checkReminderAlerts();
  void syncPushSubscription({ allowSubscribe: false });

  if (daySpaceChanged) {
    queueRemoteSync();
  }
}

async function fetchRemoteState() {
  try {
    const response = await fetch(API_STATE_ENDPOINT, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
    });

    if (!response.ok) {
      if (response.status === 503) {
        showSyncUnavailableToast();
      }
      return null;
    }

    return await response.json();
  } catch (_error) {
    return null;
  }
}

function getRemoteDaysPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }

  if (Object.prototype.hasOwnProperty.call(payload, "days")) {
    if (!payload.days || typeof payload.days !== "object" || Array.isArray(payload.days)) {
      return {};
    }

    return payload.days;
  }

  return payload;
}

function getRemoteSettingsPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }

  if (!payload.settings || typeof payload.settings !== "object") {
    return null;
  }

  if (!payload.settings.morningReminderTimes || typeof payload.settings.morningReminderTimes !== "object") {
    return null;
  }

  return payload.settings.morningReminderTimes;
}

function normalizeDaysMap(value) {
  const normalized = {};

  if (!value || typeof value !== "object") {
    return normalized;
  }

  Object.keys(value).forEach((dateKey) => {
    normalized[dateKey] = normalizeDay(value[dateKey], dateKey);
  });

  return normalized;
}

function areDayMapsEqual(a, b) {
  return serializeDays(a) === serializeDays(b);
}

function areReminderTimeMapsEqual(a, b) {
  const left = normalizeMorningReminderTimes(a);
  const right = normalizeMorningReminderTimes(b);
  return JSON.stringify(left) === JSON.stringify(right);
}

function serializeDays(days) {
  const ordered = {};
  Object.keys(days)
    .sort()
    .forEach((dateKey) => {
      ordered[dateKey] = days[dateKey];
    });

  return JSON.stringify(ordered);
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return null;
  }

  try {
    const registration = await navigator.serviceWorker.register("./service-worker.js");
    await navigator.serviceWorker.ready;
    return registration;
  } catch (_error) {
    return null;
  }
}

function isPushSupported() {
  return "Notification" in window && "serviceWorker" in navigator && "PushManager" in window;
}

async function enablePushNotifications() {
  if (!isPushSupported()) {
    showToast("Push notifications are not supported on this device.");
    renderSettings();
    return;
  }

  if (!swRegistration) {
    swRegistration = await registerServiceWorker();
  }

  if (!swRegistration) {
    showToast("Service worker is not ready yet.");
    renderSettings();
    return;
  }

  let permission = Notification.permission;
  if (permission !== "granted") {
    permission = await Notification.requestPermission();
  }

  if (permission !== "granted") {
    showToast("Push permission was not granted.");
    renderSettings();
    return;
  }

  await syncPushSubscription({ allowSubscribe: true });

  if (pushSubscription) {
    showToast("Push notifications enabled.");
  }
}

async function syncPushSubscription(options = {}) {
  if (!isPushSupported() || !swRegistration) {
    pushSubscription = null;
    renderSettings();
    return null;
  }

  const allowSubscribe = options.allowSubscribe === true;
  let subscription = await swRegistration.pushManager.getSubscription();

  if (!subscription && allowSubscribe && Notification.permission === "granted") {
    subscription = await ensurePushSubscription();
  }

  pushSubscription = subscription || null;

  if (pushSubscription) {
    await sendPushSubscriptionToServer(pushSubscription);
  }

  renderSettings();
  return pushSubscription;
}

async function ensurePushSubscription() {
  const publicKey = await fetchPushPublicKey();
  if (!publicKey) {
    return null;
  }

  try {
    return await swRegistration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
  } catch (_error) {
    showToast("Unable to create push subscription.");
    return null;
  }
}

async function fetchPushPublicKey() {
  try {
    const response = await fetch(API_PUSH_PUBLIC_KEY_ENDPOINT, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
    });

    if (!response.ok) {
      return null;
    }

    const payload = await response.json();
    return typeof payload.publicKey === "string" ? payload.publicKey : null;
  } catch (_error) {
    return null;
  }
}

async function sendPushSubscriptionToServer(subscription) {
  try {
    const response = await fetch(API_PUSH_SUBSCRIBE_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      cache: "no-store",
      body: JSON.stringify({
        userId: state.profile,
        morningReminderTime: getMorningReminderTime(state.profile),
        timeZone: getBrowserTimeZone(),
        subscription: subscription.toJSON ? subscription.toJSON() : subscription,
      }),
    });

    if (!response.ok) {
      const errorPayload = await safeReadJson(response);
      if (errorPayload && typeof errorPayload.error === "string") {
        showToast(errorPayload.error);
      }
    }
  } catch (_error) {
    showToast("Unable to sync push settings.");
  }
}

async function dispatchPushReminders() {
  try {
    await fetch(API_PUSH_DISPATCH_ENDPOINT, {
      method: "GET",
      headers: {
        "x-client-dispatch": "1",
      },
      cache: "no-store",
    });
  } catch (_error) {
    // Keep the app responsive if dispatch is unavailable.
  }
}

async function safeReadJson(response) {
  try {
    return await response.json();
  } catch (_error) {
    return null;
  }
}

function getBrowserTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch (_error) {
    return "UTC";
  }
}

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = `${base64String}${padding}`
    .replace(/-/g, "+")
    .replace(/_/g, "/");

  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i);
  }

  return outputArray;
}
