const canvas = document.querySelector('#game');
const ctx = canvas.getContext('2d', { alpha: false });
const W = 800, H = 1200;
const playfieldArt = new Image();
playfieldArt.decoding = 'async';
playfieldArt.src = new URL('assets/kingdom-playfield.webp', import.meta.url).href;

const ui = {
  intro: document.querySelector('#intro'), pause: document.querySelector('#pauseLayer'), gameover: document.querySelector('#gameOverLayer'),
  start: document.querySelector('#startBtn'), resume: document.querySelector('#resumeBtn'), restart: document.querySelector('#restartBtn'),
  pauseBtn: document.querySelector('#pauseBtn'), sound: document.querySelector('#soundBtn'), fullscreen: document.querySelector('#fullscreenBtn'), wasm: document.querySelector('#wasmStatus'),
  wake: document.querySelector('#wakeStatus'), backScore: document.querySelector('#backScore'), backBalls: document.querySelector('#backBalls'),
  score: document.querySelector('#scoreValue'), high: document.querySelector('#highScore'), lives: document.querySelector('#livesValue'),
  combo: document.querySelector('#comboValue'), energy: document.querySelector('#energyValue'), fill: document.querySelector('#energyFill'),
  driveHint: document.querySelector('#driveHint'), targets: document.querySelector('#targetProgress'), final: document.querySelector('#finalScore'),
  missionBumpers: document.querySelector('#missionBumpers'), missionTargets: document.querySelector('#missionTargets'), missionDrive: document.querySelector('#missionDrive')
};
const touchLaunchButton = document.querySelector('#touchLaunch');
const touchControls = document.querySelector('.touch-controls');
const landscapeLayout = matchMedia('(orientation: landscape) and (max-height: 650px) and (max-width: 950px)');
const phoneLayout = matchMedia('(max-width: 850px), (orientation: landscape) and (max-height: 650px) and (max-width: 950px)');
let viewportSyncFrame = 0;

function syncMobileViewport() {
  viewportSyncFrame = 0;
  const root = document.documentElement;
  const landscape = landscapeLayout.matches;
  root.classList.toggle('landscape-playfield', landscape);
  if (!phoneLayout.matches) {
    ['--browser-ui-bottom','--mobile-control-size','--mobile-playfield-width','--visual-viewport-height','--landscape-field-short','--landscape-field-center','--landscape-side-control'].forEach(name=>root.style.removeProperty(name));
    return;
  }
  const vv = window.visualViewport;
  const visibleWidth = vv?.width || innerWidth;
  const visibleHeight = vv?.height || innerHeight;
  const offsetTop = vv?.offsetTop || 0;
  const layoutHeight = Math.max(document.documentElement.clientHeight, innerHeight);
  const layoutGap = Math.max(0, layoutHeight - visibleHeight - offsetTop);
  const screenExtent = landscape ? Math.min(screen.width || visibleWidth, screen.height || visibleHeight) : (screen.height || layoutHeight);
  const screenGap = Math.max(0, screenExtent - visibleHeight - offsetTop);
  const inferredBrowserBar = document.fullscreenElement ? 0 : (layoutGap > 1 ? layoutGap : Math.min(96, screenGap));
  const controlSize = Math.round(Math.max(58, Math.min(72, Math.min(visibleWidth * .19, visibleHeight * .105))));
  root.style.setProperty('--browser-ui-bottom', `${Math.round(inferredBrowserBar)}px`);
  root.style.setProperty('--mobile-control-size', `${controlSize}px`);
  root.style.setProperty('--visual-viewport-height', `${Math.round(visibleHeight)}px`);

  // Leave a real, measured corridor above the browser chrome for the controls.
  // On browsers that overlay their URL bar, visualViewport alone can still report
  // a taller CSS viewport, so the inferred bar has to participate in the scale.
  // Reading the resolved bottom also includes the device safe-area inset.
  const bottomProbe = landscape ? touchLaunchButton : touchControls;
  const resolvedControlBottom = parseFloat(getComputedStyle(bottomProbe).bottom) || inferredBrowserBar + 8;
  const widthLimit = Math.max(180, visibleWidth - 28);
  const heightLimit = Math.max(160, (visibleHeight - resolvedControlBottom - controlSize - 20) * 2 / 3);
  const playfieldWidth = Math.min(widthLimit, heightLimit);
  root.style.setProperty('--mobile-playfield-width', `${Math.round(playfieldWidth)}px`);
  if (landscape) {
    const sideBand = Math.max(82, Math.min(122, visibleWidth * .145));
    const effectiveHeight = Math.max(190, visibleHeight - inferredBrowserBar - 16);
    const effectiveWidth = Math.max(300, visibleWidth - sideBand * 2 - 16);
    const shortEdge = Math.max(180, Math.min(effectiveHeight, effectiveWidth / 1.5));
    const centerY = offsetTop + effectiveHeight * .5 + 8;
    root.style.setProperty('--landscape-field-short', `${Math.round(shortEdge)}px`);
    root.style.setProperty('--landscape-field-center', `${Math.round(centerY)}px`);
    root.style.setProperty('--landscape-side-control', `${Math.round(sideBand - 16)}px`);
  }
}

function scheduleViewportSync() {
  if (!viewportSyncFrame) viewportSyncFrame = requestAnimationFrame(syncMobileViewport);
}

syncMobileViewport();
window.addEventListener('resize', scheduleViewportSync, {passive:true});
window.addEventListener('orientationchange', scheduleViewportSync, {passive:true});
window.addEventListener('scroll', scheduleViewportSync, {passive:true});
window.visualViewport?.addEventListener('resize', scheduleViewportSync, {passive:true});
window.visualViewport?.addEventListener('scroll', scheduleViewportSync, {passive:true});
document.addEventListener('fullscreenchange', scheduleViewportSync);
landscapeLayout.addEventListener?.('change', scheduleViewportSync);

let wasm;
let started = false;
let paused = true;
let muted = false;
let finishedShown = false;
let lastTime = performance.now();
let lastCanvasDraw = 0;
let elapsed = 0;
let screenShake = 0;
let flash = 0;
let launchHeld = false;
let launchStart = 0;
let charge = 0;
let wakeLock = null;
let wakeRetry = 0;
let noSleepVideo = null;
const keys = { left: false, right: false };
const particles = [];
const rings = [];
const labels = [];
const trail = [];
let highScore = Number(localStorage.getItem('prismShiftHigh') || 0);
ui.high.textContent = formatScore(highScore);

const stars = Array.from({ length: 90 }, (_, i) => ({
  x: (Math.sin(i * 983.1) * .5 + .5) * W,
  y: (Math.sin(i * 317.7 + 2) * .5 + .5) * H,
  s: .4 + (i % 4) * .28,
  a: .08 + (i % 7) * .025
}));

