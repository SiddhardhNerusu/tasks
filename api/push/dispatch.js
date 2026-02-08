const { kv } = require("@vercel/kv");
const webpush = require("web-push");
const {
  DEFAULT_MORNING_REMINDER_TIME,
  STATE_KEY,
  getDateKeyInTimeZone,
  getMinutesInTimeZone,
  getPushConfig,
  loadSubscriptions,
  normalizeUserId,
  pruneTaskAlerts,
  saveSubscriptions,
  sendJson,
  toMinutes,
} = require("./_shared");

const PUSH_WINDOW_MINUTES = 5;
const TASK_LEAD_MINUTES = 10;

async function handler(req, res) {
  const method = String(req.method || "GET").toUpperCase();
  if (method !== "GET") {
    res.setHeader("Allow", "GET");
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  if (!isAuthorized(req)) {
    sendJson(res, 401, { error: "Unauthorized" });
    return;
  }

  const config = getPushConfig();
  if (!config.ready) {
    sendJson(res, 503, {
      error: "Push is not configured for this project",
      required: ["WEB_PUSH_PUBLIC_KEY", "WEB_PUSH_PRIVATE_KEY"],
    });
    return;
  }

  webpush.setVapidDetails(config.subject, config.publicKey, config.privateKey);

  try {
    const state = await kv.get(STATE_KEY);
    const days = state && typeof state === "object" && state.days && typeof state.days === "object"
      ? state.days
      : {};
    const subscriptions = await loadSubscriptions();

    let sentCount = 0;
    let removedCount = 0;
    let dirty = false;
    const now = new Date();
    const nowIso = now.toISOString();

    for (let i = 0; i < subscriptions.length; i += 1) {
      const entry = subscriptions[i];
      const dateKey = getDateKeyInTimeZone(now, entry.timeZone);
      const nowMinutes = getMinutesInTimeZone(now, entry.timeZone);
      const reminderPlans = [];

      const morningTime = entry.morningReminderTime || DEFAULT_MORNING_REMINDER_TIME;
      const morningMinutes = toMinutes(morningTime);
      const morningKey = `${dateKey}:${morningTime}`;

      if (
        shouldSendInCurrentWindow(nowMinutes, morningMinutes) &&
        entry.lastMorningKey !== morningKey
      ) {
        reminderPlans.push({
          type: "morning",
          key: morningKey,
          title: "Daily Milestones",
          body: "Write your tasks for today.",
          tag: `morning-${entry.userId}-${dateKey}`,
        });
      }

      const day = days[dateKey];
      const userId = normalizeUserId(entry.userId);
      const userTasks = day && day.users && day.users[userId] && Array.isArray(day.users[userId].tasks)
        ? day.users[userId].tasks
        : [];
      const taskAlerts = entry.taskAlerts && typeof entry.taskAlerts === "object" ? { ...entry.taskAlerts } : {};

      for (let taskIndex = 0; taskIndex < userTasks.length; taskIndex += 1) {
        const task = userTasks[taskIndex];
        if (!task || task.deletedAt || task.done || typeof task.reminderTime !== "string") {
          continue;
        }

        const alertMinutes = toMinutes(task.reminderTime) - TASK_LEAD_MINUTES;
        if (alertMinutes < 0 || !shouldSendInCurrentWindow(nowMinutes, alertMinutes)) {
          continue;
        }

        const taskId = typeof task.id === "string" ? task.id : `task-${taskIndex}`;
        const alertKey = `${dateKey}:${taskId}:${task.reminderTime}`;
        if (taskAlerts[alertKey]) {
          continue;
        }

        const safeTaskText = String(task.text || "").trim().slice(0, 80);
        reminderPlans.push({
          type: "task",
          key: alertKey,
          title: `${toDisplayName(userId)} task reminder`,
          body: `Start ${safeTaskText} in ${TASK_LEAD_MINUTES} minutes. Good luck.`,
          tag: `task-${taskId}-${dateKey}`,
        });
      }

      if (!reminderPlans.length) {
        entry.taskAlerts = pruneTaskAlerts(taskAlerts, dateKey);
        continue;
      }

      for (let planIndex = 0; planIndex < reminderPlans.length; planIndex += 1) {
        const plan = reminderPlans[planIndex];

        try {
          await webpush.sendNotification(
            {
              endpoint: entry.endpoint,
              keys: entry.keys,
            },
            JSON.stringify({
              title: plan.title,
              body: plan.body,
              tag: plan.tag,
              url: "/",
            }),
            { TTL: 120 }
          );

          sentCount += 1;
          dirty = true;

          if (plan.type === "morning") {
            entry.lastMorningKey = plan.key;
          } else {
            taskAlerts[plan.key] = nowIso;
          }
        } catch (error) {
          if (error && (error.statusCode === 404 || error.statusCode === 410)) {
            entry._expired = true;
            removedCount += 1;
            dirty = true;
            break;
          }
        }
      }

      entry.taskAlerts = pruneTaskAlerts(taskAlerts, dateKey);
      if (!entry._expired) {
        entry.updatedAt = nowIso;
      }
    }

    const activeSubscriptions = subscriptions.filter((entry) => !entry._expired);
    if (dirty) {
      await saveSubscriptions(activeSubscriptions);
    }

    sendJson(res, 200, {
      ok: true,
      sent: sentCount,
      removed: removedCount,
      activeSubscriptions: activeSubscriptions.length,
    });
  } catch (_error) {
    sendJson(res, 500, { error: "Failed to dispatch push reminders" });
  }
}

function shouldSendInCurrentWindow(nowMinutes, targetMinutes) {
  return nowMinutes >= targetMinutes && nowMinutes < targetMinutes + PUSH_WINDOW_MINUTES;
}

function toDisplayName(userId) {
  return userId === "partner" ? "Sumi" : "Siddu";
}

function isAuthorized(req) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return true;
  }

  const authHeader = req.headers.authorization || "";
  return authHeader === `Bearer ${cronSecret}`;
}

module.exports = handler;
module.exports.default = handler;
