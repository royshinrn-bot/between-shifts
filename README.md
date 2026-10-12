# Between Shifts

Roy's hub page: apps, KDP books, illustration and design made between shifts.

## 카드 추가하기
1. `images` 폴더에 썸네일을 올린다 (예: `moa-blocks.jpg`).
2. `index.html`의 `const ITEMS = [` 아래에 카드 하나를 추가한다.
3. Commit 하면 Vercel이 자동으로 다시 배포한다.

## 프로필 사진
`images`에 사진을 올리고 `index.html`의 `const PROFILE_PHOTO = "";` 안에 경로를 적는다 (예: `"images/roy.jpg"`).

## 스케치북 게시판 (Sketchbook)
프로젝트 카드 아래에 그림만 따로 모아 보여 주는 게시판. 그림이 한 장이라도 있어야 방문자에게 보인다.

**그림 올리기:** 폰에서 `https://between-shifts.vercel.app/#post` 를 열고 그림 고르기 → 설명(선택) → 비밀번호 → 올리기. 비밀번호는 그 기기에 기억된다. 홈 화면에 이 주소를 추가해 두면 편하다. 지우기는 같은 화면에서 그림 위 × 버튼.

**처음 한 번만 설정 (Vercel 대시보드):**
1. 프로젝트 → Storage → Create → Blob, 접근 방식 **Public**으로 만들고 이 프로젝트에 연결 (BLOB_READ_WRITE_TOKEN 자동 생성)
2. Settings → Environment Variables → `SKETCH_PASSWORD` 추가 (8자 이상, 다른 곳에 안 쓰는 비밀번호)
3. Deployments → 최신 배포 → Redeploy (환경 변수는 다시 배포해야 적용됨)

서버 코드는 `api/sketches.js`. 방문자에게는 목록을 1시간 캐시해서 보여 준다 (Blob 무료 한도: 목록 조회 월 2,000번). 올릴 때 브라우저에서 원본(긴 변 2000px)과 썸네일(720px) JPG로 줄여서 보낸다.
