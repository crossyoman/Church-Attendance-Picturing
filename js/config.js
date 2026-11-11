/* =========================================================
 * 천군교회 예배 출석체크 - 기본 설정
 * 부대/중대가 바뀌면 이 파일의 units 만 수정하면 됩니다.
 * ========================================================= */
const CONFIG = {
  churchName: '천군교회',

  // 소속 부대 (한 번만 선택합니다. 화면에 이 순서대로 표시됩니다)
  // ※ 이름을 바꾸면 이미 등록된 형제들의 소속과 맞지 않게 되니, 운영 중에는 추가만 해 주세요.
  units: [
    { name: '본부근무대' },
    { name: '정보통신대' },
    { name: '단본부' },
    { name: '단통신' },
    { name: '8급양대' },
    { name: '18보급대대' },
    { name: '608본부' },
    { name: '608중형' },
    { name: '608버스' },
    { name: '608대형' },
    { name: '78정비대대' },
  ],

  defaultPassword: '0113',               // 목사님 전용 비밀번호 (설정 탭에서 변경 가능)
  defaultAdminEmail: 'crossyoman@gmail.com', // 리포트 받는 이메일
  defaultSenderEmail: 'cgchurch@gmail.com',  // 리포트 보내는 이메일 (백엔드 연동 시 사용)
  defaultApiUrl: '',                     // Google Apps Script 웹앱 배포 URL (설정 탭에서도 입력 가능)

  mileageUnit: 24,          // 예배 24회 = 마일리지(휴가) 1일
  longAbsentMonths: 3,      // 3개월 이상 미출석 → '오랜만에 왔어요' 명단으로
  photoMaxBytes: 500 * 1024,// 사진 최대 용량 약 500KB
  photoMaxSide: 1280,       // 사진 긴 변 최대 픽셀
  countdownSeconds: 0,      // 촬영 타이머 (0 = 버튼 누르는 즉시 찰칵)
  idleSeconds: 60,          // 아무 조작 없으면 첫 화면으로 (초)
  adminIdleSeconds: 300,    // 목사님 화면 자동 잠금 (초)
  reportWeekday: 0,         // 리포트 기준 요일 (0 = 일요일)
  reportHour: 13,           // 리포트 기준 시각 (13:00)
};
