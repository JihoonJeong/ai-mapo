/**
 * map.js — 마포구 SVG 맵 렌더링, 색상 코딩, 호버/클릭 인터랙션
 */

let mapContainer = null;
let tooltipEl = null;
let selectedDongId = null;
let currentIndicator = 'satisfaction';
let gameState = null;

// Zoom & pan state
let svgEl = null;
let zoomLevel = 1;
let panX = 0;
let panY = 0;
let isPanning = false;
let panStartX = 0;
let panStartY = 0;
const ZOOM_MIN = 0.8;
const ZOOM_MAX = 4.0;
const ZOOM_STEP = 0.3;

// Color scale (5 levels) — green(good) to red(bad)
const COLOR_CLASSES = ['level-1', 'level-2', 'level-3', 'level-4', 'level-5'];

const INDICATOR_CONFIG = {
  satisfaction: { label: '만족도', unit: '', reverse: false, format: v => Math.round(v) },
  populationChange: { label: '인구변화율', unit: '%', reverse: false, format: v => (v >= 0 ? '+' : '') + v.toFixed(1) + '%' },
  commerceVitality: { label: '상권활력', unit: '', reverse: false, format: v => Math.round(v) },
  rentPressure: { label: '임대료압력', unit: '', reverse: true, format: v => v.toFixed(2) },
};

export async function initMap(containerEl, state) {
  mapContainer = containerEl;
  gameState = state;
  tooltipEl = document.getElementById('map-tooltip');

  // Load SVG inline
  const resp = await fetch('assets/mapo_map.svg');
  const svgText = await resp.text();
  mapContainer.innerHTML = svgText;

  svgEl = mapContainer.querySelector('svg');

  // Bind dong events
  const paths = mapContainer.querySelectorAll('.dong');
  paths.forEach(path => {
    path.addEventListener('mouseenter', onDongHover);
    path.addEventListener('mousemove', onDongMove);
    path.addEventListener('mouseleave', onDongLeave);
    path.addEventListener('click', onDongClick);
  });

  // Zoom & pan
  initZoomPan();

  // Indicator selector
  const select = document.getElementById('map-indicator');
  if (select) {
    select.addEventListener('change', (e) => {
      currentIndicator = e.target.value;
      updateMapColors(gameState.dongs, currentIndicator);
    });
  }

  // Initial coloring
  updateMapColors(state.dongs, currentIndicator);
  renderLegend(currentIndicator);
}

// === Zoom & Pan ===
function initZoomPan() {
  if (!mapContainer || !svgEl) return;

  // Add zoom controls
  const controls = document.createElement('div');
  controls.className = 'map-zoom-controls';
  controls.innerHTML = `
    <button class="map-zoom-btn" data-action="in" title="확대">+</button>
    <button class="map-zoom-btn" data-action="out" title="축소">&minus;</button>
    <button class="map-zoom-btn" data-action="reset" title="초기화">&#8634;</button>
  `;
  mapContainer.style.position = 'relative';
  mapContainer.appendChild(controls);

  controls.querySelectorAll('.map-zoom-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const action = btn.dataset.action;
      if (action === 'in') setZoom(zoomLevel + ZOOM_STEP);
      else if (action === 'out') setZoom(zoomLevel - ZOOM_STEP);
      else if (action === 'reset') { zoomLevel = 1; panX = 0; panY = 0; applyTransform(); }
    });
  });

  // Mouse wheel zoom
  mapContainer.addEventListener('wheel', (e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
    setZoom(zoomLevel + delta);
  }, { passive: false });

  // Mouse drag pan
  mapContainer.addEventListener('mousedown', (e) => {
    if (e.target.closest('.map-zoom-btn') || e.target.closest('.dong')) return;
    isPanning = true;
    panStartX = e.clientX - panX;
    panStartY = e.clientY - panY;
    mapContainer.style.cursor = 'grabbing';
  });

  window.addEventListener('mousemove', (e) => {
    if (!isPanning) return;
    panX = e.clientX - panStartX;
    panY = e.clientY - panStartY;
    applyTransform();
  });

  window.addEventListener('mouseup', () => {
    if (isPanning) {
      isPanning = false;
      mapContainer.style.cursor = '';
    }
  });

  // Start with a comfortable zoom
  zoomLevel = 1;
  panX = 0;
  panY = 0;
  applyTransform();
}

function setZoom(level) {
  zoomLevel = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, level));
  applyTransform();
}

