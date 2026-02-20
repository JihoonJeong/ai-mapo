/**
 * advisor.js — AI 자문관 (Mock 기본 + API 선택)
 * advisor-prompt-v1.md 기반 구현
 */

// === System Prompt (Hard Shell — §1.1) ===
const SYSTEM_PROMPT = `당신은 서울특별시 마포구의 도시계획 자문관입니다.

## 역할
- 구청장님의 정책 결정을 데이터 기반으로 보좌합니다.
- 매 분기(턴) 핵심 변화를 브리핑하고, 질문에 분석으로 답합니다.
- 결정은 구청장님이 합니다. 당신은 분석과 선택지를 제공합니다.

## 마포구 개요
- 16개 행정동, 인구 약 35만 명
- 홍대·연남 관광 상권, 상암 DMC 업무지구, 공덕 교통허브, 성산 주거단지 공존
- 재정자립도 약 28%. 세수를 늘리려면 사업체를 늘리고, 부동산 가치를 올려야 합니다.
- 핵심 딜레마: 관광 활성화 ↔ 주민 삶의 질, 개발 ↔ 보존, 성장 ↔ 형평

## 행동 규칙
1. 항상 "구청장님"으로 호칭합니다.
2. 수치를 근거로 들되, 해석을 덧붙입니다. 숫자만 나열하지 않습니다.
3. 제안할 때는 최소 2개 선택지를 제시하고, 각각의 트레이드오프를 밝힙니다.
4. 확신할 수 없는 예측에는 "~할 가능성이 있습니다", "~를 주시해야 합니다"로 표현합니다.
5. 공약 진척도를 자연스럽게 언급하되, 매번 반복하지 않습니다.
6. 한 번에 5문장 이하로 답합니다. 질문이 복잡하면 핵심만 먼저, "더 자세히 볼까요?"로 이어갑니다.
7. 당신은 시뮬레이션 내부 수식을 모릅니다. 관측된 데이터의 변화 패턴에서 추론하세요.
8. 게임 메타 발언(턴, 수식, 엔진 등)을 하지 않습니다. 현실의 자문관처럼 행동하세요.

## 분석 프레임워크
데이터를 볼 때 이 순서로 생각하세요:
1. **변화**: 전 분기 대비 무엇이 달라졌는가?
2. **원인**: 왜 달라졌는가? (정책 효과? 외부 요인? 이벤트?)
3. **영향**: 이 변화가 다른 지표에 어떤 파급을 줄 것인가?
4. **대응**: 구청장님에게 어떤 선택지가 있는가?

## 톤
- 전문적이되 관료적이지 않게. 약간의 개성과 감정 표현 허용.
- 좋은 소식엔 긍정적으로, 나쁜 소식엔 솔직하되 대안과 함께.
- 구청장님의 판단을 존중하되, 위험하다고 판단하면 솔직하게 우려를 표합니다.`;

// Quick button prompts (§4.2)
const QUICK_PROMPTS = {
  compare: '16개 동의 현황을 비교 분석해 주세요. 만족도 기준 상위 3개·하위 3개 동을 짚고, 특히 주목할 동이 있으면 이유와 함께 설명하세요.',
  predict: '현재 활성화된 정책과 예산 배분을 보고, 다음 분기에 예상되는 변화를 분석해 주세요. 특히 어떤 동이 가장 큰 영향을 받을지 예측하세요.',
  summary: '이번 분기 가장 주의해야 할 이슈 3개를 순서대로 정리하고, 각각에 대한 짧은 대응 제안을 해 주세요.',
};

// === State ===
let chatMessages = null;
let chatHistory = []; // [{turn, role, content}]
let currentBackend = 'mock'; // 'mock' | 'anthropic'
let apiKey = '';
let currentState = null;

// === AI Backends ===
const AI_BACKENDS = {
  mock: { name: 'Mock', call: mockCall },
  anthropic: { name: 'Claude API', call: anthropicCall },
};

