//This base is created by Styven Emmanel old Lord Minato Dev
'use strict';
const chalk = require('chalk');
const pino  = require('pino');
const { Telegraf, Markup } = require('telegraf');
const fs = require('fs');

const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  DisconnectReason,
} = require('@whiskeysockets/baileys');

const settings  = require('./settings');
const { handleMessage }  = require('./case');
const { handleAntiDelete, checkAntilink, checkAntiMedia, handleAntiCall, handleGroupParticipantsUpdate } = require('./helper/listeners');
const {
  sessionExists, listSessions, deleteSession, sessionDir,
  getWaSettings, setWaSetting, getAllPairs, getUserPairs,
  addPair, removePair, getAllPairedSessions,
  registerUser, getAllUsers, numOf,
} = require('./helper/function');
const { normalizeJid, ensureDir, formatUptime } = require('./helper/utils');
const { logInfo, logSuccess, logWarn, logError, logSession } = require('./helper/logger');

global.botStartTime = Date.now();
ensureDir(settings.SESSION_DIR);
ensureDir('./database');

const activeSockets = new Map();
const notifiedConnected = new Set();
const pendingReplies = new Map();

let bannedUsers = new Set();
const BANNED_FILE = './banned-users.json';

function loadBannedUsers() {
  try {
    if (fs.existsSync(BANNED_FILE)) {
      const data = JSON.parse(fs.readFileSync(BANNED_FILE));
      bannedUsers = new Set(data);
    }
  } catch (error) {
    console.error("Error loading banned users:", error);
  }
}

function saveBannedUsers() {
  try {
    fs.writeFileSync(BANNED_FILE, JSON.stringify([...bannedUsers]));
  } catch (error) {
    console.error("Error saving banned users:", error);
  }
}

function isUserBanned(userId) {
  return bannedUsers.has(userId.toString());
}

loadBannedUsers();

//═════════════════════════════════════
//   TELEGRAM BOT
// ════════════════════════════════════
const bot = new Telegraf(settings.TELEGRAM_TOKEN);

// ── Membership check ─────────────────────────────
async function checkMembership(ctx) {
  const uid = ctx.from.id;
  const ch  = settings.REQUIRED_CHANNEL;
  const gr  = settings.REQUIRED_GROUP;
  if (!ch && !gr) return { ok: true, missing: [] };

  const missing = [];

  async function isMember(handle, numericId) {
    const attempts = [handle, handle.replace('@','')];
    if (numericId) attempts.push(Number(numericId));
    for (const h of attempts) {
      try {
        const mem = await ctx.telegram.getChatMember(h, uid);
        if (['member','administrator','creator'].includes(mem?.status)) return true;
      } catch {}
      try {
        const admins = await ctx.telegram.getChatAdministrators(h);
        if (admins.some(a => a.user.id === uid)) return true;
      } catch {}
    }
    return false;
  }

  if (ch && !(await isMember(ch, settings.REQUIRED_CHANNEL_ID))) missing.push({ name: 'Channel', link: settings.REQUIRED_CHANNEL_LINK });
  if (gr && !(await isMember(gr, settings.REQUIRED_GROUP_LINK)))   missing.push({ name: 'Channel', link: settings.REQUIRED_GROUP_LINK });

  return { ok: missing.length === 0, missing };
}

function joinButtons(missing) {
  const rows = missing.map(e => [Markup.button.url(`🔗 Join ${e.name}`, e.link)]);
  rows.push([Markup.button.callback('✅ I joined – verify me', 'check_membership')]);
  return Markup.inlineKeyboard(rows);
}

