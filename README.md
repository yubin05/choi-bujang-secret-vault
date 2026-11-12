# BYTE BACK 방어전 시작 틀 R5

## 11단계 저장점: 나만의 접속 앱을 완성합니다

저장점 이름: **11단계 저장점**. `step: 11`로 올렸습니다. 배포 주소, 로그인 발급자, 원본 HTTPS 경로, `judgeIssuer`는 바뀐 구현이 없어 10단계 값 그대로 대조했습니다.
`allowedRoutes`(판정기가 허용하는 자료 경로 3개)와 `restoreRoute`도 그대로입니다. 새 `POST /api/auth/device`는 로그인 경로이며 자료 경로가 아니라 넣지 않았습니다.
판정기(`src/decider.mjs`)와 `RULE_IDS` 6개는 바꾸지 않았습니다. 10단계 저장점 `344a253`과 README 보완 `da992c4`는 이후 GitHub에 푸시됐으며, 그 배포 반영 여부는 확인하지 않았습니다.

**설치형 웹앱:** `public/manifest.webmanifest`(앱 이름·아이콘 192/512·`standalone`)와 오프라인 안내 `public/offline.html`을 추가했습니다.
`public/sw.js`는 연결이 끊긴 화면 이동에만 안내 화면을 보여 주며, 로그인·메모 API 요청은 가로채거나 저장하지 않습니다. 따로 설치할 접속 프로그램은 없습니다.
앱 설치·화면 모드·승인 요청 버튼은 기기 승인 근거가 아닙니다.

**기기 승인 흐름:**
| 단계 | 동작 |
|---|---|
| 기기 표시 | 서버가 무작위 기기 ID를 `__Host-aleph-device` HttpOnly·Secure 쿠키로 줍니다. 개인키가 아니며 화면 스크립트·브라우저 저장소에 넣지 않고, DB에는 SHA-256 해시만 둡니다 |
| 승인 요청 | 화면의 **이 기기 승인 요청** → `POST /api/auth/device`(`vercel.json`으로 기존 세션 함수에 연결). 대기 행과 8자리 확인 코드만 만듭니다 |
| 승인 | 학생이 Supabase SQL Editor에서 확인 코드와 `owner_id`를 대조해 `approved_at`을 직접 채웁니다. 서버 키는 이 표를 읽고 대기 행을 추가만 할 수 있어 스스로 승인할 수 없습니다 |
| 자료 차단 | 메모·공지·복원 API의 공통 로그인 확인이 학생 로그인에 승인된 기기를 요구합니다. 그 밖은 DB를 읽기 전에 403 `DEVICE_NOT_APPROVED`입니다. 화면도 서버 응답이 `approved`일 때만 자료실을 엽니다 |
| 심판 요청 | 심판 서명 토큰은 기기 쿠키를 요구하지 않습니다. 심판의 기기 확인은 운영 엔진·판정기(`docs/DECIDER_REQUEST.md`)가 맡으며 1~10단계 결과를 유지합니다 |

기기 승인 표 SQL은 `sql/step11-device-approvals.sql`(Git 제외)이며 아직 실행하지 않았습니다.

다시 실행하는 순서(SQL을 배포보다 먼저):
1. SQL Editor에서 위 SQL 실행 → `anon_can_read`·`authenticated_can_read`·`server_can_update`·`server_can_set_approved`가 false, `server_can_read`·`server_can_insert`가 true인지 확인합니다.
2. 배포 후 B 로그인 → "승인되지 않은 기기입니다", 메모 칸 없음 → **이 기기 승인 요청** → "승인 대기 중… 확인 코드".
3. SQL 파일 끝의 승인 UPDATE에 그 코드를 넣어 실행합니다. 결과가 1행이고 `owner_id`가 내 계정인지 확인합니다.
4. **승인 상태 확인** → 기존 자료실이 열리고 메모 추가·수정·삭제가 됩니다.

거부되어야 할 결과: 승인 전 기기나 쿠키 없는 Bearer 요청으로 `/api/notes`·`/api/notices`·복원을 요청하면 403, 승인 요청 버튼을 다시 눌러도 대기, 시크릿 창 401.
배포 전 SQL을 실행하지 않으면 학생 로그인 화면이 "기기 승인 상태를 확인하지 못했습니다"로 잠기고 자료 API는 503입니다.

