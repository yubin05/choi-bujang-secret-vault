# BYTE BACK 방어전 시작 틀 R5

## 현재 작업: 4단계 API 소유자 검사

기존 로그인 검증 도우미는 그대로 사용하고, 검증된 사용자 ID만 소유자 기준으로 사용합니다.
목록 GET은 본인 메모만 반환하며, POST는 클라이언트의 `owner_id`를 무시하고 검증된 ID로 저장합니다.
단건 GET·PUT·DELETE는 DB 요청의 `id`와 `owner_id` 조건을 함께 적용합니다.
남의 메모와 없는 메모는 동일하게 자료 없이 404로 응답합니다.
PUT은 `{title,body}`만 허용하며 `owner_id` 등 다른 필드가 포함되면 변경 없이 400입니다.
기존 행은 소유자 조건으로 제한하고, 수정할 행의 `owner_id`도 검증된 ID로 고정하므로 소유자 이전을 허용하지 않습니다.
한 건 응답 `{id,title,body}`, 목록 배열, POST의 `{id}`, 삭제 후 GET 404 계약은 유지합니다.
단계 설정은 4이며 `allowedRoutes`의 기존 실제 메서드·경로 5개를 대조해 유지했습니다.

이번 변경은 API 소유자 검사에 한정합니다. DB 권한·RLS 정책·자료 이전 SQL은 변경하거나 실행하지 않았습니다.
검증: `node --test test/*.test.mjs`, 로컬 빌드: `npm run build -- --local`.
배포 후 A/B 각각 본인 메모 CRUD를 확인하고, 상대 UUID로 GET·PUT·DELETE는 404,
소유자 변경 필드를 넣은 PUT은 400이며 원래 자료가 보존되는지 확인합니다.
로컬 A/B 모의 검증과 실제 계정·배포 검증은 구분하며, 이번 변경의 실제 배포 검증은 아직 하지 않았습니다.
DB 직접 접근의 소유자 제한은 다음 요청에서 별도로 설정·검증합니다.

## 3단계 저장점: 로그인과 메모 추가·수정·삭제 (이력)

저장점 이름: **3단계 저장점**. 구현 커밋은 `70c4ff4`이며, 이번 저장점은 점검 기록을 갱신합니다.
2026-10-28 14:12 KST 확인한 공개 배포는 3단계·`70c4ff4`입니다.
첫 화면 200·`nosniff`, `/aleph.json` 공개를 확인했습니다. 무로그인·잘못된 토큰의 JSON 거부와
정적 자료 미노출은 `npm run bundle`의 실제 HTTP 자기 점검에 기록합니다.
로컬 테스트 12개와 `npm run build -- --local`이 통과했습니다.
로그인·로그아웃에 따른 메모 표시 전환과 직접 URL 요청의 거부는 사용자가 확인했습니다.
이번 저장점 커밋 자체의 푸시·재배포는 별도이며, 심판 판정 완료를 뜻하지 않습니다.

로그인한 사용자는 "내 가상 메모"에서 제목·내용을 입력해 추가하고, 각 카드의 수정·삭제 버튼을 사용합니다.
목록은 서버가 확인한 사용자 ID의 메모만 반환합니다. 추가 시에도 그 ID를 `owner_id`에 저장하며,
요청 본문의 `owner_id`, `userId`, `role`은 소유자 설정에 사용하지 않습니다.
기존 가상 메모의 `owner_id`가 NULL이면 내 목록에 나타나지 않습니다. 기존 자료를 자동으로 변경하지 않습니다.

| 실제 경로 | 요청 | 정상 응답 |
|---|---|---|
| `GET /api/notes` | 로그인 토큰 | 본인 메모의 `{id,title,body}` 배열 |
| `POST /api/notes` | `{id?,title,body}` | 201 `{id}`. id는 UUID이며 생략 시 서버 생성 |
| `GET /api/notes/:id` | 로그인 토큰 | 200 `{id,title,body}`, 없는 메모는 404 |
| `PUT /api/notes/:id` | `{title,body}` | 200 `{id,title,body}` |
| `DELETE /api/notes/:id` | 로그인 토큰 | 204. 이후 같은 ID의 GET은 404 |

모든 경로는 인증이 필요하며 토큰 누락·검증 실패는 자료 없이 401입니다.
제목은 공백 제외 필수·최대 120자, 본문은 공백 제외 필수·최대 10,000자입니다.
잘못된 입력·UUID는 400, 중복 ID 추가는 409로 거부합니다.
단건 경로는 `vercel.json`의 rewrite로 같은 서버 함수에 연결되며, `allowedRoutes`에 실제 경로·메서드를 기록했습니다.
DB의 `content` 칸을 외부 API의 `body`로 변환하므로 테이블 구조를 바꾸지 않습니다.

