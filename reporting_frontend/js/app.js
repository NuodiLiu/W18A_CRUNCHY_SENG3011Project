/*
  HouseDomain (HD) — app.js
  NSW Property Explorer — SENG3011 W18A CRUNCHY

  External dependencies (loaded via HTML):
  - Leaflet v1.9.4      (map rendering)
  - Three.js r160       (WebGL globe)
  - Chart.js v4.4.7     (line charts)
*/

import * as THREE from 'three';

// ═══════════════════════════════════════════════════════════
//  CONFIG
// ═══════════════════════════════════════════════════════════
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
  education:      { icon: '🎓', label: 'Education',         dataset: 'school_enrolment', weight: 0.8, invert: false },
  infrastructure: { icon: '🚌', label: 'Infrastructure',    dataset: 'transport_facility',weight: 0.7, invert: false },
  safety:         { icon: '🛡', label: 'Safety',            dataset: 'crime',            weight: 0.9, invert: true  },
  greenspace:     { icon: '🌳', label: 'Green Space',       dataset: null,               weight: 0.6, invert: false },
};

// ═══════════════════════════════════════════════════════════
//  STATE
// ═══════════════════════════════════════════════════════════
let map2 = null, map3 = null, suburbLayer = null, selectedPoly = null;
let currentSuburb = 'NARRABEEN', currentFilter = 'purchase_price';
let activeChart = null;
const avgPrices = {};        // UPPER-CASE suburb → avg price (last 3 years)
const filterData = {};       // filterKey → { suburb → normalised 0-1 score }
const suitabilityCache = {}; // suburb → combined 0-1 score
const activeFilters = new Set(['housing']);

let globeRaf = null, earthMesh = null, cloudMesh = null;
let gCamera = null, gRenderer = null, gScene = null;
let satTransitioned = false;
let isLight = false, isCB = false;

// ═══════════════════════════════════════════════════════════
//  UTILITIES
// ═══════════════════════════════════════════════════════════
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

// ═══════════════════════════════════════════════════════════
//  ACCESSIBILITY — theme & font scale
// ═══════════════════════════════════════════════════════════
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

// ═══════════════════════════════════════════════════════════
//  ROUTING
// ═══════════════════════════════════════════════════════════
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

// ═══════════════════════════════════════════════════════════
//  S1 — THREE.JS GLOBE
// ═══════════════════════════════════════════════════════════
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

// ═══════════════════════════════════════════════════════════
//  S2 — SATELLITE
// ═══════════════════════════════════════════════════════════
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

// ═══════════════════════════════════════════════════════════
//  PRICE LOADING
//  Primary: breakdown endpoint (all suburbs, one call)
//  Fallback: per-suburb events, filtered to last 3 years
// ═══════════════════════════════════════════════════════════
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
        // Prefer last 3 years, fall back to all
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

// ═══════════════════════════════════════════════════════════
//  FILTER DATA LOADING
//  Uses real API dataset_types per swagger:
//   - school_enrolment  → education score
//   - transport_facility → infrastructure score
//   - crime             → safety score (inverted)
// ═══════════════════════════════════════════════════════════
async function loadFilterData() {
  const datasets = [
    { key: 'education',      dataset: 'school_enrolment',  invert: false },
    { key: 'infrastructure', dataset: 'transport_facility', invert: false },
    { key: 'safety',         dataset: 'crime',              invert: true  },
  ];
  await Promise.all(datasets.map(async ({ key, dataset, invert }) => {
    try {
      const url = `${API}/api/v1/visualisation/breakdown` +
        `?dataset_type=${dataset}&dimension=suburb&metric=count&aggregation=count&limit=2000`;
      const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!r.ok) throw new Error(`${r.status}`);
      const j = await r.json();
      const entries = j.entries || [];
      const vals = entries.map(e => Number(e.value || e.count || 0)).filter(v => v > 0);
      const maxV = vals.length ? Math.max(...vals) : 1;
      filterData[key] = {};
      entries.forEach(e => {
        const name = (e.category || '').toUpperCase();
        const raw  = Math.min(1, Number(e.value || e.count || 0) / maxV);
        if (name) filterData[key][name] = invert ? 1 - raw : raw;
      });
      console.log(`${key} data: ${Object.keys(filterData[key]).length} suburbs`);
    } catch (e) {
      console.warn(`${key} data unavailable:`, e.message);
      filterData[key] = {};
    }
  }));
  computeSuitability();
  repaintLayer();
  renderSuitabilitySummary();
}

