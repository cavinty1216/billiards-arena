/* Billiards Arena — online rooms over a public MQTT relay.
 *
 * Why a relay: a pure static site cannot sync players by itself, and WebRTC
 * peer-to-peer fails for players behind carrier-grade NAT (common on Korean
 * mobile networks) unless there is a TURN server. A public MQTT-over-WebSocket
 * broker needs no account, no card and no server of ours, and works from any
 * phone or PC browser. The host of a room is authoritative: only the host
 * resolves shots, so no player can move another player's turn.
 *
 * Limits (reported to the user): these are free public test brokers with no
 * SLA — messages are visible to anyone who knows the topic, so the room uses a
 * random code and nicknames only, and no personal data goes through it.
 */
(function (global) {
  'use strict';
  var BA = (global.BA = global.BA || {});
  var P = BA.physics;

  var BROKERS = [
    { url: 'wss://broker.emqx.io:8084/mqtt', name: 'EMQX' },
    { url: 'wss://broker.hivemq.com:8884/mqtt', name: 'HiveMQ' },
    { url: 'wss://mqtt-dashboard.com:8884/mqtt', name: 'HiveMQ-2' }
  ];
  var PREFIX = 'pickle/billiards/2/';
  var ALPHA = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

  function randCode(len) {
    var s = '';
    var a = new Uint32Array(len);
    if (global.crypto && crypto.getRandomValues) crypto.getRandomValues(a);
    else for (var i = 0; i < len; i++) a[i] = Math.floor(Math.random() * 4294967296);
    for (var j = 0; j < len; j++) s += ALPHA[a[j] % ALPHA.length];
    return s;
  }
  function randId() { return randCode(10); }

  function dbg(tag, data) {
    try {
      (global.__baDbg = global.__baDbg || []).push({ t: new Date().toISOString().slice(17, 23), tag: tag, d: data === undefined ? '' : data });
      if (global.__baDbg.length > 60) global.__baDbg.shift();
    } catch (e) {}
  }

  function now() { return Date.now(); }

  function Room(opts) {
    this.opts = opts || {};
    this.mode = this.opts.mode || '4ball';
    this.variant = this.opts.variant || '1v1';
    this.maxPlayers = this.opts.maxPlayers || 2;
    this.me = { id: this.opts.id || randId(), name: (this.opts.name || '플레이어').slice(0, 12) };
    this.handlers = this.opts.handlers || {};
    this.client = null;
    this.room = null;
    this.code = null;
    this.topic = null;
    this.isHost = false;
    this.hostId = null;
    this.lastHostSeen = 0;
    this.status = 'idle';
    this.key = randCode(4);
    this.dead = false;
    this.seen = {};
    this.timers = [];
    this.brokerName = '';
    this.rtt = null;
  }

  Room.prototype.emit = function (type, payload) {
    var h = this.handlers[type];
    if (h) { try { h(payload); } catch (e) { console.error(e); } }
  };

  Room.prototype._setStatus = function (s, text) {
    this.status = s;
    this.emit('status', { state: s, text: text || '' });
  };

  /* Connect to one specific relay. Everyone in a room must use the same one,
   * so the index travels with the room code (link) and as a fallback the
   * joiner simply tries each relay in turn until the host answers. */
  Room.prototype._connectAt = function (index) {
    var self = this;
    var b = BROKERS[index];
    dbg('connect', b ? b.url : 'none');
    if (!b) return Promise.reject(new Error('연결 서버 없음'));
    var c = new BA.MqttClient(b.url, { clientId: 'ba_' + self.me.id + '_' + Math.random().toString(36).slice(2, 6), timeout: 7000 });
    return c.connect().then(function () {
      dbg('connected', b.name);
      self.client = c;
      self.brokerIndex = index;
      self.brokerName = b.name;
      return c;
    });
  };

  Room.prototype._connect = function () {
    var self = this;
    var start = this.brokerHint || 0;
    var order = [start];
    for (var i = 0; i < BROKERS.length; i++) if (i !== start) order.push(i);
    function attempt(k) {
      if (k >= order.length) return Promise.reject(new Error('무료 연결 서버에 접속하지 못했어요'));
      return self._connectAt(order[k]).catch(function () {
        try { self.client && self.client.close(); } catch (e) {}
        self.client = null;
        return attempt(k + 1);
      });
    }
    return attempt(0);
  };

  Room.prototype._wire = function () {
    var self = this;
    this.client.onmessage = function (topic, payload) {
      var msg;
      try { msg = JSON.parse(payload); } catch (e) { return; }
      if (!msg || !msg.t) return;
      self._onMessage(msg);
    };
    this.client.onclose = function (wasConnected) {
      if (self.dead) return;
      self.emit('status', { state: 'reconnecting', text: '연결이 끊겨 다시 연결하는 중…' });
    };
    this.client._onResubscribe = function () {
      self.client.subscribe(self.topic);
      if (self.isHost) setTimeout(function () { self.broadcast(); }, 300);
      else self._send({ t: 'hello', from: self.me.id, name: self.me.name });
      self.emit('status', { state: self.isHost ? 'host' : 'guest', text: '다시 연결됐어요' });
    };
  };

  Room.prototype._send = function (msg) {
    dbg('tx', msg.t + (msg.to ? ' to=' + String(msg.to).slice(0, 4) : ''));
    if (!this.client || !this.topic) { dbg('tx-drop', 'no client/topic'); return; }
    this.client.publish(this.topic, JSON.stringify(msg));
  };

  /* ------------------------------------------------------------- creating */
  Room.prototype.create = function () {
    var self = this;
    this._setStatus('connecting', '방을 만드는 중…');
    return this._connect().then(function () {
      self.isHost = true;
      self.hostId = self.me.id;
      self._wire();
      return self._reserveCode(0);
    }).then(function (code) {
      self.code = code;
      self.topic = PREFIX + code;
      self.client.subscribe(self.topic);
      self.room = {
        code: code,
        mode: self.mode,
        variant: self.variant,
        maxPlayers: self.maxPlayers,
        hostId: self.me.id,
        started: false,
        seq: 0,
        createdAt: now(),
        players: [{ id: self.me.id, name: self.me.name, seat: 0, connected: true, ready: true }],
        game: null
      };
      self._startTimers();
      setTimeout(function () { self.broadcast(); }, 250);
      self._setStatus('lobby', '방 코드를 친구에게 알려주세요');
      self.emit('room', self.snapshot());
      return self;
    });
  };

  /* Subscribe first and listen for a moment so we do not reuse a live code. */
  Room.prototype._reserveCode = function (attempt) {
    var self = this;
    if (attempt >= 4) return Promise.resolve(randCode(5));
    var code = randCode(5);
    var topic = PREFIX + code;
    var heard = [];
    var prev = this.client.onmessage;
    this.client.onmessage = function (t, payload) {
      try { var m = JSON.parse(payload); if (m && m.t === 'room' && m.room && m.room.hostId !== self.me.id) heard.push(m.room.code); } catch (e) {}
      if (prev) prev(t, payload);
    };
    this.client.subscribe(topic);
    return new Promise(function (resolve) {
      setTimeout(function () {
        self.client.onmessage = prev;
        resolve(heard.length ? null : code);
      }, 700);
    }).then(function (ok) {
      if (ok) return ok;
      // unsubscribe is optional on public brokers; a fresh code is enough
      return self._reserveCode(attempt + 1);
    });
  };

  /* -------------------------------------------------------------- joining */
  Room.prototype.join = function (code, brokerHint) {
    var self = this;
    this.code = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (this.code.length < 4) return Promise.reject(new Error('방 코드를 확인해 주세요'));
    this.brokerHint = (typeof brokerHint === 'number' && brokerHint >= 0 && brokerHint < BROKERS.length) ? brokerHint : 0;
    this._setStatus('connecting', '방을 찾는 중…');

    // Try the hinted relay first, then the others: the host may sit on a
    // different relay, and then the same code would never meet.
    var order = [this.brokerHint];
    for (var i = 0; i < BROKERS.length; i++) if (i !== this.brokerHint) order.push(i);
    var lastErr = null;

    function tryBroker(k) {
      if (k >= order.length) return Promise.reject(lastErr || new Error('방을 찾을 수 없어요'));
      return self._connectAt(order[k]).then(function () {
        self.isHost = false;
        self._wire();
        self.topic = PREFIX + self.code;
        self.client.subscribe(self.topic);
        return new Promise(function (resolve, reject) {
          var settled = false;
          self._joinResolve = function (ok, payload) {
            if (settled) return;
            settled = true;
            if (ok) resolve(true); else reject(new Error(payload || '들어갈 수 없어요'));
          };
          setTimeout(function () {
            if (!settled) { settled = true; resolve(false); }
          }, 3000);
          var tryHello = function () {
            self._send({ t: 'hello', from: self.me.id, name: self.me.name, ver: 2 });
          };
          tryHello();
          setTimeout(tryHello, 1000);
          setTimeout(tryHello, 2000);
        });
      }).then(function (ok) {
        if (ok) return self;
        try { self.client.close(); } catch (e) {}
        self.client = null;
        self._joinResolve = null;
        lastErr = new Error('방을 찾을 수 없어요');
        return tryBroker(k + 1);
      }).catch(function (err) {
        if (err && /정원|시작/.test(err.message)) throw err;   // real answer from the host
        try { self.client && self.client.close(); } catch (e) {}
        self.client = null;
        self._joinResolve = null;
        lastErr = lastErr || err;
        return tryBroker(k + 1);
      });
    }

    return tryBroker(0).then(function () {
      self._startTimers();
      self._setStatus('lobby', '방에 들어왔어요');
      return self;
    });
  };

  /* -------------------------------------------------------------- messages */
  Room.prototype._onMessage = function (msg) {
    dbg('rx', msg.t + (msg.from ? ' from=' + String(msg.from).slice(0, 4) : '') + (msg.to ? ' to=' + String(msg.to).slice(0, 4) : ''));
    if (msg.from && msg.from === this.me.id && msg.t !== 'room') return; // own echo
    if (this.isHost) return this._hostInbox(msg);
    return this._guestInbox(msg);
  };

  Room.prototype._hostInbox = function (msg) {
    var self = this;
    switch (msg.t) {
      case 'hello': {
        // The room code is the gate; a hello from a stranger simply means a
        // new player wants in. (The per-room key only filters other messages.)
        var r = this.room;
        if (!r) return;
        var existing = r.players.filter(function (p) { return p.id === msg.from; })[0];
        if (existing) {
          existing.connected = true;
          existing.name = msg.name || existing.name;
          this.seen[msg.from] = now();
          this._send({ t: 'welcome', to: msg.from, key: this.key, room: this._snap(), you: existing.seat });
          this.broadcast();
          this.emit('notice', existing.name + '님이 다시 들어왔어요');
          return;
        }
        if (r.players.length >= r.maxPlayers) {
          this._send({ t: 'deny', to: msg.from, reason: '정원(' + r.maxPlayers + '명)이 가득 찼어요' });
          return;
        }
        if (r.started && r.variant === '1v1') {
          this._send({ t: 'deny', to: msg.from, reason: '이미 경기가 시작됐어요. 끝난 뒤에 다시 들어와 주세요' });
          return;
        }
        var seat = r.players.length;
        r.players.push({ id: msg.from, name: (msg.name || '플레이어').slice(0, 12), seat: seat, connected: true, ready: false });
        this.seen[msg.from] = now();
        this._send({ t: 'welcome', to: msg.from, key: this.key, room: this._snap(), you: seat });
        this.broadcast();
        this.emit('notice', (msg.name || '플레이어') + '님이 들어왔어요');
        return;
      }
      case 'hb': {
        this.seen[msg.from] = now();
        var p = this.room && this.room.players.filter(function (x) { return x.id === msg.from; })[0];
        if (p && !p.connected) { p.connected = true; this.broadcast(); }
        return;
      }
      case 'shot': return this._hostShot(msg);
      case 'place': return this._hostPlace(msg);
      case 'chat':
        this._send({ t: 'chat', from: msg.from, name: this._nameOf(msg.from), text: String(msg.text || '').slice(0, 60) });
        this.emit('chat', { name: this._nameOf(msg.from), text: msg.text });
        return;
      case 'bye': {
        var q = this.room && this.room.players.filter(function (x) { return x.id === msg.from; })[0];
        if (q) { q.connected = false; this.broadcast(); this.emit('notice', q.name + '님이 나갔어요'); }
        return;
      }
      default: return;
    }
  };

  Room.prototype._nameOf = function (id) {
    if (!this.room) return '플레이어';
    var p = this.room.players.filter(function (x) { return x.id === id; })[0];
    return p ? p.name : '플레이어';
  };

  Room.prototype._guestInbox = function (msg) {
    var self = this;
    switch (msg.t) {
      case 'welcome': {
        if (msg.to !== this.me.id) return;
        if (msg.key) this.key = msg.key;
        this.room = msg.room;
        this.hostId = msg.room.hostId;
        this.lastHostSeen = now();
        this.seatNo = msg.you;
        this._setStatus(this.room.started ? 'playing' : 'lobby', this.room.started ? '경기 중' : '방에 들어왔어요');
        this.emit('room', this.snapshot());
        if (this._joinResolve) this._joinResolve(true);
        return;
      }
      case 'deny': {
        if (msg.to !== this.me.id) return;
        if (this._joinResolve) this._joinResolve(false, msg.reason || '들어갈 수 없어요');
        return;
      }
      case 'room': {
        if (!msg.room || !msg.room.players) return;
        this.lastHostSeen = now();
        /* Only accept a snapshot from the host we know, or from someone who is
         * already a player in the room (the legitimate hand-over case). This
         * keeps a stranger on the same public topic from taking the room. */
        var known = this.room && this.room.players.some(function (p) { return p.id === msg.room.hostId; });
        if (this.hostId && msg.room.hostId !== this.hostId && !known) return;
        if (this.room && msg.room.hostId === this.hostId && typeof msg.room.seq === 'number' && typeof this.room.seq === 'number' && msg.room.seq < this.room.seq) return;
        var wasStarted = this.room && this.room.started;
        var prevHost = this.hostId;
        this.room = msg.room;
        this.hostId = msg.room.hostId;
        for (var i = 0; i < this.room.players.length; i++) if (this.room.players[i].id === this.me.id) this.seatNo = this.room.players[i].seat;
        this._setStatus(this.room.started ? (this.room.game && this.room.game.phase === 'ended' ? 'ended' : 'playing') : 'lobby');
        if (!wasStarted && this.room.started) this.emit('start', this.room);
        this.emit('room', this.snapshot());
        return;
      }
      case 'result': {
        this.lastHostSeen = now();
        if (msg.room) {
          if (msg.room.hostId && this.hostId && msg.room.hostId !== this.hostId) return;
          this.room = msg.room;
          for (var j = 0; j < this.room.players.length; j++) if (this.room.players[j].id === this.me.id) this.seatNo = this.room.players[j].seat;
        }
        this.emit('result', { room: this.snapshot(), result: msg.result });
        return;
      }
      case 'notice': this.emit('notice', msg.text); return;
      case 'chat': this.emit('chat', { name: msg.name, text: msg.text }); return;
      default: return;
    }
  };

  /* ---------------------------------------------------------- host actions */
  Room.prototype._hostShot = function (msg) {
    var r = this.room;
    if (!r || !r.started || !r.game) return;
    if (msg.key && msg.key !== this.key) return;
    if (r.game.phase !== 'aim') return;
    var players = r.players;
    var shooter = players.filter(function (p) { return p.id === msg.from; })[0];
    if (!shooter) return;
    if (shooter.seat !== r.game.turn) return;                 // not their turn
    if (msg.shotNo !== undefined && msg.shotNo !== (r.game.shotNo || 0)) return; // stale
    var shot = msg.shot;
    if (!shot || typeof shot.angle !== 'number' || typeof shot.power !== 'number') return;
    // tame anything a modified client might send
    shot.angle = shot.angle % (Math.PI * 2);
    shot.power = Math.max(0, Math.min(1, Number(shot.power) || 0));
    shot.spinX = Math.max(-1, Math.min(1, Number(shot.spinX) || 0));
    shot.spinY = Math.max(-1, Math.min(1, Number(shot.spinY) || 0));
    shot.cueId = BA.rules.cueIdFor(r.game, shooter.seat);
    if (r.game.ballsInHand) return;  // must place the cue ball first

    var out = BA.rules.takeShot(r.game, shot, players.length);
    r.seq++;
    var payloadRoom = this._snap();
    var result = {
      shooterId: shooter.id,
      shooterName: shooter.name,
      message: r.game.message,
      scores: r.game.scores,
      turn: r.game.turn,
      phase: r.game.phase,
      winner: r.game.winner,
      details: r.game.details,
      frames: this._compactFrames(out.sim.frames),
      events: out.sim.events.map(function (e) { return { type: e.type, id: e.id, a: e.a, b: e.b, num: e.num, pocket: e.pocket, t: e.t }; })
    };
    this._send({ t: 'result', key: this.key, room: payloadRoom, result: result });
    this.emit('result', { room: this.snapshot(), result: result });
  };

  /* Shot trajectories travel with the result so every client can replay the
   * exact same motion. Positions are already rounded; drop redundant frames. */
  Room.prototype._compactFrames = function (frames) {
    var out = [];
    var last = null;
    for (var i = 0; i < frames.length; i++) {
      var f = frames[i];
      var keep = true;
      if (last) {
        var same = true;
        for (var k = 0; k < f.b.length; k++) {
          if (f.b[k][0] !== last[k][0] || f.b[k][1] !== last[k][1] || f.b[k][2] !== last[k][2]) { same = false; break; }
        }
        keep = !same;
      }
      if (keep) { out.push(f); last = f.b; }
      else if (out.length) out[out.length - 1].hold = (out[out.length - 1].hold || 0) + 1;
    }
    return out;
  };

  Room.prototype._hostPlace = function (msg) {
    var r = this.room;
    if (!r || !r.started || !r.game) return;
    if (msg.key && msg.key !== this.key) return;
    var shooter = r.players.filter(function (p) { return p.id === msg.from; })[0];
    if (!shooter || shooter.seat !== r.game.turn) return;
    var spot = BA.rules.legalCueSpot(r.game, shooter.seat, msg.x, msg.y);
    if (!spot) return;
    var cue = BA.rules.ballById(r.game, BA.rules.cueIdFor(r.game, shooter.seat));
    if (!cue) return;
    cue.active = true; cue.pocketed = false;
    cue.x = spot.x; cue.y = spot.y; cue.vx = 0; cue.vy = 0;
    r.game.ballsInHand = false;
    r.game.phase = 'aim';
    r.game.message = '공을 놓았어요. 이제 조준하세요.';
    r.seq++;
    var payloadRoom = this._snap();
    this._send({ t: 'result', key: this.key, room: payloadRoom, result: { shooterId: shooter.id, message: r.game.message, placed: true } });
    this.emit('result', { room: this.snapshot(), result: { placed: true } });
  };

  Room.prototype.shoot = function (shot) {
    var r = this.room;
    if (!r || !r.game) return false;
    var seat = this.mySeat();
    if (r.game.turn !== seat || r.game.phase !== 'aim') return false;
    shot.cueId = BA.rules.cueIdFor(r.game, seat);
    shot.shotNo = r.game.shotNo || 0;
    var msg = { t: 'shot', from: this.me.id, key: this.key, shotNo: r.game.shotNo || 0, shot: shot };
    this.emit('shot', { shot: shot, shooterId: this.me.id, local: true });
    if (this.isHost) this._hostShot(msg);
    else this._send(msg);
    return true;
  };

  Room.prototype.place = function (x, y) {
    var msg = { t: 'place', from: this.me.id, key: this.key, x: x, y: y };
    if (this.isHost) this._hostPlace(msg);
    else this._send(msg);
  };

  Room.prototype.mySeat = function () {
    if (!this.room) return -1;
    for (var i = 0; i < this.room.players.length; i++) if (this.room.players[i].id === this.me.id) return this.room.players[i].seat;
    return -1;
  };

  Room.prototype.snapshot = function () {
    return this._snap();
  };

  Room.prototype._snap = function () {
    var r = this.room;
    if (!r) return null;
    return {
      code: r.code, mode: r.mode, variant: r.variant, maxPlayers: r.maxPlayers,
      hostId: r.hostId, started: r.started, seq: r.seq, createdAt: r.createdAt,
      players: r.players.map(function (p) { return { id: p.id, name: p.name, seat: p.seat, connected: p.connected, ready: !!p.ready }; }),
      game: r.game ? {
        mode: r.game.mode, table: r.game.table,
        balls: r.game.balls.map(function (b) { return { id: b.id, x: b.x, y: b.y, active: b.active, kind: b.kind, num: b.num, owner: b.owner }; }),
        phase: r.game.phase, turn: r.game.turn, scores: r.game.scores,
        groups: r.game.groups, shotNo: r.game.shotNo, message: r.game.message,
        winner: r.game.winner, ballsInHand: r.game.ballsInHand,
        details: r.game.details, target: r.game.target
      } : null
    };
  };

  Room.prototype.broadcast = function () {
    if (!this.isHost) return;
    this._send({ t: 'room', key: this.key, room: this._snap() });
    this.emit('room', this.snapshot());
  };

  /* -------------------------------------------------------- lobby controls */
  Room.prototype.setConfig = function (cfg) {
    if (!this.isHost || !this.room || this.room.started) return;
    if (cfg.mode) { this.room.mode = cfg.mode; this.mode = cfg.mode; }
    if (cfg.variant) { this.room.variant = cfg.variant; this.variant = cfg.variant; }
    if (cfg.maxPlayers) {
      this.room.maxPlayers = cfg.maxPlayers;
      while (this.room.players.length > cfg.maxPlayers) this.room.players.pop();
    }
    this.room.seq++;
    this.broadcast();
  };

  Room.prototype.setReady = function (v) {
    var me = this.me.id;
    var p = this.room && this.room.players.filter(function (x) { return x.id === me; })[0];
    if (p) p.ready = !!v;
    if (this.isHost) this.broadcast();
    else this._send({ t: 'ready', from: this.me.id, value: !!v });
  };

  Room.prototype.start = function () {
    if (!this.isHost || !this.room) return false;
    var r = this.room;
    if (r.players.filter(function (p) { return p.connected; }).length < 2) return false;
    r.started = true;
    r.game = BA.rules.newGameState(r.mode);
    r.variant = r.players.length > 2 ? 'ffa' : r.variant;
    r.maxPlayers = r.mode === '4ball' ? 2 : (r.maxPlayers || 4);
    r.game.turn = 0;
    r.game.target = r.mode === '4ball' ? 7 : (r.players.length > 2 ? 9 : 0);
    r.players.forEach(function (p) { p.ready = true; });
    r.seq++;
    this.broadcast();
    return true;
  };

  Room.prototype.restart = function () {
    if (!this.isHost || !this.room) return;
    var r = this.room;
    r.game = BA.rules.newGameState(r.mode);
    r.game.turn = 0;
    r.game.target = r.mode === '4ball' ? 7 : (r.players.length > 2 ? 9 : 0);
    r.seq++;
    this.broadcast();
  };

  Room.prototype.backToLobby = function () {
    if (!this.isHost || !this.room) return;
    this.room.started = false;
    this.room.game = null;
    this.room.seq++;
    this.broadcast();
  };

  Room.prototype.chat = function (text) {
    var msg = { t: 'chat', from: this.me.id, name: this.me.name, key: this.key, text: String(text || '').slice(0, 60) };
    this._send(msg);
    if (this.isHost) this.emit('chat', { name: this.me.name, text: text });
  };

  /* --------------------------------------------------------------- timers */
  Room.prototype._startTimers = function () {
    var self = this;
    var t1 = setInterval(function () {
      if (self.dead) return;
      self._send({ t: 'hb', from: self.me.id, name: self.me.name, key: self.key });
      if (self.isHost) self._hostTick();
      else self._guestTick();
    }, 2000);
    this.timers.push(t1);
  };

  Room.prototype._hostTick = function () {
    if (!this.room) return;
    var changed = false;
    var t = now();
    for (var i = 0; i < this.room.players.length; i++) {
      var p = this.room.players[i];
      var last = this.seen[p.id] || (p.id === this.me.id ? t : (this.room.createdAt || t));
      if (p.id === this.me.id) continue;
      var alive = (t - last) < 8000;
      if (p.connected !== alive) { p.connected = alive; changed = true; }
    }
    // auto-skip a turn when the player to shoot is gone
    var r = this.room;
    if (r.started && r.game && r.game.phase !== 'ended' && r.players[r.game.turn]) {
      var cur = r.players[r.game.turn];
      var curAlive = cur.id === this.me.id || (t - (this.seen[cur.id] || 0)) < 8000;
      if (!curAlive && !this._skipAt) this._skipAt = t;
      if (curAlive) this._skipAt = 0;
      if (this._skipAt && t - this._skipAt > 6000) {
        this._skipAt = 0;
        r.game.turn = (r.game.turn + 1) % r.players.length;
        r.game.ballsInHand = false;
        r.game.phase = 'aim';
        r.game.message = cur.name + '님이 연결이 끊겨 차례를 넘겼어요.';
        r.seq++;
        changed = true;
      }
    }
    if (changed) this.broadcast();
    else if (t - (this._lastBroadcast || 0) > 5000) { this._lastBroadcast = t; this.broadcast(); }
  };

  Room.prototype._guestTick = function () {
    if (!this.room) return;
    var t = now();
    if (this.lastHostSeen && t - this.lastHostSeen > 9000) {
      // host vanished — the connected player in the lowest seat takes over
      var candidates = this.room.players.filter(function (p) { return p.connected; });
      if (candidates.length && candidates[0].id === this.me.id && this.room.game && !this.room.game.winner) {
        this.isHost = true;
        this.hostId = this.me.id;
        this.room.hostId = this.me.id;
        this.room.seq++;
        this.emit('notice', '방장이 나가서 이어서 진행합니다.');
        this.broadcast();
      }
      this.lastHostSeen = t - 6000;
    }
  };

  Room.prototype.leave = function () {
    this.dead = true;
    for (var i = 0; i < this.timers.length; i++) clearInterval(this.timers[i]);
    var myId = this.me.id;
    if (this.room && this.isHost) {
      this._send({ t: 'bye', from: myId, key: this.key });
      var others = this.room.players.filter(function (p) { return p.connected && p.id !== myId; });
      if (others.length) {
        this._send({ t: 'notice', from: myId, key: this.key, text: '방장이 방을 떠났어요. 다음 사람이 이어서 진행합니다.' });
      }
    } else if (this.room) {
      this._send({ t: 'bye', from: myId, key: this.key });
    }
    if (this.client) this.client.close();
    this._setStatus('left', '나갔습니다');
  };

  BA.net = {
    Room: Room,
    BROKERS: BROKERS,
    randCode: randCode,
    PREFIX: PREFIX,
    dbg: function () { return (global.__baDbg || []).slice(); }
  };
})(typeof window !== 'undefined' ? window : globalThis);