class Synth {
  constructor() { this.ac = null; }
  init() {
    if (!this.ac) this.ac = new (window.AudioContext || window.webkitAudioContext)();
    if (this.ac.state === 'suspended') this.ac.resume();
  }
  tone(freq = 440, duration = .08, type = 'sine', volume = .035, slide = 0) {
    if (muted) return;
    this.init();
    const t = this.ac.currentTime, o = this.ac.createOscillator(), g = this.ac.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + duration);
    g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(volume, t + .008); g.gain.exponentialRampToValueAtTime(.0001, t + duration);
    o.connect(g).connect(this.ac.destination); o.start(t); o.stop(t + duration + .02);
  }
  impact(power = 1) { this.tone(170 + Math.random() * 80, .1, 'sine', .045 * power, 500); this.tone(850, .045, 'triangle', .018 * power, -350); }
  flip() { this.tone(92, .045, 'square', .018, 60); }
  launch() { this.tone(95, .36, 'sawtooth', .025, 900); this.tone(420, .45, 'sine', .02, 700); }
  target() { this.tone(620, .09, 'triangle', .035, 320); }
  drive() { [0, .11, .22, .33].forEach((d, i) => setTimeout(() => this.tone(260 * (1 + i * .4), .28, 'sawtooth', .025, 280), d * 1000)); }
  drain() { this.tone(230, .55, 'sawtooth', .025, -180); }
}
const synth = new Synth();

async function startNoSleepFallback() {
  if (!noSleepVideo) {
    noSleepVideo = document.createElement('video');
    const wakeAsset = noSleepVideo.canPlayType('video/webm; codecs="vp8"') ? 'assets/wake.webm?v=1' : 'assets/wake.mp4?v=1';
    noSleepVideo.src = new URL(wakeAsset, import.meta.url).href;
    noSleepVideo.loop = true; noSleepVideo.muted = true; noSleepVideo.playsInline = true;
    noSleepVideo.setAttribute('playsinline',''); noSleepVideo.setAttribute('webkit-playsinline','');
    noSleepVideo.style.cssText = 'position:fixed;width:1px;height:1px;opacity:.001;pointer-events:none;left:-2px;bottom:0';
    document.body.appendChild(noSleepVideo);
  }
  try { if (noSleepVideo.paused) await noSleepVideo.play(); } catch (_) {}
}

async function requestWakeLock() {
  startNoSleepFallback();
  if (!('wakeLock' in navigator)) {
    ui.wake.textContent = 'NO-SLEEP ACTIVE';
    ui.wake.classList.add('locked');
    return;
  }
  try {
    if (!wakeLock || wakeLock.released) {
      wakeLock = await navigator.wakeLock.request('screen');
      ui.wake.textContent = 'SCREEN LOCKED';
      ui.wake.classList.add('locked');
      wakeLock.addEventListener('release', () => {
        ui.wake.textContent = 'SCREEN READY';
        ui.wake.classList.remove('locked');
        clearTimeout(wakeRetry);
        if (!document.hidden && started && !paused) wakeRetry = setTimeout(requestWakeLock, 350);
      });
    }
  } catch (_) {
    ui.wake.textContent = 'NO-SLEEP ACTIVE';
    ui.wake.classList.add('locked');
  }
}

async function loadWasm() {
  const url = new URL('game.wasm?v=5.3', import.meta.url);
  let instance;
  try {
    if (WebAssembly.instantiateStreaming) {
      ({ instance } = await WebAssembly.instantiateStreaming(fetch(url), {}));
    } else throw new Error('streaming unavailable');
  } catch (_) {
    const bytes = await (await fetch(url)).arrayBuffer();
    ({ instance } = await WebAssembly.instantiate(bytes, {}));
  }
  wasm = instance.exports;
  wasm.game_init((Date.now() ^ (Math.random() * 0xffffffff)) >>> 0);
  ui.wasm.textContent = 'WASM CORE ONLINE';
  document.querySelector('.live-dot').classList.add('ready');
}

function formatScore(v) { return Math.max(0, v | 0).toString().padStart(6, '0').replace(/(\d)(?=(\d{3})+$)/g, '$1 '); }
function rgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
}

function glowLine(points, color, width = 4, glow = 16, close = false) {
  ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1]);
  if (close) ctx.closePath();
  ctx.strokeStyle = color; ctx.lineWidth = width; ctx.shadowColor = color; ctx.shadowBlur = glow; ctx.stroke();
  ctx.restore();
}

function radial(x, y, r, color, alpha = 1) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, rgba(color, .42 * alpha)); g.addColorStop(.22, rgba(color, .15 * alpha)); g.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
}

function drawBackdrop(drive) {
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#080a19'); bg.addColorStop(.48, drive > 0 ? '#140728' : '#070b1c'); bg.addColorStop(1, '#050812');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  radial(175, 260, 330, '#5a41ff', .5); radial(650, 530, 330, '#00eaff', .3); radial(360, 930, 380, '#ff39c7', .25);

  ctx.fillStyle = '#b7dfff';
  for (const s of stars) {
    const pulse = .65 + .35 * Math.sin(elapsed * (1 + s.s * .2) + s.x);
    ctx.globalAlpha = s.a * pulse; ctx.fillRect(s.x, s.y, s.s, s.s);
  }
  ctx.globalAlpha = 1;

  ctx.save(); ctx.strokeStyle = 'rgba(111,247,255,.035)'; ctx.lineWidth = 1;
  for (let x = -200; x < 1000; x += 60) { ctx.beginPath(); ctx.moveTo(400, 450); ctx.lineTo(x, 1200); ctx.stroke(); }
  for (let y = 580; y < 1200; y += 60) { ctx.beginPath(); ctx.moveTo(50, y); ctx.lineTo(750, y); ctx.stroke(); }
  ctx.restore();

  // Rotating quantum aperture.
  ctx.save(); ctx.translate(400, 465); ctx.rotate(elapsed * .08);
  for (let i = 0; i < 3; i++) {
    ctx.beginPath(); ctx.arc(0, 0, 205 + i * 23, i * 1.8, i * 1.8 + 3.6);
    ctx.strokeStyle = i === 1 ? 'rgba(111,247,255,.08)' : 'rgba(166,107,255,.08)'; ctx.lineWidth = 1.5; ctx.stroke();
  }
  ctx.restore();

  ctx.fillStyle = 'rgba(196,212,255,.42)'; ctx.font = '500 10px "DM Mono", monospace'; ctx.letterSpacing = '2px';
  ctx.fillText('PRISM DYNAMICS', 82, 155); ctx.fillStyle = 'rgba(111,247,255,.55)'; ctx.fillText('SECTOR / 07', 610, 155);
  ctx.fillStyle = 'rgba(124,139,178,.25)'; ctx.font = '500 8px "DM Mono", monospace';
  ctx.fillText('QUANTUM MAGNETIC PROPULSION ARRAY', 270, 1145);
}

