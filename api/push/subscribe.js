const {
  DEFAULT_MORNING_REMINDER_TIME,
  getPushConfig,
  loadSubscriptions,
  normalizeBody,
  normalizePushSubscription,
  normalizeReminderTime,
  normalizeTimeZone,
  normalizeUserId,
  saveSubscriptions,
  sendJson,
  serializeSubscription,
  upsertSubscription,
} = require("./_shared");

async function handler(req, res) {
  const method = String(req.method || "POST").toUpperCase();
  if (method !== "POST") {
    res.setHeader("Allow", "POST");
    sendJson(res, 405, { error: "Method not allowed" });
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

  const body = normalizeBody(req.body);
  if (!body || typeof body !== "object") {
    sendJson(res, 400, { error: "Body must be a JSON object" });
    return;
  }

  const subscription = normalizePushSubscription(body.subscription);
  if (!subscription) {
    sendJson(res, 400, { error: "Invalid push subscription payload" });
    return;
  }

  const userId = normalizeUserId(body.userId);
  const morningReminderTime = normalizeReminderTime(body.morningReminderTime) || DEFAULT_MORNING_REMINDER_TIME;
  const timeZone = normalizeTimeZone(body.timeZone);

  try {
    const list = await loadSubscriptions();
    const entry = upsertSubscription(list, {
      subscription,
      userId,
      morningReminderTime,
      timeZone,
    });

    if (!entry) {
      sendJson(res, 400, { error: "Unable to store subscription" });
      return;
    }

    await saveSubscriptions(list);

    sendJson(res, 200, {
      ok: true,
      subscription: serializeSubscription(entry),
      totalSubscriptions: list.length,
    });
  } catch (_error) {
    sendJson(res, 500, { error: "Failed to save push subscription" });
  }
}

module.exports = handler;
module.exports.default = handler;
