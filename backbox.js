const canvas = document.querySelector('#backboxCanvas');
const ctx = canvas?.getContext('2d', { alpha: false });

if (canvas && ctx) {
  const W = 1280, H = 720;
  const mobile = matchMedia('(max-width: 850px)').matches;
  if (mobile) { canvas.width = 640; canvas.height = 360; ctx.setTransform(.5, 0, 0, .5, 0, 0); }
  const art = new Image();
  art.decoding = 'async';
  art.src = new URL('assets/kingdom-backbox.webp', import.meta.url).href;

  const sparks = Array.from({ length: mobile ? 28 : 54 }, (_, i) => ({
    x: (i * 197.3) % W,
    y: (i * 83.7) % (H - 118),
    size: 1 + (i % 4) * .75,
    speed: 7 + (i % 9) * 2.3,
    phase: i * .83,
    color: i % 5 === 0 ? '#5bd6ff' : i % 3 === 0 ? '#ff5670' : '#ffd267'
  }));

  let last = performance.now();
  let t = 0;
  let shownScore = 0;
  let scorePulse = 0;
  let modePulse = 0;
  let lastPaint = 0;
  let visible = true;
  new IntersectionObserver(entries => { visible = entries[0]?.isIntersecting ?? true; }, { rootMargin: '80px' }).observe(canvas);

  const fmt = value => Math.max(0, value | 0).toString().padStart(6, '0').replace(/(\d)(?=(\d{3})+$)/g, '$1 ');

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
  }

  function drawCoin(x, y, radius, spin, alpha = 1) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(Math.max(.12, Math.abs(Math.cos(spin))), 1);
    ctx.globalAlpha = alpha;
    const g = ctx.createRadialGradient(-radius * .3, -radius * .4, 1, 0, 0, radius);
    g.addColorStop(0, '#fff7b7'); g.addColorStop(.2, '#ffd455'); g.addColorStop(.65, '#c87910'); g.addColorStop(1, '#59310a');
    ctx.fillStyle = g; ctx.strokeStyle = '#ffe98d'; ctx.lineWidth = 3;
    ctx.shadowColor = '#ffad24'; ctx.shadowBlur = 16;
    ctx.beginPath(); ctx.arc(0, 0, radius, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.shadowBlur = 0; ctx.strokeStyle = 'rgba(88,41,4,.72)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(0, 0, radius * .62, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#7d470c'; ctx.fillRect(-2, -radius * .42, 4, radius * .84);
    ctx.restore();
  }

  function draw(now) {
    if (!visible || (mobile && now - lastPaint < 32)) { if (!visible) last = now; requestAnimationFrame(draw); return; }
    lastPaint = now;
    const dt = Math.min(.05, (now - last) / 1000 || 0); last = now; t += dt;
    const s = window.__pinballState || {};
    const score = s.score || 0;
    if (score !== shownScore) { shownScore = score; scorePulse = 1; modePulse = 1; }
    scorePulse = Math.max(0, scorePulse - dt * 2.4);
    modePulse = Math.max(0, modePulse - dt * 1.25);

    ctx.fillStyle = '#05070b'; ctx.fillRect(0, 0, W, H);
    if (art.complete && art.naturalWidth) {
      const zoom = 1.025 + Math.sin(t * .19) * .008;
      const dw = W * zoom, dh = H * zoom;
      const dx = (W - dw) * .5 + Math.sin(t * .12) * 11;
      const dy = (H - dh) * .5 + Math.cos(t * .16) * 4;
      ctx.drawImage(art, dx, dy, dw, dh);
    } else {
      const g = ctx.createLinearGradient(0, 0, W, H);
      g.addColorStop(0, '#112238'); g.addColorStop(.5, '#61311b'); g.addColorStop(1, '#150a12');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    }

    const shade = ctx.createLinearGradient(0, 0, 0, H);
    shade.addColorStop(0, 'rgba(1,4,9,.14)');
    shade.addColorStop(.5, 'rgba(1,3,7,.02)');
    shade.addColorStop(.77, 'rgba(1,3,7,.3)');
    shade.addColorStop(1, 'rgba(1,3,7,.94)');
    ctx.fillStyle = shade; ctx.fillRect(0, 0, W, H);

    const sideShade = ctx.createRadialGradient(W * .5, H * .38, 140, W * .5, H * .42, 760);
    sideShade.addColorStop(.35, 'rgba(0,0,0,0)'); sideShade.addColorStop(1, 'rgba(0,0,0,.48)');
    ctx.fillStyle = sideShade; ctx.fillRect(0, 0, W, H);

    ctx.save(); ctx.globalCompositeOperation = 'screen';
    for (const p of sparks) {
      const y = (p.y - t * p.speed + H) % (H - 120);
      const a = .14 + Math.max(0, Math.sin(t * 1.3 + p.phase)) * .45;
      ctx.globalAlpha = a; ctx.fillStyle = p.color; ctx.shadowColor = p.color; ctx.shadowBlur = p.size * 5;
      ctx.fillRect(p.x + Math.sin(t * .6 + p.phase) * 14, y, p.size, p.size * 2.6);
    }
    ctx.restore();

    drawCoin(114 + Math.sin(t * .7) * 7, 174 + Math.cos(t * .5) * 5, 23, t * 2.4);
    drawCoin(1132 + Math.cos(t * .63) * 9, 226 + Math.sin(t * .44) * 7, 18, t * -2.1 + 1.2, .9);

    ctx.save();
    ctx.translate(640, 83 + Math.sin(t * .9) * 1.8);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '900 italic 78px Manrope, sans-serif';
    ctx.lineJoin = 'round'; ctx.lineWidth = 13; ctx.strokeStyle = 'rgba(32,8,10,.9)';
    ctx.strokeText('MARIO  PINBALL', 0, 0);
    ctx.lineWidth = 6; ctx.strokeStyle = '#fff1bc'; ctx.strokeText('MARIO  PINBALL', 0, 0);
    const title = ctx.createLinearGradient(-400, 0, 400, 0);
    title.addColorStop(0, '#e42e3b'); title.addColorStop(.48, '#ff4a37'); title.addColorStop(.5, '#ffd039'); title.addColorStop(1, '#f2a91f');
    ctx.fillStyle = title; ctx.shadowColor = 'rgba(255,121,34,.45)'; ctx.shadowBlur = 18; ctx.fillText('MARIO  PINBALL', 0, 0);
    ctx.shadowBlur = 0; ctx.font = '800 15px DM Mono, monospace'; ctx.letterSpacing = '6px'; ctx.fillStyle = 'rgba(255,255,255,.83)';
    ctx.fillText('KINGDOM CASTLE SIEGE', 0, 58);
    ctx.restore();

    const drive = Number(s.drive || 0);
    const mode = !s.started ? 'INSERT COIN' : drive > 0 ? 'STAR POWER MULTIBALL' : s.paused ? 'SYSTEM PAUSED' : s.charge > 0 ? `PLUNGER POWER ${Math.round(s.charge * 100)}%` : (s.launched ? 'CASTLE SIEGE' : 'PLUNGER READY');
    const accent = drive > 0 ? '#ffe051' : s.started ? '#65d9ff' : '#ffbf3a';

    ctx.save();
    const panelY = 554;
    ctx.fillStyle = 'rgba(2,5,9,.88)'; roundRect(42, panelY, W - 84, 128, 11); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.16)'; ctx.lineWidth = 2; roundRect(42, panelY, W - 84, 128, 11); ctx.stroke();
    ctx.fillStyle = accent; ctx.shadowColor = accent; ctx.shadowBlur = 12 + modePulse * 18;
    ctx.fillRect(42, panelY, 7, 128); ctx.shadowBlur = 0;

    ctx.font = '700 14px DM Mono, monospace'; ctx.fillStyle = 'rgba(196,205,220,.65)'; ctx.letterSpacing = '4px';
    ctx.fillText('PLAYER 1', 76, panelY + 31);
    ctx.font = '900 35px Manrope, sans-serif'; ctx.fillStyle = '#f4f4ef'; ctx.letterSpacing = '1px';
    ctx.fillText(mode, 76, panelY + 73);
    ctx.font = '600 12px DM Mono, monospace'; ctx.fillStyle = accent; ctx.letterSpacing = '3px';
    ctx.fillText(drive > 0 ? `${drive.toFixed(1)} SEC  /  ALL SHOTS ×3` : s.ballSave > 0 ? `BALL SAVE ${s.ballSave.toFixed(1)} SEC  •  SHOOT CASTLE  •  LOCK 3 BALLS` : 'SHOOT CASTLE  •  COMPLETE M-A-R-I-O  •  LOCK 3 BALLS', 77, panelY + 104);
    if (s.charge > 0) { ctx.fillStyle = 'rgba(255,255,255,.12)'; ctx.fillRect(77, panelY + 116, 420, 4); const cg = ctx.createLinearGradient(77, 0, 497, 0); cg.addColorStop(0, '#e93a42'); cg.addColorStop(.55, '#ffc43c'); cg.addColorStop(1, '#fff1a0'); ctx.fillStyle = cg; ctx.shadowColor = '#ffbd38'; ctx.shadowBlur = 8; ctx.fillRect(77, panelY + 116, 420 * s.charge, 4); ctx.shadowBlur = 0; }

    ctx.textAlign = 'right'; ctx.font = `800 ${44 + scorePulse * 5}px DM Mono, monospace`;
    ctx.fillStyle = '#ffd35a'; ctx.shadowColor = '#e89119'; ctx.shadowBlur = 10 + scorePulse * 20;
    ctx.fillText(fmt(score), 1185, panelY + 69);
    ctx.shadowBlur = 0; ctx.font = '700 12px DM Mono, monospace'; ctx.fillStyle = 'rgba(201,211,226,.65)';
    ctx.fillText(`BALL ${Math.max(0, s.lives ?? 3)}   •   X${String(drive > 0 ? (s.combo || 1) * 3 : s.combo || 1).padStart(2, '0')}`, 1183, panelY + 101);
    ctx.restore();

    if (drive > 0) {
      ctx.save(); ctx.globalCompositeOperation = 'screen';
      const ring = 120 + Math.sin(t * 5) * 8;
      ctx.strokeStyle = `hsla(${(t * 80) % 360},95%,67%,.7)`; ctx.lineWidth = 8; ctx.shadowColor = '#ffe24f'; ctx.shadowBlur = 22;
      ctx.beginPath(); ctx.arc(640, 337, ring, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }

    requestAnimationFrame(draw);
  }
  requestAnimationFrame(draw);
}