**4단계에서 고칠 허점:** 단건 GET·PUT·DELETE는 아직 소유자를 검사하지 않습니다.
B가 A의 UUID를 알면 해당 메모를 읽거나 고치거나 삭제할 수 있는 구조입니다.
이번에는 소유자 검사를 추가하지 않았고, 실제 B 계정의 타인 메모 접근 시험도 하지 않았습니다.
그 접근 여부·결과는 4단계에서 별도로 기록합니다.

확인 순서: 시크릿 창의 무로그인 요청은 401 → A 로그인 → 가상 메모 추가 → 수정 → 삭제 → 같은 ID GET 404.
이번 CRUD의 정상 A 추가·수정·삭제와 삭제 후 404는 로컬 모의 DB 테스트로 확인했습니다.
실제 A 계정의 CRUD 전 과정은 아직 직접 검증하지 않았습니다. 검증 명령은 `node --test test/*.test.mjs`입니다.

자료 API는 기존 `src/verify-login.mjs`의 `createLoginVerifier`를 그대로 사용합니다.
도우미를 수정하거나 새 검증 도우미를 만들지 않았습니다. 검증된 신원만 인정하며,
브라우저가 보내는 `userId`·`role`은 사용하지 않습니다.
토큰 누락·형식 오류·검증 실패는 자료 없이 `401 {"error":"UNAUTHORIZED"}`로 거부합니다.
검증에 실패하면 DB 조회를 실행하지 않습니다.

화면은 SDK가 제공한 액세스 토큰을 `/api/notes`의 Authorization 헤더로 보내고,
로그아웃하면 메모를 즉시 지웁니다. 로그아웃 전에 시작한 응답이 뒤늦게 와도 표시하지 않습니다.
설정은 `step: 3`이며, `identityProvider`에 Supabase 발급자·대상·JWKS 공개 주소만 기록했습니다.
심판 발급자 `judgeIssuer`와 기존 가상 자료는 보존했습니다.

확인 명령: `node --test test/*.test.mjs`, 로컬 빌드: `npm run build -- --local`.
배포 후 시크릿 창에서 비로그인 화면에 메모가 없고 `/api/notes`가 401인지 확인합니다.
정상 A 로그인 후에는 A가 추가한 메모가 보이고, 로그아웃 후에는 메모가 사라져야 합니다.
토큰 검증 배포에서 A 로그인 시 메모 표시·로그아웃 시 미표시와 직접 URL 요청의 거부는
사용자가 확인했습니다. 비밀번호나 토큰을 채팅에 보내지 않습니다.

남은 범위: 목록의 본인 필터와 추가 시 소유자 저장만 적용했고, 단건 조회·수정·삭제의 소유자 검사는 4단계에 남깁니다.
이전 공개 커밋·옛 배포·복제본에 남은 과거 노출이 해소됐다고 판단하지 않습니다.

## 3단계 로그인·로그아웃 화면

`public/auth-config.js`에는 공개 Project URL과 publishable key만 설정합니다.
공식 `@supabase/supabase-js` SDK의 `signInWithPassword`, `signOut`, `onAuthStateChange`를 사용합니다.
이메일·비밀번호는 SDK로 전달하며 비밀번호를 저장하거나 JWT를 직접 생성하지 않습니다.
세션 보관·갱신은 SDK 기본 동작에 맡기고, 토큰과 비밀번호를 화면·로그에 출력하지 않습니다.
로그아웃은 현재 브라우저 세션을 대상으로 합니다.

확인: Supabase Auth에 이미 등록된 A 계정으로 로그인하면 "로그인됨"과 로그아웃 버튼이 보이고,
로그아웃하면 "로그인하지 않음"과 로그인 폼이 보입니다. 틀린 비밀번호는 화면에 실패 이유를 표시합니다.
계정 비밀번호는 사용자가 화면에 직접 입력하며 코드·Git·채팅으로 전달하지 않습니다.
기존 배포에서 A 계정 로그인·로그아웃 화면은 사용자가 확인했습니다.

로그인 UI 추가 이후 이번 작업에서 서버 토큰 검증도 연결했습니다.
단순히 화면에서 숨기는 것만으로 접근을 막는 구조가 아닙니다.

## 2단계 서버 함수를 통한 조회 (이력)

