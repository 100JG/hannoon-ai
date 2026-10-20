# 한눈AI 운영가이드

한눈AI는 Cloudflare Workers·D1과 정적 웹 자산으로 구성된 서비스입니다. 사용자는 공개 웹 주소에 접속하면 되며 웹은 회원가입·로그인·AI API 키 입력 없이 이용합니다. 관리형 플랫폼의 MCP 연결에는 기존 플랫폼 계정의 OAuth 승인이 별도로 적용됩니다.

## 운영 구조

```text
웹 · Chrome 확장 · MCP
          ↓ HTTPS
    Cloudflare Worker
          ↓ 서버 비밀 환경변수
 Gemini · OpenAI · Anthropic
          ↕
   암호화 임시 상태 · D1
```

문서 본문 추출과 PNG 변환은 사용자 브라우저에서 처리합니다. AI 제공업체 키는 서버의 Secret에만 저장하며 웹·확장 ZIP·MCP 응답에 넣지 않습니다. 익명 세션과 작업 접근 정보는 제공업체 API 키와 다릅니다.

GitHub는 코드 배포 위치입니다. 저장소를 공개하는 것만으로 서버와 비밀 환경변수가 만들어지지는 않습니다. 기존 서비스 이용자는 주소만 열면 되고, 독립 서비스를 운영하려는 사람은 아래 배포 설정을 진행해야 합니다.

## Cloudflare 무료 한도로 직접 배포

Node.js와 Cloudflare 계정을 준비합니다. 설치 후 저장소 폴더에서 다음을 실행합니다.

```text
npm ci
npx wrangler login
npx wrangler d1 create hannoon-ai
```

출력된 데이터베이스 ID를 `wrangler.jsonc`의 `d1_databases`에 넣고 바인딩 이름 `DB`는 유지하세요. 다음으로 스키마를 적용합니다.

```text
npx wrangler d1 migrations apply DB --remote
```

서버 비밀값은 각 명령이 표시하는 입력 창에 넣습니다. API 키를 명령 인수·GitHub 파일·스크린샷에 넣지 마세요.

```text
npx wrangler secret put LLM_API_KEY
npx wrangler secret put SERVICE_SECRET
```

`SERVICE_SECRET`은 비밀번호 관리기 등으로 만든 충분히 긴 무작위 값(최소 32자)을 사용하세요. 임시 원문 암호화와 접근 정보 보호에 사용하므로 공개하지 않습니다. 이를 교체하면 기존 임시 작업과 접근 정보가 무효화될 수 있습니다.

빌드 환경의 `SITE_ORIGIN`을 실제 HTTPS 서비스 주소로 설정한 뒤 빌드·배포합니다. 확장 다운로드에도 이 주소가 적용됩니다.

```text
npm run build
npm run deploy
```

처음 배포하여 주소가 확정된 경우 해당 주소를 `SITE_ORIGIN`에 반영해 다시 빌드·배포하세요. 별도 도메인을 구매하지 않고 Cloudflare가 제공하는 HTTPS 주소를 사용할 수 있습니다. 관리형 호스팅에 이미 배포된 서비스를 이용하는 일반 사용자에게 Cloudflare 계정이나 CLI 설치를 요구하지 마세요.

