/**
 * policy.js — 정책 선택 UI (Sprint 3에서 본격 구현)
 */

export function initPolicy(state) {
  const container = document.getElementById('tab-policy');
  if (!container) return;

  container.innerHTML = `
    <div style="color:var(--text-muted);font-size:13px;text-align:center;padding:40px 20px;">
      정책 카탈로그 준비 중...<br>
      <span style="font-size:11px">Sprint 3에서 24개 정책이 추가됩니다</span>
    </div>
  `;
}

export function getSelectedPolicies() {
  return [];
}
