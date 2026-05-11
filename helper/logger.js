// ============================================================
//   helper/logger.js  – stylish colored console output
// ============================================================
'use strict';

const chalk = require('chalk');

const icons = {
  text:      '💬',
  image:     '🖼 ',
  video:     '🎥',
  audio:     '🎵',
  sticker:   '🌀',
  document:  '📄',
  location:  '📍',
  contact:   '👤',
  reaction:  '❤️',
  poll:      '📊',
  viewOnce:  '👁 ',
  unknown:   '❓',
};

function getMsgType(msg) {
  if (!msg) return 'unknown';
  if (msg.conversation || msg.extendedTextMessage)    return 'text';
  if (msg.imageMessage)     return 'image';
  if (msg.videoMessage)     return 'video';
  if (msg.audioMessage)     return 'audio';
  if (msg.stickerMessage)   return 'sticker';
  if (msg.documentMessage)  return 'document';
  if (msg.locationMessage)  return 'location';
  if (msg.contactMessage)   return 'contact';
  if (msg.reactionMessage)  return 'reaction';
  if (msg.pollCreationMessage) return 'poll';
  if (msg.viewOnceMessage || msg.viewOnceMessageV2) return 'viewOnce';
  return 'unknown';
}

function getMsgText(msg) {
  if (!msg) return '';
  return (
    msg.conversation ||
    msg.extendedTextMessage?.text ||
    msg.imageMessage?.caption ||
    msg.videoMessage?.caption ||
    msg.documentMessage?.caption ||
    msg.reactionMessage?.text ||
    msg.pollCreationMessage?.name ||
    msg.locationMessage ? `[${msg.locationMessage?.degreesLatitude?.toFixed(4)}, ${msg.locationMessage?.degreesLongitude?.toFixed(4)}]` :
    msg.contactMessage?.displayName ||
    ''
  );
}

function logMessage(m, chatMeta = {}) {
  try {
    const msg     = m.message;
    let realMsg   = msg;
    const wrappers = ['ephemeralMessage','viewOnceMessage','viewOnceMessageV2','viewOnceMessageV2Extension'];
    for (const w of wrappers) { if (realMsg?.[w]?.message) realMsg = realMsg[w].message; }

    const type     = getMsgType(realMsg);
    const icon     = icons[type] || icons.unknown;
    const text     = getMsgText(realMsg).slice(0, 120);
    const sender   = (m.key.participant || m.key.remoteJid || '').split('@')[0].split(':')[0].replace(/\D/g,'');
    const name     = m.pushName || sender;
    const ts       = new Date(Number(m.messageTimestamp || 0) * 1000);
    const time     = ts.toLocaleTimeString('en-US', { hour12: true });
    const jid      = m.key.remoteJid || '';
    const isGroup   = jid.endsWith('@g.us');
    const isChannel = jid.endsWith('@newsletter');
    const isDM      = !isGroup && !isChannel;

    const chatLabel = isGroup
      ? chalk.magentaBright(`[GROUP: ${chatMeta.groupName || jid.split('@')[0]}]`)
      : isChannel
        ? chalk.cyanBright(`[CHANNEL: ${chatMeta.groupName || jid.split('@')[0]}]`)
        : chalk.blueBright('[DM]');

    console.log(
      chalk.gray('─'.repeat(60)) + '\n' +
      chalk.yellowBright(' HOKAGE CRASH ') + chalk.gray('│ New Message\n') +
      chalk.gray('  sender  : ') + chalk.greenBright(name) + chalk.gray(` (${sender})\n`) +
      chalk.gray('  time    : ') + chalk.whiteBright(time) + '\n' +
      chalk.gray('  chat    : ') + chatLabel + '\n' +
      chalk.gray('  type    : ') + chalk.keyword('orange')(icon + ' ' + type) + '\n' +
      (text ? chalk.gray('  message : ') + chalk.white(text) + '\n' : '') +
      chalk.gray('─'.repeat(60))
    );
  } catch {}
}

function logInfo(label, msg) {
  console.log(chalk.cyanBright(`  [INFO]  `) + chalk.white(label) + (msg ? chalk.gray(' – ' + msg) : ''));
}
function logSuccess(label, msg) {
  console.log(chalk.greenBright(`  [OK]    `) + chalk.white(label) + (msg ? chalk.gray(' – ' + msg) : ''));
}
function logWarn(label, msg) {
  console.log(chalk.yellowBright(`  [WARN]  `) + chalk.white(label) + (msg ? chalk.gray(' – ' + msg) : ''));
}
function logError(label, msg) {
  console.log(chalk.redBright(`  [ERR]   `) + chalk.white(label) + (msg ? chalk.gray(' – ' + msg) : ''));
}
function logSession(sessionId, status) {
  const icon = status === 'connected' ? '🟢' : status === 'reconnecting' ? '🟡' : '🔴';
  console.log(chalk.gray('  session : ') + chalk.bold(sessionId) + ' ' + icon + ' ' + chalk.gray(status));
}

module.exports = { logMessage, logInfo, logSuccess, logWarn, logError, logSession, getMsgType };
