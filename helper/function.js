// ============================================================
//   helper/function.js  v3
// ============================================================
'use strict';

const fs   = require('fs');
const path = require('path');
const { readJSON, writeJSON, ensureDir } = require('./utils');

const PREMIUM_FILE  = path.resolve(__dirname, '../database/premium.json');
const SESSIONS_DIR  = path.resolve(__dirname, '../sessions');
const SETTINGS_FILE = path.resolve(__dirname, '../database/settings.json');
const PAIRS_FILE    = path.resolve(__dirname, '../database/pairs.json');
const USERS_FILE    = path.resolve(__dirname, '../database/users.json');

ensureDir(path.dirname(PREMIUM_FILE));
ensureDir(SESSIONS_DIR);

// ── number normalizer ─────────────────────────────────────────
function numOf(jid) { return String(jid || '').split('@')[0].split(':')[0].replace(/\D/g, ''); }

// ── Premium ───────────────────────────────────────────────────
function getPremiumList() { return readJSON(PREMIUM_FILE, { premiumUsers: [] }).premiumUsers || []; }
function isPremium(jid)   { return getPremiumList().includes(numOf(jid)); }
function addPremium(jid)  {
  const n = numOf(jid), d = readJSON(PREMIUM_FILE, { premiumUsers: [] });
  if (d.premiumUsers.includes(n)) return false;
  d.premiumUsers.push(n); writeJSON(PREMIUM_FILE, d); return true;
}
function removePremium(jid) {
  const n = numOf(jid), d = readJSON(PREMIUM_FILE, { premiumUsers: [] });
  const i = d.premiumUsers.indexOf(n);
  if (i === -1) return false;
  d.premiumUsers.splice(i, 1); writeJSON(PREMIUM_FILE, d); return true;
}

// ── Per-WA-number settings  (KEY = WA number, not session/telegram id) ──
// This means prefix/font/mode etc is tied to the WhatsApp number itself.
// Two different Telegram users pairing different WA numbers get separate settings.
const DEFAULTS = {
  prefix: '.', mode: 'public', font: 0,
  owner: '', botName: 'HOKAGE CRASH', menuImg: '',
  antidelete: true, iphoneMode: false,
  autoViewStatus: false, autoLikeStatus: false,
};

function getAllSettings()         { return readJSON(SETTINGS_FILE, {}); }
function getWaSettings(waNum)    {
  // waNum = plain number string e.g. "242065723931"
  const all = getAllSettings();
  if (!all[waNum]) { all[waNum] = { ...DEFAULTS }; writeJSON(SETTINGS_FILE, all); }
  let changed = false;
  for (const [k, v] of Object.entries(DEFAULTS)) {
    if (all[waNum][k] === undefined) { all[waNum][k] = v; changed = true; }
  }
  if (changed) writeJSON(SETTINGS_FILE, all);
  return all[waNum];
}
function setWaSetting(waNum, key, value) {
  const all = getAllSettings();
  if (!all[waNum]) all[waNum] = { ...DEFAULTS };
  all[waNum][key] = value;
  writeJSON(SETTINGS_FILE, all);
}

// Convenience wrappers used in case.js – sock.__waNum is set on connect
function getSessionSettings(sid) { return getWaSettings(sid); }
function setSessionSetting(sid, k, v) { setWaSetting(sid, k, v); }

// ── Pairs: tgUserId → [{ sessionId, waNum, label }] ──────────
function getAllPairs()                { return readJSON(PAIRS_FILE, {}); }
function getUserPairs(tgId)          { return (getAllPairs()[String(tgId)] || []); }
function addPair(tgId, sessionId, waNum) {
  const all = getAllPairs();
  const uid = String(tgId);
  if (!all[uid]) all[uid] = [];
  // prevent duplicate session
  if (!all[uid].find(p => p.sessionId === sessionId)) {
    all[uid].push({ sessionId, waNum, addedAt: Date.now() });
  }
  writeJSON(PAIRS_FILE, all);
}
function removePair(tgId, sessionId) {
  const all = getAllPairs();
  const uid = String(tgId);
  if (!all[uid]) return;
  all[uid] = all[uid].filter(p => p.sessionId !== sessionId);
  writeJSON(PAIRS_FILE, all);
}
function getAllPairedSessions() {
  // returns flat array of all sessionIds across all users
  const all = getAllPairs();
  return Object.values(all).flat().map(p => p.sessionId);
}

// ── Users registry (for /broadcast + stats) ──────────────────
function registerUser(tgId, firstName) {
  const all = readJSON(USERS_FILE, {});
  all[String(tgId)] = { firstName, lastSeen: Date.now() };
  writeJSON(USERS_FILE, all);
}
function getAllUsers() { return readJSON(USERS_FILE, {}); }

// ── Session file helpers ──────────────────────────────────────
function sessionExists(sid)  { return fs.existsSync(path.join(SESSIONS_DIR, sid, 'creds.json')); }
function listSessions()      { ensureDir(SESSIONS_DIR); return fs.readdirSync(SESSIONS_DIR).filter(d => fs.existsSync(path.join(SESSIONS_DIR, d, 'creds.json'))); }
function deleteSession(sid)  {
  const dir = path.join(SESSIONS_DIR, sid);
  if (!fs.existsSync(dir)) return false;
  fs.rmSync(dir, { recursive: true, force: true }); return true;
}
function sessionDir(sid)     { return path.join(SESSIONS_DIR, sid); }

// ── Anti-delete in-memory store ───────────────────────────────
const msgStore = new Map();
const STORE_CAP = 8000;

function storeMessage(m) {
  if (!m?.message || !m?.key?.id) return;
  let msg = m.message;
  // Unwrap all known wrappers
  const wrappers = ['ephemeralMessage','viewOnceMessage','viewOnceMessageV2','viewOnceMessageV2Extension','documentWithCaptionMessage'];
  for (const w of wrappers) { if (msg[w]?.message) msg = msg[w].message; }

  const k = `${m.key.remoteJid}|${m.key.id}`;
  msgStore.set(k, {
    key: { ...m.key },
    message: msg,
    pushName: m.pushName || '',
    ts: Number(m.messageTimestamp || 0),
  });
  if (msgStore.size > STORE_CAP) {
    const keys = [...msgStore.keys()];
    keys.slice(0, msgStore.size - STORE_CAP).forEach(x => msgStore.delete(x));
  }
}

function retrieveMessage(remoteJid, msgId) {
  return msgStore.get(`${remoteJid}|${msgId}`) || null;
}

module.exports = {
  numOf,
  getPremiumList, isPremium, addPremium, removePremium,
  getWaSettings, setWaSetting,
  getSessionSettings, setSessionSetting,
  getAllPairs, getUserPairs, addPair, removePair, getAllPairedSessions,
  registerUser, getAllUsers,
  sessionExists, listSessions, deleteSession, sessionDir,
  storeMessage, retrieveMessage,
};