2026-11-12 로컬 실행: `node --test test/*.test.mjs` 37개, `npm run decider:test` 4개, `npm run build -- --local`이 통과했습니다.
`package.json`·`package-lock.json`은 바꾸지 않았고, 커밋 전 HEAD(`da992c4`)를 새로 복제한 저장소의 `npm install`도 오류 없이 끝났습니다. 가상 요청·가짜 DB 연습이며 심판 판정이 아닙니다.
`npm run bundle`의 자기 점검은 로그인 없는 승인 요청만 실제로 보내고, 승인 전 기기 차단과 승인 기기의 자료실은 미실행으로 기록합니다.
한계: 승인된 기기의 쿠키가 도난되면 그 기기로 흉내 낼 수 있고, 쿠키를 지우거나 다른 브라우저를 쓰면 다시 승인해야 합니다.
이 저장점의 푸시·배포, SQL 실행, 실제 B 확인과 심판 판정은 아직 실행하지 않았습니다.

## 10단계 저장점: 백업에서 자료실을 되살립니다

저장점 이름: **10단계 저장점**. `step: 10`으로 올렸습니다. 배포 주소, 로그인 발급자, 원본 HTTPS 경로는 바뀐 구현이 없어 9단계 값 그대로 대조했습니다.
`allowedRoutes`는 판정기가 허용하는 `GET /api/notes/:id`, `POST /api/notes/:id/restore`, `GET /api/notices` 세 개이고 `restoreRoute`는 `POST /api/notes/:id/restore`입니다.
`RULE_IDS`는 9단계와 같은 6개이며 복원 경로는 기존 `zone_notes` 규칙에 넣었습니다. 9단계 저장점 `46578ea`는 이후 GitHub에 푸시됐으며, 그 배포 반영 여부는 확인하지 않았습니다.

복원 절차는 아래 두 가지이며 범위가 서로 다르고 서로 영향을 주지 않습니다.
절차 1은 메모를 읽거나 쓰지 않고, 절차 2는 정책·규칙 파일과 DB 권한을 바꾸지 않습니다.
두 절차 모두 감사 기록을 덧붙이기만 하며 지우거나 고치지 않고, 대상 밖의 규칙과 자료는 그대로 둡니다.
운영 판정기 메모 구역의 `POST /notes/:id/restore` 한 줄은 이 저장점 커밋에서 넣은 것이며, 두 절차가 실행 중에 바꾸는 규칙이 아닙니다.

### 절차 1. 정책 시험 사본 복원 (`npm run policy:restore`)

| 항목 | 내용 |
|---|---|
| 되돌리는 것 | 시험 정책 `artifacts/policy-drill/`(Git 제외)에서 검증한 사본과 다른 줄만. 이번 침공 흉내에서는 `decider.mjs` 13줄의 공지(`notices`) 규칙 한 줄 |
| 바꾸지 않는 것 | 메모(DB·API), 운영 정책(`src/decider.mjs`, `aleph.config.json`, `sql/`), 시험 정책의 다른 규칙(메모·강사 자료 구역, 기기·재확인 규칙), 검증한 사본 `backup/policy/` |
| 감사 기록 | `artifacts/policy-audit.jsonl`(Git 제외 로컬 파일)에 침공 흉내·복원마다 한 줄씩 덧붙입니다. 시험 사본을 다시 만들어도 지우지 않습니다 |
| 중단 | 사본이 없거나 해시·사본 지문이 다를 때, 미리보기 뒤 사본·시험 정책이 바뀌어 확인 코드가 다를 때 |

검증한 사본: `backup/policy/`에 9단계(`46578ea`)의 `src/decider.mjs`, `allowedRoutes`, `sql/step5-revoke-direct-access.sql`을 SHA-256과 함께 보관합니다.
사본 지문(manifest SHA-256)은 `cf54e7d58f8832360deb8eefcfe85fa226823048c8f506cc2403afbd76fd7d87`입니다.
`npm run policy:drill`은 시험 정책의 공지 규칙 한 줄을 바꿔 침공을 흉내 내고, `npm run policy:diff`는 사본과의 차이만 보여 줍니다.
`npm run policy:restore`는 복원할 버전·바뀔 줄·보존 항목·확인 코드만 보여 주며, `-- --confirm <코드>`를 붙여야 시험 정책만 되돌리고 판정기 요청을 다시 확인합니다.

### 절차 2. B 메모 한 건 복원 (`POST /api/notes/:id/restore`)

| 항목 | 내용 |
|---|---|
| 되돌리는 것 | 지정한 시험 계정 B의 가상 메모 `B 공개 시험 메모` 한 건. ID: **미기록**(아래 SQL 결과의 `id`를 받아 적습니다) |
| 바꾸지 않는 것 | 정책·규칙(판정기, `allowedRoutes`, DB 권한), 다른 메모(A 메모, B의 다른 메모, 같은 ID를 쓰는 다른 계정 메모), 비공개 사본 표 |
| 감사 기록 | 서버 로그에 `aleph.restored resource=notes.own note=<ID> sha256=<해시>` 한 줄을 덧붙입니다. 기존 로그와 거부 기록(`aleph.denied`)은 지우지 않습니다 |
| 거부 | 사본에 없거나 남의 사본이면 404, 사본 해시가 틀리면 409 `BACKUP_HASH_MISMATCH`, 같은 ID를 다른 계정 메모가 쓰면 덮어쓰지 않고 409 |