// ── /start ─────────────────────────────────
bot.start(async (ctx) => {
  const userId = ctx.from.id;
  registerUser(userId, ctx.from.first_name);
  
  if (isUserBanned(userId)) {
    return ctx.reply("🚫 You are banned from using this bot.");
  }
  
  const allUsers = Object.keys(getAllUsers()).length;
  const myPairs = getUserPairs(userId);
  const activeMine = myPairs.filter(p => activeSockets.has(p.sessionId)).length;
  const uptime = formatUptime(Date.now() - global.botStartTime);

  const text =
`╭━━━━━━━━━━━━━━━━━━━━━━━╮
┃  ⌜ ⎈ ⌟ NAME
┃  ⬡ Author : @StyvenEmmanuelDev
┃  ⬡ Version : 1.0.0 
┃  ⬡ Uptime : ${uptime}
┃  ⬡ User : ${ctx.from.first_name}
┃  ⬡ Active Sessions : ${activeMine}/${myPairs.length}
┃  ⬡ Prefix : /
╰━━━━━━━━━━━━━━━━━━━━━━━╯
`;
  const btns = Markup.inlineKeyboard([
    [Markup.button.callback('⚙️ Owner Panel', 'owner_panel')],
    [Markup.button.callback('🔧 Pairing Setup', 'pairing_panel')]
  ]);

  try {
    await ctx.replyWithPhoto({ url: settings.DEFAULT_MENU_IMG || 'https://files.catbox.moe/q699me.jpg' }, { caption: text, parse_mode: 'Markdown', ...btns });
  } catch {
    await ctx.reply(text, { parse_mode: 'Markdown', ...btns });
  }
});

// ── Callback handlers ─────────────────────────────────────────
bot.action('owner_panel', async (ctx) => {
  await ctx.answerCbQuery();
  const text = `
╭━━━━━━━━━━━━━━━━━━━━━━━╮
┃  ⌜ ⎈ ⌟ OWNER SETTINGS
╰━━━━━━━━━━━━━━━━━━━━━━━╯

𑁍 /reportissue ━ Problem
└‣ Report Bot issues

𑁍 /ban ━ User ID
└‣ Ban a user

𑁍 /unban ━ User ID
└‣ Unban a user

𑁍 /listban ━ List
└‣ Show banned users

𑁍 /status ━ Check 
└‣ Check bot status 

𑁍 /listpaired ━ List
└‣ List your paired devices

𑁍 /broadcast ━ Message
└‣ Send broadcast`;

  await ctx.reply(text, { parse_mode: 'Markdown' });
});

bot.action('pairing_panel', async (ctx) => {
  await ctx.answerCbQuery();
  const text = `
╭━━━━━━━━━━━━━━━━━━━━━━━╮
┃  ⌜ ⎈ ⌟ PAIRING SETUP
╰━━━━━━━━━━━━━━━━━━━━━━━╯

𑁍 /pair ━ Number
└‣ Add WhatsApp Number

𑁍 /delpair ━ Number
└‣ Delete WhatsApp Number

📱 *Example:* /pair 242065723931`;

  await ctx.reply(text, { parse_mode: 'Markdown' });
});

bot.action('check_membership', async (ctx) => {
  await ctx.answerCbQuery('Checking...');
  const { ok, missing } = await checkMembership(ctx);
  if (ok) await ctx.reply('✅ Verified! You can now use /pair <number>');
  else    await ctx.reply('❌ Still not joined.', joinButtons(missing));
});

// ── /status ───────────────────────────────────────────────────
bot.command('status', async (ctx) => {
  const userId = ctx.from.id;
  if (String(userId) !== String(settings.OWNER_TELEGRAM_ID)) return ctx.reply('❌ Owner only command.');
  if (isUserBanned(userId)) {
    return ctx.reply("🚫 You are banned from using this bot.");
  }
  const uptime = formatUptime(Date.now() - global.botStartTime);
  const allUsers = Object.keys(getAllUsers()).length;
  const allPairs = getAllPairs();
  let totalPairs = 0;
  for (const user of Object.values(allPairs)) {
    totalPairs += user.length;
  }
  
  const text = `
╭━━━━━━━━━━━━━━━━━━━━━━━╮
┃  📊 *STATUS*
╰━━━━━━━━━━━━━━━━━━━━━━━╯

🤖 *Bot Info*
├ Name: NAME
├ Version: 1.0.0 PRO
├ Uptime: ${uptime}
└ Status: Online 🔥

📱 *WhatsApp Stats*
├ Active Sockets: ${activeSockets.size}
├ Total Pairs: ${totalPairs}
└ Active Pairs: ${Array.from(activeSockets.keys()).length}

👥 *Users Stats*
├ Total Users: ${allUsers}
└ Active Users: ${Object.values(getAllUsers()).filter(u => getUserPairs(u.id)?.length > 0).length}

╰━━━━━━━━━━━━━━━━━━━━━━━╯`;

  await ctx.reply(text, { parse_mode: 'Markdown' });
});

