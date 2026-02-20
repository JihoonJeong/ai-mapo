# Re: AI 자문관 아키텍처 결정 (v3 — 최종)

> **To**: Cody  
> **From**: Luca  
> **Date**: 2026-02-20  
> **Status**: JJ 확인 완료. 아래대로 진행.

---

## 결정 요약

1. **Phase 1**: standalone 웹앱, GitHub Pages 배포. 자문관 = 분석만. ← 지금 여기
2. **Phase 1.5a**: Headless 시뮬레이션 모드 (AI 자동 플레이, 배치 실험)
3. **Phase 1.5b**: MCP App 프로토타입 (Claude.ai/ChatGPT 안에서 동작)
4. **Phase 2**: 블록 레벨 줌인 (96개 구획 활용, 행동 공간 확대)

서버 없음. Gemini 드롭.

---

## Phase 1 — standalone 웹앱 (현재, 거의 완료)

### 아키텍처

```
GitHub Pages (정적 호스팅)
  ├── index.html + CSS + JS (ES Modules)
  ├── Chart.js (CDN)
  ├── data/game/*.json
  └── js/advisor.js
        ├── Mock        — 규칙 기반 응답 (기본값)
        ├── Claude API  — 브라우저 직접 호출 (사용자 키)
        ├── OpenAI API  — 브라우저 직접 호출 (사용자 키)
        └── Ollama      — localhost:11434 직접 호출
```

### 자문관 역할 (Phase 1)

**하는 것:** 브리핑, 분석 응답, 이벤트 트레이드오프 분석, 퀵버튼
**안 하는 것:** 예산 조정, 정책 선택, 이벤트 대응, 턴 종료

→ Phase 1에서는 의도적으로 "분석만". 플레이어가 직접 조작하는 재미 보존.

### 남은 작업

- [ ] Ollama 백엔드 (`ollamaCall()`)
- [ ] 설정 UI 확장 (Mock / Claude / OpenAI / Ollama)
- [ ] GitHub Pages 배포
- [ ] README.md (사용법 3가지)

---

## Phase 1.5a — Headless 시뮬레이션 모드

### 목적

ai-three-kingdoms에서 260+ 게임 배치 실험으로 발견한 것들:
- Core(모델)보다 Soft Shell(ICL)이 결정적
- 비싼 모델 ≠ 좋은 성과
- 8B 모델의 instruction following 병목
- C등급 천장 → 커리큘럼 학습으로 돌파

ai-mapo에서 같은 실험을 하되, **더 풍부한 결과 공간**:
- ai-three-kingdoms: 승/패, 등급 (1차원)
- ai-mapo: 6개 KPI + 공약 달성률 + 동별 지표 (다차원)

### 핵심 요구: 자문관이 행동해야 한다

headless 모드에서는 AI가 매 턴 전체 의사결정을 한다:
- 예산 배분 (7개 카테고리 비율)
- 정책 선택/해제 (최대 3개)
- 이벤트 선택지 결정
- 턴 종료

→ `autoPlay()` 함수가 AI 응답을 파싱해서 게임 상태에 반영.

### 아키텍처

```
headless 모드 (Node.js CLI)
  ├── 게임 엔진 (simulation.js 등 — 브라우저 코드 재활용)
  ├── AI 호출 (advisor.js의 callAI 로직)
  ├── 행동 파서 (AI 응답 → 구조화된 행동)
  └── 결과 로거 (턴별 상태 + 최종 점수 JSON)
```

### AI 행동 포맷

AI에게 브리핑 컨텍스트와 함께 행동을 요청:

```
{turnContext}

이번 분기 행동을 결정하세요. 아래 JSON 형식으로 응답하세요:

{
  "reasoning": "이번 분기 판단 근거 (2~3문장)",
  "budget": {
    "economy": 20, "transport": 15, "culture": 10,
    "environment": 15, "education": 15, "welfare": 15, "renewal": 10
  },
  "policies": {
    "activate": ["econ_startup_hub"],
    "deactivate": []
  },
  "eventChoice": "choice_b"
}

규칙:
- budget 합계 = 100
- 정책은 최대 3개 동시 활성 (현재 활성: {activePolicies})
- eventChoice는 현재 이벤트가 있을 때만 (선택지: {choices})
```

