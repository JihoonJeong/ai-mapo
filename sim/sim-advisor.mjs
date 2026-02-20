/**
 * sim-advisor.mjs — AI 행동 프롬프트 + JSON 파서
 *
 * Headless 모드 전용. AI에게 매 턴 행동을 JSON으로 요청하고 파싱한다.
 * advisor.js의 컨텍스트 빌더 로직을 Node.js용으로 재구현.
 */

// === System Prompt (Headless 전용) ===
const SYSTEM_PROMPT = `당신은 서울특별시 마포구의 AI 구청장입니다. 48분기(12년) 임기 동안 마포구를 운영합니다.

## 역할
- 매 분기 예산 배분, 정책 선택, 이벤트 대응을 직접 결정합니다.
- 모든 결정은 지정된 JSON 형식으로 응답해야 합니다.

## 마포구 개요
- 16개 행정동, 인구 약 35만 명
- 홍대·연남 관광 상권, 상암 DMC 업무지구, 공덕 교통허브, 성산 주거단지 공존
- 재정자립도 약 28%. 세수를 늘리려면 사업체를 늘리고, 부동산 가치를 올려야 합니다.
- 핵심 딜레마: 관광 활성화 ↔ 주민 삶의 질, 개발 ↔ 보존, 성장 ↔ 형평

## 판단 프레임워크
1. **변화**: 전 분기 대비 무엇이 달라졌는가?
2. **원인**: 왜 달라졌는가? (정책 효과? 외부 요인?)
3. **영향**: 이 변화가 다른 지표에 어떤 파급을 줄 것인가?
4. **대응**: 어떤 행동이 최선인가?

## 규칙
- 결정을 반드시 지정된 JSON 형식으로 응답하세요. JSON 외 텍스트는 reasoning 필드에 넣으세요.
- budget 합계는 반드시 100이어야 합니다.
- 정책은 최대 3개 동시 활성화 가능합니다.
- 공약 달성을 항상 고려하되, KPI 전체 균형도 유지하세요.`;

/**
 * SimAdvisor — AI 행동 관리자
 */
export class SimAdvisor {
  constructor(provider, config = {}) {
    this.provider = provider;
    this.historyWindow = config.historyWindow || 4;
    this.chatHistory = [];
    this.totalUsage = { input: 0, output: 0 };
  }

  /**
   * AI에게 이번 턴 행동을 요청
   * @returns {{ action: Object, reasoning: string, raw: string }}
   */
  async decide(state, event, policyCatalog, pledges) {
    const systemMsg = this.buildSystemMessage(state, pledges);
    const turnPrompt = this.buildTurnPrompt(state, event, policyCatalog, pledges);

    const recentHistory = this.chatHistory
      .filter(h => h.turn >= state.meta.turn - this.historyWindow)
      .flatMap(h => [
        { role: 'user', content: h.prompt },
        { role: 'assistant', content: h.response },
      ]);

    const messages = [
      { role: 'system', content: systemMsg },
      ...recentHistory,
      { role: 'user', content: turnPrompt },
    ];

    let raw = '';
    try {
      const result = await this.provider(messages);
      raw = result.content;
      this.totalUsage.input += result.usage?.input || 0;
      this.totalUsage.output += result.usage?.output || 0;
    } catch (err) {
      console.warn(`[SimAdvisor] API call failed: ${err.message}`);
      raw = '';
    }

    const action = parseAction(raw, state, event, policyCatalog);

    this.chatHistory.push({
      turn: state.meta.turn,
      prompt: turnPrompt,
      response: raw,
    });

    return {
      action,
      reasoning: action.reasoning || '',
      raw,
    };
  }

