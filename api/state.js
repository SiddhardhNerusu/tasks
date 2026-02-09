const { kv } = require("@vercel/kv");

const STATE_KEY = "our-day-shared-state-v1";
const config = {
  api: {
    bodyParser: {
      sizeLimit: "25mb",
    },
  },
};

async function handler(req, res) {
  const method = String(req.method || "GET").toUpperCase();

  if (!hasKvConfig()) {
    sendJson(res, 503, {
      error: "KV is not configured for this project",
      required: [
        "KV_REST_API_URL + KV_REST_API_TOKEN",
        "or UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN",
      ],
    });
    return;
  }

  try {
    if (method === "GET") {
      const state = await kv.get(STATE_KEY);
      sendJson(res, 200, isPlainObject(state) ? state : {});
      return;
    }

    if (method === "POST") {
      const payload = normalizeBody(req.body);
      if (!isPlainObject(payload)) {
        sendJson(res, 400, { error: "Body must be a JSON object" });
        return;
      }

      await kv.set(STATE_KEY, payload);
      sendJson(res, 200, payload);
      return;
    }

    res.setHeader("Allow", "GET, POST");
    sendJson(res, 405, { error: "Method not allowed" });
  } catch (_error) {
    sendJson(res, 500, { error: "KV request failed" });
  }
}

module.exports = handler;
module.exports.default = handler;
module.exports.config = config;

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

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function hasKvConfig() {
  const hasVercelKv = Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
  const hasUpstash = Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
  return hasVercelKv || hasUpstash;
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(`${JSON.stringify(payload)}\n`);
}
