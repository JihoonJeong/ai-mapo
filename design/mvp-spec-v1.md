# AI 마포구청장 — MVP 스펙 v1.0

> **작성**: Luca (게임 디자이너)
> **날짜**: 2026-02-19
> **수신**: Cody (구현), JJ (승인)
> **기반**: numerical-design-v1.md, block-design-v0.3, mapo_blocks.json
> **목표**: "AI 자문관과 도시 문제를 풀어가는 게 재밌는가?" 검증

---

## 0. MVP 범위 요약

### 한 줄 정의
16개 동 맵 위에서 48턴(4년 임기) 동안 예산을 배분하고, AI 자문관과 대화하며, 4개 공약을 달성하는 턴제 도시경영 게임.

### In Scope (MVP)
- 16개 동 맵 + 96개 구획 데이터 (표시는 동 단위, 구획은 내부 계산용)
- 턴 루프 (브리핑 → 대화 → 예산 → 정책 → 결과)
- 인구·경제·재정 시뮬레이션 (수치 설계 v1 기반)
- AI 자문관 1명 (MCP/API 연동)
- 공약 시스템 4개
- 대시보드 (핵심 지표 시각화)
- 기본 이벤트 8종

### Out of Scope (Phase 2+)
- 구획 단위 상세 조작 (Phase 1은 동 단위)
- 복수 AI 엔진 전환
- 세이브/로드
- 비주얼 폴리싱
- 이벤트 시스템 확장 (선거, 재난)
- 리플레이 로그 내보내기

---

## 1. 기술 스택

### 프론트엔드
```
HTML + CSS + Vanilla JS (ES Modules)
├── index.html          — 메인 레이아웃
├── css/
│   └── style.css       — 전체 스타일
├── js/
│   ├── main.js         — 앱 초기화, 턴 루프 오케스트레이션
│   ├── map.js          — 마포구 맵 (SVG, 16개 동)
│   ├── dashboard.js    — 대시보드 차트 (Canvas/Chart.js)
│   ├── advisor.js      — AI 자문관 채팅 패널
│   ├── budget.js       — 예산 배분 UI
│   ├── policy.js       — 정책 선택 UI
│   ├── event.js        — 이벤트 시스템 UI
│   ├── pledge.js       — 공약 추적 UI
│   └── engine/
│       ├── simulation.js   — 시뮬레이션 엔진 (수치 계산)
│       ├── population.js   — 인구 모델
│       ├── economy.js      — 경제 모델
│       ├── finance.js      — 재정 모델
│       ├── satisfaction.js  — 만족도 모델
│       └── events.js       — 이벤트 로직
└── data/
    ├── mapo_blocks.json    — 96개 구획 (Luca 제작, 완료)
    ├── mapo_init.json      — 16개 동 초기 상태 (Buddy 생성)
    └── policies.json       — 정책 카탈로그
```

### AI 연동
```
1순위: MCP (Claude Desktop / Claude.ai) — 무료, 즉시 가능
2순위: Anthropic API (사용자 키 입력) — 유료, 독립 실행
3순위: Ollama 로컬 — 무료, GPU 필요
```

MVP는 **MCP 우선**. API 키 입력 폼은 포함하되 optional.

### 배포
GitHub Pages (정적 호스팅, 무료). AI API 호출은 클라이언트에서 직접.

---

## 2. 화면 구성

### 레이아웃 (단일 페이지)
```
┌─────────────────────────────────────────────────────┐
│  [헤더] 마포구청장 OOO | 턴 12/48 (2026년 4분기)    │
│  [공약바] ■■■□ 청년주거 42% | ■■□□ 관광상생 31% ... │
├──────────────────────┬──────────────────────────────┤
│                      │                              │
│    [마포구 맵]        │    [AI 자문관 채팅]           │
│    16개 동 SVG       │                              │
│    색상 = 선택 지표    │    브리핑 / 대화 / 분석       │
│    클릭 → 동 상세     │                              │
│                      │                              │
├──────────────────────┼──────────────────────────────┤
│                      │                              │
│    [대시보드]         │    [액션 패널]                │
│    인구/경제/재정     │    예산 배분 / 정책 선택       │
│    시계열 차트        │    이벤트 대응                │
│                      │                              │
└──────────────────────┴──────────────────────────────┘
```

