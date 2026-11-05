/* Billiards Arena — game rules
 * Two games:
 *   4ball  : Korean four-ball carom (사구). 1v1 uses the simplified house
 *            rules shown in the app. 3-4 players share the two cue balls in a
 *            clearly-labelled app-only score variant (state.ffa): seat 0/2
 *            shoot the white cue, seat 1/3 the yellow one. It is NOT the
 *            standard two-player carom game and must never be presented as one.
 *   8ball  : pocket billiards. 1v1 uses the standard solids/stripes + 8-ball
 *            rules (simplified: no called shots). 3-4 players use a separate
 *            individual score mode, clearly marked as this app's own variant.
 */
(function (global) {
  'use strict';
  var BA = (global.BA = global.BA || {});
  var P = BA.physics;

  var BALL_STYLES = {
    1: { color: '#f4c21c', name: '1' },
    2: { color: '#1f4fb0', name: '2' },
    3: { color: '#c9242b', name: '3' },
    4: { color: '#6c3fa8', name: '4' },
    5: { color: '#e0741f', name: '5' },
    6: { color: '#177a3f', name: '6' },
    7: { color: '#7a2b2b', name: '7' },
    8: { color: '#15161a', name: '8' },
    9: { color: '#f4c21c', name: '9', stripe: true },
    10: { color: '#1f4fb0', name: '10', stripe: true },
    11: { color: '#c9242b', name: '11', stripe: true },
    12: { color: '#6c3fa8', name: '12', stripe: true },
    13: { color: '#e0741f', name: '13', stripe: true },
    14: { color: '#177a3f', name: '14', stripe: true },
    15: { color: '#7a2b2b', name: '15', stripe: true }
  };

  /* ------------------------------------------------------------------ racks */
  function setup4Ball() {
    var t = P.TABLES.carom;
    var cx = t.W * 0.5, cy = t.H * 0.5;
    return [
      P.ball('white', t.W * 0.235, cy, 'cue', { owner: 0 }),
      P.ball('yellow', t.W * 0.765, cy, 'cue', { owner: 1 }),
      P.ball('red1', cx - 0.10, cy - 0.055, 'red'),
      P.ball('red2', cx + 0.10, cy + 0.055, 'red')
    ];
  }

  function setup8Ball() {
    var t = P.TABLES.pool;
    var R = t.ballR;
    var balls = [P.ball('cue', t.W * 0.25, t.H * 0.5, 'cue', { owner: 0 })];
    var rows = [
      [1],
      [9, 2],
      [10, 8, 3],
      [11, 4, 12, 5],
      [6, 13, 7, 14, 15]
    ];
    var gap = 2 * R * 1.012;
    var footX = t.W * 0.72;
    var cy = t.H * 0.5;
    for (var r = 0; r < rows.length; r++) {
      var x = footX + r * gap * Math.sqrt(3) / 2;
      var n = rows[r].length;
      for (var i = 0; i < n; i++) {
        var y = cy + (i - (n - 1) / 2) * gap;
        var num = rows[r][i];
        balls.push(P.ball('b' + num, x, y, num === 8 ? 'eight' : 'object', { num: num }));
      }
    }
    return balls;
  }

  function newGameState(mode) {
    if (mode === '4ball') {
      return {
        mode: '4ball',
        table: 'carom',
        balls: setup4Ball(),
        phase: 'aim',
        turn: 0,
        ffa: false,
        scores: { 0: 0, 1: 0 },
        shotNo: 0,
        message: '내 공으로 빨간 두 공을 모두 맞히면 1점! (쿠션을 먼저 맞히면 2점)',
        lastEvents: [],
        breakDone: true,
        ballsInHand: false
      };
    }
    return {
      mode: '8ball',
      table: 'pool',
      balls: setup8Ball(),
      phase: 'aim',
      turn: 0,
      scores: {},
      groups: { 0: null, 1: null },
      shotNo: 0,
      message: '테이블이 열려 있어요. 첫 번째로 넣은 공이 내 그룹이 됩니다.',
      lastEvents: [],
      breakDone: false,
      ballsInHand: false,
      elimination: []
    };
  }

  function targetScoreFor(mode, players) {
    if (mode === '4ball') return 7;
    if (players <= 2) return 0;              // 1v1 8-ball is won by clearing + 8
    return 9;                                 // FFA score mode target
  }

  function onTable(balls, pred) {
    var n = 0;
    for (var i = 0; i < balls.length; i++) {
      var b = balls[i];
      if (b.active && b.kind !== 'cue' && (!pred || pred(b))) n++;
    }
    return n;
  }

  function groupOf(num) {
    if (num === 8) return 'eight';
    return num < 8 ? 'solid' : 'stripe';
  }

  /* ------------------------------------------------------------- 4-ball */
  /* Simplified, clearly-labelled house rules:
   *  - your cue ball must contact both red balls in one shot -> 1 point
   *  - if your cue ball touched a cushion before hitting the second red -> 2
   *  - touching the opponent's cue ball is allowed, no penalty
   *  - miss -> turn passes.  No pockets, so no scratch.
   */
  function resolve4Ball(state, shot, sim, playerCount) {
    var cueId = shot.cueId;
    var mySeat = null;
    for (var s in state.__owners) if (state.__owners[s] === cueId) mySeat = s;
    var ev = sim.events;
    var cushionBefore = false;
    var redsHit = {};
    var hitCueStick = false;
    var firstContact = null;

    for (var i = 0; i < ev.length; i++) {
      var e = ev[i];
      if (e.type === 'cushion' && e.id === cueId) cushionBefore = true;
      if (e.type === 'ball') {
        var other = null;
        if (e.a === cueId) other = e.b;
        else if (e.b === cueId) other = e.a;
        if (other) {
          if (!firstContact) firstContact = other;
          if (other === 'red1' || other === 'red2') redsHit[other] = true;
          if (other === 'white' || other === 'yellow') hitCueStick = true;
        }
      }
    }
    var bothReds = redsHit.red1 && redsHit.red2;
    var points = 0;
    if (bothReds) points = cushionBefore ? 2 : 1;

    var seat = state.turn;
    state.scores = state.scores || {};
    state.scores[seat] = (state.scores[seat] || 0) + points;

    var target = state.target || 7;
    var msg = '';
    var keepTurn = points > 0;
    if (points === 2) msg = '쿠션을 이용해 두 빨간 공을 모두 맞혔어요! +2점';
    else if (points === 1) msg = '두 빨간 공 모두 맞혔어요! +1점';
    else if (redsHit.red1 || redsHit.red2) msg = '빨간 공 하나만 맞혔어요. 다음 사람 차례예요.';
    else msg = '빨간 공을 맞히지 못했어요. 다음 사람 차례예요.';

    if ((state.scores[seat] || 0) >= target) {
      state.phase = 'ended';
      state.winner = seat;
      state.message = msg + ' 🏆 ' + target + '점 달성, 승리!';
    } else {
      if (!keepTurn) state.turn = (seat + 1) % playerCount;
      if (state.ffa && !keepTurn) {
        var nextCue = cueIdFor(state, state.turn);
        msg += ' (다음 수구: ' + (nextCue === 'white' ? '흰 공' : '노란 공') + ')';
      }
      state.message = msg;
    }
    state.details = {
      bothReds: bothReds,
      points: points,
      cushionBefore: !!cushionBefore,
      hitOpponentCue: hitCueStick,
      firstContact: firstContact
    };
    return { events: ev, details: state.details };
  }

  /* ------------------------------------------------------------- 8-ball */
  function resolve8Ball(state, shot, sim, playerCount, seats) {
    var cueId = shot.cueId;
    var seat = state.turn;
    var ev = sim.events;
    var fouls = [];
    var firstContact = null;
    var potted = [];
    var cushionsAfterContact = 0;
    var contactHappened = false;
    var anyCushion = false;
    var pottedCue = false;

    for (var i = 0; i < ev.length; i++) {
      var e = ev[i];
      if (e.type === 'ball') {
        if (e.a === cueId || e.b === cueId) {
          var other = e.a === cueId ? e.b : e.a;
          if (!firstContact) firstContact = other;
          contactHappened = true;
        }
      }
      if (e.type === 'cushion') {
        anyCushion = true;
        if (contactHappened) cushionsAfterContact++;
      }
      if (e.type === 'pot') {
        if (e.id === cueId) pottedCue = true;
        else potted.push(e.num);
      }
    }

    var ffa = playerCount > 2;
    var msg = '';

    if (ffa) {
      /* ---- 3-4 player individual score mode (app variant) --------------- */
      var gained = 0;
      for (var k = 0; k < potted.length; k++) gained += potted[k] === 8 ? 3 : 1;
      state.scores = state.scores || {};
      var before = state.scores[seat] || 0;
      var after = before + gained;
      if (pottedCue) {
        after -= 1;
        fouls.push('scratch');
      }
      if (!contactHappened && potted.length === 0) {
        after -= 1;
        fouls.push('no-contact');
      }
      if (after < 0) after = 0;
      state.scores[seat] = after;
      var target = state.target || 9;
      if (after >= target) {
        state.phase = 'ended';
        state.winner = seat;
        state.message = gained ? ('+' + gained + '점! 🏆 ' + target + '점 달성, 승리!') : '🏆 승리!';
      } else {
        var keep = gained > 0 && !pottedCue;
        if (!keep) state.turn = (seat + 1) % playerCount;
        state.ballsInHand = pottedCue || !contactHappened;
        state.message = gained
          ? (pottedCue ? '+' + Math.max(0, gained - 1) + '점 (큐볼 파울 -1)' : '+' + gained + '점! 한 번 더')
          : (pottedCue ? '큐볼이 들어갔어요. -1점, 다음 사람.' : (!contactHappened ? '공을 맞히지 못했어요. -1점, 다음 사람.' : '아쉽지만 못 넣었어요. 다음 사람.'));
      }
      state.details = { variant: 'ffa', gained: gained, potted: potted, fouls: fouls };
      return { events: ev, details: state.details };
    }

    /* ---- 1 vs 1 standard 8-ball --------------------------------------- */
    var myGroup = state.groups[seat];
    var openTable = !state.groups[0] && !state.groups[1];

    if (!contactHappened) fouls.push('no-contact');
    if (pottedCue) fouls.push('scratch');
    if (contactHappened && !anyCushion && potted.length === 0) fouls.push('no-rail');

    var eightPotted = potted.indexOf(8) >= 0;
    var myGroupLeft = myGroup ? onTable(sim.balls, function (b) { return groupOf(b.num) === myGroup; }) : 7;
    var eightLeft = onTable(sim.balls, function (b) { return b.num === 8; });

    // first contact legality
    if (contactHappened && firstContact) {
      var fcNum = null;
      var fcBall = null;
      for (var m = 0; m < state.balls.length; m++) if (state.balls[m].id === firstContact) fcBall = state.balls[m];
      if (fcBall && fcBall.num) {
        if (!openTable) {
          if (fcBall.num === 8) {
            if (myGroupLeft > 0) fouls.push('eight-first');
          } else if (groupOf(fcBall.num) !== myGroup) fouls.push('wrong-ball');
        } else if (fcBall.num === 8) {
          fouls.push('eight-first');
        }
      }
    }

    // early 8 ball
    if (eightPotted) {
      if (myGroupLeft > 0 || fouls.length > 0) {
        state.phase = 'ended';
        state.winner = (seat + 1) % playerCount;
        state.loseReason = 'eight-early';
        state.message = '8번 공을 먼저 넣었어요. 상대방 승리!';
        state.details = { variant: '1v1', potted: potted, fouls: fouls, earlyEight: true };
        return { events: ev, details: state.details };
      }
      state.phase = 'ended';
      state.winner = seat;
      state.message = '🎱 8번 공까지 깔끔하게! 승리!';
      state.details = { variant: '1v1', potted: potted, fouls: fouls };
      return { events: ev, details: state.details };
    }

    // group assignment on an open table after a legal pot
    var pottedGroup = null;
    for (var k2 = 0; k2 < potted.length; k2++) {
      var g = groupOf(potted[k2]);
      if (g === 'solid' || g === 'stripe') { pottedGroup = g; break; }
    }
    if (openTable) {
      if (fouls.length) {
        // table stays open; a foul pot does not assign a group
        state.groups[0] = null;
        state.groups[1] = null;
      } else if (pottedGroup) {
        state.groups[seat] = pottedGroup;
        state.groups[(seat + 1) % playerCount] = pottedGroup === 'solid' ? 'stripe' : 'solid';
        msg = '내 그룹: ' + (pottedGroup === 'solid' ? '솔리드 (1~7)' : '스트라이프 (9~15)');
      }
    }

    var myBallPotted = false;
    for (var k3 = 0; k3 < potted.length; k3++) {
      var gg = groupOf(potted[k3]);
      if (!openTable) {
        if (state.groups[seat] && gg === state.groups[seat]) myBallPotted = true;
      } else if (gg !== 'eight') myBallPotted = true;
    }

    if (fouls.length) {
      state.turn = (seat + 1) % playerCount;
      state.ballsInHand = true;
      var reasons = { 'no-contact': '공을 맞히지 못함', scratch: '큐볼 포켓', 'no-rail': '쿠션에 닿지 않음', 'wrong-ball': '내 공이 아닌 공을 먼저 맞힘', 'eight-first': '8번 공을 먼저 맞힘' };
      state.message = '파울: ' + reasons[fouls[0]] + ' — 상대방이 공을 놓고 칩니다.';
    } else if (myBallPotted) {
      state.ballsInHand = false;
      state.message = msg ? msg + ' — 한 번 더!' : '좋아요! 한 번 더 칩니다.';
    } else {
      state.turn = (seat + 1) % playerCount;
      state.ballsInHand = false;
      state.message = '다음 사람 차례예요.';
    }
    if (state.groups[seat]) {
      var left = onTable(sim.balls, function (b) { return groupOf(b.num) === state.groups[seat]; });
      if (left === 0 && eightLeft === 1) state.message += ' 이제 8번 공을 노리세요.';
    }
    state.details = { variant: '1v1', potted: potted, fouls: fouls, group: state.groups[seat] };
    return { events: ev, details: state.details };
  }

  /* After a shot that potted the 8 illegally in FFA, put it back. */
  function respotEight(state) {
    var t = P.TABLES.pool;
    for (var i = 0; i < state.balls.length; i++) {
      var b = state.balls[i];
      if (b.num === 8) {
        b.active = true;
        b.pocketed = false;
        b.x = t.W * 0.72; b.y = t.H * 0.5;
        b.vx = b.vy = 0;
        return true;
      }
    }
    return false;
  }

  function ballById(state, id) {
    for (var i = 0; i < state.balls.length; i++) if (state.balls[i].id === id) return state.balls[i];
    return null;
  }

  /* Public entry: apply one shot to a game state (mutates and returns result). */
  function takeShot(state, shot, playerCount, seats) {
    var table = P.TABLES[state.table];
    state.__owners = state.__owners || ownersOf(state);
    var sim = P.simulate(table, state.balls, shot, { maxTime: 16 });
    state.balls = sim.balls;
    state.shotNo = (state.shotNo || 0) + 1;
    state.lastShot = { shot: shot, ballsBefore: sim.frames[0].b };

    var result;
    if (state.mode === '4ball') result = resolve4Ball(state, shot, sim, playerCount);
    else {
      result = resolve8Ball(state, shot, sim, playerCount, seats);
      if (playerCount > 2) {
        // 8 ball is re-spotted in the score variant so the game keeps going
        for (var i = 0; i < sim.events.length; i++) {
          if (sim.events[i].type === 'pot' && sim.events[i].num === 8) { respotEight(state); break; }
        }
      }
    }
    state.phase = state.phase === 'ended' ? 'ended' : (state.ballsInHand ? 'ballinhand' : 'aim');
    state.lastEvents = sim.events.map(function (e) { return { type: e.type, id: e.id, a: e.a, b: e.b, num: e.num, pocket: e.pocket }; });
    return { sim: sim, result: result };
  }

  function ownersOf(state) {
    var o = {};
    for (var i = 0; i < state.balls.length; i++) {
      var b = state.balls[i];
      if (b.kind === 'cue') o[b.owner] = b.id;
    }
    return o;
  }

  function cueIdFor(state, seat) {
    if (state.mode === '4ball') {
      if (state.ffa) return seat % 2 === 0 ? 'white' : 'yellow';
      return seat === 0 ? 'white' : 'yellow';
    }
    return 'cue';
  }

  function legalCueSpot(state, seat, x, y) {
    var table = P.TABLES[state.table], R = table.ballR;
    if (x < R || x > table.W - R || y < R || y > table.H - R) return null;
    var cueId = cueIdFor(state, seat);
    for (var i = 0; i < state.balls.length; i++) {
      var b = state.balls[i];
      if (!b.active || b.id === cueId) continue;
      if (P.dist(x, y, b.x, b.y) < R * 2.05) return null;
    }
    return { x: x, y: y };
  }

  BA.rules = {
    BALL_STYLES: BALL_STYLES,
    newGameState: newGameState,
    takeShot: takeShot,
    cueIdFor: cueIdFor,
    targetScoreFor: targetScoreFor,
    legalCueSpot: legalCueSpot,
    ballById: ballById,
    groupOf: groupOf,
    setup4Ball: setup4Ball,
    setup8Ball: setup8Ball
  };
})(typeof window !== 'undefined' ? window : globalThis);
