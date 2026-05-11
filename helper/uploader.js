// ============================================================
//   helper/uploader.js  – media upload helpers
// ============================================================

const fs      = require("fs");
const path    = require("path");
const https   = require("https");
const http    = require("http");
const { URL } = require("url");

// ── Generic URL downloader → Buffer ─────────────────────────
function fetchBuffer(url) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const lib    = parsed.protocol === "https:" ? https : http;
    lib.get(url, { timeout: 15000 }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end",  () => resolve(Buffer.concat(chunks)));
      res.on("error", reject);
    }).on("error", reject);
  });
}

// ── Upload buffer / file to telegra.ph ───────────────────────
async function uploadToTelegraph(input, mimeType = "image/jpeg") {
  // input can be a Buffer or a local file path
  let buf;
  if (Buffer.isBuffer(input)) {
    buf = input;
  } else {
    buf = fs.readFileSync(input);
  }

  const boundary = "----FormBoundary" + Math.random().toString(36).slice(2);
  const ext      = mimeType.split("/")[1] || "jpg";
  const fileName = `upload.${ext}`;

  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: ${mimeType}\r\n\r\n`
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  const body = Buffer.concat([head, buf, tail]);

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "telegra.ph",
        path:     "/upload",
        method:   "POST",
        headers: {
          "Content-Type":   `multipart/form-data; boundary=${boundary}`,
          "Content-Length": body.length,
        },
      },
      (res) => {
        let raw = "";
        res.on("data", (c) => (raw += c));
        res.on("end", () => {
          try {
            const json = JSON.parse(raw);
            if (Array.isArray(json) && json[0]?.src) {
              resolve("https://telegra.ph" + json[0].src);
            } else {
              reject(new Error("Telegraph upload failed: " + raw));
            }
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// ── Upload from URL ──────────────────────────────────────────
async function uploadFromUrl(url, mimeType = "image/jpeg") {
  const buf = await fetchBuffer(url);
  return uploadToTelegraph(buf, mimeType);
}

// ── Get file size ────────────────────────────────────────────
function getFileSizeMB(filePath) {
  const stat = fs.statSync(filePath);
  return stat.size / (1024 * 1024);
}

module.exports = { fetchBuffer, uploadToTelegraph, uploadFromUrl, getFileSizeMB };