// ── /ping ─────────────────────────────────────────────────────
bot.command('ping', async (ctx) => {
  const userId = ctx.from.id;
  if (isUserBanned(userId)) {
    return ctx.reply("🚫 You are banned from using this bot.");
  }
  const start = Date.now();
  const msg = await ctx.reply('🏓 Pinging...');
  const latency = Date.now() - start;
  await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null, `🏓 *PONG!*\n📡 Latency: \`${latency}ms\`\n🤖 Status: \`Online\``, { parse_mode: 'Markdown' });
});

// ── /pair <number> – unlimited per user ──────────────────────
bot.command('pair', async (ctx) => {
  const userId = ctx.from.id;
  registerUser(userId, ctx.from.first_name);
  
  if (isUserBanned(userId)) {
    return ctx.reply("🚫 You are banned from using this bot.");
  }
  
  const phone = ctx.message.text.split(/\s+/)[1]?.replace(/\D/g, '');
  if (!phone || phone.length < 7) {
    return ctx.reply('📝 *Usage:* `/pair 242065723931`\nExample: `/pair 242065723931`', { parse_mode: 'Markdown' });
  }

  const { ok, missing } = await checkMembership(ctx);
  if (!ok) return ctx.reply('❌ Join first:', joinButtons(missing));

  const uid = String(userId);
  const sessionId = `wa_${uid}_${phone}`;

  if (activeSockets.has(sessionId)) {
    return ctx.reply(`✅ +${phone} already connected!\nUse /delpair ${phone} to disconnect.`);
  }
  if (sessionExists(sessionId)) {
    await ctx.reply(`♻️ Reconnecting +${phone}...`);
    await startWhatsApp(sessionId, ctx.chat.id, null, uid);
    return;
  }

  await ctx.reply(`🔄 Pairing *+${phone}*...\n⏳ Generating code...`, { parse_mode: 'Markdown' });
  await startWhatsApp(sessionId, ctx.chat.id, phone, uid);
});

// ── /delpair <number> – instant no confirmation ───────────────
bot.command('delpair', async (ctx) => {
  const userId = ctx.from.id;
  if (isUserBanned(userId)) {
    return ctx.reply("🚫 You are banned from using this bot.");
  }
  
  const phone = ctx.message.text.split(/\s+/)[1]?.replace(/\D/g, '');
  if (!phone) return ctx.reply('📝 Usage: `/delpair 242065723931`', { parse_mode: 'Markdown' });

  const uid = String(userId);
  const sessionId = `wa_${uid}_${phone}`;

  const sock = activeSockets.get(sessionId);
  if (sock) {
    try { await sock.logout(); } catch {}
    try { sock.ws?.close(); } catch {}
    activeSockets.delete(sessionId);
  }

  notifiedConnected.delete(sessionId);
  removePair(uid, sessionId);
  const ok = deleteSession(sessionId);
  await ctx.reply(ok
    ? `✅ Device \`+${phone}\` deleted successfully!`
    : `ℹ️ No session found for +${phone}.`
  );
});

// ── /listpaired ───────────────────────────────────────────────
bot.command('listpaired', async (ctx) => {
  const userId = ctx.from.id;
  if (isUserBanned(userId)) {
    return ctx.reply("🚫 You are banned from using this bot.");
  }
  if (String(userId) !== String(settings.OWNER_TELEGRAM_ID)) return ctx.reply('❌ Owner only command.');
  
  const pairs = getUserPairs(String(userId));
  if (!pairs.length) return ctx.reply('📭 No paired numbers. Use `/pair 242065723931` to add one.', { parse_mode: 'Markdown' });
  
  let list = '╭━━━━━━━━━━━━━━━╮\n┃ 📱 *PAIRED DEVICES*\n╰━━━━━━━━━━━━━━━╯\n\n';
  let count = 1;
  for (const p of pairs) {
    const status = activeSockets.has(p.sessionId) ? '✅ Active' : '❌ Offline';
    list += `${count}. \`+${p.waNum}\`\n   └ ${status}\n\n`;
    count++;
  }
  list += `\n📊 Total: ${pairs.length} devices`;
  await ctx.reply(list, { parse_mode: 'Markdown' });
});