고정 ID를 미리 공개하면 다른 계정이 같은 ID로 메모를 먼저 만들 수 있어(메모 추가는 클라이언트 ID 허용), 이미 B가 가진 메모를 골랐습니다.

| 구분 | 값 |
|---|---|
| 판정기 서비스·경로 | 서비스 `notes`, route `POST /notes/:id/restore`, 규칙 `zone_notes` |
| 실제 API | `POST /api/notes/:id/restore` → `api/notes.js` (`vercel.json` rewrite). `allowedRoutes`·`restoreRoute`에 기록 |
| 비공개 사본 | Supabase 표 `public.aleph_defense_notes_backup`. `sql/step10-backup-b-note.sql`(Git 제외)로 만들며 아직 실행하지 않았습니다 |

사본 표는 anon·authenticated 권한이 없고 서버 키는 SELECT만 가집니다. 메모 본문은 Git·README에 넣지 않습니다.
복원 API는 로그인한 본인의 사본 한 건만 읽어 사본의 ID·소유자·내용 SHA-256을 먼저 대조하고, 그 ID 한 건만 추가하거나 되돌린 뒤 다시 읽어 셋을 재대조합니다.

확인 순서(시험 계정 B만):
1. Supabase SQL Editor에서 `sql/step10-backup-b-note.sql` 실행 → 결과의 `id`, `content_sha256`, `same_as_current=true` 확인.
2. 배포 후 B 로그인 → 메모를 수정하거나 삭제해 사고를 흉내 냅니다.
3. 개발자 도구 Console: `await (await fetch('/api/notes/<ID>/restore',{method:'POST'})).json()` →
   200 `{id, ownerMatches:true, contentSha256}`이며 `id`·`contentSha256`이 1의 값과 같아야 합니다. 메모 목록에 원래 내용이 돌아옵니다.
4. 거부 확인: 같은 요청의 `GET`은 405, 사본에 없는 다른 메모 ID는 404, 시크릿 창은 401입니다.

로컬 시험 `node --test test/notes-restore.test.mjs`가 가짜 DB로 위 동작을 확인합니다. SQL 실행·배포·실제 B 확인은 아직 하지 않았습니다.

### 복구 뒤 1~9단계 정상·금지 요청 다시 실행

자료·정책을 되살린 뒤 아래 순서로 실행합니다. 결과 칸에는 실제로 실행한 것만 적고, 실행하지 않은 것은 **미실행**으로 둡니다.
로컬 결과는 가상 요청·가짜 DB 연습이며 심판 판정이 아닙니다. 결과 시각은 KST입니다.

**가. 자료와 정책이 돌아왔는지**

| # | 확인 | 명령·위치 | 정상 / 다시 거부되어야 할 요청 | 결과 |
|---|---|---|---|---|
| 1 | 정책이 검증한 사본과 같음 | `npm run policy:diff` | 세 파일 모두 `같음` | 2026-11-11 17:57 세 파일 `같음` |
| 2 | 침공 흉내 → 정책 복원 | `npm run policy:drill` → `npm run policy:restore` → 표시된 `--confirm` 명령 | 13줄 한 곳만 표시. 복원 뒤 등록 기기의 메모 한 건 읽기·A 공지 읽기 `allow` / 침공 때 열린 B 공지 쓰기, B 메모 전체 목록, 미등록 기기 `deny`, 복합 이상 `step_up` | 2026-11-11 17:47 7/7 통과 (`artifacts/policy-audit.jsonl`) |
| 3 | B 메모 ID·소유자·내용 해시 | 위 확인 순서 1~3 (SQL 결과와 복원 응답 비교) | `id`·`contentSha256`이 SQL 값과 같고 `ownerMatches:true` / 같은 경로 `GET` 405, 사본 없는 ID 404 | 미실행 (SQL·배포 전) |

정책 2는 9단계 사본 기준의 시험 정책입니다. 운영 판정기의 복원 경로 한 줄은 사본에 없습니다.
DB 접근 정책은 SQL 사본의 해시만 대조했으며 실제 DB 권한 상태는 확인하지 않았습니다.

**나. 로컬 정상·금지 요청 (배포 없이 실행)**

