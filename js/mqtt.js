/* Billiards Arena — tiny MQTT 3.1.1 client over WebSocket.
 * Only what a game room needs: CONNECT, SUBSCRIBE (QoS 0), PUBLISH (QoS 0),
 * PINGREQ. Keeps the whole thing dependency-free (no CDN script to load).
 */
(function (global) {
  'use strict';
  var BA = (global.BA = global.BA || {});
  var enc = new TextEncoder();

  function utf8(str) {
    return enc.encode(str);
  }

  function remainingLength(n) {
    var out = [];
    do {
      var d = n % 128;
      n = Math.floor(n / 128);
      if (n > 0) d |= 128;
      out.push(d);
    } while (n > 0);
    return out;
  }

  function u16(n) {
    return [(n >> 8) & 0xff, n & 0xff];
  }

  function buildPacket(type, body) {
    var out = new Uint8Array(1 + 4 + body.length);
    out[0] = type;
    var rl = remainingLength(body.length);
    out[1] = rl[0];
    var head = 1 + rl.length;
    for (var i = 1; i < rl.length; i++) out[1 + i] = rl[i];
    out.set(body, head);
    return out.subarray(0, head + body.length);
  }

  function concat(parts) {
    var len = 0, i;
    for (i = 0; i < parts.length; i++) len += parts[i].length;
    var out = new Uint8Array(len), off = 0;
    for (i = 0; i < parts.length; i++) { out.set(parts[i], off); off += parts[i].length; }
    return out;
  }

  function MqttClient(url, opts) {
    this.url = url;
    this.opts = opts || {};
    this.clientId = this.opts.clientId || ('ba' + Math.random().toString(36).slice(2, 10));
    this.keepalive = 45;
    this.connected = false;
    this.closedByUs = false;
    this.rx = new Uint8Array(0);
    this.packetId = 1;
    this.onconnect = null;
    this.onmessage = null;
    this.onclose = null;
    this.onerror = null;
    this.ws = null;
    this._pingTimer = null;
    this._reconnectDelay = 800;
    this._autoReconnect = true;
  }

  MqttClient.prototype.connect = function () {
    var self = this;
    return new Promise(function (resolve, reject) {
      var ws;
      try {
        ws = new WebSocket(self.url, 'mqtt');
      } catch (e) {
        return reject(e);
      }
      ws.binaryType = 'arraybuffer';
      self.ws = ws;
      var settled = false;
      var timer = setTimeout(function () {
        if (!settled) { settled = true; try { ws.close(); } catch (e) {} reject(new Error('timeout')); }
      }, self.opts.timeout || 8000);

      ws.onopen = function () {
        var body = concat([
          new Uint8Array([0, 4, 77, 81, 84, 84, 4, 0x02]),
          new Uint8Array(u16(self.keepalive)),
          new Uint8Array(u16(self.clientId.length)), utf8(self.clientId)
        ]);
        ws.send(buildPacket(0x10, body));
      };
      ws.onerror = function (ev) {
        if (!settled) { settled = true; clearTimeout(timer); reject(new Error('socket error')); }
        if (self.onerror) self.onerror(ev);
      };
      ws.onclose = function () {
        clearTimeout(timer);
        clearInterval(self._pingTimer);
        var wasConnected = self.connected;
        self.connected = false;
        if (!settled) { settled = true; reject(new Error('closed')); }
        if (self.onclose) self.onclose(wasConnected);
        if (self._autoReconnect && !self.closedByUs) {
          setTimeout(function () {
            if (self.closedByUs) return;
            self.connect().then(function () {
              if (self._onResubscribe) self._onResubscribe();
            }).catch(function () {});
          }, self._reconnectDelay);
          self._reconnectDelay = Math.min(8000, self._reconnectDelay * 1.6);
        }
      };
      ws.onmessage = function (ev) {
        var data = ev.data;
        if (data instanceof ArrayBuffer) self._feed(new Uint8Array(data));
        else if (data && data.arrayBuffer) {
          data.arrayBuffer().then(function (buf) { self._feed(new Uint8Array(buf)); });
        } else if (typeof data === 'string') {
          self._feed(utf8(data));
        }
      };
      self._resolveConnect = function () {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        self.connected = true;
        self._reconnectDelay = 800;
        clearInterval(self._pingTimer);
        self._pingTimer = setInterval(function () {
          if (self.ws && self.ws.readyState === 1) self.ws.send(buildPacket(0xC0, new Uint8Array(0)));
        }, 20000);
        resolve(self);
      };
    });
  };

  MqttClient.prototype._feed = function (chunk) {
    this.rx = concat([this.rx, chunk]);
    var guard = 0;
    while (this.rx.length >= 2 && guard++ < 200) {
      var mult = 1, len = 0, i = 1, done = false;
      while (i < this.rx.length) {
        var d = this.rx[i];
        len += (d & 127) * mult;
        mult *= 128;
        i++;
        if ((d & 128) === 0) { done = true; break; }
        if (i > 4) break;
      }
      if (!done) return;
      var total = i + len;
      if (this.rx.length < total) return;
      var type = this.rx[0] >> 4;
      var body = this.rx.subarray(i, total);
      this.rx = this.rx.slice(total);
      this._packet(type, body);
    }
  };

  MqttClient.prototype._packet = function (type, body) {
    if (type === 2) { // CONNACK
      try { (global.__baDbg = global.__baDbg || []).push({ t: new Date().toISOString().slice(17, 23), tag: 'connack', d: body && body.length > 1 ? body[1] : 'short' }); } catch (e) {}
      var rc = body.length > 1 ? body[1] : 1;
      if (rc === 0 && this._resolveConnect) this._resolveConnect();
      else if (this.onerror) this.onerror(new Error('connack ' + rc));
      return;
    }
    if (type === 3) { // PUBLISH
      if (body.length < 3) return;
      var tlen = (body[0] << 8) | body[1];
      var topic = new TextDecoder().decode(body.subarray(2, 2 + tlen));
      var payload = new TextDecoder().decode(body.subarray(2 + tlen));
      if (this.onmessage) this.onmessage(topic, payload);
      return;
    }
    if (type === 9) { // SUBACK
      if (this.onSuback) this.onSuback();
      return;
    }
  };

  MqttClient.prototype.subscribe = function (topic) {
    var t = utf8(topic);
    var pid = this.packetId++;
    this.packetId = this.packetId > 60000 ? 1 : this.packetId;
    var body = concat([
      new Uint8Array(u16(pid)),
      new Uint8Array(u16(t.length)), t,
      new Uint8Array([0])
    ]);
    this.topics = this.topics || [];
    if (this.topics.indexOf(topic) < 0) this.topics.push(topic);
    if (this.ws && this.ws.readyState === 1) this.ws.send(buildPacket(0x82, body));
  };

  MqttClient.prototype.publish = function (topic, text) {
    var t = utf8(topic), p = utf8(text);
    var body = concat([new Uint8Array(u16(t.length)), t, p]);
    if (this.ws && this.ws.readyState === 1) this.ws.send(buildPacket(0x30, body));
  };

  MqttClient.prototype.close = function () {
    this.closedByUs = true;
    this._autoReconnect = false;
    clearInterval(this._pingTimer);
    try { if (this.ws && this.ws.readyState === 1) this.ws.send(buildPacket(0xE0, new Uint8Array(0))); } catch (e) {}
    try { if (this.ws) this.ws.close(); } catch (e) {}
  };

  BA.MqttClient = MqttClient;
})(typeof window !== 'undefined' ? window : globalThis);