// ── /listsession (owner) ──────────────────────────────────────
bot.command('listsession', async (ctx) => {
  const userId = ctx.from.id;
  if (String(userId) !== String(settings.OWNER_TELEGRAM_ID)) return ctx.reply('❌ Owner only command.');
  if (isUserBanned(userId)) {
    return ctx.reply("🚫 You are banned from using this bot.");
  }
  const list = listSessions();
  if (!list.length) return ctx.reply('No sessions.');
  const text = list.map((s, i) => `${i+1}. \`${s}\` ${activeSockets.has(s) ? '🟢 Active' : '🔴 Inactive'}`).join('\n');
  await ctx.reply(`📋 *Sessions (${list.length})*\n\n${text}`, { parse_mode: 'Markdown' });
});

// ── /broadcast (owner) ────────────────────────────────────────
bot.command('broadcast', async (ctx) => {
  const userId = ctx.from.id;
  if (String(userId) !== String(settings.OWNER_TELEGRAM_ID)) return ctx.reply('❌ Owner only command.');
  if (isUserBanned(userId)) {
    return ctx.reply("🚫 You are banned from using this bot.");
  }
  const msg = ctx.message.text.replace(/^\/broadcast\s*/, '').trim();
  if (!msg) return ctx.reply('📝 Usage: `/broadcast <message>`', { parse_mode: 'Markdown' });
  
  const users = getAllUsers();
  let sent = 0, failed = 0;
  
  await ctx.reply(`📢 Broadcasting to ${Object.keys(users).length} users...`);
  
  for (const uid of Object.keys(users)) {
    try { 
      await bot.telegram.sendMessage(uid, `📢 *HOKAGE CRASH BROADCAST*\n\n${msg}`, { parse_mode: 'Markdown' }); 
      sent++; 
    } catch { 
      failed++; 
    }
    await new Promise(r => setTimeout(r, 60));
  }
  await ctx.reply(`✅ Broadcast complete!\n📨 Sent: ${sent}\n❌ Failed: ${failed}\n📊 Total: ${Object.keys(users).length}`);
});

// ── /reportissue ──────────────────────────────────────────────
bot.command('reportissue', async (ctx) => {
  const userId = ctx.from.id;
  if (isUserBanned(userId)) {
    return ctx.reply("🚫 You are banned from using this bot.");
  }
  const report = ctx.message.text.replace(/^\/reportissue\s*/, '').trim();
  if (!report) return ctx.reply('📝 Usage: `/reportissue <describe your problem>`\nExample: `/reportissue Bug not working`', { parse_mode: 'Markdown' });
  
  try {
    const sent = await bot.telegram.sendMessage(
      settings.OWNER_TELEGRAM_ID,
      `🚨 *ISSUE REPORT*\n\n👤 User: ${ctx.from.first_name} (@${ctx.from.username || 'N/A'})\n🆔 ID: \`${userId}\`\n📋 Issue: ${report}\n🕐 Time: ${new Date().toLocaleString()}`,
      { parse_mode: 'Markdown' }
    );
    pendingReplies.set(String(sent.message_id), { userId: userId, chatId: ctx.chat.id });
    await ctx.reply('✅ Your report has been sent to the owner. You will receive a reply when the owner responds.');
  } catch { 
    await ctx.reply('❌ Failed to send report. Please try again later.'); 
  }
});

// ── Owner replies → forward to reporter ──────────────────────
bot.on('message', async (ctx, next) => {
  if (String(ctx.from?.id) !== String(settings.OWNER_TELEGRAM_ID)) return next();
  const replyToId = ctx.message?.reply_to_message?.message_id;
  if (!replyToId) return next();
  const pending = pendingReplies.get(String(replyToId));
  if (!pending) return next();
  const text = ctx.message.text || ctx.message.caption || '[Media]';
  try {
    await bot.telegram.sendMessage(pending.userId, `📨 *REPLY TO YOUR REPORT*\n\n💬 Owner response: ${text}\n\n🕐 Replied: ${new Date().toLocaleString()}`, { parse_mode: 'Markdown' });
    pendingReplies.delete(String(replyToId));
    await ctx.reply('✅ Reply sent to user.');
  } catch { 
    await ctx.reply('❌ Could not reach user.'); 
  }
});

