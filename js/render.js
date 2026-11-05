/* Billiards Arena — canvas renderer (top-down table, balls, cue, guides) */
(function (global) {
  'use strict';
  var BA = (global.BA = global.BA || {});
  var P = BA.physics;

  var FONT = '-apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Pretendard", "Segoe UI", Roboto, "Helvetica Neue", sans-serif';

  function Renderer(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.dpr = Math.min(2.5, global.devicePixelRatio || 1);
    this.cam = { scale: 1, ox: 0, oy: 0, rot: 0 };
    this.cssW = 0;
    this.cssH = 0;
  }

  Renderer.prototype.resize = function () {
    var rect = this.canvas.getBoundingClientRect();
    var w = Math.max(120, Math.round(rect.width));
    var h = Math.max(120, Math.round(rect.height));
    this.cssW = w; this.cssH = h;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.needLayout = true;
  };

  Renderer.prototype.layout = function (table) {
    var rail = table.id === 'carom' ? 0.085 : 0.075;
    var contentW = table.W + rail * 2;
    var contentH = table.H + rail * 2;
    var w = this.cssW, h = this.cssH;
    if (!w || !h) { this.cam = { scale: 1, ox: 0, oy: 0, rot: 0 }; return; }

    function fit(rw, rh) {
      return Math.min((w - 16) / rw, (h - 16) / rh);
    }
    var s0 = fit(contentW, contentH);
    var s90 = fit(contentH, contentW);
    var rot = 0, scale = s0;
    if (h > w * 1.05 && s90 > s0) { rot = Math.PI / 2; scale = s90; }
    var rotW = rot ? contentH : contentW;
    var rotH = rot ? contentW : contentH;
    this.cam = {
      scale: scale,
      // for the rotated case the canvas rotate(π/2) maps (px,py) → (-py,px),
      // so ox keeps the strip [ox - Hc·s, ox] centered horizontally
      ox: rot ? (w + rotW * scale) / 2 : (w - rotW * scale) / 2,
      oy: (h - rotH * scale) / 2,
      rot: rot,
      rail: rail
    };
    this.needLayout = false;
  };

  Renderer.prototype.toScreen = function (x, y) {
    var c = this.cam;
    var px = c.rail + x, py = c.rail + y;
    if (c.rot) {
      // 90° canvas rotation: screen = (ox - py·s, oy + px·s)
      return { x: c.ox - py * c.scale, y: c.oy + px * c.scale };
    }
    return { x: c.ox + px * c.scale, y: c.oy + py * c.scale };
  };

  Renderer.prototype.toWorld = function (sx, sy) {
    var c = this.cam;
    if (c.rot) {
      var px = (sy - c.oy) / c.scale;
      var py = (c.ox - sx) / c.scale;
      return { x: px - c.rail, y: py - c.rail };
    }
    var px2 = (sx - c.ox) / c.scale;
    var py2 = (sy - c.oy) / c.scale;
    return { x: px2 - c.rail, y: py2 - c.rail };
  };

  Renderer.prototype.begin = function (table) {
    if (this.needLayout) this.layout(table);
    var ctx = this.ctx, c = this.cam;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.cssW, this.cssH);
    ctx.save();
    ctx.translate(c.ox, c.oy);
    ctx.rotate(c.rot);
    ctx.scale(c.scale, c.scale);
    ctx.translate(c.rail, c.rail);
  };

  Renderer.prototype.end = function () {
    this.ctx.restore();
  };

  function roundRect(ctx, x, y, w, h, r) {
    var rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  Renderer.prototype.drawTable = function (table) {
    var ctx = this.ctx;
    var W = table.W, H = table.H;
    var rail = this.cam.rail;
    var woodW = rail;

    // table bed shadow
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur = 0.09;
    ctx.shadowOffsetY = 0.02;
    var g = ctx.createLinearGradient(-rail, -rail, W + rail, H + rail);
    g.addColorStop(0, '#4a3527');
    g.addColorStop(0.45, '#2f2118');
    g.addColorStop(1, '#1d1410');
    roundRect(ctx, -rail, -rail, W + rail * 2, H + rail * 2, 0.045);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.restore();

    // rail highlight
    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.lineWidth = 0.004;
    roundRect(ctx, -rail + 0.006, -rail + 0.006, W + rail * 2 - 0.012, H + rail * 2 - 0.012, 0.04);
    ctx.stroke();

    // cloth
    var felt = ctx.createRadialGradient(W * 0.42, H * 0.38, 0.05, W * 0.5, H * 0.5, Math.max(W, H) * 0.75);
    if (table.id === 'carom') {
      felt.addColorStop(0, '#1d8f5f');
      felt.addColorStop(0.6, '#126b46');
      felt.addColorStop(1, '#0a4b31');
    } else {
      felt.addColorStop(0, '#1f7fc4');
      felt.addColorStop(0.6, '#1563a0');
      felt.addColorStop(1, '#0d4470');
    }
    ctx.fillStyle = felt;
    ctx.fillRect(0, 0, W, H);

    // cloth weave
    ctx.save();
    ctx.globalAlpha = 0.05;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 0.0015;
    for (var i = 0; i < W; i += 0.035) {
      ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, H); ctx.stroke();
    }
    ctx.restore();

    // head string + spots
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 0.002;
    ctx.beginPath();
    if (table.id === 'pool') { ctx.moveTo(W * 0.25, 0); ctx.lineTo(W * 0.25, H); }
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    if (table.id === 'pool') {
      ctx.beginPath(); ctx.arc(W * 0.72, H / 2, 0.005, 0, Math.PI * 2); ctx.fill();
    } else {
      ctx.beginPath(); ctx.arc(W / 2, H / 2, 0.005, 0, Math.PI * 2); ctx.fill();
    }

    // inner cushion shadow
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, W, H);
    ctx.rect(-0.02, -0.02, W + 0.04, H + 0.04);
    ctx.clip('evenodd');
    ctx.restore();

    var shadowGrad = ctx.createLinearGradient(0, 0, 0, 0.06);
    ctx.save();
    var edges = [
      [0, 0, W, 0.055, 'v'],
      [0, H, W, H - 0.055, 'v'],
      [0, 0, 0.055, H, 'h'],
      [W, 0, W - 0.055, H, 'h']
    ];
    for (var e = 0; e < edges.length; e++) {
      var ed = edges[e];
      var lg;
      if (ed[4] === 'v') lg = ctx.createLinearGradient(0, ed[1], 0, ed[3]);
      else lg = ctx.createLinearGradient(ed[0], 0, ed[2], 0);
      lg.addColorStop(0, 'rgba(0,0,0,0.34)');
      lg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = lg;
      if (ed[4] === 'v') ctx.fillRect(0, Math.min(ed[1], ed[3]), W, Math.abs(ed[3] - ed[1]));
      else ctx.fillRect(Math.min(ed[0], ed[2]), 0, Math.abs(ed[2] - ed[0]), H);
    }
    ctx.restore();

    // pockets
    if (table.pockets && table.pockets.length) {
      for (var p = 0; p < table.pockets.length; p++) {
        var pk = table.pockets[p];
        var pr = pk.r * 0.92;
        var pg = ctx.createRadialGradient(pk.x, pk.y, pr * 0.2, pk.x, pk.y, pr);
        pg.addColorStop(0, '#000000');
        pg.addColorStop(0.75, '#07090a');
        pg.addColorStop(1, 'rgba(0,0,0,0.35)');
        ctx.beginPath();
        ctx.arc(pk.x, pk.y, pr, 0, Math.PI * 2);
        ctx.fillStyle = pg;
        ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.7)';
        ctx.lineWidth = 0.004;
        ctx.stroke();
      }
    }

    // diamonds on the rails
    ctx.fillStyle = 'rgba(240,232,210,0.55)';
    var dcount = table.id === 'pool' ? 7 : 8;
    for (var d = 1; d < dcount; d++) {
      var dx = (W / dcount) * d;
      ctx.beginPath(); ctx.arc(dx, -rail / 2, 0.0055, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(dx, H + rail / 2, 0.0055, 0, Math.PI * 2); ctx.fill();
    }
    for (var d2 = 1; d2 < 4; d2++) {
      var dy = (H / 4) * d2;
      ctx.beginPath(); ctx.arc(-rail / 2, dy, 0.0055, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(W + rail / 2, dy, 0.0055, 0, Math.PI * 2); ctx.fill();
    }
  };

  function ballStyle(b) {
    if (b.kind === 'cue') {
      if (b.id === 'yellow') return { base: '#f2d548', light: '#fff6bd', dark: '#b99a12' };
      if (b.id === 'white') return { base: '#f5f6f8', light: '#ffffff', dark: '#b9bfc7' };
      return { base: '#f7f8fa', light: '#ffffff', dark: '#bcc2c9' };
    }
    if (b.kind === 'red') return { base: '#cf2a2a', light: '#ff7b6b', dark: '#7c1010' };
    var st = BA.rules.BALL_STYLES[b.num] || { color: '#dddddd' };
    return { base: st.color, light: '#ffffff', dark: 'rgba(0,0,0,0.6)', style: st };
  }

  Renderer.prototype.drawBall = function (table, b, opts) {
    var ctx = this.ctx;
    var R = table.ballR;
    if (b.active === false) return;
    var st = ballStyle(b);

    // shadow
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(b.x + R * 0.28, b.y + R * 0.34, R * 1.05, R * 0.95, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.32)';
    ctx.filter = 'blur(0px)';
    ctx.fill();
    ctx.restore();

    var styleObj = st.style || null;
    var isStripe = styleObj && styleObj.stripe;

    ctx.save();
    ctx.beginPath();
    ctx.arc(b.x, b.y, R, 0, Math.PI * 2);
    ctx.clip();

    if (isStripe) {
      var wg = ctx.createRadialGradient(b.x - R * 0.35, b.y - R * 0.4, R * 0.1, b.x, b.y, R * 1.2);
      wg.addColorStop(0, '#ffffff');
      wg.addColorStop(0.7, '#f2f2f0');
      wg.addColorStop(1, '#c9ccc9');
      ctx.fillStyle = wg;
      ctx.fillRect(b.x - R, b.y - R, R * 2, R * 2);
      ctx.fillStyle = styleObj.color;
      ctx.fillRect(b.x - R, b.y - R * 0.52, R * 2, R * 1.04);
      ctx.fillStyle = 'rgba(0,0,0,0.12)';
      ctx.fillRect(b.x - R, b.y + R * 0.34, R * 2, R * 0.18);
    } else {
      var g = ctx.createRadialGradient(b.x - R * 0.38, b.y - R * 0.45, R * 0.08, b.x, b.y, R * 1.25);
      g.addColorStop(0, st.light);
      g.addColorStop(0.42, st.base);
      g.addColorStop(1, st.dark);
      ctx.fillStyle = g;
      ctx.fillRect(b.x - R, b.y - R, R * 2, R * 2);
    }

    if (styleObj) {
      ctx.beginPath();
      ctx.arc(b.x, b.y, R * 0.42, 0, Math.PI * 2);
      ctx.fillStyle = '#fbfbf9';
      ctx.fill();
      ctx.fillStyle = '#16181c';
      ctx.font = '700 ' + (R * 0.62) + 'px ' + FONT;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(styleObj.name), b.x, b.y + R * 0.03);
    }

    // specular
    var spec = ctx.createRadialGradient(b.x - R * 0.35, b.y - R * 0.4, 0, b.x - R * 0.35, b.y - R * 0.4, R * 0.7);
    spec.addColorStop(0, 'rgba(255,255,255,0.75)');
    spec.addColorStop(0.5, 'rgba(255,255,255,0.12)');
    spec.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = spec;
    ctx.fillRect(b.x - R, b.y - R, R * 2, R * 2);
    ctx.restore();

    ctx.beginPath();
    ctx.arc(b.x, b.y, R, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(0,0,0,0.18)';
    ctx.lineWidth = R * 0.06;
    ctx.stroke();

    if (opts && opts.highlight) {
      ctx.beginPath();
      ctx.arc(b.x, b.y, R * 1.35, 0, Math.PI * 2);
      ctx.strokeStyle = opts.highlight;
      ctx.lineWidth = R * 0.12;
      ctx.stroke();
    }
  };

  Renderer.prototype.drawAim = function (table, balls, cueId, aim, color) {
    var ctx = this.ctx;
    var R = table.ballR;
    var cue = null;
    for (var i = 0; i < balls.length; i++) if (balls[i].id === cueId) cue = balls[i];
    if (!cue || !aim) return;
    var dx = Math.cos(aim.angle), dy = Math.sin(aim.angle);
    var hit = P.predict(table, balls, cueId, aim.angle);

    ctx.save();
    ctx.lineCap = 'round';

    // main aiming line
    ctx.setLineDash([0.018, 0.014]);
    ctx.strokeStyle = color || 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 0.0032;
    ctx.beginPath();
    ctx.moveTo(cue.x + dx * R, cue.y + dy * R);
    var end = hit ? { x: hit.ghostX, y: hit.ghostY } : { x: cue.x + dx * 3, y: cue.y + dy * 3 };
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
    ctx.setLineDash([]);

    if (hit && hit.type === 'ball') {
      // ghost ball at contact
      ctx.beginPath();
      ctx.arc(hit.ghostX, hit.ghostY, R, 0, Math.PI * 2);
      ctx.strokeStyle = color || 'rgba(255,255,255,0.8)';
      ctx.lineWidth = 0.0035;
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.07)';
      ctx.fill();
      // object ball direction
      var ox = hit.ball.x - hit.ghostX, oy = hit.ball.y - hit.ghostY;
      var on = Math.sqrt(ox * ox + oy * oy) || 1;
      ctx.beginPath();
      ctx.moveTo(hit.ball.x + (ox / on) * R, hit.ball.y + (oy / on) * R);
      ctx.lineTo(hit.ball.x + (ox / on) * R * 6, hit.ball.y + (oy / on) * R * 6);
      ctx.strokeStyle = 'rgba(255,214,102,0.75)';
      ctx.lineWidth = 0.0028;
      ctx.stroke();
    } else if (hit && hit.type === 'cushion') {
      var n = hit.n;
      var dot = dx * n[0] + dy * n[1];
      var rx = dx - 2 * dot * n[0], ry = dy - 2 * dot * n[1];
      ctx.beginPath();
      ctx.moveTo(hit.ghostX, hit.ghostY);
      ctx.lineTo(hit.ghostX + rx * 0.55, hit.ghostY + ry * 0.55);
      ctx.strokeStyle = 'rgba(255,255,255,0.3)';
      ctx.lineWidth = 0.0026;
      ctx.stroke();
    }
    ctx.restore();
  };

  Renderer.prototype.drawCue = function (table, cue, angle, power) {
    var ctx = this.ctx;
    var R = table.ballR;
    if (!cue) return;
    var gap = R * 1.25 + (1 - Math.min(1, power)) * 0.10 + 0.02;
    var back = gap + 1.05;
    var x0 = cue.x - Math.cos(angle) * gap, y0 = cue.y - Math.sin(angle) * gap;
    var x1 = cue.x - Math.cos(angle) * back, y1 = cue.y - Math.sin(angle) * back;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x0, y0); ctx.lineTo(x1, y1);
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = R * 1.35;
    ctx.stroke();
    var g = ctx.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, '#f3ead6');
    g.addColorStop(0.06, '#d8c9a8');
    g.addColorStop(0.5, '#a9793f');
    g.addColorStop(1, '#5d3a1c');
    ctx.beginPath();
    ctx.moveTo(x0, y0); ctx.lineTo(x1, y1);
    ctx.strokeStyle = g;
    ctx.lineWidth = R * 1.05;
    ctx.stroke();
    // tip
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x0 - Math.cos(angle) * 0.035, y0 - Math.sin(angle) * 0.035);
    ctx.strokeStyle = '#2b6fa8';
    ctx.lineWidth = R * 0.62;
    ctx.stroke();
    ctx.restore();
  };

  Renderer.prototype.drawCueBallMarker = function (table, x, y, color) {
    var ctx = this.ctx;
    var R = table.ballR;
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, R * 1.6, 0, Math.PI * 2);
    ctx.strokeStyle = color || 'rgba(120,220,255,0.8)';
    ctx.lineWidth = 0.004;
    ctx.setLineDash([0.012, 0.01]);
    ctx.stroke();
    ctx.restore();
  };

  Renderer.prototype.drawScene = function (scene) {
    var table = scene.table;
    this.begin(table);
    this.drawTable(table);

    // potted balls tray rendered by UI in DOM, so skip
    if (scene.hintZone) {
      this.ctx.save();
      this.ctx.fillStyle = 'rgba(120,220,255,0.10)';
      this.ctx.fillRect(0, 0, table.W, table.H);
      this.ctx.restore();
    }

    if (scene.aim && scene.showGuide) {
      var cueBall = null;
      for (var i = 0; i < scene.balls.length; i++) if (scene.balls[i].id === scene.cueId) cueBall = scene.balls[i];
      if (cueBall) {
        this.drawAim(table, scene.balls, scene.cueId, scene.aim, scene.guideColor);
        if (scene.showCue) this.drawCue(table, cueBall, scene.aim.angle, scene.aim.power);
      }
    }

    for (var j = 0; j < scene.balls.length; j++) {
      var b = scene.balls[j];
      if (!b.active) continue;
      var hl = (scene.highlightCue && b.id === scene.cueId) ? 'rgba(255,214,102,0.9)' : null;
      this.drawBall(table, b, { highlight: hl });
    }

    if (scene.placeMode) this.drawCueBallMarker(table, scene.placeMode.x, scene.placeMode.y, scene.placeMode.ok ? 'rgba(120,255,170,0.9)' : 'rgba(255,120,120,0.9)');

    this.end();
  };

  BA.Renderer = Renderer;
})(typeof window !== 'undefined' ? window : globalThis);