// === Init ===
export function initAdvisor(state) {
  currentState = state;
  chatMessages = document.getElementById('chat-messages');
  chatHistory = [];

  // Load saved API key
  apiKey = localStorage.getItem('ai-mapo-api-key') || '';
  if (apiKey) {
    currentBackend = 'anthropic';
  }

  // Welcome message
  const totalPop = state.dongs.reduce((s, d) => s + d.population, 0);
  const totalBiz = state.dongs.reduce((s, d) => s + d.businesses, 0);
  addMessage('advisor', `구청장님, 취임을 축하드립니다! 저는 마포구 도시계획 자문관입니다.\n\n마포구의 현황을 파악하고, 4년 임기 동안 최선의 결정을 내리실 수 있도록 데이터 기반 분석을 제공하겠습니다.\n\n현재 마포구 인구 ${totalPop.toLocaleString()}명, 사업체 ${totalBiz.toLocaleString()}개입니다. 첫 분기 예산 배분을 결정해 주세요.`);

  // Chat input
  const input = document.getElementById('chat-input');
  const sendBtn = document.getElementById('chat-send');

  if (input && sendBtn) {
    sendBtn.addEventListener('click', () => sendChat());
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') sendChat();
    });
  }

  // Quick buttons
  document.querySelectorAll('.quick-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.action;
      handleQuickAction(action);
    });
  });

  // Advisor mode toggle
  const modeEl = document.getElementById('advisor-mode');
  if (modeEl) {
    modeEl.textContent = AI_BACKENDS[currentBackend].name;
    modeEl.style.cursor = 'pointer';
    modeEl.addEventListener('click', showApiSettings);
  }

  updateModeDisplay();
}

export function updateAdvisorState(state) {
  currentState = state;
}

// === Briefing (§3) ===
export async function generateBriefing(state) {
  currentState = state;
  const turn = state.meta.turn;
  const context = buildAdvisorContext(state);

  if (currentBackend === 'anthropic' && apiKey) {
    // Use AI for briefing
    const briefingPrompt = turn <= 1
      ? `구청장님이 취임했습니다. 마포구의 현 상태를 요약하고, 임기 4년의 핵심 과제를 제시하세요.\n\n${context}\n\n## 브리핑 형식\n1. 마포구 현황 한 줄 요약\n2. 가장 큰 기회 (수치 근거)\n3. 가장 큰 위험 (수치 근거)\n4. 선택한 공약 달성을 위한 첫 분기 제안\n\n전체 6문장 이내.`
      : `아래 데이터를 바탕으로 이번 분기 브리핑을 작성하세요.\n\n${context}\n\n## 브리핑 형식\n1. **핵심 요약** (1~2문장): 이번 분기 가장 중요한 변화.\n2. **긴급 이슈** (1개): 가장 시급한 문제. 수치 근거 포함.\n3. **기회 요인** (1개): 활용할 수 있는 긍정적 변화. 수치 근거 포함.\n4. **공약 관련** (해당되면): 공약 진척에 영향을 주는 변화.\n\n전체 5문장 이내. 간결하게.`;

    addMessage('advisor', '(브리핑 생성 중...)');
    try {
      const response = await callAI(briefingPrompt);
      // Replace the loading message
      const msgs = chatMessages.querySelectorAll('.chat-msg.advisor');
      const last = msgs[msgs.length - 1];
      if (last) last.textContent = response;
      chatHistory.push({ turn, role: 'advisor', content: response });
    } catch (err) {
      console.warn('[Advisor] API briefing failed, falling back to mock:', err);
      const msgs = chatMessages.querySelectorAll('.chat-msg.advisor');
      const last = msgs[msgs.length - 1];
      if (last) last.remove();
      generateMockBriefing(state);
    }
  } else {
    generateMockBriefing(state);
  }
}

