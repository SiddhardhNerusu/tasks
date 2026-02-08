const crypto = require("crypto");
const { kv } = require("@vercel/kv");

const STATE_KEY = "our-day-shared-state-v1";
const SUBSCRIPTIONS_KEY = "our-day-push-subscriptions-v1";
const DEFAULT_MORNING_REMINDER_TIME = "09:00";
const VALID_USERS = new Set(["me", "partner"]);

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(`${JSON.stringify(payload)}\n`);
}

function normalizeBody(value) {
  if (Buffer.isBuffer(value)) {
    try {
      return JSON.parse(value.toString("utf8"));
    } catch (_error) {
      return null;
    }
  }

  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch (_error) {
      return null;
    }
  }

  return value;
}

function normalizeReminderTime(value) {
  if (typeof value !== "string") {
    return null;
  }

  return /^\d{2}:\d{2}$/.test(value) ? value : null;
}

function normalizeUserId(value) {
  return VALID_USERS.has(value) ? value : "me";
}

function normalizeTimeZone(value) {
  if (typeof value !== "string" || !value.trim()) {
    return "UTC";
  }

  try {
    return Intl.DateTimeFormat(undefined, { timeZone: value }).resolvedOptions().timeZone;
  } catch (_error) {
    return "UTC";
  }
}

function normalizePushSubscription(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const endpoint = typeof value.endpoint === "string" ? value.endpoint : "";
  const keys = value.keys && typeof value.keys === "object" ? value.keys : {};
  const p256dh = typeof keys.p256dh === "string" ? keys.p256dh : "";
  const auth = typeof keys.auth === "string" ? keys.auth : "";

  if (!endpoint || !p256dh || !auth) {
    return null;
  }

  return {
    endpoint,
    keys: { p256dh, auth },
  };
}

function normalizeStoredSubscription(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const subscription = normalizePushSubscription(value);
  if (!subscription) {
    return null;
  }

  const nowIso = new Date().toISOString();
  return {
    id: typeof value.id === "string" ? value.id : hashEndpoint(subscription.endpoint),
    endpoint: subscription.endpoint,
    keys: subscription.keys,
    userId: normalizeUserId(value.userId),
    morningReminderTime: normalizeReminderTime(value.morningReminderTime) || DEFAULT_MORNING_REMINDER_TIME,
    timeZone: normalizeTimeZone(value.timeZone),
    createdAt: typeof value.createdAt === "string" ? value.createdAt : nowIso,
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : nowIso,
    lastMorningKey: typeof value.lastMorningKey === "string" ? value.lastMorningKey : null,
    taskAlerts: normalizeTaskAlerts(value.taskAlerts),
  };
}

function normalizeTaskAlerts(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const normalized = {};
  Object.keys(value).forEach((key) => {
    if (typeof value[key] === "string" && /^\d{4}-\d{2}-\d{2}:/.test(key)) {
      normalized[key] = value[key];
    }
  });
  return normalized;
}

function hashEndpoint(endpoint) {
  return crypto.createHash("sha1").update(endpoint).digest("hex");
}

async function loadSubscriptions() {
  const stored = await kv.get(SUBSCRIPTIONS_KEY);
  if (!Array.isArray(stored)) {
    return [];
  }

  return stored
    .map((entry) => normalizeStoredSubscription(entry))
    .filter(Boolean);
}

async function saveSubscriptions(list) {
  await kv.set(SUBSCRIPTIONS_KEY, list);
}

function upsertSubscription(list, options) {
  const nowIso = new Date().toISOString();
  const cleanSub = normalizePushSubscription(options.subscription);
  if (!cleanSub) {
    return null;
  }

  const userId = normalizeUserId(options.userId);
  const morningReminderTime = normalizeReminderTime(options.morningReminderTime) || DEFAULT_MORNING_REMINDER_TIME;
  const timeZone = normalizeTimeZone(options.timeZone);

  const index = list.findIndex((entry) => entry.endpoint === cleanSub.endpoint);
  if (index >= 0) {
    const existing = normalizeStoredSubscription(list[index]);
    const updated = {
      ...existing,
      endpoint: cleanSub.endpoint,
      keys: cleanSub.keys,
      userId,
      morningReminderTime,
      timeZone,
      updatedAt: nowIso,
    };
    list[index] = updated;
    return updated;
  }

  const created = {
    id: hashEndpoint(cleanSub.endpoint),
    endpoint: cleanSub.endpoint,
    keys: cleanSub.keys,
    userId,
    morningReminderTime,
    timeZone,
    createdAt: nowIso,
    updatedAt: nowIso,
    lastMorningKey: null,
    taskAlerts: {},
  };

  list.push(created);
  return created;
}

function serializeSubscription(entry) {
  return {
    userId: entry.userId,
    morningReminderTime: entry.morningReminderTime,
    timeZone: entry.timeZone,
    updatedAt: entry.updatedAt,
  };
}

function getPushConfig() {
  const publicKey = process.env.WEB_PUSH_PUBLIC_KEY || "";
  const privateKey = process.env.WEB_PUSH_PRIVATE_KEY || "";
  const subject = process.env.WEB_PUSH_SUBJECT || "mailto:support@example.com";

  return {
    publicKey,
    privateKey,
    subject,
    ready: Boolean(publicKey && privateKey),
  };
}

function toMinutes(timeString) {
  const [hour, minute] = String(timeString).split(":").map(Number);
  return hour * 60 + minute;
}

function getDateKeyInTimeZone(date, timeZone) {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);

    const lookup = {};
    parts.forEach((part) => {
      if (part.type !== "literal") {
        lookup[part.type] = part.value;
      }
    });

    if (lookup.year && lookup.month && lookup.day) {
      return `${lookup.year}-${lookup.month}-${lookup.day}`;
    }
  } catch (_error) {
    // Fall back to UTC below.
  }

  return date.toISOString().slice(0, 10);
}

function getMinutesInTimeZone(date, timeZone) {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
    }).formatToParts(date);

    const lookup = {};
    parts.forEach((part) => {
      if (part.type !== "literal") {
        lookup[part.type] = part.value;
      }
    });

    return Number(lookup.hour || 0) * 60 + Number(lookup.minute || 0);
  } catch (_error) {
    return date.getUTCHours() * 60 + date.getUTCMinutes();
  }
}

function pruneTaskAlerts(taskAlerts, dateKey) {
  const pruned = {};
  const floor = shiftDateKey(dateKey, -2);
  Object.keys(taskAlerts || {}).forEach((key) => {
    const keyDate = key.slice(0, 10);
    if (keyDate >= floor) {
      pruned[key] = taskAlerts[key];
    }
  });
  return pruned;
}

function shiftDateKey(dateKey, deltaDays) {
  const [year, month, day] = String(dateKey).split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + deltaDays);
  return date.toISOString().slice(0, 10);
}

module.exports = {
  STATE_KEY,
  DEFAULT_MORNING_REMINDER_TIME,
  sendJson,
  normalizeBody,
  normalizeReminderTime,
  normalizeUserId,
  normalizeTimeZone,
  normalizePushSubscription,
  loadSubscriptions,
  saveSubscriptions,
  upsertSubscription,
  serializeSubscription,
  getPushConfig,
  toMinutes,
  getDateKeyInTimeZone,
  getMinutesInTimeZone,
  pruneTaskAlerts,
};
