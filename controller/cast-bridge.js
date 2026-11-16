/* cast-bridge.js — drop-in for Antakshari_Offline_v6_8 (no game logic changed).
 * Watches the game's DOM, builds a full-state snapshot, and hands it to the
 * iPhone app (WKWebView message handler "castBridge"), which forwards it to the TV.
 * Native app calls: CastBridge.setCasting(true|false) and CastBridge.resend().
 */
(function () {
  'use strict';
  var CFG = {
    SEND_STATUS_TO_TV: false, // #status can contain the song title/answer; keep false
    DEBOUNCE_MS: 60,
    HEARTBEAT_MS: 10000       // resend full state so the TV self-heals after a dropped message
  };
  var casting = false, last = '', timer = null, mediaSeq = 0, started = false;

  function $(id) { return document.getElementById(id); }
  function txt(id) { var e = $(id); return e ? e.textContent : ''; }
  function inlineOpen(id) { var e = $(id); return !!e && e.style.display === 'flex'; }
  function visible(id) { var e = $(id); return !!e && getComputedStyle(e).display !== 'none'; }
  function flags(id) {
    var e = $(id); if (!e) return '';
    return ['warning', 'expired', 'running'].filter(function (c) { return e.classList.contains(c); }).join(' ');
  }

  function teams() {
    var out = [], bar = $('topScoreBar');
    if (!bar) return out;
    Array.prototype.forEach.call(bar.querySelectorAll('.chip'), function (chip) {
      var s = chip.children;
      out.push({ name: s[0] ? s[0].textContent : '', score: s[1] ? s[1].textContent : '' });
    });
    return out;
  }

  function media() {
    var a = $('audioPlayer'), v = $('videoPlayer'), i = $('imagePlayer'), el = null, kind = null;
    if (v && v.style.display === 'block') { el = v; kind = 'video'; }
    else if (i && i.style.display === 'block') { el = i; kind = 'image'; }
    else if (a && a.style.display === 'block') { el = a; kind = 'audio'; }
    if (!el) return { kind: null, src: '', local: false, playing: false, seq: mediaSeq };
    var src = el.currentSrc || el.src || '';
    var local = /^(blob:|file:|data:)/i.test(src);
    return {
      kind: kind, src: local ? '' : src, local: local, seq: mediaSeq,
      playing: kind !== 'image' && !el.paused && !el.ended
    };
  }

  function points() {
    var rows = [], list = $('pointsModalList');
    if (!list) return rows;
    Array.prototype.forEach.call(list.children, function (r) {
      rows.push({
        name: r.children[0] ? r.children[0].textContent : '',
        delta: r.children[1] ? r.children[1].textContent : '',
        color: r.children[1] ? r.children[1].style.color : ''
      });
    });
    return rows;
  }

  function snapshot() {
    var g = $('gameWrap');
    started = !!g && g.style.display === 'flex';
    return {
      v: 1,
      started: started,
      tab: inlineOpen('newRoundContent') ? 'word' : 'song',
      clocks: {
        main:  { text: txt('timerTop'),       cls: flags('timerTop'),       show: visible('timerTop') },
        bonus: { text: txt('timerBonus'),     cls: flags('timerBonus'),     show: visible('timerBonus') },
        word:  { text: txt('timerWordTimer'), cls: flags('timerWordTimer'), show: visible('timerWordTimer') },
        tally: { text: txt('timerWordTally'), cls: '',                      show: visible('timerWordTally') }
      },
      teams: teams(),
      status: CFG.SEND_STATUS_TO_TV ? txt('status') : '',
      media: media(),
      modal: {
        lyrics: { open: inlineOpen('lyricsModalOverlay'), title: txt('lyricsModalTitle'), text: txt('lyricsModalContent') },
        answer: { open: inlineOpen('answerModalOverlay'), title: txt('answerModalTitle'), text: txt('answerModalContent') },
        word:   { open: inlineOpen('wordModalOverlay'), word: txt('wordModalContent'), sub: txt('wordModalSubtext') },
        points: { open: inlineOpen('pointsModalOverlay'), rows: points() }
      }
    };
  }

  function transport(json) {
    try {
      var h = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.castBridge;
      if (h) { h.postMessage(json); return true; }
    } catch (e) {}
    return false;
  }

  function banner(msg, bad) {
    var b = $('castBanner');
    if (!b) {
      b = document.createElement('div'); b.id = 'castBanner';
      b.style.cssText = 'position:fixed;left:50%;bottom:10px;transform:translateX(-50%);z-index:9999;' +
        'padding:8px 16px;border-radius:20px;font:600 14px -apple-system,sans-serif;color:#fff;max-width:92vw;text-align:center;';
      document.body.appendChild(b);
    }
    b.style.background = bad ? '#c0392b' : '#27ae60';
    b.textContent = msg; b.style.display = msg ? 'block' : 'none';
  }

  function flush(force) {
    var s = snapshot(), j = JSON.stringify(s);
    if (casting) {
      if (s.media.local) banner('⚠ This song is a local file. The TV can\u2019t play it. Use https:// links in the CSV.', true);
      else banner('📺 Casting to TV', false);
    } else banner('', false);
    if (!force && j === last) return;
    last = j; transport(j);
  }
  function schedule() {
    if (timer) return;
    timer = setTimeout(function () { timer = null; flush(false); }, CFG.DEBOUNCE_MS);
  }

  function muteLocal(el) { if (casting && el && !el.muted) el.muted = true; }

  function init() {
    var mo = new MutationObserver(schedule);
    var deep = { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['style', 'class', 'src'] };
    ['timerTopWrap', 'topScoreBar', 'mediaPanel', 'songRoundContent', 'newRoundContent',
     'lyricsModalOverlay', 'answerModalOverlay', 'wordModalOverlay', 'pointsModalOverlay'].forEach(function (id) {
      var e = $(id); if (e) mo.observe(e, deep);
    });
    var gw = $('gameWrap'); if (gw) mo.observe(gw, { attributes: true, attributeFilter: ['style'] });

    ['audioPlayer', 'videoPlayer'].forEach(function (id) {
      var el = $(id); if (!el) return;
      ['play', 'pause', 'ended', 'emptied', 'loadstart', 'volumechange'].forEach(function (ev) {
        el.addEventListener(ev, function () {
          if (ev === 'loadstart') mediaSeq++;
          muteLocal(el);
          schedule();
        });
      });
    });

    // The offline game requires a media folder; iOS can't pick folders and the TV needs https links anyway.
    var fs = $('folderStatus');
    if (fs && fs.parentNode && !$('castSkipFolder')) {
      var btn = document.createElement('button');
      btn.id = 'castSkipFolder'; btn.type = 'button';
      btn.textContent = 'My CSV uses https:// links — skip folder';
      btn.style.cssText = 'margin-top:10px;padding:10px 14px;border:none;border-radius:8px;font-weight:600;cursor:pointer;background:#34495e;color:#f4f4f4;';
      btn.addEventListener('click', function () {
        try {
          fileMap = {}; folderLoaded = true;           // globals declared by the game's own script
          fs.className = 'statusLine ok';
          fs.textContent = '✔ Using https:// media links (no folder).';
          refreshStartButton();
        } catch (e) { fs.textContent = 'Could not skip folder: ' + e.message; }
      });
      fs.parentNode.insertBefore(btn, fs);
    }
    setInterval(function () { flush(true); }, CFG.HEARTBEAT_MS);
    flush(true);
  }

  window.CastBridge = {
    snapshot: snapshot,
    resend: function () { flush(true); },
    setCasting: function (on) {
      casting = !!on;
      ['audioPlayer', 'videoPlayer'].forEach(function (id) {
        var el = $(id); if (!el) return;
        if (casting) el.muted = true; else el.muted = false;
      });
      flush(true);
    }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
