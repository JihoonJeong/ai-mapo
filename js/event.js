/**
 * event.js — 이벤트 시스템
 * events.json 기반: 8종 이벤트, 트리거 조건, 3개 선택지
 */

import { addMessage, generateEventAnalysis } from './advisor.js';

let eventCatalog = [];
let eventCooldowns = {}; // { eventId: turnsRemaining }
let firedOneShots = new Set(); // one-shot events already fired
let currentEvent = null; // 현재 턴 이벤트
let selectedChoiceId = null;
let currentState = null;

export async function initEvents(state) {
  currentState = state;
  try {
    const resp = await fetch('data/game/events.json');
    const data = await resp.json();
    eventCatalog = data.events;
  } catch (err) {
    console.warn('[Events] Failed to load events.json:', err);
    eventCatalog = [];
  }
  renderNoEvent();
}

/**
 * 턴 시작 시 이벤트 트리거 체크
 * @returns {Object|null} 트리거된 이벤트 (없으면 null)
 */
export function checkEventTriggers(state) {
  currentState = state;
  const turn = state.meta.turn;

  // 쿨다운 감소
  for (const id of Object.keys(eventCooldowns)) {
    eventCooldowns[id]--;
    if (eventCooldowns[id] <= 0) delete eventCooldowns[id];
  }

  // 후보 이벤트 수집
  const candidates = [];

  for (const event of eventCatalog) {
    // 이미 쿨다운 중
    if (eventCooldowns[event.id]) continue;
    // one-shot 이미 발생
    if (event.oneShot && firedOneShots.has(event.id)) continue;

    if (checkTrigger(event, state, turn)) {
      candidates.push(event);
    }
  }

  if (candidates.length === 0) return null;

  // 확률 체크 후 하나만 선택
  const triggered = [];
  for (const event of candidates) {
    if (Math.random() < (event.probability || 1.0)) {
      triggered.push(event);
    }
  }

  if (triggered.length === 0) return null;

  // 여러 개면 하나만 랜덤 선택
  const selected = triggered[Math.floor(Math.random() * triggered.length)];

  // 쿨다운 + oneShot 기록
  if (selected.cooldown > 0) eventCooldowns[selected.id] = selected.cooldown;
  if (selected.oneShot) firedOneShots.add(selected.id);

  return selected;
}

function checkTrigger(event, state, turn) {
  const trigger = event.trigger;
  if (!trigger) return false;

  switch (trigger.type) {
    case 'periodic':
      return turn >= (trigger.startTurn || 1) && (turn - (trigger.startTurn || 1)) % (trigger.interval || 4) === 0;

    case 'threshold': {
      const cond = trigger.condition;
      if (!cond) return false;

      if (cond.dong) {
        // 특정 동 조건
        const dong = state.dongs.find(d => d.id === cond.dong);
        if (!dong) return false;
        return checkCondition(getMetricValue(dong, cond.metric), cond.operator, cond.value);
      } else if (cond.minDongCount) {
        // 복수 동 조건
        const count = state.dongs.filter(d => checkCondition(getMetricValue(d, cond.metric), cond.operator, cond.value)).length;
        return count >= cond.minDongCount;
      }
      return false;
    }

    case 'random':
      return turn >= (trigger.minTurn || 1) && Math.random() < (trigger.probabilityPerTurn || 0.1);

    case 'turn': {
      if (turn < (trigger.minTurn || 1)) return false;
      // 추가 조건
      if (trigger.additionalCondition) {
        const cond = trigger.additionalCondition;
        const dong = state.dongs.find(d => d.id === cond.dong);
        if (!dong) return false;
        return checkCondition(getMetricValue(dong, cond.metric), cond.operator, cond.value);
      }
      return true;
    }

    default:
      return false;
  }
}

function getMetricValue(dong, metric) {
  if (metric === 'elderlyRatio') {
    return (dong.populationByAge?.elderly || 0) / Math.max(1, dong.population);
  }
  return dong[metric] ?? 0;
}

function checkCondition(value, operator, threshold) {
  switch (operator) {
    case '>': return value > threshold;
    case '<': return value < threshold;
    case '>=': return value >= threshold;
    case '<=': return value <= threshold;
    case '==': return value === threshold;
    default: return false;
  }
}

/**
 * 이벤트 렌더링
 */
export async function renderEvent(event, state) {
  currentState = state;
  currentEvent = event;
  selectedChoiceId = null;

  const container = document.getElementById('tab-event');
  if (!container) return;

  // 이벤트 탭 활성화
  activateEventTab();

  let html = `
    <div class="event-card">
      <div class="event-title">${event.icon || ''} ${event.name}</div>
      <div class="event-desc">${event.description}</div>
      <div class="event-affected">영향 동: ${(event.affectedDongs || []).map(id => getDongName(id, state)).join(', ')}</div>
      <div class="event-choices">`;

  for (const choice of event.choices) {
    html += `
        <div class="event-choice" data-choice-id="${choice.id}">
          <div class="event-choice-header">
            <span class="event-choice-name">${choice.name}</span>
            <span class="event-choice-cost">${choice.cost > 0 ? choice.cost + '억원' : '무료'}</span>
          </div>
          <div class="event-choice-desc">${choice.description}</div>
        </div>`;
  }

  html += `</div></div>`;

  // AI advisor analysis
  html += '<div id="event-analysis" class="event-analysis"></div>';

  container.innerHTML = html;

  // Bind choice clicks
  container.querySelectorAll('.event-choice').forEach(el => {
    el.addEventListener('click', () => {
      container.querySelectorAll('.event-choice').forEach(c => c.classList.remove('selected'));
      el.classList.add('selected');
      selectedChoiceId = el.dataset.choiceId;
    });
  });

  // Generate advisor analysis
  const analysisEl = document.getElementById('event-analysis');
  if (analysisEl) {
    const analysis = await generateEventAnalysis(event, state);
    analysisEl.innerHTML = `<div class="event-advisor-comment">${analysis}</div>`;
  }
}

export function renderNoEvent() {
  const container = document.getElementById('tab-event');
  if (!container) return;
  currentEvent = null;
  selectedChoiceId = null;
  container.innerHTML = '<div class="no-event">이번 분기에는 특별한 이벤트가 없습니다.</div>';
}

/**
 * 선택된 이벤트 결과 반환
 */
export function getEventChoice() {
  if (!currentEvent || !selectedChoiceId) return null;
  const choice = currentEvent.choices.find(c => c.id === selectedChoiceId);
  if (!choice) return null;

  return {
    eventId: currentEvent.id,
    choiceId: selectedChoiceId,
    choice: choice,
    affectedDongs: currentEvent.affectedDongs || [],
    totalDuration: choice.duration || 1,
    remainDuration: choice.duration || 1,
  };
}

function getDongName(dongId, state) {
  const dong = state?.dongs?.find(d => d.id === dongId);
  return dong ? dong.name : dongId;
}

function activateEventTab() {
  // Switch to event tab to draw attention
  const eventTabBtn = document.querySelector('.tab-btn[data-tab="event"]');
  if (eventTabBtn) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    eventTabBtn.classList.add('active');
    document.getElementById('tab-event')?.classList.add('active');

    // Flash the tab button
    eventTabBtn.classList.add('tab-alert');
    setTimeout(() => eventTabBtn.classList.remove('tab-alert'), 3000);
  }
}
