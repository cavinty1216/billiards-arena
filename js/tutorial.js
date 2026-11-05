/* Billiards Arena — interactive tutorial courses.
 * Every step puts real balls on a real table and, where a step asks for a shot,
 * the step is done when the shot the player actually played does the thing.
 */
(function (global) {
  'use strict';
  var BA = (global.BA = global.BA || {});
  var P = BA.physics;

  function b(id, x, y, kind, extra) { return P.ball(id, x, y, kind, extra); }

  function contacted(sim, cue, otherId) {
    for (var i = 0; i < sim.events.length; i++) {
      var e = sim.events[i];
      if (e.type === 'ball' && ((e.a === cue && e.b === otherId) || (e.b === cue && e.a === otherId))) return true;
    }
    return false;
  }
  function anyContact(sim, cue) {
    for (var i = 0; i < sim.events.length; i++) {
      var e = sim.events[i];
      if (e.type === 'ball' && (e.a === cue || e.b === cue)) return true;
    }
    return false;
  }
  function cueCushionTime(sim, cue) {
    for (var i = 0; i < sim.events.length; i++) {
      var e = sim.events[i];
      if (e.type === 'cushion' && e.id === cue) return e.t;
    }
    return Infinity;
  }
  function contactTimes(sim, cue, otherId) {
    var t = Infinity;
    for (var i = 0; i < sim.events.length; i++) {
      var e = sim.events[i];
      if (e.type === 'ball' && ((e.a === cue && e.b === otherId) || (e.b === cue && e.a === otherId))) t = Math.min(t, e.t);
    }
    return t;
  }
  function pottedAny(sim, excludeCue) {
    var list = [];
    for (var i = 0; i < sim.events.length; i++) if (sim.events[i].type === 'pot') list.push(sim.events[i]);
    if (excludeCue) list = list.filter(function (e) { return e.id !== excludeCue; });
    return list;
  }

  /* ------------------------------------------------------------- 4-ball */
  var fourBall = {
    id: '4ball',
    title: '사구(4구) 배우기',
    table: 'carom',
    steps: [
      {
        title: '사구는 공 4개로 하는 당구',
        info: true,
        body: '<p><b>사구(4구)</b>는 포켓이 없는 테이블에서 공 4개로 점수를 내는 한국식 당구예요.</p>' +
          '<ul><li><b>흰 공</b> = 나의 공 (수구)</li><li><b>노란 공</b> = 상대의 공</li><li><b>빨간 공 2개</b> = 점수를 내는 표적</li></ul>' +
          '<p>내 공을 쳐서 <b>빨간 공 두 개를 모두</b> 맞히면 점수가 나요. 포켓이 없으니 공이 떨어질 일은 없습니다.</p>',
        setup: function () {
          var balls = BA.rules.setup4Ball();
          return { table: 'carom', balls: balls, cueId: 'white' };
        }
      },
      {
        title: '조준하고 치는 방법',
        body: '<p>화면을 <b>드래그</b>해 보세요. 내 공(흰 공)에서 손가락 방향으로 조준선이 생겨요.</p>' +
          '<p>조금 더 멀리 끌수록 <b>세기</b>가 세집니다. 손을 떼면 샷!</p>' +
          '<p>💡 컴퓨터에서는 방향키로 각도를, <span class="kbd">Space</span>로 칠 수 있어요.</p>',
        goal: '빨간 공에 내 공을 한 번 맞혀 보세요',
        hint: '빨간 공을 향해 드래그한 뒤 손을 떼면 됩니다. 세기가 너무 약하면 공이 멈춰요.',
        setup: function () {
          return {
            table: 'carom',
            cueId: 'white',
            balls: [
              b('white', 0.80, 0.71, 'cue', { owner: 0 }),
              b('yellow', 2.30, 1.10, 'cue', { owner: 1 }),
              b('red1', 1.62, 0.71, 'red'),
              b('red2', 2.25, 0.40, 'red')
            ]
          };
        },
        check: function (shot, sim) { return anyContact(sim, 'white'); }
      },
      {
        title: '두 빨간 공을 모두 맞히면 1점',
        body: '<p>사구의 점수는 간단해요. 내 공이 <b>빨간 공 1</b>과 <b>빨간 공 2</b>를 <b>한 번의 샷 안에서 모두</b> 맞히면 1점입니다.</p>' +
          '<p>지금은 빨간 공 두 개가 일직선으로 놓여 있어요. 앞의 빨간 공을 맞히면 뒤의 빨간 공까지 연달아 맞을 수 있습니다.</p>',
        goal: '한 샷으로 빨간 공 두 개를 모두 맞혀 보세요',
        hint: '빨간 공 두 개가 나란히 있으니, 앞의 빨간 공 중심을 정확히 향해 세게 쳐 보세요.',
        setup: function () {
          return {
            table: 'carom',
            cueId: 'white',
            balls: [
              b('white', 0.70, 0.71, 'cue', { owner: 0 }),
              b('yellow', 2.45, 0.28, 'cue', { owner: 1 }),
              b('red1', 1.28, 0.71, 'red'),
              b('red2', 1.88, 0.71, 'red')
            ]
          };
        },
        check: function (shot, sim) { return contacted(sim, 'white', 'red1') && contacted(sim, 'white', 'red2'); }
      },
      {
        title: '쿠션을 쓰면 2점',
        body: '<p>내 공이 빨간 공을 맞히기 <b>전에 쿠션(테이블 벽)을 한 번 이상</b> 맞히면 <b>2점</b>이에요.</p>' +
          '<p>공이 쿠션에 부딪히면 각도가 반사돼요. 이 성질을 이용하면 직접 맞힐 수 없는 공도 노릴 수 있습니다.</p>' +
          '<p>어렵다면 <b>시연</b> 버튼으로 예시 샷을 볼 수 있어요.</p>',
        goal: '쿠션을 먼저 맞힌 뒤 두 빨간 공을 모두 맞혀 보세요',
        hint: '먼저 쿠션을 향해 치고, 튕겨 나온 공이 빨간 공 두 개를 지나가게 만들어야 해요.',
        demo: { spins: [{ sx: 0, sy: 0 }, { sx: 0.3, sy: 0 }] },
        setup: function () {
          return {
            table: 'carom',
            cueId: 'white',
            balls: [
              b('white', 0.42, 0.95, 'cue', { owner: 0 }),
              b('yellow', 2.52, 0.22, 'cue', { owner: 1 }),
              b('red1', 1.30, 0.62, 'red'),
              b('red2', 1.72, 0.86, 'red')
            ]
          };
        },
        check: function (shot, sim) {
          if (!(contacted(sim, 'white', 'red1') && contacted(sim, 'white', 'red2'))) return false;
          var c = cueCushionTime(sim, 'white');
          var last = Math.max(contactTimes(sim, 'white', 'red1'), contactTimes(sim, 'white', 'red2'));
          return c < last;
        }
      },
      {
        title: '당점(스핀)으로 공을 조절하기',
        body: '<p>아래 <b>당점</b> 동그라미에서 점을 움직여 보세요. 공의 어디를 칠지 정하는 것입니다.</p>' +
          '<ul><li><b>위쪽</b>: 밀어치기 — 맞힌 뒤 내 공이 앞으로 따라갑니다</li>' +
          '<li><b>아래쪽</b>: 끌어치기 — 맞힌 뒤 내 공이 뒤로 돌아옵니다</li>' +
          '<li><b>좌우</b>: 옆돌리기 — 쿠션에 부딪힌 뒤 각도가 달라집니다</li></ul>' +
          '<p>지금은 빨간 공을 맞히면서 <b>당점을 위나 아래로</b> 옮겨서 쳐 보세요.</p>',
        goal: '당점을 위/아래로 옮기고 빨간 공을 맞혀 보세요',
        hint: '당점 동그라미의 위쪽이나 아래쪽을 눌러 점을 옮긴 다음 샷!',
        setup: function () {
          return {
            table: 'carom',
            cueId: 'white',
            balls: [
              b('white', 1.00, 0.71, 'cue', { owner: 0 }),
              b('yellow', 0.45, 0.28, 'cue', { owner: 1 }),
              b('red1', 1.88, 0.71, 'red'),
              b('red2', 2.35, 0.32, 'red')
            ]
          };
        },
        check: function (shot, sim) { return anyContact(sim, 'white') && Math.abs(shot.spinY) >= 0.35; }
      },
      {
        title: '상대 공을 맞혀도 괜찮아요',
        info: true,
        body: '<p>사구에서는 <b>상대 공(노란 공)을 맞혀도 반칙이 아니에요.</b> 오히려 상대 공을 이용해 점수를 내기도 합니다.</p>' +
          '<p>내 공이 빨간 공 두 개를 맞히기만 하면 되니, 상대 공은 또 하나의 쿠션처럼 쓸 수 있어요.</p>' +
          '<p>실제 사구는 <b>2인 경기</b>입니다. 공이 흰 공·노란 공 두 개뿐이라 3명 이상이 함께 칠 수 없어요. 3~4명이 함께 하려면 8볼 스코어전을 쓰면 됩니다.</p>',
        setup: function () { return { table: 'carom', balls: BA.rules.setup4Ball(), cueId: 'white' }; }
      },
      {
        title: '점수와 승리 조건',
        info: true,
        body: '<p>이 앱의 사구 점수 규칙이에요.</p>' +
          '<ul><li>두 빨간 공 모두 맞히기 = <b>1점</b></li>' +
          '<li>쿠션을 먼저 맞힌 뒤 두 빨간 공 맞히기 = <b>2점</b></li>' +
          '<li>점수를 내면 <b>한 번 더</b> 칩니다</li>' +
          '<li>실패하면 상대에게 차례가 넘어갑니다</li>' +
          '<li><b>7점</b>에 먼저 도달하면 승리</li></ul>' +
          '<p class="note">※ 정식 사구는 대회마다 세부 규칙이 조금씩 다릅니다. 이 앱은 입문자가 이해하기 쉬운 규칙으로 단순화했어요.</p>',
        setup: function () { return { table: 'carom', balls: BA.rules.setup4Ball(), cueId: 'white' }; }
      }
    ]
  };

  /* -------------------------------------------------------------- 8-ball */
  var eightBall = {
    id: '8ball',
    title: '포켓 8볼 배우기',
    table: 'pool',
    steps: [
      {
        title: '8볼은 포켓이 6개',
        info: true,
        body: '<p><b>포켓 8볼</b>은 테이블 가장자리에 구멍(포켓) 6개가 있고, 공을 그 구멍에 넣어 점수를 내는 경기예요.</p>' +
          '<ul><li><b>1~7번</b> = 솔리드 (한 가지 색)</li><li><b>9~15번</b> = 스트라이프 (줄무늬)</li><li><b>8번</b> = 검은 공, 마지막에 넣어야 함</li></ul>' +
          '<p>내 그룹 공을 다 넣은 뒤 8번 공을 넣으면 승리!</p>',
        setup: function () { return { table: 'pool', balls: BA.rules.setup8Ball(), cueId: 'cue' }; }
      },
      {
        title: '내 공으로 공을 맞히기',
        body: '<p>8볼에서는 <b>내 공(흰 공)으로 다른 공을 먼저 맞히는 것</b>이 기본이에요.</p>' +
          '<p>드래그해서 조준하고 손을 떼면 샷이 나갑니다. 화면의 <b>고스트 공</b>(반투명 원)은 내 공이 닿을 지점이에요.</p>',
        goal: '공에 내 공을 한 번 맞혀 보세요',
        hint: '공을 향해 드래그한 뒤 손을 떼면 됩니다.',
        setup: function () {
          return {
            table: 'pool',
            cueId: 'cue',
            balls: [
              b('cue', 0.55, 0.635, 'cue', { owner: 0 }),
              b('b1', 1.55, 0.635, 'object', { num: 1 }),
              b('b2', 2.05, 0.42, 'object', { num: 2 }),
              b('b9', 2.05, 0.85, 'object', { num: 9 })
            ]
          };
        },
        check: function (shot, sim) { return anyContact(sim, 'cue'); }
      },
      {
        title: '포켓에 넣으면 계속 칠 수 있어요',
        body: '<p>공을 포켓에 넣으면 <b>한 번 더</b> 칩니다. 넣지 못하면 상대 차례로 넘어가요.</p>' +
          '<p>빨간 1번 공이 왼쪽 위 포켓 근처에 있어요. 그 공을 포켓으로 밀어 넣어 보세요.</p>',
        goal: '공 하나를 포켓에 넣어 보세요',
        hint: '공 뒤쪽에서 공과 포켓이 일직선이 되게 조준하면 들어갑니다.',
        demo: { spins: [{ sx: 0, sy: 0 }] },
        setup: function () {
          return {
            table: 'pool',
            cueId: 'cue',
            balls: [
              b('cue', 0.90, 0.42, 'cue', { owner: 0 }),
              b('b1', 0.42, 0.20, 'object', { num: 1 }),
              b('b9', 1.95, 1.05, 'object', { num: 9 }),
              b('b2', 1.40, 1.05, 'object', { num: 2 })
            ]
          };
        },
        check: function (shot, sim) { return pottedAny(sim, 'cue').length > 0; }
      },
      {
        title: '내 그룹 정하기',
        body: '<p>처음에는 테이블이 <b>열려</b> 있어요(그룹 없음). 첫 번째로 넣은 공에 따라 내 그룹이 정해집니다.</p>' +
          '<p>솔리드를 넣으면 내가 <b>솔리드(1~7)</b>, 상대가 스트라이프가 됩니다. 이후에는 내 그룹 공을 먼저 맞혀야 해요.</p>' +
          '<p>아무 공이나 하나 넣어 그룹이 정해지는 걸 확인해 보세요.</p>',
        goal: '공을 넣어 그룹을 정해 보세요',
        hint: '포켓 근처의 공을 노려 보세요.',
        demo: { spins: [{ sx: 0, sy: 0 }] },
        setup: function () {
          return {
            table: 'pool',
            cueId: 'cue',
            balls: [
              b('cue', 0.95, 0.45, 'cue', { owner: 0 }),
              b('b1', 0.40, 0.20, 'object', { num: 1 }),
              b('b9', 1.90, 0.35, 'object', { num: 9 }),
              b('b3', 1.60, 1.00, 'object', { num: 3 })
            ]
          };
        },
        check: function (shot, sim) { return pottedAny(sim, 'cue').length > 0; }
      },
      {
        title: '파울: 큐볼이 들어가면',
        body: '<p>내 공(큐볼)이 포켓에 들어가면 <b>파울</b>이에요. 상대는 <b>공을 원하는 위치에 놓고</b> 칩니다(공 놓기).</p>' +
          '<p>그 밖의 파울: 공을 아예 맞히지 못함, 내 그룹이 아닌 공을 먼저 맞힘, 공이 쿠션에 닿지 않음.</p>' +
          '<p>파울이 어떻게 되는지 직접 확인해 볼까요? 큐볼을 포켓에 넣어 보세요.</p>',
        goal: '큐볼을 포켓에 넣어 파울을 확인해 보세요',
        hint: '큐볼을 포켓 방향으로 그냥 밀어 넣으면 됩니다.',
        demo: { spins: [{ sx: 0, sy: 0 }] },
        setup: function () {
          return {
            table: 'pool',
            cueId: 'cue',
            balls: [
              b('cue', 1.20, 0.635, 'cue', { owner: 0 }),
              b('b1', 0.35, 0.20, 'object', { num: 1 }),
              b('b9', 2.10, 0.35, 'object', { num: 9 })
            ]
          };
        },
        check: function (shot, sim) {
          var pots = pottedAny(sim, null);
          return pots.some(function (e) { return e.id === 'cue'; });
        }
      },
      {
        title: '8번 공은 마지막에',
        info: true,
        body: '<p><b>8번 공</b>은 내 그룹 공을 모두 넣은 뒤에만 넣을 수 있어요.</p>' +
          '<ul><li>8번 공을 먼저 넣으면 <b>바로 패배</b></li><li>내 그룹을 다 넣었을 때 8번을 넣으면 <b>승리</b></li></ul>' +
          '<p>그래서 마지막 8번 공을 넣을 때는 특히 신중해야 합니다.</p>',
        setup: function () { return { table: 'pool', balls: BA.rules.setup8Ball(), cueId: 'cue' }; }
      },
      {
        title: '3~4명은 스코어전으로',
        body: '<p>정식 8볼은 <b>1 대 1</b> 경기예요. 그룹(솔리드/스트라이프)이 두 개뿐이라 3명 이상이 같은 규칙으로 칠 수 없습니다.</p>' +
          '<p>그래서 이 앱에는 <b>3~4인 개인전 스코어전</b>을 따로 만들었어요. 정식 규칙이 아닌 <b>이 앱의 변형 규칙</b>입니다.</p>' +
          '<ul><li>순서대로 한 번씩 칩니다 (팀전 아님, 각자 개인전)</li>' +
          '<li>공 하나 = 1점, 8번 공 = 3점</li>' +
          '<li>넣으면 한 번 더, 못 넣으면 다음 사람</li>' +
          '<li>큐볼 포켓·공 안 맞힘 = <b>-1점</b>이고 다음 사람이 공을 놓고 시작</li>' +
          '<li><b>9점</b>에 먼저 도달하면 승리</li></ul>' +
          '<p class="note">※ 8번 공은 스코어전에서도 계속 다시 놓여서 게임이 이어집니다.</p>',
        setup: function () { return { table: 'pool', balls: BA.rules.setup8Ball(), cueId: 'cue' }; }
      }
    ]
  };

  /* Look for a shot that satisfies the step, so a stuck beginner can watch one. */
  function findSolution(setupFn, checkFn, opts) {
    var setup = setupFn();
    var table = P.TABLES[setup.table];
    var spins = (opts && opts.spins) || [{ sx: 0, sy: 0 }];
    var powers = [0.42, 0.58, 0.76, 0.92];
    var angles = 56;
    for (var s = 0; s < spins.length; s++) {
      for (var pi = 0; pi < powers.length; pi++) {
        for (var ai = 0; ai < angles; ai++) {
          var angle = -Math.PI + (ai / angles) * Math.PI * 2;
          var shot = {
            cueId: setup.cueId, angle: angle, power: powers[pi],
            spinX: spins[s].sx || 0, spinY: spins[s].sy || 0
          };
          var sim = P.simulate(table, setup.balls, shot, { maxTime: 9, dt: 1 / 180, frameEvery: 9 });
          if (checkFn(shot, sim)) return { shot: shot, sim: sim };
        }
      }
    }
    return null;
  }

  BA.tutorial = {
    courses: { '4ball': fourBall, '8ball': eightBall },
    findSolution: findSolution
  };
})(typeof window !== 'undefined' ? window : globalThis);
