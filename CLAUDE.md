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
  rating: 4.5,             // 0~5 (소수 가능), null 가능 (사용자 별점)
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
  collectionId: 1241,      // TMDB 공식 시리즈 ID (영화만). 시리즈 묶기 기준
  collectionName: "해리 포터 컬렉션",
  seriesNo: 3,             // 컬렉션 안에서 몇 번째 편 (개봉일 순). 영화만
  seriesTotal: 8,          // 그 컬렉션의 총 편수
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

OTT만 갱신 (`runRefreshOtts`): 설정 탭 "OTT 정보만 갱신" 버튼. TMDB 연동된 항목의 `otts`만
`tmdbProviders`로 다시 조회 (구분으로 movie/tv 추정, 비면 반대쪽도 시도). OTT는 시간이 지나면 바뀌므로 별도 제공.

평점만 갱신 (`runRefreshRatings`): `voteAverage`만 `tmdbDetail`로 다시 조회.
각 갱신 버튼 옆에 최근 실행 시각 표시 (`LS_UPD`=`watchlog_updated_at`, `markUpd`/`renderUpdInfo`).
설정 탭 순서: TMDB 일괄 채우기(맨 위) → API 키 → 동기화 비밀번호 → Firebase 동기화 → 데이터 관리.

## UI 특징

- 헤더: 총 개수 배지(그라데이션) + 동기화 아이콘
- 검색바: `[검색] [필터] [등록+]` 한 줄. 필터 적용 시 아이콘에 빨간 점
- 필터: 모달 팝업 (구분/국가/OTT/연도/장르/내 별점/정렬). 선택 즉시 결과 수 미리보기
  - 필터 아이콘 옆 **초기화 버튼**(`#clearFilterBtn`)은 필터가 걸렸을 때만 보임 → `clearAllFilters()`
  - `Filters.person`: 상세의 배우·감독 배지 클릭 시 그 사람 작품만 조회 (`filterByPerson`)
  - 별점 필터 값은 문자열: `""`=전체, `"1"~"5"`, `"0"`=별점 없음 (JS에서 `"0"`은 truthy라 동작함)
- 미등록 버튼: 토글식. 0개면 자동 숨김 (`tmdbId` 없는 항목)
- **시즌 미기록 버튼**: `totalSeasons>1`인데 `season`이 빈 항목 (`needsSeason`). 미등록과 별개 —
  TMDB 정보는 있는데 몇 번째 시즌인지만 안 적은 경우. 토글식, 0개면 숨김.
- **매칭 확인 버튼**(`isDupTmdb`): 두 종류를 잡는다.
  ① `seriesNoMismatch` — 내가 적은 시즌 번호와 TMDB 편 번호가 어긋남(예: 범죄도시2를 S2로 적었는데
     tmdbId는 1편 것이라 TMDB가 S1이라고 답함). 제목이 같아서 ②로는 안 잡히는 케이스.
  ② 제목이 서로 다른데 `tmdbId`가 같은 항목 (`dupTmdbIdSet`).
  자동 매칭이 속편에 1편 정보를 물려놨을 때 잡힌다. 시즌은 원래 tmdbId를 공유하므로 제목이 다른 경우만 센다.
  `State._dupIds`에 `applyFilters`마다 한 번 계산. 토글식, 0개면 숨김.
  → 이 세 버튼(미등록/시즌 미기록/매칭 확인)은 서로 배타적으로 토글된다.