### 배치 실행

```bash
node sim/run-batch.js --model claude-sonnet --runs 20 --difficulty normal
node sim/run-batch.js --model gpt-4o-mini --runs 20 --difficulty normal
node sim/run-batch.js --model ollama:llama3.1:8b --runs 20 --difficulty easy
```

### 결과 JSON

```json
{
  "model": "claude-sonnet-4-20250514",
  "difficulty": "normal",
  "finalGrade": "B",
  "totalScore": 72,
  "kpis": {
    "population": { "score": 12, "max": 15, "detail": "+1.2%" },
    "economy": { "score": 8, "max": 10, "detail": "+3.5%" },
    "...": "..."
  },
  "pledges": [
    { "name": "관광 상생", "achieved": true, "progress": 100 }
  ],
  "turnLog": [
    {
      "turn": 1,
      "aiAction": { "budget": {...}, "policies": {...} },
      "stateSnapshot": { "totalPop": 356000, "avgSat": 62, "..." }
    }
  ],
  "cost": 0.15,
  "duration": "4m 23s"
}
```

### 실험 설계 (ai-three-kingdoms 패턴 계승)

| 실험 | 독립변수 | 종속변수 |
|------|---------|---------|
| 모델 비교 | Claude/GPT/Ollama × 난이도 | 등급, KPI, 정책 선택 패턴 |
| ICL 효과 | seed 경험 주입 유무 | 등급 향상폭 |
| Coaching 효과 | 전략 가이드 유무 | 등급 변화 (개선 or 퇴보?) |
| 행동 분석 | 모델별 | 예산 배분 패턴, 정책 선호, 위험 회피도 |
| 공약 전략 | 모델별 | 어떤 공약을 고르고 어떻게 달성하는가 |

ai-three-kingdoms과의 차이:
- **결과가 다차원**: 승/패가 아니라 6개 KPI + 공약. "경제는 잘했는데 환경은 무시" 같은 프로필 비교 가능
- **행동이 풍부**: 15 액션이 아니라 예산 7개 + 정책 28개 + 이벤트. "모델별 정책 선호" 분석 가능
- **48턴**: 장기 계획 능력 테스트. 초반 투자 → 중반 전환 → 후반 수확 패턴이 나오는가?

### 구현 우선순위

1. 게임 엔진을 Node.js에서 돌릴 수 있게 분리 (DOM 의존 제거)
2. AI 행동 프롬프트 + 파서
3. 배치 실행 스크립트
4. 결과 로거

이건 **MCP App보다 먼저 할 수 있다** — 기존 코드에 headless 래퍼를 씌우는 작업이라 새 스펙을 배울 필요 없음.

---

## Phase 1.5b — MCP App 프로토타입

### MCP App이란

2026년 1월 출시. MCP 확장으로 tool call이 interactive UI(iframe)를 반환. Claude.ai, ChatGPT, VS Code, Goose 지원. Anthropic + OpenAI 공동 스펙.

### ai-mapo에 적용하면

```
Claude.ai/ChatGPT 채팅
  → MCP tool call
  → 게임 UI (iframe: SVG 맵 + 대시보드 + 액션 패널)
  → 사용자 조작 or 자연어 명령
  → AI가 직접 자문관 역할 (호스트 AI = 자문관)
```

- API 키 불필요 (사용자 구독으로 비용 해결)
- 같은 MCP App을 Claude에서 돌리면 Claude Core, ChatGPT에서 돌리면 GPT Core → **Four-Shell 크로스 호스트 비교**

### 자문관 역할 확장 (MCP App에서)

MCP App에서는 채팅이 메인 인터페이스. 자연어 명령이 자연스럽다:
- "교통 예산 좀 올려줘" → tool call로 슬라이더 조정
- "연남동 임대료 정책 실행해" → tool call로 정책 활성화
- "축제 확대로 가자" → tool call로 이벤트 선택

Phase 1의 "SimCity" (직접 조작) vs Phase 1.5b의 "비서에게 지시" (대화 조작)
→ 두 모드 다 유지. 같은 게임, 다른 인터랙션.

### 검증 필요 사항

