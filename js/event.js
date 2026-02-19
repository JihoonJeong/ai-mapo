/**
 * event.js — 이벤트 시스템 UI (Sprint 4에서 본격 구현)
 */

export function initEvents(state) {
  renderNoEvent();
}

export function renderEvent(event) {
  // Sprint 4: 이벤트 카드 렌더링
}

export function renderNoEvent() {
  const container = document.getElementById('tab-event');
  if (!container) return;
  container.innerHTML = '<div class="no-event">이번 분기에는 특별한 이벤트가 없습니다.</div>';
}

export function getEventChoice() {
  return null;
}