### 맵 상세
- SVG 기반 마포구 16개 동 폴리곤
- 행정동 경계는 마포구 GeoJSON에서 추출 (Buddy 작업)
- 색상 코딩: 드롭다운으로 지표 선택 (인구변화율 / 만족도 / 상권활력 / 재정기여)
- 동 클릭 → 사이드패널에 동 상세 (구획 목록, 핵심 지표, 시설)
- 동 호버 → 툴팁 (동명, 인구, 만족도)

### 대시보드
- **구 전체 패널**: 총인구, 총예산, 재정자립도, 평균만족도
- **시계열 차트**: 최근 8턴 추이 (인구, 세수, 만족도)
- **동별 순위**: 선택 지표 기준 16개 동 바차트
- 구현: Chart.js (CDN)

### AI 채팅 패널
- 채팅 형식 (말풍선)
- 매 턴 시작 시 자동 브리핑 표시
- 플레이어 자유 입력 가능
- "분석 요청" 퀵버튼 3개: [동별 비교] [정책 효과 예측] [이슈 요약]

### 액션 패널 (턴의 핵심)
- **예산 배분 탭**: 7개 카테고리 슬라이더 (합계 = 자유예산 100%)
- **정책 선택 탭**: 카테고리별 2~3개 정책 중 택1 (또는 미선택)
- **이벤트 대응 탭**: 이벤트 발생 시만 활성화, 선택지 2~3개

---

## 3. 게임 루프 상세

### 턴 흐름 (상태 머신)

```
TURN_START
  → [자동] 시뮬레이션 틱 (전 턴 정책 효과 적용)
  → [자동] 이벤트 체크 & 생성
  → [자동] AI 브리핑 생성 & 표시
  ↓
PLAYER_PHASE
  → [선택] AI 자문관과 대화 (0~N회)
  → [필수] 예산 배분 확인/수정
  → [선택] 정책 선택 (0~3개)
  → [선택] 이벤트 대응 (있을 경우)
  → [필수] "턴 종료" 버튼 클릭
  ↓
TURN_END
  → [자동] 결과 집계 & 대시보드 업데이트
  → [자동] 공약 진척도 업데이트
  → [자동] 턴 카운터 증가
  → 턴 48 도달? → GAME_END
  → 아니면 → TURN_START
```

### TURN_START: 시뮬레이션 틱

```javascript
function simulateTick(state, playerActions) {
  // 1. 인구 변동
  for (dong of state.dongs) {
    dong.population += calcPopChange(dong, state);
  }
  
  // 2. 경제 변동
  for (dong of state.dongs) {
    dong.businesses += calcBizChange(dong, state);
    dong.workers = dong.businesses * dong.avgWorkersPerBiz;
  }
  
  // 3. 재정 계산
  state.finance.revenue = calcRevenue(state);
  state.finance.freeBudget = state.finance.revenue * 0.50;
  
  // 4. 만족도 갱신
  for (dong of state.dongs) {
    dong.satisfaction = calcSatisfaction(dong, state, playerActions);
  }
  
  // 5. 상권활력·임대료 갱신
  for (dong of state.dongs) {
    dong.commerceVitality = calcCommerceVitality(dong, state);
    dong.rentPressure = calcRentPressure(dong);
  }
  
  // 6. zoningConflict 레벨 갱신
  for (dong of state.dongs) {
    for (block of dong.blocks) {
      if (block.zoningConflict) {
        block.conflictLevel = calcConflictLevel(block, dong);
      }
    }
  }
  
  return state;
}
```

### PLAYER_PHASE: 예산 배분

```javascript
const BUDGET_CATEGORIES = {
  economy:    { name: "경제·일자리",   lag: [2, 4], min: 0, max: 40 },
  transport:  { name: "교통·인프라",   lag: [3, 6], min: 0, max: 30 },
  culture:    { name: "문화·관광",     lag: [1, 3], min: 0, max: 25 },
  environment:{ name: "환경·안전",     lag: [1, 2], min: 0, max: 25 },
  education:  { name: "교육·보육",     lag: [4, 8], min: 0, max: 25 },
  welfare:    { name: "주거·복지(추가)", lag: [2, 6], min: 0, max: 30 },
  renewal:    { name: "도시재생",       lag: [6,12], min: 0, max: 20 },
};
// 각 카테고리 비율의 합 = 100% (자유예산 기준)
```

### PLAYER_PHASE: 정책 선택

분기당 최대 **3개 정책** 동시 실행 가능. 턴 진행 시 효과 적용.