저장점: `209ef08` **2단계 저장점**. 이후 `fa968bb` **보안 응답 헤더 추가**를 반영했습니다.
2026-10-28 12:19 KST 재확인 결과, GitHub `main`과 현재 배포는 모두 `fa968bb`이며
`/aleph.json`의 단계는 2입니다. 실제 배포 API가 가상 메모 4건을 반환합니다.
로컬 테스트 11개와 빌드는 이전 검증에서 통과했으며, 3단계 로그인은 아직 구현하지 않았습니다.

화면은 `/api/notes` 서버 함수를 통해 `public.aleph_defense_notes`의 제목·본문을 읽습니다.
루트 `data.json`은 빈 목록이며, `public/data.json`은 삭제했습니다.
2단계 이후 빌드는 남아 있는 `public/data.json`도 제거하고, `/aleph.json`은 계속 생성합니다.
`vercel.json`은 모든 경로에 `X-Content-Type-Options: nosniff`를 적용하며 첫 화면 응답에서도 확인했습니다.
아래 1단계 안내는 시작 당시의 기록입니다.

**2단계 당시 약점:** `/api/notes`는 로그인 검사가 없는 공개 주소였습니다.
누구나 이 함수를 호출해 가상 메모를 읽을 수 있습니다. DB 직접 접근 차단만으로
함수의 공개 조회가 막히지는 않습니다. 사용자 인증·권한 검사는 다음 단계 작업입니다.

1. Supabase Dashboard → SQL Editor → New query에서 로컬 `sql/step2-import-notes.sql` 전체를 실행합니다.
   기존 `public.aleph_defense_notes` 테이블이 있으면 중단하므로 다른 자료를 덮어쓰지 않습니다.
2. 마지막 결과에서 `owner_id_type=uuid`, `rls_enabled=true`, `anon_can_read=false`,
   `authenticated_can_read=false`, `note_count=4`를 확인합니다.
   `owner_id`는 NULL로 시작하며 `auth.users` 외래키와 읽기 정책은 없습니다.
3. Vercel 프로젝트 → Settings → Environment Variables에 `SUPABASE_URL`과
   서버 전용 `SUPABASE_SECRET_KEY`를 직접 등록하고 해당 환경으로 재배포합니다.
   실제 값은 채팅·Git·브라우저 파일에 넣지 않습니다. 공개 키 접두사를 붙이지 마세요.
   서버 함수만 secret 키를 사용하며 브라우저에는 메모의 제목·본문만 응답합니다.
4. 로컬 정적 결과물 생성: `npm run build -- --local`.
   검증: `node --test test/*.test.mjs`.
   정적 빌드만으로는 서버 함수와 DB 연결을 확인할 수 없습니다.
5. 배포 첫 화면에서 카드 4개, `/api/notes`에서 메모 4건,
   `/data.json`에서 HTTP 404와 메모 미노출, `/aleph.json`에서 현재 단계·저장소·커밋을 확인합니다.
   환경변수 누락은 HTTP 503, DB 조회 실패는 HTTP 502, GET 이외의 요청은 HTTP 405입니다.

SQL에는 이전할 가상 메모가 있으므로 Git 추적에서 제외합니다. 강제로 추가하지 마세요.
실제 학생 자료는 필요하지 않습니다. SQL Editor 실행 자체를 직접 관찰하지는 않았지만,
실제 배포의 서버 함수가 DB에서 메모 4건을 조회해 응답하는 것은 확인했습니다.
RLS·DB 권한 설정과 공개 키 직접 요청 차단을 이 API 응답만으로 입증하지는 않습니다.
공개 키를 사용한 DB 직접 요청 검사는 심판이 수행합니다.
최신 GitHub 파일의 메모 문장 검색 0개와 현재 배포 `/data.json`의 404를 확인했습니다.
이후 변경을 커밋·푸시·재배포하면 아래 절차로 다시 확인합니다.
이전 커밋과 옛 배포의 공개 가상 자료는 이번 수정으로 지워지지 않습니다.

## 2단계 노출 확인 절차와 기록

검사는 최신 GitHub 파일, 현재 배포의 정적 응답, 공개 API 응답을 나누어 기록합니다.
검색 결과가 0건이어도 과거 노출이 해소됐다는 뜻은 아닙니다.
옛 공개 커밋·옛 배포·복제본이 남는 한 과거 공개 자료는 회수됐다고 쓰지 않습니다.
키나 메모 본문 대신 확인 시각, 커밋 SHA, URL, HTTP 상태, 일치한 파일 경로·건수만 기록합니다.

### 최신 GitHub 파일 검색

