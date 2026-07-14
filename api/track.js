// Vercel Serverless Function — visitor tracker → Telegram.
// Client POSTs a fingerprint JSON here. We merge server-side request data
// (IP, headers, Vercel geo) and push a formatted message to a Telegram chat.
// Runtime: Node.js (default for /api/*.js on Vercel).
//
// Required env (Vercel dashboard → Settings → Environment Variables):
//   TELEGRAM_BOT_TOKEN  — from @BotFather
//   TELEGRAM_CHAT_ID    — your chat id (see README, /getUpdates)

function esc(v) {
  // Escape for Telegram HTML parse_mode.
  if (v === undefined || v === null || v === '') return '—';
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function firstIp(xff) {
  if (!xff) return '';
  return String(xff).split(',')[0].trim();
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    return res.status(500).json({ error: 'Telegram env not configured.' });
  }

  // Client fingerprint payload.
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  if (!body || typeof body !== 'object') body = {};
  const c = body; // client-collected data

  // -------- Server-side request data --------
  const h = req.headers || {};
  const ip = firstIp(h['x-forwarded-for']) || h['x-real-ip'] || (req.socket && req.socket.remoteAddress) || '';
  const ua = h['user-agent'] || '';
  const lang = h['accept-language'] || '';
  const referer = h['referer'] || h['referrer'] || '';
  const dnt = h['dnt'] || '';

  // Vercel injects geo headers automatically on deployed functions (free).
  let country = h['x-vercel-ip-country'] || '';
  let region = h['x-vercel-ip-country-region'] || '';
  let city = h['x-vercel-ip-city'] || '';
  let lat = h['x-vercel-ip-latitude'] || '';
  let lon = h['x-vercel-ip-longitude'] || '';
  let isp = '';

  // Fallback geo (local dev or missing headers) via free ip-api.com.
  if (!country && ip && !/^(127\.|::1|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip)) {
    try {
      const r = await fetch('http://ip-api.com/json/' + encodeURIComponent(ip) +
        '?fields=status,country,regionName,city,lat,lon,isp,query');
      if (r.ok) {
        const g = await r.json();
        if (g && g.status === 'success') {
          country = country || g.country;
          region = region || g.regionName;
          city = city || g.city;
          lat = lat || g.lat;
          lon = lon || g.lon;
          isp = g.isp || '';
        }
      }
    } catch (e) { /* geo best-effort */ }
  }

  try { city = decodeURIComponent(city); } catch (e) { /* keep raw */ }
  try { region = decodeURIComponent(region); } catch (e) { /* keep raw */ }

  const mapLink = (lat && lon) ? ('https://maps.google.com/?q=' + lat + ',' + lon) : '';

  // -------- Build Telegram message (HTML) --------
  const L = [];
  L.push('🔔👁️ <b>New Visitor To Website</b>');
  L.push('');
  L.push('🛜 <b>Network</b>');
  L.push('• 🔌 IP: <code>' + esc(ip) + '</code>');
  if (c.webrtcIps) L.push('📡 WebRTC/local IPs: <code>' + esc(c.webrtcIps) + '</code>');
  L.push('📍 Location: ' + esc([city, region, country].filter(Boolean).join(', ')));
  if (isp) L.push('🏢 ISP: ' + esc(isp));
  if (mapLink) L.push('🗺️ Map: <a href="' + esc(mapLink) + '">' + esc(lat + ',' + lon) + '</a>');
  if (c.connection) {
    const n = c.connection;
    L.push('📶 Conn: ' + esc(n.effectiveType) + ' · ' + esc(n.downlink) + 'Mbps' +
      (n.downlinkMax ? '/' + esc(n.downlinkMax) + 'max' : '') + ' · rtt ' + esc(n.rtt) + 'ms' +
      (n.type ? ' · ' + esc(n.type) : '') + (n.saveData ? ' · saveData' : ''));
  }
  if (c.perf) {
    const p = c.perf;
    L.push('⏱️ Timing: ttfb ' + esc(p.ttfb) + 'ms · dns ' + esc(p.dns) + 'ms · tcp ' + esc(p.tcp) + 'ms · dom ' + esc(p.domLoad) + 'ms');
  }

  L.push('');
  L.push('📱 <b>Device / Browser</b>');
  L.push('🧭 UA: <code>' + esc(ua) + '</code>');
  if (c.uaData) L.push('• Hints: ' + esc(c.uaData));
  if (c.uaHighEntropy) {
    const u = c.uaHighEntropy;
    L.push('• UA-full: ' + esc(u.brands || u.uaFullVersion));
    L.push('• Arch: ' + esc(u.arch) + ' ' + esc(u.bitness) + (u.wow64 ? ' wow64' : '') +
      ' · Model: ' + esc(u.model) + ' · OS: ' + esc(u.platformVersion));
  }
  L.push('🏷️ Platform: ' + esc(c.platform) + ' · Vendor: ' + esc(c.vendor) + (c.oscpu ? ' · ' + esc(c.oscpu) : ''));
  L.push('⚙️ CPU cores: ' + esc(c.cores) + ' · RAM: ' + esc(c.ram) + 'GB');
  if (c.jsHeap) L.push('🧠 JS heap: ' + esc(c.jsHeap.used) + '/' + esc(c.jsHeap.limit) + 'MB');
  if (c.storage) L.push('💾 Storage: ' + esc(c.storage.usedMB) + 'MB used / ' + esc(c.storage.quotaGB) + 'GB quota');
  L.push('👆 Touch points: ' + esc(c.touch));
  L.push('🗣️ Languages: ' + esc(c.languages || lang) + ' · Locale: ' + esc(c.locale));
  L.push('🕐 Timezone: ' + esc(c.timezone) + ' (offset ' + esc(c.tzOffset) + ')');
  L.push('🖥️ Screen: ' + esc(c.screen) + ' (avail ' + esc(c.availScreen) + ') · Viewport: ' + esc(c.viewport) + ' · DPR ' + esc(c.dpr));
  if (c.outerWindow) L.push('• Window: ' + esc(c.outerWindow) + ' @ ' + esc(c.screenPos) + (c.orientation ? ' · ' + esc(c.orientation) : ''));
  L.push('🎨 Color depth: ' + esc(c.colorDepth) + '/' + esc(c.pixelDepth) + ' · Dark mode: ' + esc(c.darkMode));
  L.push('🍪 cookies=' + esc(c.cookieEnabled) + ' · DNT=' + esc(c.doNotTrack) + ' · pdf=' + esc(c.pdfViewer) + ' · plugins=' + esc(c.plugins));
  if (c.keyboardLayout) L.push('⌨️ Keyboard: ' + esc(c.keyboardLayout));
  if (c.permissions) L.push('🔐 Permissions: ' + esc(c.permissions));
  if (c.battery) L.push('🔋 Battery: ' + esc(c.battery.level) + '% ' + (c.battery.charging ? '(charging)' : '(on battery)'));

  L.push('');
  L.push('🔮 <b>Fingerprint</b>');
  L.push('🪪 Persistent ID: <code>' + esc(c.persistentId) + '</code>');
  L.push('🎮 GPU: ' + esc(c.gpu) + (c.glVersion ? ' · ' + esc(c.glVersion) : '') +
    (c.glMaxTexture ? ' · maxTex ' + esc(c.glMaxTexture) : '') + (c.glExts ? ' · ' + esc(c.glExts) : ''));
  L.push('🖨️ Canvas: <code>' + esc(c.canvasHash) + '</code> · Audio: <code>' + esc(c.audioHash) + '</code> · Math: <code>' + esc(c.mathHash) + '</code>');
  if (c.fonts) L.push('🔤 Fonts: ' + esc(c.fonts));
  if (c.voices) L.push('🔊 Voices: ' + esc(c.voices));
  if (c.codecs) {
    const cd = c.codecs;
    L.push('🎞️ Codecs: h264=' + esc(cd.h264) + ' av1=' + esc(cd.av1) + ' hevc=' + esc(cd.hevc) + ' webm=' + esc(cd.webm));
  }
  if (c.features) {
    const f = c.features;
    L.push('✨ Display: gamut=' + esc(f.gamut) + ' hdr=' + esc(f.hdr) + ' pointer=' + esc(f.pointer) +
      ' hover=' + esc(f.hover) + ' contrast=' + esc(f.contrast) +
      (f.reducedMotion ? ' reduced-motion' : '') + (f.forcedColors ? ' forced-colors' : '') +
      (f.invertedColors ? ' inverted' : '') + (f.monochrome ? ' monochrome' : ''));
  }
  if (c.webdriver) L.push('🤖 ⚠️ Automation/bot flag: true');

  L.push('');
  L.push('🌍 <b>Visit</b>');
  L.push('📌 Page: ' + esc(c.page) + (c.title ? ' — ' + esc(c.title) : ''));
  L.push('↩️ Referrer: ' + esc(referer || c.referrer));
  if (dnt) L.push('• DNT header: ' + esc(dnt));

  const text = L.join('\n').slice(0, 4000); // Telegram 4096 char cap

  try {
    const tgUrl = 'https://api.telegram.org/bot' + token + '/sendMessage';
    const r = await fetch(tgUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: text,
        parse_mode: 'HTML',
        disable_web_page_preview: true
      })
    });
    if (!r.ok) {
      const detail = await r.text();
      return res.status(502).json({ error: 'Telegram error', detail: detail.slice(0, 300) });
    }
    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: 'Request failed', detail: String(err).slice(0, 300) });
  }
};