| # | 단계 | 명령 | 정상 / 거부되어야 할 요청 | 결과 |
|---|---|---|---|---|
| 4 | 2~10 자료 API·로그인 | `node --test test/*.test.mjs` | 본인 메모 CRUD, 공지 읽기, B 사본 복원 / 무로그인 401, 타인 메모 404, 다른 출처 쿠키 쓰기 403, 공지 쓰기 405, 소유자 변경 400, 사본 해시 불일치 409 | 2026-11-11 17:57 36/36 통과 |
| 5 | 6·7 판정기 | `npm run decider:test` | 등록 기기 `allow`, 재확인 뒤 `allow` / 미등록 기기 `deny`, 복합 이상 `step_up` | 2026-11-11 17:57 4/4 통과 |
| 6 | 7 | `npm run fixture:7` | `정상 사건: allow` / `복합 이상 사건: step_up` | 2026-11-11 17:57 두 줄 그대로 출력 |
| 7 | 9 탐지 | `npm run detect:test` | 30건·정확히 120건·분산·다른 사용자 `observe` / 121건·200건 회수 제안 | 2026-11-11 17:57 6/6 통과 |

**다. 배포·실제 계정 (시험 계정 B, A는 읽기만)**

| # | 단계 | 요청 | 정상 / 거부되어야 할 결과 | 결과 |
|---|---|---|---|---|
| 8 | 1·2 | 시크릿 창 `/`, `/aleph.json`, `/data.json` | `/` 200·nosniff, `/aleph.json` 200 / `/data.json` 404·메모 문장 0건 | 미실행 |
| 9 | 3 | 시크릿 창 `/api/notes`, `/api/notices` | — / 둘 다 401 | 미실행 |
| 10 | 4·5 | B 로그인 → 새 가상 메모 추가·수정·삭제, A 로그인 → 본인 목록 | 201·200·204, A 목록 200 / B가 A 메모 UUID로 GET·PUT·DELETE 404 | 미실행 |
| 11 | 8 | B 로그인 Console `fetch('/api/notices')` | 200 공지만 / 같은 경로 `POST` 405, 없는 메모 UUID 404 | 미실행 |
| 12 | 5 | 공개 키로 원본 REST 직접 요청 | — / 차단 | 미실행 (심판 확인 대상) |
| 13 | 6·7·9 | 운영 엔진을 거친 미등록 기기·이상 접속·폭주 조회 | — / `deny`·`step_up`·회수 제안 | 미실행 (엔진 연결 없음) |
| 14 | 1~10 | `npm run bundle`의 실제 HTTP 자기 점검 | `src/attack-check.mjs` 기록. 10단계는 로그인 없는 복원 `POST` 401을 실제로 보내고, B 복원·정책 복원은 미실행으로 기록 | 미실행 |

이 저장점의 푸시·배포, 사본 SQL 실행, 실제 B 확인과 심판 판정은 아직 실행하지 않았습니다.

## 9단계 저장점: 도플갱어를 찾고 권한을 거둡니다

저장점 이름: **9단계 저장점**. `step: 9`로 올렸습니다. 배포 주소, 로그인 발급자, `allowedRoutes` 두 개, 원본 HTTPS 경로는
이번 단계에서 바뀐 구현이 없어 8단계 값 그대로 대조했습니다. 판정기(`src/decider.mjs`)와 `RULE_IDS`는 바꾸지 않았습니다.
`burst_read`는 판정기 규칙이 아니라 탐지 결과의 이유 코드이므로 `RULE_IDS`에 넣지 않았습니다.
8단계 저장점 `b7159bd`는 이후 GitHub에 푸시됐으며, 그 배포 반영 여부는 확인하지 않았습니다.

탐지 `src/detect.mjs`: 사건마다 `docs/DETECT_EVENTS.md` 계약의 `at`·`method`·`identity.sub` 세 값만 읽습니다.
본문·토큰·실명·네트워크·기기·지역 칸은 복사하지 않고, 세 값 중 하나라도 없거나 형식이 틀린 사건은 모름으로 두고 세지 않습니다.
규칙 `burst_read`: 같은 `sub`의 `GET`이 어느 10분 구간(첫 사건부터 10분 미만)에서든 120건을 넘으면
`{action:'propose_revocation', reasonCode:'burst_read', subject}` 세 키만, 그 밖에는 `{action:'observe'}`만 돌려줍니다.
정확히 120건, 10분 밖으로 흩어진 조회, 다른 사용자의 사건은 합치지 않아 정상입니다. 창 계산은 `at`만 씁니다.
둘 이상이 동시에 폭주하면 사건에 먼저 나온 사용자 하나만 `subject`로 돌려줍니다. 회수 API와 기기 권한은 바꾸지 않았습니다.

