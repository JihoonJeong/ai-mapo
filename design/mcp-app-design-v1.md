# Phase 1.5b — MCP App 설계

> **Author**: Luca  
> **Date**: 2026-02-20  
> **Status**: 설계 완료. Cody 구현용.

---

## 개요

AI 마포구청장 게임을 MCP App으로 만들어서 Claude.ai, ChatGPT, VS Code 등 MCP 호스트 안에서 직접 플레이할 수 있게 한다.

**핵심 변화: AI 자문관이 별도 API 호출이 아니라, 호스트 AI 자체가 자문관이 된다.**

```
[standalone — 현재]
브라우저 → 게임 UI → advisor.js → Claude API(사용자 키) → 응답

[MCP App — Phase 1.5b]
Claude.ai 채팅 → "마포구청장 게임 시작해줘" → MCP tool call
  → 게임 UI (sandboxed iframe) ← → MCP Server (게임 엔진)
  → Claude가 직접 자문관 역할 (사용자 구독으로 비용)
```

---

## MCP Apps 아키텍처 요약

### 동작 원리

```
1. MCP Server가 tool + UI resource를 등록
2. 호스트 AI가 tool을 호출
3. 호스트가 UI resource(HTML)를 iframe으로 렌더링
4. iframe ↔ 호스트 간 양방향 통신 (JSON-RPC over postMessage)
5. iframe이 서버 tool을 호출 가능 (app.callServerTool)
6. 서버가 iframe에 데이터 push 가능 (notifications)
```

### 핵심 구성요소

| 구성요소 | 역할 | 우리 프로젝트 |
|----------|------|--------------|
| MCP Server | tool 등록 + 게임 로직 | Node.js, 게임 엔진 (headless 코드 재활용) |
| UI Resource | HTML (single file, iframe) | 기존 게임 UI를 Vite로 번들 |
| Host | AI + UI 렌더링 | Claude.ai, ChatGPT, VS Code |
| App SDK | iframe ↔ host 통신 | `@modelcontextprotocol/ext-apps` |

### 참고 예제

- **budget-allocator-server**: 슬라이더로 예산 배분 + Chart.js 도넛 차트. 우리 예산 패널과 거의 동일.
- **map-server**: CesiumJS 인터랙티브 맵. 우리 SVG 맵과 유사.
- **scenario-modeler-server**: 시나리오 비교. 우리 정책 효과 비교와 유사.

---

## ai-mapo MCP App 설계

### 아키텍처

```
ai-mapo-mcp/
├── server.ts          ← MCP Server (tool + resource 등록)
├── main.ts            ← 진입점 (stdio / HTTP)
├── engine/            ← 게임 엔진 (headless에서 가져옴)
│   ├── game-state.ts  
│   ├── simulation.ts  ← population, economy, finance, satisfaction
│   ├── policy.ts
│   └── event.ts
├── tools/             ← MCP tool 정의
│   ├── game-tools.ts  ← start_game, advance_turn, get_state
│   ├── action-tools.ts ← set_budget, activate_policy, choose_event
│   └── query-tools.ts  ← get_district_detail, compare_districts
├── mcp-app.html       ← UI 진입점
├── src/               ← UI 코드
│   ├── app.ts         ← App SDK 연결 + tool result 핸들링
│   ├── map.ts         ← SVG 맵 (기존 코드)
│   ├── dashboard.ts   ← Chart.js 대시보드 (기존 코드)
│   ├── budget.ts      ← 예산 슬라이더 (기존 코드)
│   ├── policy.ts      ← 정책 카드 (기존 코드)
│   └── event.ts       ← 이벤트 모달 (기존 코드)
├── vite.config.ts     ← single-file 번들 설정
├── package.json
└── tsconfig.json
```

### MCP Tools

#### 게임 흐름

| Tool | 설명 | 호출 주체 |
|------|------|----------|
| `start_game` | 공약 선택 → 게임 초기화 → 첫 상태 반환 | AI (호스트) |
| `advance_turn` | 턴 진행 → 시뮬레이션 실행 → 결과 반환 | UI (iframe) |
| `get_state` | 현재 게임 상태 전체 반환 | AI 또는 UI |
| `end_game` | 게임 종료 → 최종 점수 계산 | UI |