[Cloudflare D1 명령 안내](https://developers.cloudflare.com/d1/wrangler-commands/)

## 무료 한도의 범위

Cloudflare Workers Free는 하루 100,000회 요청과 HTTP 요청당 CPU 10ms 등의 한도를 적용합니다. AI 응답을 기다리는 네트워크 시간과 CPU 실행 시간은 다릅니다. D1 Free는 데이터베이스별 500MB 등 저장·쿼리 한도를 적용합니다. 한도와 정책은 변경될 수 있으므로 실제 계정에서 확인하세요. 무료 호스팅은 AI API 호출 비용까지 무료라는 뜻이 아닙니다.

- [Workers 제한](https://developers.cloudflare.com/workers/platform/limits/)
- [D1 제한](https://developers.cloudflare.com/d1/platform/limits/)

문서 추출은 브라우저로 분리하고 AI 작업은 단계별 요청으로 진행합니다. 이용이 늘면 세션·IP·전체 호출 한도를 먼저 조정하고, 호스팅과 AI 제공업체의 사용량을 함께 확인하세요. 무료 자원으로 무제한 동시 이용이나 무제한 생성은 보장하지 않습니다.

## 서버 환경변수

| 이름 | 용도와 기본값 |
|---|---|
| `LLM_API_KEY` | 서버 Secret. AI 제공업체 키. 사용자에게 배포하지 않습니다. |
| `SERVICE_SECRET` | 서버 Secret. 32자 이상 무작위 값. 임시 상태 암호화·서명에 사용합니다. |
| `LLM_MODEL` | 선택한 AI 모델. 사용 가능한 모델을 제공업체에서 확인합니다. |
| `VERIFIER_MODEL` | 검증 모델을 별도로 지정할 때 사용합니다. |
| `SESSION_DAILY_LIMIT` | 익명 세션별 일일 생성 한도. 기본 5회. |
| `IP_DAILY_LIMIT` | IP별 일일 생성 한도. 기본 15회. |
| `GLOBAL_DAILY_LIMIT` | 전체 일일 생성 한도. 기본 30회. |
| `API_DAILY_LIMIT` | 전체 일일 AI 호출 예산. 기본 60회. |

작업 시작 시 최대 호출 수를 예약하고 완료 시 실제 사용량에 맞게 정산합니다. 일일 한도는 UTC 날짜를 기준으로 갱신됩니다. 호출 횟수는 모델·입력 길이에 따른 금액 상한을 뜻하지 않으므로 AI 제공업체의 예산·할당량도 설정하세요.

## Chrome 배포와 MCP

웹 사용가이드의 `/downloads/chrome-extension.zip`을 안내하세요. ZIP에는 서비스 주소와 브라우저 문서 파서만 포함하며 API 키는 넣지 않습니다. 설치 사용자는 Chrome 개발자 모드·폴더 선택·서비스 연결 권한을 직접 승인해야 합니다.

Chrome 웹 스토어 게시에는 운영자 등록·심사가 별도로 필요합니다. 게시하지 않은 스토어 링크를 안내하지 마세요.

MCP 주소는 공개 서비스 주소 뒤의 `/mcp`이며, 호스팅에 따라 인증 방식을 구분합니다.

| 배포 환경 | MCP 인증과 사용자 안내 |
|---|---|
| 관리형 `chatgpt.site` 공개 서비스 | 플랫폼이 OAuth를 적용합니다. 공개 웹이 로그인 없이 열려도 MCP는 플랫폼 인증이 필요합니다. ChatGPT는 OAuth를 선택하고, Codex는 추가 후 `codex mcp login hannoon`, Claude Code는 `/mcp`의 인증 절차를 진행합니다. |
| 직접 운영하는 Workers | 기본 서버 구현은 인증 없음입니다. 별도 한눈AI 로그인을 요구하지 않습니다. 자체 인증 계층을 추가하면 실제 정책에 맞게 가이드를 수정합니다. |

관리형 플랫폼의 `/.well-known/oauth-protected-resource/mcp` 메타데이터와 401 응답의 `WWW-Authenticate`를 기준으로 클라이언트가 인증 서버를 찾습니다. 현재 관리형 연결은 `openid resource.invoke email` 범위를 요구합니다. AI 제공업체 API 키를 이 OAuth 인증 정보로 사용하지 마세요. 한눈AI 자체 회원가입은 없으며 플랫폼 계정·이메일 처리는 해당 플랫폼의 정책을 따릅니다.

웹 가이드는 `chatgpt.site` 호스트명으로 OAuth 안내를 표시하고, API가 `mcp.auth_mode`를 제공하면 그 값을 우선 사용합니다. 결과 조회에는 작업별 무작위 임시 접근 정보가 필요합니다. 연결·도구 실행 승인은 사용자 환경에서 진행하며, ChatGPT 사용자 지정 앱 지원 여부는 계정·요금제·관리자 정책에 따릅니다.

웹은 HttpOnly 쿠키, 확장은 자동 발급한 익명 접근 정보로 작업을 조회합니다. MCP는 작업 번호와 함께 발급한 임시 접근 정보로 조회합니다. 작업 번호만으로 다른 사람의 자료를 읽게 만들지 마세요. 공개 MCP는 전체 이용 예산을 소모할 수 있으므로 IP·전체 한도를 유지하세요.

## 자료 보관과 정리

추출 본문은 처리 중 D1에 암호화해 저장하고, 완료·실패 시 본문을 삭제합니다. 중단된 작업과 결과는 기본 24시간 만료 정책을 적용합니다. 만료 데이터는 즉시 읽을 수 없고 요청 시 정리 및 시간별 Cron 정리가 실제 삭제를 진행합니다. `wrangler.jsonc`의 Cron Trigger를 유지하세요.

쿠키·확장 세션을 지우면 사용자가 최근 결과에 접근하지 못할 수 있으므로 PNG 저장을 안내하세요. 로그에 원문·비밀·전체 요청 본문을 기록하지 마세요. 호스팅 백업은 별도의 보관 정책을 적용합니다. 운영자는 실제 AI 제공업체·연락 경로·호스팅·백업 보관 정책에 맞게 공개 개인정보 안내를 확정하세요.

## GitHub 공개와 업데이트

- 실제 API 키, 서비스 Secret, `.env`·`.dev.vars`, 개인 설정과 실행 결과를 제외합니다.
- 파일뿐 아니라 Git 기록·릴리스 ZIP·빌드 자산까지 비밀을 확인합니다.
- `.gitignore`는 이미 공개된 비밀을 지우지 않습니다. 공개된 키는 폐기·재발급합니다.
- 오픈소스 라이선스와 타사 필수 고지는 유지합니다.
- 업데이트 전에 텍스트·URL·파일·이미지 복사·PNG 다운로드·Chrome 현재 페이지·MCP 생성과 결과 조회를 확인합니다.
- 키가 없는 환경에서는 서비스 준비 중 안내를 표시하며 비밀이나 내부 오류를 응답하지 않아야 합니다.

AI 키 교체는 서버 Secret에서 진행하고 새 버전을 배포합니다. 사용자에게 키를 배포하거나 확장 코드를 수정하도록 요구할 필요가 없습니다. 서비스 주소를 바꾸면 확장 ZIP을 다시 빌드하고 MCP 사용자는 새 주소로 재연결하도록 안내하세요.
