# 도시 시뮬레이션 아키텍처 리서치
> AI 마포구청장 MVP 설계를 위한 선행 연구

## 조사 대상

| 프로젝트 | 언어 | 특징 | 레퍼런스 가치 |
|----------|------|------|-------------|
| **Micropolis (원본)** | C→C++ | SimCity Classic GPL 공개, 타일 기반 | 시뮬레이션 루프 패턴 |
| **MicropolisJ** | Java | 가장 깨끗한 리팩터링, 클래스 구조 명확 | 엔진 설계 패턴 |
| **micropolisJS** | JS/TS | 브라우저 실행, Canvas 렌더링 | 기술 스택 참고 |
| **Hallucinating Splines** | TS | **AI 에이전트가 시장** — headless Micropolis + REST API | AI 연동 아키텍처 |
| **MicropolisCore** | C++→WASM | Emscripten/SvelteKit, headless Node.js 가능 | WASM 아키텍처 |
| **LinCity-NG** | C++ | 자원 흐름 시뮬레이션 (원자재→공산품→소비) | 경제 모델 |
| **Citybound** | Rust | Actor 기반, 개별 가구 시뮬레이션 | 에이전트 모델 철학 |
| **Divercity** | Java | MicropolisJ 포크, A* 교통, 교육/연구 시스템 추가 | 확장 패턴 |

---

## 1. Micropolis 시뮬레이션 아키텍처 (핵심 레퍼런스)

### 1.1 엔진-UI 분리 원칙

```
[Simulation Engine]  ←→  [Listener/Event Interface]  ←→  [GUI/Frontend]
   (순수 로직)              (Observer 패턴)               (렌더링)
```

MicropolisJ가 가장 깨끗하게 보여준 원칙:
- `micropolisj.engine` 패키지: **GUI 의존성 제로**. 순수 시뮬레이션.
- `micropolisj.gui` 패키지: 렌더링 + 이벤트 수신.
- 엔진이 `Listener` 인터페이스를 통해 변화를 통지 → UI가 구독.

**우리 프로젝트 적용**: 시뮬레이션 엔진은 반드시 UI-agnostic으로 설계. AI 자문관도 같은 Listener 인터페이스로 데이터 구독.

### 1.2 메인 시뮬레이션 루프

```java
// Micropolis.java — animate() 메서드 (프론트엔드가 주기적으로 호출)
void animate() {
    // 1. 시뮬레이션 한 스텝 진행
    simulate();    // ← 핵심
    // 2. 스프라이트(차량, 헬기 등) 이동
    moveObjects();
    // 3. 타일 애니메이션
    animateTiles();
}
```

`simulate()` 내부 실행 순서 (한 "틱"의 구조):

```
simulate() {
    1. mapScan(x0, x1)        — 맵 일부 영역 스캔 (한 틱에 전체가 아닌 8분의 1씩)
    2. generateShip/Copter     — 스프라이트 생성
    3. if (매 4틱) takeCensus() — 인구/건물 집계
    4. if (매 48틱) takeCensus2() + collectTax() — 연간 예산/세수
    5. if (조건) sendMessages() — 도시 메시지 (문제 알림 등)
}
```

**핵심 통찰**: 전체 맵을 매 틱 스캔하지 않는다. **분할 스캔**(8분의 1씩) → 성능 최적화.

### 1.3 핵심 서브시스템 (MicropolisJ 클래스 목록에서 추출)

| 클래스/모듈 | 역할 | 우리 게임 대응 |
|------------|------|-------------|
| `Micropolis.java` | 메인 엔진, 모든 상태 보유 | `SimulationEngine` |
| `MapScanner.java` | 타일별 영역 스캔, 존 성장/쇠퇴 | `DistrictUpdater` (동별 업데이트) |
| `TrafficGen.java` | 교통량 생성, 경로 탐색 | `TrafficModel` |
| `CityEval.java` | 도시 평가 (만족도, 문제점 순위) | `SatisfactionEval` |
| `BudgetNumbers.java` | 예산 계산 (세수, 지출, 잔액) | `BudgetSystem` |
| `MapGenerator.java` | 초기 맵 생성 | `InitialStateLoader` (공공데이터) |
| `Disaster.java` | 재난 이벤트 | `EventSystem` |
| `GameLevel.java` | 난이도 | 불필요 (재정자립도 = 자연 난이도) |

### 1.4 오버레이 맵 패턴

