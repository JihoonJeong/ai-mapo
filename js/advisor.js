/**
 * advisor.js — AI 자문관 (Mock 기본 + API 선택)
 */

let chatMessages = null;

export function initAdvisor(state) {
  chatMessages = document.getElementById('chat-messages');

  // Welcome message
  addMessage('advisor', `구청장님, 취임을 축하드립니다! 저는 마포구 도시계획 자문관입니다.\n\n마포구의 현황을 파악하고, 4년 임기 동안 최선의 결정을 내리실 수 있도록 데이터 기반 분석을 제공하겠습니다.\n\n현재 마포구 인구 ${state.dongs.reduce((s, d) => s + d.population, 0).toLocaleString()}명, 사업체 ${state.dongs.reduce((s, d) => s + d.businesses, 0).toLocaleString()}개입니다. 첫 분기 예산 배분을 결정해 주세요.`);

  // Chat input
  const input = document.getElementById('chat-input');
  const sendBtn = document.getElementById('chat-send');

  if (input && sendBtn) {
    sendBtn.addEventListener('click', () => sendChat(state));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') sendChat(state);
    });
  }

  // Quick buttons
  document.querySelectorAll('.quick-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.action;
      handleQuickAction(action, state);
    });
  });
}

export function generateBriefing(state) {
  const turn = state.meta.turn;
  const year = state.meta.year;
  const quarter = state.meta.quarter;

  // Previous snapshot from history
  const prev = state.history?.length > 0 ? state.history[state.history.length - 1] : null;

  const totalPop = state.dongs.reduce((s, d) => s + d.population, 0);
  const totalBiz = state.dongs.reduce((s, d) => s + d.businesses, 0);
  const avgSat = Math.round(state.dongs.reduce((s, d) => s + d.satisfaction, 0) / state.dongs.length);

  const popDelta = prev ? totalPop - prev.totalPopulation : 0;
  const satDelta = prev ? avgSat - prev.avgSatisfaction : 0;

  // Find notable dongs
  const sortedBySat = [...state.dongs].sort((a, b) => a.satisfaction - b.satisfaction);
  const lowestSat = sortedBySat[0];
  const highestSat = sortedBySat[sortedBySat.length - 1];

  let briefing = `${year}년 ${quarter}분기 브리핑 (턴 ${turn}/48)\n\n`;

  // Population change
  if (popDelta !== 0) {
    briefing += `인구 ${totalPop.toLocaleString()}명 (${popDelta >= 0 ? '+' : ''}${popDelta.toLocaleString()})\n`;
  }
  briefing += `만족도 평균 ${avgSat}점 (${satDelta >= 0 ? '+' : ''}${satDelta})\n`;
  briefing += `재정자립도 ${state.finance.fiscalIndependence}%\n\n`;

  // Low satisfaction warning
  if (lowestSat.satisfaction < 50) {
    briefing += `[긴급] ${lowestSat.name} 만족도 ${lowestSat.satisfaction} — 주민 유출이 우려됩니다.\n`;
  } else if (lowestSat.satisfaction < 60) {
    briefing += `[주의] ${lowestSat.name} 만족도가 ${lowestSat.satisfaction}으로 가장 낮습니다.\n`;
  }

  // Best performing dong
  briefing += `[양호] ${highestSat.name} 만족도 ${highestSat.satisfaction}\n`;

  // Rent pressure warning
  const highRent = state.dongs.filter(d => d.rentPressure > 0.05);
  if (highRent.length > 0) {
    briefing += `\n임대료 압력: ${highRent.map(d => `${d.name}(${(d.rentPressure * 100).toFixed(1)}%)`).join(', ')}`;
  }

  // Population change by dong (biggest changes)
  if (prev?.dongs) {
    const dongChanges = state.dongs.map(d => {
      const prevDong = prev.dongs.find(pd => pd.id === d.id);
      return { name: d.name, delta: prevDong ? d.population - prevDong.population : 0 };
    }).filter(c => Math.abs(c.delta) > 100).sort((a, b) => b.delta - a.delta);

    if (dongChanges.length > 0) {
      const gains = dongChanges.filter(c => c.delta > 0).slice(0, 2);
      const losses = dongChanges.filter(c => c.delta < 0).slice(-2);
      if (gains.length) briefing += `\n인구 증가: ${gains.map(c => `${c.name}(+${c.delta})`).join(', ')}`;
      if (losses.length) briefing += `\n인구 감소: ${losses.map(c => `${c.name}(${c.delta})`).join(', ')}`;
    }
  }

  addMessage('advisor', briefing);
}

