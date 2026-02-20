/**
 * map.ts — SVG Map rendering for MCP App
 *
 * Simplified from js/map.js: color-coded by satisfaction,
 * hover tooltips, click selection.
 */

let mapContainer: HTMLElement | null = null;
let tooltipEl: HTMLElement | null = null;
let dongData: Array<{ name: string; satisfaction: number; population: number; vitality: number }> = [];

// Dong ID to name mapping (from SVG data attributes)
const dongIdToName: Record<string, string> = {};

const COLOR_LEVELS = [
  { min: 0, fill: '#ef4444' },   // level-1: red (low)
  { min: 40, fill: '#f97316' },  // level-2: orange
  { min: 50, fill: '#eab308' },  // level-3: yellow
  { min: 60, fill: '#22c55e' },  // level-4: green
  { min: 70, fill: '#15803d' },  // level-5: dark green (high)
];

function getSatColor(sat: number): string {
  for (let i = COLOR_LEVELS.length - 1; i >= 0; i--) {
    if (sat >= COLOR_LEVELS[i].min) return COLOR_LEVELS[i].fill;
  }
  return COLOR_LEVELS[0].fill;
}

export function initMap(container: HTMLElement, svgContent: string) {
  mapContainer = container;
  tooltipEl = document.getElementById('map-tooltip');

  // Insert SVG
  container.innerHTML = svgContent;

  // Build ID-to-name mapping and bind events
  const paths = container.querySelectorAll('.dong');
  paths.forEach(path => {
    const el = path as HTMLElement;
    const dongId = el.dataset.dongId || el.getAttribute('data-dong-id') || '';
    const name = el.dataset.name || el.getAttribute('data-name') || '';
    if (dongId) dongIdToName[dongId] = name;

    el.addEventListener('mouseenter', (e) => onHover(e as MouseEvent, dongId, name));
    el.addEventListener('mousemove', (e) => onMove(e as MouseEvent));
    el.addEventListener('mouseleave', () => onLeave());
  });

  // Add legend
  const legend = document.createElement('div');
  legend.className = 'legend';
  legend.innerHTML = COLOR_LEVELS.map((l, i) => {
    const labels = ['낮음', '', '보통', '', '높음'];
    return `<span class="legend-item"><span class="legend-color" style="background:${l.fill}"></span>${labels[i]}</span>`;
  }).join('');
  container.appendChild(legend);
}

export function updateMap(dongs: Array<{ name: string; satisfaction: number; population: number; vitality: number }>) {
  dongData = dongs;
  if (!mapContainer) return;

  // Build name-to-data lookup
  const byName: Record<string, typeof dongs[0]> = {};
  for (const d of dongs) byName[d.name] = d;

  // Color all dong paths
  const paths = mapContainer.querySelectorAll('.dong');
  paths.forEach(path => {
    const el = path as SVGPathElement;
    const dongId = el.dataset.dongId || el.getAttribute('data-dong-id') || '';
    const name = dongIdToName[dongId] || '';
    const data = byName[name];
    if (data) {
      el.style.fill = getSatColor(data.satisfaction);
    }
  });
}

function onHover(e: MouseEvent, dongId: string, name: string) {
  if (!tooltipEl) return;
  const data = dongData.find(d => d.name === name);
  tooltipEl.innerHTML = data
    ? `<strong>${name}</strong><br>인구 ${data.population.toLocaleString()} | 만족도 ${data.satisfaction}`
    : `<strong>${name}</strong>`;
  tooltipEl.style.display = 'block';
  tooltipEl.style.left = (e.clientX + 12) + 'px';
  tooltipEl.style.top = (e.clientY - 10) + 'px';
}

function onMove(e: MouseEvent) {
  if (!tooltipEl) return;
  tooltipEl.style.left = (e.clientX + 12) + 'px';
  tooltipEl.style.top = (e.clientY - 10) + 'px';
}

function onLeave() {
  if (tooltipEl) tooltipEl.style.display = 'none';
}
