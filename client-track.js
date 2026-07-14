/* ============================================================
   Visitor tracker (client). Collects silent, no-permission data
   and POSTs once per browser session to /api/track.
   No popups, no geolocation/camera/mic prompts.
   Everything here runs without triggering a permission dialog.
   ============================================================ */
(function () {
  'use strict';

  // Fire once per tab session (avoids re-sending on SPA route changes / reloads).
  try {
    if (sessionStorage.getItem('_t_sent')) return;
  } catch (e) { /* sessionStorage may be blocked; continue once */ }

  // Tiny non-crypto hash → short stable fingerprint id.
  function hash(str) {
    var h = 5381, i = str.length;
    while (i) { h = (h * 33) ^ str.charCodeAt(--i); }
    return (h >>> 0).toString(36);
  }

  // Persistent supercookie: survives tab close (localStorage), unlike the
  // sessionStorage send-guard. Lets the server correlate repeat visits.
  function persistentId() {
    try {
      var id = localStorage.getItem('_t_id');
      if (!id) {
        id = (hash(String(navigator.userAgent) + screen.width + 'x' + screen.height) +
          hash(String(performance.now()) + navigator.languages));
        localStorage.setItem('_t_id', id);
        return id + ' (new)';
      }
      return id;
    } catch (e) { return 'na'; }
  }

  function canvasFP() {
    try {
      var cv = document.createElement('canvas');
      var ctx = cv.getContext('2d');
      ctx.textBaseline = 'top';
      ctx.font = "14px 'Arial'";
      ctx.fillStyle = '#f60';
      ctx.fillRect(125, 1, 62, 20);
      ctx.fillStyle = '#069';
      ctx.fillText('Cwm fjordbank 😃 1234', 2, 15);
      ctx.fillStyle = 'rgba(102,204,0,0.7)';
      ctx.fillText('Cwm fjordbank 😃 1234', 4, 17);
      return hash(cv.toDataURL());
    } catch (e) { return 'na'; }
  }

  function webglInfo() {
    try {
      var cv = document.createElement('canvas');
      var gl = cv.getContext('webgl2') || cv.getContext('webgl') || cv.getContext('experimental-webgl');
      if (!gl) return { gpu: 'na' };
      var dbg = gl.getExtension('WEBGL_debug_renderer_info');
      var gpu = dbg ? (gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) + ' / ' +
        gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : 'hidden';
      var exts = '';
      try { exts = (gl.getSupportedExtensions() || []).length + ' ext'; } catch (e2) {}
      var maxTex = '';
      try { maxTex = String(gl.getParameter(gl.MAX_TEXTURE_SIZE)); } catch (e3) {}
      var ver = '';
      try { ver = gl.getParameter(gl.VERSION); } catch (e4) {}
      return { gpu: gpu, glVersion: ver, glExts: exts, glMaxTexture: maxTex };
    } catch (e) { return { gpu: 'na' }; }
  }

  function audioFP() {
    // Synchronous-ish offline render hash. Best-effort; returns short string.
    try {
      var AC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      if (!AC) return 'na';
      var ctx = new AC(1, 44100, 44100);
      var osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = 10000;
      var comp = ctx.createDynamicsCompressor();
      osc.connect(comp);
      comp.connect(ctx.destination);
      osc.start(0);
      return new Promise(function (resolve) {
        ctx.oncomplete = function (e) {
          var d = e.renderedBuffer.getChannelData(0);
          var sum = 0;
          for (var i = 0; i < d.length; i += 1000) { sum += Math.abs(d[i]); }
          resolve(hash(String(sum)));
        };
        ctx.startRendering();
        setTimeout(function () { resolve('timeout'); }, 600);
      });
    } catch (e) { return 'na'; }
  }

  function detectFonts() {
    try {
      var base = ['monospace', 'sans-serif', 'serif'];
      var test = ['Arial', 'Verdana', 'Times New Roman', 'Courier New', 'Georgia',
        'Comic Sans MS', 'Impact', 'Tahoma', 'Trebuchet MS', 'Segoe UI', 'Roboto',
        'Helvetica', 'Calibri', 'Cambria'];
      var s = document.createElement('span');
      s.style.cssText = 'position:absolute;left:-9999px;font-size:72px';
      s.textContent = 'mmmmmmmmmmlli';
      document.body.appendChild(s);
      var def = {};
      base.forEach(function (b) {
        s.style.fontFamily = b;
        def[b] = { w: s.offsetWidth, h: s.offsetHeight };
      });
      var found = [];
      test.forEach(function (f) {
        var hit = base.some(function (b) {
          s.style.fontFamily = "'" + f + "'," + b;
          return s.offsetWidth !== def[b].w || s.offsetHeight !== def[b].h;
        });
        if (hit) found.push(f);
      });
      document.body.removeChild(s);
      return found.join(', ');
    } catch (e) { return ''; }
  }

  // JS engine / math fingerprint — float rounding differs by engine/CPU/OS.
  function mathFP() {
    try {
      var ops = [
        Math.tan(-1e300), Math.sin(1e300), Math.cos(1e300), Math.exp(1),
        Math.log(Math.PI), Math.atan(2), Math.acosh(1e308), Math.expm1(1),
        Math.sinh(1), Math.cbrt(100), Math.pow(Math.PI, -100)
      ];
      return hash(ops.join(','));
    } catch (e) { return 'na'; }
  }

  // Media codec support matrix — silent, no playback.
  function codecs() {
    try {
      var v = document.createElement('video');
      var a = document.createElement('audio');
      function p(el, t) { try { return el.canPlayType(t) || 'no'; } catch (e) { return 'no'; } }
      return {
        h264: p(v, 'video/mp4; codecs="avc1.42E01E"'),
        webm: p(v, 'video/webm; codecs="vp9"'),
        av1: p(v, 'video/mp4; codecs="av01.0.05M.08"'),
        hevc: p(v, 'video/mp4; codecs="hvc1"'),
        ogg: p(a, 'audio/ogg; codecs="vorbis"'),
        aac: p(a, 'audio/aac'),
        flac: p(a, 'audio/flac')
      };
    } catch (e) { return null; }
  }

  // CSS / media-query environment probes (all read-only, no prompt).
  function cssFeatures() {
    function mm(q) { try { return window.matchMedia(q).matches; } catch (e) { return false; } }
    function gamut() {
      if (mm('(color-gamut: rec2020)')) return 'rec2020';
      if (mm('(color-gamut: p3)')) return 'p3';
      if (mm('(color-gamut: srgb)')) return 'srgb';
      return '?';
    }
    function pointer() {
      if (mm('(pointer: fine)')) return 'fine';
      if (mm('(pointer: coarse)')) return 'coarse';
      if (mm('(pointer: none)')) return 'none';
      return '?';
    }
    return {
      gamut: gamut(),
      hdr: mm('(dynamic-range: high)'),
      pointer: pointer(),
      hover: mm('(hover: hover)'),
      reducedMotion: mm('(prefers-reduced-motion: reduce)'),
      reducedData: mm('(prefers-reduced-data: reduce)'),
      contrast: mm('(prefers-contrast: more)') ? 'more' : (mm('(prefers-contrast: less)') ? 'less' : 'normal'),
      invertedColors: mm('(inverted-colors: inverted)'),
      forcedColors: mm('(forced-colors: active)'),
      monochrome: mm('(monochrome)')
    };
  }

  // Navigation/resource timing — TTFB, DNS, TCP, DOM load (no prompt).
  function perfTiming() {
    try {
      var e = performance.getEntriesByType('navigation')[0];
      if (!e) return null;
      return {
        type: e.type,
        dns: Math.round(e.domainLookupEnd - e.domainLookupStart),
        tcp: Math.round(e.connectEnd - e.connectStart),
        ttfb: Math.round(e.responseStart - e.requestStart),
        domLoad: Math.round(e.domContentLoadedEventEnd),
        redirects: e.redirectCount
      };
    } catch (e) { return null; }
  }

  function jsHeap() {
    try {
      var m = performance.memory;
      if (!m) return null;
      return { used: Math.round(m.usedJSHeapSize / 1048576), limit: Math.round(m.jsHeapSizeLimit / 1048576) };
    } catch (e) { return null; }
  }

  // ---- async, no-permission collectors ----

  // WebRTC leaks local/LAN IPs behind NAT without any prompt.
  function webrtcIps() {
    return new Promise(function (resolve) {
      try {
        var RTC = window.RTCPeerConnection || window.webkitRTCPeerConnection || window.mozRTCPeerConnection;
        if (!RTC) return resolve([]);
        var pc = new RTC({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
        var ips = {};
        var done = false;
        function finish() { if (done) return; done = true; try { pc.close(); } catch (e) {} resolve(Object.keys(ips)); }
        pc.onicecandidate = function (ev) {
          if (!ev || !ev.candidate || !ev.candidate.candidate) return finish();
          var m = /([0-9]{1,3}(\.[0-9]{1,3}){3}|[a-f0-9]{1,4}(:[a-f0-9]{1,4}){7})/i.exec(ev.candidate.candidate);
          if (m) ips[m[1]] = 1;
        };
        pc.createDataChannel('x');
        pc.createOffer().then(function (o) { return pc.setLocalDescription(o); }).catch(function () { finish(); });
        setTimeout(finish, 800);
      } catch (e) { resolve([]); }
    });
  }

  // Permission states — readable WITHOUT triggering the actual prompt.
  function permissionStates() {
    try {
      if (!navigator.permissions || !navigator.permissions.query) return Promise.resolve(null);
      var names = ['geolocation', 'notifications', 'camera', 'microphone', 'clipboard-read', 'persistent-storage'];
      return Promise.all(names.map(function (n) {
        return navigator.permissions.query({ name: n }).then(function (r) { return n + '=' + r.state; }).catch(function () { return null; });
      })).then(function (arr) { return arr.filter(Boolean).join(', '); }).catch(function () { return null; });
    } catch (e) { return Promise.resolve(null); }
  }

  function storageQuota() {
    try {
      if (!navigator.storage || !navigator.storage.estimate) return Promise.resolve(null);
      return navigator.storage.estimate().then(function (e) {
        return { quotaGB: Math.round((e.quota || 0) / 1073741824 * 10) / 10, usedMB: Math.round((e.usage || 0) / 1048576) };
      }).catch(function () { return null; });
    } catch (e) { return Promise.resolve(null); }
  }

  function keyboardLayout() {
    try {
      if (!navigator.keyboard || !navigator.keyboard.getLayoutMap) return Promise.resolve(null);
      return navigator.keyboard.getLayoutMap().then(function (map) {
        var q = map.get('KeyQ'), w = map.get('KeyW');
        return [q, w].filter(Boolean).join('') || ('size=' + map.size);
      }).catch(function () { return null; });
    } catch (e) { return Promise.resolve(null); }
  }

  // High-entropy UA client hints — model, full version, arch, bitness.
  function uaHighEntropy() {
    try {
      if (!navigator.userAgentData || !navigator.userAgentData.getHighEntropyValues) return Promise.resolve(null);
      return navigator.userAgentData.getHighEntropyValues([
        'architecture', 'bitness', 'model', 'platformVersion', 'uaFullVersion', 'fullVersionList', 'wow64'
      ]).then(function (h) {
        return {
          arch: h.architecture, bitness: h.bitness, model: h.model,
          platformVersion: h.platformVersion, uaFullVersion: h.uaFullVersion,
          wow64: h.wow64,
          brands: (h.fullVersionList || []).map(function (b) { return b.brand + ' ' + b.version; }).join(', ')
        };
      }).catch(function () { return null; });
    } catch (e) { return Promise.resolve(null); }
  }

  function voices() {
    try {
      if (!window.speechSynthesis) return 'na';
      var v = window.speechSynthesis.getVoices() || [];
      return v.length ? (v.length + ' voices · ' + v.slice(0, 3).map(function (x) { return x.name; }).join(', ')) : '0 (async)';
    } catch (e) { return 'na'; }
  }

  function gather(audioHash, asyncVals) {
    var nav = navigator, scr = screen;
    var wgl = webglInfo();
    var data = {
      persistentId: persistentId(),
      page: location.pathname + location.hash,
      title: document.title,
      referrer: document.referrer,
      platform: nav.platform,
      vendor: nav.vendor,
      product: nav.product,
      oscpu: nav.oscpu || '',
      cookieEnabled: nav.cookieEnabled,
      doNotTrack: nav.doNotTrack,
      pdfViewer: nav.pdfViewerEnabled,
      plugins: (nav.plugins ? nav.plugins.length : 0),
      uaData: nav.userAgentData ? (nav.userAgentData.platform + ' · mobile=' + nav.userAgentData.mobile) : '',
      cores: nav.hardwareConcurrency,
      ram: nav.deviceMemory,
      touch: nav.maxTouchPoints,
      languages: (nav.languages || [nav.language]).join(', '),
      timezone: (Intl.DateTimeFormat().resolvedOptions().timeZone) || '',
      tzOffset: new Date().getTimezoneOffset(),
      locale: (Intl.DateTimeFormat().resolvedOptions().locale) || '',
      screen: scr.width + 'x' + scr.height,
      availScreen: scr.availWidth + 'x' + scr.availHeight,
      viewport: window.innerWidth + 'x' + window.innerHeight,
      outerWindow: window.outerWidth + 'x' + window.outerHeight,
      screenPos: window.screenX + ',' + window.screenY,
      orientation: (scr.orientation ? (scr.orientation.type + ' ' + scr.orientation.angle) : ''),
      dpr: window.devicePixelRatio,
      colorDepth: scr.colorDepth,
      pixelDepth: scr.pixelDepth,
      darkMode: window.matchMedia('(prefers-color-scheme: dark)').matches,
      webdriver: nav.webdriver === true,
      gpu: wgl.gpu,
      glVersion: wgl.glVersion,
      glExts: wgl.glExts,
      glMaxTexture: wgl.glMaxTexture,
      canvasHash: canvasFP(),
      audioHash: audioHash,
      mathHash: mathFP(),
      fonts: detectFonts(),
      voices: voices(),
      codecs: codecs(),
      features: cssFeatures(),
      perf: perfTiming(),
      jsHeap: jsHeap()
    };

    if (nav.connection) {
      data.connection = {
        effectiveType: nav.connection.effectiveType,
        downlink: nav.connection.downlink,
        downlinkMax: nav.connection.downlinkMax,
        rtt: nav.connection.rtt,
        type: nav.connection.type,
        saveData: nav.connection.saveData
      };
    }

    asyncVals = asyncVals || {};
    if (asyncVals.webrtc && asyncVals.webrtc.length) data.webrtcIps = asyncVals.webrtc.join(', ');
    if (asyncVals.permissions) data.permissions = asyncVals.permissions;
    if (asyncVals.storage) data.storage = asyncVals.storage;
    if (asyncVals.keyboard) data.keyboardLayout = asyncVals.keyboard;
    if (asyncVals.uaHE) data.uaHighEntropy = asyncVals.uaHE;
    return data;
  }

  function send(data) {
    try { sessionStorage.setItem('_t_sent', '1'); } catch (e) {}
    var json = JSON.stringify(data);
    // sendBeacon survives page unload; fetch keepalive as fallback.
    try {
      if (navigator.sendBeacon) {
        var blob = new Blob([json], { type: 'application/json' });
        if (navigator.sendBeacon('/api/track', blob)) return;
      }
    } catch (e) {}
    fetch('/api/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: json,
      keepalive: true
    }).catch(function () {});
  }

  function run() {
    // Resolve all async, no-permission collectors, then send one payload.
    var audioP = Promise.resolve(audioFP());
    var battP = (navigator.getBattery ? navigator.getBattery() : Promise.resolve(null))
      .catch(function () { return null; });
    var webrtcP = webrtcIps();
    var permP = permissionStates();
    var storeP = storageQuota();
    var kbP = keyboardLayout();
    var uaHeP = uaHighEntropy();

    Promise.all([audioP, battP, webrtcP, permP, storeP, kbP, uaHeP]).then(function (vals) {
      var data = gather(vals[0], {
        webrtc: vals[2], permissions: vals[3], storage: vals[4], keyboard: vals[5], uaHE: vals[6]
      });
      var b = vals[1];
      if (b) data.battery = { level: Math.round(b.level * 100), charging: b.charging };
      send(data);
    }).catch(function () {
      send(gather('na', {}));
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }
})();