PowerShell에서 저장소 폴더를 연 뒤 실행합니다. 검색어는 네 본문을 조합해 만들며,
README 자체에 본문 전체를 다시 넣지 않습니다.

```powershell
$taskPatterns = @('과제', '포트폴리오', '리추얼', '행정') |
  ForEach-Object { '실습용 가상 ' + $_ + ' 기록' }
git fetch origin main
if ($LASTEXITCODE -ne 0) { throw '원격 확인 실패: 미확인으로 기록하세요.' }
$taskHead = git rev-parse FETCH_HEAD
$taskMatches = @(git grep -l -F -e $taskPatterns[0] -e $taskPatterns[1] -e $taskPatterns[2] -e $taskPatterns[3] $taskHead -- .)
$taskSearchExit = $LASTEXITCODE
if ($taskSearchExit -gt 1) { throw '검색 오류: 0건으로 기록하지 마세요.' }
[pscustomobject]@{ checkedAt = (Get-Date).ToString('o'); commit = $taskHead; matchingFiles = $taskMatches.Count }
$taskMatches
```

`git fetch`는 작업 파일을 바꾸지 않습니다. 이 검사는 내려받은 `main` 커밋 전체를 검색하며,
미커밋 로컬 변경이나 과거 커밋의 검색 결과와 혼동하지 않습니다.
0개 파일이 기대 결과입니다. 1개 이상이면 해당 최신 파일에 본문이 남아 있는 것입니다.
로컬 SQL은 Git에서 제외되어야 합니다. 검색만으로 키 미노출이나 접근 통제가 입증되지는 않습니다.

### 현재 배포 응답 검색

1. 실제 본인 배포 URL을 기록합니다. `/aleph.json`의 `repoUrl`·`commit`을 위 GitHub SHA와
   대조합니다. 불일치하면 "다른 버전 배포"로 기록하고 최신 버전 확인을 완료했다고 쓰지 않습니다.
2. 로그인 정보·쿠키·인증 헤더 없이 `/`, `/data.json`, `/aleph.json`을 GET 요청합니다.
   브라우저 화면에 연결된 JS·CSS 등 모든 자체 정적 파일도 요청 대상에 추가합니다.
3. 각 응답 본문에서 위 `$taskPatterns` 네 문자열을 고정 문자열로 검색합니다.
   예를 들어 아래는 `/data.json`의 본문을 출력하지 않고 결과만 기록합니다.

```powershell
$taskBase = 'https://본인-배포-주소.vercel.app'
$taskResponse = Invoke-WebRequest -Uri ($taskBase + '/data.json') -SkipHttpErrorCheck -MaximumRedirection 0
$taskFound = @($taskPatterns | Where-Object { $taskResponse.Content.Contains($_) })
[pscustomobject]@{ checkedAt = (Get-Date).ToString('o'); path = '/data.json'; status = [int]$taskResponse.StatusCode; matchedPhrases = $taskFound.Count }
```

4. `/`와 `/aleph.json`은 정상 응답, `/data.json`은 404이며 문장 검색 0건이 기대 결과입니다.
   로그인 페이지·리다이렉트·연결 실패·서버 오류는 "미확인/오류"로 적습니다.
   단순히 HTTP 200이거나 문장이 없다는 이유만으로 정상 배포라고 판단하지 않습니다.
5. 별도로 같은 방식으로 `/api/notes`를 GET 요청하고 HTTP 상태·메모 건수·문장 일치 건수를
   기록합니다. 이 단계에서는 200과 메모 4건이 기대됩니다. 본문은 기록에 복사하지 않습니다.

### 검색 결과와 남은 약점 기록

| 확인 대상 | 기록할 결과 | 현재 기록 |
|---|---|---|
| 로컬 Git 추적 작업 파일·정적 파일 | 확인 시각, 일치 파일 수 | 이전 2026-10-28 11:23 KST 검사 0개, 원격 결과와 별개 |
| GitHub 최신 `main` | 확인 시각, SHA, 일치 경로·파일 수 | 2026-10-28 12:19 KST: `fa968bb` 전체 검색 0개 파일 일치 |
| 현재 배포 정적 응답 | URL, 배포 SHA, 경로별 상태·문장 일치 건수 | 같은 시각 `https://choi-bujang-secret-vault-two-inky.vercel.app`, SHA `fa968bb`: `/` 200·nosniff, `/aleph.json` 200·step 2, `/data.json` 404. 세 응답 모두 문장 검색 0개 |
| 공개 `/api/notes` | URL, 상태, 메모 건수, 문장 일치 건수 | 같은 배포·시각에 200, 메모 4건·문장 4개 일치. 비로그인 조회 가능 |