function drawCabinet(drive) {
  const color = drive > 0 ? '#ff4fd8' : '#738cff';
  ctx.save();
  ctx.beginPath(); ctx.moveTo(55, 965); ctx.lineTo(55, 205); ctx.quadraticCurveTo(66, 89, 250, 47); ctx.lineTo(550, 47); ctx.quadraticCurveTo(734, 89, 745, 205); ctx.lineTo(745, 980); ctx.lineTo(528, 1140); ctx.moveTo(272, 1140); ctx.lineTo(55, 965);
  ctx.strokeStyle = rgba(color, .25); ctx.lineWidth = 18; ctx.shadowColor = color; ctx.shadowBlur = 26; ctx.stroke();
  ctx.strokeStyle = 'rgba(196,217,255,.5)'; ctx.lineWidth = 2; ctx.shadowBlur = 8; ctx.stroke();
  ctx.restore();

  glowLine([[664, 310], [664, 968]], '#6ff7ff', 3, 12);
  glowLine([[675, 286], [701, 247], [732, 224]], '#6ff7ff', 2, 10);
  ctx.save(); ctx.fillStyle = 'rgba(111,247,255,.34)'; ctx.font = '500 8px "DM Mono",monospace'; ctx.translate(704, 720); ctx.rotate(-Math.PI / 2); ctx.fillText('PHOTON LAUNCH TUBE', 0, 0); ctx.restore();

  // PCB accents.
  ctx.strokeStyle = 'rgba(112,132,200,.12)'; ctx.lineWidth = 1;
  [[90,720,150,720,150,680],[650,700,610,700,610,655],[105,390,150,390,150,350],[623,400,650,400,650,360]].forEach(p => {
    ctx.beginPath(); ctx.moveTo(p[0],p[1]); ctx.lineTo(p[2],p[3]); ctx.lineTo(p[4],p[5]); ctx.stroke();
  });
}

function drawHardwareDetails(drive) {
  // Precision-cut guide rails.
  ctx.save();
  const metal = ctx.createLinearGradient(0, 0, 18, 18);
  metal.addColorStop(0, '#313b5d'); metal.addColorStop(.28, '#d4efff'); metal.addColorStop(.48, '#536181'); metal.addColorStop(.7, '#f5fbff'); metal.addColorStop(1, '#232b48');
  ctx.strokeStyle = metal; ctx.lineWidth = 5; ctx.lineCap = 'round'; ctx.shadowColor = 'rgba(153,220,255,.55)'; ctx.shadowBlur = 7;
  ctx.beginPath(); ctx.moveTo(91, 677); ctx.bezierCurveTo(72, 555, 91, 380, 155, 250); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(632, 730); ctx.bezierCurveTo(661, 640, 660, 595, 647, 565); ctx.stroke();
  ctx.restore();

  // Illuminated roll-over lanes in the upper crown.
  for (let i = 0; i < 4; i++) {
    const x = 317 + i * 55, color = i % 2 ? '#6ff7ff' : '#a66bff';
    ctx.save(); ctx.translate(x, 113);
    ctx.beginPath(); ctx.roundRect(-19, -8, 38, 16, 8);
    ctx.fillStyle = rgba(color, .08); ctx.strokeStyle = rgba(color, .36); ctx.lineWidth = 1.5; ctx.fill(); ctx.stroke();
    ctx.fillStyle = 'rgba(225,235,255,.42)'; ctx.font = '500 7px "DM Mono",monospace'; ctx.textAlign = 'center'; ctx.fillText(String.fromCharCode(80 + i), 0, 3); ctx.restore();
  }

  // Jewel inserts and multiplier ladder.
  const jewels = [[325,735],[375,716],[425,716],[475,735]];
  jewels.forEach(([x,y],i) => {
    const color = i < 2 ? '#ff4fd8' : '#6ff7ff';
    ctx.save(); ctx.translate(x,y); ctx.rotate(Math.PI/4);
    ctx.fillStyle = rgba(color, drive > 0 ? .8 : .15 + i*.06); ctx.strokeStyle = rgba(color,.62); ctx.lineWidth = 2;
    ctx.shadowColor = color; ctx.shadowBlur = drive > 0 ? 18 : 7; ctx.fillRect(-9,-9,18,18); ctx.strokeRect(-9,-9,18,18); ctx.restore();
  });
  ctx.fillStyle = 'rgba(111,247,255,.35)'; ctx.font = '500 7px "DM Mono",monospace'; ctx.textAlign='center'; ctx.fillText('PRISM MATRIX  /  2X  4X  8X',400,770);

  // Fasteners, service markings and etched serials.
  const bolts = [[76,235],[724,235],[76,755],[724,755],[112,949],[688,949]];
  bolts.forEach(([x,y],i) => {
    const g=ctx.createRadialGradient(x-2,y-2,0,x,y,6);g.addColorStop(0,'#f1f5ff');g.addColorStop(.28,'#7b87a3');g.addColorStop(.62,'#242c42');g.addColorStop(1,'#050811');
    ctx.beginPath();ctx.arc(x,y,5,0,Math.PI*2);ctx.fillStyle=g;ctx.fill();ctx.strokeStyle='rgba(180,198,230,.28)';ctx.lineWidth=1;ctx.stroke();
    ctx.beginPath();ctx.moveTo(x-2.5,y+(i%2?1:-1));ctx.lineTo(x+2.5,y+(i%2?-1:1));ctx.strokeStyle='rgba(4,7,13,.85)';ctx.stroke();
  });
  ctx.textAlign='left';ctx.fillStyle='rgba(109,122,157,.24)';ctx.font='500 6px "DM Mono",monospace';
  ctx.fillText('CAL. 07-881 / MAG-RAIL',86,741);ctx.fillText('DANGER: HIGH FLUX',565,741);

  // Directional inlays near the flippers.
  [[216,988,1,'#ff4fd8'],[584,988,-1,'#6ff7ff']].forEach(([x,y,dir,color])=>{
    ctx.save();ctx.translate(x,y);ctx.scale(dir,1);ctx.beginPath();ctx.moveTo(-13,-7);ctx.lineTo(13,0);ctx.lineTo(-13,7);ctx.closePath();ctx.fillStyle=rgba(color,.22);ctx.strokeStyle=rgba(color,.7);ctx.shadowColor=color;ctx.shadowBlur=8;ctx.fill();ctx.stroke();ctx.restore();
  });
}