확인 순서:
1. `npm run detect:test` → 여섯 항목 모두 `통과`(121건·200건은 회수 제안, 나머지는 `observe`).
2. `npm run decider:test` → 네 항목 모두 `통과`(등록 기기의 정상 요청은 `allow`로 유지).
3. `node --test test/*.test.mjs` → 29개 통과. 세 값 외 칸 미복사·정확히 10분 경계·`POST` 제외·사용자 분리 검사가 포함됩니다.

2026-11-11 로컬 실행에서 1~3이 통과했고, 새로 복제한 저장소의 `npm install`도 오류 없이 끝났습니다. 가상 사건 연습이며 심판 판정이 아닙니다.
운영 반 엔진의 사건 전달과 회수 제안 집행은 연결·시험하지 않았으며 `src/attack-check.mjs`에 `burst_read_revocation`을 미실행으로 기록합니다.
이유 코드 `burst_read`의 운영 등록부 포함 여부는 미확인입니다. 이 저장점의 푸시·배포와 심판 판정은 아직 실행하지 않았습니다.

## 8단계 저장점: 자료마다 갈 수 있는 구역을 나눕니다

저장점 이름: **8단계 저장점**. `step: 8`로 올렸습니다. 배포 주소, 로그인 발급자, 원본 HTTPS 경로는
이번 단계에서 바뀐 구현이 없어 7단계 값 그대로 대조했습니다. `allowedRoutes`에는 판정기가 허용하는 경로만
`GET /api/notes/:id`, `GET /api/notices` 두 개를 메서드와 함께 적었습니다.
`RULE_IDS`에는 실제 구현한 `starter.deny`, `device_registered`, `step_up_required`,
`zone_notes`, `zone_notices`, `zone_instructor_materials`만 있습니다.
7단계 저장점 `377d8b2`는 이후 GitHub에 푸시됐으며, 그 배포 반영 여부는 확인하지 않았습니다.

자원 구역: 메모는 `notes.own`(`/api/notes`), 반 공지는 `notices.instructor`(새 `GET /api/notices`)입니다.
공지 API는 로그인이 필요한 읽기 전용이며 가상 공지 2건만 돌려주고 DB를 쓰지 않습니다.
두 API는 모든 응답에 `X-Resource-Id`를 붙입니다. 자원 ID는 경로로만 정하며 query·body로 바꿀 수 없습니다. 화면 메뉴는 바꾸지 않았습니다.

판정기 구역 규칙: 메모는 ID 하나를 고르는 `GET /notes/:id`만 허용하고 전체 목록·쓰기는 `deny`·`route_not_allowed`입니다.
반 공지는 `GET /notices`만 허용하고 쓰기는 재확인을 거쳐도 거부합니다. 강사 자료(`materials`)는 모두 거부하고,
알 수 없는 서비스는 기존 `starter.deny`입니다. route와 실제 method·path 깊이가 다르면 거부하며 `:id` 형식은 좁히지 않습니다.
언제나 거부할 요청에 재확인을 요구하지 않도록 구역 규칙을 `step_up_required`보다 먼저 봅니다. 판정기는 계약의 요청 이름만 읽습니다.

자료 API: 메모 API는 DB 요청의 소유자 조건과 별도로 응답 행의 저장된 `owner_id`를 검증된 사용자와 다시 대조합니다.
남의 메모와 없는 메모는 같은 404입니다. 강사 권한 저장소가 없어 누구도 강사로 보지 않으며 body·query·메뉴의 `role`은 읽지 않습니다.
공지 쓰기는 누구에게나 405입니다. 거부 사유는 `aleph.denied resource=… reason=…` 한 줄로 서버 로그에 남기며
토큰·사용자 ID·본문은 기록하지 않습니다. 로그인 확인은 `src/auth-session.mjs`의 `authenticateDataRequest`를 두 API가 함께 씁니다.

확인 순서:
1. `node --test test/*.test.mjs` → 25개 통과.
2. `npm run decider:test` → 네 항목 모두 `통과`. `npm run fixture:7` → `allow`, `step_up`.
3. 배포 후 A 로그인 → 개발자 도구 Console에서 `fetch('/api/notes')`는 200·본인 메모만, `fetch('/api/notices')`는 200·공지만.
   `fetch('/api/notes/<아무 UUID>')`는 404, `fetch('/api/notices',{method:'POST'})`는 405, 시크릿 창의 `/api/notices`는 401이어야 합니다.

2026-11-11 로컬 실행에서 1·2가 통과했고, 새로 복제한 저장소의 `npm install`도 오류 없이 끝났습니다. 가상 요청 연습·모의 시험이며 심판 판정이 아닙니다.
이유 코드 `route_not_allowed`의 운영 등록부 포함 여부와 문자열 형식 `allowedRoutes`의 엔진 수용 여부는 미확인입니다.
실제 A/B 계정의 다른 구역 직접 요청은 `src/attack-check.mjs`에 미실행으로 기록합니다. 강사 공지 관리 경로와 강사 권한 저장소는 아직 없습니다.
이 저장점의 푸시·배포와 심판 판정은 아직 실행하지 않았습니다.