```javascript
// 정책 예시
const SAMPLE_POLICIES = [
  {
    id: "youth_housing",
    name: "청년 임대주택 공급",
    category: "welfare",
    cost: 80, // 억원/분기
    targetDong: null, // null = 구 전체, 또는 특정 동
    effects: {
      population: { youth: +0.5, delay: 3 },   // 청년 유입 +0.5%/턴, 3턴 후
      satisfaction: { youth: +3, delay: 1 },
      finance: { cost: -80 }
    },
    duration: 4, // 4턴 유지
    description: "역세권 청년주택 100호 공급. 시세 70% 수준."
  },
  {
    id: "noise_control",
    name: "관광지 소음 관리",
    category: "environment",
    cost: 15,
    targetDong: "seogyo",
    effects: {
      satisfaction: { resident: +5, delay: 1 },
      commerceVitality: { value: -2, delay: 1 },
      zoningConflict: { delta: -1, delay: 2 }
    },
    duration: 0, // 영구
    description: "서교동 야간 소음 측정·단속. 23시 이후 옥외 음향 제한."
  }
];
```

**정책 카탈로그 분량**: MVP 시점 **24~32개 정책**. 카테고리당 4~5개.
Phase 2에서 동 특화 정책 추가.

---

## 4. 시뮬레이션 엔진 스펙

### 상태 객체 (GameState)

```javascript
const GameState = {
  meta: {
    turn: 1,              // 1~48
    year: 2026,
    quarter: 1,           // 1~4
    playerName: "",
    pledges: []            // 선택한 공약 4개
  },
  
  dongs: [                 // 16개 동
    {
      id: "gongdeok",
      name: "공덕동",
      
      // === 인구 ===
      population: 35875,
      populationByAge: {   // 6개 생애주기
        child: 3200,       // 0-9
        teen: 2900,        // 10-19
        youth: 8930,       // 20-34
        midAge: 9100,      // 35-49
        senior: 5800,      // 50-64
        elderly: 5945      // 65+
      },
      households: 18304,
      
      // === 경제 ===
      businesses: 3972,
      workers: 25284,
      avgWorkersPerBiz: 6.4,
      commerceVitality: 65,    // 0~100
      rentPressure: 0.3,       // 0~1
      commerceCharacter: 80,   // 상권특색 0~100
      
      // === 생활인구 ===
      livingPop: {
        weekdayDay: 52000,     // 평일 낮 (mapo_living_pop.json 기반)
        weekdayNight: 38000,
        weekendDay: 35000,
        weekendNight: 36000
      },
      
      // === 만족도 ===
      satisfaction: 60,        // 0~100 (동 평균)
      satisfactionFactors: {
        housing: 55,
        transport: 70,
        safety: 65,
        environment: 60,
        economy: 60,
        culture: 55,
        welfare: 50
      },
      
      // === 블록 요약 ===
      blockSummary: {
        total: 7,
        zoningConflicts: 0,
        maxConflictLevel: 0
      }
    }
    // ... 나머지 15개 동
  ],
  
  finance: {
    totalBudget: 2188,         // 억원/분기
    mandatorySpend: 1094,      // 의무지출 (50%)
    freeBudget: 1094,          // 자유예산 (50%)
    allocation: {              // 플레이어 배분 (% of freeBudget)
      economy: 15,
      transport: 15,
      culture: 10,
      environment: 10,
      education: 15,
      welfare: 20,
      renewal: 15
    },
    revenue: {
      localTax: 613,
      grantFromCity: 700,
      subsidy: 750,
      otherIncome: 125
    },
    fiscalIndependence: 28     // 재정자립도 %
  },
  
  activePolicies: [],          // 현재 실행 중인 정책들
  activeEvents: [],            // 현재 진행 중인 이벤트들
  history: []                  // 턴별 스냅샷 (차트용)
};
```

### 수치 계산 함수 (numerical-design-v1 구현)

Buddy에게 넘기는 핵심 수식. **자세한 계수는 numerical-design-v1.md 참조.**

```
인구 변동:
  ΔPop = Natural + Migration + Displacement
  Natural = Pop × (-0.002) × (1/4)
  Migration = Pop × MigrationPull × 4.0 (가속)
  클램프: |ΔPop| ≤ Pop × 0.03

경제 변동:
  ΔBiz = NewBiz - ClosedBiz
  NewBiz = Biz × 0.02 × DemandFactor × PolicyBonus
  ClosedBiz = Biz × (0.018 + RentPressure + CompetitionPressure)

재정:
  지방세 = BaseTax × (1 + f(Δ사업체, Δ종사자))
  freeBudget = totalRevenue × 0.50

만족도:
  S[d] = 0.25×주거 + 0.20×교통 + 0.15×안전환경 + 0.15×경제 + 0.10×문화 + 0.10×복지 + 0.05×교육
  각 요소는 정책 투입과 시뮬레이션 결과에 의해 매 턴 갱신
```