  /**
   * AI에게 공약 선택을 요청
   * @param {Array} allPledges - 전체 공약 목록 [{id, name, desc, difficulty}]
   * @param {number} count - 선택할 공약 수
   * @param {Object} state - 초기 게임 상태 (마포구 현황 컨텍스트)
   * @returns {string[]} 선택된 공약 ID 배열
   */
  async choosePledges(allPledges, count, state) {
    const pledgeList = allPledges.map(p =>
      `${p.id}: ${p.name} — ${p.desc} (난이도: ${'★'.repeat(p.difficulty)}${'☆'.repeat(3 - p.difficulty)})`
    ).join('\n');

    const totalPop = state.dongs.reduce((s, d) => s + d.population, 0);
    const avgSat = Math.round(state.dongs.reduce((s, d) => s + d.satisfaction, 0) / state.dongs.length);

    const prompt = `당신은 마포구청장으로 취임합니다. 4년(48분기) 임기 동안 달성할 공약 ${count}개를 선택하세요.

[마포구 현황]
총인구: ${totalPop.toLocaleString()}명
평균 만족도: ${avgSat}/100
재정자립도: ${state.finance.fiscalIndependence}%
자유예산: ${state.finance.freeBudget}억원

[점수 규칙]
- 공약 달성 시: +15점
- 공약 미달성 시: -20점
- 따라서 공약 선택은 전략적이어야 합니다. 달성 가능성과 시너지를 고려하세요.

[공약 목록]
${pledgeList}

아래 JSON 형식으로만 응답하세요:
{
  "reasoning": "공약 선택 이유 (2~3문장)",
  "pledges": ["pledge_id_1", "pledge_id_2"]
}

규칙:
- 정확히 ${count}개를 선택하세요.
- pledges 배열에는 위 목록의 ID만 사용하세요.`;

    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: prompt },
    ];

    let raw = '';
    try {
      const result = await this.provider(messages);
      raw = result.content;
      this.totalUsage.input += result.usage?.input || 0;
      this.totalUsage.output += result.usage?.output || 0;
    } catch (err) {
      console.warn(`[SimAdvisor] Pledge selection API failed: ${err.message}`);
      return null; // fallback to random
    }

    // Parse pledge selection
    const validIds = new Set(allPledges.map(p => p.id));
    const selected = parsePledgeSelection(raw, validIds, count);

    if (selected) {
      console.log(`    AI reasoning: ${extractReasoning(raw)}`);
    }

    return selected;
  }

  getUsage() {
    return { ...this.totalUsage };
  }

  // === Prompt Builders ===

  buildSystemMessage(state, pledges) {
    let sys = SYSTEM_PROMPT;
    if (pledges?.length > 0) {
      const pledgeStr = pledges.map(p => `${p.name} (${p.desc})`).join(', ');
      sys += `\n\n선택한 공약: ${pledgeStr}\n공약 달성 시 +15점, 미달성 시 -20점입니다. 전략적으로 접근하세요.`;
    }
    return sys;
  }

  buildTurnPrompt(state, event, policyCatalog, pledges) {
    const context = buildContext(state, pledges);
    const activePolicyIds = (state.activePolicies || []).map(ap => ap.policy.id);

    // Available policies (not already active)
    const available = policyCatalog
      .filter(p => !activePolicyIds.includes(p.id))
      .map(p => `${p.id}: ${p.name} (${p.cost}억/턴, ${p.category}, ${p.targetDong || '구전체'})`)
      .join('\n');

    let prompt = `${context}\n\n`;

    // Event info
    if (event) {
      const choicesStr = event.choices.map(c =>
        `${c.id}: ${c.name} — ${c.description} (비용: ${c.cost}억원)`
      ).join('\n');
      prompt += `[긴급 이벤트]\n${event.name}: ${event.description}\n영향 동: ${(event.affectedDongs || []).join(', ')}\n선택지:\n${choicesStr}\n\n`;
    }

    prompt += `이번 분기 행동을 결정하세요. 아래 JSON 형식으로만 응답하세요:

{
  "reasoning": "이번 분기 판단 근거 (2~3문장)",
  "budget": {
    "economy": 15, "transport": 15, "culture": 10,
    "environment": 15, "education": 15, "welfare": 15, "renewal": 15
  },
  "policies": {
    "activate": [],
    "deactivate": []
  }${event ? `,\n  "eventChoice": "${event.choices[0]?.id || ''}"` : ''}
}

규칙:
- budget 7개 항목 합계 = 100
- 활성 정책 최대 3개 (현재 ${activePolicyIds.length}개: ${activePolicyIds.join(', ') || '없음'})
- activate: 새로 활성화할 정책 ID (비용과 슬롯 고려)
- deactivate: 해제할 기존 정책 ID${event ? `\n- eventChoice: 이벤트 선택지 ID (${event.choices.map(c => c.id).join(' / ')})` : ''}

사용 가능 정책:
${available}`;

    return prompt;
  }
}

