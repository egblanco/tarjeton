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
}

function toggleMenu() {
  document.getElementById('navLinks').classList.toggle('open');
  document.querySelector('.nav-toggle').classList.toggle('open');
}

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
    return `
      <tr onclick="openEquipoByName('${r.equipo.teamName.replace(/'/g, "\\'")}', '${r.equipo.categoriaID}')" style="cursor:pointer">
        <td class="jugador-nombre">${r.jugador.nombre}</td>
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

loadTheme();
updateOnlineStatus();

// Update navigateTo for new sections
const _originalNavigateTo = navigateTo;
navigateTo = function(section) {
  _originalNavigateTo(section);
  if (section === 'prediccion') populatePredictionSelects();
  if (section === 'admin' && adminAuthenticated) initAdminPanel();
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