---

## 5. AI 자문관 스펙

### 역할
"도시계획 자문관" — 데이터를 분석하고, 정책 효과를 예측하고, 이해관계 충돌을 짚어준다. 결정은 구청장(플레이어)이 한다.

### 시스템 프롬프트 구조

```
[역할 정의]
당신은 마포구 도시계획 자문관입니다. 구청장님의 정책 결정을 데이터 기반으로 보좌합니다.
결정은 구청장님이 합니다. 당신은 분석과 제안을 제공합니다.

[데이터 컨텍스트 — 매 턴 갱신]
현재 턴: {turn}/48
마포구 현황: {구 전체 요약}
주요 변화: {전 턴 대비 변동}
활성 이벤트: {있을 경우}
공약 진척: {4개 공약 현황}

[동별 관측 데이터 — Fog of Formulas]
{16개 동의 관측 가능 지표만. 내부 수식 계수 제공 안 함.}

[브리핑 지시]
- 3~5줄로 핵심 요약
- "구청장님" 호칭 사용
- 가장 긴급한 이슈 1개, 기회 1개 제시
- 구체적 수치 포함
- 판단은 하지 말고, 선택지를 제시
```

### 브리핑 생성 (매 턴 자동)

```javascript
async function generateBriefing(state) {
  const context = buildAdvisorContext(state);
  const prompt = `
    ${SYSTEM_PROMPT}
    
    [금번 분기 브리핑 요청]
    아래 데이터를 바탕으로 구청장님께 분기 브리핑을 작성하세요.
    
    ${context}
    
    형식:
    1. 핵심 요약 (2줄)
    2. 긴급 이슈 (1개, 수치 포함)
    3. 기회 요인 (1개, 수치 포함)
    4. 주목할 동 (1~2개)
  `;
  
  return await callAI(prompt);
}
```

### 자유 대화 (플레이어 주도)

플레이어가 질문하면 AI가 현재 GameState 컨텍스트 위에서 응답.

예시 질문/응답:
```
플레이어: "연남동 임대료 상승이 걱정인데, 어떤 정책이 효과적일까?"

자문관: "구청장님, 연남동 상권활력이 78로 임계치(70)를 넘어 임대료 압력이
0.4까지 올랐습니다. 세 가지 접근이 가능합니다:

1. 임대료 상한 유도 (비용 15억/분기) — 즉각 압력 감소, 단 사업체 유치 위축
2. 상생 협약 프로그램 (비용 10억/분기) — 건물주-임차인 협의, 2턴 후 효과
3. 방관 — 시장 논리, 젠트리피케이션 가속 위험

현재 공약 '관광상생'(31%) 달성을 고려하시면 2번이 양쪽 모두에 기여합니다."
```

### AI에게 주는 데이터 vs 안 주는 것

| 주는 것 | 안 주는 것 |
|---------|----------|
| 동별 인구, 사업체, 만족도 | 시뮬레이션 내부 수식 |
| 생활인구 4분면 | 가속 계수(4.0) 등 게임 상수 |
| 상권활력, 임대료 압력 수치 | 난수 시드 |
| 활성 정책과 이벤트 | 이벤트 발생 확률표 |
| 공약 진척도 | 공약 달성 정확 공식 |
| 동별 전 턴 대비 변동 | 미래 턴 시뮬레이션 결과 |
| zoningConflict 레벨 | 레벨 전이 정확 확률 |

→ AI는 관측 데이터에서 패턴을 읽고 추론해야 한다. "수식을 아는" 게 아니라 "현상을 분석하는" 자문관.

---

## 6. 공약 시스템

### 게임 시작 시 선택

8개 공약 후보 중 **4개 선택**. 4년 임기 동안 달성률을 추적.

| # | 공약 | 측정 기준 | 난이도 |
|---|------|----------|--------|
| 1 | **인구 반등** | 48턴 후 총인구 ≥ 초기값 | ★★★ |
| 2 | **청년 정착** | 청년(20-34) 비율 2%p 상승 | ★★☆ |
| 3 | **관광 상생** | 서교·합정·연남 만족도 ≥ 65 AND 상권활력 ≥ 60 | ★★★ |
| 4 | **고령 돌봄** | 65+ 만족도 구 평균 ≥ 70 | ★★☆ |
| 5 | **재정 건전** | 재정자립도 30% 달성 | ★★★ |
| 6 | **상권 다양성** | 상권특색 구 평균 ≥ 75 | ★★☆ |
| 7 | **교통 개선** | 교통 만족도 구 평균 ≥ 70 | ★☆☆ |
| 8 | **녹색 마포** | 환경 만족도 구 평균 ≥ 70 | ★☆☆ |

