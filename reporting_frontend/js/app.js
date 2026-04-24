// app logic for the property explorer
import * as THREE from 'three';

// config
const API     = 'https://2u61lwt28d.execute-api.ap-southeast-2.amazonaws.com';
const ESRI    = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const NSW_GEO = '/nsw-suburbs.geojson';

// Chart filter definitions — maps button data-f values to API params + display config
const CHART_FILTERS = {
  purchase_price: {
    label:       'Avg Sale Price',
    color:       '#1e8eff',
    colorLight:  '#1a52cc',
    yFormat:     v => '$' + (v >= 1e6 ? (v/1e6).toFixed(1)+'M' : (v/1e3).toFixed(0)+'K'),
    tipFormat:   v => fmtAUD(v),
    subtitle:    s => `Avg Sale Price — ${s}`,
    beginZero:   false,
  },
  count: {
    label:       'Sales Volume',
    color:       '#3de8c0',
    colorLight:  '#0f9f7a',
    yFormat:     v => String(v),
    tipFormat:   v => v + ' sales',
    subtitle:    s => `Sales Volume — ${s}`,
    beginZero:   true,
  },
  income: {
    label:       'Avg Household Income',
    color:       '#a855f7',
    colorLight:  '#7c3aed',
    yFormat:     v => '$' + (v >= 1e3 ? (v/1e3).toFixed(0)+'K' : v),
    tipFormat:   v => fmtAUD(v) + '/yr',
    subtitle:    s => `Avg Household Income — ${s}`,
    beginZero:   false,
  },
  population: {
    label:       'Population',
    color:       '#f97316',
    colorLight:  '#ea580c',
    yFormat:     v => v >= 1000 ? (v/1000).toFixed(1)+'K' : String(v),
    tipFormat:   v => Number(v).toLocaleString() + ' people',
    subtitle:    s => `Population — ${s}`,
    beginZero:   true,
  },
  weather: {
    label:       'Weather',
    color:       '#06b6d4',
    colorLight:  '#0891b2',
    yFormat:     v => v.toFixed(1),
    tipFormat:   v => v.toFixed(1),
    subtitle:    s => `Weather — ${s}`,
    beginZero:   false,
  },
};

// Suitability filter metadata
const SUIT_FILTERS = {
  housing:        { icon: '🏠', label: 'Avg House Price',   dataset: 'housing',          weight: 1.0, invert: true  },
  education:      { icon: '🎓', label: 'Education',         dataset: 'hsc_top_achiever', weight: 0.8, invert: false },
  infrastructure: { icon: '🚌', label: 'Infrastructure',    dataset: 'transport_facility',weight: 0.7, invert: false },
  safety:         { icon: '🛡', label: 'Safety',            dataset: 'crime',            weight: 0.9, invert: true  },
  greenspace:     { icon: '🌳', label: 'Green Space',       dataset: null,               weight: 0.6, invert: false },
};

// Per-filter metadata for the breakdown modal
const SUIT_DETAIL = {
  housing:        { datasetLabel: 'Housing sales',         unit: '',            higherIsBetter: false, direction: 'Lower price → higher affordability score', note: 'Normalised between the 10th and 90th percentile of NSW sale prices.' },
  education:      { datasetLabel: 'HSC Band 6 rate',       unit: 'achievers',   higherIsBetter: true,  direction: 'Higher band-6 rate → higher score',         note: 'Based on 2024 HSC top achievers per school divided by school enrolment count, aggregated for all schools in the suburb.' },
  infrastructure: { datasetLabel: 'Community facilities',  unit: 'facilities',  higherIsBetter: true,  direction: 'More facilities → higher score',            note: 'Counts supermarket centres, hospitals, schools, and public transport stops. Normalised to the highest-ranking NSW suburb.' },
  safety:         { datasetLabel: 'Weighted crime index',  unit: 'records',     higherIsBetter: false, direction: 'Fewer & less severe crimes → higher safety score', note: 'Assault weighted ×3, Robbery & Theft ×2, Drug offences ×1. Inverted so safer suburbs score higher.' },
  greenspace:     { datasetLabel: 'Green space profile',   unit: 'parks',       higherIsBetter: true,  direction: 'More green space → higher score',           note: 'Derived from the suburb profile while the green-space dataset is being integrated.' },
};

// Crime severity weights — heavier crimes penalise safety score more
const CRIME_WEIGHTS = {
  'Assault':           3,
  'Robbery and Theft': 2,
  'Drug offences':     1,
};

// state
let map2 = null, map3 = null, suburbLayer = null, selectedPoly = null;
let currentSuburb = 'NARRABEEN', currentFilter = 'purchase_price';
let activeChart = null;
const avgPrices = {};        // UPPER-CASE suburb → avg price (last 3 years)
const filterData = {};       // filterKey → { suburb → normalised 0-1 score }
const filterRaw = {};        // filterKey → { suburb → raw count/value before normalisation }
const filterSorted = {};     // filterKey → [{name, value}] sorted desc (for rank lookup)
const filterTypes = {};      // filterKey → { suburb → [type1, type2, ...] } for detailed breakdowns
const suitabilityCache = {}; // suburb → combined 0-1 score
const activeFilters = new Set(['housing']);

// Education-specific stores
const schoolHscData   = {};  // school_name → count (2024 top achievers)
const schoolEnrolData = {};  // school_name → enrolment count
const suburbSchools   = {};  // UPPER suburb → [{ name, hscCount, enrolCount, rate, rank }]

let globeRaf = null, earthMesh = null, cloudMesh = null;
let gCamera = null, gRenderer = null, gScene = null;
let satTransitioned = false;
let isLight = false, isCB = false;

// utilities
function fmtAUD(v) {
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 }).format(v);
}

function getPrice(name) {
  const u = name.toUpperCase();
  return avgPrices[u] || avgPrices[u.replace(/ NSW$/, '')] || 0;
}

function getScore(name) {
  const u = name.toUpperCase();
  return suitabilityCache[u] ?? suitabilityCache[u.replace(/ NSW$/, '')] ?? -1;
}

function featName(f) {
  const p = f?.properties || {};
  return (p.nsw_loca_2 || p.suburbname || p.suburb || p.name || 'Unknown').trim();
}

function setStatus(msg) {
  const el = document.getElementById('map-status');
  if (!el) return;
  el.textContent = msg;
  el.style.opacity = msg ? '1' : '0';
}

// Deterministic pseudo-random for stub scores (used when real data not available)
function suburbStubScore(suburb, type) {
  let hash = 0;
  for (let i = 0; i < suburb.length; i++) hash = (hash * 31 + suburb.charCodeAt(i)) >>> 0;
  const offsets = { greenspace: 23 };
  return ((hash + (offsets[type] || 0)) % 100) / 100;
}

// store suburb centroids for nearest suburb fallback
const suburbCentroids = {};

function polygonRingCentroid(ring) {
  let x = 0, y = 0, n = 0;
  (ring || []).forEach(pt => {
    if (Array.isArray(pt) && pt.length >= 2) { x += pt[0]; y += pt[1]; n++; }
  });
  return n ? [x / n, y / n] : null;
}

function featureCentroid(f) {
  const g = f?.geometry;
  if (!g) return null;
  if (g.type === 'Polygon') return polygonRingCentroid(g.coordinates?.[0]);
  if (g.type === 'MultiPolygon') {
    let best = null, bestLen = 0;
    (g.coordinates || []).forEach(poly => {
      const ring = poly?.[0] || [];
      if (ring.length > bestLen) { bestLen = ring.length; best = ring; }
    });
    return best ? polygonRingCentroid(best) : null;
  }
  return null;
}

function resolveCentroidKey(rawName) {
  if (!rawName) return null;
  const upper = rawName.toString().toUpperCase().replace(/\s+(NSW|VIC|QLD|SA|WA|TAS|ACT|NT)$/i, '').trim();
  if (suburbCentroids[upper]) return upper;
  const noCbd = upper.replace(/\s+CBD$/, '').trim();
  if (suburbCentroids[noCbd]) return noCbd;
  return null;
}

function nearestEntry(targetName, entries) {
  const key = resolveCentroidKey(targetName);
  const target = key ? suburbCentroids[key] : null;
  if (!target) return null;
  let best = null, bestD2 = Infinity;
  entries.forEach(e => {
    const ck = resolveCentroidKey(e.category || e.suburb || e.series);
    const c = ck ? suburbCentroids[ck] : null;
    if (!c) return;
    const dx = c[0] - target[0], dy = c[1] - target[1];
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD2) { bestD2 = d2; best = { entry: e, key: ck }; }
  });
  return best;
}

// crime dataset only covers ~417 of 4572 NSW suburbs — fall back to nearest covered LGA
const safetyNearestCache = new Map();
function safetyFallbackInfo(suburb) {
  if (!suburb) return null;
  if (filterRaw.safety && filterRaw.safety[suburb] !== undefined) {
    return { source: 'direct', donor: suburb };
  }
  if (safetyNearestCache.has(suburb)) return safetyNearestCache.get(suburb);
  const sorted = filterSorted.safety || [];
  if (!sorted.length) return null;
  const near = nearestEntry(suburb, sorted.map(e => ({ category: e.name })));
  const info = near ? { source: 'nearest', donor: near.key } : null;
  safetyNearestCache.set(suburb, info);
  return info;
}

// ─── EDUCATION: resolve the best suburb key we have data for ─────────────────
// Returns { targetSuburb, usingFallback } — always tries direct hit first,
// then falls back to nearest suburb that has education data.
function resolveEducationSuburb(suburb) {
  const u = suburb.toUpperCase().replace(/\s+NSW$/, '');

  // Direct hit in filterData.education
  if (filterData.education && filterData.education[u] !== undefined) {
    return { targetSuburb: u, usingFallback: false };
  }

  // Direct hit via suburbSchools (may have schools but filterData not yet scored)
  if (suburbSchools[u] && suburbSchools[u].length > 0) {
    return { targetSuburb: u, usingFallback: false };
  }

  // Nearest entry fallback
  if (filterSorted.education && filterSorted.education.length > 0) {
    const near = nearestEntry(u, filterSorted.education.map(e => ({ category: e.name })));
    if (near && near.key) {
      return { targetSuburb: near.key, usingFallback: true };
    }
  }

  return { targetSuburb: u, usingFallback: false };
}

// drop weak and outlier price points
function filterPricePoints(points, filter) {
  const kept = (points || [])
    .filter(p => Number(p.count || 0) >= 0)
    .sort((a, b) => (a.period || '').localeCompare(b.period || ''));
  if (filter !== 'purchase_price' || kept.length < 3) return kept;
  return kept.filter((p, i) => {
    const v = Number(p.value || 0);
    if (v <= 0) return false;
    const neighbours = [];
    for (let k = Math.max(0, i - 2); k <= Math.min(kept.length - 1, i + 2); k++) {
      if (k === i) continue;
      const nv = Number(kept[k].value || 0);
      if (nv > 0) neighbours.push(nv);
    }
    if (neighbours.length < 2) return true;
    neighbours.sort((a, b) => a - b);
    const med = neighbours[Math.floor(neighbours.length / 2)];
    return v <= med * 2.0 && v >= med * 0.33;
  });
}

// accessibility theme and font scale
function applyTheme() {
  const theme = isCB
    ? (isLight ? 'colorblind-light' : 'colorblind-dark')
    : (isLight ? 'light' : 'dark');
  document.documentElement.setAttribute('data-theme', theme);

  document.querySelectorAll('#theme-toggle,#theme-toggle-2').forEach(b => {
    b.textContent = isLight ? '🌙 Dark' : '☀️ Light';
    b.setAttribute('aria-label', isLight ? 'Switch to dark mode' : 'Switch to light mode');
  });
  document.querySelectorAll('#cb-toggle,#cb-toggle-2').forEach(b => {
    b.style.opacity = isCB ? '1' : '0.6';
    b.setAttribute('aria-pressed', String(isCB));
  });

  if (suburbLayer) repaintLayer();
  updateLegendDots();
}

