// ============================================================
//   helper/listeners.js  – ALL event listeners
//   antidelete, antilink, anticall, antimedia,
//   welcome/goodbye, group participant events
// ============================================================
'use strict';

const path = require('path');
const axios = require('axios');
const { readJSON, writeJSON, ensureDir } = require('./utils');
const { normNum, getGroupAdminInfo } = require('./groupAdmin');
const { retrieveMessage, getWaSettings, setWaSetting } = require('./function');
const { logInfo, logError, logWarn } = require('./logger');
const { generateWelcomeCard } = require('./welcomeImg');

const DB = (...f) => path.resolve(__dirname, '../database', ...f);
ensureDir(path.resolve(__dirname, '../database'));

// ── DB helpers ────────────────────────────────────────────────
function getDB(file) { return readJSON(DB(file), {}); }
function setDB(file, data) { writeJSON(DB(file), data); }
function getGroupFlag(file, jid)         { return !!(getDB(file)[jid]); }
function setGroupFlag(file, jid, val)    { const d = getDB(file); d[jid] = val; setDB(file, d); }

// ── Download media from baileys ───────────────────────────────
async function dlMedia(msgObj, keyObj) {
  const { downloadMediaMessage } = require('@whiskeysockets/baileys');
  return downloadMediaMessage(
    { message: msgObj, key: keyObj }, 'buffer', {},
    { logger: { info(){}, error(){}, warn(){}, debug(){}, child(){ return this; } } }
  );
}

