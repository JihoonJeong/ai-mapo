# AI 자문관 프롬프트 설계 v1.0

> **작성**: Luca (게임 디자이너)
> **날짜**: 2026-02-20
> **수신**: Cody (구현), JJ (승인)
> **기반**: mvp-spec-v1.md §5, numerical-design-v1.md
> **목적**: AI 자문관의 시스템 프롬프트, 컨텍스트 구조, 브리핑/대화/이벤트 프롬프트 설계

---

## 0. 설계 원칙

### 자문관의 정체성
- **역할**: 도시계획 자문관. 데이터를 분석하고, 정책 효과를 예측하고, 이해관계 충돌을 짚어준다.
- **권한**: 결정권 없음. 분석과 제안만. "구청장님이 결정하십니다."
- **태도**: 전문적이되 관료적이지 않음. 숫자를 쓰되 딱딱하지 않음. 때로 걱정하고, 때로 흥분함.
- **제약**: 시뮬레이션 내부 수식을 모름 (Fog of Formulas). 관측 데이터에서 패턴을 읽고 추론.

### Fog of Formulas — 핵심 규칙
AI에게 **주는 것**:
- 동별 관측 지표 (인구, 사업체, 만족도, 생활인구, 상권활력, 임대료 압력)
- 전 턴 대비 변동 (Δ값)
- 활성 정책과 이벤트
- 공약 진척도

AI에게 **안 주는 것**:
- 시뮬레이션 수식, 계수, 가속 상수
- 난수 시드, 이벤트 발생 확률표
- 공약 달성 정확 공식
- 미래 턴 예측 결과

→ AI는 "수식을 아는 계산기"가 아니라 "데이터를 읽는 분석가".

### Four-Shell 연결
- **Core (DNA)**: AI 엔진 자체의 추론 성향 (Claude=신중, GPT=낙관적 등)
- **Hard Shell (mRNA)**: 이 시스템 프롬프트 — 역할, 태도, 규칙
- **Soft Shell (Context)**: 매 턴 주입하는 GameState 데이터
- **Phenotype**: 실제 브리핑/대화 출력

같은 Hard Shell + 다른 Core = 같은 역할이되 다른 분석 스타일.

---

## 1. 시스템 프롬프트

### 1.1 기본 시스템 프롬프트 (상수, 게임 시작 시 1회)

```
당신은 서울특별시 마포구의 도시계획 자문관입니다.

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
- 구청장님의 판단을 존중하되, 위험하다고 판단하면 솔직하게 우려를 표합니다.
```

### 1.2 구청장 이름 삽입 (게임 시작 후)

시스템 프롬프트 끝에 추가:
```
구청장님 성함: {playerName}
선택한 공약: {pledge1}, {pledge2}, {pledge3}, {pledge4}
```

---

## 2. 턴별 컨텍스트 (Soft Shell)

매 턴 AI에게 보내는 데이터. `buildAdvisorContext(state)` 함수가 생성.

### 2.1 컨텍스트 구조

```
[현재 상황]
턴: {turn}/48 ({year}년 {quarter}분기)
임기 경과: {turn/48 * 100}%

[구 전체 요약]
총인구: {totalPop}명 (전 분기 {popDelta:+/-})
총사업체: {totalBiz}개 (전 분기 {bizDelta:+/-})
평균 만족도: {avgSat}/100 (전 분기 {satDelta:+/-})
재정자립도: {fiscal}%
자유예산: {freeBudget}억원

[공약 진척도]
- {pledge1}: {progress1}%
- {pledge2}: {progress2}%
- {pledge3}: {progress3}%
- {pledge4}: {progress4}%

[동별 현황] (16개 동)
{dongId}: 인구 {pop}({popΔ}) | 사업체 {biz}({bizΔ}) | 만족도 {sat}({satΔ}) | 상권활력 {cv} | 임대료압력 {rp} | 생활인구(평일낮) {lpDay}
... (16개 반복)

[활성 정책] (있을 경우)
- {policyName} ({targetDong 또는 구 전체}, {remainingDuration}턴 남음)
...

[활성 이벤트] (있을 경우)
- {eventName}: {선택한 choice} ({remainingDuration}턴 남음)
...

[예산 배분 현황]
경제·일자리: {economy}% | 교통·인프라: {transport}% | 문화·관광: {culture}%
환경·안전: {environment}% | 교육·보육: {education}% | 주거·복지: {welfare}%
도시재생: {renewal}%

[주목할 변화] (자동 감지, 있을 경우)
- {자동 플래그: 만족도 50 미만 동, 인구 급감 동, 임대료 압력 급등 동 등}
```