// === Context Builder (advisor.js buildAdvisorContext 재구현) ===
function buildContext(state, pledges) {
  const prev = state.history?.length > 0 ? state.history[state.history.length - 1] : null;

  const totalPop = state.dongs.reduce((s, d) => s + d.population, 0);
  const totalBiz = state.dongs.reduce((s, d) => s + d.businesses, 0);
  const avgSat = Math.round(state.dongs.reduce((s, d) => s + d.satisfaction, 0) / state.dongs.length);

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

  // Pledges with progress
  if (pledges?.length > 0 && state._pledgeProgress) {
    ctx += `\n[공약 진척도]\n`;
    for (const p of pledges) {
      const progress = state._pledgeProgress[p.id] || 0;
      const status = progress >= 100 ? '달성' : progress >= 70 ? '순항' : progress >= 40 ? '보통' : '위험';
      ctx += `- ${p.name}: ${Math.round(progress)}% (${status})\n`;
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

  // Flags
  const flags = [];
  for (const dong of state.dongs) {
    if (dong.satisfaction < 50) flags.push(`${dong.name} 만족도 ${dong.satisfaction} — 주민 유출 위험`);
    if (dong.rentPressure > 0.01) flags.push(`${dong.name} 임대료 압력 ${(dong.rentPressure * 100).toFixed(1)}% — 젠트리피케이션 주의`);
  }
  if (flags.length > 0) {
    ctx += `\n[주목할 변화]\n${flags.map(f => `- ${f}`).join('\n')}\n`;
  }

  return ctx;
}

// === JSON Parser (3-level fallback) ===

const DEFAULT_BUDGET = { economy: 15, transport: 15, culture: 10, environment: 15, education: 15, welfare: 15, renewal: 15 };

function parseAction(raw, state, event, policyCatalog) {
  if (!raw || raw.trim() === '') {
    return { reasoning: 'AI 응답 없음 — 기본 행동', budget: { ...DEFAULT_BUDGET }, policies: { activate: [], deactivate: [] }, eventChoice: null };
  }

  let parsed = null;

  // Level 1: Direct JSON parse
  try {
    parsed = JSON.parse(raw.trim());
  } catch {
    // Level 2: Extract from code block
    const codeBlockMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
    if (codeBlockMatch) {
      try {
        parsed = JSON.parse(codeBlockMatch[1].trim());
      } catch { /* fall through */ }
    }
  }

  // Level 3: Regex extraction
  if (!parsed) {
    parsed = regexExtract(raw);
  }

  // Validate and normalize
  return validateAction(parsed, state, event, policyCatalog);
}

function regexExtract(raw) {
  const result = { reasoning: '', budget: null, policies: { activate: [], deactivate: [] }, eventChoice: null };

  // Extract reasoning
  const reasonMatch = raw.match(/"reasoning"\s*:\s*"([^"]+)"/);
  if (reasonMatch) result.reasoning = reasonMatch[1];

  // Extract budget object
  const budgetMatch = raw.match(/"budget"\s*:\s*\{([^}]+)\}/);
  if (budgetMatch) {
    try {
      result.budget = JSON.parse(`{${budgetMatch[1]}}`);
    } catch { /* use default */ }
  }

  // Extract activate array
  const activateMatch = raw.match(/"activate"\s*:\s*\[([^\]]*)\]/);
  if (activateMatch) {
    const ids = activateMatch[1].match(/"([^"]+)"/g);
    result.policies.activate = ids ? ids.map(s => s.replace(/"/g, '')) : [];
  }

  // Extract deactivate array
  const deactivateMatch = raw.match(/"deactivate"\s*:\s*\[([^\]]*)\]/);
  if (deactivateMatch) {
    const ids = deactivateMatch[1].match(/"([^"]+)"/g);
    result.policies.deactivate = ids ? ids.map(s => s.replace(/"/g, '')) : [];
  }

  // Extract eventChoice
  const eventMatch = raw.match(/"eventChoice"\s*:\s*"([^"]+)"/);
  if (eventMatch) result.eventChoice = eventMatch[1];

  return result;
}

