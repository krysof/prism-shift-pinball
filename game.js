const canvas = document.querySelector('#game');
const ctx = canvas.getContext('2d', { alpha: false });
const W = 800, H = 1200;

const ui = {
  intro: document.querySelector('#intro'), pause: document.querySelector('#pauseLayer'), gameover: document.querySelector('#gameOverLayer'),
  start: document.querySelector('#startBtn'), resume: document.querySelector('#resumeBtn'), restart: document.querySelector('#restartBtn'),
  pauseBtn: document.querySelector('#pauseBtn'), sound: document.querySelector('#soundBtn'), wasm: document.querySelector('#wasmStatus'),
  score: document.querySelector('#scoreValue'), high: document.querySelector('#highScore'), lives: document.querySelector('#livesValue'),
  combo: document.querySelector('#comboValue'), energy: document.querySelector('#energyValue'), fill: document.querySelector('#energyFill'),
  driveHint: document.querySelector('#driveHint'), targets: document.querySelector('#targetProgress'), final: document.querySelector('#finalScore'),
  missionBumpers: document.querySelector('#missionBumpers'), missionTargets: document.querySelector('#missionTargets'), missionDrive: document.querySelector('#missionDrive')
};

let wasm;
let started = false;
let paused = true;
let muted = false;
let finishedShown = false;
let lastTime = performance.now();
let elapsed = 0;
let screenShake = 0;
let flash = 0;
let launchHeld = false;
let launchStart = 0;
let charge = 0;
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