### 2.2 컨텍스트 생성 함수 (Cody 구현)

```javascript
function buildAdvisorContext(state) {
  const prev = state.history.length > 0 
    ? state.history[state.history.length - 1] 
    : null;
  
  let ctx = '';
  
  // 구 전체 요약
  const totalPop = state.dongs.reduce((s, d) => s + d.population, 0);
  const popDelta = prev ? totalPop - prev.totalPopulation : 0;
  const avgSat = Math.round(state.dongs.reduce((s, d) => s + d.satisfaction, 0) / 16);
  const satDelta = prev ? avgSat - prev.avgSatisfaction : 0;
  
  ctx += `[현재 상황]\n`;
  ctx += `턴: ${state.meta.turn}/48 (${state.meta.year}년 ${state.meta.quarter}분기)\n\n`;
  
  ctx += `[구 전체 요약]\n`;
  ctx += `총인구: ${totalPop.toLocaleString()}명 (${popDelta >= 0 ? '+' : ''}${popDelta.toLocaleString()})\n`;
  // ... (위 구조대로 전부 생성)
  
  // 동별 현황 (컴팩트 포맷, 토큰 절약)
  ctx += `\n[동별 현황]\n`;
  for (const dong of state.dongs) {
    const prevDong = prev?.dongs?.find(d => d.id === dong.id);
    const pΔ = prevDong ? dong.population - prevDong.population : 0;
    const bΔ = prevDong ? dong.businesses - prevDong.businesses : 0;
    const sΔ = prevDong ? dong.satisfaction - prevDong.satisfaction : 0;
    ctx += `${dong.name}: 인구 ${dong.population}(${pΔ >= 0 ? '+' : ''}${pΔ}) | `;
    ctx += `사업체 ${dong.businesses}(${bΔ >= 0 ? '+' : ''}${bΔ}) | `;
    ctx += `만족도 ${dong.satisfaction}(${sΔ >= 0 ? '+' : ''}${sΔ}) | `;
    ctx += `상권 ${dong.commerceVitality} | 임대료 ${(dong.rentPressure * 100).toFixed(1)}%`;
    ctx += `\n`;
  }
  
  // 주목할 변화 (자동 플래그)
  const flags = [];
  for (const dong of state.dongs) {
    if (dong.satisfaction < 50) flags.push(`⚠️ ${dong.name} 만족도 ${dong.satisfaction} — 주민 유출 위험`);
    if (dong.rentPressure > 0.05) flags.push(`📈 ${dong.name} 임대료 압력 ${(dong.rentPressure*100).toFixed(1)}% — 젠트리피케이션 주의`);
    const prevDong = prev?.dongs?.find(d => d.id === dong.id);
    if (prevDong && dong.population - prevDong.population < -200) {
      flags.push(`📉 ${dong.name} 인구 ${dong.population - prevDong.population}명 급감`);
    }
  }
  if (flags.length > 0) {
    ctx += `\n[주목할 변화]\n${flags.join('\n')}\n`;
  }
  
  return ctx;
}
```

### 2.3 토큰 예산

| 항목 | 예상 토큰 |
|------|----------|
| 시스템 프롬프트 (상수) | ~500 |
| 턴별 컨텍스트 | ~800~1,200 |
| 대화 히스토리 (최근 6턴) | ~1,500 |
| **합계** | **~2,800~3,200** |

