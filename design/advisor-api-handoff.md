# AI 자문관 API 연결 보완 지시서

> **작성**: Luca (게임 디자이너)
> **수신**: Cody (구현)
> **날짜**: 2026-02-20
> **상태**: advisor.js 코드 95% 완성 확인. 아래 보완 후 API 테스트 가능.
> **우선순위**: 1→2→3 순서. 1번이 가장 중요.

---

## 현재 상태 (Luca 코드 리뷰 결과)

**잘 된 것:**
- 시스템 프롬프트 (advisor-prompt-v1.md §1.1 그대로)
- `buildAdvisorContext()` 동별 현황, 활성 정책, 예산 배분, 자동 플래그
- `anthropicCall()` CORS 헤더(`anthropic-dangerous-direct-browser-access`) 포함
- 브리핑/대화/퀵버튼 모두 API↔Mock 분기 처리
- `generateEventAnalysis()` 이벤트 분석 + event.js 연동
- API 키 설정 UI + localStorage 저장
- Mock fallback (API 실패 시 자동 전환)

**보완 필요한 것:** 아래 3개

---

## 보완 1: 공약 진척도를 컨텍스트에 추가 (필수)

### 문제
`buildAdvisorContext()`의 `[공약]` 섹션이 ID만 나열.
AI가 "관광 상생 31%라 주의하세요" 같은 맥락 있는 조언을 하려면 **이름 + 진척도 %** 필요.

### 현재 코드 (advisor.js ~L190)
```javascript
if (state.meta.pledges?.length > 0) {
  ctx += `\n[공약]\n`;
  for (const p of state.meta.pledges) {
    ctx += `- ${p}\n`;    // ← ID만 출력: "tourism_coexist"
  }
}
```

### 수정 방법

pledge.js에서 `calcProgress`와 `PLEDGES` 배열을 export해야 함.

**pledge.js 수정:**
```javascript
// 이미 export된 것: showPledgeSelection, initPledgeBar, renderPledgeBar, checkAchieved, calcFinalScore
// 추가 export:
export { PLEDGES, calcProgress };
```

**advisor.js 수정:**
```javascript
// 상단 import 추가
import { PLEDGES, calcProgress } from './pledge.js';

// buildAdvisorContext 내부 공약 섹션 교체
if (state.meta.pledges?.length > 0) {
  ctx += `\n[공약 진척도]\n`;
  for (const id of state.meta.pledges) {
    const pledge = PLEDGES.find(p => p.id === id);
    const progress = Math.round(calcProgress(id, state));
    const name = pledge?.name || id;
    const status = progress >= 100 ? '달성' : progress >= 70 ? '순항' : progress >= 40 ? '보통' : '위험';
    ctx += `- ${name}: ${progress}% (${status})\n`;
  }
}
```

### 기대 출력
```
[공약 진척도]
- 인구 반등: 98% (순항)
- 관광 상생: 31% (위험)
- 재정 건전: 85% (순항)
- 녹색 마포: 55% (보통)
```

→ AI가 이걸 보고 "관광 상생 공약이 31%로 위험합니다. 서교·합정·연남 만족도를 올려야..."라고 말할 수 있음.

---

## 보완 2: 시스템 프롬프트에 공약 정보 추가 (필수)

### 문제
`callAI()`에서 시스템 프롬프트에 구청장 이름만 넣고 공약 이름을 안 넣음.
AI가 게임 처음부터 어떤 공약을 선택했는지 모름.

### 현재 코드 (advisor.js ~L230)
```javascript
{ role: 'system', content: SYSTEM_PROMPT + 
  (currentState.meta.playerName ? `\n\n구청장님 성함: ${currentState.meta.playerName}` : '') 
},
```

### 수정
```javascript
function buildSystemMessage() {
  let sys = SYSTEM_PROMPT;
  if (currentState?.meta?.playerName) {
    sys += `\n\n구청장님 성함: ${currentState.meta.playerName}`;
  }
  if (currentState?.meta?.pledges?.length > 0) {
    const pledgeNames = currentState.meta.pledges.map(id => {
      const p = PLEDGES.find(pp => pp.id === id);
      return p ? `${p.name} (${p.desc})` : id;
    });
    sys += `\n선택한 공약: ${pledgeNames.join(', ')}`;
  }
  return sys;
}

// callAI 안에서:
const messages = [
  { role: 'system', content: buildSystemMessage() },
  ...recentHistory.map(h => ({...})),
  { role: 'user', content: userMessage },
];
```

---

## 보완 3: 게임 종료 AI 리뷰 프롬프트 (선택)

### 문제
`callAdvisorForReview(prompt)`가 export되어 있지만, main.js의 `showGameEnd()`에서 호출하는 곳이 없음.
게임 끝에 AI가 4년 임기를 총평하면 좋겠지만, **MVP에서는 선택사항**.

### 구현 시 프롬프트
```javascript
const reviewPrompt = `구청장님의 4년 임기가 끝났습니다. 아래 결과를 바탕으로 총평을 작성하세요.

${buildAdvisorContext(state)}

[최종 결과]
등급: ${grade}
총점: ${total}/130
KPI: ${kpis.map(k => `${k.label} ${k.score}/${k.max}`).join(', ')}
공약: ${pledgeResults.map(p => `${p.name} ${p.achieved ? '달성' : '미달성'}(${p.progress}%)`).join(', ')}

3~4문장으로 구청장님의 강점, 아쉬운 점, 그리고 "다음 임기에는..." 제안을 써 주세요.`;
```

main.js `showGameEnd()`에서 성적표 렌더링 후 API 호출 → 결과를 성적표 아래에 삽입.
API 실패 시 그냥 성적표만 보이면 됨.

---

## 테스트 체크리스트

API 키 넣은 후 확인할 것:

- [ ] 게임 시작 → 첫 브리핑이 AI로 생성되는가 (Mock과 다른 톤인가)
- [ ] 자유 채팅 → 동별 분석, 정책 제안이 맥락에 맞는가
- [ ] 퀵버튼 3개 → 각각 의미 있는 응답이 오는가
- [ ] 이벤트 발생 → AI 분석이 선택지별 트레이드오프를 짚는가
- [ ] 공약 진척도 언급 → "관광 상생 공약이 위험합니다" 같은 맥락 조언
- [ ] API 실패 → Mock으로 깨끗하게 fallback하는가
- [ ] 토큰/비용 → 48턴 플레이 시 총 API 비용 확인 (예상: ~$0.002)

---

## 파일 수정 범위

| 파일 | 수정 내용 | 규모 |
|------|----------|------|
| js/pledge.js | `PLEDGES`, `calcProgress` export 추가 | 1줄 |
| js/advisor.js | 공약 진척도 컨텍스트 + 시스템 프롬프트 보완 | ~30줄 |
| js/main.js | (선택) showGameEnd에서 AI 리뷰 호출 | ~15줄 |
