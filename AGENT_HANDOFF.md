# 프로젝트 인수인계서 (Agent Handoff)

## 1. 프로젝트 개요
- **목적**: 천군교회 예배당 공기계(태블릿/스마트폰)에 설치할 **예배 출석체크 키오스크 웹앱(PWA)**
- **현재 상태**: **1차 프론트엔드 + 2차 백엔드 연동 완성**
  1. **오프라인 우선(Local-First) + 클라우드 실시간 동기화**: 기기(IndexedDB)에 즉시 저장 후 백그라운드 큐(`syncQueue`)를 통해 Google Apps Script 백엔드(Google Sheets DB + Google Drive 사진 폴더)와 자동 동기화
  2. **매주 일요일 13:00 자동 이메일 발송**: 지난 일요일 13:00 초과 ~ 이번 일요일 13:00 이하 기간 중 누적 출석이 **24의 배수**를 달성한 용사 명단 + 최근 24회분 인증 사진 **개별 첨부** + 부대별(화/수/일) 출석 통계 (첨부 용량이 18MB를 초과할 경우 달성자별 분할 발송 지원)
  3. **`[경고-확인필요]` 즉시 이메일 발송**: 같은 날·같은 부대·같은 이름으로 2번 이상 찍히거나 재출석/재등록 시도 발생 시 관련 사진과 함께 즉시 발송
  4. **발신/수신 계정 연동**: 발신 `cgchurch@gmail.com` / 수신 `crossyoman@gmail.com` (관리자 설정 탭에서 변경 시 서버에도 즉시 반영)
  5. **기기 초기화/교체 원클릭 복구**: 서버에서 전체 명단·출석·사진을 내려받는 전체 복원 기능 및 빈 기기 부팅 시 자동 복원 지원

## 2. 폴더 및 파일 구조
- `index.html`, `manifest.json`, `sw.js`, `icon.svg`
- `css/style.css`: 키오스크 및 관리자 스타일
- `js/config.js`: 11개 소속 부대 편성(`본부근무대`, `정보통신대`, `단본부`, `단통신`, `8급양대`, `18보급대대`, `608본부`, `608중형`, `608버스`, `608대형`, `78정비대대` — 중대 2차 질문 없이 1차 선택으로 바로 진입), 기본 관리자/백엔드 비밀번호, 이메일, 기본 백엔드 URL(`defaultApiUrl`), 기준값 설정
- `js/db.js`: IndexedDB 래퍼 (`members`, `attendance`, `photos`, `mileage`, `discharged`, `warnings`, `settings`, `syncQueue`)
- `js/store.js`: 데이터 CRUD 계층 (로컬 IndexedDB 저장 + `Backend.enqueue` 자동 호출 + 서버 사진 지연 로딩 캐시)
- `js/api.js`: Google Apps Script 웹앱 통신, 오프라인 동기화 큐(`syncQueue`), 서버 전체 업로드/복원, 즉시 메일 발송 API
- `js/camera.js`: 전면 카메라 촬영, 3초 타이머/셔터음, `yyyy-mm-dd hh:mm 이름` 워터마크 합성, 500KB 이하 JPEG 압축
- `js/report.js`: 일요일 13:00 기준 주간 리포트 및 `[경고-확인필요]` 본문 생성
- `js/app.js`: 용사용 키오스크 화면
- `js/admin.js`: 목사님 전용 화면 (주간 리포트 서버 즉시 발송, 경고 서버 메일 발송, 형제 관리, 수동 출석, 마일리지, 엑셀 일괄 등록, 전역자 보관함, 백엔드 서버 설정/동기화/복원)
- `backend/Code.gs`, `backend/appsscript.json`: Google Apps Script 서버 코드 (Google Sheets DB + Drive 사진 보관 + Gmail 자동 발송 + 일요일 13:00 트리거)
- `백엔드_연동_안내.md`, `사용안내.md`: 설치 및 백엔드 배포 안내 문서
- `templates/명단_일괄등록_양식.xlsx`: 초기 명단 일괄 등록용 엑셀 양식 (`tools/make_template.py`로 생성)