function drawBumper(x, y, r, color, index) {
  const pulse = .84 + .16 * Math.sin(elapsed * 3.2 + index * 1.4);
  radial(x, y, r * 2.2, color, pulse);
  ctx.save(); ctx.translate(x, y);
  ctx.beginPath(); ctx.arc(0,0,r+10,0,Math.PI*2); ctx.fillStyle = 'rgba(4,7,17,.76)'; ctx.fill();
  ctx.strokeStyle = rgba(color,.2); ctx.lineWidth = 12; ctx.shadowColor = color; ctx.shadowBlur = 22; ctx.stroke();
  const g = ctx.createRadialGradient(-r*.24,-r*.32,2,0,0,r);
  g.addColorStop(0,'#ffffff'); g.addColorStop(.13,rgba(color,.98)); g.addColorStop(.44,rgba(color,.28)); g.addColorStop(.72,'#101426'); g.addColorStop(1,'#050711');
  ctx.beginPath(); ctx.arc(0,0,r,0,Math.PI*2); ctx.fillStyle=g; ctx.fill();
  ctx.strokeStyle=rgba(color,.9); ctx.lineWidth=2; ctx.shadowColor=color; ctx.shadowBlur=12; ctx.stroke();
  ctx.rotate(elapsed * .28 * (index % 2 ? -1 : 1));
  ctx.beginPath(); ctx.arc(0,0,r*.63,.2,2.7); ctx.strokeStyle='rgba(255,255,255,.5)'; ctx.lineWidth=2; ctx.stroke();
  ctx.rotate(-elapsed * .28 * (index % 2 ? -1 : 1));
  ctx.fillStyle='rgba(255,255,255,.84)'; ctx.font=`600 ${r*.3}px Manrope`; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText(index === 2 ? 'CORE' : 'SYNC',0,1);
  ctx.restore();
}

function drawTargets(mask) {
  const positions = [[176,603],[211,579],[246,555],[554,555],[589,579],[624,603]];
  positions.forEach(([x,y],i) => {
    const lit = mask & (1<<i), color = i < 3 ? '#a66bff' : '#6ff7ff';
    ctx.save(); ctx.translate(x,y); ctx.rotate(i < 3 ? -.38 : .38);
    if (lit) { ctx.shadowColor=color; ctx.shadowBlur=18; }
    ctx.fillStyle=lit ? rgba(color,.9) : 'rgba(25,31,56,.9)'; ctx.strokeStyle=lit ? '#fff' : rgba(color,.45); ctx.lineWidth=2;
    ctx.beginPath(); ctx.roundRect(-8,-20,16,40,6); ctx.fill(); ctx.stroke();
    ctx.fillStyle=lit?'rgba(255,255,255,.8)':'rgba(255,255,255,.16)'; ctx.fillRect(-1,-12,2,24); ctx.restore();
  });
}

function drawSlings() {
  function sling(points, color) {
    ctx.save(); ctx.beginPath(); ctx.moveTo(...points[0]); points.slice(1).forEach(p=>ctx.lineTo(...p)); ctx.closePath();
    const g=ctx.createLinearGradient(points[0][0],points[0][1],points[1][0],points[1][1]); g.addColorStop(0,rgba(color,.04)); g.addColorStop(1,rgba(color,.25));
    ctx.fillStyle=g; ctx.fill(); ctx.strokeStyle=rgba(color,.8); ctx.lineWidth=3; ctx.shadowColor=color; ctx.shadowBlur=13; ctx.stroke(); ctx.restore();
  }
  sling([[88,814],[258,947],[174,900]],'#a66bff'); sling([[640,814],[542,947],[626,900]],'#6ff7ff');
  glowLine([[105,832],[248,944]],'#ff4fd8',2,9); glowLine([[625,832],[552,944]],'#6ff7ff',2,9);
}

function drawFlipper(px, py, angle, color, side) {
  ctx.save(); ctx.translate(px,py); ctx.rotate(angle);
  const g=ctx.createLinearGradient(0,-12,140,12); g.addColorStop(0,'#eafaff'); g.addColorStop(.18,color); g.addColorStop(1,rgba(color,.25));
  ctx.beginPath(); ctx.moveTo(0,-16); ctx.lineTo(126,-11); ctx.quadraticCurveTo(153,0,126,11); ctx.lineTo(0,16); ctx.arc(0,0,16,Math.PI/2,Math.PI*1.5); ctx.closePath();
  ctx.fillStyle=g; ctx.shadowColor=color; ctx.shadowBlur=22; ctx.fill(); ctx.strokeStyle='rgba(255,255,255,.7)'; ctx.lineWidth=2; ctx.stroke();
  ctx.beginPath(); ctx.arc(0,0,6,0,Math.PI*2); ctx.fillStyle='#fff'; ctx.shadowBlur=10; ctx.fill();
  ctx.fillStyle='rgba(3,6,15,.62)'; ctx.font='500 7px "DM Mono",monospace'; ctx.textAlign='center'; ctx.fillText(side,72,3); ctx.restore();
}

function drawBall(x, y, vx, vy) {
  trail.unshift({x,y}); if (trail.length > 16) trail.pop();
  ctx.save(); ctx.globalCompositeOperation='screen';
  trail.forEach((p,i)=>{ const a=(1-i/trail.length)*.22; ctx.beginPath(); ctx.arc(p.x,p.y,Math.max(1,9-i*.4),0,Math.PI*2); ctx.fillStyle=i%2?rgba('#6ff7ff',a):rgba('#ff4fd8',a); ctx.fill(); });
  ctx.restore();
  radial(x,y,58,Math.abs(vy)>900?'#ff4fd8':'#6ff7ff',.7);
  ctx.save(); const g=ctx.createRadialGradient(x-6,y-7,1,x,y,16); g.addColorStop(0,'#fff'); g.addColorStop(.22,'#d7fcff'); g.addColorStop(.52,'#7ad8ee'); g.addColorStop(.78,'#59609e'); g.addColorStop(1,'#e34fd1');
  ctx.beginPath(); ctx.arc(x,y,14,0,Math.PI*2); ctx.fillStyle=g; ctx.shadowColor='#aefaff'; ctx.shadowBlur=16; ctx.fill();
  const speed=Math.hypot(vx,vy); if(speed>700){ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x-vx/speed*28,y-vy/speed*28);ctx.strokeStyle='rgba(255,255,255,.6)';ctx.lineWidth=3;ctx.stroke();} ctx.restore();
}

function drawLauncher(power, ready) {
  ctx.save();
  ctx.fillStyle='rgba(255,255,255,.04)'; ctx.fillRect(690,970,42,155);
  const h=ready?30+power*105:18; const g=ctx.createLinearGradient(0,1120,0,990); g.addColorStop(0,'#a66bff');g.addColorStop(1,'#ff4fd8');
  ctx.fillStyle=g;ctx.shadowColor='#ff4fd8';ctx.shadowBlur=13;ctx.fillRect(699,1115-h,24,h);
  ctx.strokeStyle='rgba(255,255,255,.5)';ctx.strokeRect(699,990,24,125);
  ctx.fillStyle='rgba(255,255,255,.55)';ctx.font='500 8px "DM Mono",monospace';ctx.textAlign='center';ctx.fillText(ready?'CHARGE':'LOCK',711,1141); ctx.restore();
}