function generateMockBriefing(state) {
  const turn = state.meta.turn;
  const year = state.meta.year;
  const quarter = state.meta.quarter;
  const prev = state.history?.length > 0 ? state.history[state.history.length - 1] : null;

  const totalPop = state.dongs.reduce((s, d) => s + d.population, 0);
  const totalBiz = state.dongs.reduce((s, d) => s + d.businesses, 0);
  const avgSat = Math.round(state.dongs.reduce((s, d) => s + d.satisfaction, 0) / state.dongs.length);

  const popDelta = prev ? totalPop - prev.totalPopulation : 0;
  const satDelta = prev ? avgSat - prev.avgSatisfaction : 0;

  const sortedBySat = [...state.dongs].sort((a, b) => a.satisfaction - b.satisfaction);
  const lowestSat = sortedBySat[0];
  const highestSat = sortedBySat[sortedBySat.length - 1];

  let briefing = `구청장님, ${year}년 ${quarter}분기 브리핑입니다.\n\n`;

  if (popDelta !== 0) {
    briefing += `인구 ${totalPop.toLocaleString()}명 (${popDelta >= 0 ? '+' : ''}${popDelta.toLocaleString()})\n`;
  }
  briefing += `평균 만족도 ${avgSat}점 (${satDelta >= 0 ? '+' : ''}${satDelta}), `;
  briefing += `재정자립도 ${state.finance.fiscalIndependence}%\n\n`;

  if (lowestSat.satisfaction < 50) {
    briefing += `[긴급] ${lowestSat.name} 만족도 ${lowestSat.satisfaction} — 주민 유출이 우려됩니다.\n`;
  } else if (lowestSat.satisfaction < 60) {
    briefing += `[주의] ${lowestSat.name} 만족도가 ${lowestSat.satisfaction}으로 가장 낮습니다.\n`;
  }

  briefing += `[양호] ${highestSat.name} 만족도 ${highestSat.satisfaction}\n`;

  // Active policies
  const activePolicies = state.activePolicies || [];
  if (activePolicies.length > 0) {
    const pNames = activePolicies.map(ap => {
      const status = ap.remainDelay > 0 ? '(준비 중)' : '(시행 중)';
      return `${ap.policy.name}${status}`;
    });
    briefing += `\n활성 정책: ${pNames.join(', ')}`;
  }

  // Rent pressure
  const highRent = state.dongs.filter(d => d.rentPressure > 0.005);
  if (highRent.length > 0) {
    briefing += `\n임대료 압력: ${highRent.map(d => `${d.name}(${(d.rentPressure * 100).toFixed(1)}%)`).join(', ')}`;
  }

  // Population changes
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
  chatHistory.push({ turn, role: 'advisor', content: briefing });
}

// === Chat ===
async function sendChat() {
  const input = document.getElementById('chat-input');
  if (!input || !input.value.trim()) return;

  const message = input.value.trim();
  input.value = '';

  addMessage('player', message);
  chatHistory.push({ turn: currentState.meta.turn, role: 'player', content: message });

  if (currentBackend === 'anthropic' && apiKey) {
    addMessage('advisor', '...');
    try {
      const context = buildAdvisorContext(currentState);
      const prompt = `${context}\n\n[구청장님의 질문]\n${message}\n\n위 데이터를 바탕으로 답하세요. 5문장 이내.`;
      const response = await callAI(prompt);
      const msgs = chatMessages.querySelectorAll('.chat-msg.advisor');
      const last = msgs[msgs.length - 1];
      if (last) last.textContent = response;
      chatHistory.push({ turn: currentState.meta.turn, role: 'advisor', content: response });
    } catch (err) {
      console.warn('[Advisor] API failed:', err);
      const msgs = chatMessages.querySelectorAll('.chat-msg.advisor');
      const last = msgs[msgs.length - 1];
      if (last) last.textContent = generateMockResponse(message);
    }
  } else {
    setTimeout(() => {
      const response = generateMockResponse(message);
      addMessage('advisor', response);
      chatHistory.push({ turn: currentState.meta.turn, role: 'advisor', content: response });
    }, 300);
  }
}