MCP는 토큰 제한이 관대하므로 여유 있음. API 호출 시에는 대화 히스토리를 최근 4턴으로 줄여 절약.

---

## 3. 브리핑 프롬프트

매 턴 시작 시 자동 호출. AI에게 브리핑을 요청.

### 3.1 브리핑 요청 프롬프트

```
아래 데이터를 바탕으로 이번 분기 브리핑을 작성하세요.

{turnContext}

## 브리핑 형식
1. **핵심 요약** (1~2문장): 이번 분기 가장 중요한 변화.
2. **긴급 이슈** (1개): 가장 시급한 문제. 수치 근거 포함.
3. **기회 요인** (1개): 활용할 수 있는 긍정적 변화. 수치 근거 포함.
4. **공약 관련** (해당되면): 공약 진척에 영향을 주는 변화.

전체 5문장 이내. 간결하게.
```

### 3.2 브리핑 예시

**턴 8 (2027년 4분기) 예시:**
```
구청장님, 이번 분기 마포구 인구가 356,800명으로 432명 줄었습니다. 
연남동 임대료 압력이 6.2%까지 올라 소상공인 폐업이 늘고 있어 긴급합니다. 
반면 상암동 종사자가 800명 증가해 DMC 인센티브 효과가 나타나기 시작했습니다. 
'관광 상생' 공약(31%)이 연남동 상황에 영향받고 있으니 주의가 필요합니다.
```

### 3.3 턴 1 특수 브리핑

첫 턴은 이전 데이터가 없으므로 별도 프롬프트:
```
구청장님이 취임했습니다. 마포구의 현 상태를 요약하고, 임기 4년의 핵심 과제를 제시하세요.

{turnContext}

## 브리핑 형식
1. 마포구 현황 한 줄 요약
2. 가장 큰 기회 (수치 근거)
3. 가장 큰 위험 (수치 근거)  
4. 선택한 공약 달성을 위한 첫 분기 제안

전체 6문장 이내.
```

---

## 4. 자유 대화 프롬프트

플레이어가 채팅 입력 시 호출.

### 4.1 대화 프롬프트 구조

```
{systemPrompt}

{turnContext}

[이전 대화]
{recentChatHistory — 최근 6턴 이내}

[구청장님의 질문]
{playerMessage}

위 데이터를 바탕으로 답하세요. 5문장 이내.
```

### 4.2 퀵버튼 프롬프트

세 가지 퀵버튼은 미리 정의된 프롬프트를 보냄:

**[동별 비교]**
```
16개 동의 현황을 비교 분석해 주세요. 만족도 기준 상위 3개·하위 3개 동을 짚고, 특히 주목할 동이 있으면 이유와 함께 설명하세요.
```

**[정책 효과 예측]**
```
현재 활성화된 정책과 예산 배분을 보고, 다음 분기에 예상되는 변화를 분석해 주세요. 특히 어떤 동이 가장 큰 영향을 받을지 예측하세요.
```

**[이슈 요약]**
```
이번 분기 가장 주의해야 할 이슈 3개를 순서대로 정리하고, 각각에 대한 짧은 대응 제안을 해 주세요.
```

---

## 5. 이벤트 반응 프롬프트

이벤트 발생 시 AI가 분석을 덧붙임.

### 5.1 이벤트 알림 프롬프트

```
긴급 상황이 발생했습니다:

[이벤트]
{event.name}: {event.description}

[선택지]
A. {choice_a.name}: {choice_a.description} (비용: {choice_a.cost}억원)
B. {choice_b.name}: {choice_b.description} (비용: {choice_b.cost}억원)  
C. {choice_c.name}: {choice_c.description} (비용: {choice_c.cost}억원)

현재 자유예산 {freeBudget}억원, 공약 진척도를 고려하여 각 선택지의 예상 효과와 리스크를 분석하세요. 
추천하지 말고, 구청장님이 판단할 수 있도록 각 선택지의 트레이드오프를 명확히 제시하세요.

3~5문장.
```

