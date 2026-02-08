function handler(_req, res) {
  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end("{\"ok\":true}\n");
}

module.exports = handler;
module.exports.default = handler;