// ═══════════════════════════════════════════════════════════
//   WHATSAPP SESSION STARTER
// ═══════════════════════════════════════════════════════════
async function startWhatsApp(sessionId, telegramChatId = null, pairPhone = null, tgUserId = null) {
  const dir = sessionDir(sessionId);
  ensureDir(dir);

  const { state, saveCreds } = await useMultiFileAuthState(dir);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    keepAliveIntervalMs: 30000, 
    printQRInTerminal: false,
    logger: pino({ level: 'silent' }),
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' })),
    },
    browser: ['Ubuntu', 'Chrome', '20.0.04'],
    syncFullHistory: false,
    markOnlineOnConnect: false,
    generateHighQualityLinkPreview: false,
    connectTimeoutMs: 60000,
    defaultQueryTimeoutMs: 60000,
    keepAliveIntervalMs: 30000,
  
  });

  sock.__sessionId = sessionId;
  const _phoneFromSid = sessionId.split('_').pop();
  if (_phoneFromSid && /^\d{7,}$/.test(_phoneFromSid)) sock.__waNum = _phoneFromSid;
  activeSockets.set(sessionId, sock);
  sock.ev.on('creds.update', saveCreds);

  // ── Pairing code ──────────────────────────────────────────
  if (!state.creds.registered && pairPhone) {
    setTimeout(async () => {
      try {
        const code = await sock.requestPairingCode(pairPhone, 'BOTCODE');
        const formattedCode = code.match(/.{1,4}/g)?.join('-') || code;
        const msg = `╭━━━━━━━━━━━━━━━╮\n┃ 🔑 *PAIRING CODE*\n╰━━━━━━━━━━━━━━━╯\n\n📱 Device: +${pairPhone}\n🔢 Code: \`${formattedCode}\`\n⏱️ Valid: 60 seconds\n\n📲 *How to use:*\n1. Open WhatsApp\n2. Settings → Linked Devices\n3. Link a Device\n4. Enter this code\n\n⚠️ Code expires in 60 seconds!`;
        if (telegramChatId) await bot.telegram.sendMessage(telegramChatId, msg, { parse_mode: 'Markdown' });
      } catch (e) {
        if (telegramChatId) bot.telegram.sendMessage(telegramChatId, `❌ Pairing failed: ${e.message}`).catch(()=>{});
      }
    }, 2500);
  }

  // ── Connection state ──────────────────────────────────────
  sock.ev.on('connection.update', async ({ connection, lastDisconnect }) => {
    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      activeSockets.delete(sessionId);
      logSession(sessionId, 'disconnected');
      if (code === DisconnectReason.loggedOut) {
        logWarn(sessionId, 'Logged out');
        notifiedConnected.delete(sessionId);
        if (telegramChatId) bot.telegram.sendMessage(telegramChatId, `🚪 Device +${sock.__waNum||pairPhone} logged out.\nUse /delpair then /pair to reconnect.`).catch(()=>{});
      } else {
        logWarn(sessionId, 'Reconnecting...');
        setTimeout(() => startWhatsApp(sessionId, telegramChatId, null, tgUserId), 3000);
      }
    }

    if (connection === 'open') {
      const waNum = numOf(sock.user?.id || '');
      sock.__waNum = waNum;

      if (tgUserId) addPair(tgUserId, sessionId, waNum);
      const c = getWaSettings(waNum);
      if (!c.owner) setWaSetting(waNum, 'owner', waNum);

      logSession(sessionId, 'connected');
      logSuccess(sessionId, `wa.me/${waNum}`);

      if (telegramChatId && !notifiedConnected.has(sessionId)) {
        notifiedConnected.add(sessionId);
        bot.telegram.sendMessage(telegramChatId,
          `✅ *Connected Successfully!*\n📱 Number: ${waNum}\n🔗 Device is now ready to use.`,
          { parse_mode: 'Markdown' }
        ).catch(()=>{});
      }

   
    }
  });

  // ── Messages – fire and forget per message ────────────────
  sock.ev.on('messages.upsert', ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const m of messages) {
      if (!m?.message) continue;
      if (m.message.ephemeralMessage) m.message = m.message.ephemeralMessage.message;
      (async () => {
        const chatMeta = { groupName: '' };
        if (m.key.remoteJid?.endsWith('@g.us')) {
          try { const meta = await sock.groupMetadata(m.key.remoteJid); chatMeta.groupName = meta.subject || ''; } catch {}
        }

        await checkAntilink(sock, m);
        await checkAntiMedia(sock, m);
        await handleMessage(sock, m, chatMeta);
      })().catch(e => logError(sessionId, e.message));
    }
  });

  // ── Anti-delete ───────────────────────────────────────────
  sock.ev.on('messages.delete', (update) => {
    if (!update?.keys?.length) return;
    handleAntiDelete(sock, update).catch(()=>{});
  });

  // ── Group participant updates (welcome/goodbye) ────────────
  sock.ev.on('group-participants.update', (update) => {
    handleGroupParticipantsUpdate(sock, update).catch(()=>{});
  });

  // ── Call events (anticall) ────────────────────────────────
  sock.ev.on('call', (call) => {
    handleAntiCall(sock, call).catch(()=>{});
  });

  return sock;
}