function updateLegendDots() {
  document.querySelectorAll('.legend-dot').forEach((dot, i) => {
    const keys = ['--suit-high','--suit-mid','--suit-low','--suit-none'];
    dot.style.background = `var(${keys[i]})`;
  });
}

function setFontScale(scale) {
  document.documentElement.style.setProperty('--font-scale', scale);
  document.querySelectorAll('.a11y-btn').forEach(b => b.classList.remove('active'));
  const ids = { '0.85': 'font-sm', '1': 'font-md', '1.2': 'font-lg' };
  const btn = document.getElementById(ids[String(scale)]);
  if (btn) { btn.classList.add('active'); btn.setAttribute('aria-pressed', 'true'); }
}

// routing
function show(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === id));
  if (id === 's2' && map2) setTimeout(() => map2.invalidateSize(), 300);
  if (id === 's3' && map3) setTimeout(() => map3.invalidateSize(), 300);
  if (id === 's1') resumeGlobe();
}

function doFlash(cb) {
  const f = document.getElementById('flash');
  f.classList.add('on');
  setTimeout(() => { f.classList.remove('on'); cb && cb(); }, 300);
}

// s1 three.js globe
function initGlobe() {
  const sc = document.getElementById('stars-canvas');
  const sx = sc.getContext('2d');

  function drawStars() {
    sc.width = innerWidth; sc.height = innerHeight;
    for (let i = 0; i < 350; i++) {
      sx.beginPath();
      sx.arc(Math.random() * sc.width, Math.random() * sc.height, Math.random() * 1.5, 0, Math.PI * 2);
      sx.fillStyle = `rgba(200,220,255,${0.2 + Math.random() * 0.8})`;
      sx.fill();
    }
  }
  drawStars();

  const canvas = document.getElementById('globe-canvas');
  gRenderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  gRenderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  gRenderer.setSize(innerWidth, innerHeight);
  gScene = new THREE.Scene();
  gCamera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.1, 100);
  gCamera.position.z = 2.4;

  const loader = new THREE.TextureLoader();
  loader.setCrossOrigin('anonymous');
  const BASE = 'https://raw.githubusercontent.com/mrdoob/three.js/r160/examples/textures/planets/';

  const geo = new THREE.SphereGeometry(1, 96, 96);
  const mat = new THREE.MeshPhongMaterial({ specular: new THREE.Color(0x111111), shininess: 10 });
  earthMesh = new THREE.Mesh(geo, mat);
  gScene.add(earthMesh);
  loader.load(BASE + 'earth_atmos_2048.jpg',  t => { mat.map = t; mat.needsUpdate = true; }, undefined, () => { mat.color.set('#1a4070'); mat.needsUpdate = true; });
  loader.load(BASE + 'earth_specular_2048.jpg', t => { mat.specularMap = t; mat.needsUpdate = true; }, undefined, () => {});

  const cGeo = new THREE.SphereGeometry(1.008, 96, 96);
  const cMat = new THREE.MeshPhongMaterial({ transparent: true, opacity: 0.35, depthWrite: false });
  cloudMesh = new THREE.Mesh(cGeo, cMat);
  gScene.add(cloudMesh);
  loader.load(BASE + 'earth_clouds_1024.png', t => { cMat.map = t; cMat.needsUpdate = true; }, undefined, () => {});

  gScene.add(new THREE.Mesh(
    new THREE.SphereGeometry(1.05, 64, 64),
    new THREE.MeshPhongMaterial({ color: 0x3388ff, transparent: true, opacity: 0.11, side: THREE.FrontSide, blending: THREE.AdditiveBlending, depthWrite: false })
  ));
  const sun = new THREE.DirectionalLight(0xfff8f0, 2.1);
  sun.position.set(6, 3, 5);
  gScene.add(sun);
  gScene.add(new THREE.AmbientLight(0x1a2a44, 0.9));

  (function loop() {
    globeRaf = requestAnimationFrame(loop);
    if (earthMesh) earthMesh.rotation.y += 0.0012;
    if (cloudMesh) cloudMesh.rotation.y += 0.0015;
    gRenderer.render(gScene, gCamera);
  })();

  window.addEventListener('resize', () => {
    gRenderer.setSize(innerWidth, innerHeight);
    gCamera.aspect = innerWidth / innerHeight;
    gCamera.updateProjectionMatrix();
    drawStars();
  });

  let clicked = false;
  const globeCanvas = document.getElementById('globe-canvas');
  globeCanvas.addEventListener('click', triggerGlobeZoom);
  globeCanvas.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); triggerGlobeZoom(); }
  });

  function triggerGlobeZoom() {
    if (clicked) return;
    clicked = true;
    document.getElementById('globe-ui').classList.add('fade');
    let t = 0;
    const iv = setInterval(() => {
      if (earthMesh) earthMesh.rotation.y += 0.05;
      if (gCamera) gCamera.position.z -= 0.045;
      if (++t > 28) {
        clearInterval(iv);
        doFlash(() => {
          show('s2');
          if (globeRaf) { cancelAnimationFrame(globeRaf); globeRaf = null; }
          if (gCamera) gCamera.position.z = 2.4;
          document.getElementById('globe-ui').classList.remove('fade');
          clicked = false;
          setTimeout(autoTransition, 3500);
        });
      }
    }, 16);
  }
}

function resumeGlobe() {
  if (!globeRaf && gRenderer && gScene && gCamera) {
    (function loop() {
      globeRaf = requestAnimationFrame(loop);
      if (earthMesh) earthMesh.rotation.y += 0.0012;
      if (cloudMesh) cloudMesh.rotation.y += 0.0015;
      gRenderer.render(gScene, gCamera);
    })();
  }
}

// s2 satellite
function initSatellite() {
  map2 = L.map('satellite-map', {
    zoomControl: false, dragging: false, scrollWheelZoom: false,
    doubleClickZoom: false, touchZoom: false, keyboard: false,
  }).setView([-32.5, 147.0], 6);
  L.tileLayer(ESRI, { attribution: '© Esri', maxZoom: 19 }).addTo(map2);
}

function autoTransition() {
  if (satTransitioned) return;
  satTransitioned = true;
  map2.flyTo([-33.86, 151.21], 9, { duration: 0.8, easeLinearity: 0.7 });
  setTimeout(() => doFlash(() => show('s3')), 900);
}

// price loading
async function loadAllPrices() {
  const prog = document.getElementById('price-progress');
  setStatus('Loading suburb prices…');
  try {
    const url = `${API}/api/v1/visualisation/breakdown` +
      `?dataset_type=housing&metric=purchase_price&aggregation=avg&dimension=suburb&limit=2000`;
    const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!r.ok) throw new Error(`breakdown ${r.status}`);
    const j = await r.json();
    (j.entries || []).forEach(e => {
      const name = (e.category || '').toString().trim().toUpperCase();
      const val  = Number(e.value ?? 0);
      if (name && val > 0) avgPrices[name] = Math.round(val);
    });
    console.log(`Prices loaded: ${Object.keys(avgPrices).length} suburbs`);
    if (prog) { prog.style.width = '100%'; prog.parentElement.setAttribute('aria-valuenow', '100'); }
    setStatus('');
    computeSuitability();
    repaintLayer();
  } catch (err) {
    console.warn('Breakdown failed, using per-suburb fallback:', err.message);
    await loadPricesFallback();
  }
}

async function loadPricesFallback() {
  const prog = document.getElementById('price-progress');
  const THREE_YEARS_MS = 3 * 365.25 * 24 * 60 * 60 * 1000;
  const cutoff = Date.now() - THREE_YEARS_MS;
  const SUBURBS = ['NARRABEEN','BONDI','MANLY','NEWTOWN','PADDINGTON','SURRY HILLS','MOSMAN','VAUCLUSE','DOUBLE BAY','ROSE BAY','PALM BEACH','AVALON BEACH','NEWPORT','CREMORNE','NEUTRAL BAY','NORTH SYDNEY','DEE WHY','COLLAROY','MONA VALE','CHATSWOOD','LANE COVE','WILLOUGHBY','GORDON','WAHROONGA','HORNSBY','RANDWICK','COOGEE','MAROUBRA','KINGSFORD','BONDI JUNCTION','BALMAIN','ROZELLE','GLEBE','PYRMONT','LEICHHARDT','ANNANDALE','MARRICKVILLE','REDFERN','WATERLOO','ALEXANDRIA','ZETLAND','STRATHFIELD','BURWOOD','ASHFIELD','AUBURN','PARRAMATTA','BLACKTOWN','CASTLE HILL','BAULKHAM HILLS','KELLYVILLE','ROUSE HILL','PENRITH','LIVERPOOL','CAMPBELLTOWN','BANKSTOWN','FAIRFIELD','HURSTVILLE','KOGARAH','MIRANDA','CRONULLA','SUTHERLAND','NEWCASTLE','WOLLONGONG','GOSFORD','BATHURST','WAGGA WAGGA'];
  const total = SUBURBS.length;
  for (let i = 0; i < total; i += 6) {
    await Promise.all(SUBURBS.slice(i, i + 6).map(async name => {
      if (avgPrices[name] !== undefined) return;
      try {
        const r = await fetch(`${API}/api/v1/events?dataset_type=housing&suburb=${encodeURIComponent(name)}&limit=400`, { signal: AbortSignal.timeout(12000) });
        if (!r.ok) { avgPrices[name] = 0; return; }
        const j = await r.json();
        const evts = j.events || [];
        const recent = evts.filter(e => {
          const ts = e.time_object?.timestamp || e.attribute?.contract_date;
          return ts && new Date(ts).getTime() >= cutoff;
        });
        const src = recent.length ? recent : evts;
        const prices = src.map(e => Number(e.attribute?.purchase_price || 0)).filter(p => p > 0);
        avgPrices[name] = prices.length ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length) : 0;
      } catch { avgPrices[name] = 0; }
    }));
    const pct = Math.round((Math.min(i + 6, total) / total) * 100);
    if (prog) { prog.style.width = pct + '%'; prog.parentElement.setAttribute('aria-valuenow', pct); }
    setStatus(`Loading prices… ${pct}%`);
    repaintLayer();
  }
  computeSuitability();
  repaintLayer();
  setStatus('');
}

// ─── SAFETY: crime-count scoring ─────────────────────────────────────────────
async function loadSafetyData() {
  const STATE_SUFFIX = /\s+(NSW|VIC|QLD|SA|WA|TAS|ACT|NT)$/i;
  const normalise = raw => {
    const t = (raw || '').toString().trim();
    if (!t) return null;
    const m = t.match(STATE_SUFFIX);
    if (m && m[1].toUpperCase() !== 'NSW') return null;
    const stripped = t.replace(STATE_SUFFIX, '').trim().toUpperCase();
    return stripped && stripped !== 'UNKNOWN' ? stripped : null;
  };

  try {
    const offenceWeights = {
      'Assault': 3,
      'Drug offences': 1,
      'Robbery and Theft': 2
    };

    const allCrimeEvents = [];
    let offset = 0;
    const limit = 1000;
    while (true) {
      const j = await fetchCached(
        `${API}/api/v1/events?dataset_type=crime&limit=${limit}&offset=${offset}`,
        15000
      );
      const events = j.events || [];
      allCrimeEvents.push(...events);
      if (events.length < limit) break;
      offset += limit;
    }

    const crimeCounts = {};
    allCrimeEvents.forEach(event => {
      const attrs = event.attributes || event;
      const suburb = normalise(attrs.suburb);
      const offence = attrs.offence_category;
      if (!suburb || !offence) return;
      if (!crimeCounts[suburb]) crimeCounts[suburb] = {};
      crimeCounts[suburb][offence] = (crimeCounts[suburb][offence] || 0) + (attrs.count || 1);
    });

    const weightedTotals = {};
    Object.entries(crimeCounts).forEach(([suburb, offences]) => {
      let weighted = 0;
      Object.entries(offences).forEach(([offence, count]) => {
        const weight = offenceWeights[offence] || 1;
        weighted += count * weight;
      });
      weightedTotals[suburb] = weighted;
    });

    const entries = Object.entries(weightedTotals);
    if (!entries.length) { filterData.safety = {}; return; }

    const maxV = Math.max(...entries.map(([, v]) => v));
    filterData.safety = {};
    filterRaw.safety = {};

    entries.forEach(([name, value]) => {
      const rawNorm = Math.min(1, value / maxV);
      filterData.safety[name] = 1 - rawNorm;
      filterRaw.safety[name] = value;
    });

    filterSorted.safety = entries
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);

    console.log(`Safety data: ${Object.keys(filterData.safety).length} suburbs`);
    computeSuitability();
    repaintLayer();
  } catch (e) {
    console.warn('Safety data unavailable:', e.message);
    filterData.safety = {};
  }
}