// ═══════════════════════════════════════════════════════════
//  SUITABILITY SCORING
// ═══════════════════════════════════════════════════════════
function computeSuitability() {
  const prices = Object.values(avgPrices).filter(p => p > 0);
  if (!prices.length) return;

  // Establish bounds for housing normalization
  const sortedPrices = [...prices].sort((a, b) => a - b);
  const p10 = sortedPrices[Math.floor(sortedPrices.length * 0.10)] || 500000;
  const p90 = sortedPrices[Math.floor(sortedPrices.length * 0.90)] || 3000000;
  const priceRange = Math.max(p90 - p10, 1);

  // Identify all unique suburbs across all datasets
  const allSuburbs = new Set([
    ...Object.keys(avgPrices),
    ...Object.values(filterData).flatMap(d => Object.keys(d))
  ]);

  allSuburbs.forEach(suburb => {
    let weightedSum = 0;
    let totalWeight = 0;

    Object.entries(SUIT_FILTERS).forEach(([key, cfg]) => {
      if (!activeFilters.has(key)) return;

      let val = null;

      // 1. Housing Logic
      if (key === 'housing') {
        const price = avgPrices[suburb];
        if (price > 0) {
          const clamped = Math.max(p10, Math.min(p90, price));
          val = 1 - (clamped - p10) / priceRange;
        }
      } 
      // 2. Dynamic Metric Logic (Education, Greenspace, Infrastructure, etc.)
      else {
        // Fetch from filterData (covers most metrics)
        if (filterData[key] && filterData[key][suburb] !== undefined) {
          val = filterData[key][suburb];
        } 
        // Fallback for custom logic like greenspace
        else if (key === 'greenspace') {
          val = suburbStubScore(suburb, 'greenspace');
        }
      }

      // Add to weighted score if data exists
      if (val !== null && val !== undefined) {
        weightedSum += val * cfg.weight;
        totalWeight += cfg.weight;
      }
    });

    // Final score: -1 means "No sufficient data to calculate"
    suitabilityCache[suburb] = totalWeight > 0 ? weightedSum / totalWeight : -1;
  });
}

// ═══════════════════════════════════════════════════════════
//  SUITABILITY COLOUR
// ═══════════════════════════════════════════════════════════
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

// ═══════════════════════════════════════════════════════════
//  S3 — CHOROPLETH HEATMAP
// ═══════════════════════════════════════════════════════════
async function initHeatmap() {
  map3 = L.map('heatmap-map', { zoomControl: true }).setView([-33.86, 151.2], 10);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png', {
    attribution: '© OpenStreetMap contributors © CARTO',
    subdomains: 'abcd', maxZoom: 19,
  }).addTo(map3);

  // Start price + filter loads in parallel with GeoJSON
  const pricesPromise = loadAllPrices();
  loadFilterData();
  setStatus('Loading suburb boundaries…');

  let geojson = null;
  try {
    const r = await fetch(NSW_GEO, { signal: AbortSignal.timeout(10000) });
    if (r.ok) {
      geojson = await r.json();
      (geojson.features || []).forEach(f => {
        const p = f.properties || {};
        if (!p.suburbname) p.suburbname = (p.nsw_loca_2 || p.SAL_NAME21 || p.LOC_NAME || '').trim();
      });
      console.log(`Real GeoJSON: ${geojson.features.length} suburb polygons`);
    }
  } catch (e) {
    console.warn('GeoJSON not found — using built-in shapes:', e.message);
  }
  if (!geojson || (geojson.features || []).length === 0) geojson = builtInGeoJSON();

  buildLayer(geojson);
  await pricesPromise;
  computeSuitability();
  repaintLayer();
}

function suburbStyle(f) {
  const name    = featName(f);
  const score   = getScore(name);
  const hasData = getPrice(name) > 0;
  return {
    weight:      0.8,
    color:       'rgba(255,255,255,0.15)',
    fillColor:   suitabilityColor(score, hasData),
    fillOpacity: score === -1 ? 0.55 : 0.72,
    smoothFactor: 1.2,
  };
}