function handleQuickAction(action) {
  const prompt = QUICK_PROMPTS[action];
  if (!prompt) return;

  const displayMsg = {
    compare: '동별 비교 분석 요청',
    predict: '정책 효과 예측 요청',
    summary: '이슈 요약 요청',
  };

  addMessage('player', displayMsg[action] || action);
  chatHistory.push({ turn: currentState.meta.turn, role: 'player', content: prompt });

  if (currentBackend === 'anthropic' && apiKey) {
    addMessage('advisor', '...');
    const context = buildAdvisorContext(currentState);
    callAI(`${context}\n\n${prompt}`).then(response => {
      const msgs = chatMessages.querySelectorAll('.chat-msg.advisor');
      const last = msgs[msgs.length - 1];
      if (last) last.textContent = response;
      chatHistory.push({ turn: currentState.meta.turn, role: 'advisor', content: response });
    }).catch(() => {
      const msgs = chatMessages.querySelectorAll('.chat-msg.advisor');
      const last = msgs[msgs.length - 1];
      if (last) last.textContent = generateMockResponse(prompt);
    });
  } else {
    setTimeout(() => {
      const response = generateMockResponse(prompt);
      addMessage('advisor', response);
      chatHistory.push({ turn: currentState.meta.turn, role: 'advisor', content: response });
    }, 300);
  }
}

// === Context Builder (§2.2) ===
function buildAdvisorContext(state) {
  const prev = state.history?.length > 0 ? state.history[state.history.length - 1] : null;

  const totalPop = state.dongs.reduce((s, d) => s + d.population, 0);
  const totalBiz = state.dongs.reduce((s, d) => s + d.businesses, 0);
  const avgSat = Math.round(state.dongs.reduce((s, d) => s + d.satisfaction, 0) / 16);

  const popDelta = prev ? totalPop - prev.totalPopulation : 0;
  const satDelta = prev ? avgSat - prev.avgSatisfaction : 0;

  let ctx = `[현재 상황]\n`;
  ctx += `턴: ${state.meta.turn}/48 (${state.meta.year}년 ${state.meta.quarter}분기)\n`;
  ctx += `임기 경과: ${Math.round(state.meta.turn / 48 * 100)}%\n\n`;

  ctx += `[구 전체 요약]\n`;
  ctx += `총인구: ${totalPop.toLocaleString()}명 (${popDelta >= 0 ? '+' : ''}${popDelta.toLocaleString()})\n`;
  ctx += `총사업체: ${totalBiz.toLocaleString()}개\n`;
  ctx += `평균 만족도: ${avgSat}/100 (${satDelta >= 0 ? '+' : ''}${satDelta})\n`;
  ctx += `재정자립도: ${state.finance.fiscalIndependence}%\n`;
  ctx += `자유예산: ${state.finance.freeBudget}억원\n`;

  // Pledges
  if (state.meta.pledges?.length > 0) {
    ctx += `\n[공약]\n`;
    for (const p of state.meta.pledges) {
      ctx += `- ${p}\n`;
    }
  }

  // Dong details (compact)
  ctx += `\n[동별 현황]\n`;
  for (const dong of state.dongs) {
    const prevDong = prev?.dongs?.find(d => d.id === dong.id);
    const pD = prevDong ? dong.population - prevDong.population : 0;
    const bD = prevDong ? dong.businesses - prevDong.businesses : 0;
    const sD = prevDong ? dong.satisfaction - prevDong.satisfaction : 0;
    ctx += `${dong.name}: 인구 ${dong.population}(${pD >= 0 ? '+' : ''}${pD}) | `;
    ctx += `사업체 ${dong.businesses}(${bD >= 0 ? '+' : ''}${bD}) | `;
    ctx += `만족도 ${dong.satisfaction}(${sD >= 0 ? '+' : ''}${sD}) | `;
    ctx += `상권 ${dong.commerceVitality} | 임대료 ${(dong.rentPressure * 100).toFixed(1)}%\n`;
  }

  // Active policies
  const activePolicies = state.activePolicies || [];
  if (activePolicies.length > 0) {
    ctx += `\n[활성 정책]\n`;
    for (const ap of activePolicies) {
      const target = ap.policy.targetDong
        ? (Array.isArray(ap.policy.targetDong) ? ap.policy.targetDong.join(', ') : ap.policy.targetDong)
        : '구 전체';
      const status = ap.remainDelay > 0 ? `준비 중(${ap.remainDelay}턴 후)` : ap.remainDuration > 0 ? `${ap.remainDuration}턴 남음` : '영구';
      ctx += `- ${ap.policy.name} (${target}, ${status})\n`;
    }
  }

  // Budget allocation
  const alloc = state.finance.allocation || {};
  ctx += `\n[예산 배분]\n`;
  ctx += `경제: ${alloc.economy || 0}% | 교통: ${alloc.transport || 0}% | 문화: ${alloc.culture || 0}% | `;
  ctx += `환경: ${alloc.environment || 0}% | 교육: ${alloc.education || 0}% | 복지: ${alloc.welfare || 0}% | 재생: ${alloc.renewal || 0}%\n`;

  // Auto-detected flags
  const flags = [];
  for (const dong of state.dongs) {
    if (dong.satisfaction < 50) flags.push(`${dong.name} 만족도 ${dong.satisfaction} — 주민 유출 위험`);
    if (dong.rentPressure > 0.01) flags.push(`${dong.name} 임대료 압력 ${(dong.rentPressure * 100).toFixed(1)}% — 젠트리피케이션 주의`);
    const prevDong = prev?.dongs?.find(d => d.id === dong.id);
    if (prevDong && dong.population - prevDong.population < -200) {
      flags.push(`${dong.name} 인구 ${dong.population - prevDong.population}명 급감`);
    }
  }
  if (flags.length > 0) {
    ctx += `\n[주목할 변화]\n${flags.map(f => `- ${f}`).join('\n')}\n`;
  }

  return ctx;
}