- [ ] iframe에서 SVG 맵 + Chart.js 동작 여부
- [ ] iframe 크기 제약 (4분할 레이아웃)
- [ ] tool call ↔ iframe 양방향 통신
- [ ] 로컬 스토리지/세이브

### 1.5a(headless)를 먼저 하는 이유

- headless는 기존 코드 + Node.js 래퍼. 기술 리스크 낮음.
- MCP App은 새 스펙 학습 + iframe 제약 테스트. 기술 리스크 높음.
- headless에서 나온 AI 행동 파서, 프롬프트가 MCP App에서도 재활용됨.
- headless 실험 데이터가 ai-ludens 연구 결과로 바로 쓰임.

---

## Phase 2 — 블록 레벨 줌인 (구상)

### 현재: 동 단위 (16개)

정책이 "구 전체" 또는 "서교동"처럼 동 단위로 적용.

### Phase 2: 블록 단위 (96개 구획)

`mapo_blocks.json`에 이미 96개 구획 데이터가 있다. 줌인하면:
- 연남동 5개 블록 중 "경의선숲길 옆 상업 블록"에만 임대료 안정화 적용
- 서교동 7개 블록 중 "홍대입구역 주변"에만 야간경제 정책
- 성산2동 "성미산 자락" 블록에 도시숲 조성

**SimCity 느낌:** "여기에 공원 짓고, 저기에 상가 유치하고"가 가능해진다.

### 행동 공간 확대

| | Phase 1 (동 단위) | Phase 2 (블록 단위) |
|---|---|---|
| 단위 | 16개 동 | 96개 블록 |
| 정책 타겟 | "서교동" | "서교동 B3 블록" |
| 시각화 | 동별 색상 | 블록별 색상 + 줌인/아웃 |
| 행동 수 | 예산 7 + 정책 28 | 예산 7 + 정책 28 + 블록 액션 N개 |

### headless 실험에서의 의미

블록 단위가 되면 행동 공간이 폭발적으로 커진다.
→ "모델이 세밀한 공간 추론을 할 수 있는가?" 테스트 가능.
→ ai-three-kingdoms의 "2단계 병참" 실패와 유사한 병목이 발견될 수 있음.

### Phase 2는 실험 데이터 보고 결정

동 단위에서도 실험할 게 충분하다. 블록 확장은 Phase 1.5 실험 결과를 보고 판단.

---

## 전체 로드맵

```
Phase 1 (지금)
  ├── standalone 웹앱 완성
  ├── Mock / Claude / OpenAI / Ollama
  ├── GitHub Pages 배포
  └── 사람이 플레이 → "AI 자문관이 재밌는가?" 검증

Phase 1.5a (다음)
  ├── Headless 시뮬레이션 모드
  ├── AI 행동 프롬프트 + 파서
  ├── 배치 실험 (모델별 × 난이도별)
  └── 실험 결과 → ai-ludens 연구 데이터

Phase 1.5b (그 다음)
  ├── MCP App 프로토타입
  ├── 게임 UI iframe 실험
  ├── 자문관 행동 확장 (자연어 명령)
  └── Claude ↔ ChatGPT 크로스 호스트 비교

Phase 2 (나중)
  ├── 블록 레벨 줌인 (96개 구획)
  ├── 행동 공간 확대
  └── "세밀한 공간 추론" 실험
```

---

## Cody 즉시 액션

**Phase 1 마무리:**
- [ ] Ollama 백엔드 추가
- [ ] 설정 UI 4개 백엔드
- [ ] GitHub Pages 배포
- [ ] README.md

**Phase 1 완료 후 → Phase 1.5a 착수:**
- [ ] 게임 엔진 DOM 의존 분리 (Node.js 호환)
- [ ] AI 행동 프롬프트 설계 (위 JSON 포맷)
- [ ] 행동 파서 (JSON 파싱 + 유효성 검증 + fallback)
- [ ] `sim/run-batch.js` 배치 실행 스크립트
- [ ] 결과 로거 (JSON)

자문관 역할 확장(행동 가능)은 **Phase 1.5a에서 headless 모드로 먼저 구현**. Phase 1 GUI에는 적용하지 않음.