function spawnBurst(x,y,color,count=18,speed=260) {
  for(let i=0;i<count;i++){ const a=Math.random()*Math.PI*2,s=speed*(.25+Math.random()*.8); particles.push({x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s,life:.45+Math.random()*.45,max:.9,size:1+Math.random()*4,color}); }
}
function spawnRing(x,y,color,size=10){rings.push({x,y,r:size,life:.65,max:.65,color});}
function addLabel(x,y,text,color='#fff',big=false){labels.push({x,y,text,color,life:1,max:1,big});}
function updateFx(dt){
  for(let i=particles.length-1;i>=0;i--){const p=particles[i];p.life-=dt;p.x+=p.vx*dt;p.y+=p.vy*dt;p.vx*=.97;p.vy*=.97;p.vy+=80*dt;if(p.life<=0)particles.splice(i,1);}
  for(let i=rings.length-1;i>=0;i--){const r=rings[i];r.life-=dt;r.r+=220*dt;if(r.life<=0)rings.splice(i,1);}
  for(let i=labels.length-1;i>=0;i--){const l=labels[i];l.life-=dt;l.y-=42*dt;if(l.life<=0)labels.splice(i,1);}
  screenShake=Math.max(0,screenShake-dt*22); flash=Math.max(0,flash-dt*2.8);
}
function drawFx(){
  ctx.save();ctx.globalCompositeOperation='screen';
  for(const r of rings){ctx.beginPath();ctx.arc(r.x,r.y,r.r,0,Math.PI*2);ctx.strokeStyle=rgba(r.color,r.life/r.max*.65);ctx.lineWidth=2+4*r.life/r.max;ctx.shadowColor=r.color;ctx.shadowBlur=16;ctx.stroke();}
  for(const p of particles){ctx.globalAlpha=Math.max(0,p.life/p.max);ctx.fillStyle=p.color;ctx.shadowColor=p.color;ctx.shadowBlur=8;ctx.fillRect(p.x-p.size/2,p.y-p.size/2,p.size,p.size);}
  ctx.restore();ctx.globalAlpha=1;
  for(const l of labels){ctx.save();ctx.globalAlpha=Math.min(1,l.life*2);ctx.fillStyle=l.color;ctx.shadowColor=l.color;ctx.shadowBlur=12;ctx.font=`700 ${l.big?28:15}px "DM Mono",monospace`;ctx.textAlign='center';ctx.fillText(l.text,l.x,l.y);ctx.restore();}
}

function drawCloud(x,y,s=1){
  ctx.save();ctx.translate(x,y);ctx.scale(s,s);ctx.fillStyle='rgba(255,255,255,.78)';ctx.strokeStyle='rgba(30,101,174,.24)';ctx.lineWidth=2;
  ctx.beginPath();ctx.arc(-28,8,19,Math.PI,0);ctx.arc(0,0,30,Math.PI,0);ctx.arc(32,10,18,Math.PI,0);ctx.lineTo(49,25);ctx.lineTo(-47,25);ctx.closePath();ctx.fill();ctx.stroke();ctx.restore();
}

function drawMarioBackdrop(drive){
  if(playfieldArt.complete&&playfieldArt.naturalWidth){ctx.drawImage(playfieldArt,0,0,W,H);}
  else {const sky=ctx.createLinearGradient(0,0,0,H);sky.addColorStop(0,'#16344b');sky.addColorStop(.45,'#256b76');sky.addColorStop(1,'#17130f');ctx.fillStyle=sky;ctx.fillRect(0,0,W,H);}
  // Printed-glass depth treatment. The generated collector art remains readable without the old flat cartoon backdrop.
  const vignette=ctx.createRadialGradient(400,570,180,400,580,710);vignette.addColorStop(.35,'rgba(2,4,7,0)');vignette.addColorStop(1,'rgba(2,4,7,.48)');ctx.fillStyle=vignette;ctx.fillRect(0,0,W,H);
  if(drive>0){ctx.save();ctx.globalCompositeOperation='screen';const g=ctx.createLinearGradient(0,0,W,H);g.addColorStop(0,'rgba(239,51,64,.12)');g.addColorStop(.5,'rgba(255,216,61,.11)');g.addColorStop(1,'rgba(43,140,255,.13)');ctx.fillStyle=g;ctx.fillRect(0,0,W,H);ctx.restore();}
}

function drawMarioCabinet(drive){
  ctx.save();ctx.beginPath();ctx.moveTo(55,965);ctx.lineTo(55,205);ctx.quadraticCurveTo(66,89,250,47);ctx.lineTo(550,47);ctx.quadraticCurveTo(734,89,745,205);ctx.lineTo(745,980);ctx.lineTo(528,1140);ctx.moveTo(272,1140);ctx.lineTo(55,965);
  ctx.strokeStyle=drive>0?'#ffd83d':'#ef3340';ctx.lineWidth=20;ctx.shadowColor=drive>0?'#ffd83d':'#ef3340';ctx.shadowBlur=22;ctx.stroke();ctx.strokeStyle='#fff4b0';ctx.lineWidth=3;ctx.shadowBlur=0;ctx.stroke();ctx.restore();
  // Green pipe shooter lane.
  ctx.save();ctx.strokeStyle='#14552b';ctx.lineWidth=13;ctx.strokeRect(657,307,16,664);ctx.strokeStyle='#53e26e';ctx.lineWidth=6;ctx.strokeRect(658,307,14,664);ctx.fillStyle='#3fce5c';ctx.strokeStyle='#0f5e29';ctx.lineWidth=3;ctx.fillRect(646,292,39,25);ctx.strokeRect(646,292,39,25);ctx.restore();
  ctx.save();ctx.fillStyle='#fff';ctx.font='800 8px "DM Mono",monospace';ctx.translate(690,730);ctx.rotate(-Math.PI/2);ctx.fillText('SUPER LAUNCH PIPE',0,0);ctx.restore();
}

function starPath(x,y,r,inner=.46){ctx.beginPath();for(let i=0;i<10;i++){const a=-Math.PI/2+i*Math.PI/5,rr=i%2?r:r*inner;const px=x+Math.cos(a)*rr,py=y+Math.sin(a)*rr;i?ctx.lineTo(px,py):ctx.moveTo(px,py);}ctx.closePath();}