// === AI Call Abstraction (§7.1) ===
async function callAI(userMessage) {
  const backend = AI_BACKENDS[currentBackend];
  if (!backend) throw new Error(`Unknown backend: ${currentBackend}`);

  // Build messages with history window (recent 4 turns)
  const recentHistory = getRecentHistory(4);
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT + (currentState.meta.playerName ? `\n\n구청장님 성함: ${currentState.meta.playerName}` : '') },
    ...recentHistory.map(h => ({
      role: h.role === 'advisor' ? 'assistant' : 'user',
      content: h.content,
    })),
    { role: 'user', content: userMessage },
  ];

  return await backend.call(messages);
}

function getRecentHistory(turnWindow) {
  const currentTurn = currentState?.meta?.turn || 1;
  return chatHistory.filter(h => h.turn >= currentTurn - turnWindow);
}

// === Anthropic API Backend (§7.3) ===
async function anthropicCall(messages) {
  if (!apiKey) throw new Error('API key required');

  const systemMsg = messages.find(m => m.role === 'system');
  const otherMsgs = messages.filter(m => m.role !== 'system');

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 500,
      system: systemMsg?.content || SYSTEM_PROMPT,
      messages: otherMsgs,
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || `API error ${response.status}`);
  }

  const data = await response.json();
  return data.content[0].text;
}

// === Mock Backend ===
async function mockCall(messages) {
  const userMsg = messages[messages.length - 1]?.content || '';
  return generateMockResponse(userMsg);
}