// ════════════════════════════════════════════════════════════
//   ANTI-DELETE  –  100% complete, all types
// ════════════════════════════════════════════════════════════
async function handleAntiDelete(sock, update) {
  const c = getWaSettings(sock.__waNum || '');
  if (!c.antidelete) return;

  for (const key of (update.keys || [])) {
    if (key.fromMe) continue;

    const data = retrieveMessage(key.remoteJid, key.id);
    if (!data) continue;

    const sender = data.key.participant || data.key.remoteJid;
    const name   = data.pushName || normNum(sender);
    const hdr    = `🚫 *AntiDelete*\nFrom: *${name}*\n\n`;
    let   msg    = data.message;
    if (!msg) continue;

    // Unwrap wrappers
    const WRAP = ['ephemeralMessage','viewOnceMessage','viewOnceMessageV2','viewOnceMessageV2Extension','documentWithCaptionMessage'];
    for (const w of WRAP) { if (msg[w]?.message) { msg = msg[w].message; break; } }

    const TYPE = Object.keys(msg).find(k =>
      !['senderKeyDistributionMessage','messageContextInfo','protocolMessage','reactionMessage'].includes(k)
    );
    if (!TYPE) continue;

    logInfo('AntiDelete', `recovering ${TYPE} from ${name}`);
    const jid = key.remoteJid;

    const notifyFail = async (label) => {
      try { await sock.sendMessage(jid, { text: `${hdr}🗑 Deleted ${label} [media unavailable]`, mentions: [sender] }); } catch {}
    };

    try {
      switch (TYPE) {

        case 'conversation':
        case 'extendedTextMessage': {
          const t = msg.conversation || msg.extendedTextMessage?.text || '';
          await sock.sendMessage(jid, { text: `${hdr}📝 ${t}`, mentions: [sender] });
          break;
        }

        case 'imageMessage': {
          const buf = await dlMedia(msg, data.key).catch(() => null);
          if (buf) await sock.sendMessage(jid, { image: buf, caption: `${hdr}${msg.imageMessage?.caption || ''}`, mentions: [sender] });
          else await notifyFail('Image');
          break;
        }

        case 'videoMessage': {
          const buf = await dlMedia(msg, data.key).catch(() => null);
          if (buf) await sock.sendMessage(jid, { video: buf, caption: `${hdr}${msg.videoMessage?.caption || ''}`, mentions: [sender] });
          else await notifyFail('Video');
          break;
        }

        case 'audioMessage': {
          const buf = await dlMedia(msg, data.key).catch(() => null);
          if (buf) {
            await sock.sendMessage(jid, { audio: buf, mimetype: 'audio/mp4', ptt: !!msg.audioMessage?.ptt });
            await sock.sendMessage(jid, { text: `${hdr}🎵 Deleted Audio`, mentions: [sender] });
          } else await notifyFail('Audio');
          break;
        }

        case 'stickerMessage': {
          const buf = await dlMedia(msg, data.key).catch(() => null);
          if (buf) {
            await sock.sendMessage(jid, { sticker: buf });
            await sock.sendMessage(jid, { text: `${hdr}🌀 Deleted Sticker`, mentions: [sender] });
          } else await notifyFail('Sticker');
          break;
        }

        case 'documentMessage':
        case 'documentWithCaptionMessage': {
          const docMsg = msg.documentMessage || msg.documentWithCaptionMessage?.message?.documentMessage;
          if (!docMsg) { await notifyFail('Document'); break; }
          const buf = await dlMedia({ documentMessage: docMsg }, data.key).catch(() => null);
          if (buf) {
            await sock.sendMessage(jid, { document: buf, fileName: docMsg.fileName || 'file', mimetype: docMsg.mimetype || 'application/octet-stream' });
            await sock.sendMessage(jid, { text: `${hdr}📄 Deleted Document`, mentions: [sender] });
          } else await notifyFail('Document');
          break;
        }

        case 'contactMessage': {
          const vcard = msg.contactMessage?.vcard || '';
          await sock.sendMessage(jid, { contacts: { displayName: msg.contactMessage?.displayName || 'Contact', contacts: [{ vcard }] } });
          await sock.sendMessage(jid, { text: `${hdr}👤 Deleted Contact`, mentions: [sender] });
          break;
        }

        case 'locationMessage': {
          const loc = msg.locationMessage;
          await sock.sendMessage(jid, { location: { degreesLatitude: loc?.degreesLatitude || 0, degreesLongitude: loc?.degreesLongitude || 0 } });
          await sock.sendMessage(jid, { text: `${hdr}📍 Deleted Location`, mentions: [sender] });
          break;
        }

        case 'viewOnceMessage':
        case 'viewOnceMessageV2':
        case 'viewOnceMessageV2Extension': {
          const inner     = msg[TYPE]?.message || {};
          const innerType = Object.keys(inner).find(k => !['messageContextInfo'].includes(k));
          if (!innerType) { await sock.sendMessage(jid, { text: `${hdr}👁 Deleted View Once`, mentions: [sender] }); break; }
          const buf = await dlMedia(inner, data.key).catch(() => null);
          if (innerType === 'imageMessage' && buf)
            await sock.sendMessage(jid, { image: buf, caption: `${hdr}👁 Deleted View Once Image`, mentions: [sender] });
          else if (innerType === 'videoMessage' && buf)
            await sock.sendMessage(jid, { video: buf, caption: `${hdr}👁 Deleted View Once Video`, mentions: [sender] });
          else
            await sock.sendMessage(jid, { text: `${hdr}👁 Deleted View Once [${innerType}]`, mentions: [sender] });
          break;
        }

        case 'buttonsMessage':
        case 'templateMessage':
        case 'listMessage':
        case 'interactiveMessage':
        case 'buttonReplyMessage': {
          const b   = msg[TYPE];
          const txt = b?.contentText || b?.hydratedTemplate?.hydratedContentText || b?.description || b?.title || '[Interactive]';
          await sock.sendMessage(jid, { text: `${hdr}🗂 ${txt}`, mentions: [sender] });
          break;
        }

        case 'pollCreationMessage':
        case 'pollCreationMessageV2':
        case 'pollCreationMessageV3': {
          const poll = msg[TYPE];
          await sock.sendMessage(jid, { text: `${hdr}📊 Deleted Poll: ${poll?.name || 'Unknown poll'}`, mentions: [sender] });
          break;
        }

        default:
          await sock.sendMessage(jid, { text: `${hdr}🗑 Deleted [${TYPE.replace('Message', '')}]`, mentions: [sender] });
          break;
      }
    } catch (e) {
      logError('AntiDelete', e.message);
      await notifyFail(TYPE.replace('Message', ''));
    }
  }
}

// ════════════════════════════════════════════════════════════
//   ANTILINK  –  full listener
// ════════════════════════════════════════════════════════════
const LINK_RE = /https?:\/\/|chat\.whatsapp\.com|t\.me\/|discord\.gg\/|bit\.ly\/|tinyurl\.com\//i;

async function checkAntilink(sock, m) {
  if (!m.key.remoteJid.endsWith('@g.us')) return;
  if (!getGroupFlag('antilink.json', m.key.remoteJid)) return;

  const body = [
    m.message?.conversation,
    m.message?.extendedTextMessage?.text,
    m.message?.imageMessage?.caption,
    m.message?.videoMessage?.caption,
  ].filter(Boolean).join(' ');

  if (!LINK_RE.test(body)) return;

  // Admins exempt
  const senderNum = normNum(m.key.participant || m.key.remoteJid);
  const { admins } = await getGroupAdminInfo(sock, m.key.remoteJid);
  if (admins.has(senderNum)) return;

  try { await sock.sendMessage(m.key.remoteJid, { delete: m.key }); } catch {}
  try {
    await sock.sendMessage(m.key.remoteJid, {
      text: `⚠️ @${senderNum} Links are not allowed here! Message deleted.`,
      mentions: [m.key.participant || m.key.remoteJid],
    });
  } catch {}
}

