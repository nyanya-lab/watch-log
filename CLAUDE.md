# 냐냐's Watch LOG — 프로젝트 가이드

영화/드라마 시청 기록 관리 웹앱. 노션에서 관리하던 기록을 옮겨온 개인용 사이트. GitHub Pages에 정적 배포. 빌드 도구 없음, 순수 HTML/CSS/JS.

## 작업 규칙 (중요)

- 한국어(반말)로 소통
- 애매한 요청은 코딩 전에 먼저 질문할 것. 불명확한 점은 모아서 한 번에 물어보기
- 확인 없이 코드 구조를 바꾸지 말 것. 특히 임의로 순서를 바꾸거나 재구성하지 않기
- 변경된 파일만, 한 번에 묶어서 전달
- 한 단계씩 진행하고 중간에 검증
- UI: 얇은 글씨 금지(medium~semibold), 여유 있는 간격, 색상 중복 피하기, FontAwesome 아이콘 사용(이모지 X)

## 파일 구조

전부 같은 폴더에 평면 배치 (GitHub Pages 복붙 업로드 편의).

```
index.html      361줄  전체 마크업 (로그인/헤더/목록/통계/설정 + 모달 4개)
style.css       173줄  커스텀 CSS (Tailwind CDN 위에 얹음)
core.js         390줄  Firebase 동기화, 로그인, 상태(State), 유틸
tmdb.js         345줄  TMDB API 검색/상세/OTT판별, 검색 UI
watchlog.js     654줄  카드 목록, 필터, 등록·수정 모달, 설정 탭
stats.js        271줄  Chart.js 통계 + 히트맵
seed-data.js   5630줄  노션에서 변환한 초기 데이터 268개
dev-local.js          로컬 테스트 전용 (.gitignore, 배포에 없음)
.gitignore            dev-local.js 제외
```

로드 순서 고정 (index.html 하단): `seed-data → core → tmdb → watchlog → stats`

의존성: Tailwind CDN, FontAwesome 6.5.1, Chart.js 4.4.1

## 설정값 (core.js 상단)

```js
const FIREBASE_DB_URL = "https://nyanya-watchlog-default-rtdb.asia-southeast1.firebasedatabase.app";
const SYNC_BRANCH = "watchlog";
const LEGACY_KEY = "data";   // 예전 고정 경로 (/watchlog/data). 마이그레이션 참조용.
const AUTO_SYNC_DELAY = 2500;
```

### 보안 모델 (스페인어 단어장과 동일 방식)

- **입장 비밀번호 없음.** 앱은 바로 열림 (로그인 게이트 제거됨).
- **동기화 비밀번호 = 서버 데이터 경로.** 데이터는 `/watchlog/{비밀번호}`에 저장됨.
  비밀번호를 모르면 경로 자체를 모르므로 남이 데이터에 접근 불가.
- 비밀번호는 **코드(GitHub)에 없음.** 사용자가 설정 탭에서 입력 → `localStorage.watchlog_sync_password` (이 기기에만).
- 비밀번호 없으면 **로컬 전용 모드** (서버 동기화 안 함, 아이콘 `fa-cloud-slash`).
- 다른 기기에서도 **같은 비밀번호**를 넣어야 동기화됨.
- **Firebase 규칙 필수:** `watchlog/$room` 만 read/write 허용, 부모(`watchlog`) 목록 열거는 차단.
  ```json
  { "rules": { "watchlog": { "$room": { ".read": true, ".write": true } } } }
  ```
- 최초 비밀번호 설정 시(`firstSyncAfterPw`): 새 방이 비어 있으면 예전 `/watchlog/data`
  데이터를 옮길지 confirm으로 물어본 뒤 복사. 자동 삭제/덮어쓰기 없음.

TMDB API 키도 코드에 없음. 사용자가 설정 탭에서 입력 → `localStorage.watchlog_tmdb_key`

### 로컬 개발 (dev-local.js)

- `dev-local.js` — **`.gitignore`에 등록** (깃/배포에 없음). localhost·file://에서만 로드.
- 동기화 비밀번호를 주입해 실제 데이터로 테스트하되, `autoPush`/`pushToServer`를
  가로채 **서버 저장을 차단**(읽기 전용). 저장 테스트 시 콘솔에서 `devAllowWrite(true)`.
- 콘솔 헬퍼: `setSyncPassword(pw)` 로도 비밀번호 설정 가능.

## 데이터 모델

```js
{
  id: "w...",              // uid()
  title: "오징어 게임",
  type: "드라마",           // 영화|드라마|예능|애니|다큐|기타
  country: "한국",
  ott: "넷플릭스",          // 영화관 체크 시 "영화관"
  season: "S1",            // null 가능
  watchCount: 1,
  rating: 4,               // 1~5, null 가능 (사용자 별점)
  startDate: "2021-09-17", // 처음 본 날 (시작)
  endDate: "2021-09-20",   // 처음 본 날 (종료)
  lastWatchStart: null,    // 재시청 기록
  lastWatchEnd: null,
  review: "",
  createdAt: "ISO",

  // --- 아래는 TMDB 자동 채움 ---
  tmdbId: 93405,           // null이면 "미등록" 취급
  poster: "https://image.tmdb.org/t/p/w500/...",
  backdrop: "...",
  genres: ["드라마", "미스터리"],
  overview: "줄거리",
  originalTitle: "Squid Game",
  releaseDate: "2021-09-17",
  releaseYear: "2021",
  runtime: 54,             // 영화=상영시간, TV=회당
  totalSeasons: 2,
  totalEpisodes: 16,
  cert: "청소년관람불가",
  voteAverage: 7.9,        // TMDB 평점 (사용자 rating과 별개)
  companies: ["싸이런픽쳐스"],
  cast: [{name, character}],  // 상위 8명
  director: "황동혁",
  otts: ["넷플릭스"]        // TMDB 자동판별 결과
}
```