## 7단계 저장점: 평소와 다른 접속은 다시 확인합니다

저장점 이름: **7단계 저장점**. `step: 7`로 올렸습니다. 배포 주소, 로그인 발급자, 메모 허용 경로 5개,
원본 HTTPS 경로는 이번 단계에서 바뀐 구현이 없어 6단계 값 그대로 대조했습니다.
`RULE_IDS`에는 실제 구현한 `starter.deny`, `device_registered`, `step_up_required`만 있습니다.
6단계 저장점 `b94e214`는 이후 GitHub에 푸시됐으며, 그 배포 반영 여부는 확인하지 않았습니다.

입력 검사 `readAccessSignals`는 계약의 `signals`·`recentEvents`만 읽습니다. 지역·네트워크·시각은
엔진의 가상 신호(`source: judge_fixture`)일 때만 읽고 실제 위치 증거로 쓰지 않습니다.
출처가 `none`·불명확하거나 값이 없으면 `null`(모름)로 두며 정상값으로 채우지 않습니다.
헤더·`geo` 등 계약 밖 값은 읽지 않으므로 위조한 클라이언트 헤더는 신뢰 정보로 승격되지 않습니다.

규칙 `step_up_required`: 00~05시 + `network: unusual` + 최근 5분 사건 합계 10건 이상이 모두 확인되면
`step_up`·`step_up_required`로 추가 확인을 요청합니다. 지역은 조건에 넣지 않고 상태를 저장하지 않아 영구 차단이 없습니다.
`stepUp.verified`가 정확히 true이고 인증 경과 0~900초일 때만 재확인으로 인정해 `allow`(규칙 두 개 기록)합니다.
기준값은 사용자별 평소 이력 계약이 없어 고정값이며, 실제 경로는 `source: none`이라 이 규칙이 발동하지 않습니다.
기존 기기 규칙이 먼저 적용되므로 미등록 기기는 그대로 `deny`·`device_not_registered`입니다.

엔진이 같은 주체의 다시 로그인 시각을 확인하는 계약은 저장소에 없습니다(`stepUp` 칸 모양만 있음).
그래서 다시 로그인 전 실제 자료 차단과 새 로그인 뒤 허용은 실측하지 않았고,
`src/attack-check.mjs`에 `unusual_access_before_relogin`을 미실행으로 기록합니다.

확인 순서:
1. `npm run fixture:7` → `정상 사건: allow`, `복합 이상 사건: step_up`.
2. `npm run decider:test` → 네 항목 모두 `통과`. `확인 필요`가 나오면 실패입니다.
3. `node --test test/*.test.mjs` → 20개 통과. 위조 출처·지역만 다른 요청·오래된 재확인 검사가 포함됩니다.

2026-11-11 로컬 실행에서 위 세 명령이 모두 통과했습니다. 가상 요청 연습이며 심판 판정이 아닙니다.
이유 코드 `step_up_required`의 운영 등록부 포함 여부는 미확인입니다. 이 저장점의 푸시·배포와 심판 판정은 아직 실행하지 않았습니다.

## 6단계 저장점: 등록한 기기만 자료실에 들어옵니다

저장점 이름: **6단계 저장점**. `step: 6`으로 올렸습니다. 배포 주소, 로그인 발급자, 메모 허용 경로 5개,
원본 HTTPS 경로는 이번 단계에서 바뀐 구현이 없어 5단계 값 그대로 대조했습니다.
`RULE_IDS`에는 실제 구현한 `starter.deny`(마지막 기본 거부)와 `device_registered`만 있습니다.
`src/attack-check.mjs`는 기존 공개 HTTP 점검을 그대로 실행하고, 미등록 기기 점검은 심판이 맡으므로 미실행으로 기록합니다.

`src/decider.mjs`에 규칙 `device_registered`를 추가했습니다. 요청 항목은 `docs/DECIDER_REQUEST.md` 계약만 사용합니다.
`deviceRegistered`가 정확히 `true`가 아니면(false·누락 포함) `deny`·`device_not_registered`로 거부합니다.
등록 기기이고 `subjectId`가 있는 `notes` 서비스의 `GET`(자료실 읽기)만 `allow`·`approved`로 허용합니다.
그 밖의 요청은 기존 `starter.deny` 기본 거부로 넘어가므로, 등록 기기라도 쓰기 요청은 아직 거부됩니다.
허용 이유 코드 `approved`는 계약 문서 예시에서 가져왔으며, 운영 등록부 `allowedReasonCodes` 포함 여부는 미확인입니다.

