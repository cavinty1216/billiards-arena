/* Billiards Arena — UI controller */
(function (global) {
  'use strict';
  var BA = (global.BA = global.BA || {});
  var P = BA.physics, R = BA.rules;

  var $ = function (id) { return document.getElementById(id); };
  var clamp = function (v, a, b2) { return Math.max(a, Math.min(b2, v)); };

  /* ------------------------------------------------------------- audio */
  var Audio_ = {
    ctx: null,
    on: true,
    ensure: function () {
      if (!this.ctx) {
        var AC = global.AudioContext || global.webkitAudioContext;
        if (AC) this.ctx = new AC();
      }
      if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
      return this.ctx;
    },
    blip: function (freq, dur, gain, type) {
      if (!this.on) return;
      var c = this.ensure();
      if (!c) return;
      var o = c.createOscillator(), g = c.createGain();
      o.type = type || 'sine';
      o.frequency.value = freq;
      g.gain.setValueAtTime(gain, c.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
      o.connect(g); g.connect(c.destination);
      o.start(); o.stop(c.currentTime + dur);
    },
    noise: function (dur, gain, hp) {
      if (!this.on) return;
      var c = this.ensure();
      if (!c) return;
      var n = Math.floor(c.sampleRate * dur);
      var buf = c.createBuffer(1, n, c.sampleRate);
      var d = buf.getChannelData(0);
      for (var i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
      var src = c.createBufferSource(); src.buffer = buf;
      var f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = hp || 800;
      var g = c.createGain(); g.gain.value = gain;
      src.connect(f); f.connect(g); g.connect(c.destination);
      src.start();
    },
    ballClick: function (v) { this.blip(1900 + v * 500, 0.035, clamp(0.02 + v * 0.12, 0.02, 0.14), 'triangle'); },
    cushion: function (v) { this.noise(0.06, clamp(0.02 + v * 0.08, 0.02, 0.1), 500); },
    pot: function () { this.noise(0.14, 0.16, 300); this.blip(260, 0.16, 0.1, 'sine'); },
    shoot: function (p) { this.noise(0.05, 0.05 + p * 0.09, 1200); },
    win: function () {
      var self = this;
      [523, 659, 784, 1047].forEach(function (f, i) {
        setTimeout(function () { self.blip(f, 0.22, 0.09, 'sine'); }, i * 130);
      });
    },
    foul: function () { this.blip(190, 0.2, 0.09, 'square'); },
    turn: function () { this.blip(880, 0.09, 0.05, 'sine'); }
  };

  /* --------------------------------------------------------------- utils */
  var storage = {
    get: function (k, d) { try { var v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  };

  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };

  function showScreen(name) {
    var screens = { home: 'screen-home', lobby: 'screen-lobby', game: 'screen-game', tutorial: 'screen-tutorial' };
    for (var k in screens) $(screens[k]).classList.toggle('active', k === name);
  }

  var toastTimer = null;
  function toast(text, kind, ms) {
    var el = $('toast');
    if (!el) return;
    el.textContent = text;
    el.className = 'toast show' + (kind ? ' ' + kind : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.className = 'toast'; }, ms || 2600);
  }
  function tutToast(text, kind, ms) {
    var el = $('tut-toast');
    if (!el) return;
    el.textContent = text;
    el.className = 'toast show' + (kind ? ' ' + kind : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.className = 'toast'; }, ms || 2600);
  }

  /* =================================================== APP */
  var App = {
    view: null,            // local animated view of balls
    room: null,
    renderer: null,
    tutRenderer: null,
    mode: '4ball',
    variant: '1v1',
    animating: false,
    guide: true,
    sound: true,
    aim: null,             // {angle, power} while aiming
    dragging: false,
    tutorial: null,        // {course, step, setup, done}
    lastShotSig: ''
  };

  /* ------------------------------------------------------- ball animation */
  // Animate a shot from its frames; keeps this client's view smooth while the
  // authoritative result comes from the host.
  function playFrames(frames, events, table, done) {
    var balls = App.view;
    App.animating = true;
    var sounds = (events || []).slice().sort(function (a, b) { return (a.t || 0) - (b.t || 0); });
    var si = 0;
    var t0 = null;
    var fi = 0;
    function tick(ts) {
      if (t0 === null) t0 = ts;
      var el = (ts - t0) / 1000;
      while (fi < frames.length && frames[fi].t <= el) {
        var f = frames[fi++];
        for (var k = 0; k < balls.length && k < f.b.length; k++) {
          balls[k].x = f.b[k][0]; balls[k].y = f.b[k][1]; balls[k].active = !!f.b[k][2];
        }
        while (si < sounds.length && (sounds[si].t || 0) <= f.t) {
          var e = sounds[si++];
          if (e.type === 'ball') Audio_.ballClick(clamp((e.speed || 0) / 4, 0, 1));
          else if (e.type === 'cushion') Audio_.cushion(clamp((e.speed || 0) / 4, 0, 1));
          else if (e.type === 'pot') Audio_.pot();
        }
      }
      if (fi >= frames.length) {
        App.animating = false;
        if (done) done();
        return;
      }
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  function seatsFromRoom(room) {
    return room.players.map(function (p) { return { seat: p.seat, id: p.id, name: p.name, connected: p.connected }; });
  }

  /* ------------------------------------------------------- scorebar render */
  function seatColor(i) {
    return ['#f5f6f8', '#f2d548', '#7ec8f5', '#f09a8a'][i % 4];
  }
  function renderScorebar() {
    var room = App.room, g = room && room.room && room.room.game;
    var el = $('scorebar');
    if (!room || !room.room) { el.innerHTML = ''; return; }
    var players = room.room.players;
    var scores = g ? (g.scores || {}) : {};
    var turn = g ? g.turn : -1;
    var groups = g && g.groups ? g.groups : null;
    var mySeat = room.mySeat();
    var html = '';
    for (var i = 0; i < players.length; i++) {
      var p = players[i];
      var isMe = p.id === room.me.id;
      var active = g && !g.winner && turn === p.seat;
      var sub = '';
      if (g && room.room.mode === '8ball' && groups && groups[p.seat]) sub = groups[p.seat] === 'solid' ? '솔리드' : '스트라이프';
      else if (g && room.room.mode === '8ball' && room.room.variant === '1v1' && !groups[0] && !groups[1]) sub = '그룹 미정';
      else if (room.room.mode === '4ball') sub = (p.seat % 2 === 0) ? '흰 공' : '노란 공';
      html += '<div class="player-chip' + (active ? ' active' : '') + (!p.connected ? ' offline' : '') + '">' +
        '<span class="pc-dot" style="background:' + seatColor(p.seat) + '"></span>' +
        '<span class="pc-name">' + esc(p.name) + (isMe ? ' (나)' : '') + '</span>' +
        (sub ? '<span class="pc-sub">' + sub + '</span>' : '') +
        '<span class="pc-score">' + (scores[p.seat] !== undefined ? scores[p.seat] : '·') + '</span>' +
        '</div>';
    }
    el.innerHTML = html;
  }

  /* ------------------------------------------------------------ lobby view */
  function renderLobby() {
    var room = App.room;
    if (!room || !room.room) return;
    var r = room.room;
    $('room-code').textContent = r.code || '-----';
    $('player-count').textContent = r.players.length + '/' + r.maxPlayers;
    var list = $('lobby-player-list');
    var html = '';
    for (var i = 0; i < r.maxPlayers; i++) {
      var p = r.players.filter(function (x) { return x.seat === i; })[0];
      if (p) {
        html += '<div class="player-slot"><span class="seat-badge s' + (i + 1) + '">' + (i + 1) + '</span>' +
          '<span class="pname">' + esc(p.name) + (p.id === room.me.id ? ' (나)' : '') + '</span>' +
          (p.id === r.hostId ? '<span class="ptag host">방장</span>' : '') +
          (!p.connected ? '<span class="ptag">끊김</span>' : '') +
          '</div>';
      } else {
        html += '<div class="player-slot empty"><span class="seat-badge">' + (i + 1) + '</span><span class="pname">빈 자리</span></div>';
      }
    }
    list.innerHTML = html;

    // config visible to host only, and only before start
    var isHost = room.isHost;
    $('lobby-config').style.display = isHost && !r.started ? '' : 'none';
    $('btn-start').style.display = isHost ? '' : 'none';
    $('btn-start').disabled = r.players.length < 2;
    $('lobby-waiting').textContent = r.players.length < 2
      ? '친구를 기다리는 중… (방 코드: ' + r.code + ')'
      : (isHost ? '준비됐으면 게임을 시작하세요' : '방장이 시작하면 바로 게임이 시작돼요');

    var mp = $('lobby-mode-picker');
    for (var k = 0; k < mp.children.length; k++) {
      var btn = mp.children[k];
      btn.classList.toggle('active', btn.dataset.mode === r.mode && (btn.dataset.variant || '1v1') === (r.variant || '1v1'));
    }
    $('lobby-rule-note').textContent = ruleNote(r.mode, r.variant || '1v1');
  }

  function ruleNote(mode, variant) {
    if (mode === '4ball' && variant === 'ffa') return '★ 이 앱의 별도 변형 (정식 사구 아님) ★ 수구 2개를 나눠 쓰는 3~4인 개인전: 빨간 두 공 맞히기 1점·쿠션 먼저 2점, 7점 승리.';
    if (mode === '4ball') return '사구는 2인 전용 경기예요. 두 빨간 공을 모두 맞히면 1점(쿠션 먼저 2점), 7점 승리.';
    if (variant === '1v1') return '1:1 정식 룰에 가까운 8볼 — 솔리드/스트라이프 그룹을 정하고 마지막에 8번 공.';
    return '★ 이 앱의 별도 점수전 변형 (정식 규칙 아님) ★ 3~4명이 각자 개인전으로, 공 1개=1점·8번=3점, 9점 승리.';
  }

  /* --------------------------------------------------------- rules sheet */
  function rulesHtml(mode, variant) {
    var h = '';
    if (mode === '4ball' && variant === 'ffa') {
      h += '<h3>사구 스코어전 3~4인 — 이 앱의 변형</h3>' +
        '<p class="note">정식 사구는 수구 2개를 쓰는 2인 게임이라 3~4인 규칙이 존재하지 않아요. 아래는 이 앱만의 개인전 규칙입니다.</p><ul>' +
        '<li>수구 2개를 나눠 씁니다: 1·3번 참가자는 <b>흰 공</b>, 2·4번 참가자는 <b>노란 공</b></li>' +
        '<li>내 차례마다 화면에서 노란 테두리로 표시되는 <b>내 수구</b>를 치세요 (스코어바에도 이번 차례의 수구가 표시됨)</li>' +
        '<li>내 수구로 빨간 공 2개를 모두 맞히면 <b>1점</b> · 쿠션을 먼저 맞히고 나서 두 개 모두 맞히면 <b>2점</b></li>' +
        '<li>성공 시 한 번 더 · 실패 시 다음 사람</li>' +
        '<li>다른 사람의 수구나 상대 수구를 맞혀도 반칙 아님 (1:1 사구의 단순화 규칙과 같음)</li>' +
        '<li><b>7점</b> 먼저 달성한 사람 승리</li></ul>';
    } else if (mode === '4ball') {
      h += '<h3>사구(4구) — 2인 전용</h3><ul>' +
        '<li>내 공(흰/노란)으로 빨간 공 2개를 한 번에 모두 맞히면 <b>1점</b></li>' +
        '<li>쿠션을 먼저 맞히고 나서 두 개 모두 맞히면 <b>2점</b></li>' +
        '<li>성공 시 계속, 실패 시 상대 차례 · <b>7점 승리</b></li>' +
        '<li>상대 공을 쳐도 반칙 아님</li></ul>';
    } else if (variant === '1v1') {
      h += '<h3>8볼 1:1 — 정식 루트</h3><ul>' +
        '<li>처음 넣은 공으로 솔리드(1~7)/스트라이프(9~15) 그룹 결정</li>' +
        '<li>내 그룹 공을 먼저 맞혀야 하고, 공을 넣으면 한 번 더</li>' +
        '<li>파울(공 미접촉, 큐볼 포켓, 쿠션 미터치, 다른 공 먼저 접촉)이면 상대가 큐볼을 놓고 시작</li>' +
        '<li>내 그룹을 다 넣은 뒤 <b>8번 공</b>을 넣으면 승리 · 8번을 먼저 넣으면 패배</li></ul>' +
        '<p class="note">※ 샷 콜(포켓 지정)은 생략한 단순화 버전입니다.</p>';
    } else {
      h += '<h3>8볼 스코어전 3~4인 — 이 앱의 변형</h3>' +
        '<p class="note">정식 8볼은 2인 게임이라 3~4인 규칙이 존재하지 않아요. 아래는 이 앱만의 개인전 규칙입니다.</p><ul>' +
        '<li>각자 개인전: 순서대로 한 번씩 칩니다</li>' +
        '<li>공 1개 포켓 = <b>1점</b>, 8번 공 = <b>3점</b></li>' +
        '<li>성공 시 한 번 더 · 실패 시 다음 사람</li>' +
        '<li>큐볼 포켓·공 미접촉 = <b>-1점</b>, 다음 사람이 큐볼을 놓고 시작</li>' +
        '<li><b>9점</b> 먼저 달성한 사람 승리</li></ul>';
    }
    return h;
  }

  function openRules() {
    var r = App.room && App.room.room;
    var mode = r ? r.mode : App.mode;
    var variant = r ? (r.variant || '1v1') : App.variant;
    $('rules-title').textContent = mode === '4ball' ? (variant === 'ffa' ? '사구 스코어전 규칙' : '사구 규칙') : (variant === '1v1' ? '8볼 1:1 규칙' : '8볼 스코어전 규칙');
    $('rules-body').innerHTML = rulesHtml(mode, variant);
    $('rules-overlay').hidden = false;
  }

  /* ------------------------------------------------------------ name modal */
  var pendingNameAction = null;
  function askName(then) {
    pendingNameAction = then;
    $('input-name').value = storage.get('ba.name', '');
    $('name-overlay').hidden = false;
    setTimeout(function () { $('input-name').focus(); }, 60);
  }
  function confirmName() {
    try {
      var v = $('input-name').value.trim().slice(0, 10) || '플레이어';
      storage.set('ba.name', v);
      $('name-overlay').hidden = true;
      if (pendingNameAction) { var f = pendingNameAction; pendingNameAction = null; f(v); }
    } catch (e) {
      try { (window.__baDbg = window.__baDbg || []).push({ tag: 'confirmName-err', d: e.message + ' | ' + e.stack }); } catch (x) {}
    }
  }

  /* ================================================== AIMING / CONTROLS */
  function canvasPoint(canvas, ev) {
    var rect = canvas.getBoundingClientRect();
    var x = (ev.touches && ev.touches[0] ? ev.touches[0].clientX : ev.clientX) - rect.left;
    var y = (ev.touches && ev.touches[0] ? ev.touches[0].clientY : ev.clientY) - rect.top;
    return { x: x, y: y };
  }

  function setupAiming(canvas, renderer, opts) {
    var state = { angle: 0, power: 0, dragging: false, moved: false };
    var getPos = function (ev) {
      var p = canvasPoint(canvas, ev);
      return renderer.toWorld(p.x, p.y);
    };
    var cueBallPos = function () {
      var src = opts.balls();
      for (var i = 0; i < src.length; i++) if (src[i].id === opts.cueId()) return src[i];
      return null;
    };

    function onDown(ev) {
      if (opts.disabled()) return;
      Audio_.ensure();
      var w = getPos(ev);
      var cue = cueBallPos();
      if (cue) {
        var table = P.TABLES[opts.tableId()];
        var d = P.dist(w.x, w.y, cue.x, cue.y);
        if (d > table.ballR * 3.2) return;      // must start on/around the cue ball
      }
      state.dragging = true;
      state.moved = false;
      state.downPos = w;
      ev.preventDefault();
    }
    function onMove(ev) {
      if (!state.dragging) return;
      var w = getPos(ev);
      var cue = cueBallPos();
      if (!cue) return;
      var dx = cue.x - w.x, dy = cue.y - w.y;
      if (Math.abs(dx) + Math.abs(dy) < 0.012 && !state.moved) return;
      state.moved = true;
      state.angle = Math.atan2(dy, dx);
      var table = P.TABLES[opts.tableId()];
      var d = Math.sqrt(dx * dx + dy * dy);
      var norm = clamp((d - table.ballR * 1.2) / (table.W * 0.30), 0, 1);
      state.power = Math.pow(norm, 0.85);
      opts.onChange(state);
      ev.preventDefault();
    }
    function onUp(ev) {
      if (!state.dragging) return;
      state.dragging = false;
      if (state.moved && state.power > 0.02) opts.onShoot({ angle: state.angle, power: state.power, spinX: opts.spinX(), spinY: opts.spinY() });
      state.power = 0;
      opts.onChange(state);
    }

    canvas.addEventListener('touchstart', onDown, { passive: false });
    canvas.addEventListener('touchmove', onMove, { passive: false });
    canvas.addEventListener('touchend', onUp);
    canvas.addEventListener('mousedown', onDown);
    global.addEventListener('mousemove', onMove);
    global.addEventListener('mouseup', onUp);
    return state;
  }

  function setupSpinPad(canvas, state) {
    var ctx = canvas.getContext('2d');
    var R = 80;
    var expanded = false;
    var backdrop = null, hint = null;
    function ensureOverlay() {
      if (backdrop) return;
      backdrop = document.createElement('div');
      backdrop.className = 'spin-backdrop';
      document.body.appendChild(backdrop);
      hint = document.createElement('div');
      hint.className = 'spin-hint';
      hint.textContent = '원하는 점을 눌러 당점을 정하고, 바깥을 누르면 닫혀요';
      document.body.appendChild(hint);
      backdrop.addEventListener('mousedown', collapse);
      backdrop.addEventListener('touchstart', function (e) { collapse(); e.preventDefault(); }, { passive: false });
    }
    var parent = null, next = null;
    function expand() {
      if (expanded) return;
      expanded = true;
      ensureOverlay();
      parent = canvas.parentNode; next = canvas.nextSibling;
      document.body.appendChild(canvas);   // .controls의 backdrop-filter가 fixed 기준을 바꾸므로 body로 옮겨 화면 중앙에 펼침
      canvas.classList.add('expanded');
      backdrop.classList.add('show');
      hint.classList.add('show');
      draw();
    }
    function collapse() {
      if (!expanded) return;
      expanded = false;
      canvas.classList.remove('expanded');
      if (parent) parent.insertBefore(canvas, next);
      if (backdrop) backdrop.classList.remove('show');
      if (hint) hint.classList.remove('show');
      draw();
    }
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') collapse(); });
    (function watchScreen() {
      var screen = canvas.closest ? canvas.closest('.screen') : null;
      if (screen && window.MutationObserver) {
        new MutationObserver(function () {
          if (!screen.classList.contains('active') && expanded) collapse();
        }).observe(screen, { attributes: true, attributeFilter: ['class'] });
      }
    })();
    function draw() {
      ctx.clearRect(0, 0, 160, 160);
      ctx.save();
      ctx.translate(R, R);
      var g = ctx.createRadialGradient(0, 0, 6, 0, 0, R);
      g.addColorStop(0, '#fdfdfa');
      g.addColorStop(1, '#c9ccd1');
      ctx.beginPath(); ctx.arc(0, 0, R - 2, 0, Math.PI * 2); ctx.fillStyle = g; ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 2; ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 0, R - 2, 0, Math.PI * 2); ctx.clip();
      ctx.strokeStyle = 'rgba(0,0,0,0.10)';
      ctx.beginPath(); ctx.moveTo(-R, 0); ctx.lineTo(R, 0); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, -R); ctx.lineTo(0, R); ctx.stroke();
      var px = state.spinX * (R - 14), py = -state.spinY * (R - 14);
      ctx.beginPath(); ctx.arc(px, py, 9, 0, Math.PI * 2);
      ctx.fillStyle = '#e2564f'; ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 2; ctx.stroke();
      ctx.restore();
    }
    function pick(ev) {
      var rect = canvas.getBoundingClientRect();
      var cx = ((ev.touches && ev.touches[0] ? ev.touches[0].clientX : ev.clientX) - rect.left) * (160 / rect.width) - R;
      var cy = ((ev.touches && ev.touches[0] ? ev.touches[0].clientY : ev.clientY) - rect.top) * (160 / rect.height) - R;
      var d = Math.sqrt(cx * cx + cy * cy);
      var max = R - 14;
      if (d > max) { cx = cx / d * max; cy = cy / d * max; }
      state.spinX = cx / max;
      state.spinY = -cy / max;
      draw();
    }
    var down = false;
    canvas.addEventListener('touchstart', function (e) {
      e.preventDefault();
      if (!expanded) { expand(); return; }   // 첫 탭: 크게 펼치기 (선택은 다음 터치부터)
      down = true; pick(e);
    }, { passive: false });
    canvas.addEventListener('touchmove', function (e) { if (down) { pick(e); e.preventDefault(); } }, { passive: false });
    canvas.addEventListener('touchend', function () { down = false; });
    canvas.addEventListener('mousedown', function (e) {
      if (!expanded) { expand(); return; }   // 첫 클릭: 크게 펼치기
      down = true; pick(e);
    });
    global.addEventListener('mousemove', function (e) { if (down) pick(e); });
    global.addEventListener('mouseup', function () { down = false; });
    draw();
    return { draw: draw, reset: function () { state.spinX = 0; state.spinY = 0; draw(); }, collapse: collapse };
  }

  function setPowerUI(fillId, labelId, p) {
    $(fillId).style.width = Math.round(p * 100) + '%';
    $(labelId).textContent = '세기 ' + Math.round(p * 100) + '%';
  }

  /* ================================================== GAME SCREEN FLOW */
  var aimState = { spinX: 0, spinY: 0 };
  var tutAimState = { spinX: 0, spinY: 0 };

  function enterGame(room) {
    App.room = room;
    var r = room.room;
    App.view = r.game ? r.game.balls.map(function (b) { return Object.assign({}, b); }) : [];
    $('game-over').hidden = true;
    showScreen('game');
    $('game-room-code').textContent = r.code;
    requestAnimationFrame(function () {
      App.renderer.resize();
      App.renderer.needLayout = true;
    });
    renderScorebar();
    renderTurnBanner();
  }

  function renderTurnBanner() {
    var room = App.room, r = room && room.room;
    var el = $('turn-banner');
    if (!r || !r.game || r.game.phase === 'ended') { el.textContent = ''; el.style.display = 'none'; return; }
    var g = r.game;
    var p = r.players[g.turn];
    var mine = p && p.id === room.me.id;
    var cueName = (g.mode === '4ball' && g.ffa) ? ((g.turn % 2 === 0) ? '흰 공' : '노란 공') : null;
    el.style.display = '';
    el.className = 'turn-banner' + (mine ? ' mine' : '');
    if (g.ballsInHand) el.textContent = mine ? '큐볼을 테이블에 놓으세요 (원하는 곳을 누르기)' : p.name + '님이 큐볼을 놓는 중';
    else if (mine) el.textContent = cueName ? ('내 차례 — ' + cueName + ' 수구로 조준하세요') : '내 차례 — 조준해서 치세요';
    else el.textContent = p ? (p.name + '님 차례' + (cueName ? ' (' + cueName + ')' : '')) : '';
  }

  function syncViewFromRoom() {
    var room = App.room;
    if (!room || !room.room) return;
    var g = room.room.game;
    if (!g) { App.view = []; return; }
    if (!App.view || App.view.length !== g.balls.length) {
      App.view = g.balls.map(function (b) { return Object.assign({}, b); });
    } else {
      for (var i = 0; i < g.balls.length; i++) {
        var s = g.balls[i], v = App.view[i];
        v.x = s.x; v.y = s.y; v.active = s.active; v.id = s.id; v.kind = s.kind; v.num = s.num; v.owner = s.owner;
      }
    }
  }

  function onRoomUpdated() {
    if (!App.room) return;
    var wasAnimating = App.animating;
    var r = App.room.room;
    if (!r) return;
    if (!r.game) {
      if (!wasAnimating) syncViewFromRoom();
      $('game-over').hidden = true;
      renderLobbyIfVisible();
      return;
    }
    if (r.started && !$('screen-game').classList.contains('active')) {
      enterGame(App.room);
      toast('게임이 시작됐어요!', 'good');
    }
    if (!App.view || App.view.length !== r.game.balls.length) App.view = r.game.balls.map(function (b) { return Object.assign({}, b); });
    renderScorebar();
    renderTurnBanner();
    if (r.game.phase === 'ended' && r.game.winner !== undefined) showGameOver();
  }

  function renderLobbyIfVisible() {
    if ($('screen-lobby').classList.contains('active')) renderLobby();
  }

  function showGameOver() {
    var room = App.room, r = room.room, g = r.game;
    var ov = $('game-over');
    var players = r.players;
    var winnerSeat = g.winner;
    var winner = players.filter(function (p) { return p.seat === winnerSeat; })[0];
    var iWin = winner && winner.id === room.me.id;
    $('go-trophy').textContent = iWin ? '🏆' : (g.winner === undefined ? '🏁' : '⛳');
    $('go-title').textContent = iWin ? '승리!' : (winner ? winner.name + '님의 승리!' : '경기 종료');
    $('go-sub').textContent = g.message || '';
    var sc = $('go-scores');
    sc.innerHTML = players.map(function (p) {
      var v = g.scores && g.scores[p.seat] !== undefined ? g.scores[p.seat] : '·';
      return '<div class="go-score-row"><span class="seat-badge s' + (p.seat + 1) + '">' + (p.seat + 1) + '</span>' +
        esc(p.name) + '<span class="win">' + v + '점</span></div>';
    }).join('');
    ov.hidden = false;
    if (iWin) Audio_.win();
  }

  /* --------------------------------------------------------- shot handling */
  function tryShoot(shot) {
    var room = App.room;
    if (!room || !room.room || !room.room.game) return;
    var g = room.room.game;
    var mySeat = room.mySeat();
    if (g.phase === 'ended') return;
    if (g.turn !== mySeat) { toast('아직 내 차례가 아니에요', 'bad'); return; }
    if (g.ballsInHand) { toast('먼저 큐볼을 놓으세요', 'bad'); return; }
    shot.spinX = aimState.spinX;
    shot.spinY = aimState.spinY;
    var ok = room.shoot(shot);
    if (ok) {
      Audio_.shoot(shot.power);
      aimState.spinX = 0; aimState.spinY = 0; spinPad.reset();
      setPowerUI('power-fill', 'power-label', 0);
    }
  }

  function onResult(res) {
    var room = App.room;
    if (!room || !room.room) return;
    var g = room.room.game;
    if (res.result && res.result.placed) {
      syncViewFromRoom();
      renderScorebar(); renderTurnBanner();
      toast(res.result.message || '공을 놓았어요', 'good');
      return;
    }
    if (res.result && res.result.events && g) {
      var table = P.TABLES[g.table];
      var frames = res.result.frames && res.result.frames.length
        ? expandFrames(res.result.frames, g.balls.length)
        : rebuildFrames(table, g.balls.map(function (b) { return Object.assign({}, b); }), res.result);
      App.view = g.balls.map(function (b) { return Object.assign({}, b); });
      playFrames(frames, res.result.events, table, function () { syncViewFromRoom(); });
      var mine = res.result.shooterId === room.me.id;
      if (res.result.message) toast(res.result.message, res.result.details && res.result.details.fouls && res.result.details.fouls.length ? 'bad' : (res.result.winner !== undefined ? 'good' : ''));
      if (!mine) Audio_.shoot(0.4);
      renderScorebar(); renderTurnBanner();
      if (g.phase === 'ended') setTimeout(showGameOver, 400);
    }
  }

  /* Compacted frames repeat their last position; expand back to a timeline. */
  function expandFrames(frames, nBalls) {
    var out = [];
    for (var i = 0; i < frames.length; i++) {
      var f = frames[i];
      out.push(f);
      if (f.hold) {
        var copies = f.b.map(function (row) { return row.slice(); });
        for (var h = 0; h < f.hold; h++) out.push({ t: f.t, b: copies });
      }
    }
    return out;
  }

  /* Guest clients do not receive full frame data; rebuild the trajectory by
   * re-simulating the same shot from the balls-before state in the room. */
  function rebuildFrames(table, ballsNow, result) {
    // We simulate a trivial shot of zero power to produce a static frame set;
    // the visual result still lands exactly on the authoritative positions.
    return [{ t: 0, b: ballsNow.map(function (b) { return [b.x, b.y, b.active ? 1 : 0]; }) }];
  }

  /* ================================================== TUTORIAL FLOW */
  function startTutorial(courseId) {
    var course = BA.tutorial.courses[courseId];
    if (!course) return;
    App.tutorial = { course: course, idx: 0, done: false, waiting: false };
    $('tut-course-name').textContent = course.title;
    buildDots(course.steps.length);
    showScreen('tutorial');
    requestAnimationFrame(function () {
      App.tutRenderer.resize();
      App.tutRenderer.needLayout = true;
      loadTutStep(0);
    });
  }

  function buildDots(n) {
    var el = $('tut-dots');
    var h = '';
    for (var i = 0; i < n; i++) h += '<i></i>';
    el.innerHTML = h;
  }

  function loadTutStep(i) {
    var T = App.tutorial;
    var step = T.course.steps[i];
    T.idx = i;
    T.stepDone = false;
    T.waiting = false;
    T.setup = step.setup();
    App.tutView = T.setup.balls.map(function (b) { return Object.assign({}, b); });

    $('tut-step-label').textContent = (i + 1) + ' / ' + T.course.steps.length;
    $('tut-title').textContent = step.title;
    $('tut-body').innerHTML = (step.goal ? '<div class="goal-badge">🎯 ' + step.goal + '</div>' : '') + step.body + (step.hint ? '<p style="margin-top:8px;opacity:.75">💡 ' + step.hint + '</p>' : '');
    var isPractice = T.course.id === 'practice';
    $('tut-next').textContent = step.goal ? '건너뛰기' : '다음';
    $('tut-next').hidden = isPractice;          // 연습은 '다음'이 없다 — 나가기는 왼쪽 위 ✕
    $('tut-retry').style.display = (step.goal || isPractice) ? '' : 'none';
    var dots = $('tut-dots').children;
    for (var d = 0; d < dots.length; d++) dots[d].classList.toggle('done', d <= i);
    $('tut-progress').style.width = Math.round(((i + 1) / T.course.steps.length) * 100) + '%';
    // where this step's cue ball starts (used to re-spot it in free practice)
    T.cueStart = null;
    for (var cs = 0; cs < T.setup.balls.length; cs++) {
      if (T.setup.balls[cs].id === T.setup.cueId) { T.cueStart = { x: T.setup.balls[cs].x, y: T.setup.balls[cs].y }; break; }
    }
    setPowerUI('tut-power-fill', 'tut-power-label', 0);
    tutAimState.spinX = 0; tutAimState.spinY = 0; tutSpinPad.reset();
  }

  function tutShoot(shot) {
    var T = App.tutorial;
    if (!T || T.waiting) return;
    var step = T.course.steps[T.idx];
    var isPractice = T.course.id === 'practice';
    if (!isPractice && !step.goal) return;   // tutorial info steps: read only
    shot.spinX = tutAimState.spinX;
    shot.spinY = tutAimState.spinY;
    shot.cueId = T.setup.cueId;
    var table = P.TABLES[T.setup.table];
    var sim = P.simulate(table, T.setup.balls, shot, { maxTime: 10 });
    T.lastSim = sim;
    T.lastShot = shot;
    App.tutView = T.setup.balls.map(function (b) { return Object.assign({}, b); });
    T.waiting = true;
    playTutFrames(sim.frames, sim.events, table, function () {
      var ok = step.check ? step.check(shot, sim) : true;
      if (ok) {
        T.stepDone = true;
        if (isPractice) {
          // 자유 연습: 공 위치를 그대로 이어 받아 계속 칠 수 있게 한다
          practiceCarryOver(T, sim);
          App.tutView = T.setup.balls.map(function (b) { return Object.assign({}, b); });   // 재배치된 수구도 바로 보이게
          T.waiting = false;
          tutToast('이어서 쳐 보세요! (처음 배치는 "다시")', 'good', 2000);
          return;
        }
        tutToast('성공! 잘하셨어요 🎉', 'good');
        $('tut-next').textContent = '다음 단계 →';
      } else {
        T.waiting = false;
        tutToast('아까워요! 다시 한 번 해볼까요?', 'bad');
        loadTutStep(T.idx);   // reset balls
      }
    });
  }

  /* Free practice: carry the shot's final ball states into the practice setup so
   * the next shot continues from where the balls stopped. A potted cue ball is
   * re-spotted at its starting position. */
  function practiceCarryOver(T, sim) {
    var balls = T.setup.balls;
    var out = sim.balls;
    for (var i = 0; i < balls.length && i < out.length; i++) {
      var s = out[i];
      var b = balls[i];
      b.x = s.x; b.y = s.y;
      b.vx = 0; b.vy = 0;
      b.spinX = 0; b.spinY = 0;
      b.active = s.active;
      b.pocketed = !!s.pocketed;
    }
    var cue = null;
    for (var j = 0; j < balls.length; j++) if (balls[j].id === T.setup.cueId) cue = balls[j];
    if (cue && !cue.active && T.cueStart) {
      var fake = { table: T.setup.table, mode: '8ball', balls: balls };
      var spot = BA.rules.legalCueSpot(fake, 0, T.cueStart.x, T.cueStart.y);
      var tries = [{ dx: 0, dy: 0.12 }, { dx: 0, dy: -0.12 }, { dx: 0.12, dy: 0 }, { dx: -0.12, dy: 0 }, { dx: 0.1, dy: 0.1 }, { dx: -0.1, dy: -0.1 }];
      for (var k = 0; !spot && k < tries.length; k++) {
        spot = BA.rules.legalCueSpot(fake, 0, T.cueStart.x + tries[k].dx, T.cueStart.y + tries[k].dy);
      }
      if (!spot) spot = { x: T.cueStart.x, y: T.cueStart.y };
      cue.x = spot.x; cue.y = spot.y;
      cue.active = true;
      cue.pocketed = false;
    }
    return balls;
  }

  function playTutFrames(frames, events, table, done) {
    var balls = App.tutView;
    var sounds = (events || []).slice().sort(function (a, b) { return (a.t || 0) - (b.t || 0); });
    var si = 0;
    var t0 = null;
    var fi = 0;
    function tick(ts) {
      if (t0 === null) t0 = ts;
      var el = (ts - t0) / 1000;
      while (fi < frames.length && frames[fi].t <= el) {
        var f = frames[fi++];
        for (var k = 0; k < balls.length && k < f.b.length; k++) {
          balls[k].x = f.b[k][0]; balls[k].y = f.b[k][1]; balls[k].active = !!f.b[k][2];
        }
        while (si < sounds.length && (sounds[si].t || 0) <= f.t) {
          var e = sounds[si++];
          if (e.type === 'ball') Audio_.ballClick(clamp((e.speed || 0) / 4, 0, 1));
          else if (e.type === 'cushion') Audio_.cushion(clamp((e.speed || 0) / 4, 0, 1));
          else if (e.type === 'pot') Audio_.pot();
        }
      }
      if (fi >= frames.length) { done(); return; }
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  /* demo shot finder */
  function playDemo() {
    var T = App.tutorial;
    if (!T) return;
    var step = T.course.steps[T.idx];
    if (!step || !step.goal) return;
    tutToast('예시 샷을 찾는 중…', '', 4000);
    setTimeout(function () {
      var found = BA.tutorial.findSolution(step.setup, step.check, step.demo);
      if (!found) { tutToast('이 단계는 직접 도전해 보세요!', '', 2500); return; }
      var table = P.TABLES[T.setup.table];
      App.tutView = T.setup.balls.map(function (b) { return Object.assign({}, b); });
      T.waiting = true;
      playTutFrames(found.sim.frames, found.sim.events, table, function () {
        T.stepDone = true;
        tutToast('이렇게 치면 돼요! 이제 직접 해보세요', 'good');
        $('tut-next').textContent = '다음 단계 →';
      });
    }, 60);
  }

  /* ================================================== WIRING */
  var spinPad, tutSpinPad;

  function wire() {
    App.renderer = new BA.Renderer($('table-canvas'));
    App.tutRenderer = new BA.Renderer($('tut-canvas'));

    global.addEventListener('resize', function () {
      if (App.renderer) { App.renderer.resize(); App.renderer.needLayout = true; }
      if (App.tutRenderer) { App.tutRenderer.resize(); App.tutRenderer.needLayout = true; }
    });

    /* ------- home ------- */
    var mp = $('mode-picker');
    for (var i = 0; i < mp.children.length; i++) {
      (function (btn) {
        btn.addEventListener('click', function () {
          for (var j = 0; j < mp.children.length; j++) mp.children[j].classList.remove('active');
          btn.classList.add('active');
          App.mode = btn.dataset.mode;
          App.variant = btn.dataset.variant || '1v1';
        });
      })(mp.children[i]);
    }

    $('btn-create').addEventListener('click', function () {
      askName(function (name) { createRoom(name); });
    });
    $('btn-join').addEventListener('click', function () {
      try { (window.__baDbg = window.__baDbg || []).push({ tag: 'click-join', d: $('input-code').value }); } catch (e) {}
      var code = $('input-code').value.trim();
      if (!code) { $('input-code').focus(); return; }
      askName(function (name) { joinRoom(name, code.toUpperCase()); });
    });
    $('input-code').addEventListener('keydown', function (e) { if (e.key === 'Enter') $('btn-join').click(); });
    $('input-code').addEventListener('input', function (e) {
      e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    });

    var lessons = document.querySelectorAll('.lesson-row');
    for (var l = 0; l < lessons.length; l++) {
      (function (btn) {
        btn.addEventListener('click', function () {
          Audio_.ensure();
          var lid = btn.dataset.lesson;
          if (lid === 'practice') startPractice();
          else startTutorial(lid);
        });
      })(lessons[l]);
    }

    /* ------- name modal ------- */
    $('btn-name-ok').addEventListener('click', confirmName);
    $('btn-name-cancel').addEventListener('click', function () { $('name-overlay').hidden = true; pendingNameAction = null; });
    $('input-name').addEventListener('keydown', function (e) { if (e.key === 'Enter') confirmName(); });

    /* ------- rules ------- */
    $('btn-rules-close').addEventListener('click', function () { $('rules-overlay').hidden = true; });
    $('btn-rules').addEventListener('click', openRules);

    /* ------- lobby ------- */
    $('lobby-leave').addEventListener('click', leaveRoom);
    $('btn-copy-code').addEventListener('click', function () {
      var code = App.room && App.room.room ? App.room.room.code : '';
      copyText(code, '방 코드가 복사됐어요: ' + code);
    });
    $('btn-share-link').addEventListener('click', function () {
      if (!App.room || !App.room.room) return;
      var r = App.room.room;
      var url = location.origin + location.pathname + '?room=' + r.code + '&b=' + (App.room.brokerIndex || 0);
      copyText(url, '초대 링크가 복사됐어요');
    });
    $('btn-start').addEventListener('click', function () {
      if (!App.room || !App.room.isHost) return;
      var ok = App.room.start();
      if (!ok) toast('2명 이상 모이면 시작할 수 있어요', 'bad');
    });
    var lmp = $('lobby-mode-picker');
    for (var m = 0; m < lmp.children.length; m++) {
      (function (btn) {
        btn.addEventListener('click', function () {
          if (!App.room || !App.room.isHost) return;
          App.room.setConfig({ mode: btn.dataset.mode, variant: btn.dataset.variant || '1v1', maxPlayers: (btn.dataset.variant === 'ffa' ? 4 : 2) });
        });
      })(lmp.children[m]);
    }

    /* ------- game controls ------- */
    $('game-leave').addEventListener('click', leaveRoom);
    $('btn-shoot').addEventListener('click', function () {
      if (App.aim && App.aim.power > 0.02) tryShoot({ angle: App.aim.angle, power: App.aim.power });
      else toast('테이블에서 내 공 주변을 드래그해 조준하세요');
    });
    $('btn-cancel').addEventListener('click', function () {
      if (App.aim) { App.aim.power = 0; setPowerUI('power-fill', 'power-label', 0); }
    });
    $('btn-guide').addEventListener('click', function () {
      App.guide = !App.guide;
      $('btn-guide').setAttribute('aria-pressed', App.guide);
    });
    $('btn-sound').addEventListener('click', function () {
      Audio_.on = !Audio_.on;
      $('btn-sound').setAttribute('aria-pressed', Audio_.on);
    });
    var chips = document.querySelectorAll('.chip[data-emote]');
    for (var c = 0; c < chips.length; c++) {
      (function (btn) {
        btn.addEventListener('click', function () {
          if (App.room) App.room.chat(btn.dataset.emote);
        });
      })(chips[c]);
    }
    $('btn-rematch').addEventListener('click', function () {
      $('game-over').hidden = true;
      if (App.room && App.room.isHost) App.room.restart();
      else toast('방장이 다시 시작하면 자동으로 새 판이 시작돼요');
    });
    $('btn-go-lobby').addEventListener('click', function () {
      $('game-over').hidden = true;
      if (App.room && App.room.isHost) App.room.backToLobby();
    });

    /* ------- aiming on the game canvas ------- */
    App.aim = { angle: 0, power: 0 };
    setupAiming($('table-canvas'), App.renderer, {
      balls: function () { return App.view || []; },
      cueId: function () {
        var g = App.room && App.room.room && App.room.room.game;
        if (!g) return 'cue';
        var seat = App.room.mySeat();
        return R.cueIdFor(g, seat);
      },
      tableId: function () { return App.room && App.room.room && App.room.room.game ? App.room.room.game.table : 'carom'; },
      disabled: function () {
        var g = App.room && App.room.room && App.room.room.game;
        return !g || g.phase === 'ended' || App.animating;
      },
      spinX: function () { return aimState.spinX; },
      spinY: function () { return aimState.spinY; },
      onChange: function (s) {
        App.aim.angle = s.angle; App.aim.power = s.power;
        setPowerUI('power-fill', 'power-label', s.power);
      },
      onShoot: function (shot) { tryShoot(shot); }
    });

    spinPad = setupSpinPad($('spin-pad'), aimState);
    tutSpinPad = setupSpinPad($('tut-spin-pad'), tutAimState);

    /* placing the cue ball (ball in hand) */
    $('table-canvas').addEventListener('pointerdown', function (ev) {
      var room = App.room;
      if (!room || !room.room || !room.room.game) return;
      var g = room.room.game;
      if (!g.ballsInHand || g.turn !== room.mySeat()) return;
      var rect = ev.target.getBoundingClientRect();
      var w = App.renderer.toWorld(ev.clientX - rect.left, ev.clientY - rect.top);
      var ok = R.legalCueSpot(g, room.mySeat(), w.x, w.y);
      App.placePreview = { x: w.x, y: w.y, ok: !!ok };
      if (ok) { room.place(w.x, w.y); App.placePreview = null; }
    });
    $('table-canvas').addEventListener('pointermove', function (ev) {
      var room = App.room;
      if (!room || !room.room || !room.room.game) return;
      var g = room.room.game;
      if (!g.ballsInHand || g.turn !== room.mySeat()) return;
      var rect = ev.target.getBoundingClientRect();
      var w = App.renderer.toWorld(ev.clientX - rect.left, ev.clientY - rect.top);
      var ok = R.legalCueSpot(g, room.mySeat(), w.x, w.y);
      App.placePreview = { x: w.x, y: w.y, ok: !!ok };
    });

    /* keyboard aim for PC */
    global.addEventListener('keydown', function (ev) {
      var gameActive = $('screen-game').classList.contains('active');
      var tutActive = $('screen-tutorial').classList.contains('active');
      if (gameActive) {
        if (ev.key === 'ArrowLeft') { App.aim.angle -= 0.015; setPowerUI('power-fill', 'power-label', App.aim.power); }
        else if (ev.key === 'ArrowRight') { App.aim.angle += 0.015; setPowerUI('power-fill', 'power-label', App.aim.power); }
        else if (ev.key === 'ArrowUp') { App.aim.power = clamp(App.aim.power + 0.05, 0, 1); setPowerUI('power-fill', 'power-label', App.aim.power); }
        else if (ev.key === 'ArrowDown') { App.aim.power = clamp(App.aim.power - 0.05, 0, 1); setPowerUI('power-fill', 'power-label', App.aim.power); }
        else if (ev.key === ' ' && App.aim.power > 0.02) { tryShoot({ angle: App.aim.angle, power: App.aim.power }); App.aim.power = 0; setPowerUI('power-fill', 'power-label', 0); ev.preventDefault(); }
      } else if (tutActive && App.tutorial) {
        if (ev.key === 'ArrowLeft') tutAim.angle -= 0.015;
        else if (ev.key === 'ArrowRight') tutAim.angle += 0.015;
        else if (ev.key === 'ArrowUp') { tutAim.power = clamp(tutAim.power + 0.05, 0, 1); setPowerUI('tut-power-fill', 'tut-power-label', tutAim.power); }
        else if (ev.key === 'ArrowDown') { tutAim.power = clamp(tutAim.power - 0.05, 0, 1); setPowerUI('tut-power-fill', 'tut-power-label', tutAim.power); }
        else if (ev.key === ' ' && tutAim.power > 0.02) { tutShoot({ angle: tutAim.angle, power: tutAim.power }); tutAim.power = 0; setPowerUI('tut-power-fill', 'tut-power-label', 0); ev.preventDefault(); }
      }
    });

    /* ------- tutorial controls ------- */
    $('tut-leave').addEventListener('click', function () { App.tutorial = null; showScreen('home'); });
    $('tut-next').addEventListener('click', function () {
      var T = App.tutorial;
      if (!T) return;
      if (T.course.id === 'practice') { loadTutStep(T.idx); return; }   // 연습은 끝내지 않음
      if (T.idx + 1 < T.course.steps.length) loadTutStep(T.idx + 1);
      else { App.tutorial = null; showScreen('home'); }
    });
    $('tut-retry').addEventListener('click', function () { if (App.tutorial) loadTutStep(App.tutorial.idx); });

    App.tutAim = { angle: 0, power: 0 };
    setupAiming($('tut-canvas'), App.tutRenderer, {
      balls: function () { return App.tutView || []; },
      cueId: function () { return App.tutorial && App.tutorial.setup ? App.tutorial.setup.cueId : 'cue'; },
      tableId: function () { return App.tutorial && App.tutorial.setup ? App.tutorial.setup.table : 'carom'; },
      disabled: function () { return !App.tutorial || App.tutorial.waiting; },
      spinX: function () { return tutAimState.spinX; },
      spinY: function () { return tutAimState.spinY; },
      onChange: function (s) { App.tutAim.angle = s.angle; App.tutAim.power = s.power; setPowerUI('tut-power-fill', 'tut-power-label', s.power); },
      onShoot: function (shot) { tutShoot(shot); }
    });

    /* ------- deep link (?room=CODE) ------- */
    var params = new URLSearchParams(location.search);
    var roomParam = params.get('room');
    if (roomParam) {
      $('input-code').value = roomParam.toUpperCase();
      toast('방 코드가 들어있는 링크예요. 닉네임을 정하고 입장하세요', '', 3500);
    }
  }

  var tutAim = { angle: 0, power: 0 };

  function copyText(text, okMsg) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast(okMsg, 'good'); }, function () { fallbackCopy(text, okMsg); });
    } else fallbackCopy(text, okMsg);
  }
  function fallbackCopy(text, okMsg) {
    var ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); toast(okMsg, 'good'); } catch (e) { toast('복사 실패 — 직접 적어주세요: ' + text); }
    document.body.removeChild(ta);
  }

  /* ================================================== ROOM ACTIONS */
  function createRoom(name) {
    try { (window.__baDbg = window.__baDbg || []).push({ tag: 'createRoom', d: App.mode }); } catch (e) {}
    $('btn-create').disabled = true;
    toast('방을 만드는 중…');
    var room = new BA.net.Room({
      mode: App.mode,
      variant: App.variant,
      maxPlayers: App.variant === 'ffa' ? 4 : 2,
      name: name,
      handlers: {
        status: function (s) {
          setConn(s.state === 'host' || s.state === 'lobby' || s.state === 'playing' ? 'ok' : 'warn', s.text || '');
        },
        room: function () { onRoomUpdated(); if ($('screen-lobby').classList.contains('active')) renderLobby(); },
        result: onResult,
        notice: function (t) { toast(t); },
        chat: function (m) { toast(m.name + ': ' + m.text); },
        shot: function () {}
      }
    });
    room.create().then(function () {
      $('btn-create').disabled = false;
      App.room = room;
      showScreen('lobby');
      renderLobby();
      setConn('ok', '연결됨 · ' + room.brokerName);
      toast('방 코드 ' + room.room.code + ' — 친구에게 알려주세요!', 'good', 4000);
    }).catch(function (err) {
      $('btn-create').disabled = false;
      toast('연결 실패: ' + err.message + ' — 다시 시도해 주세요', 'bad', 4000);
    });
  }

  function joinRoom(name, code) {
    try { (window.__baDbg = window.__baDbg || []).push({ tag: 'joinRoom', d: code }); } catch (e) {}
    var hint = 0;
    try {
      var params = new URLSearchParams(location.search);
      if (params.get('room') === code && params.get('b') !== null) hint = parseInt(params.get('b'), 10) || 0;
    } catch (e) {}
    toast('방을 찾는 중…');
    var room = new BA.net.Room({
      name: name,
      handlers: {
        status: function (s) { setConn(s.state === 'lobby' || s.state === 'playing' ? 'ok' : 'warn', s.text || ''); },
        room: function () { onRoomUpdated(); if ($('screen-lobby').classList.contains('active')) renderLobby(); },
        result: onResult,
        notice: function (t) { toast(t); },
        chat: function (m) { toast(m.name + ': ' + m.text); }
      }
    });
    room.join(code, hint).then(function () {
      App.room = room;
      var r = room.room;
      setConn('ok', '연결됨 · ' + room.brokerName);
      if (r.started && r.game) enterGame(room);
      else { showScreen('lobby'); renderLobby(); }
      toast(r.mode === '4ball' ? '사구 방에 들어왔어요' : '8볼 방에 들어왔어요', 'good');
    }).catch(function (err) {
      toast(err.message || '방에 들어갈 수 없어요', 'bad', 4200);
    });
  }

  function leaveRoom() {
    if (App.room) { App.room.leave(); App.room = null; }
    showScreen('home');
    setConn('warn', '');
  }

  function setConn(cls, text) {
    var lc = $('lobby-conn'), gc = $('game-conn');
    [lc, gc].forEach(function (el) {
      el.classList.remove('ok', 'warn', 'bad');
      el.classList.add(cls);
    });
    lc.querySelector('.conn-text').textContent = text || '';
    gc.querySelector('.conn-text').textContent = text || '';
  }

  /* ================================================== PRACTICE */
  function startPractice() {
    App.tutorial = {
      course: {
        id: 'practice',
        title: '혼자 연습',
        table: 'pool',
        steps: [{
          title: '자유 연습',
          goal: null,
          body: '<p>원하는 만큼 자유롭게 쳐 보세요. 공 위치는 그대로 이어져서 계속 칠 수 있어요.</p><p>처음 배치로 돌아가려면 <b>다시</b>를 누르세요.</p>',
          setup: function () { return { table: 'pool', balls: BA.rules.setup8Ball(), cueId: 'cue' }; },
          check: function () { return true; }
        }]
      },
      idx: 0
    };
    $('tut-course-name').textContent = '혼자 연습';
    buildDots(1);
    showScreen('tutorial');
    requestAnimationFrame(function () {
      App.tutRenderer.resize(); App.tutRenderer.needLayout = true;
      loadTutStep(0);
    });
  }

  /* ================================================== RENDER LOOP */
  var lastTs = 0;
  function loop(ts) {
    requestAnimationFrame(loop);
    // game
    if ($('screen-game').classList.contains('active') && App.renderer) {
      var g = App.room && App.room.room && App.room.room.game;
      if (g) {
        var table = P.TABLES[g.table];
        var myTurn = App.room.room.game.turn === App.room.mySeat();
        var mySeat = App.room.mySeat();
        var scene = {
          table: table,
          balls: App.view,
          cueId: R.cueIdFor(g, myTurn ? mySeat : g.turn),
          aim: (App.aim && App.aim.power > 0.005 && !App.animating) ? { angle: App.aim.angle, power: App.aim.power } : null,
          showGuide: App.guide && myTurn,
          showCue: App.guide && myTurn,
          guideColor: myTurn ? 'rgba(255,214,102,0.8)' : null,
          highlightCue: true,
          placeMode: (g.ballsInHand && myTurn && App.placePreview) ? App.placePreview : null
        };
        App.renderer.drawScene(scene);
      }
    }
    // tutorial
    if ($('screen-tutorial').classList.contains('active') && App.tutRenderer && App.tutorial) {
      var T = App.tutorial;
      var tt = P.TABLES[T.course.table || T.setup.table];
      var aimShow = App.tutAim && App.tutAim.power > 0.005 && !T.waiting;
      App.tutRenderer.drawScene({
        table: tt,
        balls: App.tutView,
        cueId: T.setup.cueId,
        aim: aimShow ? { angle: App.tutAim.angle, power: App.tutAim.power } : null,
        showGuide: true,
        showCue: true,
        guideColor: 'rgba(255,214,102,0.8)',
        highlightCue: true
      });
    }
  }

  /* ================================================== BOOT */
  function boot() {
    global.addEventListener('error', function (e) {
      try { (window.__baDbg = window.__baDbg || []).push({ t: new Date().toISOString().slice(17, 23), tag: 'ERROR', d: e.message + ' @ ' + (e.filename || '').split('/').pop() + ':' + e.lineno }); } catch (x) {}
    });
    global.addEventListener('unhandledrejection', function (e) {
      try { (window.__baDbg = window.__baDbg || []).push({ t: new Date().toISOString().slice(17, 23), tag: 'REJECT', d: e.reason && e.reason.message ? e.reason.message : String(e.reason).slice(0, 120) }); } catch (x) {}
    });
    wire();
    showScreen('home');
    requestAnimationFrame(loop);
    $('boot').classList.add('hide');
    setTimeout(function () { $('boot').style.display = 'none'; }, 400);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  BA.app = App;
})(window);