function sendChat(state) {
  const input = document.getElementById('chat-input');
  if (!input || !input.value.trim()) return;

  const message = input.value.trim();
  input.value = '';

  addMessage('player', message);

  // Mock response (Sprint 3에서 AI API 연동)
  setTimeout(() => {
    const response = generateMockResponse(message, state);
    addMessage('advisor', response);
  }, 500);
}

function handleQuickAction(action, state) {
  const messages = {
    compare: '16개 동의 만족도를 비교해 주세요.',
    predict: '현재 예산 배분의 예상 효과를 분석해 주세요.',
    summary: '이번 분기의 주요 이슈를 요약해 주세요.',
  };

  const message = messages[action] || action;
  addMessage('player', message);

  setTimeout(() => {
    addMessage('advisor', generateMockResponse(message, state));
  }, 500);
}

function generateMockResponse(message, state) {
  const lower = message.toLowerCase();

  if (lower.includes('비교') || lower.includes('순위')) {
    const sorted = [...state.dongs].sort((a, b) => b.satisfaction - a.satisfaction);
    let resp = '동별 만족도 순위입니다:\n\n';
    sorted.forEach((d, i) => {
      resp += `${i + 1}. ${d.name}: ${d.satisfaction}점\n`;
    });
    return resp;
  }

  if (lower.includes('예산') || lower.includes('효과') || lower.includes('정책')) {
    return `구청장님, 현재 자유예산 ${state.finance.freeBudget}억원 중 예산 배분을 확인해 보시겠습니까?\n\n경제·일자리에 투자하시면 2~4턴 후 사업체 증가 효과가, 환경·안전에 투자하시면 1~2턴 후 만족도 상승 효과가 나타납니다.\n\n다만, 같은 분야에 과도하게 집중하면 효율이 감소하니 균형 잡힌 배분을 권합니다.`;
  }

  if (lower.includes('이슈') || lower.includes('요약') || lower.includes('문제')) {
    const issues = [];
    const lowSat = state.dongs.filter(d => d.satisfaction < 55);
    if (lowSat.length) issues.push(`${lowSat.map(d => d.name).join(', ')}의 만족도가 낮습니다`);
    const highRent = state.dongs.filter(d => d.rentPressure > 0.3);
    if (highRent.length) issues.push(`${highRent.map(d => d.name).join(', ')}에서 임대료 압력이 높습니다`);
    const elderly = state.dongs.filter(d => d.populationByAge.elderly / d.population > 0.20);
    if (elderly.length) issues.push(`${elderly.map(d => d.name).join(', ')}의 고령화율이 20%를 초과합니다`);

    return issues.length > 0
      ? `이번 분기 주요 이슈입니다:\n\n${issues.map((s, i) => `${i + 1}. ${s}`).join('\n')}`
      : '현재 긴급한 이슈는 없습니다. 안정적으로 운영되고 있습니다.';
  }

  return `구청장님, 좋은 질문입니다. 현재 데이터를 분석하겠습니다.\n\n마포구 전체적으로 평균 만족도 ${Math.round(state.dongs.reduce((s, d) => s + d.satisfaction, 0) / state.dongs.length)}점이며, 재정자립도 ${state.finance.fiscalIndependence}%입니다. 구체적인 분야나 동에 대해 질문해 주시면 더 상세한 분석을 드리겠습니다.`;
}

export function addMessage(role, text) {
  if (!chatMessages) return;
  const div = document.createElement('div');
  div.className = `chat-msg ${role}`;
  div.textContent = text;
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}
