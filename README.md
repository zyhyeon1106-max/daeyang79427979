# 대양초등학교 7942 학급 독서 미션

## 저장 방식
이 버전은 Render의 임시 파일(SQLite)에 기록하지 않고 Supabase PostgreSQL에 모든 학급/독서 기록을 저장합니다.
따라서 Render 무료 Web Service가 잠들거나 재시작/재배포되어도 기록이 유지됩니다.

## 필수 Render 환경변수
- `DATABASE_URL`: Supabase > Connect > Session pooler > URI
- `ADMIN_KEY`: 관리자 비밀번호(선택, 미설정 시 기본값 `daeyang7942`)

`DATABASE_URL`은 GitHub 코드에 넣지 마세요.

## Render 설정
- Build Command: `npm install`
- Start Command: `npm start`

## 행사 기간
- 2026.10.12.(월) ~ 2026.10.23.(금)
- 시작 전: 시작까지 D-day 표시
- 진행 중: 행사 n일째 + 종료까지 D-day 표시
- 종료 후: 행사 종료 표시

## 데이터 구조
- `classes`: 학급, PIN 해시, 선택 미션, 누적 시간/쪽수
- `records`: 학생별 독서 기록
- `sessions`: 학급 로그인 세션

## 주의
`reading_mission.db` 및 `node_modules`는 GitHub에 올리지 않습니다.
