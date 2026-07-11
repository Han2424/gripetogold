import { timingSafeEqual } from "node:crypto";

const ALLOWED_ORIGINS = new Set([
  "https://han2424.github.io",
  "https://gripetogold-app.vercel.app",
  "http://localhost:5177",
  "http://127.0.0.1:5177",
  "http://localhost:3000",
  "http://127.0.0.1:3000"
]);

export function setCors(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Admin-Token-B64, X-Admin-Token");
}

export function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

export async function readJsonBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string" && req.body.trim()) return JSON.parse(req.body);

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  return raw ? JSON.parse(raw) : {};
}

export function requireAdmin(req, res) {
  const expected = process.env.ADMIN_TOKEN || "";
  if (!expected) {
    sendJson(res, 503, { error: "Admin API is not configured yet." });
    return false;
  }

  const encoded = req.headers["x-admin-token-b64"];
  const plain = req.headers["x-admin-token"];
  let provided = "";

  if (encoded) {
    try {
      provided = Buffer.from(String(encoded), "base64").toString("utf8");
    } catch {
      provided = "";
    }
  } else if (plain) {
    provided = String(plain);
  }

  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  const valid = expectedBuffer.length === providedBuffer.length && timingSafeEqual(expectedBuffer, providedBuffer);

  if (!valid) {
    sendJson(res, 401, { error: "Invalid admin token." });
    return false;
  }

  return true;
}