function drawMarioBumper(x,y,r,index){
  const palette=['#ef3340','#58df66','#ffd83d','#f0b52e','#f0b52e'],color=palette[index];radial(x,y,r*2.25,color,.52);
  ctx.save();ctx.translate(x,y);ctx.beginPath();ctx.arc(0,0,r+10,0,Math.PI*2);ctx.fillStyle='#132746';ctx.fill();ctx.strokeStyle='#fff';ctx.lineWidth=3;ctx.shadowColor=color;ctx.shadowBlur=18;ctx.stroke();
  if(index===2){starPath(0,0,r*.78);ctx.fillStyle='#ffd83d';ctx.strokeStyle='#fff4a8';ctx.lineWidth=3;ctx.fill();ctx.stroke();ctx.fillStyle='#513514';ctx.fillRect(-13,-7,4,10);ctx.fillRect(9,-7,4,10);}
  else if(index<2){ctx.fillStyle=color;ctx.beginPath();ctx.arc(0,-5,r*.72,Math.PI,0);ctx.quadraticCurveTo(r*.72,r*.35,0,r*.38);ctx.quadraticCurveTo(-r*.72,r*.35,-r*.72,-5);ctx.fill();ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.stroke();ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(-r*.3,-r*.2,r*.17,0,Math.PI*2);ctx.arc(r*.32,-r*.17,r*.15,0,Math.PI*2);ctx.fill();ctx.fillStyle='#ffe0ae';ctx.beginPath();ctx.roundRect(-r*.32,r*.22,r*.64,r*.42,8);ctx.fill();ctx.fillStyle='#413024';ctx.fillRect(-r*.16,r*.34,3,6);ctx.fillRect(r*.12,r*.34,3,6);}
  else {const g=ctx.createRadialGradient(-7,-8,2,0,0,r);g.addColorStop(0,'#fffbe4');g.addColorStop(.28,'#ffd83d');g.addColorStop(1,'#d48106');ctx.beginPath();ctx.arc(0,0,r*.76,0,Math.PI*2);ctx.fillStyle=g;ctx.fill();ctx.strokeStyle='#fff1a1';ctx.lineWidth=2;ctx.stroke();ctx.fillStyle='#7c4a00';ctx.font=`900 ${r*.8}px Manrope`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('?',0,1);}
  ctx.restore();
}

function drawMarioTargets(mask){const pos=[[176,603],[211,579],[246,555],[554,555],[589,579],[624,603]];pos.forEach(([x,y],i)=>{const lit=mask&(1<<i);ctx.save();ctx.translate(x,y);ctx.rotate(i<3?-.38:.38);ctx.fillStyle=lit?'#ffd83d':'#a84c2b';ctx.strokeStyle=lit?'#fff6a5':'#5a281b';ctx.lineWidth=3;ctx.shadowColor='#ffd83d';ctx.shadowBlur=lit?14:0;ctx.fillRect(-12,-18,24,36);ctx.strokeRect(-12,-18,24,36);ctx.fillStyle=lit?'#7c4a00':'#e99a5d';ctx.font='900 17px Manrope';ctx.textAlign='center';ctx.fillText('?',0,7);ctx.restore();});}

function drawMarioSlings(){
  const pipe=(points,flip=false)=>{ctx.save();ctx.beginPath();ctx.moveTo(...points[0]);points.slice(1).forEach(p=>ctx.lineTo(...p));ctx.closePath();ctx.fillStyle='#35bd51';ctx.strokeStyle='#0c5e29';ctx.lineWidth=5;ctx.shadowColor='#58df66';ctx.shadowBlur=10;ctx.fill();ctx.stroke();ctx.fillStyle='rgba(255,255,255,.28)';ctx.beginPath();ctx.moveTo(points[0][0],points[0][1]);ctx.lineTo(points[1][0],points[1][1]);ctx.lineTo(points[2][0],points[2][1]);ctx.strokeStyle='rgba(255,255,255,.35)';ctx.lineWidth=2;ctx.stroke();ctx.restore();};
  pipe([[88,814],[258,947],[174,900]]);pipe([[640,814],[542,947],[626,900]],true);
}

function drawMarioFlipper(px,py,angle,color,label){ctx.save();ctx.translate(px,py);ctx.rotate(angle);const g=ctx.createLinearGradient(0,-12,140,12);g.addColorStop(0,'#fff');g.addColorStop(.2,color);g.addColorStop(1,color==='#ef3340'?'#8e111b':'#0a63aa');ctx.beginPath();ctx.moveTo(0,-16);ctx.lineTo(126,-11);ctx.quadraticCurveTo(153,0,126,11);ctx.lineTo(0,16);ctx.arc(0,0,16,Math.PI/2,Math.PI*1.5);ctx.closePath();ctx.fillStyle=g;ctx.shadowColor=color;ctx.shadowBlur=18;ctx.fill();ctx.strokeStyle='#fff';ctx.lineWidth=3;ctx.stroke();ctx.fillStyle='#fff';ctx.font='900 13px Manrope';ctx.textAlign='center';ctx.fillText(label,69,5);ctx.restore();}

function drawMarioBall(x,y,vx,vy){trail.unshift({x,y});if(trail.length>17)trail.pop();ctx.save();ctx.globalCompositeOperation='screen';trail.forEach((p,i)=>{const a=(1-i/trail.length)*.35;ctx.beginPath();ctx.arc(p.x,p.y,Math.max(2,11-i*.48),0,Math.PI*2);ctx.fillStyle=i%2?rgba('#ffd83d',a):rgba('#ef3340',a);ctx.fill();});ctx.restore();radial(x,y,62,'#ffb224',.85);const g=ctx.createRadialGradient(x-6,y-7,1,x,y,17);g.addColorStop(0,'#fff');g.addColorStop(.15,'#fff09a');g.addColorStop(.42,'#ffd83d');g.addColorStop(.72,'#ef592f');g.addColorStop(1,'#a91b24');ctx.beginPath();ctx.arc(x,y,14,0,Math.PI*2);ctx.fillStyle=g;ctx.shadowColor='#ffd83d';ctx.shadowBlur=18;ctx.fill();}

function drawMarioLauncher(power,ready){ctx.save();ctx.fillStyle='#124c29';ctx.fillRect(690,970,42,155);ctx.fillStyle='#32b951';ctx.fillRect(695,970,32,155);const h=ready?30+power*105:18;ctx.fillStyle='#ffd83d';ctx.shadowColor='#ffd83d';ctx.shadowBlur=12;ctx.fillRect(701,1115-h,20,h);ctx.strokeStyle='#fff2a5';ctx.lineWidth=2;ctx.strokeRect(701,990,20,125);ctx.fillStyle='#fff';ctx.font='800 8px "DM Mono",monospace';ctx.textAlign='center';ctx.fillText(ready?'POWER':'LOCK',711,1141);ctx.restore();}

