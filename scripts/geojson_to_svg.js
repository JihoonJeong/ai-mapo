#!/usr/bin/env node
/**
 * geojson_to_svg.js
 * Extracts Mapo-gu 16 dongs from national GeoJSON → SVG map
 *
 * Usage: node scripts/geojson_to_svg.js [path-to-geojson]
 * Default: /tmp/admdong.geojson
 */

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const geojsonPath = process.argv[2] || '/tmp/admdong.geojson';

// --- Dong code mapping (8-digit admin code → dong ID) ---
const CODE_TO_DONG = {
  '1144055500': { id: 'ahyeon', name: '아현동' },
  '1144056500': { id: 'gongdeok', name: '공덕동' },
  '1144058500': { id: 'dohwa', name: '도화동' },
  '1144059000': { id: 'yonggang', name: '용강동' },
  '1144060000': { id: 'daeheung', name: '대흥동' },
  '1144061000': { id: 'yeomni', name: '염리동' },
  '1144063000': { id: 'sinsu', name: '신수동' },
  '1144065500': { id: 'seogang', name: '서강동' },
  '1144066000': { id: 'seogyo', name: '서교동' },
  '1144068000': { id: 'hapjeong', name: '합정동' },
  '1144069000': { id: 'mangwon1', name: '망원1동' },
  '1144070000': { id: 'mangwon2', name: '망원2동' },
  '1144071000': { id: 'yeonnam', name: '연남동' },
  '1144072000': { id: 'seongsan1', name: '성산1동' },
  '1144073000': { id: 'seongsan2', name: '성산2동' },
  '1144074000': { id: 'sangam', name: '상암동' },
};

const MAPO_CODES = new Set(Object.keys(CODE_TO_DONG));

console.log(`Loading GeoJSON from ${geojsonPath}...`);
const geojson = JSON.parse(readFileSync(geojsonPath, 'utf8'));

// --- Filter Mapo-gu features ---
const mapoFeatures = geojson.features.filter(f => {
  const code = f.properties.adm_cd2;
  return MAPO_CODES.has(code);
});

console.log(`Found ${mapoFeatures.length} Mapo-gu dong features`);

if (mapoFeatures.length !== 16) {
  console.warn(`Expected 16 dongs, got ${mapoFeatures.length}`);
  const found = mapoFeatures.map(f => f.properties.adm_cd2);
  const missing = [...MAPO_CODES].filter(c => !found.includes(c));
  if (missing.length) console.warn('Missing codes:', missing.map(c => `${c} (${CODE_TO_DONG[c].name})`));
}

// --- Collect all coordinates to compute bounding box ---
let minLon = Infinity, maxLon = -Infinity;
let minLat = Infinity, maxLat = -Infinity;

function forEachCoord(geometry, fn) {
  if (geometry.type === 'Polygon') {
    for (const ring of geometry.coordinates) {
      for (const [lon, lat] of ring) fn(lon, lat);
    }
  } else if (geometry.type === 'MultiPolygon') {
    for (const polygon of geometry.coordinates) {
      for (const ring of polygon) {
        for (const [lon, lat] of ring) fn(lon, lat);
      }
    }
  }
}

for (const f of mapoFeatures) {
  forEachCoord(f.geometry, (lon, lat) => {
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  });
}

console.log(`Bounding box: lon [${minLon.toFixed(4)}, ${maxLon.toFixed(4)}], lat [${minLat.toFixed(4)}, ${maxLat.toFixed(4)}]`);

// --- Projection: Lon/Lat → SVG pixel coordinates ---
const SVG_WIDTH = 800;
const SVG_HEIGHT = 650;
const PADDING = 30;

const lonRange = maxLon - minLon;
const latRange = maxLat - minLat;

// Adjust for aspect ratio (approximate at this latitude)
const latCos = Math.cos(((minLat + maxLat) / 2) * Math.PI / 180);
const adjustedLonRange = lonRange * latCos;

let scaleX, scaleY, offsetX, offsetY;
const availW = SVG_WIDTH - 2 * PADDING;
const availH = SVG_HEIGHT - 2 * PADDING;

if (adjustedLonRange / latRange > availW / availH) {
  // Wider than tall — fit to width
  scaleX = availW / lonRange;
  scaleY = scaleX / latCos; // Correct aspect
  offsetX = PADDING;
  offsetY = PADDING + (availH - latRange * scaleY) / 2;
} else {
  scaleY = availH / latRange;
  scaleX = scaleY * latCos;
  offsetX = PADDING + (availW - lonRange * scaleX) / 2;
  offsetY = PADDING;
}

function projectPoint(lon, lat) {
  const x = (lon - minLon) * scaleX + offsetX;
  const y = (maxLat - lat) * scaleY + offsetY; // Flip Y
  return [Math.round(x * 10) / 10, Math.round(y * 10) / 10];
}

// --- Convert geometry to SVG path d string ---
function geometryToPath(geometry) {
  const parts = [];

  function ringToPath(ring) {
    const points = ring.map(([lon, lat]) => projectPoint(lon, lat));
    const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0]},${p[1]}`).join(' ');
    return d + ' Z';
  }

  if (geometry.type === 'Polygon') {
    for (const ring of geometry.coordinates) {
      parts.push(ringToPath(ring));
    }
  } else if (geometry.type === 'MultiPolygon') {
    for (const polygon of geometry.coordinates) {
      for (const ring of polygon) {
        parts.push(ringToPath(ring));
      }
    }
  }

  return parts.join(' ');
}

// --- Compute centroid for labels ---
function computeCentroid(geometry) {
  let sumX = 0, sumY = 0, count = 0;
  forEachCoord(geometry, (lon, lat) => {
    const [x, y] = projectPoint(lon, lat);
    sumX += x;
    sumY += y;
    count++;
  });
  return [Math.round(sumX / count * 10) / 10, Math.round(sumY / count * 10) / 10];
}

// --- Build SVG ---
let paths = '';
let labels = '';

for (const f of mapoFeatures) {
  const code = f.properties.adm_cd2;
  const dong = CODE_TO_DONG[code];
  if (!dong) continue;

  const d = geometryToPath(f.geometry);
  const [cx, cy] = computeCentroid(f.geometry);

  paths += `  <path id="dong_${dong.id}" class="dong" d="${d}" data-dong-id="${dong.id}" data-name="${dong.name}"/>\n`;
  labels += `  <text class="dong-label" x="${cx}" y="${cy}">${dong.name}</text>\n`;
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SVG_WIDTH} ${SVG_HEIGHT}" width="${SVG_WIDTH}" height="${SVG_HEIGHT}">
  <style>
    .dong { fill: #cbd5e1; stroke: #475569; stroke-width: 1; }
    .dong-label { font-size: 10px; fill: #1e293b; text-anchor: middle; dominant-baseline: central; pointer-events: none; font-family: -apple-system, sans-serif; font-weight: 500; }
  </style>
  <g id="dong-paths">
${paths}  </g>
  <g id="dong-labels">
${labels}  </g>
</svg>`;

const outPath = join(ROOT, 'assets/mapo_map.svg');
writeFileSync(outPath, svg, 'utf8');
console.log(`\nGenerated ${outPath}`);
console.log(`  ${mapoFeatures.length} dongs, SVG ${SVG_WIDTH}x${SVG_HEIGHT}`);