- **목록은 평면**: 기록 하나 = 카드 하나. 시즌·시리즈를 카드로 합치지 않는다(포스터가 각각 보이도록).
- **시리즈 보기 토글**(`#seriesBtn`, 필터 버튼 옆): 모달이 아니라 **목록 자리**를 시리즈 카드로 바꾼다
  (`Filters.seriesView` → `renderCards`가 `renderSeriesCards`로 분기). 2편 이상인 그룹만 카드로 표시.
  - 그룹 키(`groupKeyOf`) 1순위 = **TMDB 컬렉션**(`collectionId`) — 제목이 전혀 달라도 같은 시리즈면 묶임.
    예: "브레이킹 던"은 제목에 '트와일라잇'이 없지만 같은 컬렉션이라 잡힌다. 제목 기반으론 불가능한 케이스.
    설정 "시리즈 정보 가져오기"(`runRefreshCollections`)로 채우며, 없으면 안내문구 표시.
  - 같은 버튼이 `/collection/{id}`도 조회해(`tmdbCollection`, 컬렉션당 1회 캐시) 개봉일 순으로
    **몇 번째 편**인지 `seriesNo`/`seriesTotal`에 채운다.
  - `seriesLabel(i)`: 시즌·시리즈 편 번호를 **모두 `S1` 형식으로 통일**해서 표시한다.
    **직접 적은 `season`이 우선**, `seriesNo`는 빈칸을 채울 때만. 속편이 1편의 tmdbId를 물고 있으면
    TMDB는 그 기록을 1편이라 답하므로, seriesNo를 우선하면 사용자가 S3으로 적은 게 S1로 덮인다.
  - 2순위 = `tmdbId` + `title` (같은 작품의 여러 시즌). 제목까지 보는 이유: 자동 매칭이 속편에
    1편 tmdbId를 물려놓는 사고가 있어서 tmdbId만으론 다른 작품이 합쳐진다.
  - 시리즈 카드 클릭 → `Filters.group`으로 그 시리즈 기록만 평면 조회 (`filterBySeries`).
    버튼을 다시 누르면 시리즈 목록으로 복귀(`group` 해제). 검색창은 시리즈 보기에도 그대로 적용됨
    (`State.filtered`를 묶으므로).
  - 상세 하단 "이 시리즈의 다른 편"(`seasonsOf`)에서 형제 편으로 바로 이동.
- 카드 본문: 제목 옆 구분(보라) → 장르(최대 3개, `.wl-genres`) → 날짜. 국가·OTT는 상세에서만.
- 카드 포스터 우상단 세로 스택(`.wl-tr`): TMDB평점(`.wl-vote`) + 그 아래 내 별점 하트(`.wl-myrate`).
  좌상단은 시즌(`.wl-season`). 내 별점=하트 하나+숫자(`hearts()`, 예 ♥4.5). **5점 만점 소수 입력**(`#fRating` number, `readRating()`).
- 상세(큰 화면)엔 본 날짜 + 방영/개봉일 둘 다 표시(방영일은 releaseDate 없으면 releaseYear로 폴백).
- 등록/수정 모달: TMDB 검색 → 선택 시 정보카드 표시 + 폼 자동 채움. 수정 시에도 기존 TMDB 정보 카드 표시됨
  - 등록 시점에 `selectTmdb`가 컬렉션까지 조회해 `seriesNo`/`seriesTotal`을 채운다
    (그래서 새로 등록한 영화도 바로 시리즈에 묶이고 S번호가 붙는다).
  - **주의**: `openEdit`이 `State.selectedTmdb`를 재구성할 때 `collectionId`/`collectionName`/
    `seriesNo`/`seriesTotal`을 반드시 함께 넣어야 한다. 빠뜨리면 수정 저장 시 `saveItem`이
    `t.collectionId || null`로 덮어써서 시리즈 정보가 지워진다.
- 시즌: TMDB 시즌 목록 있으면 드롭다운, 없으면 ± 스테퍼로 폴백
- OTT 입력: 스트리밍 목록은 TMDB가 자동으로 채우므로(`otts`) 직접 기록하는 건 **영화관 체크박스 + 기타 자유입력**뿐.
  - 카드/상세에는 스트리밍 전체 목록(`otts`)을 배지로 표시. "내가 본 곳"(`ott`, 영화관 등)이
    목록에 없으면 앞에 함께 표시 (`ottList()`/`ottBadges()` in watchlog.js). 필터도 `otts` 기준.
