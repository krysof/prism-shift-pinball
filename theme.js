(function () {
  const themes = {
    kingdom: {
      id: 'kingdom', label: '王国城堡', short: '王国', code: '01',
      playfield: 'assets/kingdom-playfield.webp', backbox: 'assets/kingdom-backbox.webp',
      subtitle: 'KINGDOM CASTLE SIEGE', mode: 'CASTLE SIEGE',
      objective: 'SHOOT CASTLE  •  COMPLETE M-A-R-I-O  •  LOCK 3 BALLS',
      chrome: '#070a12', accent: '#ffd83d', accent2: '#2b8cff',
      sparks: ['#5bd6ff', '#ff5670', '#ffd267'],
      scene: { background: '#03060d', cabinet: '#681117', pipe: '#0f5b29', castle: '#c6ad83', roof: '#8d1820', window: '#a43d04', left: '#ff2638', right: '#2a8fff', fill: '#ffc933', railLeft: '#d62c38', railRight: '#267ac2', sky: '#aed8ed', ground: '#08040a', dust: '#ffe078', inserts: ['#e82d39','#ffc727','#2188e6','#3abc55'], exposure: .74 }
    },
    lava: {
      id: 'lava', label: '熔岩魔城', short: '熔岩', code: '02',
      playfield: 'assets/lava-playfield.webp', backbox: 'assets/lava-backbox.webp',
      subtitle: 'LAVA FORTRESS RAID', mode: 'MAGMA FORTRESS',
      objective: 'BREACH GATE  •  CHARGE CORE  •  CLAIM JACKPOT',
      chrome: '#130503', accent: '#ff7a1a', accent2: '#ff3038',
      sparks: ['#ffb02e', '#ff3b1f', '#ffe078'],
      scene: { background: '#090201', cabinet: '#35100c', pipe: '#3b3022', castle: '#3a2923', roof: '#190907', window: '#ff4a00', left: '#ff321c', right: '#ff9a16', fill: '#ff5714', railLeft: '#ff2f17', railRight: '#ff8a12', sky: '#ff9a4a', ground: '#140100', dust: '#ff6a22', inserts: ['#ff3425','#ff9a18','#ffc52b','#d52116'], exposure: .68 }
    },
    starroad: {
      id: 'starroad', label: '银河星路', short: '星路', code: '03',
      playfield: 'assets/starroad-playfield.webp', backbox: 'assets/starroad-backbox.webp',
      subtitle: 'STAR ROAD ODYSSEY', mode: 'COSMIC ODYSSEY',
      objective: 'RIDE STAR ROAD  •  ALIGN STARS  •  OPEN PORTAL',
      chrome: '#05051b', accent: '#70e7ff', accent2: '#b66cff',
      sparks: ['#70e7ff', '#da68ff', '#ffe56f'],
      scene: { background: '#02031b', cabinet: '#21144f', pipe: '#143d82', castle: '#9fa8c9', roof: '#5425a8', window: '#765dff', left: '#da44ff', right: '#36dfff', fill: '#7f64ff', railLeft: '#bd48ff', railRight: '#30cfff', sky: '#7edcff', ground: '#08031a', dust: '#a8efff', inserts: ['#e24fff','#73eaff','#ffd94a','#735dff'], exposure: .72 }
    }
  };

  const valid = id => Object.prototype.hasOwnProperty.call(themes, id);
  let saved = 'kingdom';
  try { saved = localStorage.getItem('marioPinballTheme') || saved; } catch (_) {}
  if (!valid(saved)) saved = 'kingdom';

  window.__pinballThemes = themes;
  window.__pinballTheme = themes[saved];

  function updateButtons(id) {
    document.querySelectorAll('button[data-theme]').forEach(button => {
      const active = button.dataset.theme === id;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  }

  function applyTheme(id, announce = true) {
    if (!valid(id)) return;
    const theme = themes[id];
    window.__pinballTheme = theme;
    document.documentElement.dataset.theme = id;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme.chrome);
    updateButtons(id);
    try { localStorage.setItem('marioPinballTheme', id); } catch (_) {}
    if (announce) window.dispatchEvent(new CustomEvent('pinball-theme-change', { detail: { theme } }));
  }

  const warmed = new Set([saved]);
  function warmTheme(id) {
    if (!valid(id) || warmed.has(id)) return; warmed.add(id);
    const playfield = new Image(), backbox = new Image(); playfield.decoding = backbox.decoding = 'async';
    playfield.src = themes[id].playfield; backbox.src = themes[id].backbox;
  }
  document.querySelectorAll('button[data-theme]').forEach(button => {
    button.addEventListener('pointerenter', () => warmTheme(button.dataset.theme), { passive: true });
    button.addEventListener('pointerdown', () => warmTheme(button.dataset.theme), { passive: true });
    button.addEventListener('click', () => applyTheme(button.dataset.theme));
  });
  window.setPinballTheme = applyTheme;
  applyTheme(saved, false);
})();