function drawMarioDetails(drive){
  // Collector-style printed inserts: restrained, crisp and legible under the 3D hardware.
  const lamps=[[312,742],[356,720],[400,712],[444,720],[488,742]];
  lamps.forEach(([x,y],i)=>{ctx.save();ctx.translate(x,y);ctx.scale(.56,1);ctx.beginPath();ctx.arc(0,0,11,0,Math.PI*2);ctx.fillStyle=drive>0?'#fff2ae':'rgba(255,195,45,.54)';ctx.strokeStyle='rgba(255,233,143,.85)';ctx.lineWidth=2;ctx.shadowColor='#f6a619';ctx.shadowBlur=drive>0?14:5;ctx.fill();ctx.stroke();ctx.restore();});
  ctx.fillStyle='rgba(255,244,207,.86)';ctx.font='800 8px "DM Mono",monospace';ctx.textAlign='center';ctx.fillText('ROYAL COIN LOCK',400,777);
  ['M','A','R','I','O'].forEach((ch,i)=>{const x=290+i*55;ctx.fillStyle=i%2?'rgba(43,140,255,.8)':'rgba(239,51,64,.8)';ctx.strokeStyle='rgba(255,244,202,.86)';ctx.lineWidth=1.5;ctx.beginPath();ctx.roundRect(x-16,142,32,21,5);ctx.fill();ctx.stroke();ctx.fillStyle='#fff9e9';ctx.font='900 11px Manrope';ctx.fillText(ch,x,157);});
}

function processEvents() {
  const n=wasm.event_count();
  for(let i=0;i<n;i++){
    const kind=wasm.event_kind(i),x=wasm.event_x(i),y=wasm.event_y(i),value=wasm.event_value(i);
    if(kind!==3)window.dispatchEvent(new CustomEvent('pinball-score-flash',{detail:{kind,x,y,value,score:wasm.game_score(),combo:wasm.game_combo()}}));
    if(kind===1){spawnBurst(x,y,i%2?'#ffd83d':'#ef3340',22,320);spawnRing(x,y,'#ffd83d');addLabel(x,y-42,`COIN +${value}`,'#fff');screenShake=6;flash=.18;synth.impact();ui.missionBumpers.classList.add('flash');setTimeout(()=>ui.missionBumpers.classList.remove('flash'),220);}
    if(kind===3){spawnBurst(x,y,'#ffd83d',7,150);synth.flip();}
    if(kind===4){spawnBurst(x,y,'#ef3340',34,330);spawnRing(x,y,'#ef3340',30);screenShake=11;synth.drain();}
    if(kind===5){spawnBurst(x,y,'#58df66',15,220);addLabel(x,y-28,`+${value}`,'#ffd83d',value>1000);synth.target();ui.missionTargets.classList.add('flash');setTimeout(()=>ui.missionTargets.classList.remove('flash'),240);}
    if(kind===6){for(let j=0;j<7;j++)setTimeout(()=>spawnRing(400,575,['#ef3340','#ffd83d','#2b8cff','#58df66'][j%4],j*22),j*35);addLabel(400,650,'STAR POWER ×3','#ffd83d',true);screenShake=14;flash=.9;synth.drive();ui.missionDrive.classList.add('flash');setTimeout(()=>ui.missionDrive.classList.remove('flash'),600);}
    if(kind===7){spawnBurst(x,y,'#ffd83d',25,270);screenShake=5;synth.launch();}
    if(kind===8){spawnBurst(x,y,'#58df66',32,290);spawnRing(x,y,'#58df66',34);addLabel(400,940,'BALL SAVE · SHOOT AGAIN','#fff4a8',true);screenShake=6;flash=.35;synth.target();}
  }
}

function drawFrame() {
  if(!wasm) return;
  const x=wasm.ball_x(),y=wasm.ball_y(),height=wasm.ball_height?.()||0,vx=wasm.ball_vx(),vy=wasm.ball_vy(),drive=wasm.game_overdrive(),mask=wasm.game_target_mask();
  window.__pinballState={x,y,height,vx,vy,drive,mask,charge,leftAngle:wasm.left_angle(),rightAngle:wasm.right_angle(),launched:!!wasm.game_launched(),score:wasm.game_score(),lives:wasm.game_lives(),combo:wasm.game_combo(),energy:wasm.game_energy(),ballSave:wasm.game_ball_save(),started,paused};
  ctx.save(); if(screenShake>0) ctx.translate((Math.random()-.5)*screenShake,(Math.random()-.5)*screenShake);
  drawMarioBackdrop(drive); drawMarioDetails(drive);
  if(!window.__use3d){
    drawMarioCabinet(drive);
    drawMarioBumper(250,330,49,0);drawMarioBumper(535,315,49,1);drawMarioBumper(402,493,57,2);
    drawMarioBumper(122,530,25,3);drawMarioBumper(625,520,25,4);
    drawMarioTargets(mask);drawMarioSlings();
    drawMarioFlipper(258,1038,wasm.left_angle(),'#ef3340','M');drawMarioFlipper(542,1038,wasm.right_angle(),'#2b8cff','L');
    drawMarioLauncher(charge,!wasm.game_launched());drawMarioBall(x,y,vx,vy);
  }
  drawFx();
  if(drive>0){ctx.save();ctx.globalCompositeOperation='screen';const rainbow=['#ef3340','#ffd83d','#58df66','#2b8cff'];ctx.strokeStyle=rainbow[Math.floor(elapsed*8)%4];ctx.lineWidth=12;ctx.shadowColor='#ffd83d';ctx.shadowBlur=28;if(!window.__use3d)ctx.strokeRect(34,31,732,1135);ctx.fillStyle='#fff';ctx.font='800 12px "DM Mono",monospace';ctx.fillText(`★ STAR POWER  ${drive.toFixed(1)}s`,78,190);ctx.restore();}
  if(flash>0){ctx.fillStyle=`rgba(210,245,255,${flash*.24})`;ctx.fillRect(0,0,W,H);}
  ctx.restore();
}

let hudTimer=0;
function updateHud(dt) {
  hudTimer-=dt;if(hudTimer>0)return;hudTimer=.08;
  const score=wasm.game_score(), lives=wasm.game_lives(), combo=wasm.game_combo(), energy=wasm.game_energy(), drive=wasm.game_overdrive(),mask=wasm.game_target_mask();
  ui.score.textContent=formatScore(score);ui.lives.textContent='● '.repeat(Math.max(0,lives)).trim()||'—';ui.combo.textContent=`×${String(drive>0?combo*3:combo).padStart(2,'0')}`;ui.backScore.textContent=formatScore(score);ui.backBalls.textContent='● '.repeat(Math.max(0,lives)).trim()||'GAME OVER';
  ui.energy.textContent=drive>0?'MAX':`${Math.round(energy)}%`;ui.fill.style.width=drive>0?'100%':`${energy}%`;ui.fill.style.background=drive>0?'linear-gradient(90deg,#ef3340,#ffd83d,#58df66,#2b8cff)':'';
  ui.driveHint.textContent=drive>0?`无敌星生效 · 剩余 ${drive.toFixed(1)} 秒`:'收集金币以点亮无敌星';
  ui.targets.textContent=`${mask.toString(2).split('1').length-1}/6`;
  if(score>highScore){highScore=score;ui.high.textContent=formatScore(highScore);localStorage.setItem('prismShiftHigh',highScore);}
}