이번 단계에는 따로 설치할 접속 프로그램이 없습니다. 인증서·CA·서명 키도 만들지 않습니다.
기기 증명은 운영 엔진이 맡고, 판정기는 엔진이 넘긴 `deviceRegistered` 값만 판단합니다.

확인 순서:
1. 저장소 폴더의 터미널에서 `npm run decider:test`를 실행합니다.
2. `통과 · 등록 기기의 정상 요청`이 보여야 합니다. 이 요청의 응답은 `allow`입니다.
3. `통과 · 미등록 기기의 가상 요청`이 보여야 합니다. 이 요청의 응답은 `deny`·`device_not_registered`입니다.
4. `확인 필요`가 하나라도 나오면 실패이며 종료 코드는 1입니다.

2026-11-11 로컬 실행에서 두 항목 모두 통과했습니다. 이 결과는 가상 요청 연습이며 심판 판정이 아닙니다.
로컬 테스트 `node --test test/*.test.mjs` 14개와 새로 복제한 저장소의 `npm install`도 오류 없이 끝났습니다.
미등록 기기 공격 시험은 심판이 맡습니다. 이 저장점의 푸시·배포와 심판 판정은 아직 실행하지 않았습니다.

## 5단계 저장점: 자료 요청과 로그인을 서버로 통일

저장점 이름: **5단계 저장점**. 이 커밋에 서버 로그인 연결과 점검 기록을 포함합니다.
`step: 5`, 실제 배포 주소, 로그인 발급자, 메모 API 허용 경로 5개, 원본 HTTPS 경로를 구현과 대조했습니다.
사용자가 Vercel에 `SUPABASE_PUBLISHABLE_KEY`를 추가했다고 확인했습니다. 실제 값은 읽거나 기록하지 않았습니다.