Micropolis는 **다중 2D 배열(half-resolution)**을 유지:

```java
int[][] landValueMem;    // 지가 (0-250)
int[][] pollutionMem;    // 오염 (0-255)
int[][] crimeMem;        // 범죄 (0-250)
int[][] popDensity;      // 인구밀도
int[][] trfficDensity;   // 교통밀도
int[][] rateOGMem;       // 성장률
boolean[][] powerMap;    // 전력 공급 여부
int[][] fireRate;        // 소방 효과
int[][] policeMapEffect; // 경찰 효과
```

각 오버레이는 독립 스캔 → 스무딩(인접 셀 평균) → UI 표시.

**우리 프로젝트**: 타일 대신 **16개 동이 곧 "셀"**. 각 동마다 여러 지표 배열:
```
satisfaction[16]     // 주민 만족도
livingPopulation[16] // 생활인구
economy[16]          // 경제 활력
environment[16]      // 환경 지표
safety[16]           // 안전 지표
rentPressure[16]     // 임대료 압력
```

### 1.5 RCI 수요 밸브 시스템

SimCity의 핵심 피드백 루프:

```
Residential 수요 ← 일자리 수 (C+I)
Commercial 수요  ← 인구 수 × 부유도
Industrial 수요  ← 인구 수 × 교육수준
```

- `resValve`, `comValve`, `indValve` — -2000~+2000 범위의 수요 지표
- 수요가 양수면 해당 존이 성장, 음수면 쇠퇴
- **순환 구조**: R↑ → C수요↑ → C↑ → R수요↑ → ...

**우리 프로젝트**: RCI 대신 **관광-세수 되먹임 루프**:
```
관광객(생활인구)↑ → 상권매출↑ → 세수↑ → 투자 가능↑
    BUT: 임대료↑ → 소상공인 이탈 → 상권 특색↓ → 관광매력↓
```

### 1.6 Census-Budget 주기

```
매 4틱: takeCensus()
  → 존별 건물 수, 인구, 사업체 집계
  → RCI 밸브 재계산
  → 성장률 업데이트

매 48틱 (= 1년): takeCensus2() + collectTax()
  → 연간 세수 계산
  → 예산 배분 (도로, 경찰, 소방 비율)
  → 재정 히스토리 기록
```

**우리 프로젝트**: 1턴 = 1분기(현실 3개월).
```
매 턴: 
  → 동별 인구/경제/만족도 집계 (Census)
  → 분기 예산 배분 (Budget)
  → 정책 효과 적용
  → 이벤트 판정
  → 결과 관측
```

---

## 2. Hallucinating Splines — AI+도시 시뮬레이션 레퍼런스

### 아키텍처

```
[micropolisJS 엔진 (headless)] 
    ↕ TypeScript API
[Cloudflare Durable Object (도시별 인스턴스)]
    ↕ REST API + MCP Server
[AI 에이전트 (Claude, GPT 등)]
```

### 핵심 설계 결정
1. **Headless 엔진**: DOM/jQuery 의존성 제거. 순수 시뮬레이션만.
2. **API-first**: `game.placeTool('residential', x, y)` → `game.tick(60)` → `game.getStats()`
3. **Durable Object**: 도시마다 독립 인스턴스 (상태 격리)
4. **MCP Server 지원**: Claude가 직접 도구(tool)로 도시 조작

### AI 에이전트의 한계 (HN 토론에서)
> "LLMs are awful at the spatial stuff... A little like dealing with a toddler"

- AI는 공간 배치에 약함 (건물을 랜덤하게 흩뿌림)
- 전력선, 도로 연결 같은 연결 문제에 취약
- **하지만** 전략적 의사결정, 예산 배분에는 강함

**우리 프로젝트 시사점**: 
- AI 마포구청장은 타일 배치가 아닌 **동 단위 정책 결정** → AI의 약점(공간) 회피, 강점(분석) 활용
- API-first 설계는 그대로 채용 가능
- 우리도 headless 엔진 + 채팅 인터페이스 구조

---

## 3. LinCity-NG — 자원 흐름 모델

### SimCity와의 차이점
- SimCity: **셀 오토마타** (인접 셀 영향, 오버레이 스무딩)
- LinCity: **자원 흐름** (원자재→공장→상품→시장→소비)

