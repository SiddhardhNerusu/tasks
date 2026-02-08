const { getPushConfig, sendJson } = require("./_shared");

async function handler(req, res) {
  const method = String(req.method || "GET").toUpperCase();
  if (method !== "GET") {
    res.setHeader("Allow", "GET");
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  const config = getPushConfig();
  if (!config.publicKey) {
    sendJson(res, 503, { error: "WEB_PUSH_PUBLIC_KEY is missing" });
    return;
  }

  sendJson(res, 200, { publicKey: config.publicKey });
}

module.exports = handler;
module.exports.default = handler;
