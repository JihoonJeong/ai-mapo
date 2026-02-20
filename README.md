# AI 마포구청장

서울 마포구 16개 동, 357,232명의 구청장이 되어 4년(48턴) 임기를 수행하는 도시경영 시뮬레이션.

AI 자문관이 데이터 기반 분석과 정책 제안을 제공합니다.

**웹 버전:** https://jihoonjeong.github.io/ai-mapo/
**MCP 버전:** Claude Desktop / ChatGPT에서 직접 플레이 (아래 설치 방법 참고)

## 게임 개요

- **예산 배분**: 7개 분야(경제, 교통, 문화, 환경, 교육, 복지, 재생)에 자유예산 배분
- **정책 선택**: 28개 정책 중 최대 3개 동시 운영 (비용, 효과, 딜레이 상이)
- **이벤트 대응**: 랜덤 이벤트 발생 시 선택지별 트레이드오프 판단
- **공약 달성**: 임기 초 선택한 1~4개 공약의 달성도 추적
- **성적표**: 48턴 후 6개 KPI + 공약 달성으로 S~F 등급

## AI 자문관 설정

게임 중 자문관 패널의 모드 표시(Mock/모델명)를 클릭하면 설정 모달이 열립니다.

### Mock (기본)

AI 없이 규칙 기반 응답. 별도 설정 불필요.

### Claude API (Anthropic)

| 항목 | 값 |
|------|---|
| API 키 | `sk-ant-api03-...` |
| 모델 | Sonnet 4.6 (기본), Opus 4.6, Haiku 4.5 |
| 비용 | 게임당 ~$0.01 (Sonnet 기준) |

브라우저에서 Anthropic API를 직접 호출합니다 (`anthropic-dangerous-direct-browser-access`).

### OpenAI API

| 항목 | 값 |
|------|---|
| API 키 | `sk-...` |
| 모델 | GPT-4o, GPT-4o mini (기본), GPT-4.1, GPT-4.1 mini |
| 비용 | 게임당 ~$0.01 (4o-mini 기준) |

### Ollama (로컬)

| 항목 | 값 |
|------|---|
| URL | `http://localhost:11434` (기본) |
| 모델 | `llama3.1:8b` (기본, 자유 입력) |
| 비용 | 무료 |

Ollama 설치 후 `ollama serve`로 시작, 원하는 모델 `ollama pull llama3.1:8b`로 다운로드.

> API 키는 브라우저 localStorage에만 저장됩니다. 서버로 전송되지 않습니다.

## 플레이 방법

### 웹 버전 (브라우저)

GitHub Pages에서 바로 플레이하거나, 로컬에서 실행:

```bash
git clone https://github.com/JihoonJeong/ai-mapo.git
cd ai-mapo
python3 -m http.server 8080
```

`http://localhost:8080` 접속. AI 자문관 설정은 게임 내 모드 표시를 클릭.

### MCP 버전 (Claude Desktop)

Claude Desktop 앱 안에서 채팅으로 게임을 진행합니다. Claude가 직접 자문관이 되어 전략 분석과 대화를 제공합니다. 별도 API 키 불필요 (Claude 구독으로 동작).

#### 사전 요구사항