function applyTransform() {
  if (!svgEl) return;
  svgEl.style.transform = `translate(${panX}px, ${panY}px) scale(${zoomLevel})`;
  svgEl.style.transformOrigin = 'center center';
}

export function updateMapColors(dongs, indicator) {
  if (!indicator) indicator = currentIndicator;
  currentIndicator = indicator;

  const config = INDICATOR_CONFIG[indicator];
  if (!config) return;

  // Get values for all dongs
  const values = dongs.map(d => getIndicatorValue(d, indicator));
  const validValues = values.filter(v => v !== null);
  if (validValues.length === 0) return;

  const min = Math.min(...validValues);
  const max = Math.max(...validValues);
  const range = max - min || 1;

  // Assign color levels
  dongs.forEach((dong, i) => {
    const pathEl = mapContainer?.querySelector(`#dong_${dong.id}`);
    if (!pathEl) return;

    // Remove old level classes
    COLOR_CLASSES.forEach(c => pathEl.classList.remove(c));

    const val = values[i];
    if (val === null) return;

    // Normalize to 0-4 (5 levels)
    let normalized = Math.floor(((val - min) / range) * 4.99);
    normalized = Math.max(0, Math.min(4, normalized));

    // Reverse for "bad = high" indicators (like rent pressure)
    if (config.reverse) normalized = 4 - normalized;

    pathEl.classList.add(COLOR_CLASSES[normalized]);
  });

  renderLegend(indicator);
}

function getIndicatorValue(dong, indicator) {
  switch (indicator) {
    case 'satisfaction': return dong.satisfaction;
    case 'populationChange': {
      // Compare with initial (from history or 0 if no history)
      if (gameState?.history?.length > 0) {
        const initial = gameState.history[0]?.dongs?.find(d => d.id === dong.id);
        if (initial) return ((dong.population - initial.population) / initial.population) * 100;
      }
      return 0;
    }
    case 'commerceVitality': return dong.commerceVitality;
    case 'rentPressure': return dong.rentPressure;
    default: return null;
  }
}

function renderLegend(indicator) {
  const legendEl = document.getElementById('map-legend');
  if (!legendEl) return;
  const config = INDICATOR_CONFIG[indicator];
  if (!config) return;

  const labels = config.reverse
    ? ['높음', '', '보통', '', '낮음']
    : ['낮음', '', '보통', '', '높음'];

  legendEl.innerHTML = COLOR_CLASSES.map((cls, i) =>
    `<span class="legend-item"><span class="legend-color" style="background:var(--${cls})"></span>${labels[i]}</span>`
  ).join('');
}

function onDongHover(e) {
  const dongId = e.target.dataset.dongId;
  const dong = gameState?.dongs?.find(d => d.id === dongId);
  if (!dong || !tooltipEl) return;

  const config = INDICATOR_CONFIG[currentIndicator];
  tooltipEl.innerHTML = `
    <div class="tooltip-name">${dong.name}</div>
    <div class="tooltip-stats">
      인구 ${dong.population.toLocaleString()}명<br>
      ${config.label} ${config.format(getIndicatorValue(dong, currentIndicator))}
    </div>
  `;
  tooltipEl.classList.remove('hidden');
}

function onDongMove(e) {
  if (!tooltipEl) return;
  tooltipEl.style.left = (e.clientX + 12) + 'px';
  tooltipEl.style.top = (e.clientY - 10) + 'px';
}

function onDongLeave() {
  if (tooltipEl) tooltipEl.classList.add('hidden');
}

function onDongClick(e) {
  const dongId = e.target.dataset.dongId;

  // Toggle selection
  if (selectedDongId === dongId) {
    deselectDong();
    return;
  }

  selectDong(dongId);
}

export function selectDong(dongId) {
  // Remove previous selection
  if (selectedDongId) {
    const prev = mapContainer?.querySelector(`#dong_${selectedDongId}`);
    if (prev) prev.classList.remove('selected');
  }

  selectedDongId = dongId;
  const pathEl = mapContainer?.querySelector(`#dong_${dongId}`);
  if (pathEl) pathEl.classList.add('selected');

  showDongDetail(dongId);
}

function deselectDong() {
  if (selectedDongId) {
    const prev = mapContainer?.querySelector(`#dong_${selectedDongId}`);
    if (prev) prev.classList.remove('selected');
  }
  selectedDongId = null;
  hideDongDetail();
}