function loop(now) {
  const dt=Math.min(.034,(now-lastTime)/1000 || 0);lastTime=now;elapsed+=dt;
  if(wasm && started && !paused && !wasm.game_over()){
    if(launchHeld) charge=Math.min(1,(now-launchStart)/1100);else charge=0;
    wasm.game_step(dt,keys.left?1:0,keys.right?1:0);processEvents();updateFx(dt);updateHud(dt);
  } else if(wasm) { updateFx(dt); }
  if(wasm && wasm.game_over() && !finishedShown){finishedShown=true;paused=true;ui.final.textContent=formatScore(wasm.game_score());setTimeout(()=>ui.gameover.classList.add('is-open'),450);}
  if(touchLaunchButton)touchLaunchButton.style.setProperty('--charge',`${Math.round(charge*100)}%`);
  if(!phoneLayout.matches||now-lastCanvasDraw>31){drawFrame();lastCanvasDraw=now;}requestAnimationFrame(loop);
}

function focusPlayfield(){if(!phoneLayout.matches)return;syncMobileViewport();if(landscapeLayout.matches){scrollTo(0,0);return;}setTimeout(()=>{const frame=document.querySelector('.canvas-frame');if(!frame)return;const vv=window.visualViewport;const controlsTop=touchControls?.getBoundingClientRect().top||(vv?.height||innerHeight);const rect=frame.getBoundingClientRect();const pageTop=scrollY+rect.top;const topGap=Math.max(8,(controlsTop-rect.height-16)/2)+(vv?.offsetTop||0);scrollTo({top:Math.max(0,pageTop-topGap),behavior:'smooth'});},180);}
async function toggleFullscreen(){try{if(document.fullscreenElement){await document.exitFullscreen();screen.orientation?.unlock?.();}else if(document.documentElement.requestFullscreen){await document.documentElement.requestFullscreen({navigationUI:'hide'});if(landscapeLayout.matches)try{await screen.orientation?.lock?.('landscape');}catch(_){}}}catch(_){}scheduleViewportSync();requestWakeLock();}
function startGame(){ synth.init();requestWakeLock();started=true;paused=false;finishedShown=false;ui.intro.classList.remove('is-open');ui.gameover.classList.remove('is-open');lastTime=performance.now();focusPlayfield(); }
function restartGame(){wasm.game_restart();trail.length=particles.length=rings.length=labels.length=0;startGame();}
function setPause(value){if(!started||wasm.game_over())return;paused=value;if(!value)requestWakeLock();ui.pause.classList.toggle('is-open',paused);lastTime=performance.now();}
function beginLaunch(){if(!wasm||paused||wasm.game_launched())return;launchHeld=true;launchStart=performance.now();charge=.05;}
function endLaunch(){if(!launchHeld)return;launchHeld=false;if(!paused&&!wasm.game_launched()){wasm.game_launch(Math.max(.28,charge));processEvents();}charge=0;}
function setFlipper(side,value,el){keys[side]=value;if(el)el.classList.toggle('active',value);if(value&&!paused){synth.flip();if(el&&navigator.vibrate)navigator.vibrate(9);}}

window.addEventListener('keydown',e=>{
  if((e.ctrlKey||e.metaKey)&&['Equal','Minus','Digit0','NumpadAdd','NumpadSubtract','Numpad0'].includes(e.code)){e.preventDefault();return;}
  if(['ArrowLeft','ArrowRight','ArrowDown','Space'].includes(e.code))e.preventDefault();
  if(e.code==='ArrowLeft'||e.code==='KeyA')setFlipper('left',true);
  if(e.code==='ArrowRight'||e.code==='KeyD')setFlipper('right',true);
  if((e.code==='Space'||e.code==='ArrowDown')&&!e.repeat)beginLaunch();
  if(e.code==='KeyP'&&!e.repeat)setPause(!paused);
});
window.addEventListener('keyup',e=>{if(e.code==='ArrowLeft'||e.code==='KeyA')setFlipper('left',false);if(e.code==='ArrowRight'||e.code==='KeyD')setFlipper('right',false);if(e.code==='Space'||e.code==='ArrowDown')endLaunch();});
window.addEventListener('blur',()=>{keys.left=keys.right=false;if(started&&!paused)setPause(true);});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&started&&!paused)setPause(true);else if(!document.hidden&&started)requestWakeLock();});
window.addEventListener('wheel',e=>{if(e.ctrlKey||e.metaKey)e.preventDefault();},{passive:false});
['gesturestart','gesturechange','gestureend'].forEach(type=>document.addEventListener(type,e=>e.preventDefault(),{passive:false}));
document.addEventListener('touchmove',e=>{if(e.touches.length>1)e.preventDefault();},{passive:false});
document.addEventListener('dblclick',e=>e.preventDefault(),{passive:false});
document.addEventListener('selectstart',e=>e.preventDefault(),{passive:false});
document.addEventListener('dragstart',e=>e.preventDefault(),{passive:false});
document.addEventListener('contextmenu',e=>{if(e.target.closest('canvas,.touch-controls,.canvas-frame'))e.preventDefault();});
let lastTouchEnd=0;document.addEventListener('touchend',e=>{const now=Date.now();if(now-lastTouchEnd<320)e.preventDefault();lastTouchEnd=now;},{passive:false});
document.addEventListener('pointerdown',()=>{if(started)requestWakeLock();},{passive:true});
screen.orientation?.addEventListener?.('change',()=>{scheduleViewportSync();if(started)requestWakeLock();});
ui.start.addEventListener('click',startGame);ui.resume.addEventListener('click',()=>setPause(false));ui.restart.addEventListener('click',restartGame);ui.pauseBtn.addEventListener('click',()=>setPause(!paused));
ui.fullscreen?.addEventListener('click',toggleFullscreen);
ui.sound.addEventListener('click',()=>{muted=!muted;ui.sound.classList.toggle('muted',muted);ui.sound.setAttribute('aria-label',muted?'开启声音':'关闭声音');if(!muted)synth.tone(560,.08,'sine',.025,220);});

function bindHold(id,down,up){const el=document.querySelector(id);el.addEventListener('pointerdown',e=>{e.preventDefault();el.setPointerCapture(e.pointerId);down(el);});['pointerup','pointercancel','lostpointercapture'].forEach(type=>el.addEventListener(type,e=>{e.preventDefault();up(el);}));}
bindHold('#touchLeft',el=>setFlipper('left',true,el),el=>setFlipper('left',false,el));
bindHold('#touchRight',el=>setFlipper('right',true,el),el=>setFlipper('right',false,el));
bindHold('#touchLaunch',el=>{el.classList.add('active');beginLaunch();if(navigator.vibrate)navigator.vibrate(10);},el=>{el.classList.remove('active');endLaunch();if(navigator.vibrate)navigator.vibrate([8,18,12]);});

loadWasm().catch(err=>{console.error(err);ui.wasm.textContent='WASM LOAD FAILED';document.querySelector('.live-dot').style.background='#ff4f87';});
requestAnimationFrame(loop);
