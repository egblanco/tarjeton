const API = 'https://apiliga.serteza.com/public/api';

const state = {
  categorias: [],
  jornadas: [],
  jornadaActual: null,
  temporada: null,
  currentSection: 'inicio',
  // resultados
  resGrupo: '',
  // standings
  standGrupo: '',
  standingsCache: {},
  // equipos
  equipos: [],
  equiposEnriched: [],
  eqGrupoFilter: '',
  currentEquipo: null,
  playerCache: {},
  playerCacheAll: false,
  calendarExpandedJornada: null,
  currentLeaderTab: 'AVG',
};

const MESES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
const DIAS = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];

function formatFecha(str) {
  if (!str) return '';
  const [y, m, d] = str.split('-');
  return `${parseInt(d)} de ${MESES[parseInt(m)-1]} ${y}`;
}

function formatFechaLarga(str) {
  if (!str) return '';
  const date = new Date(str + 'T12:00:00');
  return `${DIAS[date.getDay()]} ${date.getDate()} de ${MESES[date.getMonth()]} ${date.getFullYear()}`;
}

function catLabel(cat) {
  return cat.Categoria.replace(/^DIVISION\s+/i, '').replace(/\s+\d+-\d+(-\d+)?$/, '');
}

function catShort(cat) {
  return { label: catLabel(cat), ages: `${cat.EdadMinima}-${cat.EdadMaxima}` };
}

function logoUrl(url) {
  if (!url) return null;
  return url.replace('http://', 'https://');
}

function extractGrupo(equipoFullName) {
  const match = equipoFullName.match(/\b(A\s+I{1,3})\s*$/);
  return match ? match[1] : '';
}

function extractTeamBase(equipoFullName, categorias) {
  let name = equipoFullName;
  for (const cat of categorias) {
    name = name.replace(cat.Categoria, '').trim();
  }
  name = name.replace(/\s+(A\s+I{1,3})\s*$/, '').trim();
  return name;
}

function extractCategoriaFromFull(fullName, categorias) {
  for (const cat of categorias) {
    if (fullName.includes(cat.Categoria)) return cat;
  }
  const ages = fullName.match(/(\d+)-(\d+)/);
  if (ages) {
    return categorias.find(c => c.EdadMinima === ages[1] && c.EdadMaxima === ages[2]) || null;
  }
  return null;
}

function imgError(el) {
  el.style.display = 'none';
}

// ── API ──

async function apiFetch(endpoint, body = null) {
  const opts = { headers: { 'Content-Type': 'application/json' } };
  if (body) { opts.method = 'POST'; opts.body = JSON.stringify(body); }
  const r = await fetch(`${API}/${endpoint}`, opts);
  return r.json();
}

async function fetchCategorias() {
  const r = await apiFetch('categorias');
  return r.ok ? r.data : [];
}
async function fetchTemporada() {
  const r = await apiFetch('temporadaActual');
  return r.ok ? r.data : null;
}
async function fetchJornadas() {
  const r = await apiFetch('roljuegos/obtenerJornadas');
  return r.ok ? r.data : [];
}
async function fetchJornadaActual() {
  const r = await apiFetch('roljuegos/obtenerJornadaActual');
  return r.ok && r.data.length > 0 ? r.data[0] : null;
}
async function fetchResultados(jornadaID, categoriaID) {
  const r = await apiFetch('roljuegos/obtenerResultados', {
    JornadaID: jornadaID, CategoriaID: categoriaID, InscripcionID: 0
  });
  return r.ok ? (r.data || []) : [];
}
async function fetchStanding(temporadaID, categoriaID) {
  const key = `${temporadaID}_${categoriaID}`;
  if (state.standingsCache[key]) return state.standingsCache[key];
  const r = await apiFetch('roljuegos/obtenerStanding', {
    TemporadaID: temporadaID, CategoriaID: categoriaID
  });
  const data = r.ok ? (r.data || []) : [];
  state.standingsCache[key] = data;
  return data;
}
async function fetchEquipos(temporadaID) {
  const r = await apiFetch('roljuegos/obtenerEquipos', { TemporadaID: temporadaID });
  return r.ok ? (r.data || []) : [];
}
async function fetchNoticias() {
  const r = await apiFetch('noticias/publicas?pagina=1&porPagina=50');
  return r.ok ? (r.data.noticias || []) : [];
}
async function fetchJugadores(inscripcionID) {
  const r = await apiFetch(`inicio/obtenerDatosPorId/${inscripcionID}`);
  return r.ok ? r.data : null;
}
async function fetchBateo(inscripcionID) {
  const r = await apiFetch('compilacion/obtenerBateo', { InscripcionID: inscripcionID });
  return r.ok ? (r.data || []) : [];
}
async function fetchPitcheo(inscripcionID) {
  const r = await apiFetch('compilacion/obtenerPitcheo', { InscripcionID: inscripcionID });
  return r.ok ? (r.data || []) : [];
}

function calcularEdad(fechaNac) {
  if (!fechaNac || fechaNac === '1970-01-01') return null;
  const hoy = new Date();
  const nac = new Date(fechaNac + 'T12:00:00');
  let edad = hoy.getFullYear() - nac.getFullYear();
  const m = hoy.getMonth() - nac.getMonth();
  if (m < 0 || (m === 0 && hoy.getDate() < nac.getDate())) edad--;
  return edad;
}

function renderJugadorRow(j, idx, stats) {
  const edad = calcularEdad(j.FechaNacimiento);
  const edadStr = edad !== null ? `${edad} años` : '';
  const s = stats || {};
  const hasStats = !!s.PCT;
  return `
    <tr>
      <td class="jugador-num">${idx + 1}</td>
      <td class="jugador-nombre">${state.currentEquipo && state.currentEquipo.foto ? '<img class="roster-team-logo" src="' + logoUrl(state.currentEquipo.foto) + '" onerror="this.style.display=\'none\'" alt="">' : ''}${j.nombre}</td>
      <td class="jugador-edad">${edadStr}</td>
      <td class="jugador-stat">${hasStats ? s.PCT : '-'}</td>
      <td class="jugador-stat">${hasStats ? calcISO(s) : '-'}</td>
      <td class="jugador-stat">${hasStats ? recPitcheo(s, edad) : '-'}</td>
      <td class="jugador-stat">${hasStats ? s.R : '-'}</td>
      <td class="jugador-stat">${hasStats ? s.H : '-'}</td>
      <td class="jugador-stat">${hasStats ? s.H2 : '-'}</td>
      <td class="jugador-stat">${hasStats ? s.H3 : '-'}</td>
      <td class="jugador-stat">${hasStats ? s.HR : '-'}</td>
    </tr>`;
}

function calcISO(s) {
  const avg = parseFloat(s.PCT) || 0;
  const slg = parseFloat(s.SLG || calcSLG(s)) || 0;
  const iso = slg - avg;
  return iso > 0 ? iso.toFixed(3) : '.000';
}

function calcSLG(s) {
  const vb = parseInt(s.VB) || 0;
  if (vb === 0) return '0.000';
  const h1 = parseInt(s.H) || 0;
  const h2 = parseInt(s.H2) || 0;
  const h3 = parseInt(s.H3) || 0;
  const hr = parseInt(s.HR) || 0;
  return ((h1 + h2*2 + h3*3 + hr*4) / vb).toFixed(4);
}

// LEYENDA: 1=Recta  2=Cambio  3=Curva(11+)  4=Slider(11+)  5=Nudillos
function recPitcheo(s, edad) {
  if (!s) return '-';
  const avg = parseFloat(s.PCT) || 0;
  const slg = parseFloat(s.SLG) || 0;
  const br = parseInt(s.R) || 0;
  const h = parseInt(s.H) || 0;
  const h2 = parseInt(s.H2) || 0;
  const h3 = parseInt(s.H3) || 0;
  const hr = parseInt(s.HR) || 0;
  const vb = parseInt(s.VB) || 0;
  if (vb === 0) return '-';
  const extraBases = h2 + h3 + hr;
  const mayor = edad >= 11;
  // Duro: bateador de poder → off-speed
  if (slg >= 0.200 && extraBases >= 1) return mayor ? '2-3-2-4-2' : '2-5-2-5-2';
  // Esquinas: pega extrabases → esquinas y cambiar velocidad
  if (h2 >= 1 || h3 >= 1 || hr >= 1) return mayor ? '1-2-3-1-4' : '1-2-5-1-2';
  // Control: buen contacto → adentro y romperla
  if (avg >= 0.150 && h >= 2) return mayor ? '1-1-3-2-4' : '1-1-2-5-2';
  // Recomendable: sólido → mezclar
  if (avg >= 0.100 || br >= 1) return mayor ? '1-2-1-3-2' : '1-2-1-2-5';
  // En desarrollo → rectas por la zona
  if (h > 0 || br > 0) return '1-1-1-2-1';
  return '1-1-1-1-1';
}

function renderRoster(jugadores, bateo) {
  if (!jugadores || jugadores.length === 0) {
    return '<div class="empty-state"><p>No hay jugadores registrados</p></div>';
  }
  const bateoMap = {};
  (bateo || []).forEach(b => {
    b.SLG = calcSLG(b);
    bateoMap[b.JugadorID] = b;
  });
  const rows = jugadores.map((j, i) => renderJugadorRow(j, i, bateoMap[j.JugadorID])).join('');
  const hasStats = bateo && bateo.length > 0;
  return `
    <div class="roster-card">
      <table class="roster-table">
        <thead><tr>
          <th>#</th><th>Jugador</th><th>Edad</th>
          <th class="stat-col">AVG</th><th class="stat-col">ISO</th><th class="stat-col">PITCH</th><th class="stat-col">BR</th>
          <th class="stat-col">H1</th><th class="stat-col">H2</th><th class="stat-col">H3</th><th class="stat-col">HR</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="roster-count">${jugadores.length} jugadores${hasStats ? ' · Estadísticas reales Temporada 108' : ''}</div>
    </div>`;
}

function renderPitcheoRoster(jugadores, pitcheo) {
  if (!jugadores || jugadores.length === 0) {
    return '<div class="empty-state"><p>No hay jugadores registrados</p></div>';
  }
  const pitcheoMap = {};
  (pitcheo || []).forEach(p => { pitcheoMap[p.JugadorID] = p; });
  const rows = jugadores.map((j, i) => {
    const edad = calcularEdad(j.FechaNacimiento);
    const edadStr = edad !== null ? `${edad} años` : '';
    const s = pitcheoMap[j.JugadorID] || {};
    const hasStats = !!(s.ERA || s.PCT || s.G);
    return `
      <tr>
        <td class="jugador-num">${i + 1}</td>
        <td class="jugador-nombre">${state.currentEquipo && state.currentEquipo.foto ? '<img class="roster-team-logo" src="' + logoUrl(state.currentEquipo.foto) + '" onerror="this.style.display=\'none\'" alt="">' : ''}${j.nombre}</td>
        <td class="jugador-edad">${edadStr}</td>
        <td class="jugador-stat">${hasStats ? (s.ERA || s.PCT || '-') : '-'}</td>
        <td class="jugador-stat">${hasStats ? (s.G || '-') : '-'}</td>
        <td class="jugador-stat">${hasStats ? (s.P || '-') : '-'}</td>
        <td class="jugador-stat">${hasStats ? (s.IP || s.IN || '-') : '-'}</td>
        <td class="jugador-stat">${hasStats ? (s.SO || s.K || '-') : '-'}</td>
        <td class="jugador-stat">${hasStats ? (s.BB || '-') : '-'}</td>
      </tr>`;
  }).join('');
  const hasStats = pitcheo && pitcheo.length > 0;
  return `
    <div class="roster-card">
      <table class="roster-table">
        <thead><tr>
          <th>#</th><th>Jugador</th><th>Edad</th>
          <th class="stat-col">ERA</th><th class="stat-col">G</th><th class="stat-col">P</th>
          <th class="stat-col">IP</th><th class="stat-col">SO</th><th class="stat-col">BB</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="roster-count">${jugadores.length} jugadores${hasStats ? ' · Estadísticas de pitcheo' : ''}</div>
    </div>`;
}

function renderRosterTabs(jugadores, bateo, pitcheo) {
  const bateoHTML = renderRoster(jugadores, bateo);
  const pitcheoHTML = renderPitcheoRoster(jugadores, pitcheo);
  return `
    <div class="roster-tabs">
      <button class="roster-tab active" onclick="switchRosterTab('bateo')">⚾ Bateo</button>
      <button class="roster-tab" onclick="switchRosterTab('pitcheo')">🥎 Pitcheo</button>
    </div>
    <div id="roster-bateo" class="roster-tab-content active">${bateoHTML}</div>
    <div id="roster-pitcheo" class="roster-tab-content">${pitcheoHTML}</div>
  `;
}

function switchRosterTab(tab) {
  document.querySelectorAll('.roster-tab').forEach(t => {
    const isTarget = (tab === 'bateo' && t.textContent.includes('Bateo'))
                  || (tab === 'pitcheo' && t.textContent.includes('Pitcheo'));
    t.classList.toggle('active', isTarget);
  });
  document.getElementById('roster-bateo').classList.toggle('active', tab === 'bateo');
  document.getElementById('roster-pitcheo').classList.toggle('active', tab === 'pitcheo');
}

// ── DESCARGAR TARJETÓN ──