#### 플레이어 행동 (UI → Server)

| Tool | 설명 | 입력 |
|------|------|------|
| `set_budget` | 예산 배분 설정 | `{ economy: 20, transport: 15, ... }` (합계 100) |
| `activate_policy` | 정책 활성화 | `{ policyId: "econ_startup_hub" }` |
| `deactivate_policy` | 정책 해제 | `{ policyId: "econ_startup_hub" }` |
| `choose_event_option` | 이벤트 선택지 결정 | `{ eventId: "...", choiceId: "choice_a" }` |

#### 조회 (AI가 분석용으로 호출)

| Tool | 설명 | 반환 |
|------|------|------|
| `get_district_detail` | 특정 동 상세 데이터 | 인구, 사업체, 만족도, 추세 |
| `compare_districts` | 동 간 비교 | 2~3개 동의 KPI 비교표 |
| `get_budget_impact` | 예산 배분 시뮬레이션 | "이렇게 배분하면 예상 효과는..." |
| `get_policy_catalog` | 활성화 가능 정책 목록 | 카테고리별 정책 + 비용 + 효과 |

### 플레이 흐름

```
사용자: "마포구청장 게임 시작하고 싶어"

Claude/ChatGPT: [start_game tool 호출]
  → 게임 UI가 iframe으로 렌더링
  → Claude: "구청장님, 취임을 축하합니다. 마포구의 현 상황을 브리핑하겠습니다..."
  → Claude가 get_state 호출해서 데이터 분석
  → 브리핑 제공

사용자가 UI에서 예산 조정:
  → iframe이 set_budget tool 호출 → 서버 게임 상태 업데이트
  → UI에 실시간 반영

사용자: "연남동 상황이 어때?"
  → Claude가 get_district_detail("연남동") 호출
  → 데이터 기반 분석 제공

사용자가 UI에서 "턴 종료" 클릭:
  → iframe이 advance_turn tool 호출
  → 시뮬레이션 실행, 이벤트 발생 가능
  → Claude가 결과를 보고 다음 브리핑 제공

이벤트 발생 시:
  → UI에 이벤트 모달 표시
  → 사용자가 선택지 클릭 → choose_event_option tool 호출
  → Claude: "좋은 선택입니다. 다만 임대료 상승 리스크가..."
```

### AI 자문관 역할의 변화

| | standalone (Phase 1) | MCP App (Phase 1.5b) |
|---|---|---|
| AI 호출 | advisor.js → API | 호스트 AI가 직접 |
| 프롬프트 | 시스템 프롬프트 고정 | 호스트 AI의 자체 맥락 |
| 행동 | 분석만 | 분석 + tool 호출로 행동 가능 |
| 대화 | 채팅 패널 (게임 UI 내) | 호스트 채팅 (게임 UI 외) |
| 비용 | 사용자 API 키 | 사용자 구독 |

**중요**: MCP App에서는 시스템 프롬프트를 직접 제어하지 못한다. 호스트 AI가 tool 설명(description)과 tool 결과를 보고 자율적으로 자문관 역할을 해야 한다.

→ tool description이 "프롬프트" 역할을 한다. `start_game`의 description에 "당신은 마포구 도시계획 자문관입니다"를 넣는 게 아니라, tool 결과에 게임 맥락을 풍부하게 담아서 AI가 자연스럽게 자문관처럼 행동하게 유도.

### tool 결과에 컨텍스트 담기

```javascript
// advance_turn tool 결과 예시
{
  content: [{
    type: "text",
    text: `## 2025년 2분기 결과

### 주요 변화
- 인구: 355,200명 (-0.3%), 서교동·합정동에서 유출 지속
- 경제: 사업체 12,450개 (-1.2%), 임대료 상승 영향
- 만족도: 평균 68 → 71, 교통 투자 효과
- 세수: 412억원 (-2.1%)

### 이벤트 발생
홍대 축제 확대 제안 — 관광 수입 증가 vs 주민 소음 민원
선택지: A) 축제 확대, B) 현행 유지, C) 축소 + 주민보상