### 시뮬레이션 요소
```
인구, 고용, 수자원, 생태
상품 (생산, 유통, 소비)
원자재 (석탄, 철강, 광석)
서비스 (교육, 보건, 소방, 여가)
에너지 (전기, 태양광, 풍력)
재정, 오염, 교통
```

**우리 프로젝트 시사점**: LinCity의 자원 흐름 모델이 우리 "동 간 파급효과"와 유사:
- 서교동 관광객 → 합정동/연남동으로 "유출"
- 상암동 직장인 → 공덕동/성산동 주거 수요
- 임대료 압력의 전파 (서교→합정→망원)

---

## 4. Citybound — 개별 에이전트 모델

### 급진적 접근
- **모든 가구를 개별 시뮬레이션** (가족, 기업 각각)
- 각 가구가 자원 인벤토리 유지 (식료품, 원자재, 돈, 수면, 건강...)
- 경제 패턴이 **개별 상호작용에서 창발(emergent)**
- Actor 시스템 (Rust): 메시지 패싱, 캐시 최적화

### 교통 모델
- 가구가 "거래 파트너"를 찾을 때 **가격+품질+교통 접근성** 고려
- 교통 조건이 직접적으로 상권 매력에 영향

**우리 프로젝트 시사점**: 
- 개별 에이전트 모델은 우리 규모에 과도 (16개 동, 브라우저 실행)
- 하지만 **교통 접근성 → 상권 매력** 개념은 채용
- 이미 수치 설계에 `교통접근성` 가중치(20%) 반영됨

---

## 5. 우리 프로젝트에 대한 아키텍처 결론

### 5.1 채택할 패턴

| 패턴 | 출처 | 적용 방식 |
|------|------|----------|
| **엔진-UI 완전 분리** | Micropolis 전체 | `SimEngine` ↔ `EventBus` ↔ `UI/AI` |
| **Observer/Listener** | MicropolisJ | 엔진이 이벤트 발행, UI+AI가 구독 |
| **Headless 엔진** | Hallucinating Splines | AI 자문관이 API로 상태 조회 |
| **Census-Budget 주기** | Micropolis | 매 턴: 집계→예산→정책→결과 |
| **오버레이 맵 (동 단위)** | Micropolis | 16개 동 × N개 지표 배열 |
| **되먹임 루프** | SimCity RCI | 관광-세수 루프, 임대료-이탈 루프 |
| **자원 흐름 전파** | LinCity-NG | 동 간 파급효과 (인접 행렬) |

### 5.2 채택하지 않을 패턴

| 패턴 | 이유 |
|------|------|
| **타일 기반 맵** | 우리는 동 단위. 120×100 그리드 불필요 |
| **실시간 루프** | 우리는 턴제. animate() 루프 대신 `advanceTurn()` |
| **개별 에이전트** | 브라우저 성능 한계, 16개 동 집계 모델로 충분 |
| **스프라이트 시스템** | 차량/헬기 등 시각 오브젝트 불필요 |
| **분할 스캔** | 16개 동이면 매 턴 전체 스캔 가능 |

### 5.3 제안 아키텍처

```
┌─────────────────────────────────────────────┐
│                 Game Shell                   │
│  (턴 진행, 세이브/로드, 리플레이 로그)         │
├─────────────────────────────────────────────┤
│              SimEngine (headless)            │
│  ┌─────────┐ ┌─────────┐ ┌──────────┐      │
│  │ Census  │ │ Budget  │ │ Policy   │      │
│  │ Module  │ │ Module  │ │ Module   │      │
│  └────┬────┘ └────┬────┘ └────┬─────┘      │
│       │           │           │             │
│  ┌────▼───────────▼───────────▼─────┐       │
│  │       District State [16]         │       │
│  │  population, economy, satisfy,    │       │
│  │  environment, safety, rent...     │       │
│  └────┬─────────────────────────────┘       │
│       │                                     │
│  ┌────▼────┐ ┌─────────┐ ┌──────────┐      │
│  │Adjacency│ │ Event   │ │ Pledge   │      │
│  │ Matrix  │ │ System  │ │ Tracker  │      │
│  └─────────┘ └─────────┘ └──────────┘      │
├─────────────────────────────────────────────┤
│              EventBus (Observer)             │
├──────────┬──────────────────┬───────────────┤
│   Map UI │  Dashboard UI    │  AI Advisor   │
│ (Canvas) │ (Charts/Tables)  │ (Chat Panel)  │
└──────────┴──────────────────┴───────────────┘
```

