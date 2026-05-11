// ============================================================
//   helper/welcomeImg.js  – Generate welcome card image
//   Uses canvas (node-canvas). Falls back to plain text if unavailable.
// ============================================================
'use strict';

const axios = require('axios');
const path  = require('path');
const fs    = require('fs');

// Try loading canvas – if not installed, fallback to text
let createCanvas, loadImage, registerFont;
try {
  ({ createCanvas, loadImage, registerFont } = require('canvas'));
} catch { /* canvas not installed */ }

async function fetchImageBuffer(url) {
  if (!url) return null;
  try {
    const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 8000 });
    return Buffer.from(res.data);
  } catch { return null; }
}

// Draw a circle-clipped image onto canvas context
function drawCircleImg(ctx, img, x, y, r) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  ctx.drawImage(img, x - r, y - r, r * 2, r * 2);
  ctx.restore();
}

// Generate welcome card buffer (PNG)
async function generateWelcomeCard(opts = {}) {
  const {
    userName    = 'New Member',
    groupName   = 'Group',
    userPpUrl   = null,
    groupPpUrl  = null,
  } = opts;

  if (!createCanvas) return null; // no canvas, caller sends text

  const W = 800, H = 400;
  const canvas = createCanvas(W, H);
  const ctx    = canvas.getContext('2d');

  // Background gradient
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0,   '#0f0c29');
  bg.addColorStop(0.5, '#302b63');
  bg.addColorStop(1,   '#24243e');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Decorative circles
  ctx.globalAlpha = 0.08;
  for (let i = 0; i < 6; i++) {
    ctx.beginPath();
    ctx.arc(Math.random()*W, Math.random()*H, 60 + Math.random()*80, 0, Math.PI*2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Border glow
  ctx.strokeStyle = '#7c3aed';
  ctx.lineWidth   = 4;
  ctx.strokeRect(8, 8, W-16, H-16);

  // Group PP (left circle)
  const groupPpBuf = await fetchImageBuffer(groupPpUrl);
  if (groupPpBuf) {
    try {
      const gImg = await loadImage(groupPpBuf);
      drawCircleImg(ctx, gImg, 130, 180, 90);
      // ring
      ctx.beginPath();
      ctx.arc(130, 180, 94, 0, Math.PI*2);
      ctx.strokeStyle = '#7c3aed';
      ctx.lineWidth   = 4;
      ctx.stroke();
    } catch {}
  } else {
    // Placeholder circle
    ctx.beginPath();
    ctx.arc(130, 180, 90, 0, Math.PI*2);
    ctx.fillStyle = '#4c1d95';
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 40px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(groupName[0] || 'G', 130, 195);
  }

  // User PP (right circle)
  const userPpBuf = await fetchImageBuffer(userPpUrl);
  if (userPpBuf) {
    try {
      const uImg = await loadImage(userPpBuf);
      drawCircleImg(ctx, uImg, 670, 180, 90);
      ctx.beginPath();
      ctx.arc(670, 180, 94, 0, Math.PI*2);
      ctx.strokeStyle = '#06b6d4';
      ctx.lineWidth   = 4;
      ctx.stroke();
    } catch {}
  } else {
    ctx.beginPath();
    ctx.arc(670, 180, 90, 0, Math.PI*2);
    ctx.fillStyle = '#164e63';
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 40px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(userName[0] || 'U', 670, 195);
  }

  // Center heart / join icon
  ctx.font      = '52px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('❤️', W/2, 190);

  // Welcome text
  ctx.fillStyle  = '#ffffff';
  ctx.font       = 'bold 36px sans-serif';
  ctx.textAlign  = 'center';
  ctx.shadowColor = '#7c3aed';
  ctx.shadowBlur  = 12;
  ctx.fillText('WELCOME', W/2, 280);

  ctx.shadowBlur = 0;
  ctx.fillStyle  = '#c4b5fd';
  ctx.font       = 'bold 28px sans-serif';
  // truncate long names
  const uName = userName.length > 22 ? userName.slice(0,22)+'…' : userName;
  ctx.fillText(uName, W/2, 320);

  ctx.fillStyle  = '#94a3b8';
  ctx.font       = '20px sans-serif';
  const gName = groupName.length > 30 ? groupName.slice(0,30)+'…' : groupName;
  ctx.fillText(`to ${gName}`, W/2, 356);

  return canvas.toBuffer('image/png');
}

module.exports = { generateWelcomeCard };
