(function () {
  'use strict';

  // ===== Константы игрового мира =====
  // Логические координаты канваса
  const W = 800;
  const H = 400;

  const EARTH = { x: 80, y: 200, r: 30 };
  const MOON  = { x: 720, y: 160, r: 16 };

  // Условные гравитационные параметры (GM) — подобраны для игры
  const GM_E = 300;
  const GM_M = 50;

  // Стартовая позиция аппарата (чуть выше и правее Земли)
  const SHIP_START = { x: 110, y: 180 };

  // Радиус зоны успеха вокруг Луны
  const SUCCESS_R = 65;

  // Частота физики (шагов в реальную секунду)
  const PHYS_HZ = 20;

  // Лимиты
  const MAX_STEPS = 900;
  const PREDICT_STEPS = 800;

  // Максимальная скорость импульса (условные пиксели за шаг)
  const POWER_MAX = 12;

  // ===== DOM =====
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');

  const powerSlider = document.getElementById('power');
  const angleSlider = document.getElementById('angle');
  const powerVal = document.getElementById('powerVal');
  const angleVal = document.getElementById('angleVal');
  const launchBtn = document.getElementById('launchBtn');
  const resetBtn = document.getElementById('resetBtn');
  const messageEl = document.getElementById('message');
  const hudTime = document.getElementById('hudTime');
  const hudSpeed = document.getElementById('hudSpeed');
  const hudDv = document.getElementById('hudDv');

  // ===== Состояние игры =====
  const state = {
    phase: 'aim',      // 'aim' | 'flying' | 'done'
    ship: null,        // { x, y, vx, vy }
    trajectory: [],    // [{x, y}, ...] — фактическая траектория
    prediction: [],    // [{x, y}, ...] — предсказание
    step: 0,
    dv: 0,             // суммарный ΔV (условный)
    result: null,      // 'success' | 'fail'
    accumulated: 0,
    lastTime: 0
  };

  // ===== Физика =====
  // Ускорение от двух тел с «сглаживанием» знаменателя
  function accel(x, y) {
    let ax = 0;
    let ay = 0;

    // Земля
    let dxe = x - EARTH.x;
    let dye = y - EARTH.y;
    let de2 = dxe * dxe + dye * dye;
    if (de2 < 1) de2 = 1;
    const de = Math.sqrt(de2);
    const ae = GM_E / de2;
    ax -= (ae * dxe) / de;
    ay -= (ae * dye) / de;

    // Луна
    let dxm = x - MOON.x;
    let dym = y - MOON.y;
    let dm2 = dxm * dxm + dym * dym;
    if (dm2 < 1) dm2 = 1;
    const dm = Math.sqrt(dm2);
    const am = GM_M / dm2;
    ax -= (am * dxm) / dm;
    ay -= (am * dym) / dm;

    return { ax, ay };
  }

  function stepShip(ship) {
    const { ax, ay } = accel(ship.x, ship.y);
    ship.vx += ax;
    ship.vy += ay;
    ship.x += ship.vx;
    ship.y += ship.vy;
  }

  // ===== Предсказание траектории =====
  function predictTrajectory(x, y, vx, vy, maxSteps) {
    const path = [{ x, y }];
    let px = x;
    let py = y;
    let pvx = vx;
    let pvy = vy;

    for (let i = 0; i < maxSteps; i++) {
      const { ax, ay } = accel(px, py);
      pvx += ax;
      pvy += ay;
      px += pvx;
      py += pvy;

      // Улетел за пределы — прекращаем
      if (px < -300 || px > W + 300 || py < -300 || py > H + 300) break;

      // Столкновение с Землёй
      const de = Math.hypot(px - EARTH.x, py - EARTH.y);
      if (de < EARTH.r) break;

      // Столкновение с Луной
      const dm = Math.hypot(px - MOON.x, py - MOON.y);
      if (dm < MOON.r) break;

      path.push({ x: px, y: py });

      // Достигли зоны успеха — предсказание можно остановить
      if (dm < SUCCESS_R) break;
    }

    return path;
  }

  // ===== Преобразования =====
  function powerToSpeed(p) {
    return (p / 100) * POWER_MAX;
  }

  // Условные км/с: 1 единица скорости = 1 км/с (для наглядности)
  function speedToKmS(v) {
    return v;
  }

  // ===== HUD =====
  function updateHudFlight() {
    const ship = state.ship;
    if (!ship) return;
    const speed = Math.hypot(ship.vx, ship.vy);
    hudTime.textContent = (state.step / PHYS_HZ).toFixed(1) + ' с';
    hudSpeed.textContent = speedToKmS(speed).toFixed(2) + ' км/с';
    hudDv.textContent = state.dv.toFixed(2) + ' км/с';
  }

  function updateHudAim() {
    const power = parseFloat(powerSlider.value);
    const speed = powerToSpeed(power);
    hudTime.textContent = '0.0 с';
    hudSpeed.textContent = speedToKmS(speed).toFixed(2) + ' км/с';
    hudDv.textContent = speedToKmS(speed).toFixed(2) + ' км/с';
  }

  function updateHudDone() {
    // Оставляем последние значения, но пересчитываем время
    const ship = state.ship;
    if (!ship) return;
    const speed = Math.hypot(ship.vx, ship.vy);
    hudTime.textContent = (state.step / PHYS_HZ).toFixed(1) + ' с';
    hudSpeed.textContent = speedToKmS(speed).toFixed(2) + ' км/с';
    hudDv.textContent = state.dv.toFixed(2) + ' км/с';
  }

  // ===== Обновление предсказания =====
  function updatePrediction() {
    if (state.phase !== 'aim') return;
    const power = parseFloat(powerSlider.value);
    const angle = parseFloat(angleSlider.value);
    const speed = powerToSpeed(power);
    const rad = (angle * Math.PI) / 180;
    const vx = speed * Math.cos(rad);
    const vy = -speed * Math.sin(rad);

    state.prediction = predictTrajectory(
      SHIP_START.x,
      SHIP_START.y,
      vx,
      vy,
      PREDICT_STEPS
    );
    updateHudAim();
  }

  // ===== Действия =====
  function launch() {
    if (state.phase !== 'aim') return;
    const power = parseFloat(powerSlider.value);
    const angle = parseFloat(angleSlider.value);
    const speed = powerToSpeed(power);
    const rad = (angle * Math.PI) / 180;
    const vx = speed * Math.cos(rad);
    const vy = -speed * Math.sin(rad);

    state.ship = {
      x: SHIP_START.x,
      y: SHIP_START.y,
      vx: vx,
      vy: vy
    };
    state.trajectory = [{ x: SHIP_START.x, y: SHIP_START.y }];
    state.prediction = [];
    state.step = 0;
    state.dv = speedToKmS(speed);
    state.phase = 'flying';
    state.result = null;
    state.accumulated = 0;
    state.lastTime = 0;

    launchBtn.disabled = true;
    powerSlider.disabled = true;
    angleSlider.disabled = true;
    resetBtn.hidden = true;
    messageEl.textContent = '';
    messageEl.className = 'message';

    updateHudFlight();
  }

  function endGame(result, reason) {
    state.phase = 'done';
    state.result = result;
    resetBtn.hidden = false;

    if (result === 'success') {
      messageEl.textContent = '✅ ' + reason;
      messageEl.className = 'message success';
    } else {
      messageEl.textContent = '❌ ' + reason;
      messageEl.className = 'message fail';
    }

    updateHudDone();
  }

  function reset() {
    state.phase = 'aim';
    state.ship = null;
    state.trajectory = [];
    state.step = 0;
    state.dv = 0;
    state.result = null;
    state.accumulated = 0;
    state.lastTime = 0;

    launchBtn.disabled = false;
    resetBtn.hidden = true;
    powerSlider.disabled = false;
    angleSlider.disabled = false;
    messageEl.textContent = '';
    messageEl.className = 'message';

    updatePrediction();
  }

  // ===== Один тик физики =====
  function physicsTick() {
    const ship = state.ship;
    if (!ship) return;

    stepShip(ship);
    state.step++;
    state.trajectory.push({ x: ship.x, y: ship.y });

    // Столкновение с Землёй
    const de = Math.hypot(ship.x - EARTH.x, ship.y - EARTH.y);
    if (de < EARTH.r) {
      endGame('fail', 'Аппарат разбился о Землю');
      return;
    }

    // Луна
    const dm = Math.hypot(ship.x - MOON.x, ship.y - MOON.y);
    if (dm < MOON.r) {
      endGame('fail', 'Аппарат разбился о Луну');
      return;
    }
    if (dm < SUCCESS_R) {
      endGame('success', 'Успех! Аппарат достиг Луны');
      return;
    }

    // Улетел за пределы
    if (ship.x < -300 || ship.x > W + 300 || ship.y < -300 || ship.y > H + 300) {
      endGame('fail', 'Аппарат улетел в открытый космос');
      return;
    }

    // Время вышло
    if (state.step > MAX_STEPS) {
      endGame('fail', 'Время вышло');
      return;
    }

    updateHudFlight();
  }

  // ===== Отрисовка =====
  const stars = [];
  for (let i = 0; i < 90; i++) {
    stars.push({
      x: Math.random() * W,
      y: Math.random() * H,
      r: Math.random() * 1.2 + 0.3,
      a: Math.random() * 0.7 + 0.3
    });
  }

  function drawStars() {
    for (let i = 0; i < stars.length; i++) {
      const s = stars[i];
      ctx.fillStyle = 'rgba(255,255,255,' + s.a + ')';
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawEarth() {
    const grad = ctx.createRadialGradient(
      EARTH.x - 10, EARTH.y - 10, 4,
      EARTH.x, EARTH.y, EARTH.r
    );
    grad.addColorStop(0, '#7fd2ff');
    grad.addColorStop(0.6, '#2a7acc');
    grad.addColorStop(1, '#0d2b56');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(EARTH.x, EARTH.y, EARTH.r, 0, Math.PI * 2);
    ctx.fill();

    // Тонкая атмосферная подсветка
    ctx.strokeStyle = 'rgba(110, 198, 255, 0.35)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(EARTH.x, EARTH.y, EARTH.r + 3, 0, Math.PI * 2);
    ctx.stroke();
  }

  function drawMoon() {
    const grad = ctx.createRadialGradient(
      MOON.x - 5, MOON.y - 5, 2,
      MOON.x, MOON.y, MOON.r
    );
    grad.addColorStop(0, '#f0f0f0');
    grad.addColorStop(0.7, '#b8b8b8');
    grad.addColorStop(1, '#6a6a6a');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(MOON.x, MOON.y, MOON.r, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawSuccessZone() {
    ctx.save();
    ctx.strokeStyle = 'rgba(120, 220, 255, 0.45)';
    ctx.setLineDash([6, 6]);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(MOON.x, MOON.y, SUCCESS_R, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  function drawPrediction() {
    const path = state.prediction;
    if (!path || path.length < 2) return;
    ctx.save();
    ctx.strokeStyle = 'rgba(140, 200, 255, 0.5)';
    ctx.setLineDash([3, 5]);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(path[0].x, path[0].y);
    for (let i = 1; i < path.length; i++) {
      ctx.lineTo(path[i].x, path[i].y);
    }
    ctx.stroke();
    ctx.restore();
  }

  function drawTrajectory() {
    const path = state.trajectory;
    if (!path || path.length < 2) return;
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 200, 100, 0.85)';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(path[0].x, path[0].y);
    for (let i = 1; i < path.length; i++) {
      ctx.lineTo(path[i].x, path[i].y);
    }
    ctx.stroke();
    ctx.restore();
  }

  function drawShip(ship, angleRad) {
    ctx.save();
    ctx.translate(ship.x, ship.y);
    ctx.rotate(angleRad);

    // Корпус
    ctx.fillStyle = '#ffcc44';
    ctx.beginPath();
    ctx.moveTo(9, 0);
    ctx.lineTo(-5, -4.5);
    ctx.lineTo(-3, 0);
    ctx.lineTo(-5, 4.5);
    ctx.closePath();
    ctx.fill();

    // Контур
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.lineWidth = 0.8;
    ctx.stroke();

    ctx.restore();
  }

  function drawShipGhost() {
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = '#ffcc44';
    ctx.beginPath();
    ctx.arc(SHIP_START.x, SHIP_START.y, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawLabels() {
    ctx.save();
    ctx.font = 'bold 13px -apple-system, "Segoe UI", Roboto, Arial, sans-serif';
    ctx.textAlign = 'center';

    ctx.fillStyle = 'rgba(140, 200, 255, 0.85)';
    ctx.fillText('Земля', EARTH.x, EARTH.y + EARTH.r + 20);

    ctx.fillStyle = 'rgba(220, 220, 220, 0.85)';
    ctx.fillText('Луна', MOON.x, MOON.y + MOON.r + 20);

    // Подпись зоны успеха
    ctx.font = '11px -apple-system, "Segoe UI", Roboto, Arial, sans-serif';
    ctx.fillStyle = 'rgba(120, 220, 255, 0.6)';
    ctx.fillText('зона успеха', MOON.x, MOON.y - SUCCESS_R - 6);

    ctx.restore();
  }

  function render() {
    // Фон
    ctx.fillStyle = '#05070f';
    ctx.fillRect(0, 0, W, H);

    drawStars();
    drawSuccessZone();

    // Предсказание (только в режиме прицеливания)
    if (state.phase === 'aim') {
      drawPrediction();
      drawShipGhost();
    }

    // Фактическая траектория
    if (state.phase === 'flying' || state.phase === 'done') {
      drawTrajectory();
    }

    drawEarth();
    drawMoon();

    // Аппарат
    if (state.phase === 'flying' || state.phase === 'done') {
      if (state.ship) {
        const angleRad = Math.atan2(state.ship.vy, state.ship.vx);
        drawShip(state.ship, angleRad);
      }
    } else {
      // В режиме прицеливания показываем аппарат, повёрнутый по направлению импульса
      const angle = parseFloat(angleSlider.value);
      const rad = (angle * Math.PI) / 180;
      // На экране y растёт вниз, поэтому угол вверх = отрицательный vy
      drawShip(
        { x: SHIP_START.x, y: SHIP_START.y },
        -rad
      );
    }

    drawLabels();
  }

  // ===== Главный цикл =====
  function loop(t) {
    if (!state.lastTime) state.lastTime = t;
    let dt = (t - state.lastTime) / 1000;
    state.lastTime = t;
    if (dt > 0.1) dt = 0.1;

    if (state.phase === 'flying') {
      state.accumulated += dt;
      const stepInterval = 1 / PHYS_HZ;
      let guard = 0;
      while (state.accumulated >= stepInterval && guard < 5) {
        physicsTick();
        state.accumulated -= stepInterval;
        guard++;
        if (state.phase !== 'flying') break;
      }
    }

    render();
    requestAnimationFrame(loop);
  }

  // ===== Адаптация канваса =====
  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(rect.width * dpr));
    const h = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const scale = Math.min(w / W, h / H);
    const offsetX = (w - W * scale) / 2;
    const offsetY = (h - H * scale) / 2;
    ctx.setTransform(scale, 0, 0, scale, offsetX, offsetY);
  }

  // ===== События =====
  powerSlider.addEventListener('input', function () {
    powerVal.textContent = powerSlider.value;
    updatePrediction();
  });

  angleSlider.addEventListener('input', function () {
    angleVal.textContent = angleSlider.value;
    updatePrediction();
  });

  launchBtn.addEventListener('click', launch);
  resetBtn.addEventListener('click', reset);

  document.addEventListener('keydown', function (e) {
    if (state.phase === 'flying') {
      return;
    }

    if (state.phase === 'done') {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        reset();
      }
      return;
    }

    // phase === 'aim'
    if (e.key === 'ArrowLeft') {
      const v = Math.max(-60, parseFloat(angleSlider.value) - 1);
      angleSlider.value = v;
      angleVal.textContent = v;
      updatePrediction();
      e.preventDefault();
    } else if (e.key === 'ArrowRight') {
      const v = Math.min(60, parseFloat(angleSlider.value) + 1);
      angleSlider.value = v;
      angleVal.textContent = v;
      updatePrediction();
      e.preventDefault();
    } else if (e.key === 'ArrowUp') {
      const v = Math.min(100, parseFloat(powerSlider.value) + 2);
      powerSlider.value = v;
      powerVal.textContent = v;
      updatePrediction();
      e.preventDefault();
    } else if (e.key === 'ArrowDown') {
      const v = Math.max(0, parseFloat(powerSlider.value) - 2);
      powerSlider.value = v;
      powerVal.textContent = v;
      updatePrediction();
      e.preventDefault();
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      launch();
    }
  });

  window.addEventListener('resize', function () {
    resizeCanvas();
  });

  window.addEventListener('orientationchange', function () {
    setTimeout(resizeCanvas, 200);
  });

  // ===== Инициализация =====
  resizeCanvas();
  updatePrediction();
  requestAnimationFrame(loop);
})();