브라우저 메모 CRUD는 `/api/notes`와 `/api/notes/:id`를 사용합니다.
기존 서버 함수의 토큰 검증 도우미와 소유자 검사는 유지합니다.
로그인·세션 확인/갱신·로그아웃은 `POST /api/auth/login`, `/api/auth/session`, `/api/auth/logout`으로 옮겼습니다.
Supabase 공식 SDK는 서버에서만 실행합니다. 브라우저 SDK와 `public/auth-config.js`를 제거해
현재 화면 파일에는 publishable/anon 키가 없습니다. 비밀번호·토큰은 응답 JSON과 로그에 넣지 않습니다.
서버는 토큰을 HttpOnly·Secure·SameSite=Lax 쿠키에 보관하고 메모 API는 기존 도우미로 검증합니다.
화면은 새로고침 때 세션을 복원하고, 메모 요청의 401에는 SDK 갱신 후 한 번만 다시 요청합니다.
로그아웃은 SDK로 현재 세션의 갱신 권한을 회수하고 쿠키를 지웁니다. 이미 발급된 액세스 토큰은
만료 전까지 유효할 수 있습니다. 다른 브라우저의 세션을 일괄 로그아웃하지는 않습니다.
Vercel 환경변수에 `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `SUPABASE_PUBLISHABLE_KEY`가 필요합니다.
세 값 모두 서버 함수에서 읽습니다. 실제 값은 Git·채팅에 넣지 않습니다.
쿠키를 쓰는 변경 요청과 Auth 요청은 설정한 `publicAppUrl`과 동일한 Origin에서만 허용합니다.
HTTPS 운영 주소에서 시험하며, 임의의 미리보기 주소·로컬 정적 서버에서는 로그인할 수 없습니다.
이전 SDK의 브라우저 저장 세션은 자동 이전하지 않으므로 배포 후 다시 로그인합니다.
심판용 Bearer 헤더 요청은 유지하고, 쿠키를 자동 전송하는 브라우저 요청에는 출처 검사를 적용합니다.
이전 공개 커밋·옛 배포에 남은 키·자료가 사라졌다고 판단하지 않습니다.
`originalApiUrl`에는 쿼리·키가 없는 원본 메모 REST HTTPS 경로를 기록했고 단계는 5로 설정했습니다.

검토할 SQL: `sql/step5-revoke-direct-access.sql`. 아직 DB에 실행하지 않았습니다.
SQL Editor에서 실행 전·후 결과를 비교합니다. PUBLIC·anon·authenticated의 해당 테이블 직접 권한과
열 권한만 회수하며 메모, 기존 RLS 정책, 다른 테이블은 변경하지 않습니다.
적용 후 anon·authenticated의 실제 테이블·열 권한은 모두 false,
서버용 service_role의 SELECT·INSERT·UPDATE·DELETE는 true여야 합니다.
상속 권한이 남거나 서버 권한이 없으면 예외로 전체 변경을 취소하며 다른 역할·테이블을 자동 변경하지 않습니다.
PostgreSQL 17 미만의 MAINTAIN 결과 NULL은 해당 버전에 권한 종류가 없다는 뜻입니다.

서버 CRUD와 화면 연결은 로컬 A/B 모의 테스트로 확인했습니다. 실제 A 계정 쓰기 전 과정은 미검증입니다.
SQL 적용 전후 A 로그인 → 본인 메모 목록·추가·수정·삭제를 직접 확인해 정상 동작을 비교합니다.
B의 타인 메모 조회·수정·삭제는 404, 무로그인은 401이어야 합니다.
원본 직접 요청은 심판이 anon 키로 확인합니다. 여기서는 차단 통과나 SQL 적용 완료라고 기록하지 않습니다.
로컬 검증: `node --test test/*.test.mjs`, 빌드: `npm run build -- --local`.
서버 로그인 연결 후 로컬 모의 테스트 14개와 위 로컬 빌드가 통과했습니다.
이 저장점의 푸시·배포와 실제 A/B 로그인 시험은 아직 실행하지 않았습니다.
`npm run bundle`의 공개 HTTP 점검은 실행 시점의 기존 배포 응답이며 이 커밋의 배포 검증을 뜻하지 않습니다.
배포 후 A 로그인 → 메모 추가·수정·삭제 → 새로고침 → 로그아웃을 확인합니다.
틀린 비밀번호는 실패 이유를 표시하고, 시크릿 창의 무로그인 메모 요청은 JSON 401이어야 합니다.

## 4단계 저장점: API 소유자 검사

저장점 이름: **4단계 저장점**. 구현 커밋은 `7337a55`이며 이번 저장점은 점검 기록을 갱신합니다.
2026-10-29 10:38 KST 공개 배포는 4단계·`7337a55`이고 첫 화면 200·nosniff를 확인했습니다.
사용자가 실제 A 로그인 요청으로 본인 메모 200, B 메모 404를 확인했습니다.
로컬 테스트 12개와 빌드가 통과했습니다. A/B 모의 DB 테스트에서 본인 CRUD, 상대 행 거부와 원본 보존,
소유자 변경 요청 거부를 확인했습니다. 실제 계정의 상대 행 수정·삭제 차단과 DB 권한 SQL 적용 결과는 미확인입니다.
이번 저장점 자체의 푸시·재배포는 별도이며, 심판 판정 완료를 뜻하지 않습니다.

기존 로그인 검증 도우미는 그대로 사용하고, 검증된 사용자 ID만 소유자 기준으로 사용합니다.
목록 GET은 본인 메모만 반환하며, POST는 클라이언트의 `owner_id`를 무시하고 검증된 ID로 저장합니다.
단건 GET·PUT·DELETE는 DB 요청의 `id`와 `owner_id` 조건을 함께 적용합니다.
남의 메모와 없는 메모는 동일하게 자료 없이 404로 응답합니다.
PUT은 `{title,body}`만 허용하며 `owner_id` 등 다른 필드가 포함되면 변경 없이 400입니다.
기존 행은 소유자 조건으로 제한하고, 수정할 행의 `owner_id`도 검증된 ID로 고정하므로 소유자 이전을 허용하지 않습니다.
한 건 응답 `{id,title,body}`, 목록 배열, POST의 `{id}`, 삭제 후 GET 404 계약은 유지합니다.
단계 설정은 4이며 `allowedRoutes`의 기존 실제 메서드·경로 5개를 대조해 유지했습니다.

이번 코드 변경은 API 소유자 검사에 한정합니다. DB 권한·RLS 정책 SQL은 대화에서 제안했으며,
실제 DB에는 실행하지 않았습니다. 사용자의 SQL 적용 여부와 결과도 아직 확인하지 않았습니다.
검증: `node --test test/*.test.mjs`, 로컬 빌드: `npm run build -- --local`.
배포 후 A/B 각각 본인 메모 CRUD를 확인하고, 상대 UUID로 GET·PUT·DELETE는 404,
소유자 변경 필드를 넣은 PUT은 400이며 원래 자료가 보존되는지 확인합니다.
실제 A→B 조회 차단은 사용자 확인이며, 나머지 소유자 검증은 로컬 모의 결과와 구분합니다.
DB 직접 접근의 권한·RLS 소유자 제한은 SQL 적용 후 별도로 검증해야 합니다.

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

## 3단계 로그인·로그아웃 화면 (이력: 현재는 위 5단계 서버 로그인 사용)

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