### 진척도 계산

매 턴 4개 공약의 현재 달성률(%)을 계산. 화면 상단에 프로그레스바로 표시.

```javascript
function calcPledgeProgress(pledge, state) {
  switch (pledge.id) {
    case "population_rebound":
      return Math.min(100, (state.totalPopulation / state.initialPopulation) * 100);
    case "youth_settlement":
      const currentYouthRatio = calcYouthRatio(state);
      const targetDelta = 2.0; // 2%p
      return Math.min(100, (currentYouthRatio - state.initialYouthRatio) / targetDelta * 100);
    // ... 나머지 공약
  }
}
```

### 최종 평가 (턴 48)

```
S등급: 4개 공약 모두 달성 (100%)
A등급: 3개 달성
B등급: 2개 달성
C등급: 1개 달성
D등급: 0개 달성

+ 보너스 평가:
  - "마포구 행복지수" = 전 동 평균 만족도
  - "재정 흑자 턴 수"
  - "인구 순유입 턴 수"
```

---

## 7. 이벤트 시스템 (MVP 8종)

### 이벤트 구조

```javascript
const Event = {
  id: string,
  name: string,
  trigger: Function,       // 발생 조건 (턴 수, 지표 수준 등)
  probability: number,     // 조건 충족 시 발생 확률
  description: string,     // 플레이어에게 보이는 설명
  choices: [
    { id: string, name: string, effects: Object, cost: number }
  ],
  duration: number,        // 이벤트 지속 턴
  affectedDongs: string[]  // 영향 받는 동
};
```

### MVP 이벤트 목록

| # | 이벤트 | 트리거 | 선택지 | 영향 동 |
|---|--------|--------|--------|---------|
| 1 | **홍대 관광객 폭증** | 턴 4,8,12... (정기) | A.축제확대 / B.관리강화 / C.현상유지 | 서교,합정,연남 |
| 2 | **연남동 임대료 폭등** | 연남 상권활력>80 | A.임대료상한 / B.상생협약 / C.방관 | 연남,망원1 |
| 3 | **DMC 기업 이탈 위기** | 상암 경제 하락 3턴 연속 | A.세제혜택 / B.인프라투자 / C.방관 | 상암 |
| 4 | **아현뉴타운 2기 요구** | 턴 16+ AND 인구↑ | A.추진 / B.부분추진 / C.보류 | 아현,공덕 |
| 5 | **망원시장 vs 대형마트** | 랜덤 (20%/분기) | A.전통시장지원 / B.공존프로그램 / C.시장논리 | 망원1,합정 |
| 6 | **성미산 개발 갈등** | 성산2 인구>40000 | A.보존 / B.부분개발 / C.주민투표 | 성산2,망원2 |
| 7 | **경의선숲길 확장 제안** | 턴 20+ | A.확장(대규모투자) / B.현행유지 / C.부분보수 | 공덕~연남 전역 |
| 8 | **고령화 복지 위기** | 65+ 비율 > 22% 동 3개+ | A.복지확대 / B.세대통합 / C.현행유지 | 도화,망원1,망원2 |

---

## 8. 데이터 파일 스펙

### mapo_init.json (Buddy 생성)

mapo_blocks.json에서 동 단위로 집계 + 수치 설계 초기값 적용.

```javascript
{
  "dongs": [
    {
      "id": "gongdeok",
      "name": "공덕동",
      "population": 35875,
      "populationByAge": { /* 6개 생애주기 */ },
      "households": 18304,
      "businesses": 3972,
      "workers": 25284,
      "livingPop": {
        "weekdayDay": 52000,  // mapo_living_pop.json에서 추출
        "weekdayNight": 38000,
        "weekendDay": 35000,
        "weekendNight": 36000
      },
      "satisfaction": 60,     // 초기값: 전 동 60
      "commerceVitality": 65, // 사업체밀도 기반 초기값
      "rentPressure": 0.3,    // 사업체밀도 기반 초기값
      "commerceCharacter": 80,
      "blocks": {             // mapo_blocks.json 참조 (구획 수만)
        "total": 7,
        "zoningConflicts": 0
      }
    }
    // ... 15개 더
  ],
  "finance": {
    "totalBudget": 2188,
    "mandatorySpend": 1094,
    "freeBudget": 1094,
    "revenue": { "localTax": 613, "grantFromCity": 700, "subsidy": 750, "otherIncome": 125 },
    "fiscalIndependence": 28
  }
}
```