### 5.4 턴 실행 순서 (Micropolis animate() 대응)

```javascript
function advanceTurn(playerActions) {
    // Phase 1: 플레이어 액션 적용
    applyBudgetAllocation(playerActions.budget);
    applyPolicies(playerActions.policies);
    
    // Phase 2: 시뮬레이션 (Micropolis의 simulate() 대응)
    for (each district) {
        updatePopulation(district);     // 인구 증감
        updateEconomy(district);        // 경제 (사업체, 매출)
        updateLivingPopulation(district); // 생활인구 변동
        updateRentPressure(district);   // 임대료 압력
        updateSatisfaction(district);   // 만족도 재계산
    }
    
    // Phase 3: 동 간 파급 (LinCity 자원 흐름 + Micropolis 스무딩)
    propagateEffects(adjacencyMatrix);  // 인접 동 영향 전파
    
    // Phase 4: 전역 업데이트
    collectTax();                       // 세수 계산
    evaluateCity();                     // 도시 평가 (CityEval 대응)
    checkPledgeProgress();              // 공약 달성률
    
    // Phase 5: 이벤트 (Micropolis Disaster 대응)
    const events = rollEvents(currentState);
    applyEvents(events);
    
    // Phase 6: 기록
    recordHistory(turnNumber, snapshot);
    
    // Phase 7: 통지
    eventBus.emit('turnComplete', { state, events, evaluation });
}
```

### 5.5 AI 자문관 연동 (Hallucinating Splines 참고)

```
Hallucinating Splines:  AI → REST API → placeTool() → tick()
우리 프로젝트:          AI ← EventBus ← advanceTurn() 결과
                        AI → 분석/제안 → 채팅 패널 표시
                        (AI는 행동하지 않음, 분석만 함)
```

차이점: Hallucinating Splines에서 AI가 직접 도시를 조작하지만,
우리 프로젝트에서 AI는 **자문관** — 관측하고 분석만 한다. 행동은 플레이어.

AI에게 제공할 정보 (Fog of Formulas):
```javascript
// AI가 받는 것 (SimEngine의 관측 가능 데이터)
const advisorView = {
    districts: districtStates.map(d => ({
        name: d.name,
        population: d.population,
        livingPop: d.livingPopulation,
        satisfaction: d.satisfaction,  // 정확한 수치
        economyTrend: d.economyDelta,  // "상승/하락/정체"
        topIssue: d.topProblem,        // "임대료" / "교통" 등
    })),
    budget: { revenue, expenses, balance },
    pledges: pledgeProgress,
    turn: currentTurn,
    recentEvents: lastEvents,
};

// AI가 받지 않는 것
// - 내부 수식 계수 (rentPressureCoeff 등)
// - 난수 시드
// - 다음 턴 이벤트 확률
// - 정확한 파급효과 행렬 가중치
```

---

## 6. 추가 데이터 제안 (Buddy 요청용)

리서치를 통해 확인된, 게임 품질을 높일 수 있는 추가 데이터:

### P1 (중요 — 핵심 메카닉에 영향)
1. **부동산/임대료 데이터** — 동별 상가 임대료 or 공시지가
   - 용도: 젠트리피케이션 임계값 설정
   - 출처: 국토부 실거래가 API, 서울부동산정보광장

### P2 (있으면 좋음 — 초기값 차등화)
2. **공원/녹지 면적** — 동별
   - 용도: 환경 만족도 초기값 (월드컵공원, 경의선숲길)
   - 출처: 서울 공원 데이터, 마포구 통계연보

3. **문화시설 목록** — 도서관, 공연장, 갤러리
   - 용도: 문화 만족도, 관광매력 초기값
   - 출처: 마포구 열린데이터

---

## 참고 링크

- MicropolisJ (Java): https://github.com/SimHacker/micropolis (micropolis-java/)
- micropolisJS (JS): https://github.com/graememcc/micropolisJS
- MicropolisCore (C++/WASM): https://github.com/SimHacker/MicropolisCore
- Hallucinating Splines (AI+Micropolis): https://github.com/andrewedunn/hallucinating-splines
- LinCity-NG: https://github.com/lincity-ng/lincity-ng
- Citybound: https://aeplay.org/citybound
- Divercity (MicropolisJ 확장): https://github.com/Team--Rocket/divercity
- Methapolis API 문서: http://metha-gruppe.github.io/methapolis-java/doc/
