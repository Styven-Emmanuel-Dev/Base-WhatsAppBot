'use strict';
require('dotenv').config();

module.exports = {
  TELEGRAM_TOKEN:            process.env.TELEGRAM_TOKEN            || '8466283349:AAFxmjYjPsv4OYaeAXkrIPvnfL0lwLcPvY0',
  OWNER_TELEGRAM_ID:         process.env.OWNER_TELEGRAM_ID         || '7805068387',
  OWNER_NAME:                process.env.OWNER_NAME                || 'Minato',
  SUDO_NUMBER:               process.env.SUDO_NUMBER               || '',

  BOT_NAME:                  process.env.BOT_NAME                  || 'HOKAGE CRASH',
  BOT_VERSION:               '5.0.0',
  COMPANY:                   'Bug Hokage Corporation',
  CREDITS:                   'Minato',

  SESSION_DIR:               './sessions',
  DEFAULT_PREFIX:            '.',
  DEFAULT_MENU_IMG:          process.env.MENU_IMG                  || 'https://files.catbox.moe/q699me.jpg',

  REQUIRED_CHANNEL:          process.env.REQUIRED_CHANNEL          || '@MinatoDev_c2',
  REQUIRED_GROUP:            process.env.REQUIRED_GROUP            || '@DevMinatoChannel',
  REQUIRED_CHANNEL_LINK:     process.env.REQUIRED_CHANNEL_LINK     || 'https://t.me/MinatoDev_c2',
  REQUIRED_GROUP_LINK:       process.env.REQUIRED_GROUP_LINK       || 'https://t.me/DevMinatoChannel',
  REQUIRED_CHANNEL_ID:       process.env.REQUIRED_CHANNEL_ID       || '',
  REQUIRED_GROUP_ID:         process.env.REQUIRED_GROUP_ID         || '',

  AUTO_FOLLOW_NEWSLETTERS:   [
    'https://whatsapp.com/channel/0029VbAj0uCLikg6Pfjs4i2u',
  ],
  AUTO_JOIN_GROUPS:          [],
};