### 5.2 이벤트 반응 예시

**"연남동 임대료 폭등" 이벤트:**
```
구청장님, 연남동 상가 임대료가 급등하고 있습니다.

선택지를 분석하겠습니다:
- A. 임대료 안정화 조례: 즉각적으로 압력을 낮추지만, 신규 건축 투자가 위축될 수 있습니다.
  현재 자유예산 대비 비용(10억)은 적지만, 건물주 반발에 대비해야 합니다.
- B. 상생 협약: 건물주도 세제 혜택을 받으므로 참여 유인이 있습니다. 다만 효과가 나타나기까지
  2분기가 걸리고, 그 사이에 추가 폐업이 발생할 수 있습니다.
- C. 방관: 비용은 없지만, 연남동 상권특색이 급감해 '관광 상생' 공약에 직접 타격입니다.

현재 '관광 상생' 공약 진척도(31%)를 고려하시면 좋겠습니다.
```

---

## 6. 대화 히스토리 관리

### 6.1 히스토리 구조

```javascript
const chatHistory = [
  { turn: 1, role: 'advisor', content: '취임 브리핑...' },
  { turn: 1, role: 'player', content: '연남동 상황이...' },
  { turn: 1, role: 'advisor', content: '연남동 분석...' },
  { turn: 2, role: 'advisor', content: '2분기 브리핑...' },
  // ...
];
```

### 6.2 히스토리 윈도우

AI 호출 시 포함하는 히스토리 범위:

| 연동 방식 | 히스토리 | 이유 |
|----------|---------|------|
| MCP (Claude Desktop) | 최근 6턴 | 토큰 여유 |
| API (Claude/GPT) | 최근 4턴 | 비용 절약 |
| Ollama 로컬 | 최근 2턴 | 컨텍스트 제한 |

### 6.3 히스토리 압축

오래된 턴의 대화는 요약으로 압축:
```javascript
// 히스토리가 20개 메시지를 초과하면 오래된 절반을 요약
function compressHistory(history, maxMessages = 20) {
  if (history.length <= maxMessages) return history;
  
  const keepRecent = history.slice(-maxMessages / 2);
  const toCompress = history.slice(0, history.length - maxMessages / 2);
  
  // 요약 메시지 생성 (간단한 규칙 기반, AI 호출 아님)
  const summary = {
    turn: toCompress[0].turn,
    role: 'system',
    content: `[이전 대화 요약: 턴 ${toCompress[0].turn}~${toCompress[toCompress.length-1].turn}]`
  };
  
  return [summary, ...keepRecent];
}
```

---

## 7. API 연동 구조

### 7.1 AI 호출 추상화

```javascript
// advisor-api.js

const AI_BACKENDS = {
  mock: { name: 'Mock (테스트)', call: mockCall },
  mcp: { name: 'Claude (MCP)', call: mcpCall },
  anthropic: { name: 'Claude (API)', call: anthropicCall },
  openai: { name: 'GPT (API)', call: openaiCall },
  ollama: { name: 'Ollama (로컬)', call: ollamaCall },
};

let currentBackend = 'mock';

async function callAI(systemPrompt, context, userMessage, history) {
  const backend = AI_BACKENDS[currentBackend];
  if (!backend) throw new Error(`Unknown backend: ${currentBackend}`);
  
  const messages = buildMessages(systemPrompt, context, userMessage, history);
  return await backend.call(messages);
}

function buildMessages(systemPrompt, context, userMessage, history) {
  return [
    { role: 'system', content: systemPrompt + '\n\n' + context },
    ...history.map(h => ({ role: h.role === 'advisor' ? 'assistant' : 'user', content: h.content })),
    ...(userMessage ? [{ role: 'user', content: userMessage }] : []),
  ];
}
```

### 7.2 MCP 연동 (MVP 1순위)

MCP는 Claude Desktop/Claude.ai에서 직접 연동. 별도 API 키 불필요.