`tmdbId`가 null인 항목 = "미등록". 목록 상단 노란 버튼으로 필터링.

## 저장 구조

### 로컬 (localStorage)

- `watchlog_items` — 데이터 본체
- `watchlog_items_backup` — 저장 직전 상태 1개
- `watchlog_modified` — 마지막 수정 ISO 시각 (동기화 비교용)
- `watchlog_tmdb_key`
- `watchlog_sync_password` — 동기화 비밀번호(= 서버 데이터 경로). 이 기기에만 저장.

### 서버 (Realtime Database REST, SDK 안 씀)

- `PUT/GET {DB_URL}/watchlog/{동기화 비밀번호}.json` (경로는 `getDataUrl()`이 생성)
- 저장 형태: `{ items: [...], updatedAt: ISO, count: n }`

### 동기화 흐름

- `saveLocal()` → localStorage 저장 + 2.5초 디바운스 후 `autoPush()`
- `syncOnBoot()` → 부팅 시 서버/로컬 `updatedAt` 비교해 최신본 채택
- 안전장치: 서버 데이터가 로컬의 50% 미만이면 confirm으로 확인
- 헤더 구름 아이콘이 상태 표시 (idle/pending/saving/saved/error)

디버깅용 전역 함수: `testConnection()`, `showStorage()`, `restoreBackup()`

## TMDB 연동

- `/search/multi` — 영화+TV 동시 검색
- `/{type}/{id}?append_to_response=credits,release_dates|content_ratings` — 상세
- `/{type}/{id}/watch/providers` — 한국(KR) 스트리밍 판별 → `PROVIDER_MAP`으로 앱 OTT명 변환

제목 변형 재검색 (`titleVariants`): 검색 실패 시 자동으로 콜론/대시 앞부분, 괄호 제거, 시즌 표기 제거, 띄어쓰기 제거, 앞 단어들 순으로 재시도. 대체 검색 성공 시 결과 위에 안내 표시.

일괄 채우기 (`runEnrichAll`): 설정 탭. "이미 채운 항목도 갱신" 체크 시 전체 재조회. 요청 간 260ms 대기.

## UI 특징

- 헤더: 총 개수 배지(그라데이션) + 동기화 아이콘
- 검색바: `[검색] [필터] [등록+]` 한 줄. 필터 적용 시 아이콘에 빨간 점
- 필터: 모달 팝업 (구분/국가/OTT/연도/장르/정렬). 선택 즉시 결과 수 미리보기
- 미등록 버튼: 토글식. 0개면 자동 숨김
- 카드: 포스터 위 TMDB평점(우상단) + 시즌(좌상단) 오버레이
- 등록/수정 모달: TMDB 검색 → 선택 시 정보카드 표시 + 폼 자동 채움. 수정 시에도 기존 TMDB 정보 카드 표시됨
- 시즌: TMDB 시즌 목록 있으면 드롭다운, 없으면 ± 스테퍼로 폴백
- OTT: 영화관 체크박스 별도. 미체크 시 TMDB 자동판별 후보를 초록 힌트로 안내하되 직접 변경 가능
- 배지 색상: 구분=보라, 국가=파랑, OTT=초록, 장르=회색, 시즌=주황, 출연진=핑크, 평점=노랑, 등급=빨강, 시간=청록

설계 원칙: TMDB에서 온 정보든 직접 입력한 정보든 조회 화면에서 구분되지 않아야 함.

## 통계 탭

연도별 막대 / GitHub 잔디 히트맵(연도 선택) / 장르 도넛 / 구분 도넛 / 국가 가로막대 / OTT 가로막대 / 별점 분포

히트맵은 `startDate~endDate`와 `lastWatchStart~lastWatchEnd` 범위를 날짜 단위로 펼쳐서 집계.

## 알려진 이슈 / 남은 작업

- [ ] 노션 원본 268개 중 별점은 9개, 한줄평은 7개뿐 → 나머지는 수기 입력 필요
- [ ] 시즌을 별도 항목으로 등록 중 (같은 드라마 S1/S2가 카드 2개). 하나로 묶는 방식은 보류
- [ ] TMDB 검색 실패 시 Gemini API로 원제 추론하는 방안 논의됐으나 미적용
- [ ] `favicon.ico` 없음 (404 로그)
- [ ] 항목 수가 많아지면 카드 렌더링 최적화 필요 (현재 24개씩 더보기)

## 배포

GitHub Pages. 파일을 저장소 루트에 복붙 업로드. 파일명·경로가 정확해야 함 (`tmdb (1).js` 같은 중복 다운로드명 주의).
