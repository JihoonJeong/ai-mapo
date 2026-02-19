/**
 * policy.js — 정책 선택 UI
 * 28개 정책 카탈로그 (7카테고리 × 4개), 최대 3개 동시 활성
 */

const MAX_ACTIVE = 3;
const CATEGORIES = [
  { id: 'all', name: '전체' },
  { id: 'economy', name: '경제' },
  { id: 'transport', name: '교통' },
  { id: 'culture', name: '문화' },
  { id: 'environment', name: '환경' },
  { id: 'education', name: '교육' },
  { id: 'welfare', name: '복지' },
  { id: 'renewal', name: '재생' },
];

let policyCatalog = [];
let activePolicies = []; // [{policy, remainDelay, remainDuration, turnsActive}]
let pendingSelection = []; // policy ids selected this turn (not yet activated)
let currentFilter = 'all';
let currentState = null;

export async function initPolicy(state) {
  currentState = state;
  activePolicies = state.activePolicies || [];

  try {
    const resp = await fetch('data/game/policies.json');
    const data = await resp.json();
    policyCatalog = data.policies;
  } catch (err) {
    console.warn('[Policy] Failed to load policies.json:', err);
    policyCatalog = [];
  }

  pendingSelection = [];
  renderPolicyPanel();
}

export function updatePolicyState(state) {
  currentState = state;
  activePolicies = state.activePolicies || [];
  renderPolicyPanel();
}

export function getSelectedPolicies() {
  return pendingSelection.map(id => policyCatalog.find(p => p.id === id)).filter(Boolean);
}

export function getActivePolicies() {
  return activePolicies;
}

function renderPolicyPanel() {
  const container = document.getElementById('tab-policy');
  if (!container) return;

  const freeBudget = currentState?.finance?.freeBudget || 0;
  const activeCost = activePolicies.reduce((s, ap) => s + ap.policy.cost, 0);
  const pendingCost = pendingSelection.reduce((s, id) => {
    const p = policyCatalog.find(pp => pp.id === id);
    return s + (p ? p.cost : 0);
  }, 0);
  const remainBudget = freeBudget - activeCost - pendingCost;

  // Active policies section
  let html = '';

  if (activePolicies.length > 0) {
    html += '<div class="policy-section-title">활성 정책</div>';
    html += '<div class="active-policies">';
    for (const ap of activePolicies) {
      const p = ap.policy;
      const status = ap.remainDelay > 0
        ? `준비 중 (${ap.remainDelay}턴 후 효과)`
        : ap.remainDuration > 0
          ? `시행 중 (${ap.remainDuration}턴 남음)`
          : '영구 시행';
      html += `
        <div class="active-policy-item">
          <div class="active-policy-header">
            <span class="active-policy-name">${p.name}</span>
            <span class="active-policy-cost">${p.cost}억/턴</span>
          </div>
          <div class="active-policy-status">${status}</div>
          <button class="active-policy-cancel" data-id="${p.id}">해제</button>
        </div>`;
    }
    html += '</div>';
  }

  // Budget info
  html += `<div class="policy-budget-info">
    자유예산 ${freeBudget}억 | 정책비 ${activeCost + pendingCost}억 | 잔여 ${remainBudget}억
    <span class="policy-slot-info">(${activePolicies.length + pendingSelection.length}/${MAX_ACTIVE})</span>
  </div>`;

  // Category filter
  html += '<div class="policy-filter">';
  for (const cat of CATEGORIES) {
    html += `<button class="policy-filter-btn ${cat.id === currentFilter ? 'active' : ''}" data-cat="${cat.id}">${cat.name}</button>`;
  }
  html += '</div>';

  // Policy cards
  const filtered = currentFilter === 'all'
    ? policyCatalog
    : policyCatalog.filter(p => p.category === currentFilter);

  html += '<div class="policy-grid">';
  for (const p of filtered) {
    const isActive = activePolicies.some(ap => ap.policy.id === p.id);
    const isPending = pendingSelection.includes(p.id);
    const isIncompat = isIncompatible(p);
    const slotsFull = (activePolicies.length + pendingSelection.length) >= MAX_ACTIVE && !isPending;
    const tooExpensive = p.cost > remainBudget + (isPending ? p.cost : 0);
    const disabled = isActive || isIncompat || (slotsFull && !isPending) || (tooExpensive && !isPending);

    const targetLabel = p.targetDong
      ? Array.isArray(p.targetDong)
        ? p.targetDong.length + '개 동'
        : getDongName(p.targetDong)
      : '구 전체';

    html += `
      <div class="policy-card ${isPending ? 'selected' : ''} ${disabled ? 'disabled' : ''}"
           data-id="${p.id}" ${disabled && !isPending ? 'data-disabled="true"' : ''}>
        <div class="policy-card-header">
          <span class="policy-name">${p.name}</span>
          <span class="policy-cost">${p.cost}억/턴</span>
        </div>
        <div class="policy-desc">${p.description}</div>
        <div class="policy-tags">
          <span class="policy-tag">${targetLabel}</span>
          ${p.delay > 0 ? `<span class="policy-tag">효과 ${p.delay}턴 후</span>` : ''}
          ${p.duration > 0 ? `<span class="policy-tag">${p.duration}턴 지속</span>` : '<span class="policy-tag">영구</span>'}
          ${isActive ? '<span class="policy-tag tag-active">시행 중</span>' : ''}
          ${isIncompat ? '<span class="policy-tag tag-incompat">충돌</span>' : ''}
        </div>
      </div>`;
  }
  html += '</div>';

  container.innerHTML = html;

  // Bind events
  container.querySelectorAll('.policy-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      currentFilter = btn.dataset.cat;
      renderPolicyPanel();
    });
  });

  container.querySelectorAll('.policy-card:not([data-disabled])').forEach(card => {
    card.addEventListener('click', () => togglePolicy(card.dataset.id));
  });

  container.querySelectorAll('.active-policy-cancel').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      cancelPolicy(btn.dataset.id);
    });
  });
}

function togglePolicy(id) {
  const idx = pendingSelection.indexOf(id);
  if (idx >= 0) {
    pendingSelection.splice(idx, 1);
  } else {
    if ((activePolicies.length + pendingSelection.length) >= MAX_ACTIVE) return;
    pendingSelection.push(id);
  }
  renderPolicyPanel();
}

function cancelPolicy(id) {
  const idx = activePolicies.findIndex(ap => ap.policy.id === id);
  if (idx >= 0) {
    activePolicies.splice(idx, 1);
    if (currentState) currentState.activePolicies = activePolicies;
  }
  renderPolicyPanel();
}

function isIncompatible(policy) {
  if (!policy.incompatible || policy.incompatible.length === 0) return false;
  const allActive = [
    ...activePolicies.map(ap => ap.policy.id),
    ...pendingSelection,
  ];
  return policy.incompatible.some(id => allActive.includes(id));
}

function getDongName(dongId) {
  const dong = currentState?.dongs?.find(d => d.id === dongId);
  return dong ? dong.name : dongId;
}