function generateMockResponse(message) {
  const state = currentState;
  if (!state) return '데이터를 불러오는 중입니다...';

  const lower = message.toLowerCase();

  if (lower.includes('비교') || lower.includes('순위') || lower.includes('동별')) {
    const sorted = [...state.dongs].sort((a, b) => b.satisfaction - a.satisfaction);
    let resp = '구청장님, 동별 만족도 현황입니다.\n\n';
    resp += '상위 3개 동:\n';
    sorted.slice(0, 3).forEach((d, i) => {
      resp += `${i + 1}. ${d.name}: ${d.satisfaction}점 (인구 ${d.population.toLocaleString()})\n`;
    });
    resp += '\n하위 3개 동:\n';
    sorted.slice(-3).reverse().forEach((d, i) => {
      resp += `${sorted.length - 2 + i}. ${d.name}: ${d.satisfaction}점 (인구 ${d.population.toLocaleString()})\n`;
    });

    const lowSat = sorted.filter(d => d.satisfaction < 55);
    if (lowSat.length > 0) {
      resp += `\n${lowSat[0].name}의 만족도가 특히 낮습니다. 해당 동의 주요 불만 요인을 확인하시고 관련 예산 배분을 검토하시길 권합니다.`;
    }
    return resp;
  }

  if (lower.includes('예측') || lower.includes('효과') || lower.includes('정책')) {
    const activePolicies = state.activePolicies || [];
    let resp = `구청장님, 현재 `;
    if (activePolicies.length > 0) {
      resp += `${activePolicies.length}개 정책이 활성 상태입니다.\n\n`;
      for (const ap of activePolicies) {
        const status = ap.remainDelay > 0 ? `${ap.remainDelay}턴 후 효과 발현` : '효과 발현 중';
        resp += `- ${ap.policy.name}: ${status}\n`;
      }
      resp += '\n';
    } else {
      resp += '활성 정책이 없습니다.\n\n';
    }

    resp += `자유예산 ${state.finance.freeBudget}억원, 재정자립도 ${state.finance.fiscalIndependence}%입니다.\n`;
    resp += `예산 배분에서 가장 비중이 높은 분야에 1~2턴 내 만족도 변화가 나타날 것입니다. 특정 동이나 분야에 대해 더 자세히 분석할까요?`;
    return resp;
  }

  if (lower.includes('이슈') || lower.includes('요약') || lower.includes('문제') || lower.includes('주의')) {
    const issues = [];
    const lowSat = state.dongs.filter(d => d.satisfaction < 55).sort((a, b) => a.satisfaction - b.satisfaction);
    if (lowSat.length) {
      issues.push(`${lowSat[0].name} 만족도 ${lowSat[0].satisfaction}점으로 위험 수준입니다. 해당 동 집중 투자를 고려하세요.`);
    }

    const highRent = state.dongs.filter(d => d.rentPressure > 0.005).sort((a, b) => b.rentPressure - a.rentPressure);
    if (highRent.length) {
      issues.push(`${highRent[0].name} 임대료 압력 ${(highRent[0].rentPressure * 100).toFixed(1)}%. 임대료 안정화 정책이나 상생 협약을 검토하세요.`);
    }

    const popDecline = state.dongs.filter(d => {
      const prev = state.history?.[state.history.length - 1]?.dongs?.find(pd => pd.id === d.id);
      return prev && d.population - prev.population < -100;
    });
    if (popDecline.length) {
      issues.push(`${popDecline.map(d => d.name).join(', ')}에서 인구 유출이 감지됩니다. 주거·복지 예산 배분을 확인하세요.`);
    }

    if (issues.length === 0) issues.push('현재 긴급한 이슈는 없습니다. 안정적 운영 중입니다.');

    return `구청장님, 이번 분기 주요 이슈입니다.\n\n${issues.map((s, i) => `${i + 1}. ${s}`).join('\n')}`;
  }

  // Default response
  const avgSat = Math.round(state.dongs.reduce((s, d) => s + d.satisfaction, 0) / state.dongs.length);
  return `구청장님, 현재 마포구 평균 만족도 ${avgSat}점, 재정자립도 ${state.finance.fiscalIndependence}%입니다. 구체적인 동이나 정책 분야에 대해 질문해 주시면 더 상세한 분석을 드리겠습니다.`;
}

// === Event Analysis (§5) ===
export async function generateEventAnalysis(event, state) {
  currentState = state;

  if (currentBackend === 'anthropic' && apiKey) {
    const context = buildAdvisorContext(state);
    const choicesStr = event.choices.map((c, i) => {
      const letter = String.fromCharCode(65 + i);
      return `${letter}. ${c.name}: ${c.description} (비용: ${c.cost}억원)`;
    }).join('\n');

    const prompt = `긴급 상황이 발생했습니다:\n\n[이벤트]\n${event.name}: ${event.description}\n\n[선택지]\n${choicesStr}\n\n${context}\n\n현재 자유예산 ${state.finance.freeBudget}억원을 고려하여 각 선택지의 예상 효과와 리스크를 분석하세요.\n추천하지 말고, 구청장님이 판단할 수 있도록 각 선택지의 트레이드오프를 명확히 제시하세요.\n\n3~5문장.`;

    try {
      return await callAI(prompt);
    } catch (err) {
      console.warn('[Advisor] Event analysis API failed:', err);
    }
  }

  // Mock fallback
  let analysis = `구청장님, ${event.name}에 대한 분석입니다.\n\n`;
  for (const choice of event.choices) {
    analysis += `- ${choice.name} (${choice.cost}억원): ${choice.advisorComment || choice.description}\n`;
  }
  analysis += `\n현재 자유예산 ${state.finance.freeBudget}억원입니다.`;
  return analysis;
}