function tipHtml(name) {
  const price    = getPrice(name);
  const score    = getScore(name);
  const hasData  = price > 0;
  if (!hasData) {
    return `<strong>${name}</strong><br><span style="color:#9ca3af">No housing data available in this area</span>`;
  }
  const scoreLabel = score >= 0.6 ? 'High 🟢' : score >= 0.3 ? 'Medium 🟡' : 'Low 🔴';
  const activeList = Array.from(activeFilters)
    .map(f => SUIT_FILTERS[f]?.label || f).join(', ');
  return `<strong>${name}</strong><br>` +
    `<span style="color:#38beff">${fmtAUD(price)}</span> avg sale<br>` +
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

// ═══════════════════════════════════════════════════════════
//  FILTER PANEL
// ═══════════════════════════════════════════════════════════
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

// ═══════════════════════════════════════════════════════════
//  S4 — CHART
//  Filters: purchase_price, count, income, population
//  All wired to real API endpoints from swagger
// ═══════════════════════════════════════════════════════════
function syncChips() {
  document.querySelectorAll('.chip[data-f]').forEach(b => {
    const active = b.dataset.f === currentFilter;
    b.classList.toggle('active', active);
    b.setAttribute('aria-pressed', String(active));
  });
}

async function renderChart() {
  const cfg = CHART_FILTERS[currentFilter];
  let series = { labels: [], data: [], type: 'line' };

  // ── Helper: find entry for current suburb regardless of casing/suffix ──
  function matchSuburb(entries) {
    const u = currentSuburb.toUpperCase().replace(/ NSW$/, '');
    return entries.find(e => {
      const cat = (e.category || e.suburb || e.series || '').toString().toUpperCase().replace(/ NSW$/, '');
      return cat === u;
    });
  }

  try {
    if (currentFilter === 'purchase_price' || currentFilter === 'count') {
      // ── Try timeseries first (grouped by suburb per year) ──
      try {
        const r = await fetch(
          `${API}/api/v1/visualisation/timeseries` +
          `?dataset_type=housing&metric=purchase_price&aggregation=avg&time_period=year&dimension=suburb`,
          { signal: AbortSignal.timeout(15000) }
        );
        if (r.ok) {
          const j = await r.json();
          const u = currentSuburb.toUpperCase().replace(/ NSW$/, '');
          const filtered = (j.data || []).filter(d => {
            const s = (d.series || '').toUpperCase().replace(/ NSW$/, '');
            return s === u;
          });
          if (filtered.length) {
            series = {
              type: 'line',
              labels: filtered.map(d => d.period),
              data:   filtered.map(d => currentFilter === 'count' ? (d.count || 0) : (d.value || 0)),
            };
            console.log(`Timeseries OK for ${currentSuburb}: ${filtered.length} points`);
          }
        }
      } catch(e) { console.warn('Timeseries failed:', e.message); }

      // ── Fallback: raw events ──
      if (!series.labels.length) {
        console.log(`Falling back to events for ${currentSuburb}`);
        const r2 = await fetch(
          `${API}/api/v1/events?dataset_type=housing&suburb=${encodeURIComponent(currentSuburb)}&limit=500`,
          { signal: AbortSignal.timeout(14000) }
        );
        if (r2.ok) {
          const j2 = await r2.json();
          series = { type: 'line', ...buildHousingSeriesFromEvents(j2.events || []) };
          console.log(`Events fallback: ${series.labels.length} years, total events: ${j2.total}`);
        }
      }

    } else if (currentFilter === 'income') {
      // ── Income: bar chart from abs_community_profile breakdown ──
      // metric field names to try in order
      const incomeMetrics = [
        'median_household_income_weekly',
        'median_household_income',
        'household_income',
        'income',
      ];
      for (const metric of incomeMetrics) {
        try {
          const r = await fetch(
            `${API}/api/v1/visualisation/breakdown` +
            `?dataset_type=abs_community_profile&metric=${metric}&aggregation=avg&dimension=suburb&limit=2000`,
            { signal: AbortSignal.timeout(15000) }
          );
          if (!r.ok) continue;
          const j = await r.json();
          const entries = j.entries || [];
          console.log(`Income breakdown (${metric}): ${entries.length} entries, sample:`, entries.slice(0,2));
          const entry = matchSuburb(entries);
          if (entry && Number(entry.value || 0) > 0) {
            series = {
              type: 'bar',
              labels: ['Weekly Median Income'],
              data:   [Number(entry.value || 0)],
            };
            console.log(`Income found for ${currentSuburb}: $${entry.value}/wk`);
            break;
          }
          // If we got entries but no match, show all entries as a comparison bar chart
          if (entries.length > 0 && !entry) {
            // Try showing top-10 suburbs for context
            const top = entries.slice(0, 10);
            series = {
              type: 'bar',
              labels: top.map(e => (e.category || '').toString()),
              data:   top.map(e => Number(e.value || 0)),
              note:   `${currentSuburb} not found — showing top entries`,
            };
            break;
          }
        } catch(e) { console.warn(`Income metric ${metric} failed:`, e.message); }
      }

    } else if (currentFilter === 'population') {
      // ── Population: bar chart from nsw_population breakdown ──
      const popMetrics = ['population', 'count', 'total_population'];
      for (const metric of popMetrics) {
        try {
          const r = await fetch(
            `${API}/api/v1/visualisation/breakdown` +
            `?dataset_type=nsw_population&metric=${metric}&aggregation=sum&dimension=suburb&limit=2000`,
            { signal: AbortSignal.timeout(15000) }
          );
          if (!r.ok) continue;
          const j = await r.json();
          const entries = j.entries || [];
          console.log(`Population breakdown (${metric}): ${entries.length} entries, sample:`, entries.slice(0,2));
          const entry = matchSuburb(entries);
          if (entry && Number(entry.value || entry.count || 0) > 0) {
            series = {
              type: 'bar',
              labels: ['Total Population'],
              data:   [Number(entry.value || entry.count || 0)],
            };
            console.log(`Population found for ${currentSuburb}: ${entry.value || entry.count}`);
            break;
          }
          // If entries exist but no suburb match — show all for debugging
          if (entries.length && !entry) {
            console.warn(`Population: suburb "${currentSuburb}" not in ${entries.length} entries. Sample categories:`, entries.slice(0,5).map(e=>e.category));
          }
        } catch(e) { console.warn(`Population metric ${metric} failed:`, e.message); }
      }
      // Also try abs_community_profile as fallback
      if (!series.labels.length) {
        try {
          const r = await fetch(
            `${API}/api/v1/visualisation/breakdown` +
            `?dataset_type=abs_community_profile&metric=total_population&aggregation=sum&dimension=suburb&limit=2000`,
            { signal: AbortSignal.timeout(15000) }
          );
          if (r.ok) {
            const j = await r.json();
            const entry = matchSuburb(j.entries || []);
            if (entry) {
              series = { type: 'bar', labels: ['Total Population'], data: [Number(entry.value || entry.count || 0)] };
            }
          }
        } catch(e) {}
      }

    } else if (currentFilter === 'weather') {
      // ── Weather: avg temperature/rainfall from nsw_weather ──
      const weatherMetrics = ['temperature', 'max_temp', 'avg_temp', 'rainfall', 'rain'];
      for (const metric of weatherMetrics) {
        try {
          const r = await fetch(
            `${API}/api/v1/visualisation/breakdown` +
            `?dataset_type=nsw_weather&metric=${metric}&aggregation=avg&dimension=suburb&limit=2000`,
            { signal: AbortSignal.timeout(15000) }
          );
          if (!r.ok) continue;
          const j = await r.json();
          const entries = j.entries || [];
          console.log(`Weather (${metric}): ${entries.length} entries`);
          const entry = matchSuburb(entries);
          if (entry && Number(entry.value || 0) !== 0) {
            series = {
              type: 'bar',
              labels: [`Avg ${metric.replace(/_/g,' ')}`],
              data:   [Number(entry.value || 0)],
            };
            break;
          }
          // Show top entries as area comparison
          if (entries.length && !entry) {
            const top = entries.slice(0, 12);
            series = {
              type: 'bar',
              labels: top.map(e => (e.category||'').toString()),
              data:   top.map(e => Number(e.value||0)),
              note: `${currentSuburb} not found — area comparison`,
            };
            break;
          }
        } catch(e) { console.warn(`Weather metric ${metric} failed:`, e.message); }
      }
      // Fallback: timeseries
      if (!series.labels.length) {
        try {
          const r = await fetch(
            `${API}/api/v1/visualisation/timeseries?dataset_type=nsw_weather&metric=temperature&aggregation=avg&time_period=month`,
            { signal: AbortSignal.timeout(15000) }
          );
          if (r.ok) {
            const j = await r.json();
            const data = j.data || [];
            const u = currentSuburb.toUpperCase().replace(/ NSW$/, '');
            const filtered = data.filter(d => (d.series||'').toUpperCase().replace(/ NSW$/,'') === u);
            if (filtered.length) {
              series = { type: 'line', labels: filtered.map(d=>d.period), data: filtered.map(d=>d.value||0) };
            } else if (data.length) {
              // Show overall trend
              const byPeriod = {};
              data.forEach(d => { byPeriod[d.period] = (byPeriod[d.period]||[]).concat(d.value||0); });
              const periods = Object.keys(byPeriod).sort();
              series = { type: 'line', labels: periods, data: periods.map(p => byPeriod[p].reduce((a,b)=>a+b,0)/byPeriod[p].length) };
            }
          }
        } catch(e) {}
      }
    }
  } catch (e) {
    console.error('renderChart outer error:', e);
  }

  // ── No data placeholder ──
  if (!series.labels.length) {
    console.warn(`No chart data for ${currentFilter} / ${currentSuburb}`);
    series = { labels: ['No data available'], data: [0], type: 'bar' };
  }

  const clr = isLight ? cfg.colorLight : cfg.color;
  const chartType = series.type || 'line';

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

function buildHousingSeriesFromEvents(evts) {
  const yr = {};
  evts.forEach(e => {
    const ts = e.time_object?.timestamp || e.attribute?.contract_date;
    const y  = ts ? new Date(ts).getFullYear() : null;
    if (!y || y < 2015 || y > 2025) return;  // wider window
    if (!yr[y]) yr[y] = { sum: 0, n: 0 };
    const p = Number(e.attribute?.purchase_price || 0);
    if (p > 0) { yr[y].sum += p; yr[y].n++; }
  });
  const sorted = Object.keys(yr).sort();
  console.log(`buildHousingSeriesFromEvents: ${evts.length} events → ${sorted.length} years:`, sorted);
  if (!sorted.length) return { labels: [], data: [] };
  return {
    labels: sorted,
    data:   sorted.map(y => currentFilter === 'count' ? yr[y].n : (yr[y].n ? Math.round(yr[y].sum / yr[y].n) : 0)),
  };
}

// ═══════════════════════════════════════════════════════════
//  SUITABILITY SUMMARY PANEL (S4, below chart)
// ═══════════════════════════════════════════════════════════
function renderSuitabilitySummary() {
  const panel = document.getElementById('suitability-summary');
  if (!panel) return;
  const grid = panel.querySelector('.summary-grid');
  const overallBadge = panel.querySelector('.summary-overall-badge');
  const overallLabel = panel.querySelector('.summary-overall-label');
  if (!grid) return;

  const u = currentSuburb.toUpperCase();
  const scores = {};

  // Build per-filter scores for this suburb
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
    } else if (filterData[key] && filterData[key][u] !== undefined) {
      val = filterData[key][u];
    } else if (key === 'greenspace') {
      val = suburbStubScore(u, 'greenspace');
    }
    scores[key] = val;
  });

  // Overall score (weighted average of available scores)
  let totalScore = 0, totalWeight = 0;
  Object.entries(scores).forEach(([key, val]) => {
    if (val !== null) { totalScore += val * SUIT_FILTERS[key].weight; totalWeight += SUIT_FILTERS[key].weight; }
  });
  const overall = totalWeight > 0 ? totalScore / totalWeight : -1;

  // Render filter items
  grid.innerHTML = Object.entries(SUIT_FILTERS).map(([key, cfg]) => {
    const val = scores[key];
    const pct = val !== null ? Math.round(val * 100) : null;
    const barColor = val === null ? 'var(--suit-none)' : val >= 0.6 ? 'var(--suit-high)' : val >= 0.3 ? 'var(--suit-mid)' : 'var(--suit-low)';
    const label = val === null ? 'No data' : pct >= 60 ? 'High' : pct >= 30 ? 'Medium' : 'Low';
    return `
      <div class="summary-item">
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

  // Overall badge
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

// ═══════════════════════════════════════════════════════════
//  BUILT-IN GEOJSON FALLBACK
// ═══════════════════════════════════════════════════════════
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

// ═══════════════════════════════════════════════════════════
//  NAV EVENT LISTENERS
// ═══════════════════════════════════════════════════════════
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

// ═══════════════════════════════════════════════════════════
//  BOOT
// ═══════════════════════════════════════════════════════════
initNav();
initFilterPanel();
initGlobe();
initSatellite();
initHeatmap();
updateLegendDots();