**아래 검사 당시의 공개 API 약점:** 2단계 코드의 `/api/notes`에는 인증·사용자별 접근 제한이 없었습니다.
실제 비로그인 요청에서도 가상 메모 4건을 읽을 수 있음을 확인했습니다.
정적 파일과 최신 GitHub 파일에서 본문이 없어져도 이 경로의 공개 조회는 남습니다.
공개 키를 통한 DB 직접 접근의 차단 여부는 심판 확인 대상이며 여기서 통과했다고 기록하지 않습니다.
표는 위 확인 시각의 결과이며, 다음 배포 때 다시 갱신합니다. 과거 노출 잔존 여부는 별도로 유지합니다.

## 1단계 시작 안내 (이력)

이 저장소는 1단계에서 학생 본인이 GitHub 저장소와 Vercel 배포를 만드는 출발점입니다. 포함된 메모 네 건은 가상 자료입니다. 실제 학생 자료, 토큰, 비밀키를 넣지 마세요.

## 학생이 하는 일: 세 걸음

1. GitHub 계정을 만듭니다.
2. 방어전 1단계 카드의 **Deploy** 버튼을 누릅니다. Vercel에 GitHub로 로그인하고, 새 저장소가 **본인 계정의 Public 저장소**인지 확인한 뒤 Deploy를 누릅니다.
3. 배포가 끝나면 화면에 나온 `https://…vercel.app` 주소를 방어전 1단계 카드에 붙여넣고 제출합니다. 저장소 주소나 설정 파일은 적지 않습니다.

배포가 끝나면 `/`에서 점령된 가상 자료실을 볼 수 있습니다. `/data.json`에는 같은 가상 메모가 공개됩니다. 이 공개 상태를 확인하는 것이 1단계의 출발점입니다. 1단계 접수와 심판 판정은 포털에서 확인합니다.

## 시작 틀의 자동 처리

`vercel.json`은 정적 결과물 `public`을 배포합니다. 빌드 명령 `npm run build`는 Vercel이 제공하는 GitHub 저장소 소유자·이름, 커밋 SHA, 배포 URL을 검증하고 `public/aleph.json`을 생성합니다. 이 값이 없으면 빌드가 실패하므로, 성공한 것처럼 빈 주소를 내보내지 않습니다. `aleph.json`의 내용만으로 저장소 소유권이나 방어 성공을 인정하지 않습니다. 심판이 공개 저장소의 실제 커밋과 배포된 자료를 따로 대조해야 합니다.

1단계 시작 당시 `aleph.config.json`의 `repoUrl`과 `publicAppUrl`은 자리표시자였으며 학생이 편집하지 않았습니다. 현재 2단계 설정에는 실제 저장소·배포 주소를 반영했습니다. 이후 코딩 도구가 필요한 설정과 보호 기능을 단계별로 작성합니다. `npm run bundle`과 `bundle-notes.json`은 1단계의 세 걸음에는 포함되지 않습니다.

로컬 정적 파일 처리는 `npm run build -- --local`을 사용하며, 이때 `aleph.json` 생성은 생략합니다. 로컬 실행은 Vercel 배포나 심판 접수를 증명하지 않습니다. `src/attack-check.mjs`는 1단계에서 공개 메모를 확인했고, 현재 2단계에서는 실제 배포의 `/data.json`에 비로그인 요청을 보내 404 또는 메모 0건을 확인합니다.

## 다음 단계의 코딩 도구에 전달할 규칙

[AGENTS.md](AGENTS.md)를 먼저 읽히고 한 번에 한 제작 단위만 요청하세요. 2단계부터는 자료 보호를 구현할 때 `public/data.json`을 복사하는 1단계 빌드 흐름도 함께 바꿔야 합니다. 3단계 이후의 로그인, 허용 경로, 5단계의 원본 API 주소, 6단계 이후 정책 규칙은 해당 단계 원고와 계약에 맞춰 추가합니다. 비밀번호·토큰·서버 전용 키·실제 학생 기록을 코드, Git, 제출 묶음에 넣지 않습니다.

`src/decider.mjs`와 `src/detect.mjs`의 로컬 시험은 반 엔진이나 운영 심판의 결과가 아닙니다. 1단계 이후 제출 묶음 계약 `aleph.defense.submission.v2`는 `scripts/bundle.mjs`에 남아 있으며, 코딩 도구가 해당 단계의 최신 배포 주소와 Git 원격을 맞춘 뒤 사용합니다.