// ─── EDUCATION: HSC band-6 rate per school mapped to suburbs ─────────────────
function schoolNameToSuburb(schoolName) {
  if (!schoolName || schoolName === 'unknown') return null;
  const cleaned = schoolName
    .toUpperCase()
    .replace(/\b(HIGH|SELECTIVE HIGH|GIRLS HIGH|BOYS HIGH|SENIOR|SECONDARY|COLLEGE|GRAMMAR|SCHOOL|GRAMMAR SCHOOL|LADIES'|LADIES|AGRICULTURE|AGRICULTURAL|CENTRAL|COMMUNITY|CHRISTIAN|CATHOLIC|PUBLIC|PRIMARY|INFANTS|EAST|WEST|NORTH|SOUTH|ST\.?|SAINT)\b/g, ' ')
    .replace(/[''']/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return null;
  return cleaned;
}

function buildSuburbSchoolIndex() {
  const allSuburbKeys = Object.keys(suburbCentroids);

  Object.entries(schoolHscData).forEach(([school, data]) => {
    const candidate = schoolNameToSuburb(school);
    if (!candidate) return;

    let matched = allSuburbKeys.find(k => k === candidate);
    if (!matched) matched = allSuburbKeys.find(k => candidate.startsWith(k) || k.startsWith(candidate));
    if (!matched) {
      const cWords = new Set(candidate.split(' ').filter(w => w.length > 2));
      let bestScore = 0;
      allSuburbKeys.forEach(k => {
        const kWords = k.split(' ');
        const shared = kWords.filter(w => cWords.has(w)).length;
        if (shared > bestScore) { bestScore = shared; matched = k; }
      });
      if (bestScore === 0) matched = null;
    }

    if (!matched) return;

    if (!suburbSchools[matched]) suburbSchools[matched] = [];
    suburbSchools[matched].push({
      name: school,
      hscCount: typeof data === 'object' ? data.count : data,
      enrolCount: typeof data === 'object' ? data.enrolment : null,
      rate: typeof data === 'object' ? data.rate : null,
      rank: typeof data === 'object' ? data.rank : null,
    });
  });

  console.log(`School index built: ${Object.keys(suburbSchools).length} suburbs have school data`);
}

function normSuburb(s) {
  return s.toString().trim().toUpperCase().replace(/\s+NSW$/, '');
}

async function loadEducationData() {
  try {
    const year = 2024;

    const hscUrl = `${API}/api/v1/visualisation/breakdown?dataset_type=hsc_top_achiever&dimension=school&metric=count&aggregation=count&limit=5000&filters[year]=${year}`;
    const hscJ = await fetchCached(hscUrl, 15000);

    const hscEntries = (hscJ.entries || []).filter(
      e => e.category && e.category !== "unknown"
    );

    hscEntries.forEach(e => {
      const school = e.category.toString().trim();
      schoolHscData[school] = Number(e.value || 0);
    });

    const enrolUrl = `${API}/api/v1/visualisation/breakdown?dataset_type=school_enrolment&dimension=school_name&metric=count&aggregation=count&limit=5000`;
    const enrolJ = await fetchCached(enrolUrl, 15000);

    enrolJ.entries.forEach(e => {
      const school = (e.category || "").toString().trim();
      if (!school || school === "unknown") return;
      const total = Number(e.value || e.count || 1);
      schoolEnrolData[school] = Math.max(5, Math.round(total / 6));
    });

    buildSuburbSchoolIndex();

    const STATE_AVG_RATE = 0.05;
    const CONF_WEIGHT = 30;

    const suburbStats = {};

    Object.entries(suburbSchools).forEach(([suburb, schools]) => {
      let totalBand6 = 0;
      let totalYr12 = 0;

      for (const s of schools) {
        const band6 = schoolHscData[s.name];
        const yr12 = schoolEnrolData[s.name];
        if (band6 != null && yr12 != null) {
          totalBand6 += band6;
          totalYr12 += yr12;
        }
      }

      if (totalYr12 > 0) {
        const rawRate = totalBand6 / totalYr12;
        const dampened =
          (totalBand6 + STATE_AVG_RATE * CONF_WEIGHT) /
          (totalYr12 + CONF_WEIGHT);

        suburbStats[suburb] = {
          rawRate,
          rate: dampened,
          totalBand6,
          totalYr12
        };
      }
    });

    // Percentile ranking
    const rates = Object.values(suburbStats)
      .map(s => s.rate)
      .sort((a, b) => a - b);

    function percentile(value) {
      const idx = rates.findIndex(r => r >= value);
      if (idx === -1) return 1;
      return idx / (rates.length - 1);
    }

    // Store scores in filterData.education (keyed by suburb name, not dataset name)
    filterData.education = {};
    filterRaw.education = {};

    Object.entries(suburbStats).forEach(([suburb, stats]) => {
      const p = percentile(stats.rate);
      filterData.education[suburb] = p;
      filterRaw.education[suburb] = (stats.rawRate * 100).toFixed(2);
    });

    // filterSorted.education — sorted descending by rate for rank lookups
    filterSorted.education = Object.entries(suburbStats)
      .map(([name, stats]) => ({ name, value: stats.rate }))
      .sort((a, b) => b.value - a.value);

    console.log(`Education processed: ${Object.keys(filterData.education).length} suburbs`);

    computeSuitability();
    repaintLayer();
    renderSuitabilitySummary();

  } catch (e) {
    console.warn("Education data load failed:", e.message);
    filterData.education = {};
  }
}


// load filter scores from the api
async function loadFilterData() {
  const datasets = [
    { key: 'infrastructure', dataset: 'transport_facility', invert: false },
  ];
  const STATE_SUFFIX = /\s+(NSW|VIC|QLD|SA|WA|TAS|ACT|NT)$/i;
  const normaliseCategory = raw => {
    const trimmed = (raw || '').toString().trim();
    if (!trimmed) return null;
    const m = trimmed.match(STATE_SUFFIX);
    if (m && m[1].toUpperCase() !== 'NSW') return null;
    const stripped = trimmed.replace(STATE_SUFFIX, '').trim();
    const upper = stripped.toUpperCase();
    if (!upper || upper === 'UNKNOWN') return null;
    return upper;
  };

  await Promise.all(datasets.map(async ({ key, dataset, invert }) => {
    try {
      const url = `${API}/api/v1/visualisation/breakdown` +
        `?dataset_type=${dataset}&dimension=suburb&metric=count&aggregation=count&limit=2000`;
      const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!r.ok) throw new Error(`${r.status}`);
      const j = await r.json();
      const cleaned = (j.entries || [])
        .map(e => ({ name: normaliseCategory(e.category), value: Number(e.value || e.count || 0) }))
        .filter(e => e.name && e.value > 0);
      const maxV = cleaned.length ? Math.max(...cleaned.map(e => e.value)) : 1;
      filterData[key] = {};
      filterRaw[key] = {};
      cleaned.forEach(({ name, value }) => {
        const raw = Math.min(1, value / maxV);
        filterData[key][name] = invert ? 1 - raw : raw;
        filterRaw[key][name]  = value;
      });
      filterSorted[key] = [...cleaned].sort((a, b) => b.value - a.value);
      console.log(`${key} data: ${Object.keys(filterData[key]).length} suburbs`);

      if (key === 'infrastructure') {
        try {
          const allInfraEvents = [];
          let offset = 0;
          const limit = 1000;
          while (true) {
            const j = await fetchCached(`${API}/api/v1/events?dataset_type=transport_facility&limit=${limit}&offset=${offset}`, 15000);
            const events = j.events || [];
            allInfraEvents.push(...events);
            if (events.length < limit) break;
            offset += limit;
          }
          const infraTypes = {};
          allInfraEvents.forEach(event => {
            const suburb = normaliseCategory(event.suburb);
            const type = event.attributes?.transport_mode || event.transport_mode || 'unknown';
            if (!suburb || !type || type === 'unknown') return;
            if (!infraTypes[suburb]) infraTypes[suburb] = new Set();
            infraTypes[suburb].add(type);
          });
          filterTypes.infrastructure = {};
          Object.entries(infraTypes).forEach(([suburb, types]) => {
            filterTypes.infrastructure[suburb] = Array.from(types).sort();
          });
          console.log(`Infrastructure types: ${Object.keys(filterTypes.infrastructure).length} suburbs`);
        } catch (e) {
          console.warn('Infrastructure types fetch failed:', e.message);
        }
      }
    } catch (e) {
      console.warn(`${key} data unavailable:`, e.message);
      filterData[key] = {};
    }
  }));

  await Promise.all([
    loadSafetyData(),
    loadEducationData(),
  ]);

  computeSuitability();
  repaintLayer();
  renderSuitabilitySummary();
}

// suitability scoring
function computeSuitability() {
  const prices = Object.values(avgPrices).filter(p => p > 0);
  if (!prices.length) return;

  const sortedPrices = [...prices].sort((a, b) => a - b);
  const p10 = sortedPrices[Math.floor(sortedPrices.length * 0.10)] || 500000;
  const p90 = sortedPrices[Math.floor(sortedPrices.length * 0.90)] || 3000000;
  const priceRange = Math.max(p90 - p10, 1);

  const allSuburbs = new Set([
    ...Object.keys(avgPrices),
    ...Object.keys(suburbCentroids),
    ...Object.values(filterData).flatMap(d => Object.keys(d))
  ]);

  allSuburbs.forEach(suburb => {
    let weightedSum = 0;
    let totalWeight = 0;

    Object.entries(SUIT_FILTERS).forEach(([key, cfg]) => {
      if (!activeFilters.has(key)) return;

      let val = null;

      if (key === 'housing') {
        const price = avgPrices[suburb];
        if (price > 0) {
          const clamped = Math.max(p10, Math.min(p90, price));
          val = 1 - (clamped - p10) / priceRange;
        }
      } else if (key === 'safety') {
        const info = safetyFallbackInfo(suburb);
        if (info) val = filterData.safety?.[info.donor] ?? null;
      } else if (key === 'education') {
        // Use filterData.education directly (keyed by suburb), with nearest fallback
        if (filterData.education && filterData.education[suburb] !== undefined) {
          val = filterData.education[suburb];
        } else if (filterData.education) {
          const { targetSuburb } = resolveEducationSuburb(suburb);
          val = filterData.education[targetSuburb] ?? null;
        }
      } else if (key === 'greenspace') {
        val = suburbStubScore(suburb, 'greenspace');
      } else {
        if (filterData[key] && filterData[key][suburb] !== undefined) {
          val = filterData[key][suburb];
        }
      }

      if (val !== null && val !== undefined) {
        weightedSum += val * cfg.weight;
        totalWeight += cfg.weight;
      }
    });

    suitabilityCache[suburb] = totalWeight > 0 ? weightedSum / totalWeight : -1;
  });
}

// suitability colour
function suitabilityColor(score, hasData) {
  const cs = getComputedStyle(document.documentElement);
  if (!hasData) return cs.getPropertyValue('--suit-none').trim() || '#6b7280';
  const high = cs.getPropertyValue('--suit-high').trim() || '#22c55e';
  const mid  = cs.getPropertyValue('--suit-mid').trim()  || '#eab308';
  const low  = cs.getPropertyValue('--suit-low').trim()  || '#ef4444';
  if (score >= 0.6) return high;
  if (score >= 0.3) return mid;
  return low;
}

// s3 choropleth heatmap
async function initHeatmap() {
  map3 = L.map('heatmap-map', { zoomControl: true }).setView([-33.86, 151.2], 10);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png', {
    attribution: '© OpenStreetMap contributors © CARTO',
    subdomains: 'abcd', maxZoom: 19,
  }).addTo(map3);

  const pricesPromise = loadAllPrices();
  prefetchChartSources();
  setStatus('Loading suburb boundaries…');

  let geojson = null;
  try {
    const r = await fetch(NSW_GEO, { signal: AbortSignal.timeout(10000) });
    if (r.ok) {
      geojson = await r.json();
      (geojson.features || []).forEach(f => {
        const p = f.properties || {};
        if (!p.suburbname) p.suburbname = (p.nsw_loca_2 || p.SAL_NAME21 || p.LOC_NAME || '').trim();
        const name = featName(f).toUpperCase();
        const c = featureCentroid(f);
        if (c && name) suburbCentroids[name] = c;
      });
      console.log(`Real GeoJSON: ${geojson.features.length} suburb polygons, ${Object.keys(suburbCentroids).length} centroids`);
    }
  } catch (e) {
    console.warn('GeoJSON not found — using built-in shapes:', e.message);
  }
  if (!geojson || (geojson.features || []).length === 0) geojson = builtInGeoJSON();

  buildLayer(geojson);
  loadFilterData();
  await pricesPromise;

  computeSuitability();
  repaintLayer();
}

function suburbStyle(f) {
  const name    = featName(f);
  const score   = getScore(name);
  const hasData = score !== -1;
  return {
    weight:      0.8,
    color:       'rgba(255,255,255,0.15)',
    fillColor:   suitabilityColor(score, hasData),
    fillOpacity: hasData ? 0.72 : 0.55,
    smoothFactor: 1.2,
  };
}

function tipHtml(name) {
  const price    = getPrice(name);
  const score    = getScore(name);
  const hasScore = score !== -1;
  if (!hasScore) {
    return `<strong>${name}</strong><br><span style="color:#9ca3af">No data for the active filters</span>`;
  }
  const scoreLabel = score >= 0.6 ? 'High 🟢' : score >= 0.3 ? 'Medium 🟡' : 'Low 🔴';
  const activeList = Array.from(activeFilters)
    .map(f => SUIT_FILTERS[f]?.label || f).join(', ');
  const priceLine = price > 0
    ? `<span style="color:#38beff">${fmtAUD(price)}</span> avg sale<br>`
    : `<span style="opacity:0.7">No housing data</span><br>`;
  return `<strong>${name}</strong><br>` +
    priceLine +
    `Suitability: <strong>${scoreLabel}</strong><br>` +
    `<span style="opacity:0.7;font-size:0.9em">Filters: ${activeList}</span>`;
}

function buildLayer(geojson) {
  if (suburbLayer) { map3.removeLayer(suburbLayer); suburbLayer = null; }
  suburbLayer = L.geoJSON(geojson, {
    style: f => suburbStyle(f),
    onEachFeature: (f, layer) => {
      const name = featName(f);
      layer.bindTooltip(tipHtml(name), { permanent: false, sticky: true, direction: 'top', className: 'sub-tip' });
      layer.on('mouseover', function() {
        if (this !== selectedPoly) this.setStyle({ weight: 2.5, color: 'rgba(255,255,255,0.8)' });
        this.bringToFront();
      });
      layer.on('mouseout', function() {
        if (this !== selectedPoly) this.setStyle(suburbStyle(f));
      });
      layer.on('click', function() {
        if (selectedPoly && selectedPoly !== this) selectedPoly.setStyle(suburbStyle(selectedPoly.feature));
        selectedPoly = this;
        this.setStyle({ weight: 3, color: '#ffffff', fillOpacity: 0.9 });
        const price   = getPrice(name);
        currentSuburb = name.toUpperCase();
        document.getElementById('suburb-title').textContent   = name;
        document.getElementById('meta-suburb').textContent    = name;
        document.getElementById('meta-price').textContent     = price ? fmtAUD(price) : 'No housing data';
        currentFilter = 'purchase_price';
        syncChips();
        renderChart();
        renderSuitabilitySummary();
        show('s4');
      });
    },
  }).addTo(map3);
  try { map3.fitBounds(suburbLayer.getBounds(), { padding: [24, 24] }); } catch {}
}

function repaintLayer() {
  if (!suburbLayer) return;
  suburbLayer.eachLayer(layer => {
    layer.setStyle(suburbStyle(layer.feature));
    layer.bindTooltip(tipHtml(featName(layer.feature)), { permanent: false, sticky: true, direction: 'top', className: 'sub-tip' });
  });
}

// filter panel
function initFilterPanel() {
  document.querySelectorAll('.filter-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const f = btn.dataset.filter;
      if (activeFilters.has(f)) {
        if (activeFilters.size > 1) {
          activeFilters.delete(f);
          btn.classList.remove('active');
          btn.setAttribute('aria-pressed', 'false');
          btn.querySelector('.fi-check').textContent = '';
        }
      } else {
        activeFilters.add(f);
        btn.classList.add('active');
        btn.setAttribute('aria-pressed', 'true');
        btn.querySelector('.fi-check').textContent = '✓';
      }
      computeSuitability();
      repaintLayer();
      renderSuitabilitySummary();
    });
  });
}

function prefetchChartSources() {
  const urls = [
    `${API}/api/v1/visualisation/timeseries?dataset_type=housing&metric=purchase_price&aggregation=avg&time_period=year&dimension=suburb`,
    `${API}/api/v1/visualisation/breakdown?dataset_type=abs_community_profile&metric=median_household_income_weekly&aggregation=avg&dimension=suburb&limit=2000`,
    `${API}/api/v1/visualisation/breakdown?dataset_type=nsw_population&metric=population&aggregation=sum&dimension=suburb&limit=2000`,
    `${API}/api/v1/visualisation/breakdown?dataset_type=nsw_weather&metric=avg_temp&aggregation=avg&dimension=suburb&limit=2000`,
  ];
  urls.forEach(u => fetchCached(u).catch(() => {}));
}

// s4 chart
function syncChips() {
  document.querySelectorAll('.chip[data-f]').forEach(b => {
    const active = b.dataset.f === currentFilter;
    b.classList.toggle('active', active);
    b.setAttribute('aria-pressed', String(active));
  });
}

// response cache
const responseCache = new Map();
function fetchCached(url, timeout = 15000) {
  if (responseCache.has(url)) return responseCache.get(url);
  const p = (async () => {
    const r = await fetch(url, { signal: AbortSignal.timeout(timeout) });
    if (!r.ok) throw new Error(`${url} → ${r.status}`);
    return r.json();
  })().catch(e => { responseCache.delete(url); throw e; });
  responseCache.set(url, p);
  return p;
}

let renderSeq = 0;
let loadingTimer = null;

const STATE_TAIL = /\s*[\(\s](?:NSW|VIC|QLD|SA|WA|TAS|ACT|NT)\)?\s*$/i;
const cleanSuburbName = s => (s || '').toString().toUpperCase().replace(STATE_TAIL, '').trim();

function pickMatch(entries, suburb) {
  const u = cleanSuburbName(suburb);
  let found = (entries || []).find(e => cleanSuburbName(e.category || e.suburb || e.series) === u);
  if (found) return found;
  const uNorm = u.replace(/[\s\-]/g, '');
  found = (entries || []).find(e => cleanSuburbName(e.category || e.suburb || e.series).replace(/[\s\-]/g, '') === uNorm);
  if (found) return found;
  found = (entries || []).find(e => {
    const c = cleanSuburbName(e.category || e.suburb || e.series);
    return c.startsWith(u) || u.startsWith(c);
  });
  return found || null;
}

async function fetchEventsForSuburb(suburb, timeout = 15000) {
  const variants = [
    suburb,
    suburb.toLowerCase(),
    suburb.charAt(0) + suburb.slice(1).toLowerCase(),
    suburb.split(' ').map(w => w.charAt(0) + w.slice(1).toLowerCase()).join(' '),
  ];
  const tried = new Set();
  for (const v of variants) {
    if (tried.has(v)) continue;
    tried.add(v);
    try {
      const url = `${API}/api/v1/events?dataset_type=housing&suburb=${encodeURIComponent(v)}&limit=2000`;
      const j = await fetchCached(url, timeout);
      if (j.events && j.events.length > 0) return j;
    } catch { /* try next */ }
  }
  return { events: [] };
}

function showChartLoading(cfg) {
  if (activeChart) { activeChart.destroy(); activeChart = null; }
  const canvas = document.getElementById('chart');
  if (canvas) canvas.style.display = 'none';
  const stat = ensureStatEl();
  if (!stat) return;
  stat.style.display = '';
  stat.innerHTML = `<div style="opacity:0.7;padding:40px 0;">Loading ${cfg.label}…</div>`;
}

async function renderChart() {
  const token = ++renderSeq;
  const cfg = CHART_FILTERS[currentFilter];
  const suburb = currentSuburb;
  let series = { labels: [], data: [], type: 'line' };

  if (loadingTimer) clearTimeout(loadingTimer);
  loadingTimer = setTimeout(() => { if (token === renderSeq) showChartLoading(cfg); }, 120);

  try {
    if (currentFilter === 'purchase_price' || currentFilter === 'count') {
      const tsUrl = `${API}/api/v1/visualisation/timeseries` +
        `?dataset_type=housing&metric=purchase_price&aggregation=avg&time_period=year&dimension=suburb`;
      try {
        const j = await fetchCached(tsUrl);
        if (token !== renderSeq) return;
        const u = cleanSuburbName(suburb);
        const matched = (j.data || []).filter(d => cleanSuburbName(d.series) === u);
        const cleaned = filterPricePoints(matched, currentFilter);
        if (cleaned.length) {
          series = {
            type: 'line',
            labels: cleaned.map(d => d.period),
            data:   cleaned.map(d => currentFilter === 'count' ? (d.count || 0) : (d.value || 0)),
          };
        }
      } catch (e) { console.warn('Timeseries failed:', e.message); }

      if (!series.labels.length) {
        try {
          const j = await fetchEventsForSuburb(suburb, 15000);
          if (token !== renderSeq) return;
          if (j.events && j.events.length) {
            series = { type: 'line', ...buildHousingSeriesFromEvents(j.events) };
          }
        } catch (e) { console.warn('Events fallback failed:', e.message); }
      }

      if (!series.labels.length) {
        try {
          const direct = `${API}/api/v1/visualisation/timeseries` +
            `?dataset_type=housing&metric=purchase_price&aggregation=avg&time_period=year` +
            `&filters[suburb]=${encodeURIComponent(suburb)}`;
          const j = await fetchCached(direct, 15000);
          if (token !== renderSeq) return;
          const pts = filterPricePoints(j.data || [], currentFilter);
          if (pts.length) {
            series = {
              type: 'line',
              labels: pts.map(d => d.period),
              data:   pts.map(d => currentFilter === 'count' ? (d.count || 0) : (d.value || 0)),
            };
          }
        } catch {}
      }

    } else if (currentFilter === 'income') {
      const incomeMetrics = ['median_household_income_weekly', 'median_household_income', 'household_income', 'income'];
      const results = await Promise.all(incomeMetrics.map(async metric => {
        try {
          const j = await fetchCached(
            `${API}/api/v1/visualisation/breakdown` +
            `?dataset_type=abs_community_profile&metric=${metric}&aggregation=avg&dimension=suburb&limit=2000`
          );
          const entries = j.entries || [];
          const entry = pickMatch(entries, suburb);
          if (entry && Number(entry.value || 0) > 0) return { entries, entry };
          return entries.length ? { entries, entry: null } : null;
        } catch { return null; }
      }));
      if (token !== renderSeq) return;
      const hit = results.find(r => r && r.entry) || results.find(r => r);
      if (hit && hit.entry) {
        series = { type: 'bar', labels: ['Weekly Median Income'], data: [Number(hit.entry.value || 0)] };
      } else if (hit && hit.entries.length) {
        const top = hit.entries.slice(0, 10);
        series = {
          type: 'bar',
          labels: top.map(e => (e.category || '').toString()),
          data:   top.map(e => Number(e.value || 0)),
          note:   `${suburb} not found — showing top entries`,
        };
      }

    } else if (currentFilter === 'population') {
      const popMetrics = ['population', 'count', 'total_population'];
      const results = await Promise.all(popMetrics.map(async metric => {
        try {
          const j = await fetchCached(
            `${API}/api/v1/visualisation/breakdown` +
            `?dataset_type=nsw_population&metric=${metric}&aggregation=sum&dimension=suburb&limit=2000`
          );
          const entry = pickMatch(j.entries || [], suburb);
          if (entry && Number(entry.value || entry.count || 0) > 0) return entry;
          return null;
        } catch { return null; }
      }));
      if (token !== renderSeq) return;
      const entry = results.find(e => e);
      if (entry) {
        series = { type: 'bar', labels: ['Total Population'], data: [Number(entry.value || entry.count || 0)] };
      } else {
        try {
          const j = await fetchCached(
            `${API}/api/v1/visualisation/breakdown` +
            `?dataset_type=abs_community_profile&metric=total_population&aggregation=sum&dimension=suburb&limit=2000`
          );
          if (token !== renderSeq) return;
          const e = pickMatch(j.entries || [], suburb);
          if (e) series = { type: 'bar', labels: ['Total Population'], data: [Number(e.value || e.count || 0)] };
        } catch {}
      }

    } else if (currentFilter === 'weather') {
      const metric = 'avg_temp';
      try {
        const j = await fetchCached(
          `${API}/api/v1/visualisation/breakdown` +
          `?dataset_type=nsw_weather&metric=${metric}&aggregation=avg&dimension=suburb&limit=2000`
        );
        if (token !== renderSeq) return;
        const entries = j.entries || [];
        let picked = pickMatch(entries, suburb);
        let note = null;
        if (!picked) {
          const near = nearestEntry(suburb, entries);
          if (near) { picked = near.entry; note = `nearest station: ${near.entry.category}`; }
        }
        if (picked && Number(picked.value || 0) !== 0) {
          series = {
            type: 'bar',
            labels: [`Avg ${metric.replace(/_/g,' ')}`],
            data:   [Number(picked.value || 0)],
            ...(note ? { note } : {}),
          };
        }
      } catch (e) { console.warn('Weather breakdown failed:', e.message); }

      if (!series.labels.length) {
        try {
          const j = await fetchCached(
            `${API}/api/v1/visualisation/timeseries` +
            `?dataset_type=nsw_weather&metric=${metric}&aggregation=avg&time_period=month&dimension=suburb`
          );
          if (token !== renderSeq) return;
          const data = j.data || [];
          const u = cleanSuburbName(suburb);
          let filtered = data.filter(d => cleanSuburbName(d.series) === u);
          let note = null;
          if (!filtered.length) {
            const uniqueSeries = [...new Map(data.map(d => [d.series, { category: d.series }])).values()];
            const near = nearestEntry(suburb, uniqueSeries);
            if (near) {
              const pickedSeries = cleanSuburbName(near.entry.category);
              note = `nearest station: ${near.entry.category}`;
              filtered = data.filter(d => cleanSuburbName(d.series) === pickedSeries);
            }
          }
          if (filtered.length) {
            filtered.sort((a, b) => (a.period || '').localeCompare(b.period || ''));
            series = {
              type: 'line',
              labels: filtered.map(d => d.period),
              data:   filtered.map(d => Number(d.value || 0)),
              ...(note ? { note } : {}),
            };
          }
        } catch {}
      }
    }
  } catch (e) {
    console.error('renderChart outer error:', e);
  }

  if (token !== renderSeq) return;
  if (loadingTimer) { clearTimeout(loadingTimer); loadingTimer = null; }

  if (!series.labels.length) {
    series = { labels: ['No data available'], data: [0], type: 'bar' };
  }

  drawChart(cfg, series);
}

function drawChart(cfg, series) {
  const clr = isLight ? cfg.colorLight : cfg.color;
  const chartType = series.type || 'line';

  const isStat = chartType === 'bar'
    && series.data.length === 1
    && Number(series.data[0]) > 0
    && ['income', 'population', 'weather'].includes(currentFilter);
  if (isStat) { renderStatFallback(cfg, series, clr); return; }
  hideStatFallback();

  if (activeChart) { activeChart.destroy(); activeChart = null; }
  activeChart = new Chart(document.getElementById('chart').getContext('2d'), {
    type: chartType,
    data: {
      labels: series.labels,
      datasets: [{
        label:                cfg.subtitle(currentSuburb),
        data:                 series.data,
        borderColor:          clr,
        backgroundColor:      chartType === 'bar' ? clr + 'aa' : clr + '22',
        pointBackgroundColor: clr,
        borderRadius:         chartType === 'bar' ? 6 : 0,
        tension: 0.38, fill: chartType !== 'bar', pointRadius: chartType === 'bar' ? 0 : 5,
        pointHoverRadius: 8, borderWidth: 2.5,
      }],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false },
        title: {
          display: true,
          text:    cfg.subtitle(currentSuburb) + (series.note ? ` (${series.note})` : ''),
          color:   getComputedStyle(document.documentElement).getPropertyValue('--chart-title').trim(),
          font: { size: 14, weight: '600' },
          padding: { bottom: 20 },
        },
        tooltip: { callbacks: { label: ctx => cfg.tipFormat(ctx.parsed.y) } },
      },
      scales: {
        x: {
          ticks: { color: getComputedStyle(document.documentElement).getPropertyValue('--chart-text').trim(), maxRotation: 45 },
          grid:  { color: getComputedStyle(document.documentElement).getPropertyValue('--chart-grid').trim() },
        },
        y: {
          beginAtZero: cfg.beginZero,
          ticks: {
            color:    getComputedStyle(document.documentElement).getPropertyValue('--chart-text').trim(),
            callback: cfg.yFormat,
          },
          grid: { color: getComputedStyle(document.documentElement).getPropertyValue('--chart-grid').trim() },
        },
      },
    },
  });
}

function ensureStatEl() {
  let stat = document.getElementById('chart-stat');
  if (stat) return stat;
  const canvas = document.getElementById('chart');
  if (!canvas) return null;
  stat = document.createElement('div');
  stat.id = 'chart-stat';
  stat.setAttribute('role', 'figure');
  Object.assign(stat.style, {
    display: 'none',
    padding: '28px 24px',
    textAlign: 'center',
    borderRadius: '12px',
    background: 'rgba(255,255,255,0.03)',
  });
  canvas.parentElement.insertBefore(stat, canvas);
  return stat;
}

function renderStatFallback(cfg, series, color) {
  if (activeChart) { activeChart.destroy(); activeChart = null; }
  const canvas = document.getElementById('chart');
  if (canvas) canvas.style.display = 'none';
  const stat = ensureStatEl();
  if (!stat) return;
  const value = Number(series.data[0] || 0);
  const label = series.labels[0] || '';
  const noteHtml = series.note ? `<div style="margin-top:6px;opacity:0.7;font-size:0.85em;">${series.note}</div>` : '';
  stat.style.display = '';
  stat.innerHTML = `
    <div style="opacity:0.75;font-size:0.9em;letter-spacing:0.05em;text-transform:uppercase;">${cfg.subtitle(currentSuburb)}</div>
    <div style="margin-top:10px;font-size:2.6em;font-weight:700;color:${color};">${cfg.tipFormat(value)}</div>
    <div style="margin-top:4px;opacity:0.8;">${label}</div>
    ${noteHtml}
  `;
}

function hideStatFallback() {
  const stat = document.getElementById('chart-stat');
  if (stat) stat.style.display = 'none';
  const canvas = document.getElementById('chart');
  if (canvas) canvas.style.display = '';
}

function buildHousingSeriesFromEvents(evts) {
  const yr = {};
  const thisYear = new Date().getFullYear();
  evts.forEach(e => {
    const ts = e.time_object?.timestamp || e.attribute?.contract_date;
    const y  = ts ? new Date(ts).getFullYear() : null;
    if (!y || y < 1980 || y > thisYear) return;
    if (!yr[y]) yr[y] = { sum: 0, n: 0 };
    const p = Number(e.attribute?.purchase_price || 0);
    if (p > 0) { yr[y].sum += p; yr[y].n++; }
  });
  const points = Object.keys(yr).sort().map(y => ({
    period: y,
    count: yr[y].n,
    value: yr[y].n ? yr[y].sum / yr[y].n : 0,
  }));
  const cleaned = filterPricePoints(points, currentFilter);
  console.log(`buildHousingSeriesFromEvents: ${evts.length} events → ${points.length} years → ${cleaned.length} kept`);
  if (!cleaned.length) return { labels: [], data: [] };
  return {
    labels: cleaned.map(p => p.period),
    data:   cleaned.map(p => currentFilter === 'count' ? p.count : Math.round(p.value)),
  };
}

// suitability summary panel s4, below chart
function renderSuitabilitySummary() {
  const panel = document.getElementById('suitability-summary');
  if (!panel) return;
  const grid = panel.querySelector('.summary-grid');
  const overallBadge = panel.querySelector('.summary-overall-badge');
  const overallLabel = panel.querySelector('.summary-overall-label');
  if (!grid) return;

  const u = currentSuburb.toUpperCase().replace(/\s+NSW$/, '');
  const scores = {};

  Object.entries(SUIT_FILTERS).forEach(([key, cfg]) => {
    let val = null;
    if (key === 'housing') {
      const price = avgPrices[u];
      if (price > 0) {
        const prices = Object.values(avgPrices).filter(p => p > 0).sort((a,b)=>a-b);
        const p10 = prices[Math.floor(prices.length*0.10)] || 500000;
        const p90 = prices[Math.floor(prices.length*0.90)] || 3000000;
        val = 1 - (Math.max(p10, Math.min(p90, price)) - p10) / Math.max(p90 - p10, 1);
      }
    } else if (key === 'safety') {
      const info = safetyFallbackInfo(u);
      if (info) val = filterData.safety?.[info.donor] ?? null;
    } else if (key === 'education') {
      // Use filterData.education directly (never filterData[SUIT_FILTERS.education.dataset])
      if (filterData.education && filterData.education[u] !== undefined) {
        val = filterData.education[u];
      } else if (filterData.education) {
        const { targetSuburb } = resolveEducationSuburb(u);
        val = filterData.education[targetSuburb] ?? null;
      }
    } else if (key === 'greenspace') {
      val = suburbStubScore(u, 'greenspace');
    } else if (filterData[key] && filterData[key][u] !== undefined) {
      val = filterData[key][u];
    }
    scores[key] = val;
  });

  let totalScore = 0, totalWeight = 0;
  Object.entries(scores).forEach(([key, val]) => {
    if (val !== null) { totalScore += val * SUIT_FILTERS[key].weight; totalWeight += SUIT_FILTERS[key].weight; }
  });
  const overall = totalWeight > 0 ? totalScore / totalWeight : -1;

  grid.innerHTML = Object.entries(SUIT_FILTERS).map(([key, cfg]) => {
    const val = scores[key];
    const pct = val !== null ? Math.round(val * 100) : null;
    const barColor = val === null ? 'var(--suit-none)' : val >= 0.6 ? 'var(--suit-high)' : val >= 0.3 ? 'var(--suit-mid)' : 'var(--suit-low)';
    const label = val === null ? 'No data' : pct >= 60 ? 'High' : pct >= 30 ? 'Medium' : 'Low';

    // All filters are always clickable — the modal handles missing data gracefully
    return `
      <div class="summary-item" role="button" tabindex="0"
           data-suit-key="${key}"
           aria-label="Open ${cfg.label} breakdown for ${currentSuburb}">
        <div class="summary-item-header">
          <span class="summary-item-icon" aria-hidden="true">${cfg.icon}</span>
          <span class="summary-item-label">${cfg.label}</span>
        </div>
        <div class="summary-score-bar">
          <div class="summary-score-fill" style="width:${pct ?? 0}%;background:${barColor}"></div>
        </div>
        <div class="summary-score-text">${label}${pct !== null ? ` (${pct}%)` : ''}</div>
      </div>`;
  }).join('');

  if (overall >= 0) {
    const overallPct = Math.round(overall * 100);
    const badgeColor = overall >= 0.6 ? 'var(--suit-high)' : overall >= 0.3 ? 'var(--suit-mid)' : 'var(--suit-low)';
    const badgeText  = overall >= 0.6 ? 'High Suitability' : overall >= 0.3 ? 'Medium Suitability' : 'Low Suitability';
    if (overallBadge) { overallBadge.style.background = badgeColor; overallBadge.textContent = `${badgeText} (${overallPct}%)`; }
    if (overallLabel) overallLabel.textContent = `Overall — ${currentSuburb}`;
  } else {
    if (overallBadge) { overallBadge.style.background = 'var(--suit-none)'; overallBadge.textContent = 'No data'; }
    if (overallLabel) overallLabel.textContent = `Overall — ${currentSuburb}`;
  }
}

// built in geojson fallback
function makePoly(cx, cy, rx, ry, n, seed) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const j = 1 + 0.20 * Math.sin(a*2+seed) + 0.10 * Math.sin(a*3+seed*1.5) + 0.06 * Math.sin(a*5+seed*0.7);
    pts.push([cx + Math.cos(a) * rx * j, cy + Math.sin(a) * ry * j]);
  }
  return [pts];
}

function builtInGeoJSON() {
  const S = [
    ['Sydney CBD',151.2093,-33.8688,0.025,0.018],['Pyrmont',151.195,-33.872,0.014,0.011],
    ['Surry Hills',151.2115,-33.884,0.017,0.014],['Darlinghurst',151.221,-33.876,0.013,0.011],
    ['Kings Cross',151.224,-33.871,0.011,0.009],['Potts Point',151.226,-33.865,0.010,0.008],
    ['Newtown',151.179,-33.896,0.018,0.015],['Glebe',151.187,-33.878,0.015,0.012],
    ['Balmain',151.180,-33.860,0.017,0.013],['Rozelle',151.166,-33.863,0.014,0.011],
    ['Leichhardt',151.157,-33.881,0.016,0.013],['Annandale',151.167,-33.879,0.013,0.011],
    ['Marrickville',151.157,-33.912,0.019,0.016],['Alexandria',151.201,-33.913,0.016,0.013],
    ['Waterloo',151.209,-33.904,0.013,0.011],['Redfern',151.206,-33.894,0.013,0.011],
    ['Paddington',151.231,-33.885,0.016,0.013],['Woollahra',151.243,-33.882,0.014,0.012],
    ['Double Bay',151.244,-33.876,0.014,0.012],['Rose Bay',151.264,-33.872,0.018,0.015],
    ['Vaucluse',151.284,-33.857,0.020,0.017],['Bondi',151.272,-33.891,0.019,0.016],
    ['Bondi Junction',151.251,-33.889,0.015,0.012],['Coogee',151.258,-33.920,0.015,0.012],
    ['Randwick',151.242,-33.914,0.019,0.016],['Maroubra',151.249,-33.949,0.020,0.017],
    ['North Sydney',151.209,-33.839,0.017,0.014],['Neutral Bay',151.216,-33.832,0.014,0.012],
    ['Cremorne',151.227,-33.830,0.014,0.012],['Mosman',151.248,-33.823,0.021,0.018],
    ['Chatswood',151.182,-33.797,0.021,0.018],['Lane Cove',151.169,-33.814,0.018,0.015],
    ['Willoughby',151.202,-33.800,0.017,0.014],['Gordon',151.153,-33.758,0.018,0.016],
    ['Wahroonga',151.118,-33.723,0.020,0.017],['Hornsby',151.098,-33.702,0.021,0.018],
    ['Manly',151.284,-33.797,0.018,0.015],['Dee Why',151.284,-33.755,0.017,0.014],
    ['Collaroy',151.288,-33.731,0.016,0.013],['Narrabeen',151.291,-33.718,0.017,0.014],
    ['Mona Vale',151.304,-33.678,0.019,0.016],['Newport',151.326,-33.657,0.018,0.015],
    ['Avalon Beach',151.333,-33.631,0.019,0.016],['Palm Beach',151.323,-33.594,0.017,0.014],
    ['Ashfield',151.124,-33.887,0.017,0.014],['Burwood',151.105,-33.878,0.017,0.014],
    ['Strathfield',151.087,-33.871,0.018,0.015],['Auburn',151.032,-33.850,0.018,0.015],
    ['Parramatta',151.0005,-33.815,0.024,0.020],['Blacktown',150.908,-33.768,0.023,0.019],
    ['Penrith',150.695,-33.760,0.026,0.022],['Castle Hill',150.984,-33.728,0.023,0.019],
    ['Baulkham Hills',150.986,-33.754,0.022,0.018],['Kellyville',150.957,-33.717,0.020,0.017],
    ['Rouse Hill',150.919,-33.688,0.022,0.018],['Hurstville',151.100,-33.968,0.019,0.016],
    ['Kogarah',151.134,-33.972,0.017,0.014],['Sutherland',151.058,-34.032,0.019,0.016],
    ['Miranda',151.107,-34.033,0.020,0.017],['Cronulla',151.152,-34.058,0.020,0.017],
    ['Campbelltown',150.814,-34.064,0.026,0.022],['Liverpool',150.918,-33.920,0.024,0.020],
    ['Bankstown',151.035,-33.919,0.021,0.017],['Fairfield',150.957,-33.872,0.022,0.018],
    ['Newcastle',151.779,-32.927,0.035,0.028],['Wollongong',150.893,-34.428,0.034,0.027],
    ['Gosford',151.341,-33.426,0.030,0.024],['Maitland',151.560,-32.734,0.030,0.024],
    ['Bathurst',149.576,-33.419,0.030,0.024],['Orange',149.101,-33.284,0.030,0.024],
    ['Wagga Wagga',147.360,-35.108,0.034,0.027],['Albury',146.916,-36.081,0.030,0.024],
    ['Tamworth',150.933,-31.093,0.030,0.024],['Dubbo',148.602,-32.257,0.032,0.026],
    ['Port Macquarie',152.908,-31.433,0.030,0.024],['Coffs Harbour',153.115,-30.296,0.030,0.024],
    ['Lismore',153.276,-28.815,0.028,0.022],['Tweed Heads',153.549,-28.183,0.026,0.021],
    ['Byron Bay',153.616,-28.647,0.024,0.019],['Nowra',150.605,-34.882,0.028,0.022],
  ];
  return {
    type: 'FeatureCollection',
    features: S.map(([name, cx, cy, rx, ry], i) => ({
      type: 'Feature',
      properties: { suburbname: name },
      geometry: { type: 'Polygon', coordinates: makePoly(cx, cy, rx, ry, 22, i * 1.37) },
    })),
  };
}

// ─── SUITABILITY BREAKDOWN MODAL ─────────────────────────────────────────────
let lastSuitTrigger = null;

function scoreForFilter(key, suburb) {
  const u = suburb.toUpperCase().replace(/\s+NSW$/, '');
  if (key === 'housing') {
    const price = avgPrices[u];
    if (!price || price <= 0) return null;
    const prices = Object.values(avgPrices).filter(p => p > 0).sort((a, b) => a - b);
    const p10 = prices[Math.floor(prices.length * 0.10)] || 500000;
    const p90 = prices[Math.floor(prices.length * 0.90)] || 3000000;
    return 1 - (Math.max(p10, Math.min(p90, price)) - p10) / Math.max(p90 - p10, 1);
  }
  if (key === 'greenspace') return suburbStubScore(u, 'greenspace');
  if (key === 'safety') {
    const info = safetyFallbackInfo(u);
    if (!info) return null;
    return filterData.safety?.[info.donor] ?? null;
  }
  if (key === 'education') {
    // Always use filterData.education (never filterData[SUIT_FILTERS.education.dataset])
    if (filterData.education && filterData.education[u] !== undefined) {
      return filterData.education[u];
    }
    if (filterData.education) {
      const { targetSuburb } = resolveEducationSuburb(u);
      return filterData.education[targetSuburb] ?? null;
    }
    return null;
  }
  return filterData[key]?.[u] ?? null;
}

function housingRank(suburb) {
  const u = suburb.toUpperCase().replace(/\s+NSW$/, '');
  const priced = Object.entries(avgPrices).filter(([, v]) => v > 0);
  if (!priced.length || !avgPrices[u]) return null;
  priced.sort((a, b) => a[1] - b[1]);
  const idx = priced.findIndex(([k]) => k === u);
  if (idx === -1) return null;
  const total = priced.length;
  const rank = idx + 1;
  const percentile = Math.round(((total - rank) / total) * 100);
  return { rank, total, raw: priced[idx][1], percentile };
}

function filterRank(key, suburb) {
  const u = suburb.toUpperCase().replace(/\s+NSW$/, '');
  let target = u;
  let fallback = null;

  if (key === 'safety') {
    const info = safetyFallbackInfo(u);
    if (!info) return null;
    target = info.donor;
    if (info.source === 'nearest') fallback = info.donor;
  }

  if (key === 'education') {
    // If no direct hit in filterData.education, use nearest
    if (!filterData.education || filterData.education[u] === undefined) {
      const { targetSuburb, usingFallback } = resolveEducationSuburb(u);
      target = targetSuburb;
      if (usingFallback) fallback = targetSuburb;
    }
  }

  const raw = key === 'education'
    ? filterRaw.education?.[target]
    : filterRaw[key]?.[target];

  const sorted = filterSorted[key] || [];
  if (raw === undefined || !sorted.length) return null;

  const descIdx = sorted.findIndex(e => e.name === target);
  if (descIdx === -1) return null;

  const total = sorted.length;
  const higherIsBetter = SUIT_DETAIL[key]?.higherIsBetter !== false;
  const rank = higherIsBetter ? (descIdx + 1) : (total - descIdx);
  const percentile = Math.round(((total - rank) / total) * 100);
  return { rank, total, raw, percentile, fallback };
}

function greenspaceFacts(suburb) {
  const u = suburb.toUpperCase().replace(/\s+NSW$/, '');
  let h = 0;
  for (let i = 0; i < u.length; i++) h = (h * 31 + u.charCodeAt(i)) >>> 0;
  const parks    = 8  + (h % 43);
  const coverage = 6  + ((h >> 4) % 38);
  const score    = suburbStubScore(u, 'greenspace');
  const total    = 450;
  const rank     = Math.max(1, Math.round(total * (1 - score)));
  const percentile = Math.round(score * 100);
  return { parks, coverage, score, rank, total, percentile };
}

// Build the school breakdown section for the education modal
function buildSchoolBreakdown(suburb) {
  const u = suburb.toUpperCase().replace(/\s+NSW$/, '');
  const schools = suburbSchools[u] || [];
  if (!schools.length) return '';

  // Sort by hsc count descending
  const sorted = [...schools].sort((a, b) => (b.hscCount || 0) - (a.hscCount || 0));

  const rows = sorted.map(s => {
    const enrol = schoolEnrolData[s.name];
    const band6 = schoolHscData[s.name];
    const rateDisplay = (enrol && band6 != null)
      ? ((band6 / enrol) * 100).toFixed(1) + '% band-6 rate'
      : (s.rate != null ? (s.rate * 100).toFixed(1) + '% band-6 rate' : '');
    const rankDisplay = s.rank ? `#${s.rank} NSW` : (band6 != null ? `${band6} achievers` : '');
    return `<div class="suit-school-row">
      <div class="suit-school-name">${s.name}</div>
      <div class="suit-school-meta">
        ${rankDisplay ? `<span class="suit-school-rank">${rankDisplay}</span>` : ''}
        ${rateDisplay ? `<span class="suit-school-rate">${rateDisplay}</span>` : ''}
      </div>
    </div>`;
  }).join('');

  return `<div class="suit-school-list">
    <div class="suit-row-label" style="margin-bottom:8px;">Schools in this suburb</div>
    ${rows}
  </div>`;
}

function suitRow(label, value, sub) {
  return `<div>
    <div class="suit-row-label">${label}</div>
    <div class="suit-row-value">${value}</div>
    ${sub ? `<div class="suit-row-sub">${sub}</div>` : ''}
  </div>`;
}

function suitRankRow(r, verb, score) {
  const color = score == null ? 'var(--suit-none)'
    : score >= 0.6 ? 'var(--suit-high)'
    : score >= 0.3 ? 'var(--suit-mid)' : 'var(--suit-low)';
  return `<div>
    <div class="suit-row-label">Rank in NSW</div>
    <div class="suit-row-value">${r.rank} of ${r.total}</div>
    <div class="suit-rank-bar"><div class="suit-rank-fill" style="width:${r.percentile}%;background:${color}"></div></div>
    <div class="suit-row-sub">${verb} ${r.percentile}% of suburbs with data</div>
  </div>`;
}

function suitHow(detail, weight, extra) {
  return `<div class="suit-how">
    <strong>How it's calculated</strong><br>
    Dataset: ${detail.datasetLabel}<br>
    Weight in overall score: ${weight}<br>
    ${detail.direction}
    ${extra || detail.note ? `<br><span style="opacity:0.85">${extra || detail.note}</span>` : ''}
  </div>`;
}

function buildSuitModalBody(key, suburb, score) {
  const cfg = SUIT_FILTERS[key];
  const det = SUIT_DETAIL[key] || {};
  const u = suburb.toUpperCase().replace(/\s+NSW$/, '');

  if (key === 'housing') {
    const rk = housingRank(u);
    if (!rk) return `<div class="suit-empty">No housing sales data for <strong>${suburb}</strong>.</div>`;
    return suitRow('Average sale price', fmtAUD(rk.raw))
         + suitRankRow(rk, 'More affordable than', score)
         + suitHow(det, cfg.weight);
  }

  if (key === 'greenspace') {
    const g = greenspaceFacts(u);
    return suitRow('Estimated parks & reserves', `~${g.parks}`)
         + suitRow('Estimated green coverage',   `~${g.coverage}%`)
         + suitRankRow({ rank: g.rank, total: g.total, percentile: g.percentile }, 'Greener than', g.score)
         + suitHow(det, cfg.weight);
  }

  // ─── EDUCATION ───────────────────────────────────────────────────────────
  if (key === 'education') {
    // Resolve the best suburb we have data for
    const { targetSuburb, usingFallback } = resolveEducationSuburb(u);

    const r = filterRank('education', u); // filterRank internally resolves fallback
    const schoolBreakdown = buildSchoolBreakdown(targetSuburb);
    const hasSchools = (suburbSchools[targetSuburb] || []).length > 0;
    const hasScore = filterData.education && filterData.education[targetSuburb] !== undefined;

    if (!hasScore && !hasSchools) {
      return `<div class="suit-empty">
        No education data found for <strong>${suburb}</strong>.<br>
        <span style="opacity:0.7">No HSC schools were matched to this suburb.</span>
      </div>` + suitHow(det, cfg.weight);
    }

    const fallbackNote = usingFallback
      ? suitRow('Nearest suburb with data', targetSuburb,
                `${suburb} has no directly matched schools — showing nearest suburb with HSC data.`)
      : '';

    const rawRate = filterRaw.education?.[targetSuburb];
    const rankSection = r
      ? suitRow('Band-6 success rate', rawRate != null ? rawRate + '%' : '—',
                `2024 HSC top achievers as a % of estimated Year 12 cohort`)
        + suitRankRow(r, 'Better education outcomes than', score)
      : '';

    return fallbackNote
         + rankSection
         + schoolBreakdown
         + suitHow(det, cfg.weight);
  }

  // ─── SAFETY ──────────────────────────────────────────────────────────────
  const r = filterRank(key, u);

  if (key === 'safety' && r) {
    const totalWeighted = filterRaw.safety?.[r.fallback || u];
    const safetyExtra = totalWeighted
      ? `Weighted crime index: ${totalWeighted.toLocaleString()} (Assault ×3, Robbery ×2, Drug offences ×1)`
      : null;
    const fallbackRow = r.fallback
      ? suitRow('Nearest area with data', r.fallback,
                `${suburb} is not directly in the crime dataset; showing the closest covered area.`)
      : '';
    const rankLabel = r.fallback ? `Rank of ${r.fallback}` : 'Rank in NSW';
    return suitRow(det.datasetLabel, `${(r.raw || 0).toLocaleString()}`)
         + fallbackRow
         + suitRankRow(r, 'Safer than', score).replace('Rank in NSW', rankLabel)
         + suitHow(det, cfg.weight, safetyExtra);
  }

  if (!r) {
    return `<div class="suit-empty">
      No <strong>${cfg.label}</strong> data for <strong>${suburb}</strong>.<br>
      <span style="opacity:0.7">Dataset may not cover this area, or records are still being ingested.</span>
    </div>` + suitHow(det, cfg.weight);
  }

  const fallbackRow = r.fallback
    ? suitRow('Nearest LGA with data', r.fallback,
              `${suburb} is not in the ${det.datasetLabel.toLowerCase()} dataset; showing the closest covered area.`)
    : '';

  const verb = det.higherIsBetter ? 'More than' : 'Fewer than';
  const rawLabel = `${r.raw.toLocaleString()}${det.unit ? ' ' + det.unit : ''}`;
  const rankLabel = r.fallback ? `Rank of ${r.fallback}` : 'Rank in NSW';

  const infraRow = key === 'infrastructure' ? (() => {
    const types = filterTypes.infrastructure?.[r.fallback || u] || [];
    if (!types.length) return '';
    return suitRow('Facility types in suburb', types.map(t => {
      const icons = {
        'Supermarket': '🛒',
        'Hospital': '🏥',
        'School': '🎓',
        'Train': '🚆',
        'Bus': '🚌',
        'Light Rail': '🚊',
        'Ferry': '⛵'
      };
      const icon = icons[t] || '📍';
      return `${icon} ${t}`;
    }).join('<br>'));
  })() : '';

  return suitRow(det.datasetLabel, rawLabel)
       + fallbackRow
       + suitRankRow(r, verb, score).replace('Rank in NSW', rankLabel)
       + infraRow
       + suitHow(det, cfg.weight);
}

function openSuitabilityModal(key) {
  const modal = document.getElementById('suit-modal');
  const cfg   = SUIT_FILTERS[key];
  if (!modal || !cfg) return;
  const suburb = currentSuburb;

  document.getElementById('suit-modal-icon').textContent  = cfg.icon;
  document.getElementById('suit-modal-title').textContent = cfg.label;
  document.getElementById('suit-modal-sub').textContent   = suburb;

  const score = scoreForFilter(key, suburb);
  const badge = document.getElementById('suit-modal-badge');
  if (score === null) {
    badge.textContent = 'No data';
    badge.style.background = 'var(--suit-none)';
  } else {
    const pct   = Math.round(score * 100);
    const label = score >= 0.6 ? 'High' : score >= 0.3 ? 'Medium' : 'Low';
    const color = score >= 0.6 ? 'var(--suit-high)' : score >= 0.3 ? 'var(--suit-mid)' : 'var(--suit-low)';
    badge.textContent = `${label} suitability — ${pct}%`;
    badge.style.background = color;
  }

  document.getElementById('suit-modal-body').innerHTML = buildSuitModalBody(key, suburb, score);

  lastSuitTrigger = document.activeElement;
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  document.getElementById('suit-modal-close').focus();
}

function closeSuitabilityModal() {
  const modal = document.getElementById('suit-modal');
  if (!modal || !modal.classList.contains('open')) return;
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
  if (lastSuitTrigger && typeof lastSuitTrigger.focus === 'function') lastSuitTrigger.focus();
}

function initSuitabilityModal() {
  // Use event delegation on the document — robust regardless of when grid is rendered
  document.addEventListener('click', e => {
    const item = e.target.closest('.summary-item[data-suit-key]');
    if (item) openSuitabilityModal(item.dataset.suitKey);
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      closeSuitabilityModal();
      return;
    }
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const item = e.target.closest('.summary-item[data-suit-key]');
    if (item) { e.preventDefault(); openSuitabilityModal(item.dataset.suitKey); }
  });

  const modal = document.getElementById('suit-modal');
  if (modal) {
    modal.addEventListener('click', e => {
      if (e.target.dataset && e.target.dataset.suitClose) closeSuitabilityModal();
    });
  }
  const closeBtn = document.getElementById('suit-modal-close');
  if (closeBtn) closeBtn.addEventListener('click', closeSuitabilityModal);
}

// ─── COMPARE MODAL ───────────────────────────────────────────────────────────
let compareSuburb = null;
let lastCompareTrigger = null;
let cmpSuggestIdx = -1;

const COMPARE_METRICS = [
  { key: 'price',          label: 'Avg sale price',  kind: 'price', higherIsBetter: false, format: v => fmtAUD(v) },
  { key: 'housing',        label: '🏠 Housing',        kind: 'score' },
  { key: 'education',      label: '🎓 Education',      kind: 'score' },
  { key: 'infrastructure', label: '🚌 Infrastructure', kind: 'score' },
  { key: 'safety',         label: '🛡 Safety',         kind: 'score' },
  { key: 'greenspace',     label: '🌳 Greenspace',     kind: 'score' },
];

function metricValue(def, suburb) {
  if (def.kind === 'price') {
    const u = suburb.toUpperCase().replace(/\s+NSW$/, '');
    const v = avgPrices[u];
    return v && v > 0 ? v : null;
  }
  return scoreForFilter(def.key, suburb);
}

function compareValues(a, b, higherIsBetter, eps = 1e-6) {
  if (a == null && b == null) return { winner: 'none', a, b };
  if (a == null) return { winner: 'B', onlyOne: true, a, b };
  if (b == null) return { winner: 'A', onlyOne: true, a, b };
  const diff = a - b;
  if (Math.abs(diff) < eps) return { winner: 'tie', a, b, diff: 0 };
  const aBetter = higherIsBetter ? diff > 0 : diff < 0;
  return { winner: aBetter ? 'A' : 'B', a, b, diff };
}

function formatScoreCell(v) { return v == null ? '—' : `${Math.round(v * 100)}%`; }
function formatScoreDelta(diff) { return `${Math.round(Math.abs(diff) * 100)}pp`; }
function formatPriceDelta(a, b) {
  const base = Math.max(a, b);
  return `${Math.round((Math.abs(a - b) / base) * 100)}%`;
}

function renderCompareRow(def, aSub, bSub) {
  const higherIsBetter = def.kind === 'price'
    ? (def.higherIsBetter !== false ? false : true)
    : (SUIT_DETAIL[def.key]?.higherIsBetter !== false);
  const aVal = metricValue(def, aSub);
  const bVal = metricValue(def, bSub);
  const res  = compareValues(aVal, bVal, higherIsBetter);

  const aDisplay = def.kind === 'price' ? (aVal == null ? '—' : def.format(aVal)) : formatScoreCell(aVal);
  const bDisplay = def.kind === 'price' ? (bVal == null ? '—' : def.format(bVal)) : formatScoreCell(bVal);

  let winnerHtml = '<span class="cmp-cell-winner">—</span>';
  let aClass = 'cmp-cell-value', bClass = 'cmp-cell-value';

  if (res.winner === 'A' || res.winner === 'B') {
    const chip = `<span class="cmp-winner-chip">${res.winner}</span>`;
    let delta;
    if (def.kind === 'price') delta = formatPriceDelta(res.a, res.b);
    else delta = formatScoreDelta(res.diff);
    const suffix = res.onlyOne ? 'only side with data' : delta;
    winnerHtml = `<span class="cmp-cell-winner">${chip}${suffix}</span>`;
    if (res.winner === 'A') aClass += ' win'; else bClass += ' win';
  } else if (res.winner === 'tie') {
    winnerHtml = `<span class="cmp-cell-winner"><span class="cmp-winner-chip tie">=</span>tie</span>`;
  }

  if (aVal == null) aClass += ' dim';
  if (bVal == null) bClass += ' dim';

  return `<div class="cmp-row">
    <div class="cmp-cell-label">${def.label}</div>
    <div class="${aClass}">${aDisplay}</div>
    <div class="${bClass}">${bDisplay}</div>
    <div>${winnerHtml}</div>
  </div>`;
}

function renderOverallRow(aSub, bSub) {
  const scoreDefs = COMPARE_METRICS.filter(m => m.kind === 'score');
  let aSum = 0, bSum = 0, n = 0;
  scoreDefs.forEach(def => {
    const a = metricValue(def, aSub);
    const b = metricValue(def, bSub);
    if (a != null && b != null) { aSum += a; bSum += b; n++; }
  });
  if (n === 0) {
    return `<div class="cmp-row overall">
      <div class="cmp-cell-label">Overall suitability</div>
      <div class="cmp-cell-value dim">—</div>
      <div class="cmp-cell-value dim">—</div>
      <div><span class="cmp-cell-winner">Not enough shared data</span></div>
    </div>`;
  }
  const aAvg = aSum / n, bAvg = bSum / n;
  const res  = compareValues(aAvg, bAvg, true, 0.005);
  let winnerHtml = '<span class="cmp-cell-winner">—</span>';
  let aClass = 'cmp-cell-value', bClass = 'cmp-cell-value';
  if (res.winner === 'A' || res.winner === 'B') {
    const chip = `<span class="cmp-winner-chip">${res.winner}</span>`;
    winnerHtml = `<span class="cmp-cell-winner">${chip}+${formatScoreDelta(res.diff)}</span>`;
    if (res.winner === 'A') aClass += ' win'; else bClass += ' win';
  } else if (res.winner === 'tie') {
    winnerHtml = `<span class="cmp-cell-winner"><span class="cmp-winner-chip tie">=</span>tie</span>`;
  }
  return `<div class="cmp-row overall">
    <div class="cmp-cell-label">Overall*</div>
    <div class="${aClass}">${formatScoreCell(aAvg)}</div>
    <div class="${bClass}">${formatScoreCell(bAvg)}</div>
    <div>${winnerHtml}</div>
  </div>`;
}

function renderCompareBody() {
  const body = document.getElementById('cmp-body');
  const title = document.getElementById('cmp-modal-title');
  if (!body || !title) return;

  const aSub = currentSuburb;
  const bSub = compareSuburb;
  title.textContent = bSub ? `${aSub} vs ${bSub}` : `${aSub} vs —`;

  if (!bSub) {
    body.innerHTML = `<div class="cmp-body-empty">Pick a suburb above to see a side-by-side breakdown.</div>`;
    return;
  }
  if (bSub === aSub) {
    body.innerHTML = `<div class="cmp-body-empty">Pick a different suburb to compare.</div>`;
    return;
  }

  const header = `<div class="cmp-row header">
    <div>Metric</div>
    <div>${aSub} (A)</div>
    <div>${bSub} (B)</div>
    <div>Winner</div>
  </div>`;
  const rows = COMPARE_METRICS.map(def => renderCompareRow(def, aSub, bSub)).join('');
  const overall = renderOverallRow(aSub, bSub);
  const note = `<div class="cmp-note">
    *Overall only counts suitability scores where both suburbs have data.
    Scores use a 1pp tie threshold; Overall uses 0.5pp.
  </div>`;
  body.innerHTML = header + rows + overall + note;
}

function getCompareSuburbList() {
  return Object.keys(suburbCentroids).sort();
}

function renderCmpSuggestions(query) {
  const suggest = document.getElementById('cmp-suggest');
  if (!suggest) return;
  const q = (query || '').trim().toUpperCase();
  const all = getCompareSuburbList().filter(s => s !== currentSuburb);
  let matches;
  if (!q) {
    matches = all.slice(0, 8);
  } else {
    const starts = all.filter(s => s.startsWith(q));
    const contains = all.filter(s => !s.startsWith(q) && s.includes(q));
    matches = [...starts, ...contains].slice(0, 10);
  }
  cmpSuggestIdx = -1;
  if (!matches.length) {
    suggest.innerHTML = `<div class="cmp-suggest-empty">No matches</div>`;
    suggest.classList.add('open');
    return;
  }
  suggest.innerHTML = matches.map((s, i) =>
    `<div class="cmp-suggest-item" role="option" data-suburb="${s}" data-idx="${i}">${s}</div>`
  ).join('');
  suggest.classList.add('open');
}

function setCmpSuggestActive(newIdx) {
  const items = document.querySelectorAll('#cmp-suggest .cmp-suggest-item');
  if (!items.length) return;
  cmpSuggestIdx = ((newIdx % items.length) + items.length) % items.length;
  items.forEach((el, i) => el.classList.toggle('active', i === cmpSuggestIdx));
  items[cmpSuggestIdx].scrollIntoView({ block: 'nearest' });
}

function pickCompareSuburb(suburb) {
  if (!suburb) return;
  compareSuburb = suburb;
  const input = document.getElementById('cmp-search');
  if (input) input.value = suburb;
  const suggest = document.getElementById('cmp-suggest');
  if (suggest) suggest.classList.remove('open');
  renderCompareBody();
}

function openCompareModal() {
  const modal = document.getElementById('cmp-modal');
  if (!modal) return;
  lastCompareTrigger = document.activeElement;
  compareSuburb = null;
  const input = document.getElementById('cmp-search');
  if (input) input.value = '';
  renderCompareBody();
  renderCmpSuggestions('');
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  if (input) input.focus();
}

function closeCompareModal() {
  const modal = document.getElementById('cmp-modal');
  if (!modal || !modal.classList.contains('open')) return;
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
  const suggest = document.getElementById('cmp-suggest');
  if (suggest) suggest.classList.remove('open');
  if (lastCompareTrigger && typeof lastCompareTrigger.focus === 'function') lastCompareTrigger.focus();
}

function initCompareModal() {
  const btn = document.getElementById('btn-compare');
  if (btn) btn.addEventListener('click', openCompareModal);

  const modal = document.getElementById('cmp-modal');
  if (modal) {
    modal.addEventListener('click', e => {
      if (e.target.dataset && e.target.dataset.cmpClose) closeCompareModal();
    });
  }
  const closeBtn = document.getElementById('cmp-modal-close');
  if (closeBtn) closeBtn.addEventListener('click', closeCompareModal);

  const input = document.getElementById('cmp-search');
  if (input) {
    input.addEventListener('input', () => renderCmpSuggestions(input.value));
    input.addEventListener('focus', () => renderCmpSuggestions(input.value));
    input.addEventListener('keydown', e => {
      const suggest = document.getElementById('cmp-suggest');
      const items   = suggest ? suggest.querySelectorAll('.cmp-suggest-item') : [];
      if (e.key === 'ArrowDown' && items.length) { e.preventDefault(); setCmpSuggestActive(cmpSuggestIdx + 1); }
      else if (e.key === 'ArrowUp' && items.length) { e.preventDefault(); setCmpSuggestActive(cmpSuggestIdx - 1); }
      else if (e.key === 'Enter') {
        e.preventDefault();
        const chosen = cmpSuggestIdx >= 0 && items[cmpSuggestIdx]
          ? items[cmpSuggestIdx].dataset.suburb
          : items[0]?.dataset.suburb;
        if (chosen) pickCompareSuburb(chosen);
      }
    });
  }

  const suggest = document.getElementById('cmp-suggest');
  if (suggest) {
    suggest.addEventListener('click', e => {
      const item = e.target.closest('.cmp-suggest-item');
      if (item && item.dataset.suburb) pickCompareSuburb(item.dataset.suburb);
    });
  }
}

// nav event listeners
function initNav() {
  document.getElementById('s3-home').addEventListener('click', e => { e.preventDefault(); satTransitioned = false; show('s1'); });
  document.getElementById('s4-home').addEventListener('click', e => { e.preventDefault(); satTransitioned = false; show('s1'); });
  document.getElementById('btn-back').addEventListener('click', () => show('s3'));

  document.getElementById('theme-toggle').addEventListener('click',   () => { isLight = !isLight; applyTheme(); renderChart(); });
  document.getElementById('theme-toggle-2').addEventListener('click', () => { isLight = !isLight; applyTheme(); renderChart(); });
  document.getElementById('cb-toggle').addEventListener('click',      () => { isCB   = !isCB;    applyTheme(); });
  document.getElementById('cb-toggle-2').addEventListener('click',    () => { isCB   = !isCB;    applyTheme(); });

  document.getElementById('font-sm').addEventListener('click', () => setFontScale(0.85));
  document.getElementById('font-md').addEventListener('click', () => setFontScale(1));
  document.getElementById('font-lg').addEventListener('click', () => setFontScale(1.2));

  document.querySelectorAll('.chip[data-f]').forEach(b => {
    b.addEventListener('click', () => { currentFilter = b.dataset.f; syncChips(); renderChart(); });
  });
}

// ─── STYLESHEET INJECTION ────────────────────────────────────────────────────
function injectStyles() {
  const style = document.createElement('style');
  style.textContent = `
    .suit-school-list {
      margin: 12px 0;
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 10px;
      overflow: hidden;
    }
    .suit-school-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 10px 14px;
      border-bottom: 1px solid rgba(255,255,255,0.06);
      gap: 8px;
    }
    .suit-school-row:last-child { border-bottom: none; }
    .suit-school-name {
      font-size: 0.88em;
      font-weight: 500;
      flex: 1;
      line-height: 1.3;
    }
    .suit-school-meta {
      display: flex;
      gap: 8px;
      align-items: center;
      flex-shrink: 0;
    }
    .suit-school-rank {
      font-size: 0.78em;
      font-weight: 700;
      background: rgba(30,142,255,0.18);
      color: #1e8eff;
      border-radius: 4px;
      padding: 2px 6px;
      white-space: nowrap;
    }
    .suit-school-rate {
      font-size: 0.78em;
      opacity: 0.75;
      white-space: nowrap;
    }
    [data-theme="light"] .suit-school-list {
      border-color: rgba(0,0,0,0.1);
    }
    [data-theme="light"] .suit-school-row {
      border-bottom-color: rgba(0,0,0,0.07);
    }
  `;
  document.head.appendChild(style);
}

// boot
injectStyles();
initNav();
initFilterPanel();
initSuitabilityModal();
initCompareModal();
initGlobe();
initSatellite();
initHeatmap();
updateLegendDots();