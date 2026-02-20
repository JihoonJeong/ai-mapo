# Re: AI 자문관 아키텍처 결정 (수정)

> **To**: Cody  
> **From**: Luca  
> **Date**: 2026-02-20  
> **Status**: JJ 확인 완료. 아래대로 진행.

---

## 결정: E — 정적 사이트 + GitHub Pages 배포 + MCP App 트랙 병행

A(로컬 서버)도 B(Ollama only)도 아니다. Gemini/OpenAI 서버 프록시는 버린다.

### 핵심 판단

1. **ai-mapo는 ai-three-kingdoms과 다르다.** 빌드 없는 순수 HTML/JS이고, Claude API는 브라우저 직접 호출이 된다. 서버가 필요 없다.
2. **Gemini 지원은 드롭한다.** Phase 1에서 프로바이더를 늘리는 건 우선순위가 아니다.
3. **MCP App이 진짜 목표다.** 사용자 API 키도 필요 없고, Claude/ChatGPT 구독만으로 AI 자문관이 동작한다. 이게 이 프로젝트의 최종 배포 형태.

### 로드맵

| Phase | 배포 | AI 백엔드 | 비용 부담 |
|-------|------|----------|----------|
| **1 (지금)** | GitHub Pages | Mock + Claude API(사용자 키) + Ollama(로컬) | 사용자 |
| **1.5 (다음)** | MCP App (Claude.ai/ChatGPT 안) | 호스트 AI가 직접 자문관 | 사용자 구독 |
| **2 (나중)** | MCP App 메인 + standalone 유지 | Four-Shell 크로스 호스트 비교 | 사용자 구독 |

---

## Phase 1 상세 — GitHub Pages 배포

### 아키텍처

```
GitHub Pages (정적 호스팅)
  ├── index.html + CSS + JS (ES Modules)
  ├── Chart.js (CDN)
  ├── data/game/*.json
  └── js/advisor.js
        ├── Mock        — API 없이 규칙 기반 응답 (기본값)
        ├── Claude API  — 브라우저 직접 호출 (사용자 키, anthropic-dangerous-direct-browser-access)
        └── Ollama      — localhost:11434 직접 호출 (사용자 로컬)
```

서버 없음. 빌드 없음. repo 그대로 배포.

### 사용자 시나리오

| 사용자 | 설정 | 결과 |
|--------|------|------|
| 그냥 방문 | 없음 | Mock 자문관으로 플레이 |
| Claude API 키 보유 | 설정에서 키 입력 | Claude 자문관 (비용: 게임당 ~$0.01) |
| Ollama 설치됨 | 설정에서 Ollama 선택 | 무료 로컬 AI 자문관 |

### AI_BACKENDS (최종)

```javascript
const AI_BACKENDS = {
  mock:      { name: 'Mock (기본)',      call: mockCall },
  anthropic: { name: 'Claude API',       call: anthropicCall },
  ollama:    { name: 'Ollama (로컬)',    call: ollamaCall },
};
```

서버 모드, 자동 감지 로직 **불필요**. 깔끔하게 3개만.

### Ollama 구현

