# AI 마포구청장

서울 마포구 16개 동, 357,232명의 구청장이 되어 4년(48턴) 임기를 수행하는 도시경영 시뮬레이션.

AI 자문관이 데이터 기반 분석과 정책 제안을 제공합니다.

**플레이:** https://jihoonjeong.github.io/ai-mapo/

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

## 로컬 실행

```bash
# 정적 파일이므로 아무 HTTP 서버로 서빙
python3 -m http.server 8080
# 또는
npx serve .
```

`http://localhost:8080` 접속.

## 프로젝트 구조

```
ai-mapo/
├── index.html
├── css/style.css
├── js/
│   ├── main.js          — 앱 초기화 + 턴 루프
│   ├── advisor.js       — AI 자문관 (4개 백엔드)
│   ├── map.js           — SVG 지도
│   ├── dashboard.js     — 대시보드 + 차트
│   ├── budget.js        — 예산 배분 슬라이더
│   ├── policy.js        — 정책 시스템
│   ├── event.js         — 이벤트 시스템
│   ├── pledge.js        — 공약 추적 + 점수
│   └── engine/
│       ├── simulation.js   — 턴 시뮬레이션
│       ├── economy.js      — 경제 (사업체, 상권)
│       ├── population.js   — 인구 이동
│       └── satisfaction.js — 주민 만족도
├── data/game/
│   ├── mapo_init.json      — 초기 게임 데이터
│   ├── mapo_policies.json  — 정책 목록
│   └── mapo_events.json    — 이벤트 목록
└── design/                 — 설계 문서
```

## 라이선스

MIT
