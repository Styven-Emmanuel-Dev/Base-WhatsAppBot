// ============================================================
//   helper/groupAdmin.js  v5  – DEFINITIVE PERMANENT FIX
//   Debug mode built-in so you can SEE exactly what's happening
// ============================================================
'use strict';

const chalk = require('chalk');


function normNum(jid) {
  if (!jid) return '';
  const s = String(jid);
  // remove @domain
  const noDomain = s.includes('@') ? s.split('@')[0] : s;
  // remove :device
  const noDevice = noDomain.includes(':') ? noDomain.split(':')[0] : noDomain;
  // digits only
  return noDevice.replace(/\D/g, '');
}

/**
 * Fetch group admin data with full debug output
 * Returns admins as a Set of plain digit strings
 */
async function getGroupAdminInfo(sock, groupJid, debug = false) {
  try {
    const meta   = await sock.groupMetadata(groupJid);
    const admins = new Set();
    const superAdmins = new Set();
    const botNum = normNum(sock.user?.id || '');

    for (const p of meta.participants) {
      const num = normNum(p.id);
      if (p.admin === 'superadmin') { admins.add(num); superAdmins.add(num); }
      else if (p.admin === 'admin') { admins.add(num); }
    }

    const botIsAdmin = admins.has(botNum);

    if (debug) {
      console.log(chalk.cyan('  [ADMIN DEBUG]'));
      console.log(chalk.gray('  botNum      : ') + chalk.yellow(botNum));
      console.log(chalk.gray('  botIsAdmin  : ') + (botIsAdmin ? chalk.green('YES') : chalk.red('NO')));
      console.log(chalk.gray('  admins      : ') + chalk.yellow([...admins].join(', ')));
    }

    return { admins, superAdmins, botIsAdmin, botNum, meta };
  } catch (e) {
    if (debug) console.log(chalk.red('  [ADMIN DEBUG] getGroupAdminInfo failed: ' + e.message));
    return { admins: new Set(), superAdmins: new Set(), botIsAdmin: false, botNum: normNum(sock.user?.id || ''), meta: null };
  }
}

/**
 * THE CRITICAL FUNCTION – called once per group message before switch/case
 *
 * Sets:
 *   m.__senderIsAdmin  {boolean}
 *   m.__botIsAdmin     {boolean}
 *   m.__senderNum      {string}  – normalized sender number for reuse
 */
async function enrichWithAdminStatus(sock, m) {
  // Default safe values
  m.__senderIsAdmin = false;
  m.__botIsAdmin    = false;

  if (!m.key.remoteJid?.endsWith('@g.us')) return;

  // Get sender number – must strip device suffix
  // m.key.participant = "254704955033:7@s.whatsapp.net" in groups
  const rawSender = m.key.participant || m.key.remoteJid;
  const senderNum = normNum(rawSender);
  m.__senderNum   = senderNum;

  const DEBUG = process.env.ADMIN_DEBUG === '1';

  if (DEBUG) {
    console.log(chalk.cyan('\n  [ADMIN DEBUG] enrichWithAdminStatus'));
    console.log(chalk.gray('  rawSender   : ') + chalk.yellow(rawSender));
    console.log(chalk.gray('  senderNum   : ') + chalk.yellow(senderNum));
    console.log(chalk.gray('  group       : ') + chalk.gray(m.key.remoteJid));
  }

  const { admins, botIsAdmin } = await getGroupAdminInfo(sock, m.key.remoteJid, DEBUG);

  m.__senderIsAdmin = admins.has(senderNum);
  m.__botIsAdmin    = botIsAdmin;

  if (DEBUG) {
    console.log(chalk.gray('  senderAdmin : ') + (m.__senderIsAdmin ? chalk.green('YES') : chalk.red('NO')));
    console.log(chalk.gray('  botAdmin    : ') + (m.__botIsAdmin    ? chalk.green('YES') : chalk.red('NO')));
  }
}

/**
 * Resolve target JID from: quoted reply → @mention → number arg
 */
function getTargetJid(m, args) {
  // 1. Quoted/replied participant
  const rp = m.message?.extendedTextMessage?.contextInfo?.participant;
  if (rp && !rp.endsWith('@g.us')) return rp;  // must be a person not the group

  // 2. First @mention
  const mentions = m.message?.extendedTextMessage?.contextInfo?.mentionedJid;
  if (mentions?.length) return mentions[0];

  // 3. Number argument
  const n = String(args?.[0] || '').replace(/\D/g, '');
  if (n.length >= 7) return n + '@s.whatsapp.net';

  return null;
}

module.exports = { normNum, getGroupAdminInfo, enrichWithAdminStatus, getTargetJid };