function descargarTarjeton() {
  const eq = state.currentEquipo;
  if (!eq || !eq._jugadores) return;

  const input = prompt('¿Cuántas copias en una hoja?', '1');
  if (!input) return;
  const copias = Math.max(1, Math.min(20, parseInt(input) || 1));
  const jugadores = eq._jugadores;
  const logoSrc = logoUrl(eq.foto) || '';
  const pct = eq.points || '---';
  const temporada = state.temporada ? state.temporada.Temporada : 'TEMPORADA 108';

  const bateo = eq._bateo || [];
  const bateoMap = {};
  bateo.forEach(b => { b.SLG = calcSLG(b); bateoMap[b.JugadorID] = b; });

  const rows = jugadores.map((j, i) => {
    const edad = calcularEdad(j.FechaNacimiento);
    const edadStr = edad !== null ? edad : '';
    const s = bateoMap[j.JugadorID];
    const avg = s ? s.PCT : '';
    const iso = s ? calcISO(s) : '';
    const pitch = s ? recPitcheo(s, edad) : '';
    const br = s ? s.R : '';
    const h1 = s ? s.H : '';
    const h2 = s ? s.H2 : '';
    const h3 = s ? s.H3 : '';
    const hr = s ? s.HR : '';
    return `<tr>
      <td>${i + 1}</td>
      <td class="nombre">${j.nombre}</td>
      <td class="edad">${edadStr}</td>
      <td class="stat">${avg}</td>
      <td class="stat">${iso}</td>
      <td class="stat">${pitch}</td>
      <td class="stat">${br}</td>
      <td class="stat">${h1}</td>
      <td class="stat">${h2}</td>
      <td class="stat">${h3}</td>
      <td class="stat">${hr}</td>
    </tr>`;
  }).join('');

  // Calcular cuadrícula: columnas x filas para acomodar N copias en 1 hoja
  let cols, rws;
  if (copias === 1) { cols = 1; rws = 1; }
  else if (copias === 2) { cols = 2; rws = 1; }
  else if (copias <= 4) { cols = 2; rws = 2; }
  else if (copias <= 6) { cols = 3; rws = 2; }
  else if (copias <= 9) { cols = 3; rws = 3; }
  else if (copias <= 12) { cols = 4; rws = 3; }
  else if (copias <= 16) { cols = 4; rws = 4; }
  else { cols = 5; rws = 4; }

  const scale = Math.min(1, 1 / cols, 1 / rws);
  const fs = sz => Math.max(4, Math.round(sz * scale));

  const leyendaPitch = `<div style="background:#f0f9ff;border:1px solid #0ea5e9;border-radius:4px;padding:${fs(4)}px ${fs(6)}px;margin-top:${fs(3)}px;font-size:${fs(7)}px;text-align:center;">
  <b>PITCH:</b> 1=Recta &nbsp; 2=Cambio &nbsp; 3=Curva<span style="color:#e11d48;font-size:${fs(5)}px;">(11+)</span> &nbsp; 4=Slider<span style="color:#e11d48;font-size:${fs(5)}px;">(11+)</span> &nbsp; 5=Nudillos
</div>`;

  const card = (ci) => `<div class="card">
<div style="display:flex;align-items:center;gap:${fs(12)}px;padding-bottom:${fs(6)}px;margin-bottom:${fs(3)}px;border-bottom:2px solid #14532d;">
  ${logoSrc ? `<img src="${logoSrc}" style="width:${fs(40)}px;height:${fs(40)}px;border-radius:50%;object-fit:cover;border:2px solid #14532d;" onerror="this.style.display='none'">` : ''}
  <div style="flex:1;overflow:hidden;">
    <div style="font-size:${fs(18)}px;font-weight:900;text-transform:uppercase;color:#14532d;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${eq.teamName}</div>
    <div style="font-size:${fs(8)}px;color:#555;">${eq.catLabel} · <b style="color:#b45309;">${eq.grupo}</b></div>
  </div>
  <div style="display:flex;gap:${fs(8)}px;flex-shrink:0;">
    <div style="text-align:center"><div style="font-size:${fs(20)}px;font-weight:900;color:#16a34a;">${eq.wins}</div><div style="font-size:${fs(5)}px;font-weight:700;color:#888;">G</div></div>
    <div style="text-align:center"><div style="font-size:${fs(20)}px;font-weight:900;color:#dc2626;">${eq.loses}</div><div style="font-size:${fs(5)}px;font-weight:700;color:#888;">P</div></div>
    <div style="text-align:center"><div style="font-size:${fs(20)}px;font-weight:900;color:#d97706;">${pct}</div><div style="font-size:${fs(5)}px;font-weight:700;color:#888;">PCT</div></div>
  </div>
</div>
<table style="width:100%;border-collapse:collapse;">
  <thead><tr>
    <th class="th">#</th><th class="th" style="text-align:left">JUGADOR</th><th class="th">EDAD</th>
    <th class="ths">AVG</th><th class="ths">ISO</th><th class="ths">PITCH</th><th class="ths">BR</th>
    <th class="ths">H1</th><th class="ths">H2</th><th class="ths">H3</th><th class="ths">HR</th>
  </tr></thead>
  <tbody>${rows}</tbody>
</table>
${leyendaPitch}
</div>`;

  const cards = Array.from({length: copias}, (_, i) => card(i + 1)).join('\n');

  const fullHTML = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Tarjetón - ${eq.teamName} x${copias}</title>
<style>
@page { size: landscape; margin: 0.2in; }
* { margin:0; padding:0; box-sizing:border-box; }
html, body { margin:0; padding:0; font-family:'Segoe UI',Arial,sans-serif; color:#111; width:100%; height:100%; }
.grid {
  display: grid;
  grid-template-columns: repeat(${cols}, 1fr);
  grid-template-rows: repeat(${rws}, 1fr);
  gap: 4px;
  width: 100%; height: 100vh;
  padding: 2px;
}
.card {
  border: 1px solid #ccc;
  border-radius: 4px;
  padding: ${fs(8)}px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.th { background:#14532d;color:#fff;padding:${fs(3)}px;font-size:${fs(8)}px;font-weight:800;letter-spacing:0.5px;text-transform:uppercase;border:1px solid #0f4023; }
.ths { background:#1e3a5f;color:#fff;padding:${fs(3)}px;font-size:${fs(8)}px;font-weight:800;letter-spacing:0.5px;border:1px solid #0f4023; }
td { padding:${fs(2)}px ${fs(3)}px;font-size:${fs(7)}px;font-weight:500;border:1px solid #d1d5db;text-align:center; }
td.nombre { text-align:left;font-weight:700;word-break:break-word;white-space:normal;font-size:${fs(6)}px; }
td.edad { color:#16a34a;font-weight:700; }
td.stat { background:#fefce8; }
tr:nth-child(even) td { background:#f3f4f6; }
tr:nth-child(even) td.stat { background:#fef9c3; }
</style></head>
<body>
<div class="grid">
${cards}
</div>
</body></html>`;

  const win = window.open('', '_blank');
  win.document.write(fullHTML);
  win.document.close();
  setTimeout(() => win.print(), 500);
}

// ── DESCARGAR CATEGORÍA COMPLETA ──

async function descargarCategoria() {
  const catID = document.getElementById('stand-cat').value;
  if (!catID || !state.temporada) return;
  const cat = state.categorias.find(c => c.CategoriaID === catID);
  if (!cat) return;

  const grupos = await fetchStanding(state.temporada.TemporadaID, catID);
  if (grupos.length === 0) return;

  const grupoNames = grupos.map(g => g.clasificacion);
  let selectedGrupo = null;
  if (grupoNames.length > 1) {
    const opciones = grupoNames.map((g, i) => `${i + 1} = ${g}`).join('\n');
    const sel = prompt(`¿Qué grupo imprimir?\n${opciones}\n0 = TODOS`, '1');
    if (sel === null) return;
    const idx = parseInt(sel);
    if (idx > 0 && idx <= grupoNames.length) {
      selectedGrupo = grupoNames[idx - 1];
    }
  }

  const input = prompt('¿Cuántos equipos por página?', '4');
  if (!input) return;
  const perPage = Math.max(1, Math.min(20, parseInt(input) || 4));

  const temporada = state.temporada ? state.temporada.Temporada : 'TEMPORADA 108';

  const allTeams = [];
  for (const g of grupos) {
    if (selectedGrupo && g.clasificacion !== selectedGrupo) continue;
    for (const eq of g.equipos) {
      allTeams.push({ ...eq, grupo: g.clasificacion });
    }
  }

  const matched = allTeams.map(eq => {
    const teamUpper = eq.equipo.toUpperCase();
    const catNombre = cat.Categoria.toUpperCase();
    const grupoClasif = eq.grupo.toUpperCase();
    const entry = state.equipos.find(e => {
      const f = e.Equipo.toUpperCase();
      return f.includes(teamUpper) && f.includes(catNombre) && f.includes(grupoClasif);
    }) || state.equipos.find(e => {
      const f = e.Equipo.toUpperCase();
      return f.includes(teamUpper) && f.includes(catNombre);
    });
    return { ...eq, InscripcionID: entry ? entry.InscripcionID : null };
  });

  let cols, rws;
  if (perPage === 1) { cols = 1; rws = 1; }
  else if (perPage === 2) { cols = 2; rws = 1; }
  else if (perPage <= 4) { cols = 2; rws = 2; }
  else if (perPage <= 6) { cols = 3; rws = 2; }
  else if (perPage <= 9) { cols = 3; rws = 3; }
  else if (perPage <= 12) { cols = 4; rws = 3; }
  else if (perPage <= 16) { cols = 4; rws = 4; }
  else { cols = 5; rws = 4; }

  const scale = Math.min(1, 1 / cols, 1 / rws);
  const fs = sz => Math.max(4, Math.round(sz * scale));

  const leyendaCat = `<div style="background:#f0f9ff;border:1px solid #0ea5e9;border-radius:4px;padding:${fs(4)}px ${fs(6)}px;margin-top:${fs(3)}px;font-size:${fs(7)}px;text-align:center;">
  <b>PITCH:</b> 1=Recta &nbsp; 2=Cambio &nbsp; 3=Curva<span style="color:#e11d48;font-size:${fs(5)}px;">(11+)</span> &nbsp; 4=Slider<span style="color:#e11d48;font-size:${fs(5)}px;">(11+)</span> &nbsp; 5=Nudillos
</div>`;

  const btn = document.querySelector('#sec-standings .btn-primary');
  const origText = btn.innerHTML;
  btn.innerHTML = '<span class="inline-spinner"></span> Cargando equipos...';
  btn.disabled = true;

  const teamCards = [];
  for (let i = 0; i < matched.length; i++) {
    const eq = matched[i];
    btn.innerHTML = `<span class="inline-spinner"></span> ${i+1}/${matched.length} equipos...`;
    let jugadores = [];
    let bateo = [];
    if (eq.InscripcionID) {
      const [jData, bData] = await Promise.all([
        fetchJugadores(eq.InscripcionID),
        fetchBateo(eq.InscripcionID)
      ]);
      jugadores = jData ? (jData.jugadores || []) : [];
      bateo = bData || [];
    }

    const bateoMap = {};
    bateo.forEach(b => { b.SLG = calcSLG(b); bateoMap[b.JugadorID] = b; });

    const rows = jugadores.map((j, idx) => {
      const edad = calcularEdad(j.FechaNacimiento);
      const s = bateoMap[j.JugadorID];
      return `<tr>
        <td>${idx+1}</td>
        <td class="nombre">${j.nombre}</td>
        <td class="edad">${edad||''}</td>
        <td class="stat">${s?s.PCT:''}</td>
        <td class="stat">${s?calcISO(s):''}</td>
        <td class="stat">${s?recPitcheo(s,edad):''}</td>
        <td class="stat">${s?s.R:''}</td>
        <td class="stat">${s?s.H:''}</td>
        <td class="stat">${s?s.H2:''}</td>
        <td class="stat">${s?s.H3:''}</td>
        <td class="stat">${s?s.HR:''}</td>
      </tr>`;
    }).join('');

    const logo = logoUrl(eq.foto) || '';
    const pct = eq.points || '---';

    teamCards.push(`<div class="card">
<div style="display:flex;align-items:center;gap:${fs(12)}px;padding-bottom:${fs(6)}px;margin-bottom:${fs(3)}px;border-bottom:2px solid #14532d;">
  ${logo ? `<img src="${logo}" style="width:${fs(40)}px;height:${fs(40)}px;border-radius:50%;object-fit:cover;border:2px solid #14532d;" onerror="this.style.display='none'">` : ''}
  <div style="flex:1;overflow:hidden;">
    <div style="font-size:${fs(18)}px;font-weight:900;text-transform:uppercase;color:#14532d;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${eq.equipo}</div>
    <div style="font-size:${fs(8)}px;color:#555;">${catShort(cat).label} ${catShort(cat).ages} · <b style="color:#b45309;">${eq.grupo}</b></div>
  </div>
  <div style="display:flex;gap:${fs(8)}px;flex-shrink:0;">
    <div style="text-align:center"><div style="font-size:${fs(20)}px;font-weight:900;color:#16a34a;">${eq.wins}</div><div style="font-size:${fs(5)}px;font-weight:700;color:#888;">G</div></div>
    <div style="text-align:center"><div style="font-size:${fs(20)}px;font-weight:900;color:#dc2626;">${eq.loses}</div><div style="font-size:${fs(5)}px;font-weight:700;color:#888;">P</div></div>
    <div style="text-align:center"><div style="font-size:${fs(20)}px;font-weight:900;color:#d97706;">${pct}</div><div style="font-size:${fs(5)}px;font-weight:700;color:#888;">PCT</div></div>
  </div>
</div>
<table style="width:100%;border-collapse:collapse;">
  <thead><tr>
    <th class="th">#</th><th class="th" style="text-align:left">JUGADOR</th><th class="th">EDAD</th>
    <th class="ths">AVG</th><th class="ths">ISO</th><th class="ths">PITCH</th><th class="ths">BR</th>
    <th class="ths">H1</th><th class="ths">H2</th><th class="ths">H3</th><th class="ths">HR</th>
  </tr></thead>
  <tbody>${rows}</tbody>
</table>
${leyendaCat}
</div>`);
  }

  btn.innerHTML = origText;
  btn.disabled = false;

  const pages = [];
  for (let p = 0; p < teamCards.length; p += perPage) {
    const pageCards = teamCards.slice(p, p + perPage);
    pages.push(`<div class="page"><div class="grid">${pageCards.join('\n')}</div></div>`);
  }

  const fullHTML = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Categoría ${catShort(cat).label} ${catShort(cat).ages}</title>
<style>
@page { size: landscape; margin: 0.2in; }
* { margin:0; padding:0; box-sizing:border-box; }
html, body { font-family:'Segoe UI',Arial,sans-serif; color:#111; }
.page { page-break-after:always; width:100%; height:100vh; padding:2px; }
.page:last-child { page-break-after:auto; }
.grid {
  display: grid;
  grid-template-columns: repeat(${cols}, 1fr);
  grid-template-rows: repeat(${rws}, 1fr);
  gap: 4px;
  width: 100%; height: 100%;
}
.card {
  border: 1px solid #ccc; border-radius: 4px;
  padding: ${fs(8)}px; overflow: hidden;
  display: flex; flex-direction: column;
}
.th { background:#14532d;color:#fff;padding:${fs(3)}px;font-size:${fs(8)}px;font-weight:800;letter-spacing:0.5px;text-transform:uppercase;border:1px solid #0f4023; }
.ths { background:#1e3a5f;color:#fff;padding:${fs(3)}px;font-size:${fs(8)}px;font-weight:800;letter-spacing:0.5px;border:1px solid #0f4023; }
td { padding:${fs(2)}px ${fs(3)}px;font-size:${fs(7)}px;font-weight:500;border:1px solid #d1d5db;text-align:center; }
td.nombre { text-align:left;font-weight:700;word-break:break-word;white-space:normal;font-size:${fs(6)}px; }
td.edad { color:#16a34a;font-weight:700; }
td.stat { background:#fefce8; }
tr:nth-child(even) td { background:#f3f4f6; }
tr:nth-child(even) td.stat { background:#fef9c3; }
</style></head>
<body>
${pages.join('\n')}
</body></html>`;

  const win = window.open('', '_blank');
  win.document.write(fullHTML);
  win.document.close();
  setTimeout(() => win.print(), 800);
}

// ── RENDER: GAME CARD ──

function renderGameCard(game, highlightTeam) {
  const e1 = game.equipo_1, e2 = game.equipo_2;
  const logo1 = logoUrl(e1.logo), logo2 = logoUrl(e2.logo);
  const hl = highlightTeam && (
    e1.equipo === highlightTeam || e2.equipo === highlightTeam
  );

  return `
    <div class="game-card${hl ? ' highlight' : ''}">
      <div class="game-header">${game.ubicacion || game.categoria}${game.temporada ? ' &middot; ' + game.temporada : ''}</div>
      <div class="game-body">
        <div class="game-teams">
          <div class="game-team">
            ${logo1
              ? `<img class="team-logo" src="${logo1}" alt="" onerror="this.outerHTML='<div class=\\'team-logo-placeholder\\'>?</div>'">`
              : '<div class="team-logo-placeholder">?</div>'}
            <span class="team-name ${e1.win ? 'winner' : 'loser'}">${e1.equipo}</span>
            <span class="team-score ${e1.win ? 'winner' : 'loser'}">${e1.carreras}</span>
          </div>
          <div class="game-divider"></div>
          <div class="game-team">
            ${logo2
              ? `<img class="team-logo" src="${logo2}" alt="" onerror="this.outerHTML='<div class=\\'team-logo-placeholder\\'>?</div>'">`
              : '<div class="team-logo-placeholder">?</div>'}
            <span class="team-name ${e2.win ? 'winner' : 'loser'}">${e2.equipo}</span>
            <span class="team-score ${e2.win ? 'winner' : 'loser'}">${e2.carreras}</span>
          </div>
        </div>
      </div>
    </div>`;
}

// ── RENDER: STANDINGS ──

function renderStandingGroup(group, highlightTeam) {
  const rows = group.equipos.map(eq => {
    const posClass = eq.position <= 3 ? ` p${eq.position}` : '';
    const pct = parseFloat(eq.points);
    const barW = Math.round(pct * 100);
    const img = logoUrl(eq.foto);
    const isHL = highlightTeam && eq.equipo === highlightTeam;
    return `
      <tr class="${isHL ? 'highlighted' : ''}" onclick="openEquipoByName('${eq.equipo.replace(/'/g, "\\'")}', '${eq.categoriaID}')">
        <td><span class="standing-pos${posClass}">${eq.position}</span></td>
        <td>
          <div class="standing-team">
            ${img ? `<img src="${img}" alt="" onerror="this.style.display='none'">` : ''}
            <span>${eq.equipo}</span>
          </div>
        </td>
        <td>${eq.wins}</td>
        <td>${eq.loses}</td>
        <td>
          <span class="standing-pct">${eq.points}</span>
          <div class="standing-bar"><div class="standing-bar-fill" style="width:${barW}%"></div></div>
        </td>
      </tr>`;
  }).join('');

  return `
    <div class="standing-group">
      <div class="standing-group-header">Grupo ${group.clasificacion} <span class="equipo-grupo-pill" style="margin-left:.5rem">${group.equipos.length} equipos</span></div>
      <table class="standing-table">
        <thead><tr><th>#</th><th>Equipo</th><th>G</th><th>P</th><th>PCT</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

// ── RENDER: NEWS ──

function renderNewsCard(n) {
  const img = logoUrl(n.imagen);
  const date = n.fecha_publicacion ? n.fecha_publicacion.split(' ')[0] : '';
  return `
    <div class="news-card">
      ${img ? `<img class="news-img" src="${img}" alt="" onerror="this.style.display='none'">` : ''}
      <div class="news-body">
        <div class="news-date">${formatFecha(date)}</div>
        <div class="news-title">${n.titulo}</div>
        <div class="news-summary">${(n.resumen || '').replace(/\n/g, '<br>')}</div>
      </div>
    </div>`;
}

// ── RENDER: CALENDARIO ──

function renderCalCard(j) {
  const isActive = j.Activo === '1';
  const jDate = new Date(j.Fecha + 'T12:00:00');
  const isPast = jDate < new Date() && !isActive;
  let cls = 'cal-card';
  if (isActive) cls += ' active';
  else if (isPast) cls += ' past';
  let badge = '';
  if (isActive) badge = '<span class="cal-badge live">ACTIVA</span>';
  else if (isPast) badge = '<span class="cal-badge done">JUGADA</span>';
  const selected = state.calendarExpandedJornada === j.JornadaID ? ' cal-selected' : '';
  return `
    <div class="${cls}${selected}" onclick="toggleCalGames('${j.JornadaID}')" style="cursor:pointer">
      <div class="cal-jornada">Jornada ${j.Jornada}</div>
      <div class="cal-fecha">${formatFechaLarga(j.Fecha)}</div>
      ${badge}
    </div>`;
}

// ── RENDER: CATEGORIAS ──

function renderCatCard(cat) {
  const { label, ages } = catShort(cat);
  return `
    <div class="cat-card" onclick="goToCategory(${cat.CategoriaID})">
      <div class="cat-ages">${ages} años</div>
      <div class="cat-name">${label}</div>
      <div class="cat-meta">${cat.IningsJugados} innings por juego</div>
    </div>`;
}

// ── RENDER: EQUIPO CARD ──

function renderEquipoCard(eq) {
  const img = logoUrl(eq.foto);
  const record = eq.wins != null ? `${eq.wins}-${eq.loses}` : '';
  const favId = localStorage.getItem('fav_team');
  const isFav = favId === eq.InscripcionID;
  return `
    <div class="equipo-card" onclick="openEquipoDetail('${eq.InscripcionID}')">
      ${img ? `<img src="${img}" alt="" onerror="this.src=''; this.style.display='none'">` : ''}
      <div class="equipo-card-info">
        <div class="equipo-card-name">${eq.teamName}</div>
        <div class="equipo-card-meta">
          ${eq.catLabel || ''} <span class="equipo-grupo-pill">${eq.grupo}</span>
        </div>
      </div>
      ${record ? `<div class="equipo-card-record">${record}</div>` : ''}
      <button class="fav-star ${isFav ? 'active' : ''}" onclick="event.stopPropagation();toggleFavTeam('${eq.InscripcionID}')" title="Equipo favorito">${isFav ? '⭐' : '☆'}</button>
    </div>`;
}

// ── NAVIGATION ──

function navigateTo(section) {
  state.currentSection = section;
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.getElementById(`sec-${section}`).classList.add('active');
  document.querySelectorAll('.nav-link').forEach(l => {
    l.classList.toggle('active', l.dataset.section === section);
  });
  document.getElementById('navLinks').classList.remove('open');
  window.scrollTo({ top: 0, behavior: 'smooth' });

  if (section === 'resultados') loadResultados();
  if (section === 'standings') loadStandings();
  if (section === 'noticias' && !document.getElementById('noticias-list').innerHTML) loadNoticias();
  if (section === 'calendario') renderCalendario();
  if (section === 'comparar') populateCompareSelects();
  if (section === 'lideres') loadLeaders();
  if (section === 'equipos') {
    document.getElementById('equipo-detail').style.display = 'none';
    document.getElementById('equipos-list').style.display = '';
    document.querySelector('#sec-equipos .search-box').style.display = '';
    document.querySelector('#sec-equipos .filters').style.display = '';
    filterEquipos();
  }
  if (section === 'coach') loadCoachSection();
}

function toggleMenu() {
  document.getElementById('navLinks').classList.toggle('open');
  document.querySelector('.nav-toggle').classList.toggle('open');
}

function toggleNavMore() {
  document.getElementById('navMoreMenu').classList.toggle('open');
}
function closeNavMore() {
  document.getElementById('navMoreMenu').classList.remove('open');
}
document.addEventListener('click', function(e) {
  const wrapper = document.querySelector('.nav-more-wrapper');
  if (wrapper && !wrapper.contains(e.target)) closeNavMore();
});

function goToCategory(catID) {
  document.getElementById('res-cat').value = catID;
  navigateTo('resultados');
}

// ── GRUPO PILL TABS ──

function buildGrupoTabs(containerId, grupos, currentGrupo, onClickFn) {
  const container = document.getElementById(containerId);
  let html = `<button class="pill ${currentGrupo === '' ? 'active' : ''}" onclick="${onClickFn}('')">Todos</button>`;
  grupos.forEach(g => {
    html += `<button class="pill ${currentGrupo === g ? 'active' : ''}" onclick="${onClickFn}('${g}')">${g}</button>`;
  });
  container.innerHTML = html;
}

// ── RESULTADOS ──

function setResGrupo(g) {
  state.resGrupo = g;
  buildGrupoTabs('res-grupo-tabs', getGruposForCat(document.getElementById('res-cat').value), g, 'setResGrupo');
  loadResultados();
}

function onResCatChange() {
  state.resGrupo = '';
  const catID = document.getElementById('res-cat').value;
  buildGrupoTabs('res-grupo-tabs', getGruposForCat(catID), '', 'setResGrupo');
  loadResultados();
}

function getGruposForCat(catID) {
  const key = `${state.temporada?.TemporadaID}_${catID}`;
  const cached = state.standingsCache[key];
  if (cached && cached.length > 0) {
    return cached.map(g => g.clasificacion).sort();
  }
  return ['A I', 'A II', 'A III'];
}

async function loadResultados() {
  const catID = document.getElementById('res-cat').value;
  const jornadaID = document.getElementById('res-jornada').value;
  if (!catID || !jornadaID) return;

  const container = document.getElementById('resultados-list');
  const empty = document.getElementById('resultados-empty');
  const dateEl = document.getElementById('resultados-fecha');

  container.innerHTML = '<div class="empty-state"><div class="spinner"></div></div>';
  empty.style.display = 'none';

  const jornada = state.jornadas.find(j => j.JornadaID === jornadaID);
  if (jornada) dateEl.textContent = formatFechaLarga(jornada.Fecha);

  let data = await fetchResultados(jornadaID, catID);

  if (state.resGrupo) {
    data = data.filter(g => {
      const ubi = g.ubicacion || '';
      return ubi.includes(state.resGrupo);
    });
  }

  if (data.length === 0) {
    container.innerHTML = '';
    empty.style.display = 'block';
  } else {
    container.innerHTML = data.map(g => renderGameCard(g)).join('');
    empty.style.display = 'none';
  }
}

function prevJornada() {
  const sel = document.getElementById('res-jornada');
  if (sel.selectedIndex > 0) { sel.selectedIndex--; loadResultados(); }
}
function nextJornada() {
  const sel = document.getElementById('res-jornada');
  if (sel.selectedIndex < sel.options.length - 1) { sel.selectedIndex++; loadResultados(); }
}

// ── STANDINGS ──

function setStandGrupo(g) {
  state.standGrupo = g;
  const catID = document.getElementById('stand-cat').value;
  buildGrupoTabs('stand-grupo-tabs', getGruposForCat(catID), g, 'setStandGrupo');
  loadStandings();
}

function onStandCatChange() {
  state.standGrupo = '';
  const catID = document.getElementById('stand-cat').value;
  buildGrupoTabs('stand-grupo-tabs', getGruposForCat(catID), '', 'setStandGrupo');
  loadStandings();
}

async function loadStandings() {
  const catID = document.getElementById('stand-cat').value;
  if (!catID || !state.temporada) return;

  const container = document.getElementById('standings-list');
  container.innerHTML = '<div class="empty-state"><div class="spinner"></div></div>';

  let data = await fetchStanding(state.temporada.TemporadaID, catID);

  const grupos = data.map(g => g.clasificacion).sort();
  buildGrupoTabs('stand-grupo-tabs', grupos, state.standGrupo, 'setStandGrupo');

  if (state.standGrupo) {
    data = data.filter(g => g.clasificacion === state.standGrupo);
  }

  if (data.length === 0) {
    container.innerHTML = '<div class="empty-state"><div class="empty-icon">&#9918;</div><p>Sin datos de posiciones</p></div>';
  } else {
    container.innerHTML = data.map(g => renderStandingGroup(g)).join('');
  }
}

// ── EQUIPOS ──

function setEqGrupo(g) {
  state.eqGrupoFilter = g;
  document.querySelectorAll('#eq-grupo-tabs .pill').forEach(p => {
    p.classList.toggle('active', p.dataset.grupo === g);
  });
  filterEquipos();
}

function filterEquipos() {
  const search = (document.getElementById('equipo-search').value || '').toUpperCase().trim();
  const catFilter = document.getElementById('eq-cat-filter').value;
  const grupoFilter = state.eqGrupoFilter;

  let list = state.equiposEnriched;

  if (search) {
    list = list.filter(e => e.teamName.toUpperCase().includes(search));
  }
  if (catFilter) {
    list = list.filter(e => e.categoriaID === catFilter);
  }
  if (grupoFilter) {
    list = list.filter(e => e.grupo === grupoFilter);
  }

  const container = document.getElementById('equipos-list');
  if (list.length === 0) {
    container.innerHTML = '<div class="empty-state"><p>No se encontraron equipos</p></div>';
  } else {
    container.innerHTML = list.map(renderEquipoCard).join('');
  }
}

async function enrichEquipos() {
  const enriched = [];

  for (const cat of state.categorias) {
    if (cat.CategoriaID === '1') continue;
    const standing = await fetchStanding(state.temporada.TemporadaID, cat.CategoriaID);
    for (const group of standing) {
      for (const eq of group.equipos) {
        const teamUpper = eq.equipo.toUpperCase();
        const catNombre = cat.Categoria.toUpperCase();
        const grupoClasif = group.clasificacion.toUpperCase();

        const fullEntry = state.equipos.find(e => {
          const full = e.Equipo.toUpperCase();
          return full.includes(teamUpper)
            && full.includes(catNombre)
            && full.includes(grupoClasif);
        }) || state.equipos.find(e => {
          const full = e.Equipo.toUpperCase();
          return full.includes(teamUpper) && full.includes(catNombre);
        }) || state.equipos.find(e => {
          return e.Equipo.toUpperCase().includes(teamUpper);
        });

        enriched.push({
          InscripcionID: fullEntry ? fullEntry.InscripcionID : eq.equipo,
          teamName: eq.equipo,
          fullName: fullEntry ? fullEntry.Equipo : eq.equipo,
          foto: eq.foto,
          wins: eq.wins,
          loses: eq.loses,
          points: eq.points,
          position: eq.position,
          grupo: group.clasificacion,
          categoriaID: cat.CategoriaID,
          catLabel: catShort(cat).label + ' ' + catShort(cat).ages,
          categoria: cat,
        });
      }
    }
  }

  enriched.sort((a, b) => a.teamName.localeCompare(b.teamName));
  state.equiposEnriched = enriched;
}

async function openEquipoDetail(inscripcionID) {
  const eq = state.equiposEnriched.find(e => e.InscripcionID === inscripcionID);
  if (!eq) return;
  state.currentEquipo = eq;

  document.getElementById('equipos-list').style.display = 'none';
  document.querySelector('#sec-equipos .search-box').style.display = 'none';
  document.querySelector('#sec-equipos .filters').style.display = 'none';
  const detail = document.getElementById('equipo-detail');
  detail.style.display = 'block';

  const img = logoUrl(eq.foto);
  const pct = eq.points || '0.000';

  document.getElementById('equipo-header-card').innerHTML = `
    ${img ? `<img class="equipo-detail-logo" src="${img}" alt="" onerror="this.style.display='none'">` : ''}
    <div class="equipo-detail-info">
      <div class="equipo-detail-name">${eq.teamName}</div>
      <div class="equipo-detail-meta">
        ${eq.catLabel} &middot; <span class="equipo-grupo-pill">${eq.grupo}</span>
      </div>
    </div>
    <div class="equipo-detail-stats">
      <div class="equipo-stat">
        <div class="equipo-stat-val win-color">${eq.wins}</div>
        <div class="equipo-stat-label">Ganados</div>
      </div>
      <div class="equipo-stat">
        <div class="equipo-stat-val lose-color">${eq.loses}</div>
        <div class="equipo-stat-label">Perdidos</div>
      </div>
      <div class="equipo-stat">
        <div class="equipo-stat-val pct-color">${pct}</div>
        <div class="equipo-stat-label">PCT</div>
      </div>
    </div>
  `;

  // roster de jugadores + bateo
  const rosterContainer = document.getElementById('equipo-roster');
  rosterContainer.innerHTML = '<div class="empty-state"><div class="inline-spinner"></div> Cargando jugadores y estadísticas...</div>';
  document.getElementById('btn-descargar').style.display = 'none';
  Promise.all([
    fetchJugadores(eq.InscripcionID),
    fetchBateo(eq.InscripcionID),
    fetchPitcheo(eq.InscripcionID)
  ]).then(([data, bateo, pitcheo]) => {
    if (data && data.jugadores) {
      eq._jugadores = data.jugadores;
      eq._bateo = bateo || [];
      eq._pitcheo = pitcheo || [];
      rosterContainer.innerHTML = renderRosterTabs(data.jugadores, bateo, pitcheo);
      document.getElementById('btn-descargar').style.display = '';
      renderEquipoCharts(data.jugadores, bateo);
      state.playerCache[eq.InscripcionID] = {
        jugadores: data.jugadores,
        bateo: bateo || [],
        pitcheo: pitcheo || []
      };
    } else {
      rosterContainer.innerHTML = '<div class="empty-state"><p>No se pudieron cargar los jugadores</p></div>';
    }
  }).catch(() => {
    rosterContainer.innerHTML = '<div class="empty-state"><p>Error al cargar jugadores</p></div>';
  });

  // standing del grupo
  const standData = await fetchStanding(state.temporada.TemporadaID, eq.categoriaID);
  const grupo = standData.find(g => g.clasificacion === eq.grupo);
  if (grupo) {
    document.getElementById('equipo-standing').innerHTML = renderStandingGroup(grupo, eq.teamName);
  } else {
    document.getElementById('equipo-standing').innerHTML = '';
  }

  // resultados de todas las jornadas
  const resContainer = document.getElementById('equipo-resultados');
  resContainer.innerHTML = '<div class="empty-state"><div class="inline-spinner"></div> Cargando resultados...</div>';

  const allGames = [];
  const promises = state.jornadas.map(async (j) => {
    const data = await fetchResultados(j.JornadaID, eq.categoriaID);
    const teamGames = data.filter(g =>
      g.equipo_1.equipo === eq.teamName || g.equipo_2.equipo === eq.teamName
    );
    teamGames.forEach(g => { g._jornada = j.Jornada; g._fecha = j.Fecha; });
    return teamGames;
  });

  const results = await Promise.all(promises);
  results.forEach(games => allGames.push(...games));
  allGames.sort((a, b) => parseInt(a._jornada) - parseInt(b._jornada));

  if (allGames.length === 0) {
    resContainer.innerHTML = '<div class="empty-state"><p>No se encontraron juegos</p></div>';
  } else {
    resContainer.innerHTML = allGames.map(g => {
      g.ubicacion = `Jornada ${g._jornada} — ${formatFecha(g._fecha)}`;
      return renderGameCard(g, eq.teamName);
    }).join('');
  }

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function openEquipoByName(teamName, catID) {
  const eq = state.equiposEnriched.find(e =>
    e.teamName === teamName && e.categoriaID === catID
  );
  if (eq) {
    navigateTo('equipos');
    openEquipoDetail(eq.InscripcionID);
  }
}

function closeEquipoDetail() {
  document.getElementById('equipo-detail').style.display = 'none';
  document.getElementById('equipos-list').style.display = '';
  document.querySelector('#sec-equipos .search-box').style.display = '';
  document.querySelector('#sec-equipos .filters').style.display = '';
  state.currentEquipo = null;
}

// ── NOTICIAS ──

async function loadNoticias() {
  const container = document.getElementById('noticias-list');
  container.innerHTML = '<div class="empty-state"><div class="spinner"></div></div>';
  const data = await fetchNoticias();
  container.innerHTML = data.length === 0
    ? '<div class="empty-state"><p>No hay noticias</p></div>'
    : data.map(renderNewsCard).join('');
}

// ── CALENDARIO ──

function renderCalendario() {
  document.getElementById('calendario-list').innerHTML = state.jornadas.map(renderCalCard).join('');
  if (state.calendarExpandedJornada) {
    document.getElementById('calendario-games-panel').style.display = '';
  }
}

// ── CALENDAR GAMES ──

async function toggleCalGames(jornadaID) {
  const panel = document.getElementById('calendario-games-panel');
  const listEl = document.getElementById('cal-games-list');
  const titleEl = document.getElementById('cal-games-title');

  if (state.calendarExpandedJornada === jornadaID) {
    panel.style.display = 'none';
    state.calendarExpandedJornada = null;
    document.querySelectorAll('.cal-card').forEach(c => c.classList.remove('cal-selected'));
    return;
  }

  state.calendarExpandedJornada = jornadaID;
  document.querySelectorAll('.cal-card').forEach(c => c.classList.remove('cal-selected'));
  event.currentTarget.classList.add('cal-selected');

  const jornada = state.jornadas.find(j => j.JornadaID === jornadaID);
  titleEl.textContent = `Juegos — Jornada ${jornada ? jornada.Jornada : ''}`;

  panel.style.display = '';
  listEl.innerHTML = '<div class="empty-state"><div class="spinner"></div></div>';

  const allGames = [];
  const cats = state.categorias.filter(c => c.CategoriaID !== '1');
  const promises = cats.map(async cat => {
    const games = await fetchResultados(jornadaID, cat.CategoriaID);
    games.forEach(g => {
      g.ubicacion = catShort(cat).label + ' ' + catShort(cat).ages + (g.ubicacion ? ' · ' + g.ubicacion : '');
    });
    return games;
  });
  const results = await Promise.all(promises);
  results.forEach(games => allGames.push(...games));

  if (allGames.length === 0) {
    listEl.innerHTML = '<div class="empty-state"><div class="empty-icon">⚾</div><p>No hay juegos registrados para esta jornada</p></div>';
  } else {
    listEl.innerHTML = allGames.map(g => renderGameCard(g)).join('');
  }

  panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function closeCalGames() {
  document.getElementById('calendario-games-panel').style.display = 'none';
  state.calendarExpandedJornada = null;
  document.querySelectorAll('.cal-card').forEach(c => c.classList.remove('cal-selected'));
}

// ── PLAYER SEARCH ──

let jugadorSearchTimeout = null;

function searchJugadores() {
  clearTimeout(jugadorSearchTimeout);
  jugadorSearchTimeout = setTimeout(doSearchJugadores, 350);
}

async function doSearchJugadores() {
  const query = (document.getElementById('jugador-search').value || '').trim();
  const resultsEl = document.getElementById('jugadores-results');
  const loadingEl = document.getElementById('jugadores-loading');

  if (query.length < 3) {
    resultsEl.innerHTML = query.length > 0
      ? '<div class="empty-state"><p>Escribe al menos 3 caracteres para buscar</p></div>'
      : '';
    loadingEl.style.display = 'none';
    return;
  }

  loadingEl.style.display = '';

  if (!state.playerCacheAll) {
    await loadAllPlayers();
  }

  loadingEl.style.display = 'none';

  const queryUp = query.toUpperCase();
  const results = [];

  for (const eq of state.equiposEnriched) {
    const cached = state.playerCache[eq.InscripcionID];
    if (!cached) continue;
    const bateoMap = {};
    (cached.bateo || []).forEach(b => { b.SLG = calcSLG(b); bateoMap[b.JugadorID] = b; });

    for (const j of cached.jugadores) {
      if (j.nombre.toUpperCase().includes(queryUp)) {
        results.push({ jugador: j, equipo: eq, stats: bateoMap[j.JugadorID] || {} });
      }
    }
  }

  renderPlayerResults(results, resultsEl);
}

async function loadAllPlayers(progressElId) {
  if (state.playerCacheAll) return;
  const loadingEl = document.getElementById(progressElId || 'jugadores-loading');
  const uncached = state.equiposEnriched.filter(eq => !state.playerCache[eq.InscripcionID]);

  for (let i = 0; i < uncached.length; i += 5) {
    const batch = uncached.slice(i, i + 5);
    await Promise.all(batch.map(async eq => {
      if (state.playerCache[eq.InscripcionID]) return;
      try {
        const [data, bateo] = await Promise.all([
          fetchJugadores(eq.InscripcionID),
          fetchBateo(eq.InscripcionID)
        ]);
        state.playerCache[eq.InscripcionID] = {
          jugadores: data ? (data.jugadores || []) : [],
          bateo: bateo || []
        };
      } catch (e) {
        state.playerCache[eq.InscripcionID] = { jugadores: [], bateo: [] };
      }
    }));

    if (loadingEl) {
      const loaded = Object.keys(state.playerCache).length;
      const total = state.equiposEnriched.length;
      loadingEl.innerHTML = `<div class="inline-spinner"></div> Cargando datos de equipos... ${loaded}/${total}`;
    }
  }

  state.playerCacheAll = true;
}

function renderPlayerResults(results, container) {
  if (results.length === 0) {
    container.innerHTML = '<div class="empty-state"><div class="empty-icon">🔍</div><p>No se encontraron jugadores</p></div>';
    return;
  }

  const rows = results.slice(0, 150).map(r => {
    const edad = calcularEdad(r.jugador.FechaNacimiento);
    const s = r.stats || {};
    const hasSt = !!s.PCT;
    const cardBtn = hasSt ? `<button class="btn-ver-tarjeta" onclick="event.stopPropagation();openBaseballCardSearch('${r.jugador.JugadorID}','${(r.jugador.nombre||'').replace(/'/g,"\\'")}',${edad||0},'${r.equipo.InscripcionID}')">🃏</button>` : '';
    return `
      <tr onclick="openEquipoByName('${r.equipo.teamName.replace(/'/g, "\\'")}', '${r.equipo.categoriaID}')" style="cursor:pointer">
        <td class="jugador-nombre">${r.jugador.nombre} ${cardBtn}</td>
        <td>${r.equipo.foto ? '<img class="roster-team-logo" src="' + logoUrl(r.equipo.foto) + '" onerror="this.style.display=\'none\'" alt="">' : ''}${r.equipo.teamName}</td>
        <td><span class="equipo-grupo-pill">${r.equipo.catLabel}</span></td>
        <td class="jugador-edad">${edad ? edad + ' años' : ''}</td>
        <td class="jugador-stat">${s.PCT || '-'}</td>
        <td class="jugador-stat">${s.SLG || '-'}</td>
        <td class="jugador-stat">${s.H || '-'}</td>
        <td class="jugador-stat">${s.HR || '-'}</td>
      </tr>`;
  }).join('');

  container.innerHTML = `
    <div class="roster-card">
      <table class="roster-table">
        <thead><tr>
          <th>Jugador</th><th>Equipo</th><th>Categoría</th><th>Edad</th>
          <th class="stat-col">AVG</th><th class="stat-col">SLG</th><th class="stat-col">H</th><th class="stat-col">HR</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="roster-count">${results.length} jugadores encontrados${results.length > 150 ? ' (mostrando primeros 150)' : ''}</div>
    </div>`;
}

// ── CSV / EXCEL EXPORT ──

function downloadCSV(csv, filename) {
  const BOM = '\uFEFF';
  const blob = new Blob([BOM + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function exportEquipoCSV() {
  const eq = state.currentEquipo;
  if (!eq || !eq._jugadores) return;

  const bateoMap = {};
  (eq._bateo || []).forEach(b => { b.SLG = calcSLG(b); bateoMap[b.JugadorID] = b; });

  let csv = '#,Nombre,Edad,AVG,SLG,BR,H1,H2,H3,HR\n';
  eq._jugadores.forEach((j, i) => {
    const edad = calcularEdad(j.FechaNacimiento) || '';
    const s = bateoMap[j.JugadorID] || {};
    const nombre = j.nombre.replace(/"/g, '""');
    csv += `${i + 1},"${nombre}",${edad},${s.PCT || ''},${s.SLG || ''},${s.R || ''},${s.H || ''},${s.H2 || ''},${s.H3 || ''},${s.HR || ''}\n`;
  });

  const safeName = eq.teamName.replace(/[^a-zA-Z0-9áéíóúñÁÉÍÓÚÑ ]/g, '').trim();
  downloadCSV(csv, `${safeName}_roster.csv`);
}

function exportStandingsCSV() {
  const catID = document.getElementById('stand-cat').value;
  if (!catID || !state.temporada) return;

  const key = `${state.temporada.TemporadaID}_${catID}`;
  const data = state.standingsCache[key];
  if (!data || data.length === 0) {
    alert('Primero carga las posiciones de una categoría');
    return;
  }

  const cat = state.categorias.find(c => c.CategoriaID === catID);
  let csv = 'Posición,Equipo,Grupo,Ganados,Perdidos,PCT\n';

  for (const group of data) {
    for (const eq of group.equipos) {
      const nombre = eq.equipo.replace(/"/g, '""');
      csv += `${eq.position},"${nombre}",${group.clasificacion},${eq.wins},${eq.loses},${eq.points}\n`;
    }
  }

  const safeName = cat ? catShort(cat).label.replace(/[^a-zA-Z0-9áéíóúñÁÉÍÓÚÑ ]/g, '').trim() : 'Posiciones';
  downloadCSV(csv, `Posiciones_${safeName}.csv`);
}

// ── POPULATE SELECTS ──

function populateSelects() {
  const resCat = document.getElementById('res-cat');
  const standCat = document.getElementById('stand-cat');
  const resJornada = document.getElementById('res-jornada');
  const eqCat = document.getElementById('eq-cat-filter');

  const cats = state.categorias.filter(c => c.CategoriaID !== '1');
  const catOpts = cats.map(c =>
    `<option value="${c.CategoriaID}">${catShort(c).label} (${c.EdadMinima}-${c.EdadMaxima})</option>`
  ).join('');

  resCat.innerHTML = catOpts;
  standCat.innerHTML = catOpts;
  eqCat.innerHTML = '<option value="">Todas</option>' + catOpts;

  const jorOpts = state.jornadas.map(j =>
    `<option value="${j.JornadaID}" ${j.Activo === '1' ? 'selected' : ''}>J${j.Jornada} — ${formatFecha(j.Fecha)}</option>`
  ).join('');
  resJornada.innerHTML = jorOpts;

  buildGrupoTabs('res-grupo-tabs', ['A I', 'A II', 'A III'], '', 'setResGrupo');
  buildGrupoTabs('stand-grupo-tabs', ['A I', 'A II', 'A III'], '', 'setStandGrupo');
}

// ── INICIO ──

async function loadInicio() {
  document.getElementById('categorias-grid').innerHTML = state.categorias.map(renderCatCard).join('');

  if (state.jornadaActual) {
    const firstCat = state.categorias.find(c => c.CategoriaID !== '1');
    if (firstCat) {
      const data = await fetchResultados(state.jornadaActual.JornadaID, firstCat.CategoriaID);
      document.getElementById('inicio-resultados').innerHTML = data.length > 0
        ? data.slice(0, 4).map(g => renderGameCard(g)).join('')
        : '<div class="empty-state"><p>No hay resultados recientes</p></div>';
    }
  }

  const noticias = await fetchNoticias();
  document.getElementById('inicio-noticias').innerHTML = noticias.length > 0
    ? noticias.slice(0, 3).map(renderNewsCard).join('')
    : '';
}

// ── INIT ──

async function init() {
  const loading = document.getElementById('loading');
  try {
    const [categorias, temporada, jornadas, jornadaActual] = await Promise.all([
      fetchCategorias(), fetchTemporada(), fetchJornadas(), fetchJornadaActual()
    ]);

    state.categorias = categorias;
    state.temporada = temporada;
    state.jornadas = jornadas;
    state.jornadaActual = jornadaActual;

    if (temporada) {
      document.getElementById('nav-temporada').textContent = temporada.Temporada;
      document.getElementById('hero-badge').textContent = temporada.Temporada;
      const totalJ = jornadas.length;
      document.getElementById('hero-season-info').textContent =
        `${temporada.Temporada} · ${totalJ} jornadas · Temporada finalizada`;
    }

    populateSelects();

    const [equipos] = await Promise.all([
      fetchEquipos(temporada.TemporadaID),
      loadInicio()
    ]);
    state.equipos = equipos;

    await enrichEquipos();
    loadUserProfile();
    renderFavTeamBanner();
    updateCoachNavVisibility();
  } catch (err) {
    console.error('Init error:', err);
  } finally {
    loading.classList.add('hidden');
  }
}

// ── THEME TOGGLE ──

function toggleTheme() {
  const isLight = document.body.classList.toggle('light-theme');
  document.getElementById('themeToggle').textContent = isLight ? '☀️' : '🌙';
  localStorage.setItem('tarjeton-theme', isLight ? 'light' : 'dark');
}

function loadTheme() {
  const saved = localStorage.getItem('tarjeton-theme');
  if (saved === 'light') {
    document.body.classList.add('light-theme');
    const btn = document.getElementById('themeToggle');
    if (btn) btn.textContent = '☀️';
  }
}

// ── OFFLINE STATUS ──

function updateOnlineStatus() {
  const el = document.getElementById('offlineIndicator');
  if (el) el.style.display = navigator.onLine ? 'none' : 'inline-block';
}

// ── COMPARE TEAMS ──

function populateCompareSelects() {
  if (state.equiposEnriched.length === 0) {
    document.getElementById('compare-results').innerHTML =
      '<div class="empty-state"><div class="inline-spinner"></div> Cargando equipos, intenta de nuevo en unos segundos...</div>';
    return;
  }
  const opts = state.equiposEnriched.map(eq =>
    `<option value="${eq.InscripcionID}">${eq.teamName} (${eq.catLabel})</option>`
  ).join('');
  document.getElementById('compare-team-a').innerHTML = opts;
  document.getElementById('compare-team-b').innerHTML = opts;
  const selB = document.getElementById('compare-team-b');
  if (selB.options.length > 1) selB.selectedIndex = 1;
}

async function compareTeams() {
  const idA = document.getElementById('compare-team-a').value;
  const idB = document.getElementById('compare-team-b').value;
  if (!idA || !idB) return;
  const eqA = state.equiposEnriched.find(e => String(e.InscripcionID) === String(idA));
  const eqB = state.equiposEnriched.find(e => String(e.InscripcionID) === String(idB));
  if (!eqA || !eqB) return;

  const container = document.getElementById('compare-results');
  container.innerHTML = '<div class="empty-state"><div class="inline-spinner"></div> Cargando estadísticas...</div>';

  const [bateoA, bateoB] = await Promise.all([
    fetchBateo(eqA.InscripcionID),
    fetchBateo(eqB.InscripcionID)
  ]);

  function calcTeamStats(bateo) {
    if (!bateo || bateo.length === 0) return { AVG: 0, HR: 0, H: 0, R: 0, SLG: 0 };
    let tAVG = 0, tHR = 0, tH = 0, tR = 0, tSLG = 0, n = 0;
    bateo.forEach(b => {
      tAVG += parseFloat(b.PCT) || 0;
      tHR += parseInt(b.HR) || 0;
      tH += parseInt(b.H) || 0;
      tR += parseInt(b.R) || 0;
      b.SLG = calcSLG(b);
      tSLG += parseFloat(b.SLG) || 0;
      n++;
    });
    return { AVG: n ? tAVG / n : 0, HR: tHR, H: tH, R: tR, SLG: n ? tSLG / n : 0 };
  }

  const sA = calcTeamStats(bateoA);
  const sB = calcTeamStats(bateoB);
  const imgA = logoUrl(eqA.foto);
  const imgB = logoUrl(eqB.foto);

  const stats = [
    { label: 'AVG', a: sA.AVG, b: sB.AVG, fmt: v => v.toFixed(3) },
    { label: 'SLG', a: sA.SLG, b: sB.SLG, fmt: v => v.toFixed(3) },
    { label: 'HR', a: sA.HR, b: sB.HR, fmt: v => v },
    { label: 'Hits', a: sA.H, b: sB.H, fmt: v => v },
    { label: 'Carreras', a: sA.R, b: sB.R, fmt: v => v },
  ];

  const bars = stats.map(s => {
    const mx = Math.max(s.a, s.b, 0.001);
    const wA = Math.round((s.a / mx) * 100);
    const wB = Math.round((s.b / mx) * 100);
    return `
      <div class="compare-stat-row">
        <div class="compare-bar-wrap"><div class="compare-bar-a" style="width:${wA}%">${s.fmt(s.a)}</div></div>
        <div class="compare-stat-label">${s.label}</div>
        <div class="compare-bar-wrap"><div class="compare-bar-b" style="width:${wB}%">${s.fmt(s.b)}</div></div>
      </div>`;
  }).join('');

  container.innerHTML = `
    <div class="compare-cards">
      <div class="compare-card">
        ${imgA ? `<img src="${imgA}" onerror="this.style.display='none'" alt="">` : ''}
        <div class="compare-card-name">${eqA.teamName}</div>
        <div class="compare-card-record">${eqA.wins}G - ${eqA.loses}P &middot; ${eqA.catLabel}</div>
        <div class="compare-card-pct">${eqA.points}</div>
      </div>
      <div class="compare-card">
        ${imgB ? `<img src="${imgB}" onerror="this.style.display='none'" alt="">` : ''}
        <div class="compare-card-name">${eqB.teamName}</div>
        <div class="compare-card-record">${eqB.wins}G - ${eqB.loses}P &middot; ${eqB.catLabel}</div>
        <div class="compare-card-pct">${eqB.points}</div>
      </div>
    </div>
    <div class="section-header"><h2>Comparación de Estadísticas</h2></div>
    <div style="display:flex;gap:1.5rem;margin-bottom:1rem;font-size:.8rem;">
      <span style="color:var(--primary);font-weight:700;">■ ${eqA.teamName}</span>
      <span style="color:var(--accent);font-weight:700;">■ ${eqB.teamName}</span>
    </div>
    ${bars}
  `;
}

// ── LEAGUE LEADERS ──

let leadersComputed = {};

async function loadLeaders() {
  const loadingEl = document.getElementById('lideres-loading');
  const resultsEl = document.getElementById('lideres-results');

  if (Object.keys(leadersComputed).length > 0) {
    renderLeaderTable(state.currentLeaderTab || 'AVG');
    return;
  }

  if (state.equiposEnriched.length === 0) {
    resultsEl.innerHTML = '<div class="empty-state"><div class="inline-spinner"></div> Cargando equipos, intenta de nuevo en unos segundos...</div>';
    return;
  }

  loadingEl.style.display = '';
  resultsEl.innerHTML = '';

  if (!state.playerCacheAll) {
    await loadAllPlayers('lideres-loading');
  }

  loadingEl.style.display = 'none';

  const allPlayers = [];
  for (const eq of state.equiposEnriched) {
    const cached = state.playerCache[eq.InscripcionID];
    if (!cached) continue;
    const bateoMap = {};
    (cached.bateo || []).forEach(b => { b.SLG = calcSLG(b); bateoMap[b.JugadorID] = b; });
    for (const j of cached.jugadores) {
      const stats = bateoMap[j.JugadorID];
      if (stats) allPlayers.push({ jugador: j, equipo: eq, stats });
    }
  }

  const categories = {
    AVG: { key: 'PCT', parse: v => parseFloat(v) || 0, fmt: v => parseFloat(v).toFixed(3) },
    HR:  { key: 'HR',  parse: v => parseInt(v) || 0,   fmt: v => v },
    H:   { key: 'H',   parse: v => parseInt(v) || 0,   fmt: v => v },
    R:   { key: 'R',   parse: v => parseInt(v) || 0,   fmt: v => v },
    SLG: { key: 'SLG', parse: v => parseFloat(v) || 0, fmt: v => parseFloat(v).toFixed(3) },
  };

  for (const [cat, cfg] of Object.entries(categories)) {
    const sorted = [...allPlayers].sort((a, b) =>
      cfg.parse(b.stats[cfg.key]) - cfg.parse(a.stats[cfg.key])
    );
    leadersComputed[cat] = sorted.slice(0, 10).map((p, i) => ({
      rank: i + 1,
      name: p.jugador.nombre,
      team: p.equipo.teamName,
      catLabel: p.equipo.catLabel,
      foto: p.equipo.foto,
      categoriaID: p.equipo.categoriaID,
      value: cfg.fmt(cfg.parse(p.stats[cfg.key]))
    }));
  }

  renderLeaderTable(state.currentLeaderTab || 'AVG');
}

function switchLeaderTab(tab) {
  state.currentLeaderTab = tab;
  document.querySelectorAll('.leader-tabs .pill').forEach(p => {
    p.classList.toggle('active', p.dataset.stat === tab);
  });
  if (Object.keys(leadersComputed).length > 0) {
    renderLeaderTable(tab);
  }
}

function renderLeaderTable(tab) {
  const data = leadersComputed[tab];
  const container = document.getElementById('lideres-results');
  if (!data || data.length === 0) {
    container.innerHTML = '<div class="empty-state"><div class="empty-icon">🏆</div><p>No hay datos disponibles</p></div>';
    return;
  }
  const rows = data.map(p => {
    const rc = p.rank <= 3 ? ` r${p.rank}` : '';
    const img = logoUrl(p.foto);
    return `
      <div class="leader-row" onclick="openEquipoByName('${p.team.replace(/'/g, "\\'")}', '${p.categoriaID}')">
        <div class="leader-rank${rc}">${p.rank}</div>
        ${img ? `<img class="leader-logo" src="${img}" onerror="this.style.display='none'" alt="">` : ''}
        <div class="leader-info">
          <div class="leader-name">${p.name}</div>
          <div class="leader-team">${p.team} &middot; ${p.catLabel}</div>
        </div>
        <div class="leader-stat">${p.value}</div>
      </div>`;
  }).join('');
  container.innerHTML = `<div class="leader-table-container">${rows}</div>`;
}

// ── VISUAL CHARTS ──

function renderEquipoCharts(jugadores, bateo) {
  const container = document.getElementById('equipo-charts');
  if (!container) return;
  const eq = state.currentEquipo;
  if (!eq || !jugadores || jugadores.length === 0) { container.innerHTML = ''; return; }

  const bateoMap = {};
  (bateo || []).forEach(b => { b.SLG = calcSLG(b); bateoMap[b.JugadorID] = b; });

  const batters = jugadores
    .map(j => ({ name: j.nombre, avg: parseFloat((bateoMap[j.JugadorID] || {}).PCT) || 0 }))
    .filter(b => b.avg > 0)
    .sort((a, b) => b.avg - a.avg)
    .slice(0, 5);

  const maxAVG = batters.length > 0 ? Math.max(...batters.map(b => b.avg)) : 1;

  const barRows = batters.map(b => {
    const w = Math.round((b.avg / maxAVG) * 100);
    const parts = b.name.split(' ');
    const shortName = parts.length > 2 ? parts.slice(-2).join(' ') : b.name;
    return `
      <div class="bar-chart-row">
        <div class="bar-chart-label" title="${b.name}">${shortName}</div>
        <div class="bar-chart-bar">
          <div class="bar-chart-fill" style="width:${w}%">${b.avg.toFixed(3)}</div>
        </div>
      </div>`;
  }).join('');

  const wins = parseInt(eq.wins) || 0;
  const loses = parseInt(eq.loses) || 0;
  const total = wins + loses;
  const winPct = total > 0 ? (wins / total * 100) : 0;

  const avgVals = batters.map(b => b.avg);
  const teamAVG = avgVals.length > 0 ? avgVals.reduce((s, v) => s + v, 0) / avgVals.length : 0;
  const avgPct = Math.min(teamAVG / 0.5 * 100, 100);

  container.innerHTML = `
    <div class="section-header"><h2>Estadísticas Visuales</h2></div>
    <div class="charts-section">
      <div class="chart-card">
        <div class="chart-title">Top 5 Bateadores (AVG)</div>
        ${barRows || '<div class="empty-state" style="padding:1rem"><p>Sin datos de bateo</p></div>'}
      </div>
      <div class="chart-card">
        <div class="chart-title">Resumen del Equipo</div>
        <div class="circular-progress-container">
          <div class="circular-progress" style="background:conic-gradient(var(--primary) ${winPct * 3.6}deg, var(--bg-surface) ${winPct * 3.6}deg)">
            <div class="circular-progress-inner">
              <div class="circular-progress-value" style="color:var(--primary)">${winPct.toFixed(0)}%</div>
              <div class="circular-progress-label">Victorias</div>
            </div>
          </div>
          <div class="circular-progress" style="background:conic-gradient(var(--accent) ${avgPct * 3.6}deg, var(--bg-surface) ${avgPct * 3.6}deg)">
            <div class="circular-progress-inner">
              <div class="circular-progress-value" style="color:var(--accent)">${teamAVG.toFixed(3)}</div>
              <div class="circular-progress-label">AVG Equipo</div>
            </div>
          </div>
        </div>
      </div>
    </div>`;
}

// ── FEATURE 1: PWA INSTALL ──

let deferredPrompt = null;

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  const btn = document.getElementById('installBtn');
  if (btn) btn.style.display = '';
});

function installApp() {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  deferredPrompt.userChoice.then(choice => {
    if (choice.outcome === 'accepted') {
      const btn = document.getElementById('installBtn');
      if (btn) btn.style.display = 'none';
    }
    deferredPrompt = null;
  });
}

window.addEventListener('appinstalled', () => {
  const btn = document.getElementById('installBtn');
  if (btn) btn.style.display = 'none';
  deferredPrompt = null;
});

// ── FEATURE 2: PREDICTION SYSTEM ──

function populatePredictionSelects() {
  if (state.equiposEnriched.length === 0) {
    document.getElementById('prediction-results').innerHTML =
      '<div class="empty-state"><div class="inline-spinner"></div> Cargando equipos, intenta de nuevo en unos segundos...</div>';
    return;
  }
  const opts = state.equiposEnriched.map(eq =>
    `<option value="${eq.InscripcionID}">${eq.teamName} (${eq.catLabel})</option>`
  ).join('');
  document.getElementById('pred-team-a').innerHTML = opts;
  document.getElementById('pred-team-b').innerHTML = opts;
  const selB = document.getElementById('pred-team-b');
  if (selB.options.length > 1) selB.selectedIndex = 1;
}

async function runPrediction() {
  const idA = document.getElementById('pred-team-a').value;
  const idB = document.getElementById('pred-team-b').value;
  if (!idA || !idB) return;
  if (idA === idB) {
    document.getElementById('prediction-results').innerHTML =
      '<div class="empty-state"><p>Selecciona dos equipos diferentes</p></div>';
    return;
  }

  const eqA = state.equiposEnriched.find(e => String(e.InscripcionID) === String(idA));
  const eqB = state.equiposEnriched.find(e => String(e.InscripcionID) === String(idB));
  if (!eqA || !eqB) return;

  const loadingEl = document.getElementById('prediction-loading');
  const resultsEl = document.getElementById('prediction-results');
  loadingEl.style.display = '';
  resultsEl.innerHTML = '';

  let bateoA = [], bateoB = [];
  const cachedA = state.playerCache[eqA.InscripcionID];
  const cachedB = state.playerCache[eqB.InscripcionID];

  if (cachedA && cachedB) {
    bateoA = cachedA.bateo || [];
    bateoB = cachedB.bateo || [];
  } else {
    const [bA, bB] = await Promise.all([
      cachedA ? Promise.resolve(cachedA.bateo || []) : fetchBateo(eqA.InscripcionID),
      cachedB ? Promise.resolve(cachedB.bateo || []) : fetchBateo(eqB.InscripcionID)
    ]);
    bateoA = bA; bateoB = bB;
  }

  function teamAVG(bateo) {
    if (!bateo || bateo.length === 0) return 0;
    let total = 0, n = 0;
    bateo.forEach(b => { const v = parseFloat(b.PCT) || 0; if (v > 0) { total += v; n++; } });
    return n > 0 ? total / n : 0;
  }

  const winsA = parseInt(eqA.wins) || 0, losesA = parseInt(eqA.loses) || 0;
  const winsB = parseInt(eqB.wins) || 0, losesB = parseInt(eqB.loses) || 0;
  const totalA = winsA + losesA, totalB = winsB + losesB;
  const winPctA = totalA > 0 ? winsA / totalA : 0.5;
  const winPctB = totalB > 0 ? winsB / totalB : 0.5;
  const avgA = teamAVG(bateoA);
  const avgB = teamAVG(bateoB);

  const factors = [];
  let scoreA = 0, scoreB = 0;
  let dataPoints = 0;

  if (totalA > 0 || totalB > 0) {
    scoreA += winPctA * 50;
    scoreB += winPctB * 50;
    dataPoints++;
    if (winPctA > winPctB) {
      factors.push({ icon: 'green', text: `${eqA.teamName} tiene mejor récord (${winsA}-${losesA} vs ${winsB}-${losesB})` });
    } else if (winPctB > winPctA) {
      factors.push({ icon: 'amber', text: `${eqB.teamName} tiene mejor récord (${winsB}-${losesB} vs ${winsA}-${losesA})` });
    } else {
      factors.push({ icon: 'gray', text: `Ambos equipos tienen récord similar` });
    }
  }

  if (avgA > 0 || avgB > 0) {
    scoreA += avgA * 30;
    scoreB += avgB * 30;
    dataPoints++;
    if (avgA > avgB) {
      factors.push({ icon: 'green', text: `${eqA.teamName} tiene mejor AVG de equipo (.${(avgA*1000).toFixed(0)} vs .${(avgB*1000).toFixed(0)})` });
    } else if (avgB > avgA) {
      factors.push({ icon: 'amber', text: `${eqB.teamName} tiene mejor AVG de equipo (.${(avgB*1000).toFixed(0)} vs .${(avgA*1000).toFixed(0)})` });
    } else {
      factors.push({ icon: 'gray', text: `Promedios de bateo similares` });
    }
  }

  const hrsA = bateoA.reduce((s, b) => s + (parseInt(b.HR) || 0), 0);
  const hrsB = bateoB.reduce((s, b) => s + (parseInt(b.HR) || 0), 0);
  if (hrsA > 0 || hrsB > 0) {
    const hrMax = Math.max(hrsA, hrsB, 1);
    scoreA += (hrsA / hrMax) * 10;
    scoreB += (hrsB / hrMax) * 10;
    dataPoints++;
    if (hrsA > hrsB) {
      factors.push({ icon: 'green', text: `${eqA.teamName} tiene más poder (${hrsA} HR vs ${hrsB} HR)` });
    } else if (hrsB > hrsA) {
      factors.push({ icon: 'amber', text: `${eqB.teamName} tiene más poder (${hrsB} HR vs ${hrsA} HR)` });
    }
  }

  const runsA = bateoA.reduce((s, b) => s + (parseInt(b.R) || 0), 0);
  const runsB = bateoB.reduce((s, b) => s + (parseInt(b.R) || 0), 0);
  if (runsA > 0 || runsB > 0) {
    const runMax = Math.max(runsA, runsB, 1);
    scoreA += (runsA / runMax) * 10;
    scoreB += (runsB / runMax) * 10;
    dataPoints++;
    if (runsA > runsB) {
      factors.push({ icon: 'green', text: `${eqA.teamName} anota más carreras (${runsA} vs ${runsB})` });
    } else if (runsB > runsA) {
      factors.push({ icon: 'amber', text: `${eqB.teamName} anota más carreras (${runsB} vs ${runsA})` });
    }
  }

  if (scoreA === 0 && scoreB === 0) { scoreA = 50; scoreB = 50; }
  const totalScore = scoreA + scoreB;
  const pctA = Math.round((scoreA / totalScore) * 100);
  const pctB = 100 - pctA;

  let confidence, confClass, confLabel;
  if (dataPoints >= 3) { confidence = 'high'; confClass = 'confidence-high'; confLabel = '🔥 Alta'; }
  else if (dataPoints >= 2) { confidence = 'medium'; confClass = 'confidence-medium'; confLabel = '🤔 Media'; }
  else { confidence = 'low'; confClass = 'confidence-low'; confLabel = '❓ Baja'; }

  if (factors.length === 0) {
    factors.push({ icon: 'gray', text: 'No hay suficientes datos para un análisis detallado' });
  }

  const imgA = logoUrl(eqA.foto);
  const imgB = logoUrl(eqB.foto);

  loadingEl.style.display = 'none';

  resultsEl.innerHTML = `
    <div class="prediction-result-card">
      <div class="prediction-header">
        <h3>Resultado de la Predicción</h3>
        <div class="prediction-matchup">
          <div class="prediction-team-info">
            ${imgA ? `<img src="${imgA}" onerror="this.style.display='none'" alt="">` : ''}
            <div class="prediction-team-name">${eqA.teamName}</div>
            <div class="prediction-team-pct team-a">${pctA}%</div>
          </div>
          <div class="prediction-vs-badge">VS</div>
          <div class="prediction-team-info">
            ${imgB ? `<img src="${imgB}" onerror="this.style.display='none'" alt="">` : ''}
            <div class="prediction-team-name">${eqB.teamName}</div>
            <div class="prediction-team-pct team-b">${pctB}%</div>
          </div>
        </div>
      </div>
      <div class="prediction-bar-container">
        <div class="prediction-bar">
          <div class="prediction-bar-a" style="width:0%">${pctA}%</div>
          <div class="prediction-bar-b" style="width:0%">${pctB}%</div>
        </div>
      </div>
      <div class="prediction-factors">
        <h4>📊 Factores Clave</h4>
        ${factors.map(f => `
          <div class="prediction-factor">
            <div class="prediction-factor-icon ${f.icon}">●</div>
            <span>${f.text}</span>
          </div>
        `).join('')}
        <div style="margin-top:.75rem">
          <span class="prediction-confidence ${confClass}">Confianza: ${confLabel}</span>
        </div>
      </div>
    </div>`;

  requestAnimationFrame(() => {
    setTimeout(() => {
      const barA = resultsEl.querySelector('.prediction-bar-a');
      const barB = resultsEl.querySelector('.prediction-bar-b');
      if (barA) barA.style.width = pctA + '%';
      if (barB) barB.style.width = pctB + '%';
    }, 50);
  });
}

// ── FEATURE 3: ADMIN PANEL ──

const ADMIN_PASSWORD = 'liga2024';
let adminAuthenticated = false;

function adminLogin() {
  const pw = document.getElementById('admin-password').value;
  const errEl = document.getElementById('admin-login-error');
  if (pw === ADMIN_PASSWORD) {
    adminAuthenticated = true;
    document.getElementById('admin-login').style.display = 'none';
    document.getElementById('admin-panel').style.display = '';
    initAdminPanel();
  } else {
    errEl.style.display = '';
    document.getElementById('admin-password').value = '';
    setTimeout(() => { errEl.style.display = 'none'; }, 2500);
  }
}

function initAdminPanel() {
  const teamSelect = document.getElementById('admin-team-select');
  if (state.equiposEnriched.length > 0) {
    teamSelect.innerHTML = state.equiposEnriched.map(eq =>
      `<option value="${eq.InscripcionID}">${eq.teamName} (${eq.catLabel})</option>`
    ).join('');
    loadAdminTeamNote();
  }

  const savedSeason = localStorage.getItem('admin_season_name');
  if (savedSeason) document.getElementById('admin-season-name').value = savedSeason;
}

function loadAdminTeamNote() {
  const id = document.getElementById('admin-team-select').value;
  const note = localStorage.getItem('admin_team_note_' + id) || '';
  document.getElementById('admin-team-note').value = note;
  const savedEl = document.getElementById('admin-note-saved');
  savedEl.style.display = 'none';
}

function saveAdminTeamNote() {
  const id = document.getElementById('admin-team-select').value;
  const note = document.getElementById('admin-team-note').value;
  localStorage.setItem('admin_team_note_' + id, note);
  const savedEl = document.getElementById('admin-note-saved');
  savedEl.style.display = '';
  setTimeout(() => { savedEl.style.display = 'none'; }, 2000);
}

function getAdminTeamNote(inscripcionID) {
  return localStorage.getItem('admin_team_note_' + inscripcionID) || '';
}

function getAdminPlayerAnnotation(playerName) {
  return localStorage.getItem('admin_player_tag_' + playerName) || '';
}

let adminPlayerSearchTimeout = null;

function searchAdminPlayers() {
  clearTimeout(adminPlayerSearchTimeout);
  adminPlayerSearchTimeout = setTimeout(doSearchAdminPlayers, 300);
}

function doSearchAdminPlayers() {
  const query = (document.getElementById('admin-player-search').value || '').trim().toUpperCase();
  const container = document.getElementById('admin-player-results');
  if (query.length < 2) { container.innerHTML = ''; return; }

  const results = [];
  for (const eq of state.equiposEnriched) {
    const cached = state.playerCache[eq.InscripcionID];
    if (!cached) continue;
    for (const j of cached.jugadores) {
      if (j.nombre.toUpperCase().includes(query)) {
        const existing = getAdminPlayerAnnotation(j.nombre);
        results.push({ jugador: j, equipo: eq, tag: existing });
      }
    }
  }

  if (results.length === 0) {
    container.innerHTML = '<div style="font-size:.82rem;color:var(--text-dim);padding:.5rem">No se encontraron jugadores</div>';
    return;
  }

  container.innerHTML = results.slice(0, 20).map(r =>
    `<div class="admin-player-item" onclick="selectAdminPlayer('${r.jugador.nombre.replace(/'/g, "\\'")}', '${r.equipo.teamName.replace(/'/g, "\\'")}')">
      <span>${r.jugador.nombre}</span>
      <span class="equipo-grupo-pill">${r.equipo.teamName}</span>
      ${r.tag ? `<span class="admin-player-tag">${r.tag}</span>` : ''}
    </div>`
  ).join('');
}

function selectAdminPlayer(name, team) {
  document.getElementById('admin-player-annotation-form').style.display = '';
  document.getElementById('admin-selected-player').textContent = name + ' (' + team + ')';
  document.getElementById('admin-selected-player').dataset.playerName = name;
  const existing = getAdminPlayerAnnotation(name);
  document.getElementById('admin-player-tag').value = existing;
}

function saveAdminPlayerAnnotation() {
  const name = document.getElementById('admin-selected-player').dataset.playerName;
  const tag = document.getElementById('admin-player-tag').value.trim();
  if (name) {
    if (tag) {
      localStorage.setItem('admin_player_tag_' + name, tag);
    } else {
      localStorage.removeItem('admin_player_tag_' + name);
    }
    const savedEl = document.getElementById('admin-annotation-saved');
    savedEl.style.display = '';
    setTimeout(() => { savedEl.style.display = 'none'; }, 2000);
    doSearchAdminPlayers();
  }
}

function saveAdminSeasonName() {
  const name = document.getElementById('admin-season-name').value.trim();
  if (name) {
    localStorage.setItem('admin_season_name', name);
    document.getElementById('nav-temporada').textContent = name;
    document.getElementById('hero-badge').textContent = name;
  }
  const savedEl = document.getElementById('admin-season-saved');
  savedEl.style.display = '';
  setTimeout(() => { savedEl.style.display = 'none'; }, 2000);
}

function adminClearCache() {
  if (!confirm('¿Limpiar todo el cache del Service Worker? La página se recargará.')) return;
  if ('caches' in window) {
    caches.keys().then(keys => {
      return Promise.all(keys.map(k => caches.delete(k)));
    }).then(() => {
      window.location.reload(true);
    });
  } else {
    window.location.reload(true);
  }
}

function adminExportData() {
  const exportData = {
    exportDate: new Date().toISOString(),
    temporada: state.temporada,
    categorias: state.categorias,
    jornadas: state.jornadas,
    equipos: state.equiposEnriched.map(eq => ({
      name: eq.teamName,
      fullName: eq.fullName,
      wins: eq.wins,
      loses: eq.loses,
      points: eq.points,
      grupo: eq.grupo,
      catLabel: eq.catLabel,
    })),
    standingsCache: state.standingsCache,
    playerCache: {},
    adminNotes: {},
    adminPlayerTags: {},
    adminSeasonName: localStorage.getItem('admin_season_name') || '',
  };

  for (const eq of state.equiposEnriched) {
    const note = getAdminTeamNote(eq.InscripcionID);
    if (note) exportData.adminNotes[eq.InscripcionID] = { team: eq.teamName, note };
  }

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key.startsWith('admin_player_tag_')) {
      const name = key.replace('admin_player_tag_', '');
      exportData.adminPlayerTags[name] = localStorage.getItem(key);
    }
  }

  for (const eq of state.equiposEnriched) {
    const cached = state.playerCache[eq.InscripcionID];
    if (cached) {
      exportData.playerCache[eq.teamName] = {
        jugadores: (cached.jugadores || []).length,
        bateo: (cached.bateo || []).length,
      };
    }
  }

  const json = JSON.stringify(exportData, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `tarjeton_export_${new Date().toISOString().split('T')[0]}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── FEATURE 4: ANIMATIONS & VISUAL EFFECTS ──

function initScrollAnimations() {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('animated');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.08, rootMargin: '0px 0px -40px 0px' });

  function observeCards() {
    const selectors = '.cat-card, .game-card, .news-card, .equipo-card, .cal-card, .standing-group, .chart-card, .leader-row, .compare-card, .prediction-result-card, .admin-card';
    document.querySelectorAll(selectors).forEach(el => {
      if (!el.classList.contains('animate-on-scroll') && !el.classList.contains('animated')) {
        el.classList.add('animate-on-scroll');
        observer.observe(el);
      }
    });
  }

  const mutObs = new MutationObserver(() => {
    requestAnimationFrame(observeCards);
  });
  mutObs.observe(document.getElementById('app'), { childList: true, subtree: true });
  observeCards();
}

function initRippleEffect() {
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.btn');
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const ripple = document.createElement('span');
    ripple.className = 'ripple';
    const size = Math.max(rect.width, rect.height);
    ripple.style.width = ripple.style.height = size + 'px';
    ripple.style.left = (e.clientX - rect.left - size / 2) + 'px';
    ripple.style.top = (e.clientY - rect.top - size / 2) + 'px';
    btn.appendChild(ripple);
    ripple.addEventListener('animationend', () => ripple.remove());
  });
}

function initHeroParticles() {
  const container = document.getElementById('heroParticles');
  if (!container) return;
  const particles = ['⚾', '🥎', '◆', '●'];
  for (let i = 0; i < 12; i++) {
    const p = document.createElement('span');
    p.className = 'hero-particle';
    p.textContent = particles[i % particles.length];
    p.style.left = (Math.random() * 100) + '%';
    p.style.animationDuration = (8 + Math.random() * 12) + 's';
    p.style.animationDelay = (Math.random() * 10) + 's';
    p.style.fontSize = (0.8 + Math.random() * 0.8) + 'rem';
    container.appendChild(p);
  }
}

function initParallax() {
  const hero = document.querySelector('.hero');
  if (!hero) return;
  let ticking = false;
  window.addEventListener('scroll', () => {
    if (!ticking) {
      requestAnimationFrame(() => {
        const scrollY = window.scrollY;
        if (scrollY < 600) {
          const visual = hero.querySelector('.hero-visual');
          if (visual) visual.style.transform = `translateY(${scrollY * 0.15}px)`;
          const content = hero.querySelector('.hero-content');
          if (content) content.style.transform = `translateY(${scrollY * 0.05}px)`;
        }
        ticking = false;
      });
      ticking = true;
    }
  }, { passive: true });
}

function animateCounters() {
  document.querySelectorAll('.equipo-stat-val:not(.counted)').forEach(el => {
    const text = el.textContent.trim();
    const num = parseFloat(text);
    if (isNaN(num)) return;
    el.classList.add('counted');
    const isFloat = text.includes('.');
    const duration = 800;
    const start = performance.now();
    function step(now) {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = num * eased;
      el.textContent = isFloat ? current.toFixed(3) : Math.round(current);
      if (progress < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  });
}

function renderSkeletonCards(container, count = 3) {
  let html = '';
  for (let i = 0; i < count; i++) {
    html += `<div class="skeleton skeleton-card"></div>`;
  }
  container.innerHTML = html;
}

// Add admin notes to team detail view
const _originalOpenEquipoDetail = openEquipoDetail;
openEquipoDetail = async function(inscripcionID) {
  await _originalOpenEquipoDetail(inscripcionID);
  const note = getAdminTeamNote(inscripcionID);
  if (note) {
    const headerCard = document.getElementById('equipo-header-card');
    if (headerCard && !headerCard.querySelector('.admin-note-badge')) {
      const noteEl = document.createElement('div');
      noteEl.style.width = '100%';
      noteEl.innerHTML = `<div class="admin-note-badge">📝 ${note}</div>`;
      headerCard.appendChild(noteEl);
    }
  }
  setTimeout(animateCounters, 100);
};

// Add admin player tags to roster
const _originalRenderJugadorRow = renderJugadorRow;
renderJugadorRow = function(j, idx, stats) {
  let html = _originalRenderJugadorRow(j, idx, stats);
  const tag = getAdminPlayerAnnotation(j.nombre);
  if (tag) {
    html = html.replace('</td>', `<span class="admin-player-tag">${tag}</span></td>`);
  }
  return html;
};

// ══════════════════════════════════════════
// FEATURE 1: PLAYER vs PLAYER (1v1)
// ══════════════════════════════════════════

let p1v1Selected = { a: null, b: null };
let p1v1SearchTimeout = null;

function switchCompareMode(mode) {
  document.getElementById('compare-mode-equipos').style.display = mode === 'equipos' ? '' : 'none';
  document.getElementById('compare-mode-jugadores').style.display = mode === 'jugadores' ? '' : 'none';
  document.querySelectorAll('.compare-mode-tabs .pill').forEach(p => {
    const isEquipos = p.textContent.includes('Equipos');
    p.classList.toggle('active', (mode === 'equipos' && isEquipos) || (mode === 'jugadores' && !isEquipos));
  });
  if (mode === 'jugadores' && !state.playerCacheAll) {
    document.getElementById('p1v1-loading').style.display = '';
    loadAllPlayers('p1v1-loading').then(() => {
      document.getElementById('p1v1-loading').style.display = 'none';
    });
  }
}

function search1v1Player(side) {
  clearTimeout(p1v1SearchTimeout);
  p1v1SearchTimeout = setTimeout(() => doSearch1v1(side), 300);
}

function doSearch1v1(side) {
  const query = (document.getElementById('p1v1-search-' + side).value || '').trim().toUpperCase();
  const dropdown = document.getElementById('p1v1-results-' + side);
  if (query.length < 2) { dropdown.innerHTML = ''; return; }
  if (!state.playerCacheAll) { dropdown.innerHTML = '<div style="padding:.5rem;font-size:.8rem;color:var(--text-dim)">Cargando datos...</div>'; return; }

  const results = [];
  for (const eq of state.equiposEnriched) {
    const cached = state.playerCache[eq.InscripcionID];
    if (!cached) continue;
    const bateoMap = {};
    (cached.bateo || []).forEach(b => { b.SLG = calcSLG(b); bateoMap[b.JugadorID] = b; });
    for (const j of cached.jugadores) {
      if (j.nombre.toUpperCase().includes(query)) {
        results.push({ jugador: j, equipo: eq, stats: bateoMap[j.JugadorID] || {} });
      }
    }
  }

  dropdown.innerHTML = results.slice(0, 15).map(r =>
    `<div class="p1v1-dropdown-item" onclick="select1v1Player('${side}', '${r.jugador.JugadorID}', '${r.jugador.nombre.replace(/'/g, "\\'")}', '${r.equipo.teamName.replace(/'/g, "\\'")}', '${r.equipo.InscripcionID}')">
      ${r.equipo.foto ? '<img src="' + logoUrl(r.equipo.foto) + '" style="width:20px;height:20px;border-radius:50%;" onerror="this.style.display=\'none\'">' : ''}
      <span>${r.jugador.nombre}</span>
      <span class="equipo-grupo-pill">${r.equipo.teamName}</span>
    </div>`
  ).join('') || '<div style="padding:.5rem;font-size:.8rem;color:var(--text-dim)">No encontrado</div>';
}

function select1v1Player(side, jugadorID, nombre, teamName, inscripcionID) {
  p1v1Selected[side] = { jugadorID, nombre, teamName, inscripcionID };
  document.getElementById('p1v1-search-' + side).value = nombre;
  document.getElementById('p1v1-results-' + side).innerHTML = '';
  document.getElementById('p1v1-selected-' + side).textContent = '✓ ' + nombre + ' (' + teamName + ')';
}

function compare1v1() {
  const pA = p1v1Selected.a;
  const pB = p1v1Selected.b;
  if (!pA || !pB) {
    document.getElementById('p1v1-results').innerHTML = '<div class="empty-state"><p>Selecciona ambos jugadores para comparar</p></div>';
    return;
  }
  if (pA.jugadorID === pB.jugadorID) {
    document.getElementById('p1v1-results').innerHTML = '<div class="empty-state"><p>Selecciona dos jugadores diferentes</p></div>';
    return;
  }

  function getPlayerStats(selected) {
    const cached = state.playerCache[selected.inscripcionID];
    if (!cached) return {};
    const bateoMap = {};
    (cached.bateo || []).forEach(b => { b.SLG = calcSLG(b); bateoMap[b.JugadorID] = b; });
    return bateoMap[selected.jugadorID] || {};
  }

  const sA = getPlayerStats(pA);
  const sB = getPlayerStats(pB);

  const stats = [
    { label: 'AVG', a: parseFloat(sA.PCT) || 0, b: parseFloat(sB.PCT) || 0, fmt: v => v.toFixed(3) },
    { label: 'SLG', a: parseFloat(sA.SLG || calcSLG(sA)) || 0, b: parseFloat(sB.SLG || calcSLG(sB)) || 0, fmt: v => v.toFixed(3) },
    { label: 'ISO', a: parseFloat(calcISO(sA)) || 0, b: parseFloat(calcISO(sB)) || 0, fmt: v => v.toFixed(3) },
    { label: 'H', a: parseInt(sA.H) || 0, b: parseInt(sB.H) || 0, fmt: v => v },
    { label: 'H2', a: parseInt(sA.H2) || 0, b: parseInt(sB.H2) || 0, fmt: v => v },
    { label: 'H3', a: parseInt(sA.H3) || 0, b: parseInt(sB.H3) || 0, fmt: v => v },
    { label: 'HR', a: parseInt(sA.HR) || 0, b: parseInt(sB.HR) || 0, fmt: v => v },
    { label: 'R', a: parseInt(sA.R) || 0, b: parseInt(sB.R) || 0, fmt: v => v },
  ];

  const statRows = stats.map(s => {
    const aWin = s.a > s.b ? 'winner' : s.a < s.b ? 'loser' : '';
    const bWin = s.b > s.a ? 'winner' : s.b < s.a ? 'loser' : '';
    return `
      <div class="p1v1-stat-row">
        <div class="p1v1-stat-val ${aWin}">${s.fmt(s.a)}</div>
        <div class="p1v1-stat-label">${s.label}</div>
        <div class="p1v1-stat-val ${bWin}">${s.fmt(s.b)}</div>
      </div>`;
  }).join('');

  const radarSVG = render1v1Radar(stats, pA.nombre, pB.nombre);

  const container = document.getElementById('p1v1-results');
  container.innerHTML = `
    <div class="p1v1-comparison">
      <div class="p1v1-header">
        <div class="p1v1-player-card">
          <div class="p1v1-player-name">${pA.nombre}</div>
          <div class="p1v1-player-team">${pA.teamName}</div>
        </div>
        <div class="p1v1-vs-badge">VS</div>
        <div class="p1v1-player-card">
          <div class="p1v1-player-name">${pB.nombre}</div>
          <div class="p1v1-player-team">${pB.teamName}</div>
        </div>
      </div>
      <div class="p1v1-radar-container">${radarSVG}</div>
      <div class="section-header"><h2>Comparación detallada</h2></div>
      <div style="display:flex;gap:1.5rem;margin-bottom:1rem;font-size:.8rem;">
        <span style="color:var(--primary);font-weight:700;">■ ${pA.nombre.split(' ').slice(-1)[0]}</span>
        <span style="color:var(--accent);font-weight:700;">■ ${pB.nombre.split(' ').slice(-1)[0]}</span>
      </div>
      ${statRows}
    </div>`;
}

function render1v1Radar(stats, nameA, nameB) {
  const radarStats = stats.filter(s => ['AVG','SLG','ISO','H','HR','R'].includes(s.label));
  const n = radarStats.length;
  const cx = 150, cy = 150, r = 110;
  const angleStep = (2 * Math.PI) / n;

  function getPoints(values) {
    return values.map((v, i) => {
      const angle = angleStep * i - Math.PI / 2;
      return { x: cx + r * v * Math.cos(angle), y: cy + r * v * Math.sin(angle) };
    });
  }

  const maxVals = radarStats.map(s => Math.max(s.a, s.b, 0.001));
  const normA = radarStats.map((s, i) => s.a / maxVals[i]);
  const normB = radarStats.map((s, i) => s.b / maxVals[i]);
  const ptsA = getPoints(normA);
  const ptsB = getPoints(normB);

  const gridLines = [0.25, 0.5, 0.75, 1].map(level => {
    const pts = Array.from({length: n}, (_, i) => {
      const angle = angleStep * i - Math.PI / 2;
      return `${cx + r * level * Math.cos(angle)},${cy + r * level * Math.sin(angle)}`;
    });
    return `<polygon points="${pts.join(' ')}" fill="none" stroke="var(--border)" stroke-width="0.5"/>`;
  }).join('');

  const axes = Array.from({length: n}, (_, i) => {
    const angle = angleStep * i - Math.PI / 2;
    const x2 = cx + r * Math.cos(angle);
    const y2 = cy + r * Math.sin(angle);
    return `<line x1="${cx}" y1="${cy}" x2="${x2}" y2="${y2}" stroke="var(--border)" stroke-width="0.5"/>`;
  }).join('');

  const labels = radarStats.map((s, i) => {
    const angle = angleStep * i - Math.PI / 2;
    const lx = cx + (r + 18) * Math.cos(angle);
    const ly = cy + (r + 18) * Math.sin(angle);
    return `<text x="${lx}" y="${ly}" text-anchor="middle" dominant-baseline="middle" fill="var(--text-muted)" font-size="10" font-weight="700">${s.label}</text>`;
  }).join('');

  const polyA = ptsA.map(p => `${p.x},${p.y}`).join(' ');
  const polyB = ptsB.map(p => `${p.x},${p.y}`).join(' ');

  return `<svg width="300" height="300" viewBox="0 0 300 300">
    ${gridLines}${axes}
    <polygon points="${polyA}" fill="rgba(34,197,94,.2)" stroke="#22c55e" stroke-width="2"/>
    <polygon points="${polyB}" fill="rgba(245,158,11,.2)" stroke="#f59e0b" stroke-width="2"/>
    ${ptsA.map(p => `<circle cx="${p.x}" cy="${p.y}" r="3" fill="#22c55e"/>`).join('')}
    ${ptsB.map(p => `<circle cx="${p.x}" cy="${p.y}" r="3" fill="#f59e0b"/>`).join('')}
    ${labels}
  </svg>`;
}

// ══════════════════════════════════════════
// FEATURE 2: WHATSAPP SHARE
// ══════════════════════════════════════════

function shareWhatsApp() {
  const temporada = state.temporada ? state.temporada.Temporada : 'Temporada 108';
  const msg = encodeURIComponent(`⚾ Tarjetón - Liga Infantil y Juvenil de Béisbol Yucatán - ${temporada} https://tarjeton.vercel.app/`);
  window.open('https://wa.me/?text=' + msg, '_blank');
}

// ══════════════════════════════════════════
// FEATURE 3: QR CODE
// ══════════════════════════════════════════

let qrGenerated = false;

function showQRModal() {
  const modal = document.getElementById('qr-modal');
  modal.style.display = 'flex';
  if (!qrGenerated) {
    const container = document.getElementById('qr-code-container');
    container.innerHTML = '';
    if (typeof QRCode !== 'undefined') {
      new QRCode(container, {
        text: 'https://tarjeton.vercel.app/',
        width: 200,
        height: 200,
        colorDark: '#14532d',
        colorLight: '#ffffff',
        correctLevel: QRCode.CorrectLevel.H
      });
    } else {
      container.innerHTML = '<p style="color:var(--text-dim);font-size:.8rem;">No se pudo cargar la librería QR</p>';
    }
    qrGenerated = true;
  }
}

function closeQRModal(e) {
  if (e && e.target !== e.currentTarget) return;
  document.getElementById('qr-modal').style.display = 'none';
}

// ══════════════════════════════════════════
// FEATURE 4: PLAYOFF BRACKET
// ══════════════════════════════════════════

function populateBracketSelect() {
  const sel = document.getElementById('bracket-cat');
  if (!sel) return;
  const cats = state.categorias.filter(c => c.CategoriaID !== '1');
  sel.innerHTML = cats.map(c =>
    `<option value="${c.CategoriaID}">${catShort(c).label} (${c.EdadMinima}-${c.EdadMaxima})</option>`
  ).join('');
}

async function loadBracket() {
  const catID = document.getElementById('bracket-cat').value;
  if (!catID || !state.temporada) return;
  const container = document.getElementById('bracket-container');
  const loadingEl = document.getElementById('bracket-loading');
  loadingEl.style.display = '';
  container.innerHTML = '';

  const grupos = await fetchStanding(state.temporada.TemporadaID, catID);
  loadingEl.style.display = 'none';

  if (!grupos || grupos.length === 0) {
    container.innerHTML = '<div class="empty-state"><div class="empty-icon">🏆</div><p>No hay datos de posiciones para generar el bracket</p></div>';
    return;
  }

  const semis = [];
  const groupTeams = {};

  for (const g of grupos) {
    const sorted = [...g.equipos].sort((a, b) => parseFloat(b.points) - parseFloat(a.points));
    groupTeams[g.clasificacion] = sorted;
    if (sorted.length >= 2) {
      semis.push({ grupo: g.clasificacion, seed1: sorted[0], seed2: sorted[1] });
    } else if (sorted.length === 1) {
      semis.push({ grupo: g.clasificacion, seed1: sorted[0], seed2: null });
    }
  }

  if (semis.length === 0) {
    container.innerHTML = '<div class="empty-state"><p>No hay suficientes equipos</p></div>';
    return;
  }

  function renderBracketTeam(team, seed) {
    if (!team) return `<div class="bracket-team"><span class="bracket-seed">-</span><span class="bracket-team-name" style="color:var(--text-dim)">TBD</span></div>`;
    const img = logoUrl(team.foto);
    return `<div class="bracket-team seed-${seed}">
      <span class="bracket-seed">${seed}</span>
      ${img ? `<img src="${img}" onerror="this.style.display='none'" alt="">` : ''}
      <span class="bracket-team-name">${team.equipo}</span>
      <span class="bracket-record">${team.wins}G-${team.loses}P</span>
    </div>`;
  }

  let semiHTML = '';
  const finalists = [];

  for (const semi of semis) {
    const winner = semi.seed1;
    finalists.push(winner);
    semiHTML += `
      <div>
        <div class="bracket-group-label">Grupo ${semi.grupo}</div>
        <div class="bracket-match">
          ${renderBracketTeam(semi.seed1, 1)}
          ${renderBracketTeam(semi.seed2 || (groupTeams[semi.grupo] && groupTeams[semi.grupo][groupTeams[semi.grupo].length - 1]) || null, semis.length)}
        </div>
      </div>`;
  }

  let finalHTML = '';
  if (finalists.length >= 2) {
    const f1 = finalists[0];
    const f2 = finalists[finalists.length - 1];
    const champion = parseFloat(f1.points) >= parseFloat(f2.points) ? f1 : f2;
    finalHTML = `
      <div>
        <div class="bracket-match">
          ${renderBracketTeam(f1, 1)}
          ${renderBracketTeam(f2, 2)}
        </div>
      </div>`;

    const champImg = logoUrl(champion.foto);
    var championHTML = `
      <div style="text-align:center">
        <div class="bracket-group-label">🏆 Campeón proyectado</div>
        <div class="bracket-match" style="border-color:var(--gold);background:var(--accent-glow);">
          ${renderBracketTeam(champion, '🏆')}
        </div>
      </div>`;
  }

  container.innerHTML = `
    <div class="bracket-wrapper">
      <div class="bracket">
        <div class="bracket-round">
          <div class="bracket-round-title">Semifinales</div>
          ${semiHTML}
        </div>
        <div class="bracket-connector"></div>
        <div class="bracket-round">
          <div class="bracket-round-title">Final</div>
          ${finalHTML}
        </div>
        <div class="bracket-connector"></div>
        <div class="bracket-round">
          <div class="bracket-round-title">Campeón</div>
          ${championHTML || ''}
        </div>
      </div>
    </div>
    <div style="margin-top:1rem;font-size:.72rem;color:var(--text-dim);text-align:center;">
      * Bracket generado automáticamente basado en las posiciones actuales
    </div>`;
}

// ══════════════════════════════════════════
// FEATURE 5: MVP VOTING
// ══════════════════════════════════════════

function populateMVPSelect() {
  const sel = document.getElementById('mvp-cat');
  if (!sel) return;
  const cats = state.categorias.filter(c => c.CategoriaID !== '1');
  sel.innerHTML = cats.map(c =>
    `<option value="${c.CategoriaID}">${catShort(c).label} (${c.EdadMinima}-${c.EdadMaxima})</option>`
  ).join('');
}

function getMVPVotes(catID) {
  try { return JSON.parse(localStorage.getItem('mvp_votes_' + catID) || '{}'); }
  catch { return {}; }
}

function saveMVPVotes(catID, votes) {
  localStorage.setItem('mvp_votes_' + catID, JSON.stringify(votes));
}

function getMyMVPVote(catID) {
  return localStorage.getItem('mvp_my_vote_' + catID) || null;
}

async function loadMVPCandidates() {
  const catID = document.getElementById('mvp-cat').value;
  if (!catID) return;
  const loadingEl = document.getElementById('mvp-loading');
  const resultsEl = document.getElementById('mvp-results');
  const rankingsEl = document.getElementById('mvp-rankings');

  loadingEl.style.display = '';
  resultsEl.innerHTML = '';
  rankingsEl.innerHTML = '';

  if (!state.playerCacheAll) {
    await loadAllPlayers('mvp-loading');
  }
  loadingEl.style.display = 'none';

  if (state.equiposEnriched.length === 0) {
    resultsEl.innerHTML = '<div class="empty-state"><div class="inline-spinner"></div> Cargando equipos, espera unos segundos y vuelve a intentar...</div>';
    return;
  }

  const candidates = [];
  for (const eq of state.equiposEnriched) {
    if (String(eq.categoriaID) !== String(catID)) continue;
    const cached = state.playerCache[eq.InscripcionID];
    if (!cached) continue;
    const bateoMap = {};
    (cached.bateo || []).forEach(b => { b.SLG = calcSLG(b); bateoMap[b.JugadorID] = b; });
    for (const j of cached.jugadores) {
      const stats = bateoMap[j.JugadorID];
      if (stats && (parseInt(stats.VB) > 0 || parseInt(stats.H) > 0 || parseInt(stats.HR) > 0)) {
        candidates.push({ jugador: j, equipo: eq, stats });
      }
    }
  }

  candidates.sort((a, b) => (parseFloat(b.stats.PCT) || 0) - (parseFloat(a.stats.PCT) || 0));
  const top = candidates.slice(0, 20);

  const votes = getMVPVotes(catID);
  const myVote = getMyMVPVote(catID);

  const cards = top.map(c => {
    const voteCount = votes[c.jugador.JugadorID] || 0;
    const isVoted = myVote === c.jugador.JugadorID;
    const img = logoUrl(c.equipo.foto);
    return `
      <div class="mvp-card">
        ${img ? `<img src="${img}" style="width:40px;height:40px;border-radius:50%;object-fit:cover;border:2px solid var(--border);" onerror="this.style.display='none'" alt="">` : ''}
        <div class="mvp-card-info">
          <div class="mvp-card-name">${c.jugador.nombre}</div>
          <div class="mvp-card-team">${c.equipo.teamName} · ${c.equipo.catLabel}</div>
          <div class="mvp-card-stats">AVG: ${c.stats.PCT} · HR: ${c.stats.HR || 0} · H: ${c.stats.H || 0}</div>
        </div>
        <div class="mvp-vote-count">${voteCount}</div>
        <button class="mvp-vote-btn ${isVoted ? 'voted' : ''}" onclick="voteMVP('${catID}', '${c.jugador.JugadorID}', '${c.jugador.nombre.replace(/'/g, "\\'")}')">${isVoted ? '✓ Votado' : '🗳️ Votar'}</button>
      </div>`;
  }).join('');

  resultsEl.innerHTML = top.length > 0
    ? `<div class="mvp-grid">${cards}</div>`
    : '<div class="empty-state"><p>No hay candidatos con estadísticas</p></div>';

  renderMVPRankings(catID);
}

function voteMVP(catID, jugadorID, nombre) {
  const myVote = getMyMVPVote(catID);
  if (myVote) {
    alert('Ya votaste en esta categoría. Solo puedes votar una vez.');
    return;
  }
  const votes = getMVPVotes(catID);
  votes[jugadorID] = (votes[jugadorID] || 0) + 1;
  saveMVPVotes(catID, votes);
  localStorage.setItem('mvp_my_vote_' + catID, jugadorID);
  loadMVPCandidates();
}

function renderMVPRankings(catID) {
  const votes = getMVPVotes(catID);
  const entries = Object.entries(votes).filter(([_, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return;

  const rankingsEl = document.getElementById('mvp-rankings');
  const rows = entries.slice(0, 10).map(([jID, count], i) => {
    let name = jID;
    for (const eq of state.equiposEnriched) {
      const cached = state.playerCache[eq.InscripcionID];
      if (!cached) continue;
      const found = cached.jugadores.find(j => j.JugadorID === jID);
      if (found) { name = found.nombre; break; }
    }
    const posClass = i < 3 ? ` p${i + 1}` : '';
    return `
      <div class="mvp-ranking-row">
        <div class="mvp-ranking-pos${posClass}">${i + 1}</div>
        <div class="mvp-ranking-info">
          <div class="mvp-ranking-name">${name}</div>
        </div>
        <div class="mvp-ranking-votes">${count} votos</div>
      </div>`;
  }).join('');

  rankingsEl.innerHTML = `
    <div class="section-header"><h2>🏅 Ranking de Votos</h2></div>
    <div class="leader-table-container">${rows}</div>`;
}

// ══════════════════════════════════════════
// FEATURE 6: PLAYER TRENDS
// ══════════════════════════════════════════

let trendsSearchTimeout = null;

function searchTrendsPlayer() {
  clearTimeout(trendsSearchTimeout);
  trendsSearchTimeout = setTimeout(doSearchTrendsPlayer, 350);
}

async function doSearchTrendsPlayer() {
  const query = (document.getElementById('trends-search').value || '').trim();
  const listEl = document.getElementById('trends-player-list');
  const loadingEl = document.getElementById('trends-loading');
  const chartEl = document.getElementById('trends-chart-container');

  if (query.length < 3) {
    listEl.innerHTML = query.length > 0 ? '<div class="empty-state"><p>Escribe al menos 3 caracteres</p></div>' : '';
    return;
  }

  if (!state.playerCacheAll) {
    loadingEl.style.display = '';
    await loadAllPlayers('trends-loading');
    loadingEl.style.display = 'none';
  }

  const queryUp = query.toUpperCase();
  const results = [];
  for (const eq of state.equiposEnriched) {
    const cached = state.playerCache[eq.InscripcionID];
    if (!cached) continue;
    const bateoMap = {};
    (cached.bateo || []).forEach(b => { b.SLG = calcSLG(b); bateoMap[b.JugadorID] = b; });
    for (const j of cached.jugadores) {
      if (j.nombre.toUpperCase().includes(queryUp)) {
        results.push({ jugador: j, equipo: eq, stats: bateoMap[j.JugadorID] || {} });
      }
    }
  }

  if (results.length === 0) {
    listEl.innerHTML = '<div class="empty-state"><p>No se encontraron jugadores</p></div>';
    return;
  }

  listEl.innerHTML = `<div class="trends-player-list">${results.slice(0, 20).map(r => {
    const img = logoUrl(r.equipo.foto);
    return `<div class="trends-player-item" onclick="showPlayerTrends('${r.equipo.InscripcionID}', '${r.jugador.JugadorID}')">
      ${img ? `<img src="${img}" style="width:32px;height:32px;border-radius:50%;object-fit:cover;border:1px solid var(--border);" onerror="this.style.display='none'">` : ''}
      <div style="flex:1;overflow:hidden">
        <div style="font-weight:700;font-size:.88rem;">${r.jugador.nombre}</div>
        <div style="font-size:.72rem;color:var(--text-muted);">${r.equipo.teamName} · ${r.equipo.catLabel}</div>
      </div>
      <span class="equipo-grupo-pill">${r.stats.PCT || '-'}</span>
    </div>`;
  }).join('')}</div>`;
}

function showPlayerTrends(inscripcionID, jugadorID) {
  const chartEl = document.getElementById('trends-chart-container');
  chartEl.style.display = '';

  const eq = state.equiposEnriched.find(e => String(e.InscripcionID) === String(inscripcionID));
  const cached = state.playerCache[inscripcionID];
  if (!cached || !eq) { chartEl.innerHTML = '<div class="empty-state"><p>Sin datos</p></div>'; return; }

  const jugador = cached.jugadores.find(j => j.JugadorID === jugadorID);
  if (!jugador) { chartEl.innerHTML = ''; return; }

  const bateoMap = {};
  (cached.bateo || []).forEach(b => { b.SLG = calcSLG(b); bateoMap[b.JugadorID] = b; });
  const stats = bateoMap[jugadorID] || {};

  const catPlayers = [];
  for (const e of state.equiposEnriched) {
    if (e.categoriaID !== eq.categoriaID) continue;
    const c = state.playerCache[e.InscripcionID];
    if (!c) continue;
    (c.bateo || []).forEach(b => {
      b.SLG = calcSLG(b);
      if (parseFloat(b.PCT) > 0) catPlayers.push(b);
    });
  }

  function catAvg(key, parse) {
    if (catPlayers.length === 0) return 0;
    return catPlayers.reduce((s, p) => s + (parse(p[key]) || 0), 0) / catPlayers.length;
  }

  const metrics = [
    { label: 'AVG', val: parseFloat(stats.PCT) || 0, avg: catAvg('PCT', parseFloat), max: 0.500 },
    { label: 'SLG', val: parseFloat(stats.SLG || calcSLG(stats)) || 0, avg: catAvg('SLG', parseFloat), max: 0.800 },
    { label: 'ISO', val: parseFloat(calcISO(stats)) || 0, avg: catAvg('PCT', v => { const s = catPlayers.find(p => p === stats); return 0; }), max: 0.500 },
    { label: 'H', val: parseInt(stats.H) || 0, avg: catAvg('H', parseInt), max: Math.max(parseInt(stats.H) || 1, catAvg('H', parseInt) * 2, 10) },
    { label: 'HR', val: parseInt(stats.HR) || 0, avg: catAvg('HR', parseInt), max: Math.max(parseInt(stats.HR) || 1, catAvg('HR', parseInt) * 2, 5) },
    { label: 'R', val: parseInt(stats.R) || 0, avg: catAvg('R', parseInt), max: Math.max(parseInt(stats.R) || 1, catAvg('R', parseInt) * 2, 10) },
  ];

  const radarSVG = renderTrendsRadar(metrics);
  const edad = calcularEdad(jugador.FechaNacimiento);

  const statCards = metrics.map(m => {
    const pct = m.max > 0 ? Math.min((m.val / m.max) * 100, 100) : 0;
    const isFloat = m.label === 'AVG' || m.label === 'SLG' || m.label === 'ISO';
    return `
      <div class="trends-stat-card">
        <div class="trends-stat-val">${isFloat ? m.val.toFixed(3) : m.val}</div>
        <div class="trends-stat-label">${m.label}</div>
        <div class="trends-stat-bar"><div class="trends-stat-bar-fill" style="width:${pct}%"></div></div>
        <div style="font-size:.6rem;color:var(--text-dim);margin-top:.25rem;">Prom. cat: ${isFloat ? m.avg.toFixed(3) : m.avg.toFixed(1)}</div>
      </div>`;
  }).join('');

  chartEl.innerHTML = `
    <div class="trends-chart-card">
      <div class="trends-chart-header">
        <div>
          <div class="trends-chart-title">${jugador.nombre}</div>
          <div style="font-size:.82rem;color:var(--text-muted);">${eq.teamName} · ${eq.catLabel}${edad ? ' · ' + edad + ' años' : ''}</div>
        </div>
        <button class="btn btn-sm" onclick="document.getElementById('trends-chart-container').style.display='none'">✕ Cerrar</button>
      </div>
      <div class="radar-chart-container">${radarSVG}</div>
      <div class="section-header"><h2>Estadísticas vs Promedio de Categoría</h2></div>
      <div style="display:flex;gap:1.5rem;margin-bottom:1rem;font-size:.78rem;">
        <span style="color:var(--primary);font-weight:700;">■ Jugador</span>
        <span style="color:var(--text-dim);font-weight:700;">■ Promedio categoría</span>
      </div>
      <div class="trends-stats-grid">${statCards}</div>
    </div>`;

  chartEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderTrendsRadar(metrics) {
  const n = metrics.length;
  const cx = 150, cy = 150, r = 110;
  const angleStep = (2 * Math.PI) / n;

  function getPoints(values) {
    return values.map((v, i) => {
      const angle = angleStep * i - Math.PI / 2;
      return { x: cx + r * v * Math.cos(angle), y: cy + r * v * Math.sin(angle) };
    });
  }

  const normPlayer = metrics.map(m => m.max > 0 ? Math.min(m.val / m.max, 1) : 0);
  const normAvg = metrics.map(m => m.max > 0 ? Math.min(m.avg / m.max, 1) : 0);

  const ptsPlayer = getPoints(normPlayer);
  const ptsAvg = getPoints(normAvg);

  const gridLines = [0.25, 0.5, 0.75, 1].map(level => {
    const pts = Array.from({length: n}, (_, i) => {
      const angle = angleStep * i - Math.PI / 2;
      return `${cx + r * level * Math.cos(angle)},${cy + r * level * Math.sin(angle)}`;
    });
    return `<polygon points="${pts.join(' ')}" fill="none" stroke="var(--border)" stroke-width="0.5"/>`;
  }).join('');

  const axes = Array.from({length: n}, (_, i) => {
    const angle = angleStep * i - Math.PI / 2;
    return `<line x1="${cx}" y1="${cy}" x2="${cx + r * Math.cos(angle)}" y2="${cy + r * Math.sin(angle)}" stroke="var(--border)" stroke-width="0.5"/>`;
  }).join('');

  const labels = metrics.map((m, i) => {
    const angle = angleStep * i - Math.PI / 2;
    return `<text x="${cx + (r + 18) * Math.cos(angle)}" y="${cy + (r + 18) * Math.sin(angle)}" text-anchor="middle" dominant-baseline="middle" fill="var(--text-muted)" font-size="10" font-weight="700">${m.label}</text>`;
  }).join('');

  const polyAvg = ptsAvg.map(p => `${p.x},${p.y}`).join(' ');
  const polyPlayer = ptsPlayer.map(p => `${p.x},${p.y}`).join(' ');

  return `<svg width="300" height="300" viewBox="0 0 300 300">
    ${gridLines}${axes}
    <polygon points="${polyAvg}" fill="rgba(148,163,184,.15)" stroke="var(--text-dim)" stroke-width="1.5" stroke-dasharray="4,3"/>
    <polygon points="${polyPlayer}" fill="rgba(34,197,94,.25)" stroke="#22c55e" stroke-width="2.5"/>
    ${ptsPlayer.map(p => `<circle cx="${p.x}" cy="${p.y}" r="4" fill="#22c55e"/>`).join('')}
    ${ptsAvg.map(p => `<circle cx="${p.x}" cy="${p.y}" r="3" fill="var(--text-dim)"/>`).join('')}
    ${labels}
  </svg>`;
}

// ══════════════════════════════════════════
// FEATURE 7: PRINT STANDINGS
// ══════════════════════════════════════════

function printStandings() {
  const catID = document.getElementById('stand-cat').value;
  if (!catID || !state.temporada) return;
  const key = `${state.temporada.TemporadaID}_${catID}`;
  let data = state.standingsCache[key];
  if (!data || data.length === 0) { alert('Primero carga las posiciones'); return; }

  if (state.standGrupo) {
    data = data.filter(g => g.clasificacion === state.standGrupo);
  }

  const cat = state.categorias.find(c => c.CategoriaID === catID);
  const catName = cat ? catShort(cat).label + ' ' + catShort(cat).ages : 'Posiciones';
  const temporada = state.temporada ? state.temporada.Temporada : 'TEMPORADA 108';

  const groupsHTML = data.map(group => {
    const rows = group.equipos.map(eq => {
      const img = logoUrl(eq.foto);
      const pct = eq.points;
      const posClass = eq.position <= 3 ? ` style="color:${eq.position === 1 ? '#fbbf24' : eq.position === 2 ? '#94a3b8' : '#d97706'};font-weight:900;"` : '';
      return `<tr>
        <td${posClass}>${eq.position}</td>
        <td style="text-align:left;">
          <div style="display:flex;align-items:center;gap:8px;">
            ${img ? `<img src="${img}" style="width:24px;height:24px;border-radius:50%;object-fit:cover;border:1px solid #ccc;" onerror="this.style.display='none'">` : ''}
            <span style="font-weight:700;">${eq.equipo}</span>
          </div>
        </td>
        <td>${eq.wins}</td>
        <td>${eq.loses}</td>
        <td style="font-weight:800;">${pct}</td>
      </tr>`;
    }).join('');

    return `
      <div style="margin-bottom:24px;">
        <div style="background:#14532d;color:#fff;padding:8px 16px;border-radius:8px 8px 0 0;font-weight:700;letter-spacing:1px;font-size:14px;">
          GRUPO ${group.clasificacion} — ${group.equipos.length} equipos
        </div>
        <table style="width:100%;border-collapse:collapse;">
          <thead><tr>
            <th style="background:#f8fafc;padding:8px 12px;text-align:center;font-size:11px;font-weight:700;color:#64748b;border-bottom:2px solid #e2e8f0;width:50px;">#</th>
            <th style="background:#f8fafc;padding:8px 12px;text-align:left;font-size:11px;font-weight:700;color:#64748b;border-bottom:2px solid #e2e8f0;">EQUIPO</th>
            <th style="background:#f8fafc;padding:8px 12px;text-align:center;font-size:11px;font-weight:700;color:#22c55e;border-bottom:2px solid #e2e8f0;width:50px;">G</th>
            <th style="background:#f8fafc;padding:8px 12px;text-align:center;font-size:11px;font-weight:700;color:#ef4444;border-bottom:2px solid #e2e8f0;width:50px;">P</th>
            <th style="background:#f8fafc;padding:8px 12px;text-align:center;font-size:11px;font-weight:700;color:#f59e0b;border-bottom:2px solid #e2e8f0;width:70px;">PCT</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }).join('');

  const fullHTML = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Posiciones - ${catName}</title>
<style>
@page { size: portrait; margin: 0.5in; }
* { margin:0; padding:0; box-sizing:border-box; }
html, body { font-family: 'Segoe UI', Arial, sans-serif; color: #1a2332; }
table { border: 1px solid #e2e8f0; border-radius: 0 0 8px 8px; overflow: hidden; }
td { padding: 8px 12px; font-size: 13px; border-bottom: 1px solid #f1f5f9; text-align: center; }
tr:nth-child(even) td { background: #f8fafc; }
</style></head>
<body>
<div style="text-align:center;margin-bottom:24px;padding-top:16px;">
  <div style="font-size:24px;font-weight:900;color:#14532d;letter-spacing:2px;">⚾ TARJETÓN</div>
  <div style="font-size:14px;color:#64748b;margin-top:4px;">${temporada} — Tabla de Posiciones</div>
  <div style="font-size:18px;font-weight:800;color:#1a2332;margin-top:8px;">${catName}</div>
</div>
${groupsHTML}
<div style="text-align:center;margin-top:16px;font-size:11px;color:#94a3b8;">
  Liga Infantil y Juvenil de Béisbol Yucatán A.C. · tarjeton.vercel.app
</div>
</body></html>`;

  const win = window.open('', '_blank');
  win.document.write(fullHTML);
  win.document.close();
  setTimeout(() => win.print(), 500);
}

// ══════════════════════════════════════════

loadTheme();
updateOnlineStatus();

// Update navigateTo for new sections
const _originalNavigateTo = navigateTo;
navigateTo = function(section) {
  _originalNavigateTo(section);
  if (section === 'prediccion') populatePredictionSelects();
  if (section === 'admin' && adminAuthenticated) initAdminPanel();
  if (section === 'eliminatorias') { populateBracketSelect(); loadBracket(); }
  if (section === 'mvp') { populateMVPSelect(); loadMVPCandidates(); }
  if (section === 'comparar') { /* also handled by original */ }
};

// Apply admin season name on load
function applyAdminSeasonName() {
  const saved = localStorage.getItem('admin_season_name');
  if (saved) {
    const navTemp = document.getElementById('nav-temporada');
    const heroBadge = document.getElementById('hero-badge');
    if (navTemp) navTemp.textContent = saved;
    if (heroBadge) heroBadge.textContent = saved;
  }
}

applyAdminSeasonName();

// ══════════════════════════════════════════
// FEATURE 1: PLAYER BASEBALL CARD
// ══════════════════════════════════════════

function abrirSelectorTarjeta() {
  const eq = state.currentEquipo;
  if (!eq || !eq._jugadores) return;
  const jugadores = eq._jugadores;
  const opts = jugadores.map(j => {
    const edad = calcularEdad(j.FechaNacimiento) || '';
    return `<option value="${j.JugadorID}" data-nombre="${(j.nombre||'').replace(/"/g,'&quot;')}" data-edad="${edad}">${j.nombre}${edad ? ' (' + edad + ' años)' : ''}</option>`;
  }).join('');
  const modal = document.createElement('div');
  modal.className = 'baseball-card-overlay';
  modal.innerHTML = `
    <div style="background:var(--bg-secondary);border-radius:12px;padding:24px;max-width:400px;width:90%;text-align:center;">
      <h3 style="margin-bottom:16px;color:var(--accent);">🃏 Sacar Tarjeta de Jugador</h3>
      <select id="sel-tarjeta-jugador" style="width:100%;padding:10px;border-radius:8px;border:1px solid var(--border);background:var(--bg-primary);color:var(--text-primary);font-size:1rem;margin-bottom:16px;">
        <option value="">-- Selecciona un jugador --</option>
        ${opts}
      </select>
      <div style="display:flex;gap:8px;justify-content:center;">
        <button class="btn btn-primary" onclick="generarTarjetaSeleccionada()">🃏 Generar Tarjeta</button>
        <button class="btn btn-secondary" onclick="this.closest('.baseball-card-overlay').remove()">Cancelar</button>
      </div>
    </div>`;
  modal.onclick = e => { if (e.target === modal) modal.remove(); };
  document.body.appendChild(modal);
}

function generarTarjetaSeleccionada() {
  const sel = document.getElementById('sel-tarjeta-jugador');
  if (!sel || !sel.value) { alert('Selecciona un jugador'); return; }
  const opt = sel.options[sel.selectedIndex];
  const jugadorID = sel.value;
  const nombre = opt.dataset.nombre;
  const edad = parseInt(opt.dataset.edad) || 0;
  document.querySelector('.baseball-card-overlay').remove();
  openBaseballCard(jugadorID, nombre, edad);
}

function openBaseballCard(jugadorID, nombre, edad) {
  const eq = state.currentEquipo;
  if (!eq) return;
  const cached = state.playerCache[eq.InscripcionID] || { bateo: [] };
  const bateoMap = {};
  (cached.bateo || []).forEach(b => { b.SLG = calcSLG(b); bateoMap[b.JugadorID] = b; });
  const stats = bateoMap[jugadorID] || {};
  renderBaseballCard(nombre, edad, stats, eq);
}

function openBaseballCardSearch(jugadorID, nombre, edad, inscripcionID) {
  const eq = state.equiposEnriched.find(e => e.InscripcionID === inscripcionID);
  if (!eq) return;
  const cached = state.playerCache[inscripcionID] || { bateo: [] };
  const bateoMap = {};
  (cached.bateo || []).forEach(b => { b.SLG = calcSLG(b); bateoMap[b.JugadorID] = b; });
  const stats = bateoMap[jugadorID] || {};
  renderBaseballCard(nombre, edad, stats, eq);
}

function renderBaseballCard(nombre, edad, s, eq) {
  const img = logoUrl(eq.foto);
  const avg = s.PCT || '.000';
  const slg = s.SLG || calcSLG(s);
  const iso = calcISO(s);
  const pitch = recPitcheo(s, edad);
  const html = `
    <div class="baseball-card" id="bc-printable">
      <div class="bc-header">
        ${img ? `<img class="bc-team-logo" src="${img}" alt="" onerror="this.style.display='none'">` : ''}
        <div class="bc-player-name">${nombre}</div>
        <div class="bc-team-name">${eq.teamName} · ${eq.catLabel || ''}</div>
        <div class="bc-meta">
          ${edad ? `<span>🎂 ${edad} años</span>` : ''}
          <span>📊 ${eq.grupo}</span>
          <span>🏟️ ${eq.wins || 0}-${eq.loses || 0}</span>
        </div>
      </div>
      <div class="bc-body">
        <div class="bc-stats-grid">
          <div class="bc-stat"><div class="bc-stat-val">${avg}</div><div class="bc-stat-label">AVG</div></div>
          <div class="bc-stat"><div class="bc-stat-val">${parseFloat(slg).toFixed(3)}</div><div class="bc-stat-label">SLG</div></div>
          <div class="bc-stat"><div class="bc-stat-val">${iso}</div><div class="bc-stat-label">ISO</div></div>
          <div class="bc-stat"><div class="bc-stat-val">${s.H || 0}</div><div class="bc-stat-label">H</div></div>
          <div class="bc-stat"><div class="bc-stat-val">${s.H2 || 0}</div><div class="bc-stat-label">2B</div></div>
          <div class="bc-stat"><div class="bc-stat-val">${s.H3 || 0}</div><div class="bc-stat-label">3B</div></div>
          <div class="bc-stat"><div class="bc-stat-val">${s.HR || 0}</div><div class="bc-stat-label">HR</div></div>
          <div class="bc-stat"><div class="bc-stat-val">${s.R || 0}</div><div class="bc-stat-label">R</div></div>
        </div>
        <div class="bc-pitch-rec">
          <div class="bc-pitch-label">Recomendación Pitcheo</div>
          <div class="bc-pitch-val">${pitch}</div>
        </div>
      </div>
      <div class="bc-footer">TARJETÓN · LIGA INFANTIL Y JUVENIL DE BÉISBOL YUCATÁN · TEMPORADA 108</div>
    </div>`;
  document.getElementById('baseball-card-content').innerHTML = html;
  document.getElementById('baseball-card-modal').style.display = '';
}

function closeBaseballCard(e) {
  if (e && e.target !== e.currentTarget) return;
  document.getElementById('baseball-card-modal').style.display = 'none';
}

function downloadBaseballCard() {
  const card = document.getElementById('bc-printable');
  if (!card) return;
  const win = window.open('', '_blank');
  win.document.write(`<!DOCTYPE html><html><head><title>Tarjeta de Jugador</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=Bebas+Neue&display=swap" rel="stylesheet">
    <style>
      * { margin:0; padding:0; box-sizing:border-box; }
      body { font-family:'Inter',sans-serif; background:#0b1118; display:flex; align-items:center; justify-content:center; min-height:100vh; padding:2rem; }
      :root { --bg-surface:#111922; --border:#1e2d3d; --text:#e8edf2; --text-muted:#7a8fa3; --text-dim:#4a5d70;
        --primary:#22c55e; --accent:#f59e0b; --radius:12px; --radius-sm:8px; --primary-glow:rgba(34,197,94,.15); }
      .baseball-card { max-width:400px; width:100%; border-radius:var(--radius); overflow:hidden;
        background:linear-gradient(145deg,#1a2636 0%,#0b1118 50%,#1a2636 100%);
        border:3px solid var(--accent); box-shadow:0 8px 40px rgba(0,0,0,.5),inset 0 1px 0 rgba(255,255,255,.05); position:relative; }
      .baseball-card::before { content:''; position:absolute; inset:4px; border:1px solid rgba(245,158,11,.2);
        border-radius:calc(var(--radius)-2px); pointer-events:none; z-index:1; }
      .bc-header { padding:1.5rem 1.25rem 1rem; background:linear-gradient(135deg,rgba(34,197,94,.15),rgba(245,158,11,.1));
        text-align:center; position:relative; }
      .bc-team-logo { width:56px; height:56px; border-radius:50%; object-fit:cover; border:3px solid var(--accent);
        margin-bottom:.5rem; background:var(--bg-surface); }
      .bc-player-name { font-family:'Bebas Neue',sans-serif; font-size:1.8rem; letter-spacing:1px; line-height:1.1;
        background:linear-gradient(135deg,#fff,var(--accent)); -webkit-background-clip:text; -webkit-text-fill-color:transparent; }
      .bc-team-name { font-size:.78rem; color:var(--text-muted); margin-top:.15rem; }
      .bc-meta { display:flex; justify-content:center; gap:1rem; margin-top:.5rem; font-size:.72rem; color:var(--text-dim); }
      .bc-meta span { display:flex; align-items:center; gap:.25rem; }
      .bc-body { padding:1rem 1.25rem 1.25rem; }
      .bc-stats-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:.5rem; margin-bottom:.75rem; }
      .bc-stat { text-align:center; padding:.5rem .25rem; background:var(--bg-surface); border-radius:var(--radius-sm);
        border:1px solid var(--border); }
      .bc-stat-val { font-family:'Bebas Neue',sans-serif; font-size:1.4rem; color:var(--primary); line-height:1; }
      .bc-stat-label { font-size:.55rem; font-weight:700; color:var(--text-dim); text-transform:uppercase; letter-spacing:.5px; margin-top:.15rem; }
      .bc-pitch-rec { text-align:center; padding:.6rem; background:linear-gradient(135deg,rgba(245,158,11,.08),rgba(34,197,94,.08));
        border-radius:var(--radius-sm); border:1px solid rgba(245,158,11,.15); }
      .bc-pitch-label { font-size:.6rem; font-weight:700; color:var(--text-muted); text-transform:uppercase; letter-spacing:1px; margin-bottom:.25rem; }
      .bc-pitch-val { font-family:'Bebas Neue',sans-serif; font-size:1.3rem; color:var(--accent); letter-spacing:2px; }
      .bc-footer { text-align:center; padding:.5rem; font-size:.55rem; color:var(--text-dim); letter-spacing:1px;
        border-top:1px solid var(--border); }
      @media print { body { background:#fff; } }
    </style>
  </head><body>${card.outerHTML}</body></html>`);
  win.document.close();
}

// ══════════════════════════════════════════
// FEATURE 2: COACH TOOLS
// ══════════════════════════════════════════

function loadCoachSection() {
  const sel = document.getElementById('coach-team-select');
  sel.innerHTML = '<option value="">Seleccionar equipo...</option>' +
    state.equiposEnriched.map(eq =>
      `<option value="${eq.InscripcionID}">${eq.teamName} (${eq.catLabel})</option>`
    ).join('');
  const profile = JSON.parse(localStorage.getItem('user_profile') || '{}');
  if (profile.favTeam) sel.value = profile.favTeam;
  onCoachTeamChange();
}

function switchCoachTab(tab) {
  document.querySelectorAll('.coach-tab-content').forEach(el => el.classList.remove('active'));
  document.getElementById('coach-tab-' + tab).classList.add('active');
  document.querySelectorAll('.coach-tabs .pill').forEach(p => p.classList.remove('active'));
  event.target.classList.add('active');
}

function onCoachTeamChange() {
  const inscID = document.getElementById('coach-team-select').value;
  if (!inscID) {
    document.getElementById('coach-lineup-list').innerHTML = '';
    document.getElementById('coach-lineup-empty').style.display = '';
    document.getElementById('coach-rotation-list').innerHTML = '';
    document.getElementById('coach-rotation-empty').style.display = '';
    document.getElementById('coach-notes-area').value = '';
    return;
  }
  document.getElementById('coach-lineup-empty').style.display = 'none';
  document.getElementById('coach-rotation-empty').style.display = 'none';
  loadCoachLineup(inscID);
  loadCoachRotation(inscID);
  loadCoachNotes(inscID);
}

function getCoachPlayers(inscID) {
  const cached = state.playerCache[inscID];
  if (!cached) return [];
  const bateoMap = {};
  (cached.bateo || []).forEach(b => { b.SLG = calcSLG(b); bateoMap[b.JugadorID] = b; });
  return cached.jugadores.map(j => ({
    id: j.JugadorID,
    nombre: j.nombre,
    edad: calcularEdad(j.FechaNacimiento),
    stats: bateoMap[j.JugadorID] || {}
  }));
}

function loadCoachLineup(inscID) {
  const players = getCoachPlayers(inscID);
  if (players.length === 0) {
    loadCoachPlayersAndRetry(inscID, 'lineup');
    return;
  }
  const savedKey = `coach_lineup_${inscID}`;
  let order = JSON.parse(localStorage.getItem(savedKey) || 'null');
  if (!order || order.length === 0) {
    order = players.slice(0, 9).map(p => p.id);
  }
  const ordered = order.map(id => players.find(p => p.id === id)).filter(Boolean);
  const remaining = players.filter(p => !order.includes(p.id));
  const addSelect = remaining.length > 0 ? `
    <div class="coach-add-player">
      <select id="coach-lineup-add-select">
        <option value="">Agregar jugador...</option>
        ${remaining.map(p => `<option value="${p.id}">${p.nombre} (AVG: ${p.stats.PCT || '-'})</option>`).join('')}
      </select>
      <button class="btn btn-primary btn-sm" onclick="addToCoachLineup('${inscID}')">+ Agregar</button>
    </div>` : '';
  document.getElementById('coach-lineup-list').innerHTML = addSelect +
    ordered.map((p, i) => renderCoachLineupItem(p, i, ordered.length, inscID, 'lineup')).join('');
}

function loadCoachRotation(inscID) {
  const players = getCoachPlayers(inscID);
  if (players.length === 0) {
    loadCoachPlayersAndRetry(inscID, 'rotation');
    return;
  }
  const cached = state.playerCache[inscID];
  const pitcheoMap = {};
  if (cached && cached.pitcheo) {
    cached.pitcheo.forEach(p => { pitcheoMap[p.JugadorID] = p; });
  }
  const savedKey = `coach_rotation_${inscID}`;
  let order = JSON.parse(localStorage.getItem(savedKey) || 'null');
  if (!order || order.length === 0) {
    order = players.slice(0, 5).map(p => p.id);
  }
  const ordered = order.map(id => {
    const pl = players.find(p => p.id === id);
    if (pl) pl.pitcheo = pitcheoMap[pl.id] || {};
    return pl;
  }).filter(Boolean);
  const remaining = players.filter(p => !order.includes(p.id));
  const addSelect = remaining.length > 0 ? `
    <div class="coach-add-player">
      <select id="coach-rotation-add-select">
        <option value="">Agregar pitcher...</option>
        ${remaining.map(p => `<option value="${p.id}">${p.nombre}</option>`).join('')}
      </select>
      <button class="btn btn-primary btn-sm" onclick="addToCoachRotation('${inscID}')">+ Agregar</button>
    </div>` : '';
  document.getElementById('coach-rotation-list').innerHTML = addSelect +
    ordered.map((p, i) => {
      const ps = p.pitcheo || {};
      const era = ps.ERA || ps.PCT || '-';
      const k = ps.SO || ps.K || '-';
      const bb = ps.BB || '-';
      return `
        <div class="coach-lineup-item">
          <div class="coach-lineup-pos">${i + 1}</div>
          <div class="coach-lineup-info">
            <div class="coach-lineup-name">${p.nombre}</div>
            <div class="coach-lineup-stats">ERA: ${era} · K: ${k} · BB: ${bb}</div>
          </div>
          <div class="coach-lineup-arrows">
            <button class="coach-arrow-btn" onclick="moveCoachItem('${inscID}','rotation',${i},-1)" ${i===0?'disabled':''}>▲</button>
            <button class="coach-arrow-btn" onclick="moveCoachItem('${inscID}','rotation',${i},1)" ${i===ordered.length-1?'disabled':''}>▼</button>
          </div>
          <button class="btn btn-sm" onclick="removeCoachItem('${inscID}','rotation','${p.id}')" style="font-size:.7rem;padding:.2rem .5rem" title="Quitar">✕</button>
        </div>`;
    }).join('');
}

function renderCoachLineupItem(p, i, total, inscID, type) {
  const avg = p.stats.PCT || '-';
  return `
    <div class="coach-lineup-item">
      <div class="coach-lineup-pos">${i + 1}</div>
      <div class="coach-lineup-info">
        <div class="coach-lineup-name">${p.nombre}</div>
        <div class="coach-lineup-stats">AVG: ${avg} · SLG: ${p.stats.SLG ? parseFloat(p.stats.SLG).toFixed(3) : '-'}</div>
      </div>
      <div class="coach-lineup-arrows">
        <button class="coach-arrow-btn" onclick="moveCoachItem('${inscID}','${type}',${i},-1)" ${i===0?'disabled':''}>▲</button>
        <button class="coach-arrow-btn" onclick="moveCoachItem('${inscID}','${type}',${i},1)" ${i===total-1?'disabled':''}>▼</button>
      </div>
      <button class="btn btn-sm" onclick="removeCoachItem('${inscID}','${type}','${p.id}')" style="font-size:.7rem;padding:.2rem .5rem" title="Quitar">✕</button>
    </div>`;
}

function moveCoachItem(inscID, type, idx, dir) {
  const key = type === 'lineup' ? `coach_lineup_${inscID}` : `coach_rotation_${inscID}`;
  const players = getCoachPlayers(inscID);
  let order = JSON.parse(localStorage.getItem(key) || 'null');
  if (!order) order = players.slice(0, type === 'lineup' ? 9 : 5).map(p => p.id);
  const newIdx = idx + dir;
  if (newIdx < 0 || newIdx >= order.length) return;
  [order[idx], order[newIdx]] = [order[newIdx], order[idx]];
  localStorage.setItem(key, JSON.stringify(order));
  if (type === 'lineup') loadCoachLineup(inscID);
  else loadCoachRotation(inscID);
}

function addToCoachLineup(inscID) {
  const sel = document.getElementById('coach-lineup-add-select');
  const id = sel.value;
  if (!id) return;
  const key = `coach_lineup_${inscID}`;
  let order = JSON.parse(localStorage.getItem(key) || '[]');
  if (!order.includes(id)) order.push(id);
  localStorage.setItem(key, JSON.stringify(order));
  loadCoachLineup(inscID);
}

function addToCoachRotation(inscID) {
  const sel = document.getElementById('coach-rotation-add-select');
  const id = sel.value;
  if (!id) return;
  const key = `coach_rotation_${inscID}`;
  let order = JSON.parse(localStorage.getItem(key) || '[]');
  if (!order.includes(id)) order.push(id);
  localStorage.setItem(key, JSON.stringify(order));
  loadCoachRotation(inscID);
}

function removeCoachItem(inscID, type, playerId) {
  const key = type === 'lineup' ? `coach_lineup_${inscID}` : `coach_rotation_${inscID}`;
  let order = JSON.parse(localStorage.getItem(key) || '[]');
  order = order.filter(id => id !== playerId);
  localStorage.setItem(key, JSON.stringify(order));
  if (type === 'lineup') loadCoachLineup(inscID);
  else loadCoachRotation(inscID);
}

async function loadCoachPlayersAndRetry(inscID, tab) {
  const container = document.getElementById(tab === 'lineup' ? 'coach-lineup-list' : 'coach-rotation-list');
  container.innerHTML = '<div class="empty-state"><div class="inline-spinner"></div> Cargando jugadores...</div>';
  try {
    const [data, bateo, pitcheo] = await Promise.all([
      fetchJugadores(inscID), fetchBateo(inscID), fetchPitcheo(inscID)
    ]);
    state.playerCache[inscID] = {
      jugadores: data ? (data.jugadores || []) : [],
      bateo: bateo || [],
      pitcheo: pitcheo || []
    };
    if (tab === 'lineup') loadCoachLineup(inscID);
    else loadCoachRotation(inscID);
  } catch(e) {
    container.innerHTML = '<div class="empty-state"><p>Error al cargar jugadores</p></div>';
  }
}

function loadCoachNotes(inscID) {
  const key = `coach_notes_${inscID}`;
  const saved = localStorage.getItem(key) || '';
  document.getElementById('coach-notes-area').value = saved;
  document.getElementById('coach-notes-saved').style.display = 'none';
}

function saveCoachNotes() {
  const inscID = document.getElementById('coach-team-select').value;
  if (!inscID) return;
  const key = `coach_notes_${inscID}`;
  localStorage.setItem(key, document.getElementById('coach-notes-area').value);
  const msg = document.getElementById('coach-notes-saved');
  msg.style.display = '';
  setTimeout(() => { msg.style.display = 'none'; }, 2000);
}

// ══════════════════════════════════════════
// FEATURE 3: FAVORITE TEAM
// ══════════════════════════════════════════

function toggleFavTeam(inscID) {
  const current = localStorage.getItem('fav_team');
  if (current === inscID) {
    localStorage.removeItem('fav_team');
  } else {
    localStorage.setItem('fav_team', inscID);
    const profile = JSON.parse(localStorage.getItem('user_profile') || '{}');
    profile.favTeam = inscID;
    localStorage.setItem('user_profile', JSON.stringify(profile));
  }
  filterEquipos();
  renderFavTeamBanner();
  updateMiEquipoBtn();
}

function renderFavTeamBanner() {
  const banner = document.getElementById('fav-team-banner');
  const favId = localStorage.getItem('fav_team');
  if (!favId || state.equiposEnriched.length === 0) {
    banner.style.display = 'none';
    return;
  }
  const eq = state.equiposEnriched.find(e => e.InscripcionID === favId);
  if (!eq) { banner.style.display = 'none'; return; }
  const img = logoUrl(eq.foto);
  const record = eq.wins != null ? `${eq.wins}-${eq.loses}` : '';
  const pos = eq.position ? `#${eq.position} en ${eq.grupo}` : eq.grupo;
  banner.style.display = '';
  banner.innerHTML = `
    <div class="fav-team-card" onclick="openEquipoDetail('${eq.InscripcionID}');navigateTo('equipos')">
      ${img ? `<img src="${img}" alt="" onerror="this.style.display='none'">` : ''}
      <div class="fav-team-info">
        <div class="fav-team-label">⭐ Mi Equipo Favorito</div>
        <div class="fav-team-name">${eq.teamName}</div>
        <div class="fav-team-meta">${eq.catLabel} · ${pos}</div>
      </div>
      <div class="fav-team-record">${record}</div>
    </div>`;
}

function goToFavTeam() {
  const favId = localStorage.getItem('fav_team');
  if (!favId) return;
  navigateTo('equipos');
  setTimeout(() => openEquipoDetail(favId), 100);
}

function updateMiEquipoBtn() {
  const btn = document.getElementById('btnMiEquipo');
  const favId = localStorage.getItem('fav_team');
  btn.style.display = favId ? '' : 'none';
}

// ══════════════════════════════════════════
// FEATURE 4: USER PROFILE
// ══════════════════════════════════════════

function openProfileModal() {
  const modal = document.getElementById('profile-modal');
  const profile = JSON.parse(localStorage.getItem('user_profile') || '{}');
  document.getElementById('profile-name').value = profile.name || '';
  document.getElementById('profile-role').value = profile.role || '';
  const favSel = document.getElementById('profile-fav-team');
  favSel.innerHTML = '<option value="">Ninguno</option>' +
    state.equiposEnriched.map(eq =>
      `<option value="${eq.InscripcionID}" ${profile.favTeam === eq.InscripcionID ? 'selected' : ''}>${eq.teamName} (${eq.catLabel})</option>`
    ).join('');
  document.getElementById('profile-saved-msg').style.display = 'none';
  modal.style.display = '';
}

function closeProfileModal(e) {
  if (e && e.target !== e.currentTarget) return;
  document.getElementById('profile-modal').style.display = 'none';
}

function saveProfile() {
  const name = document.getElementById('profile-name').value.trim();
  const role = document.getElementById('profile-role').value;
  const favTeam = document.getElementById('profile-fav-team').value;
  const profile = { name, role, favTeam };
  localStorage.setItem('user_profile', JSON.stringify(profile));
  if (favTeam) {
    localStorage.setItem('fav_team', favTeam);
  } else {
    localStorage.removeItem('fav_team');
  }
  const msg = document.getElementById('profile-saved-msg');
  msg.style.display = '';
  setTimeout(() => { msg.style.display = 'none'; }, 2000);
  loadUserProfile();
  renderFavTeamBanner();
  updateMiEquipoBtn();
  updateCoachNavVisibility();
}

function loadUserProfile() {
  const profile = JSON.parse(localStorage.getItem('user_profile') || '{}');
  const greetEl = document.getElementById('user-greeting-bar');
  if (profile.name) {
    greetEl.style.display = '';
    greetEl.innerHTML = `<div class="user-greeting"><span class="greeting-wave">👋</span> Hola, ${profile.name}!</div>`;
  } else {
    greetEl.style.display = 'none';
  }
  updateMiEquipoBtn();
  updateCoachNavVisibility();
}

function updateCoachNavVisibility() {
  const profile = JSON.parse(localStorage.getItem('user_profile') || '{}');
  const li = document.getElementById('nav-coach-li');
  if (li) {
    li.style.display = profile.role === 'Coach' ? '' : 'none';
  }
}

init();

// Initialize animations after DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  initScrollAnimations();
  initRippleEffect();
  initHeroParticles();
  initParallax();
});

if (document.readyState !== 'loading') {
  initScrollAnimations();
  initRippleEffect();
  initHeroParticles();
  initParallax();
}
