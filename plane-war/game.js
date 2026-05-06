(() => {
  "use strict";

  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d", { alpha: false });

  const elScore = document.getElementById("score");
  const elWave = document.getElementById("wave");
  const elLives = document.getElementById("lives");
  const elFinalScore = document.getElementById("final-score");
  const panelStart = document.getElementById("panel-start");
  const panelGameover = document.getElementById("panel-gameover");
  const overlayPaused = document.getElementById("paused");
  const btnStart = document.getElementById("btn-start");
  const btnRetry = document.getElementById("btn-retry");

  let W = 480;
  let H = 720;
  let scale = 1;
  let dpr = 1;

  const state = {
    playing: false,
    paused: false,
    score: 0,
    wave: 1,
    lives: 3,
    tick: 0,
    spawnTimer: 0,
    bossTimer: 0,
  };

  const keys = new Set();
  let touchActive = false;
  let touchX = 0;
  let touchY = 0;
  let fireHeld = false;

  const player = {
    x: 0,
    y: 0,
    w: 44,
    h: 52,
    speed: 320,
    cooldown: 0,
    invuln: 0,
  };

  const bullets = [];
  const enemyBullets = [];
  const enemies = [];
  const particles = [];
  const stars = [];

  let audioCtx = null;

  function ensureAudio() {
    if (!audioCtx && typeof AudioContext !== "undefined") {
      audioCtx = new AudioContext();
    }
    return audioCtx;
  }

  function beep(freq, dur, type = "square", vol = 0.06) {
    const ac = ensureAudio();
    if (!ac) return;
    if (ac.state === "suspended") ac.resume();
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.value = vol;
    o.connect(g);
    g.connect(ac.destination);
    o.start();
    o.stop(ac.currentTime + dur);
  }

  function resize() {
    const wrap = canvas.parentElement;
    const maxW = wrap.clientWidth;
    const maxH = wrap.clientHeight;
    const aspect = H / W;
    let cw = maxW;
    let ch = cw * aspect;
    if (ch > maxH) {
      ch = maxH;
      cw = ch / aspect;
    }
    scale = cw / W;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.style.width = `${cw}px`;
    canvas.style.height = `${ch}px`;
    canvas.width = Math.floor(W * dpr);
    canvas.height = Math.floor(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    initStars();
  }

  function initStars() {
    stars.length = 0;
    const count = Math.floor((W * H) / 2200);
    for (let i = 0; i < count; i++) {
      stars.push({
        x: Math.random() * W,
        y: Math.random() * H,
        s: 0.5 + Math.random() * 2,
        v: 20 + Math.random() * 80,
        a: 0.3 + Math.random() * 0.7,
      });
    }
  }

  function resetGame() {
    state.playing = true;
    state.paused = false;
    state.score = 0;
    state.wave = 1;
    state.lives = 3;
    state.tick = 0;
    state.spawnTimer = 0;
    state.bossTimer = 0;
    player.x = W / 2 - player.w / 2;
    player.y = H - player.h - 36;
    player.cooldown = 0;
    player.invuln = 0;
    bullets.length = 0;
    enemyBullets.length = 0;
    enemies.length = 0;
    particles.length = 0;
    overlayPaused.classList.add("hidden");
    panelGameover.classList.add("hidden");
    panelStart.classList.add("hidden");
    syncHud();
  }

  function syncHud() {
    elScore.textContent = String(state.score);
    elWave.textContent = String(state.wave);
    elLives.textContent = String(state.lives);
  }

  function spawnEnemy() {
    const roll = Math.random();
    const w = state.wave;
    let type = "grunt";
    if (roll < 0.12 + w * 0.02) type = "tank";
    else if (roll < 0.35 + w * 0.03) type = "fast";

    const ew = type === "tank" ? 56 : type === "fast" ? 36 : 44;
    const eh = type === "tank" ? 48 : type === "fast" ? 40 : 44;
    const ex = 24 + Math.random() * (W - ew - 48);
    const baseHp = type === "tank" ? 4 + Math.floor(w / 2) : type === "fast" ? 1 : 2 + Math.floor(w / 4);
    const vy = type === "fast" ? 80 + w * 8 : type === "tank" ? 45 + w * 3 : 55 + w * 5;

    enemies.push({
      x: ex,
      y: -eh - 4,
      w: ew,
      h: eh,
      vx: (Math.random() - 0.5) * (30 + w * 3),
      vy,
      hp: baseHp,
      type,
      shootCd: 0.8 + Math.random() * 0.6,
      phase: Math.random() * Math.PI * 2,
    });
  }

  function addParticles(x, y, n, color) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 60 + Math.random() * 220;
      particles.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: 0.35 + Math.random() * 0.35,
        max: 0.35 + Math.random() * 0.35,
        color,
      });
    }
  }

  function rectsOverlap(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  function update(dt) {
    if (!state.playing || state.paused) return;
    state.tick += dt;

    const left = keys.has("ArrowLeft") || keys.has("a") || keys.has("A");
    const right = keys.has("ArrowRight") || keys.has("d") || keys.has("D");
    const up = keys.has("ArrowUp") || keys.has("w") || keys.has("W");
    const down = keys.has("ArrowDown") || keys.has("s") || keys.has("S");
    const shootKey =
      keys.has(" ") || keys.has("Spacebar") || keys.has("j") || keys.has("J");

    if (touchActive) {
      const tx = touchX / scale;
      const ty = touchY / scale;
      const cx = player.x + player.w / 2;
      const cy = player.y + player.h / 2;
      const dx = tx - cx;
      const dy = ty - cy;
      const dist = Math.hypot(dx, dy);
      if (dist > 6) {
        const sp = player.speed * 1.1;
        player.x += (dx / dist) * Math.min(sp * dt, dist);
        player.y += (dy / dist) * Math.min(sp * dt, dist);
      }
    } else {
      let mx = (right ? 1 : 0) - (left ? 1 : 0);
      let my = (down ? 1 : 0) - (up ? 1 : 0);
      if (mx !== 0 && my !== 0) {
        mx *= 0.707;
        my *= 0.707;
      }
      player.x += mx * player.speed * dt;
      player.y += my * player.speed * dt;
    }

    player.x = Math.max(12, Math.min(W - player.w - 12, player.x));
    player.y = Math.max(H * 0.35, Math.min(H - player.h - 12, player.y));

    const wantShoot = shootKey || fireHeld;
    player.cooldown -= dt;
    const fireRate = 0.14;
    if (wantShoot && player.cooldown <= 0) {
      const wing = player.w * 0.22;
      bullets.push({
        x: player.x + player.w / 2 - wing - 3,
        y: player.y + 6,
        w: 6,
        h: 18,
        vy: -560,
      });
      bullets.push({
        x: player.x + player.w / 2 + wing - 3,
        y: player.y + 6,
        w: 6,
        h: 18,
        vy: -560,
      });
      player.cooldown = fireRate;
      beep(880, 0.03, "square", 0.04);
    }

    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i];
      b.y += b.vy * dt;
      if (b.y + b.h < 0) bullets.splice(i, 1);
    }

    const spawnEvery = Math.max(0.35, 1.1 - state.wave * 0.06);
    state.spawnTimer -= dt;
    if (state.spawnTimer <= 0) {
      spawnEnemy();
      state.spawnTimer = spawnEvery + Math.random() * 0.4;
    }

    for (let i = enemies.length - 1; i >= 0; i--) {
      const e = enemies[i];
      e.phase += dt * 2;
      e.x += e.vx * dt + Math.sin(e.phase) * (e.type === "fast" ? 40 : 22) * dt;
      e.y += e.vy * dt;

      if (e.x < 16 || e.x + e.w > W - 16) e.vx *= -1;

      e.shootCd -= dt;
      if (e.y > 40 && e.y < H - 120 && e.shootCd <= 0) {
        enemyBullets.push({
          x: e.x + e.w / 2 - 4,
          y: e.y + e.h,
          w: 8,
          h: 14,
          vy: 220 + state.wave * 12,
        });
        e.shootCd = 1.2 + Math.random() * 0.9 - Math.min(0.5, state.wave * 0.04);
      }

      if (e.y > H + 40) enemies.splice(i, 1);
    }

    for (let i = enemyBullets.length - 1; i >= 0; i--) {
      const b = enemyBullets[i];
      b.y += b.vy * dt;
      if (b.y > H + 20) enemyBullets.splice(i, 1);
    }

    const pb = { x: player.x, y: player.y, w: player.w, h: player.h };

    for (let i = enemies.length - 1; i >= 0; i--) {
      const e = enemies[i];
      for (let j = bullets.length - 1; j >= 0; j--) {
        const b = bullets[j];
        if (rectsOverlap(b, e)) {
          bullets.splice(j, 1);
          e.hp -= 1;
          addParticles(e.x + e.w / 2, e.y + e.h / 2, 6, "#00e5ff");
          if (e.hp <= 0) {
            const pts = e.type === "tank" ? 30 : e.type === "fast" ? 15 : 10;
            state.score += pts;
            addParticles(e.x + e.w / 2, e.y + e.h / 2, 18, "#ff6b9d");
            beep(120 + Math.random() * 60, 0.05, "sawtooth", 0.05);
            enemies.splice(i, 1);
            syncHud();
            const nextWave = 1 + Math.floor(state.score / 400);
            if (nextWave > state.wave) {
              state.wave = nextWave;
              syncHud();
            }
          }
          break;
        }
      }
    }

    if (player.invuln > 0) player.invuln -= dt;

    for (let i = enemyBullets.length - 1; i >= 0; i--) {
      const b = enemyBullets[i];
      if (player.invuln <= 0 && rectsOverlap(b, pb)) {
        enemyBullets.splice(i, 1);
        hitPlayer();
      }
    }

    for (let i = enemies.length - 1; i >= 0; i--) {
      const e = enemies[i];
      if (player.invuln <= 0 && rectsOverlap(e, pb)) {
        enemies.splice(i, 1);
        addParticles(e.x + e.w / 2, e.y + e.h / 2, 14, "#ffcc00");
        hitPlayer(true);
      }
    }

    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 180 * dt;
      p.life -= dt;
      if (p.life <= 0) particles.splice(i, 1);
    }

    for (const s of stars) {
      s.y += s.v * dt;
      if (s.y > H) {
        s.y = 0;
        s.x = Math.random() * W;
      }
    }
  }

  function hitPlayer(big) {
    state.lives -= 1;
    player.invuln = big ? 1.8 : 1.2;
    addParticles(player.x + player.w / 2, player.y + player.h / 2, 28, "#ffffff");
    beep(100, 0.12, "sawtooth", 0.08);
    syncHud();
    if (state.lives <= 0) gameOver();
  }

  function gameOver() {
    state.playing = false;
    elFinalScore.textContent = String(state.score);
    panelGameover.classList.remove("hidden");
    beep(60, 0.25, "square", 0.07);
  }

  function drawPlayer() {
    const { x, y, w, h } = player;
    const flicker = player.invuln > 0 && Math.floor(state.tick * 20) % 2 === 0;
    if (flicker) ctx.globalAlpha = 0.45;

    const grd = ctx.createLinearGradient(x, y, x, y + h);
    grd.addColorStop(0, "#7aebff");
    grd.addColorStop(0.5, "#00a8e8");
    grd.addColorStop(1, "#005f8c");

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x + w / 2, y);
    ctx.lineTo(x + w, y + h * 0.55);
    ctx.lineTo(x + w * 0.72, y + h * 0.55);
    ctx.lineTo(x + w * 0.62, y + h);
    ctx.lineTo(x + w * 0.38, y + h);
    ctx.lineTo(x + w * 0.28, y + h * 0.55);
    ctx.lineTo(x, y + h * 0.55);
    ctx.closePath();
    ctx.fillStyle = grd;
    ctx.fill();
    ctx.strokeStyle = "rgba(180, 240, 255, 0.9)";
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(x + w / 2, y + h * 0.15);
    ctx.lineTo(x + w / 2, y + h * 0.5);
    ctx.strokeStyle = "rgba(255,255,255,0.5)";
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.shadowColor = "#00e5ff";
    ctx.shadowBlur = 12;
    ctx.fillStyle = "rgba(0, 255, 255, 0.35)";
    ctx.fillRect(x + w / 2 - 4, y + h - 8, 8, 14);
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  function drawEnemy(e) {
    const { x, y, w, h, type } = e;
    let fill = "#c94b7a";
    let stroke = "#ff8fb8";
    if (type === "tank") {
      fill = "#6b4c9a";
      stroke = "#c4a8ff";
    } else if (type === "fast") {
      fill = "#e85d4c";
      stroke = "#ffc9a3";
    }

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x + w / 2, y + h);
    ctx.lineTo(x + w, y + h * 0.35);
    ctx.lineTo(x + w * 0.78, y + h * 0.2);
    ctx.lineTo(x + w / 2, y);
    ctx.lineTo(x + w * 0.22, y + h * 0.2);
    ctx.lineTo(x, y + h * 0.35);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,0.25)";
    ctx.beginPath();
    ctx.arc(x + w / 2, y + h * 0.45, w * 0.12, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawBullets() {
    for (const b of bullets) {
      const g = ctx.createLinearGradient(b.x, b.y, b.x, b.y + b.h);
      g.addColorStop(0, "#ffffff");
      g.addColorStop(1, "#00e5ff");
      ctx.fillStyle = g;
      ctx.shadowColor = "#00ffff";
      ctx.shadowBlur = 8;
      ctx.fillRect(b.x, b.y, b.w, b.h);
    }
    ctx.shadowBlur = 0;
    for (const b of enemyBullets) {
      ctx.fillStyle = "#ff4466";
      ctx.shadowColor = "#ff0044";
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.arc(b.x + b.w / 2, b.y + b.h / 2, b.w / 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.shadowBlur = 0;
  }

  function drawParticles() {
    for (const p of particles) {
      const t = p.life / p.max;
      ctx.globalAlpha = Math.max(0, t);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
    }
    ctx.globalAlpha = 1;
  }

  function drawStars() {
    for (const s of stars) {
      ctx.globalAlpha = s.a;
      ctx.fillStyle = "#a8d8ff";
      ctx.fillRect(s.x, s.y, s.s, s.s * 3);
    }
    ctx.globalAlpha = 1;
  }

  function drawVignette() {
    const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.15, W / 2, H / 2, H * 0.75);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, "rgba(0,0,0,0.35)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  function render() {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#0a1228");
    g.addColorStop(0.55, "#050a18");
    g.addColorStop(1, "#02040c");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    drawStars();

    for (const e of enemies) drawEnemy(e);
    drawBullets();
    if (state.playing) drawPlayer();
    drawParticles();
    drawVignette();
  }

  let last = performance.now();
  function loop(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    update(dt);
    render();
    requestAnimationFrame(loop);
  }

  window.addEventListener("keydown", (e) => {
    if (e.code === "Space") e.preventDefault();
    keys.add(e.key.length === 1 ? e.key : e.code);
    if (e.key === "p" || e.key === "P") {
      if (!state.playing) return;
      state.paused = !state.paused;
      overlayPaused.classList.toggle("hidden", !state.paused);
    }
  });

  window.addEventListener("keyup", (e) => {
    keys.delete(e.key.length === 1 ? e.key : e.code);
  });

  canvas.addEventListener(
    "touchstart",
    (e) => {
      e.preventDefault();
      touchActive = true;
      const r = canvas.getBoundingClientRect();
      touchX = e.touches[0].clientX - r.left;
      touchY = e.touches[0].clientY - r.top;
      fireHeld = true;
      ensureAudio();
    },
    { passive: false }
  );

  canvas.addEventListener(
    "touchmove",
    (e) => {
      e.preventDefault();
      const r = canvas.getBoundingClientRect();
      touchX = e.touches[0].clientX - r.left;
      touchY = e.touches[0].clientY - r.top;
    },
    { passive: false }
  );

  canvas.addEventListener(
    "touchend",
    (e) => {
      e.preventDefault();
      if (e.touches.length === 0) {
        touchActive = false;
        fireHeld = false;
      }
    },
    { passive: false }
  );

  btnStart.addEventListener("click", () => {
    ensureAudio();
    resetGame();
  });

  btnRetry.addEventListener("click", () => {
    ensureAudio();
    resetGame();
  });

  window.addEventListener("resize", resize);
  resize();
  requestAnimationFrame(loop);
})();