async function loadWasm() {
  const url = new URL('game.wasm', import.meta.url);
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

function processEvents() {
  const n=wasm.event_count();
  for(let i=0;i<n;i++){
    const kind=wasm.event_kind(i),x=wasm.event_x(i),y=wasm.event_y(i),value=wasm.event_value(i);
    if(kind===1){spawnBurst(x,y,i%2?'#6ff7ff':'#a66bff',22,320);spawnRing(x,y,'#6ff7ff');addLabel(x,y-42,`+${value}`,'#fff');screenShake=6;flash=.18;synth.impact();ui.missionBumpers.classList.add('flash');setTimeout(()=>ui.missionBumpers.classList.remove('flash'),220);}
    if(kind===3){spawnBurst(x,y,'#ff4fd8',7,150);synth.flip();}
    if(kind===4){spawnBurst(x,y,'#ff4f87',34,330);spawnRing(x,y,'#ff4f87',30);screenShake=11;synth.drain();}
    if(kind===5){spawnBurst(x,y,'#c8ff68',15,220);addLabel(x,y-28,`+${value}`,'#c8ff68',value>1000);synth.target();ui.missionTargets.classList.add('flash');setTimeout(()=>ui.missionTargets.classList.remove('flash'),240);}
    if(kind===6){for(let j=0;j<7;j++)setTimeout(()=>spawnRing(400,575,j%2?'#ff4fd8':'#6ff7ff',j*22),j*35);addLabel(400,650,'OVERDRIVE ×3','#ff4fd8',true);screenShake=14;flash=.9;synth.drive();ui.missionDrive.classList.add('flash');setTimeout(()=>ui.missionDrive.classList.remove('flash'),600);}
    if(kind===7){spawnBurst(x,y,'#ff4fd8',25,270);screenShake=5;synth.launch();}
  }
}

function drawFrame() {
  if(!wasm) return;
  const x=wasm.ball_x(),y=wasm.ball_y(),vx=wasm.ball_vx(),vy=wasm.ball_vy(),drive=wasm.game_overdrive(),mask=wasm.game_target_mask();
  ctx.save(); if(screenShake>0) ctx.translate((Math.random()-.5)*screenShake,(Math.random()-.5)*screenShake);
  drawBackdrop(drive); drawCabinet(drive); drawHardwareDetails(drive);
  drawBumper(250,330,49,'#a66bff',0);drawBumper(535,315,49,'#6ff7ff',1);drawBumper(402,493,57,drive>0?'#ff4fd8':'#758cff',2);
  drawBumper(122,530,25,'#ff4fd8',3);drawBumper(625,520,25,'#6ff7ff',4);
  drawTargets(mask);drawSlings();
  drawFlipper(258,1038,wasm.left_angle(),'#ff4fd8','L');drawFlipper(542,1038,wasm.right_angle(),'#6ff7ff','R');
  drawLauncher(charge,!wasm.game_launched());
  drawBall(x,y,vx,vy); drawFx();
  if(drive>0){ctx.save();ctx.globalCompositeOperation='screen';ctx.strokeStyle=rgba('#ff4fd8',.35+.15*Math.sin(elapsed*10));ctx.lineWidth=12;ctx.shadowColor='#ff4fd8';ctx.shadowBlur=28;ctx.strokeRect(34,31,732,1135);ctx.fillStyle='rgba(255,79,216,.8)';ctx.font='700 11px "DM Mono",monospace';ctx.fillText(`OVERDRIVE  ${drive.toFixed(1)}s`,78,190);ctx.restore();}
  if(flash>0){ctx.fillStyle=`rgba(210,245,255,${flash*.24})`;ctx.fillRect(0,0,W,H);}
  ctx.restore();
}

let hudTimer=0;
function updateHud(dt) {
  hudTimer-=dt;if(hudTimer>0)return;hudTimer=.08;
  const score=wasm.game_score(), lives=wasm.game_lives(), combo=wasm.game_combo(), energy=wasm.game_energy(), drive=wasm.game_overdrive(),mask=wasm.game_target_mask();
  ui.score.textContent=formatScore(score);ui.lives.textContent='● '.repeat(Math.max(0,lives)).trim()||'—';ui.combo.textContent=`×${String(drive>0?combo*3:combo).padStart(2,'0')}`;
  ui.energy.textContent=drive>0?'MAX':`${Math.round(energy)}%`;ui.fill.style.width=drive>0?'100%':`${energy}%`;ui.fill.style.background=drive>0?'linear-gradient(90deg,#ff4fd8,#fff,#6ff7ff)':'';
  ui.driveHint.textContent=drive>0?`超驱同步中 · 剩余 ${drive.toFixed(1)} 秒`:'命中目标以填充超驱核心';
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
  drawFrame();requestAnimationFrame(loop);
}

function startGame(){ synth.init();started=true;paused=false;finishedShown=false;ui.intro.classList.remove('is-open');ui.gameover.classList.remove('is-open');lastTime=performance.now(); }
function restartGame(){wasm.game_restart();trail.length=particles.length=rings.length=labels.length=0;startGame();}
function setPause(value){if(!started||wasm.game_over())return;paused=value;ui.pause.classList.toggle('is-open',paused);lastTime=performance.now();}
function beginLaunch(){if(!wasm||paused||wasm.game_launched())return;launchHeld=true;launchStart=performance.now();charge=.05;}
function endLaunch(){if(!launchHeld)return;launchHeld=false;if(!paused&&!wasm.game_launched())wasm.game_launch(Math.max(.28,charge));charge=0;}
function setFlipper(side,value,el){keys[side]=value;if(el)el.classList.toggle('active',value);if(value&&!paused)synth.flip();}

window.addEventListener('keydown',e=>{
  if(['ArrowLeft','ArrowRight','Space'].includes(e.code))e.preventDefault();
  if(e.code==='ArrowLeft'||e.code==='KeyA')setFlipper('left',true);
  if(e.code==='ArrowRight'||e.code==='KeyD')setFlipper('right',true);
  if(e.code==='Space'&&!e.repeat)beginLaunch();
  if(e.code==='KeyP'&&!e.repeat)setPause(!paused);
});
window.addEventListener('keyup',e=>{if(e.code==='ArrowLeft'||e.code==='KeyA')setFlipper('left',false);if(e.code==='ArrowRight'||e.code==='KeyD')setFlipper('right',false);if(e.code==='Space')endLaunch();});
window.addEventListener('blur',()=>{keys.left=keys.right=false;if(started&&!paused)setPause(true);});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&started&&!paused)setPause(true);});
ui.start.addEventListener('click',startGame);ui.resume.addEventListener('click',()=>setPause(false));ui.restart.addEventListener('click',restartGame);ui.pauseBtn.addEventListener('click',()=>setPause(!paused));
ui.sound.addEventListener('click',()=>{muted=!muted;ui.sound.classList.toggle('muted',muted);ui.sound.setAttribute('aria-label',muted?'开启声音':'关闭声音');if(!muted)synth.tone(560,.08,'sine',.025,220);});

function bindHold(id,down,up){const el=document.querySelector(id);el.addEventListener('pointerdown',e=>{e.preventDefault();el.setPointerCapture(e.pointerId);down(el);});['pointerup','pointercancel','lostpointercapture'].forEach(type=>el.addEventListener(type,e=>{e.preventDefault();up(el);}));}
bindHold('#touchLeft',el=>setFlipper('left',true,el),el=>setFlipper('left',false,el));
bindHold('#touchRight',el=>setFlipper('right',true,el),el=>setFlipper('right',false,el));
bindHold('#touchLaunch',el=>{el.classList.add('active');beginLaunch();},el=>{el.classList.remove('active');endLaunch();});

loadWasm().catch(err=>{console.error(err);ui.wasm.textContent='WASM LOAD FAILED';document.querySelector('.live-dot').style.background='#ff4f87';});
requestAnimationFrame(loop);