### policies.json (Luca 작성 예정)

```javascript
{
  "policies": [
    {
      "id": "youth_housing",
      "name": "청년 임대주택 공급",
      "category": "welfare",
      "cost": 80,
      "targetDong": null,
      "effects": { /* ... */ },
      "duration": 4,
      "description": "역세권 청년주택 100호 공급. 시세 70% 수준.",
      "prerequisites": [],       // 선행 조건
      "incompatible": []         // 동시 실행 불가 정책
    }
    // ...
  ]
}
```

---

## 9. 구현 우선순위 (Cody 작업 순서)

### Sprint 1: 뼈대 (3일)
1. HTML 레이아웃 + CSS (4분할 구조)
2. 마포구 SVG 맵 (16개 동 폴리곤) + 호버/클릭
3. 턴 루프 상태 머신 (TURN_START → PLAYER_PHASE → TURN_END)
4. mapo_init.json 생성 (Buddy가 수집한 데이터 합산)

### Sprint 2: 시뮬레이션 (3일)
5. population.js — 인구 변동 모델
6. economy.js — 경제 변동 모델
7. finance.js — 재정 모델
8. satisfaction.js — 만족도 모델
9. 대시보드 차트 (Chart.js)

### Sprint 3: AI + 정책 (3일)
10. advisor.js — MCP/API 연동, 시스템 프롬프트
11. 브리핑 자동 생성
12. 예산 배분 UI (슬라이더)
13. 정책 선택 UI (카드)
14. policies.json 정책 카탈로그 24개

### Sprint 4: 게임성 (2일)
15. 공약 시스템 (선택 + 추적 + 프로그레스바)
16. 이벤트 시스템 8종
17. 게임 시작 화면 (이름 입력, 공약 선택)
18. 게임 종료 화면 (평가)

### Sprint 5: 통합 테스트 (2일)
19. 48턴 풀 플레이 테스트
20. 밸런스 조정 (가속 계수, 정책 효과 크기)
21. AI 브리핑 품질 튜닝
22. 버그 픽스

**총 예상: 약 2주 (13일)**

---

## 10. 검증 질문 (Phase 1 완료 시)

이 MVP로 답하려는 질문:

1. **"AI 자문관과 도시 문제를 풀어가는 게 재밌는가?"**
   - AI 브리핑이 의미 있는 정보를 주는가?
   - 자유 대화에서 통찰이 나오는가?
   - AI 없이 플레이하는 것보다 나은가?

2. **"실제 데이터 기반이 몰입감을 높이는가?"**
   - "이건 진짜 마포구다" 느낌이 드는가?
   - 가상 도시와 어떤 차이가 체감되는가?

3. **"48턴이 적당한 길이인가?"**
   - 너무 길어서 지치거나, 너무 짧아서 허무하지 않은가?
   - 1시간 안에 끝나는가?

4. **"Four-Shell: AI 엔진에 따라 자문 스타일이 달라지는가?"**
   - Claude vs GPT vs 로컬 모델에서 같은 상황, 다른 분석이 나오는가?
   - (MVP는 1개 엔진이지만 준비된 구조인가?)

---

## 부록: 파일 목록

| 파일 | 위치 | 상태 | 설명 |
|------|------|------|------|
| mapo_blocks.json | data/game/ | ✅ 완료 | 96개 구획 데이터 |
| numerical-design-v1.md | design/ | ✅ 완료 | 수치 설계 (수식, 계수) |
| block-design-v0.3-verified.md | design/ | ✅ 완료 | 구획 설계 최종 |
| mapo_init.json | data/game/ | ✅ Cody | 동 단위 초기 상태 (Sprint 1 완료) |
| policies.json | data/game/ | ✅ Luca | 정책 카탈로그 28개 (7카테고리 x 4) |
| mapo_map.svg | assets/ | ✅ Cody | 마포구 16개 동 SVG |
| advisor-prompt-v1.md | design/ | ✅ Luca | AI 자문관 프롬프트 상세 |
| events.json | data/game/ | ✅ Luca | 이벤트 8종 상세 |
