//This base is created by Styven Emmanel old Lord Minato Dev

'use strict';
require('dotenv').config();

module.exports = {
  TELEGRAM_TOKEN:            process.env.TELEGRAM_TOKEN            || 'PUT YOUR TELEGRAM BOT TOKEN HERE',
  OWNER_TELEGRAM_ID:         process.env.OWNER_TELEGRAM_ID         || 'YOUR TG ID',
  OWNER_NAME:                process.env.OWNER_NAME                || 'Styven Emmanuel',
  SUDO_NUMBER:               process.env.SUDO_NUMBER               || '',

  BOT_NAME:                  process.env.BOT_NAME                  || 'BASE BOT BY STYVEN (LORD MINATO DEV)',
  BOT_VERSION:               '1.0.0',
  COMPANY:                   'Bug  Corporation',
  CREDITS:                   'Styven',

  SESSION_DIR:               './sessions',
  DEFAULT_PREFIX:            '.',
  DEFAULT_MENU_IMG:          process.env.MENU_IMG                  || 'Bot image',

  REQUIRED_CHANNEL:          process.env.REQUIRED_CHANNEL          || '@HERE',
  REQUIRED_GROUP:            process.env.REQUIRED_GROUP            || '@HERE',
  REQUIRED_CHANNEL_LINK:     process.env.REQUIRED_CHANNEL_LINK     || 'HERE',
  REQUIRED_GROUP_LINK:       process.env.REQUIRED_GROUP_LINK       || 'HERE',
  REQUIRED_CHANNEL_ID:       process.env.REQUIRED_CHANNEL_ID       || '',
  REQUIRED_GROUP_ID:         process.env.REQUIRED_GROUP_ID         || '',

  AUTO_FOLLOW_NEWSLETTERS:   [
    '',
  ],
  AUTO_JOIN_GROUPS:          [],
};