// ════════════════════════════════════════════════════════════
//   ANTIMEDIA  –  delete media from non-admins
// ════════════════════════════════════════════════════════════
async function checkAntiMedia(sock, m) {
  if (!m.key.remoteJid.endsWith('@g.us')) return;
  if (!getGroupFlag('antimedia.json', m.key.remoteJid)) return;

  const hasMedia = !!(
    m.message?.imageMessage || m.message?.videoMessage ||
    m.message?.audioMessage || m.message?.stickerMessage ||
    m.message?.documentMessage
  );
  if (!hasMedia) return;

  const senderNum = normNum(m.key.participant || m.key.remoteJid);
  const { admins } = await getGroupAdminInfo(sock, m.key.remoteJid);
  if (admins.has(senderNum)) return;

  try { await sock.sendMessage(m.key.remoteJid, { delete: m.key }); } catch {}
  try {
    await sock.sendMessage(m.key.remoteJid, {
      text: `🚫 @${senderNum} Media not allowed here.`,
      mentions: [m.key.participant || m.key.remoteJid],
    });
  } catch {}
}

// ════════════════════════════════════════════════════════════
//   ANTICALL
// ════════════════════════════════════════════════════════════
async function handleAntiCall(sock, call) {
  const c = getWaSettings(sock.__waNum || '');
  if (!c.anticall) return;
  for (const cCall of call) {
    if (cCall.status === 'offer') {
      try {
        await sock.rejectCall(cCall.id, cCall.from);
        await sock.sendMessage(cCall.from, { text: `❌ Sorry, I don't accept calls. Please text instead.` });
      } catch {}
    }
  }
}

// ════════════════════════════════════════════════════════════
//   WELCOME / GOODBYE  –  with generated image
// ════════════════════════════════════════════════════════════
// Track sent welcomes per session to avoid spam: jid+participant
const welcomeSent = new Set();

async function handleGroupParticipantsUpdate(sock, update) {
  const { id: groupJid, participants, action } = update;

  // WELCOME
  if (action === 'add' && getGroupFlag('welcome.json', groupJid)) {
    let groupPpUrl = null;
    try { groupPpUrl = await sock.profilePictureUrl(groupJid, 'image'); } catch {}

    let groupName = groupJid;
    try { const meta = await sock.groupMetadata(groupJid); groupName = meta.subject; } catch {}

    for (const participant of participants) {
      const dedupeKey = `${groupJid}:${participant}`;
      if (welcomeSent.has(dedupeKey)) continue;
      welcomeSent.add(dedupeKey);
      setTimeout(() => welcomeSent.delete(dedupeKey), 30000);

      const num  = normNum(participant);
      let ppUrl  = null;
      try { ppUrl = await sock.profilePictureUrl(participant, 'image'); } catch {}

      let pushName = num;
      try {
        const info = await sock.onWhatsApp(participant);
        if (info?.[0]?.name) pushName = info[0].name;
      } catch {}

      // Generate welcome card
      const cardBuf = await generateWelcomeCard({
        userName:   pushName,
        groupName,
        userPpUrl:  ppUrl,
        groupPpUrl,
      });

      const caption = `👋 *Welcome @${num}!*\n\nGlad to have you in *${groupName}*.\nPlease read the group rules and enjoy your stay! 🎉`;

      try {
        if (cardBuf) {
          await sock.sendMessage(groupJid, {
            image:    cardBuf,
            caption,
            mentions: [participant],
          });
        } else {
          // Fallback: no canvas
          await sock.sendMessage(groupJid, {
            text:     `👋 Welcome @${num} to *${groupName}*! 🎉\n${ppUrl ? '\n🖼 ' + ppUrl : ''}`,
            mentions: [participant],
          });
        }
      } catch (e) { logError('Welcome', e.message); }
    }
  }

  // GOODBYE
  if (action === 'remove' && getGroupFlag('goodbye.json', groupJid)) {
    let groupName = groupJid;
    try { const meta = await sock.groupMetadata(groupJid); groupName = meta.subject; } catch {}

    for (const participant of participants) {
      const num = normNum(participant);
      try {
        await sock.sendMessage(groupJid, {
          text:     `👋 *Goodbye @${num}!*\nWe'll miss you in *${groupName}*. Take care! 💜`,
          mentions: [participant],
        });
      } catch {}
    }
  }
}

// ── Exports for flag get/set (used by case.js commands) ──────
module.exports = {
  // listeners
  handleAntiDelete,
  checkAntilink,
  checkAntiMedia,
  handleAntiCall,
  handleGroupParticipantsUpdate,
  // flag helpers
  getGroupFlag,
  setGroupFlag,
};