function showDongDetail(dongId) {
  const dong = gameState?.dongs?.find(d => d.id === dongId);
  if (!dong) return;

  const panel = document.getElementById('dong-detail');
  const content = document.getElementById('dong-detail-content');
  if (!panel || !content) return;

  content.innerHTML = `
    <div class="detail-dong-name">${dong.name}</div>
    <div class="detail-character">${getDongCharacter(dong)}</div>

    <div class="detail-section">
      <h3>인구</h3>
      <div class="detail-stat"><span>총인구</span><span class="detail-stat-value">${dong.population.toLocaleString()}명</span></div>
      <div class="detail-stat"><span>세대수</span><span class="detail-stat-value">${dong.households.toLocaleString()}</span></div>
      <div class="detail-stat"><span>청년(20-34)</span><span class="detail-stat-value">${dong.populationByAge.youth.toLocaleString()}명 (${(dong.populationByAge.youth / dong.population * 100).toFixed(1)}%)</span></div>
      <div class="detail-stat"><span>고령(65+)</span><span class="detail-stat-value">${dong.populationByAge.elderly.toLocaleString()}명 (${(dong.populationByAge.elderly / dong.population * 100).toFixed(1)}%)</span></div>
    </div>

    <div class="detail-section">
      <h3>경제</h3>
      <div class="detail-stat"><span>사업체</span><span class="detail-stat-value">${dong.businesses.toLocaleString()}개</span></div>
      <div class="detail-stat"><span>종사자</span><span class="detail-stat-value">${dong.workers.toLocaleString()}명</span></div>
      <div class="detail-stat"><span>상권활력</span><span class="detail-stat-value">${dong.commerceVitality}</span></div>
      <div class="detail-stat"><span>임대료압력</span><span class="detail-stat-value">${dong.rentPressure.toFixed(2)}</span></div>
      <div class="detail-stat"><span>상권특색</span><span class="detail-stat-value">${dong.commerceCharacter}</span></div>
    </div>

    <div class="detail-section">
      <h3>생활인구</h3>
      <div class="detail-stat"><span>평일 낮</span><span class="detail-stat-value">${dong.livingPop.weekdayDay.toLocaleString()}</span></div>
      <div class="detail-stat"><span>평일 밤</span><span class="detail-stat-value">${dong.livingPop.weekdayNight.toLocaleString()}</span></div>
      <div class="detail-stat"><span>낮/주민 배수</span><span class="detail-stat-value">${(dong.livingPop.weekdayDay / dong.population).toFixed(2)}x</span></div>
    </div>

    <div class="detail-section">
      <h3>만족도 ${dong.satisfaction}</h3>
      ${Object.entries(dong.satisfactionFactors).map(([k, v]) =>
        `<div class="detail-stat"><span>${getSatisfactionLabel(k)}</span><span class="detail-stat-value">${v}</span></div>`
      ).join('')}
    </div>

    <div class="detail-section">
      <h3>구획</h3>
      <div class="detail-stat"><span>구획 수</span><span class="detail-stat-value">${dong.blockSummary.total}개</span></div>
      <div class="detail-stat"><span>용도갈등</span><span class="detail-stat-value">${dong.blockSummary.zoningConflicts}개</span></div>
    </div>
  `;

  panel.classList.remove('hidden');
}

function hideDongDetail() {
  const panel = document.getElementById('dong-detail');
  if (panel) panel.classList.add('hidden');
}

function getDongCharacter(dong) {
  const chars = {
    seogyo: '관광·문화·스타트업', hapjeong: '미디어·카페문화',
    yeonnam: '트렌디·경의선숲길', mangwon1: '로컬브랜드·전통시장',
    mangwon2: '주거·한강접근', gongdeok: '교통허브·업무지구',
    ahyeon: '뉴타운·고급주거', dohwa: '주거·경공업',
    yonggang: '업무·상업', daeheung: '대학가·상권',
    yeomni: '주거·소금길마을', sinsu: '주거·경의선숲길',
    seogang: '대학가·문화', seongsan1: '주거·월드컵공원',
    seongsan2: '대단지·교육', sangam: 'DMC·미디어',
  };
  return chars[dong.id] || '';
}

function getSatisfactionLabel(key) {
  const labels = {
    economy: '경제', transport: '교통', housing: '주거',
    safety: '안전', culture: '문화', welfare: '복지',
  };
  return labels[key] || key;
}

export function updateGameState(state) {
  gameState = state;
}

// Close detail panel on button click
document.getElementById('dong-detail-close')?.addEventListener('click', () => {
  deselectDong();
});