// ═══════════════════════════════════════════════════════════
//   RELOAD ALL SESSIONS ON STARTUP
// ═══════════════════════════════════════════════════════════
async function reloadSessions() {
  const list = listSessions();
  logInfo('STARTUP', `Reloading ${list.length} session(s)`);
  const allPairs = getAllPairs();

  list.forEach((sid, i) => {
    let tgUserId = null;
    for (const [uid, pairs] of Object.entries(allPairs)) {
      if (pairs.find(p => p.sessionId === sid)) { tgUserId = uid; break; }
    }
    notifiedConnected.add(sid);
    setTimeout(() => startWhatsApp(sid, null, null, tgUserId).catch(e => logError(sid, e.message)), i * 1200);
  });
}

// ── /ban command ──────────────────────────────────────────────
bot.command('ban', async (ctx) => {
  const userId = ctx.from.id;
  if (String(userId) !== String(settings.OWNER_TELEGRAM_ID)) return ctx.reply('❌ Owner only command.');
  
  const targetId = ctx.message.text.split(/\s+/)[1]?.trim();
  if (!targetId) return ctx.reply('📝 Usage: `/ban <user_id>`', { parse_mode: 'Markdown' });
  
  bannedUsers.add(targetId);
  saveBannedUsers();
  await ctx.reply(`✅ User \`${targetId}\` has been banned.`, { parse_mode: 'Markdown' });
});

// ── /unban command ────────────────────────────────────────────
bot.command('unban', async (ctx) => {
  const userId = ctx.from.id;
  if (String(userId) !== String(settings.OWNER_TELEGRAM_ID)) return ctx.reply('❌ Owner only command.');
  
  const targetId = ctx.message.text.split(/\s+/)[1]?.trim();
  if (!targetId) return ctx.reply('📝 Usage: `/unban <user_id>`', { parse_mode: 'Markdown' });
  
  bannedUsers.delete(targetId);
  saveBannedUsers();
  await ctx.reply(`✅ User \`${targetId}\` has been unbanned.`, { parse_mode: 'Markdown' });
});

// ── /listban command ──────────────────────────────────────────
bot.command('listban', async (ctx) => {
  const userId = ctx.from.id;
  if (String(userId) !== String(settings.OWNER_TELEGRAM_ID)) return ctx.reply('❌ Owner only command.');
  
  if (bannedUsers.size === 0) return ctx.reply('📭 No banned users.');
  
  const list = [...bannedUsers].map((id, i) => `${i+1}. \`${id}\``).join('\n');
  await ctx.reply(`🚫 *Banned Users*\n\n${list}`, { parse_mode: 'Markdown' });
});

// ═══════════════════════════════════════════════════════════
//   LAUNCH
// ═══════════════════════════════════════════════════════════
async function launch() {
  console.log(chalk.magentaBright(`
╔══════════════════════════════╗
║    NAME v1.0.0 PRO      
║    Telegram × WhatsApp Bot         
║    Author : @StyvenEmmanuelDev       
╚══════════════════════════════╝`));

  await reloadSessions();
  bot.launch({ dropPendingUpdates: true });
  logSuccess('TELEGRAM', 'Bot is running');

  process.once('SIGINT',  () => { bot.stop('SIGINT');  process.exit(0); });
  process.once('SIGTERM', () => { bot.stop('SIGTERM'); process.exit(0); });
}

launch().catch(e => { logError('FATAL', e.message); process.exit(1); });