- 장르: `visibleGenres()`가 ①`GENRE_KO`로 한글화 ②구분(type)과 겹치는 장르("드라마" 등) 제거
    ③중복 제거. 저장 데이터는 그대로 두고 표시할 때만 변환.
  - TMDB는 **TV 장르 일부를 영어 합본**으로 준다(`Action & Adventure` 등). 이걸 **둘로 쪼개서**
    영화 쪽 장르와 같은 항목으로 합류시킨다: 액션+모험 / SF+판타지 / 전쟁+정치.
    (합본을 한 항목으로 두면 같은 액션물이 영화냐 드라마냐에 따라 갈려서 통계·필터가 쪼개짐.
     영화는 애초에 액션·모험을 따로 주므로 합치는 쪽이 맞다. 예: "액션" 조회 = 영화 70 + 드라마 21)
  - 그래서 `koGenre()`는 **항상 배열**을 반환하고 `visibleGenres()`는 `flatMap`을 쓴다.
- 검색(`matchesQuery`): 제목 + 원제(originalTitle) + 배우(cast) + 감독(director).
- 테마: **연두·세이지**(2026-07-27 보라에서 변경). 배지 색상: 구분=연두, 국가=파랑, OTT=초록, 장르=회색, 시즌=주황, 출연진=핑크, 평점=노랑, 등급=빨강, 시간=청록
  - 이 색상 클래스(`.badge-type` 등)는 **style.css**에 파스텔로 정의됨 (예전엔 정의 누락→검정 텍스트였음).
- 폰트 Pretendard(CDN), 배경 파스텔 그라데이션. 정적 파일 링크에 `?v=YYYYMMDD` 캐시버스팅.

설계 원칙: TMDB에서 온 정보든 직접 입력한 정보든 조회 화면에서 구분되지 않아야 함.

## 통계 탭

요약 타일 6개(시청 기록(편·시즌별) / 작품 수(시리즈 묶음) / 올해 시청 / 재시청 / 평균 별점 / 예상 시청시간).
차트들은 낱개 기록 기준으로 집계(시즌별로 장르·OTT가 같으므로 의도된 동작).
월별 막대(전체) / 장르 도넛 / 구분 도넛 /
국가 가로막대 / OTT 가로막대 / 배우 TOP10 / 감독 TOP10 / 별점 분포(하트) /
**연도별 막대 · GitHub 잔디 히트맵은 맨 아래**.
탭 전환 시 탭별 스크롤 위치를 기억해 복원 (`initTabs` in core.js).

히트맵은 `startDate~endDate`와 `lastWatchStart~lastWatchEnd` 범위를 날짜 단위로 펼쳐서 집계.

장르 차트는 **도넛**. 한 작품이 장르를 여러 개 가지므로(268작품 → 태그 687개) 분모를 "작품 수"가 아니라
**전체 장르 태그 수**로 잡아야 조각 합이 100%가 된다. 툴팁·안내문구에 그렇게 표시.

장르별 통계는 `visibleGenres` 적용(드라마 등 구분 중복 제외). 모든 차트는 클릭하면
`jumpToList(patch)`로 해당 조건(연도/장르/구분/국가/OTT/별점) 필터를 걸고 목록 탭으로 이동
(결과 0건이면 원복). 별점 필터는 `Filters.rating` (필터 모달엔 없고 차트 클릭 전용).

## 알려진 이슈 / 남은 작업

- [ ] 노션 원본 268개 중 별점은 9개, 한줄평은 7개뿐 → 나머지는 수기 입력 필요
- [x] ~~시즌 묶기~~ → 표시 전용 그룹핑으로 해결 (위 "시즌 묶기" 참고). 데이터는 시즌별로 유지.
- [x] ~~속편이 1편과 같은 `tmdbId`~~ → 2026-07-27 사용자가 직접 재매칭해 해결.
      제목이 다른데 tmdbId가 같은 항목 0개 확인.
- [ ] TMDB 검색 실패 시 Gemini API로 원제 추론하는 방안 논의됐으나 미적용
- [ ] `favicon.ico` 없음 (404 로그)
- [ ] 항목 수가 많아지면 카드 렌더링 최적화 필요 (현재 24개씩 더보기)

## 배포

GitHub Pages. 파일을 저장소 루트에 복붙 업로드. 파일명·경로가 정확해야 함 (`tmdb (1).js` 같은 중복 다운로드명 주의).