function validateAction(parsed, state, event, policyCatalog) {
  const action = {
    reasoning: parsed?.reasoning || '',
    budget: { ...DEFAULT_BUDGET },
    policies: { activate: [], deactivate: [] },
    eventChoice: null,
  };

  // Budget validation
  if (parsed?.budget && typeof parsed.budget === 'object') {
    const keys = ['economy', 'transport', 'culture', 'environment', 'education', 'welfare', 'renewal'];
    const rawBudget = {};
    let sum = 0;
    for (const k of keys) {
      const v = Number(parsed.budget[k]) || 0;
      rawBudget[k] = Math.max(0, v);
      sum += rawBudget[k];
    }
    // Normalize to sum=100
    if (sum > 0) {
      for (const k of keys) {
        action.budget[k] = Math.round(rawBudget[k] / sum * 100);
      }
      // Fix rounding
      const roundedSum = Object.values(action.budget).reduce((a, b) => a + b, 0);
      if (roundedSum !== 100) {
        const maxKey = keys.reduce((a, b) => action.budget[a] >= action.budget[b] ? a : b);
        action.budget[maxKey] += 100 - roundedSum;
      }
    }
  }

  // Policy validation
  if (parsed?.policies) {
    const activePolicyIds = (state.activePolicies || []).map(ap => ap.policy.id);
    const catalogIds = new Set(policyCatalog.map(p => p.id));

    // Deactivate
    if (Array.isArray(parsed.policies.deactivate)) {
      action.policies.deactivate = parsed.policies.deactivate
        .filter(id => activePolicyIds.includes(id));
    }

    // After deactivation, how many slots available?
    const afterDeactivate = activePolicyIds.length - action.policies.deactivate.length;
    const slotsAvailable = 3 - afterDeactivate;

    // Activate
    if (Array.isArray(parsed.policies.activate)) {
      action.policies.activate = parsed.policies.activate
        .filter(id => catalogIds.has(id) && !activePolicyIds.includes(id))
        .slice(0, Math.max(0, slotsAvailable));
    }
  }

  // Event choice validation
  if (event && parsed?.eventChoice) {
    const validChoices = event.choices.map(c => c.id);
    if (validChoices.includes(parsed.eventChoice)) {
      action.eventChoice = parsed.eventChoice;
    } else {
      // Default to first choice
      action.eventChoice = event.choices[0]?.id || null;
    }
  } else if (event) {
    // Event exists but AI didn't choose — pick first
    action.eventChoice = event.choices[0]?.id || null;
  }

  return action;
}

// === Pledge Selection Parser ===

function parsePledgeSelection(raw, validIds, count) {
  if (!raw || raw.trim() === '') return null;

  let parsed = null;

  // Level 1: Direct JSON
  try {
    parsed = JSON.parse(raw.trim());
  } catch {
    // Level 2: Code block
    const codeBlockMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
    if (codeBlockMatch) {
      try { parsed = JSON.parse(codeBlockMatch[1].trim()); } catch { /* fall through */ }
    }
  }

  // Level 3: Regex
  if (!parsed?.pledges) {
    const match = raw.match(/"pledges"\s*:\s*\[([^\]]*)\]/);
    if (match) {
      const ids = match[1].match(/"([^"]+)"/g);
      if (ids) {
        parsed = { pledges: ids.map(s => s.replace(/"/g, '')) };
      }
    }
  }

  if (!parsed?.pledges || !Array.isArray(parsed.pledges)) return null;

  // Validate
  const selected = parsed.pledges.filter(id => validIds.has(id));
  if (selected.length === 0) return null;

  // Trim or pad to exact count
  return selected.slice(0, count);
}

function extractReasoning(raw) {
  try {
    const parsed = JSON.parse(raw.trim());
    if (parsed.reasoning) return parsed.reasoning;
  } catch { /* try regex */ }

  const match = raw.match(/"reasoning"\s*:\s*"([^"]+)"/);
  return match ? match[1] : '';
}