// === API Settings UI ===
function showApiSettings() {
  const modal = document.getElementById('modal-overlay');
  const content = document.getElementById('modal-content');

  content.innerHTML = `
    <div class="modal-title">AI 자문관 설정</div>
    <div class="modal-subtitle">AI 엔진을 선택하고 API 키를 입력하세요</div>

    <div class="api-setting-group">
      <label class="api-radio-label">
        <input type="radio" name="ai-backend" value="mock" ${currentBackend === 'mock' ? 'checked' : ''}>
        <span>Mock (테스트용)</span>
        <small>AI 없이 템플릿 기반 응답</small>
      </label>
      <label class="api-radio-label">
        <input type="radio" name="ai-backend" value="anthropic" ${currentBackend === 'anthropic' ? 'checked' : ''}>
        <span>Claude API (Anthropic)</span>
        <small>고품질 AI 분석 (API 키 필요)</small>
      </label>
    </div>

    <div id="api-key-section" style="${currentBackend === 'anthropic' ? '' : 'display:none'}">
      <input type="password" class="modal-input" id="api-key-input"
             placeholder="sk-ant-api03-..." value="${apiKey}" style="margin-bottom:8px">
      <div style="font-size:11px;color:var(--text-muted);margin-bottom:16px">
        API 키는 브라우저 로컬 스토리지에만 저장됩니다. 서버로 전송되지 않습니다.
      </div>
    </div>

    <div style="display:flex;gap:8px">
      <button class="modal-btn" id="btn-api-save">저장</button>
      <button class="modal-btn" id="btn-api-cancel" style="background:var(--text-muted)">취소</button>
    </div>
  `;

  modal.classList.add('active');

  // Toggle API key section
  content.querySelectorAll('input[name="ai-backend"]').forEach(radio => {
    radio.addEventListener('change', () => {
      const section = document.getElementById('api-key-section');
      section.style.display = radio.value === 'anthropic' ? '' : 'none';
    });
  });

  document.getElementById('btn-api-save').addEventListener('click', () => {
    const selectedBackend = content.querySelector('input[name="ai-backend"]:checked')?.value || 'mock';
    const newKey = document.getElementById('api-key-input')?.value?.trim() || '';

    currentBackend = selectedBackend;
    apiKey = newKey;

    if (newKey) {
      localStorage.setItem('ai-mapo-api-key', newKey);
    } else {
      localStorage.removeItem('ai-mapo-api-key');
      if (currentBackend === 'anthropic') currentBackend = 'mock';
    }

    updateModeDisplay();
    modal.classList.remove('active');
  });

  document.getElementById('btn-api-cancel').addEventListener('click', () => {
    modal.classList.remove('active');
  });
}

function updateModeDisplay() {
  const el = document.getElementById('advisor-mode');
  if (el) {
    el.textContent = AI_BACKENDS[currentBackend]?.name || 'Mock';
  }
}

// === Game End Review (Sprint 4) ===
export async function callAdvisorForReview(prompt) {
  if (currentBackend === 'anthropic' && apiKey) {
    try {
      return await callAI(prompt);
    } catch (err) {
      console.warn('[Advisor] Review API failed:', err);
    }
  }
  // Mock fallback — return empty to trigger default review
  return '';
}

// === Message UI ===
export function addMessage(role, text) {
  if (!chatMessages) return;
  const div = document.createElement('div');
  div.className = `chat-msg ${role}`;
  div.textContent = text;
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}