### 공약 진척
- 관광 상생: 45% (정상 궤도)
- 인구 반등: 23% (위험, 집중 필요)

### 활성 정책: 청년주택 공급, 전통시장 현대화
### 잔여 예산: 89억원

[자문관에게 분석을 요청하거나, UI에서 다음 행동을 선택하세요]`
  }]
}
```

이렇게 하면 호스트 AI가 자연스럽게 "인구 반등이 위험 수준입니다, 복지·경제 예산을 늘리는 것을 고려해보세요" 같은 자문을 한다.

---

## 기존 코드 재활용 전략

### 재활용 가능 (수정 최소)

| 기존 파일 | 역할 | MCP App에서 |
|-----------|------|------------|
| sim/headless-game.mjs | 게임 엔진 루프 | server의 engine/ 기반 |
| sim/sim-advisor.mjs | AI 행동 파서 | query-tools의 응답 포맷 |
| data/game/*.json | 초기 데이터 | 그대로 사용 |
| policies.json, events.json | 정책·이벤트 데이터 | 그대로 사용 |

### 재작성 필요

| 부분 | 이유 |
|------|------|
| UI ↔ 서버 통신 | DOM 직접 조작 → App SDK tool call로 변경 |
| advisor.js | API 호출 → 불필요 (호스트 AI가 직접) |
| main.js (게임 루프) | 브라우저 상태 관리 → 서버 상태 관리로 이동 |
| UI 번들링 | 여러 JS 파일 → Vite single-file 번들 |

### 가장 많이 재활용되는 것

**게임 엔진** (시뮬레이션 수식). headless 모드에서 이미 DOM 독립으로 분리되어 있다. 이게 MCP Server의 핵심.

**UI 컴포넌트** (SVG 맵, Chart.js, 슬라이더). 렌더링 코드 자체는 유지, 데이터 소스만 tool call로 변경.

---

## 기술 제약 및 리스크

### 확인된 것

- ✅ Chart.js는 MCP App iframe에서 동작 (budget-allocator-server가 사용)
- ✅ 인터랙티브 슬라이더 가능 (budget-allocator-server)
- ✅ Vanilla JS로 만들 수 있음 (basic-server-vanillajs 예제)
- ✅ `app.callServerTool()`로 UI→서버 tool 호출 가능
- ✅ `app.ontoolresult`로 서버→UI 데이터 수신 가능
- ✅ stdio 트랜스포트 (Claude Desktop) + HTTP 트랜스포트 둘 다 지원
- ✅ `npx` 원라이너로 설치 가능 (npm에 publish 시)

### 확인 필요 (프로토타입에서)

- ❓ SVG 맵 (16개 동 인터랙티브) — 예제에 CesiumJS 맵은 있으나 SVG 인라인은 미확인
- ❓ iframe 크기 제약 — 4분할 레이아웃이 들어갈 만큼 충분한가
- ❓ 게임 세이브/로드 — localStorage 미지원 (sandbox). 서버 측 저장 필요
- ❓ 48턴 장시간 세션 — 호스트 연결이 안정적인가
- ❓ 복수 tool 동시 호출 — 예산+정책+턴 종료를 한 턴에 여러 번 호출

### 알려진 제약

- ⚠️ iframe sandbox: localStorage/sessionStorage 미지원 → 모든 상태를 서버에 저장
- ⚠️ 시스템 프롬프트 직접 제어 불가 → tool description + tool result로 우회
- ⚠️ CDN 외부 스크립트 로드 가능 여부 불확실 → Chart.js를 번들에 인라인
- ⚠️ npm에 아직 publish 안 된 SDK (`git+https://github.com/...` 설치)

---

## 프로토타입 범위

### 최소 프로토타입 (먼저)

**목표: "게임 UI가 Claude.ai 안에서 뜨고, 턴을 진행할 수 있다"**

포함:
- `start_game` tool → 게임 초기화 + UI 렌더링
- `advance_turn` tool → 턴 진행
- `get_state` tool → AI가 상태 조회
- UI: 맵 + 기본 대시보드 (만족도, 인구, 재정 수치만)
- 예산 배분은 균등 고정 (슬라이더 없이)

제외:
- 정책 시스템
- 이벤트 시스템
- 공약 시스템
- 세이브/로드

### 풀 구현 (프로토타입 성공 후)

프로토타입이 되면 정책, 이벤트, 공약, 세이브를 순차 추가.

---

## 프로토타입 구현 계획

### Step 1: 환경 세팅

```bash
mkdir ai-mapo-mcp && cd ai-mapo-mcp
npm init -y
npm install @modelcontextprotocol/sdk
npm install -S git+https://github.com/modelcontextprotocol/ext-apps.git
npm install -D typescript vite vite-plugin-singlefile tsx
```

### Step 2: 게임 엔진 포팅

sim/ 디렉토리의 headless 코드를 TypeScript로 정리:
- `engine/game-state.ts` — GameState 타입 + 초기화
- `engine/simulation.ts` — 인구/경제/재정/만족도 계산
- data/*.json 복사

### Step 3: MCP Server + Tools

`server.ts`에 3개 tool 등록:
- `start_game` → GameState 생성, UI resource 반환
- `advance_turn` → simulation 실행, 결과 텍스트 반환
- `get_state` → 현재 상태 JSON 반환

### Step 4: UI 번들

기존 게임 UI에서 맵 + 대시보드만 추출:
- `mcp-app.html` — 단일 HTML
- `src/app.ts` — App SDK 연결
- `src/map.ts` — SVG 맵 렌더링
- `src/dashboard.ts` — 숫자 표시 (Chart.js 없이, 프로토타입)

Vite로 single-file 번들.

### Step 5: Claude Desktop에서 테스트

```json
{
  "mcpServers": {
    "ai-mapo": {
      "command": "bash",
      "args": ["-c", "cd ~/Projects/ai-mapo-mcp && npm run build >&2 && node dist/main.js --stdio"]
    }
  }
}
```

Claude Desktop에서 "마포구청장 게임 시작해줘" → UI가 뜨는지 확인.

### Step 6: 리스크 검증

- [ ] SVG 맵 iframe 렌더링
- [ ] iframe 크기 (4분할 레이아웃)
- [ ] tool call 응답 속도
- [ ] 48턴 연속 세션 안정성

---

## Four-Shell 검증 설계

### MCP App의 Four-Shell 의미

같은 MCP App을 다른 호스트에서 실행하면:

| 호스트 | Core | Hard Shell | 결과 (Phenotype) |
|--------|------|-----------|-----------------|
| Claude.ai | Claude Sonnet | Claude 시스템 프롬프트 | ? |
| ChatGPT | GPT-4o | ChatGPT 시스템 프롬프트 | ? |
| VS Code Copilot | Copilot | VS Code 맥락 | ? |

**동일한 게임 + 동일한 tool description인데, Core가 다르면 자문 스타일이 어떻게 달라지는가?**

이것이 ai-mapo의 Four-Shell 핵심 실험:
- ai-three-kingdoms: 같은 Hard/Soft Shell을 줬을 때 Core별 성과 차이
- ai-mapo MCP App: **같은 도구를 줬을 때** 호스트 AI별 자문 스타일 차이

### 측정 방법

1. 같은 게임 시나리오를 Claude.ai와 ChatGPT에서 각각 플레이
2. AI 자문 내용 비교 (분석 깊이, 추천 성향, 위험 회피도)
3. 동일한 이벤트에 대한 반응 비교
4. (headless 가능하면) 같은 시나리오에서 auto-play 결과 비교

---

## 타임라인

| Step | 작업 | 예상 |
|------|------|------|
| 1 | 환경 세팅 + 게임 엔진 포팅 | 반나절 |
| 2 | MCP Server + 3개 tool | 반나절 |
| 3 | UI 번들 (맵 + 대시보드) | 반나절 |
| 4 | Claude Desktop 테스트 | 2시간 |
| 5 | 리스크 판단 → Go/No-Go | - |
| 6 | (Go면) 정책+이벤트+공약 추가 | 1~2일 |

**Go/No-Go 기준:**
- Go: SVG 맵이 뜨고, 턴 진행이 되고, AI가 자연스럽게 자문한다
- No-Go: iframe 크기 부족, 렌더링 실패, tool call 불안정 → standalone만 유지
