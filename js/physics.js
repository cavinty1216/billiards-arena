/* Billiards Arena — physics engine
 * Deterministic, fixed-timestep 2D billiards simulation (top-down).
 * Units: meters, seconds, kg-normalised (unit mass).
 * Everything here is pure: given the same table + balls + shot it produces
 * the same frames and events on every client, which is what lets a shot be
 * replayed locally while another player's machine computes the result.
 */
(function (global) {
  'use strict';
  var BA = (global.BA = global.BA || {});

  var POCKET_R = 0.076;
  var SIDE_POCKET_R = 0.070;

  var TABLES = {
    carom: {
      id: 'carom',
      name: '사구 테이블',
      W: 2.84, H: 1.42,
      ballR: 0.03075,
      pockets: [],
      cushionRest: 0.86,
      rollFriction: 0.20,
      slideFriction: 0.85,
      cushionFriction: 0.97
    },
    pool: {
      id: 'pool',
      name: '8볼 테이블',
      W: 2.54, H: 1.27,
      ballR: 0.028575,
      cushionRest: 0.80,
      rollFriction: 0.245,
      slideFriction: 0.90,
      cushionFriction: 0.96
    }
  };

  function poolPockets() {
    var t = TABLES.pool;
    return [
      { id: 'tl', x: 0, y: 0, r: POCKET_R },
      { id: 'tr', x: t.W, y: 0, r: POCKET_R },
      { id: 'bl', x: 0, y: t.H, r: POCKET_R },
      { id: 'br', x: t.W, y: t.H, r: POCKET_R },
      { id: 'tm', x: t.W / 2, y: 0, r: SIDE_POCKET_R },
      { id: 'bm', x: t.W / 2, y: t.H, r: SIDE_POCKET_R }
    ];
  }

  /* Rails are straight segments along the four cushions. On a pocket table the
   * cushion stops short of each pocket mouth so a ball can drop through. */
  function railsFor(table) {
    var W = table.W, H = table.H;
    if (table.id === 'carom') {
      return [
        { axis: 'y', at: 0, a: 0, b: W, nx: 0, ny: 1 },
        { axis: 'y', at: H, a: 0, b: W, nx: 0, ny: -1 },
        { axis: 'x', at: 0, a: 0, b: H, nx: 1, ny: 0 },
        { axis: 'x', at: W, a: 0, b: H, nx: -1, ny: 0 }
      ];
    }
    var cg = 0.086;      // cushion end distance from a corner
    var sh = 0.062;      // half-width of a side pocket mouth
    var mid = W / 2;
    return [
      { axis: 'y', at: 0, a: cg, b: mid - sh, nx: 0, ny: 1 },
      { axis: 'y', at: 0, a: mid + sh, b: W - cg, nx: 0, ny: 1 },
      { axis: 'y', at: H, a: cg, b: mid - sh, nx: 0, ny: -1 },
      { axis: 'y', at: H, a: mid + sh, b: W - cg, nx: 0, ny: -1 },
      { axis: 'x', at: 0, a: cg, b: H - cg, nx: 1, ny: 0 },
      { axis: 'x', at: W, a: cg, b: H - cg, nx: -1, ny: 0 }
    ];
  }

  TABLES.pool.pockets = poolPockets();
  for (var k in TABLES) TABLES[k].rails = railsFor(TABLES[k]);

  /* ---------------------------------------------------------------- helpers */
  function ball(id, x, y, kind, extra) {
    var b = {
      id: id, x: x, y: y, vx: 0, vy: 0,
      spinX: 0, spinY: 0, active: true, kind: kind || 'object'
    };
    if (extra) for (var p in extra) b[p] = extra[p];
    return b;
  }

  function cloneBalls(list) {
    return list.map(function (b) {
      return {
        id: b.id, x: b.x, y: b.y, vx: b.vx || 0, vy: b.vy || 0,
        spinX: b.spinX || 0, spinY: b.spinY || 0,
        active: b.active !== false, kind: b.kind, num: b.num,
        owner: b.owner
      };
    });
  }

  function dist(ax, ay, bx, by) {
    var dx = ax - bx, dy = ay - by;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /* ------------------------------------------------------------------ shot */
  // speed 0.55 .. 7.2 m/s
  function shotSpeed(power) {
    var p = Math.max(0, Math.min(1, power));
    return 0.55 + Math.pow(p, 1.08) * 6.65;
  }

  /* --------------------------------------------------------------- stepping */
  function stepBalls(table, balls, dt, events, now) {
    var R = table.ballR, i, j, b;
    var roll = table.rollFriction, slide = table.slideFriction;
    var push = function (e) { e.t = Math.round(now * 1000) / 1000; events.push(e); };

    for (i = 0; i < balls.length; i++) {
      b = balls[i];
      if (!b.active) continue;
      var sp = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
      if (sp > 1e-5) {
        var dec = sp > 0.55 && Math.abs(b.spinY) > 0.12 ? slide : roll;
        var ns = sp - dec * dt;
        if (ns < 0) ns = 0;
        var scale = ns / sp;
        b.vx *= scale;
        b.vy *= scale;

        // side spin bends the path slightly (masse / swerve)
        if (Math.abs(b.spinX) > 0.05 && ns > 0.35) {
          var kx = -b.vy / (ns || 1), ky = b.vx / (ns || 1);
          var curve = b.spinX * 1.9 * dt * Math.min(1, ns / 2.2);
          b.vx += kx * curve * ns;
          b.vy += ky * curve * ns;
        }
        b.x += b.vx * dt;
        b.y += b.vy * dt;
      }
      b.spinX *= 0.985;
      b.spinY *= 0.975;
      if (Math.abs(b.spinX) < 0.004) b.spinX = 0;
      if (Math.abs(b.spinY) < 0.004) b.spinY = 0;
    }

    /* ---- cushions ------------------------------------------------------- */
    for (i = 0; i < balls.length; i++) {
      b = balls[i];
      if (!b.active) continue;
      for (j = 0; j < table.rails.length; j++) {
        var rail = table.rails[j];
        if (rail.axis === 'y') {
          var along = b.x;
          if (along < rail.a || along > rail.b) continue;
          var pen = rail.ny > 0 ? (0 + R) - b.y : b.y - (table.H - R);
          if (pen > 0) {
            b.y += rail.ny * pen;
            var vnY = b.vx * rail.nx + b.vy * rail.ny;
            if (vnY < 0) {
              var impY = -(1 + table.cushionRest) * vnY;
              b.vx += rail.nx * impY;
              b.vy += rail.ny * impY;
              var tx = -rail.ny, ty = rail.nx;
              var tangential = b.vx * tx + b.vy * ty;
              var kick = b.spinX * 0.30 * Math.abs(vnY);
              var hold = b.spinY * 0.10 * Math.abs(vnY);
              b.vx = (b.vx - tangential * tx) * 1 + (tangential * table.cushionFriction + kick) * tx;
              b.vy = (b.vy - tangential * ty) * 1 + (tangential * table.cushionFriction + kick) * ty;
              b.vx += rail.nx * hold;
              b.vy += rail.ny * hold;
              b.spinX *= -0.72;
              events.push({ type: 'cushion', id: b.id, rail: j, speed: Math.abs(vnY), t: Math.round(now * 1000) / 1000 });
            }
          }
        } else {
          var alongY = b.y;
          if (alongY < rail.a || alongY > rail.b) continue;
          var penX = rail.nx > 0 ? (0 + R) - b.x : b.x - (table.W - R);
          if (penX > 0) {
            b.x += rail.nx * penX;
            var vnX = b.vx * rail.nx + b.vy * rail.ny;
            if (vnX < 0) {
              var impX = -(1 + table.cushionRest) * vnX;
              b.vx += rail.nx * impX;
              b.vy += rail.ny * impX;
              var tx2 = -rail.ny, ty2 = rail.nx;
              var tangential2 = b.vx * tx2 + b.vy * ty2;
              var kick2 = b.spinX * 0.30 * Math.abs(vnX);
              var hold2 = b.spinY * 0.10 * Math.abs(vnX);
              b.vx = (b.vx - tangential2 * tx2) + (tangential2 * table.cushionFriction + kick2) * tx2;
              b.vy = (b.vy - tangential2 * ty2) + (tangential2 * table.cushionFriction + kick2) * ty2;
              b.vx += rail.nx * hold2;
              b.vy += rail.ny * hold2;
              b.spinX *= -0.72;
              events.push({ type: 'cushion', id: b.id, rail: j, speed: Math.abs(vnX), t: Math.round(now * 1000) / 1000 });
            }
          }
        }
      }
    }

    /* ---- ball to ball --------------------------------------------------- */
    for (i = 0; i < balls.length; i++) {
      var a = balls[i];
      if (!a.active) continue;
      for (j = i + 1; j < balls.length; j++) {
        var c = balls[j];
        if (!c.active) continue;
        var dx = c.x - a.x, dy = c.y - a.y;
        var d2 = dx * dx + dy * dy;
        var minD = R * 2;
        if (d2 >= minD * minD || d2 === 0) continue;
        var d = Math.sqrt(d2);
        var nx = dx / d, ny = dy / d;
        var overlap = minD - d;
        a.x -= nx * overlap / 2;
        a.y -= ny * overlap / 2;
        c.x += nx * overlap / 2;
        c.y += ny * overlap / 2;

        var rel = (c.vx - a.vx) * nx + (c.vy - a.vy) * ny;
        if (rel > 0) continue;
        var e = 0.955;
        var J = -(1 + e) * rel / 2;

        var cueA = Math.abs(a.spinY) > 0.02 || Math.abs(a.spinX) > 0.02;
        var spinAY = a.spinY, spinAX = a.spinX;
        var cueC = Math.abs(c.spinY) > 0.02 || Math.abs(c.spinX) > 0.02;
        var spinCY = c.spinY, spinCX = c.spinX;

        a.vx -= J * nx; a.vy -= J * ny;
        c.vx += J * nx; c.vy += J * ny;

        // follow / draw: residual top or back spin pushes the striker along the
        // line of centres (top) or pulls it back (draw)
        if (cueA) {
          a.vx += nx * spinAY * J * 0.55;
          a.vy += ny * spinAY * J * 0.55;
          a.spinY = 0;
          // side spin throws the object ball a little
          var tx = -ny, ty = nx;
          c.vx += tx * spinAX * J * 0.05;
          c.vy += ty * spinAX * J * 0.05;
          a.spinX *= 0.55;
        }
        if (cueC) {
          c.vx -= nx * spinCY * J * 0.55;
          c.vy -= ny * spinCY * J * 0.55;
          c.spinY = 0;
          var tx3 = -ny, ty3 = nx;
          a.vx -= tx3 * spinCX * J * 0.05;
          a.vy -= ty3 * spinCX * J * 0.05;
          c.spinX *= 0.55;
        }
        events.push({
          type: 'ball', a: a.id, b: c.id,
          speed: Math.abs(rel), x: a.x + nx * R, y: a.y + ny * R,
          t: Math.round(now * 1000) / 1000
        });
      }
    }

    /* ---- pockets / out of bounds ---------------------------------------- */
    for (i = 0; i < balls.length; i++) {
      b = balls[i];
      if (!b.active) continue;
      if (table.pockets && table.pockets.length) {
        for (j = 0; j < table.pockets.length; j++) {
          var pk = table.pockets[j];
          if (dist(b.x, b.y, pk.x, pk.y) < pk.r) {
            b.active = false;
            b.pocketed = true;
            b.vx = b.vy = 0;
            events.push({ type: 'pot', id: b.id, pocket: pk.id, x: pk.x, y: pk.y, kind: b.kind, num: b.num, t: Math.round(now * 1000) / 1000 });
            break;
          }
        }
        if (!b.active) continue;
        var out = b.x < -0.02 || b.x > table.W + 0.02 || b.y < -0.02 || b.y > table.H + 0.02;
        if (out) {
          var best = null, bd = 1e9;
          for (j = 0; j < table.pockets.length; j++) {
            var dd = dist(b.x, b.y, table.pockets[j].x, table.pockets[j].y);
            if (dd < bd) { bd = dd; best = table.pockets[j]; }
          }
          b.active = false;
          b.pocketed = true;
          b.vx = b.vy = 0;
          events.push({ type: 'pot', id: b.id, pocket: best ? best.id : '?', x: b.x, y: b.y, kind: b.kind, num: b.num, t: Math.round(now * 1000) / 1000 });
        }
      } else {
        // carom table: keep every ball on the bed
        if (b.x < R) { b.x = R; if (b.vx < 0) b.vx = -b.vx * 0.8; }
        if (b.x > table.W - R) { b.x = table.W - R; if (b.vx > 0) b.vx = -b.vx * 0.8; }
        if (b.y < R) { b.y = R; if (b.vy < 0) b.vy = -b.vy * 0.8; }
        if (b.y > table.H - R) { b.y = table.H - R; if (b.vy > 0) b.vy = -b.vy * 0.8; }
      }
    }
  }

  function moving(balls) {
    for (var i = 0; i < balls.length; i++) {
      var b = balls[i];
      if (b.active && (Math.abs(b.vx) > 0.004 || Math.abs(b.vy) > 0.004)) return true;
    }
    return false;
  }

  /* Apply the cue strike to a ball set in place. */
  function applyShot(table, balls, shot) {
    var cue = null;
    for (var i = 0; i < balls.length; i++) if (balls[i].id === shot.cueId) cue = balls[i];
    if (!cue) return null;
    var sp = shotSpeed(shot.power);
    cue.vx = Math.cos(shot.angle) * sp;
    cue.vy = Math.sin(shot.angle) * sp;
    cue.spinX = Math.max(-1, Math.min(1, shot.spinX || 0));
    cue.spinY = Math.max(-1, Math.min(1, shot.spinY || 0));
    return cue;
  }

  /* Full shot simulation. Returns frames (for animation) + events + final balls. */
  function simulate(table, ballsIn, shot, options) {
    var opts = options || {};
    var dt = opts.dt || 1 / 300;
    var frameEvery = opts.frameEvery || 8;          // 300/8 ≈ 37 fps
    var maxTime = opts.maxTime || 16;
    var balls = cloneBalls(ballsIn);
    var events = [];
    applyShot(table, balls, shot);

    var frames = [];
    var snapshot = function () {
      var arr = [];
      for (var i = 0; i < balls.length; i++) {
        var b = balls[i];
        arr.push([Math.round(b.x * 10000) / 10000, Math.round(b.y * 10000) / 10000, b.active ? 1 : 0]);
      }
      frames.push({ t: Math.round(t * 1000) / 1000, b: arr });
    };
    var t = 0;
    snapshot();
    var guard = 0;
    while (moving(balls) && t < maxTime && guard < 200000) {
      stepBalls(table, balls, dt, events, t);
      t += dt;
      guard++;
      if (guard % frameEvery === 0) snapshot();
    }
    snapshot();
    // settle any residual jitter
    for (var i = 0; i < balls.length; i++) { balls[i].vx = 0; balls[i].vy = 0; balls[i].spinX = 0; balls[i].spinY = 0; }

    return { frames: frames, events: events, balls: balls, duration: t };
  }

  /* ------------------------------------------------------------------ aim */
  /* Ray from the cue ball; returns the first thing the centre line would hit. */
  function predict(table, balls, cueId, angle) {
    var R = table.ballR, cue = null, i;
    for (i = 0; i < balls.length; i++) if (balls[i].id === cueId) cue = balls[i];
    if (!cue) return null;
    var dx = Math.cos(angle), dy = Math.sin(angle);
    var best = { t: Infinity, type: 'none' };

    for (i = 0; i < balls.length; i++) {
      var b = balls[i];
      if (b === cue || !b.active) continue;
      // solve |P + tD - C| = 2R
      var ox = cue.x - b.x, oy = cue.y - b.y;
      var bq = 2 * (ox * dx + oy * dy);
      var cq = ox * ox + oy * oy - (2 * R) * (2 * R);
      var disc = bq * bq - 4 * cq;
      if (disc < 0) continue;
      var sq = Math.sqrt(disc);
      var tHit = (-bq - sq) / 2;
      if (tHit > 1e-6 && tHit < best.t) {
        best = { t: tHit, type: 'ball', ball: b, ghostX: cue.x + dx * tHit, ghostY: cue.y + dy * tHit };
      }
    }

    // cushions: distance to each rail plane inside its segment
    var walls = [];
    if (dx > 0) walls.push({ t: (table.W - R - cue.x) / dx, axis: 'x', n: [-1, 0] });
    if (dx < 0) walls.push({ t: (R - cue.x) / dx, axis: 'x', n: [1, 0] });
    if (dy > 0) walls.push({ t: (table.H - R - cue.y) / dy, axis: 'y', n: [0, -1] });
    if (dy < 0) walls.push({ t: (R - cue.y) / dy, axis: 'y', n: [0, 1] });
    for (i = 0; i < walls.length; i++) {
      var w = walls[i];
      if (w.t <= 1e-6 || w.t >= best.t) continue;
      var px = cue.x + dx * w.t, py = cue.y + dy * w.t;
      if (w.axis === 'x' && (py < R || py > table.H - R)) continue;
      if (w.axis === 'y' && (px < R || px > table.W - R)) continue;
      best = { t: w.t, type: 'cushion', n: w.n, ghostX: px, ghostY: py };
    }
    return best;
  }

  BA.physics = {
    TABLES: TABLES,
    ball: ball,
    cloneBalls: cloneBalls,
    simulate: simulate,
    predict: predict,
    shotSpeed: shotSpeed,
    dist: dist
  };
})(typeof window !== 'undefined' ? window : globalThis);