```javascript
async function ollamaCall(messages) {
  const ollamaUrl = localStorage.getItem('ai-mapo-ollama-url') || 'http://localhost:11434';
  const ollamaModel = localStorage.getItem('ai-mapo-ollama-model') || 'llama3.1:8b';

  const systemMsg = messages.find(m => m.role === 'system');
  const otherMsgs = messages.filter(m => m.role !== 'system');

  const response = await fetch(`${ollamaUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: ollamaModel,
      messages: [
        { role: 'system', content: systemMsg?.content || SYSTEM_PROMPT },
        ...otherMsgs,
      ],
      stream: false,
    }),
  });

  if (!response.ok) throw new Error(`Ollama error ${response.status}`);
  const data = await response.json();
  return data.message?.content || '';
}
```

Ollama는 기본적으로 CORS를 허용하므로 브라우저에서 직접 호출 가능.

### 설정 UI 수정

현재 Claude API만 있는 설정 모달을 3개 백엔드로 확장:

```
┌─────────────────────────────┐
│    AI 자문관 설정            │
├─────────────────────────────┤
│ ○ Mock (기본)               │
│   AI 없이 규칙 기반 응답     │
│                             │
│ ○ Claude API                │
│   [sk-ant-api03-...      ]  │
│   비용: 게임당 ~$0.01       │
│                             │
│ ○ Ollama (로컬)             │
│   URL: [http://localhost:11434] │
│   모델: [llama3.1:8b     ]  │
│   무료, Ollama 설치 필요     │
├─────────────────────────────┤
│ [저장]  [취소]              │
└─────────────────────────────┘
```

### GitHub Pages 배포

```bash
# repo 설정 → Settings → Pages → Source: main branch, / (root)
# 끝. 별도 빌드 불필요.
```

URL: `https://jihoonjeong.github.io/ai-mapo/`

---

## Phase 1.5 — MCP App 프로토타입 (Phase 1 완료 후)

### MCP App이란

MCP Apps는 2026년 1월 출시된 MCP 확장. tool call이 텍스트 대신 **interactive UI(iframe)**를 반환할 수 있다. Claude.ai, ChatGPT, VS Code, Goose에서 지원.

### ai-mapo에 적용하면

```
[현재 — standalone]
브라우저 → 게임 UI → advisor.js → Claude API(사용자 키) → 응답 표시

[MCP App]
Claude.ai 채팅 → MCP tool call → 게임 UI (iframe) → Claude가 직접 자문관 역할
                                                      ↑ 사용자 Claude 구독으로 비용 해결
```

- API 키 **불필요** (사용자의 Claude Pro/Max 구독)
- 서버 **불필요** (MCP 서버가 UI 리소스 제공)
- advisor.js의 API 호출 코드 **불필요** (호스트 AI가 직접 응답)
- 같은 게임을 ChatGPT에서 돌리면 GPT가 자문관 → **Four-Shell Core 비교**

### 검증 필요 사항

MCP App 출시 1개월. 게임 수준 UI를 넣은 사례가 거의 없을 것. 확인할 것:

- [ ] iframe 안에서 SVG 맵 렌더링 가능한가
- [ ] Chart.js(CDN) 로드 가능한가
- [ ] iframe 크기 제약 (게임 4분할 레이아웃이 들어가는가)
- [ ] 로컬 스토리지/세이브 가능한가
- [ ] tool call ↔ iframe 양방향 통신 (게임 상태 → AI, AI 응답 → 게임)

Phase 1 게임 코드를 최대한 재활용하되, AI 연동 레이어만 MCP tool call로 교체하는 구조.

---

## 구현 체크리스트

### Phase 1 (지금)

- [ ] `ollamaCall()` 함수 추가 (위 코드 참조)
- [ ] 설정 UI 3개 백엔드로 확장
- [ ] Ollama URL/모델 localStorage 저장
- [ ] GitHub Pages 배포 설정
- [ ] README.md 사용법 작성 (Mock / Claude API / Ollama 3가지)

### Phase 1.5 (다음)

- [ ] MCP App 스펙 리서치 + 프로토타입
- [ ] 게임 UI를 MCP App iframe에 올리는 실험
- [ ] tool call로 게임 상태 ↔ AI 통신 구조 설계

### 드롭

- ~~서버 모드 (Hono, Node.js)~~ → 불필요
- ~~Gemini 지원~~ → 드롭
- ~~OpenAI API 직접 호출~~ → MCP App에서 ChatGPT 호스트로 대체
- ~~서버 자동 감지 (detectServer)~~ → 불필요

---

## 파일 영향

| 파일 | 수정 | Phase |
|------|------|-------|
| js/advisor.js | `ollamaCall()` 추가 + 설정 UI 확장 | 1 |
| README.md | 사용법, GitHub Pages URL | 1 |
| (신규) MCP App 관련 | 별도 브랜치에서 실험 | 1.5 |