- [Claude Desktop](https://claude.ai/download) 설치 (macOS / Windows)
- [Node.js](https://nodejs.org/) v18 이상 설치
- Git

#### 1단계: 저장소 클론 및 빌드

```bash
git clone https://github.com/JihoonJeong/ai-mapo.git
cd ai-mapo/ai-mapo-mcp
npm install
npm run build
```

빌드가 성공하면 `dist/` 폴더에 서버 파일이 생성됩니다.

#### 2단계: 빌드 경로 확인

다음 명령으로 설정에 넣을 절대 경로를 확인합니다:

```bash
echo "$(pwd)/dist/main.js"
```

출력 예시: `/Users/yourname/ai-mapo/ai-mapo-mcp/dist/main.js`

#### 3단계: Claude Desktop 설정

Claude Desktop의 MCP 서버 설정 파일을 편집합니다.

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

파일이 없으면 새로 만들고, 있으면 `mcpServers` 안에 `ai-mapo` 항목을 추가합니다:

```json
{
  "mcpServers": {
    "ai-mapo": {
      "command": "node",
      "args": ["/여기에-2단계에서-확인한-절대경로/dist/main.js", "--stdio"]
    }
  }
}
```

> 경로는 반드시 절대 경로로 입력하세요. `~`나 상대 경로는 동작하지 않습니다.

#### 4단계: Claude Desktop 재시작

Claude Desktop을 완전히 종료(macOS: Cmd+Q)한 후 다시 열어야 설정이 적용됩니다.

#### 5단계: 게임 시작

새 대화를 열고 입력:

> **마포구청장 게임 시작해줘**

Claude가 게임을 초기화하고, 마포구 지도와 핵심 지표가 표시됩니다.

#### 사용법

게임이 시작되면 Claude가 마포구 현황을 브리핑합니다. 자연어로 지시하면 됩니다:

| 하고 싶은 것 | 채팅 예시 |
|-------------|----------|
| 예산 변경 | "경제 20, 복지 25, 교통 20으로 바꿔줘" |
| 턴 진행 | "다음 턴 진행해줘" / UI의 "턴 종료" 버튼 |
| 동 분석 | "합정동 상황 알려줘" / "서교동이랑 연남동 비교" |
| 전략 질문 | "인구 유출 막으려면 어떻게 해야 해?" |
| 상태 확인 | "현재 전체 상태 보여줘" |

화면 상단에 SVG 맵과 핵심 지표가 표시되고, 예산 조정이나 정책 선택 등의 조작은 모두 채팅으로 합니다.

#### 문제 해결

서버가 연결되지 않으면 터미널에서 직접 실행하여 에러를 확인합니다:

```bash
cd ai-mapo/ai-mapo-mcp
node dist/main.js --stdio
```

정상이면 아무 출력 없이 대기합니다. 에러가 출력되면 Node.js 버전이나 빌드 상태를 확인하세요.

#### 웹 vs MCP 차이

| | 웹 버전 | MCP 버전 |
|---|---|---|
| AI 호출 | 사용자 API 키 필요 | Claude 구독으로 동작 |
| 자문관 | 채팅 패널 (게임 내) | Claude가 직접 자문관 |
| 조작 | 슬라이더, 카드, 버튼 | 채팅 + 간단한 UI |
| 대화 | 제한적 (미리 정의된 분석) | 자유 대화 (전략 토론 가능) |

## 프로젝트 구조

```
ai-mapo/
├── index.html              — 웹 버전 진입점
├── css/style.css
├── js/
│   ├── main.js             — 앱 초기화 + 턴 루프
│   ├── advisor.js          — AI 자문관 (4개 백엔드)
│   ├── map.js              — SVG 지도
│   ├── dashboard.js        — 대시보드 + 차트
│   ├── budget.js           — 예산 배분 슬라이더
│   ├── policy.js           — 정책 시스템
│   ├── event.js            — 이벤트 시스템
│   ├── pledge.js           — 공약 추적 + 점수
│   ├── autoplay.js         — AI 자동 플레이
│   └── engine/             — 시뮬레이션 엔진
├── sim/                    — Headless 시뮬레이션 (배치 실험)
├── ai-mapo-mcp/            — MCP App (Claude Desktop용)
│   ├── src/server.ts       — MCP 서버 (3 tools)
│   ├── src/engine/         — 게임 엔진 (TS 포팅)
│   ├── ui/                 — iframe UI (맵 + 대시보드)
│   └── dist/               — 빌드 결과
├── data/game/              — 게임 데이터 (공유)
└── design/                 — 설계 문서
```

## 라이선스

MIT