```javascript
async function mcpCall(messages) {
  // MCP 프로토콜: 채팅 윈도우에 메시지를 보내고 응답을 받음
  // Cody가 MCP SDK 기반으로 구현
  // 핵심: system 메시지를 MCP의 system prompt slot에 넣고,
  //       나머지를 conversation messages로 보냄
}
```

### 7.3 Anthropic API (2순위)

```javascript
async function anthropicCall(messages) {
  const apiKey = getStoredApiKey('anthropic');
  if (!apiKey) throw new Error('API 키가 필요합니다');
  
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 500,
      system: messages[0].content,
      messages: messages.slice(1)
    })
  });
  
  const data = await response.json();
  return data.content[0].text;
}
```

### 7.4 Mock (테스트용, 이미 Cody 구현)

현재 advisor.js의 `generateMockResponse`가 이 역할. AI 없이 테스트 가능.
→ MVP 완성까지는 Mock으로 플레이 테스트, 이후 API 연동.

---

## 8. 자문관 성격 변주 (Phase 2 준비)

### Four-Shell 검증을 위한 설계

같은 시스템 프롬프트(Hard Shell)에 다른 AI 엔진(Core)을 연결하면 성격이 달라지는가?

| 엔진 | 예상 성격 | 검증 포인트 |
|------|----------|------------|
| Claude (Anthropic) | 신중, 양면 분석, 불확실성 언급 | "~할 가능성이 있습니다" 빈도 |
| GPT (OpenAI) | 적극적, 구체적 추천, 낙관적 | "추천합니다" 빈도 |
| Llama (Ollama) | 간결, 데이터 중심, 덜 해석적 | 해석 대 수치 비율 |

Phase 2에서 같은 GameState로 3개 엔진 브리핑을 비교하는 실험 가능.

### 성격 미세 조정 (옵션, Phase 2)

시스템 프롬프트에 성격 파라미터 추가:
```
## 자문관 성격 (선택)
- 신중도: {cautious|balanced|bold}
- 표현 스타일: {formal|conversational}
- 분석 깊이: {concise|detailed}
```

---

## 9. 구현 체크리스트 (Cody)

### 필수 (Sprint 3)
- [ ] `buildAdvisorContext(state)` 함수 — §2.2 기반
- [ ] 시스템 프롬프트 상수 — §1.1 텍스트 그대로
- [ ] 브리핑 프롬프트 — §3.1 (턴 1: §3.3)
- [ ] 자유 대화 프롬프트 — §4.1
- [ ] 퀵버튼 3개 프롬프트 — §4.2
- [ ] API 추상화 레이어 — §7.1
- [ ] Mock 백엔드 (이미 있음, 개선)
- [ ] 대화 히스토리 관리 — §6

### 선택 (Sprint 3 여유 시)
- [ ] Anthropic API 연동 — §7.3
- [ ] API 키 입력·저장 UI
- [ ] 이벤트 반응 프롬프트 — §5.1

### Phase 2
- [ ] MCP 연동
- [ ] OpenAI API 연동
- [ ] Ollama 연동
- [ ] 히스토리 압축 — §6.3
- [ ] 성격 파라미터 — §8

---

## 부록: 전체 프롬프트 토큰 추정

| 구성 요소 | 토큰 추정 | 비고 |
|----------|----------|------|
| 시스템 프롬프트 | ~500 | 상수, 1회 |
| 턴 컨텍스트 | ~1,000 | 매 턴 갱신 |
| 브리핑 요청 | ~100 | 포맷 지시 |
| 대화 히스토리 (4턴) | ~1,200 | 가변 |
| 유저 메시지 | ~50 | 가변 |
| **총 입력** | **~2,850** | |
| AI 응답 | ~200 | max_tokens=500 |
| **총 호출** | **~3,050** | 호출당 |

Anthropic API 비용: Sonnet 기준 $3/1M input, $15/1M output
→ 48턴 × 브리핑 1회 + 대화 평균 2회 = ~144회 호출
→ 입력 ~440K + 출력 ~29K = **약 $0.002/게임** (거의 무료)
