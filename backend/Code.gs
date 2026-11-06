/**
 * ============================================================================
 * 천군교회 예배 출석체크 - Google Apps Script 백엔드 (Code.gs)
 * ============================================================================
 * [역할]
 * 1. 서버 DB (Google 스프레드시트 '천군교회_예배출석_DB') 자동 생성 및 다중 기기(공기계 ↔ 교회 데스크탑) 실시간 동기화
 * 2. 사진 스토리지 (Google 드라이브 '천군교회_출석사진' 폴더) 영구 보관
 * 3. 백엔드 전용 비밀번호(초기값 0113, 변경 가능) 보호:
 *    - 비밀번호는 구글 시트에 노출되지 않고 ScriptProperties 보안 영역에만 암호화/비공개 저장됨
 *    - 봉사자 등이 공유 노트북(cgchurch@gmail.com)에서 백엔드 URL에 접속해도 비밀번호(0113) 없이는 접근 불가
 * 4. 매주 일요일 13:00 주간 리포트 자동 이메일 발송
 *    - 지난 일요일 13:00 초과 ~ 이번 일요일 13:00 이하
 *    - 24의 배수 달성 용사 명단 + 최근 24회분 인증 사진 개별 첨부 + 부대별(화/수/일) 출석 통계
 * 5. [경고-확인필요] 중복 출석 / 재출석·재등록 시도 발생 즉시 이메일 발송 (관련 사진 첨부)
 * 6. 발신: cgchurch@gmail.com (스크립트 실행 계정) / 수신: crossyoman@gmail.com (설정에서 변경 가능)
 * ============================================================================
 */

const APP_CONFIG = {
  churchName: '천군교회',
  dbFileName: '천군교회_예배출석_DB',
  photoFolderName: '천군교회_출석사진',
  defaultPassword: '0113',        // 키오스크 목사님 전용 화면 비밀번호 초기값
  defaultBackendPassword: '0113', // 백엔드 서버 접근/관리 비밀번호 초기값
  defaultAdminEmail: 'crossyoman@gmail.com',
  defaultSenderEmail: 'cgchurch@gmail.com',
  mileageUnit: 24,
  reportWeekday: 0, // 0 = 일요일
  reportHour: 13,   // 13:00
  // ※ js/config.js 의 units 와 반드시 같은 순서·이름으로 맞춰 주세요 (리포트 부대 순서에 사용)
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
};

const SHEET_DEFS = {
  members: ['id', 'name', 'unit', 'company', 'dischargeDate', 'baseCount', 'baseGrantedBlocks', 'baseLastDate', 'createdAt', 'json'],
  attendance: ['id', 'memberId', 'date', 'time', 'ts', 'fileName', 'unitLabel', 'memberName', 'manual', 'reason', 'hasPhoto', 'retakes', 'photoFileId', 'createdAt', 'json'],
  mileage: ['id', 'memberId', 'memberName', 'unitLabel', 'proposedDate', 'fromCount', 'uptoCount', 'days', 'memo', 'createdAt', 'json'],
  discharged: ['id', 'name', 'unit', 'company', 'dischargeDate', 'movedAt', 'json'],
  warnings: ['id', 'type', 'date', 'unitLabel', 'name', 'detail', 'resolved', 'resolvedAt', 'memo', 'emailSent', 'createdAt', 'json'],
  settings: ['key', 'value'],
};

const WEEK_KO = ['일', '월', '화', '수', '목', '금', '토'];

/* ============================================================================
 * 0. 백엔드 비밀번호 및 변경 리비전(syncRev) 관리 (ScriptProperties 비공개 저장)
 * ============================================================================ */

function getBackendPassword() {
  const props = PropertiesService.getScriptProperties();
  return props.getProperty('BACKEND_PASSWORD') || APP_CONFIG.defaultBackendPassword;
}

function getAdminPin() {
  const props = PropertiesService.getScriptProperties();
  return props.getProperty('ADMIN_PASSWORD') || APP_CONFIG.defaultPassword;
}

function setAdminPin(pin) {
  if (!pin) return;
  PropertiesService.getScriptProperties().setProperty('ADMIN_PASSWORD', String(pin).trim());
}

function verifyBackendPassword(inputPw) {
  return String(inputPw || '').trim() === String(getBackendPassword()).trim();
}

function requireBackendAuth(authPw) {
  if (!verifyBackendPassword(authPw)) {
    throw new Error('백엔드 비밀번호(초기 0113)가 올바르지 않습니다.');
  }
}

function changeBackendPasswordOnServer(currentPw, newPw) {
  requireBackendAuth(currentPw);
  const cleaned = String(newPw || '').trim();
  if (!/^\d{4,8}$/.test(cleaned)) {
    throw new Error('새 백엔드 비밀번호는 숫자 4~8자리로 입력해 주세요.');
  }
  PropertiesService.getScriptProperties().setProperty('BACKEND_PASSWORD', cleaned);
  bumpSyncRev();
  return { changed: true };
}

function getSyncRev() {
  const props = PropertiesService.getScriptProperties();
  return Number(props.getProperty('SYNC_REV') || '1');
}

function bumpSyncRev() {
  const now = Date.now();
  PropertiesService.getScriptProperties().setProperty('SYNC_REV', String(now));
  return now;
}

/* ============================================================================
 * 1. 웹앱 엔드포인트 (doGet / doPost)
 *    - 브라우저로 직접 접속 시: 비밀번호(0113)를 입력해야 열리는 보안 콘솔 제공
 * ============================================================================ */

function doGet(e) {
  const params = (e && e.parameter) || {};
  if (params.action === 'ping') {
    return jsonOut({ ok: true, app: 'cheongun-attendance-backend', syncRev: getSyncRev() });
  }
  return HtmlService.createHtmlOutput(getBackendConsoleHtml())
    .setTitle('천군교회 출석체크 백엔드 관리')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const action = body.action;
    const payload = body.payload || {};
    const authPw = body.backendPassword ?? payload.backendPassword ?? '';
    const result = handleAction(action, payload, authPw);
    return jsonOut({ ok: true, syncRev: getSyncRev(), ...result });
  } catch (err) {
    console.error('doPost Error:', err);
    return jsonOut({ ok: false, error: String(err && err.message ? err.message : err) });
  } finally {
    lock.releaseLock();
  }
}

function jsonOut(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Google Apps Script 웹 콘솔에서 호출하는 내부 함수 (google.script.run 용)
 */
function consoleRequest(action, payload, authPw) {
  requireBackendAuth(authPw);
  return handleAction(action, payload || {}, authPw);
}

/* ============================================================================
 * 2. 액션 라우터
 * ============================================================================ */

function handleAction(action, p, authPw) {
  // 관리자 전용 민감 작업은 백엔드 비밀번호 검증 필수
  const ADMIN_PROTECTED_ACTIONS = [
    'status',
    'setupTrigger',
    'saveSettings',
    'changeBackendPassword',
    'deleteMember',
    'deleteAttendance',
    'sendWeeklyReport',
    'sendWarningEmail',
    'pushAll',
  ];
  if (ADMIN_PROTECTED_ACTIONS.indexOf(action) >= 0) {
    requireBackendAuth(authPw);
  }

  switch (action) {
    case 'ping':
      return { syncRev: getSyncRev() };

    case 'checkSync':
      return { syncRev: getSyncRev() };

    case 'verifyBackendPassword':
      requireBackendAuth(authPw);
      return { verified: true, status: getServerStatus() };

    case 'changeBackendPassword':
      return changeBackendPasswordOnServer(authPw, p.newPassword);

    case 'status':
      return { status: getServerStatus() };

    case 'setupTrigger':
      installTriggers();
      return { status: getServerStatus() };

    case 'saveSettings':
      return { settings: saveSettingsOnServer(p) };

    case 'upsertMember':
      upsertRow('members', p.member);
      bumpSyncRev();
      return { id: p.member.id };

    case 'upsertMembersBatch':
      (p.members || []).forEach(m => upsertRow('members', m));
      bumpSyncRev();
      return { count: (p.members || []).length };

    case 'deleteMember':
      deleteMemberOnServer(p.id);
      bumpSyncRev();
      return { id: p.id };

    case 'recordAttendance': {
      const r = recordAttendanceOnServer(p.attendance, p.photoDataUrl);
      bumpSyncRev();
      return r;
    }

    case 'replacePhoto': {
      const r = replacePhotoOnServer(p.attendance, p.photoDataUrl);
      bumpSyncRev();
      return r;
    }

    case 'cancelAttendance':
      cancelAttendanceOnServer(p.attId, p.removeNewMember, p.memberId);
      bumpSyncRev();
      return { attId: p.attId };

    case 'deleteAttendance':
      deleteAttendanceOnServer(p.id);
      bumpSyncRev();
      return { id: p.id };

    case 'uploadPhoto':
      requireBackendAuth(authPw);
      return uploadPhotoOnServer(p.attId, p.fileName, p.photoDataUrl);

    case 'getPhoto':
      return { dataUrl: getPhotoDataUrlByAttId(p.id) };

    case 'addWarning': {
      const r = addWarningOnServer(p.warning, p.photos || {}, p.sendEmail !== false);
      bumpSyncRev();
      return r;
    }

    case 'resolveWarning':
      resolveWarningOnServer(p.id, p.memo, p.resolvedAt);
      bumpSyncRev();
      return { id: p.id };

    case 'sendWarningEmail':
      return sendWarningEmailById(p.id, p.photos || {});

    case 'addGrant':
      upsertRow('mileage', p.grant);
      bumpSyncRev();
      return { id: p.grant.id };

    case 'deleteGrant':
      deleteRowById('mileage', p.id);
      bumpSyncRev();
      return { id: p.id };

    case 'processDischarges': {
      const moved = processDischargesOnServer(p.today);
      if (moved) bumpSyncRev();
      return { moved };
    }

    case 'restoreDischarged':
      restoreDischargedOnServer(p.id, p.newDischargeDate);
      bumpSyncRev();
      return { id: p.id };

    case 'sendWeeklyReport':
      return sendWeeklyReportEmail(p.cutoffMs ? new Date(p.cutoffMs) : getLastCutoff(new Date()), p.achieverOnlyId || null, true);

    case 'pullAll':
      return { data: exportAllFromServer(!!p.includePhotos, verifyBackendPassword(authPw)) };

    case 'pushAll':
      importAllToServer(p.data || {});
      bumpSyncRev();
      return { status: getServerStatus() };

    default:
      throw new Error('알 수 없는 요청입니다: ' + action);
  }
}

/* ============================================================================
 * 3. 스프레드시트 & 드라이브 초기화 및 입출력 도우미
 * ============================================================================ */

function getOrCreateDb() {
  const props = PropertiesService.getScriptProperties();
  let ssId = props.getProperty('DB_SPREADSHEET_ID');
  let ss = null;
  if (ssId) {
    try { ss = SpreadsheetApp.openById(ssId); } catch (e) { ss = null; }
  }
  if (!ss) {
    const files = DriveApp.getFilesByName(APP_CONFIG.dbFileName);
    if (files.hasNext()) {
      ss = SpreadsheetApp.open(files.next());
    } else {
      ss = SpreadsheetApp.create(APP_CONFIG.dbFileName);
    }
    props.setProperty('DB_SPREADSHEET_ID', ss.getId());
  }

  Object.keys(SHEET_DEFS).forEach(name => {
    let sh = ss.getSheetByName(name);
    const headers = SHEET_DEFS[name];
    if (!sh) {
      sh = ss.insertSheet(name);
      sh.appendRow(headers);
      sh.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#1f3a5f').setFontColor('#ffffff');
      sh.setFrozenRows(1);
      // 실수로 봉사자가 시트를 건드릴 때 경고 표시
      try { sh.protect().setDescription('천군교회 출석체크 자동 DB 시트').setWarningOnly(true); } catch (e) {}
    } else if (sh.getLastRow() === 0) {
      sh.appendRow(headers);
    }
  });

  ['시트1', 'Sheet1'].forEach(defName => {
    const def = ss.getSheetByName(defName);
    if (def && ss.getSheets().length > 1 && def.getLastRow() <= 1) {
      try { ss.deleteSheet(def); } catch (e) {}
    }
  });

  return ss;
}

function getOrCreatePhotoFolder() {
  const props = PropertiesService.getScriptProperties();
  let folderId = props.getProperty('PHOTO_FOLDER_ID');
  if (folderId) {
    try { return DriveApp.getFolderById(folderId); } catch (e) {}
  }
  const it = DriveApp.getFoldersByName(APP_CONFIG.photoFolderName);
  const folder = it.hasNext() ? it.next() : DriveApp.createFolder(APP_CONFIG.photoFolderName);
  props.setProperty('PHOTO_FOLDER_ID', folder.getId());
  return folder;
}

function readAllObjects(sheetName) {
  const ss = getOrCreateDb();
  const sh = ss.getSheetByName(sheetName);
  const lastRow = sh.getLastRow();
  if (lastRow <= 1) return [];
  const headers = SHEET_DEFS[sheetName];
  const jsonIdx = headers.indexOf('json');
  const values = sh.getRange(2, 1, lastRow - 1, headers.length).getValues();
  const out = [];
  for (let i = 0; i < values.length; i++) {
    const row = values[i];
    if (!row[0]) continue;
    if (jsonIdx >= 0 && row[jsonIdx]) {
      try {
        out.push(JSON.parse(row[jsonIdx]));
        continue;
      } catch (e) {}
    }
    const obj = {};
    headers.forEach((h, c) => { if (h !== 'json') obj[h] = row[c]; });
    out.push(obj);
  }
  return out;
}

function findRowIndexById(sh, id) {
  const lastRow = sh.getLastRow();
  if (lastRow <= 1) return -1;
  const ids = sh.getRange(2, 1, lastRow - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(id)) return i + 2;
  }
  return -1;
}

function getObjectById(sheetName, id) {
  const ss = getOrCreateDb();
  const sh = ss.getSheetByName(sheetName);
  const r = findRowIndexById(sh, id);
  if (r < 0) return null;
  const headers = SHEET_DEFS[sheetName];
  const row = sh.getRange(r, 1, 1, headers.length).getValues()[0];
  const jsonIdx = headers.indexOf('json');
  if (jsonIdx >= 0 && row[jsonIdx]) {
    try { return JSON.parse(row[jsonIdx]); } catch (e) {}
  }
  const obj = {};
  headers.forEach((h, c) => { if (h !== 'json') obj[h] = row[c]; });
  return obj;
}

function upsertRow(sheetName, obj) {
  if (!obj || !obj.id) return;
  const ss = getOrCreateDb();
  const sh = ss.getSheetByName(sheetName);
  const headers = SHEET_DEFS[sheetName];
  const rowData = headers.map(h => {
    if (h === 'json') return JSON.stringify(obj);
    const v = obj[h];
    return v === undefined || v === null ? '' : v;
  });
  const r = findRowIndexById(sh, obj.id);
  if (r > 0) {
    sh.getRange(r, 1, 1, headers.length).setValues([rowData]);
  } else {
    sh.appendRow(rowData);
  }
}

function deleteRowById(sheetName, id) {
  const ss = getOrCreateDb();
  const sh = ss.getSheetByName(sheetName);
  const r = findRowIndexById(sh, id);
  if (r > 0) sh.deleteRow(r);
}

function clearAndWriteSheet(sheetName, list) {
  const ss = getOrCreateDb();
  const sh = ss.getSheetByName(sheetName);
  const headers = SHEET_DEFS[sheetName];
  sh.clearContents();
  sh.appendRow(headers);
  if (!list || !list.length) return;
  const rows = list.map(obj => headers.map(h => {
    if (h === 'json') return JSON.stringify(obj);
    const v = obj[h];
    return v === undefined || v === null ? '' : v;
  }));
  sh.getRange(2, 1, rows.length, headers.length).setValues(rows);
}

/* ---------- 설정 (비밀번호는 시트에 기록하지 않고 ScriptProperties에 분리 보관) ---------- */
function getSettingsFromServer() {
  const ss = getOrCreateDb();
  const sh = ss.getSheetByName('settings');
  const lastRow = sh.getLastRow();
  const map = {
    password: getAdminPin(),
    adminEmail: APP_CONFIG.defaultAdminEmail,
    senderEmail: APP_CONFIG.defaultSenderEmail,
  };
  if (lastRow > 1) {
    const rows = sh.getRange(2, 1, lastRow - 1, 2).getValues();
    rows.forEach(([k, v]) => {
      if (k && k !== 'password' && k !== 'backendPassword') map[k] = String(v);
    });
  }
  return map;
}

function saveSettingsOnServer(patch) {
  if (patch && patch.password) {
    setAdminPin(patch.password);
  }
  const cur = Object.assign(getSettingsFromServer(), patch || {});
  const ss = getOrCreateDb();
  const sh = ss.getSheetByName('settings');
  sh.clearContents();
  sh.appendRow(['key', 'value']);
  // 시트에는 비밀번호를 절대 저장하지 않음 (노트북에서 시트를 열어도 비밀번호 노출 방지)
  const rows = Object.keys(cur)
    .filter(k => k !== 'password' && k !== 'backendPassword')
    .map(k => [k, String(cur[k] ?? '')]);
  if (rows.length) sh.getRange(2, 1, rows.length, 2).setValues(rows);
  bumpSyncRev();
  return cur;
}

/* ============================================================================
 * 4. 사진 저장 / 조회 / 삭제 (Google Drive)
 * ============================================================================ */

function safeFileName(s) {
  return String(s || 'photo').replace(/:/g, '-').replace(/[\\/*?"<>|]/g, '_');
}

function savePhotoToDrive(att, dataUrl) {
  if (!dataUrl) return null;
  const m = String(dataUrl).match(/^data:([^;]+);base64,(.+)$/);
  const mime = m ? m[1] : 'image/jpeg';
  const b64 = m ? m[2] : dataUrl;
  const bytes = Utilities.base64Decode(b64);
  const name = safeFileName(att.fileName || `${att.date} ${att.time} ${att.memberName || ''}`) + '.jpg';
  const blob = Utilities.newBlob(bytes, mime, name);
  const folder = getOrCreatePhotoFolder();
  const file = folder.createFile(blob);
  file.setDescription(`attendanceId:${att.id}`);
  return file.getId();
}

function trashPhotoFile(fileId) {
  if (!fileId) return;
  try { DriveApp.getFileById(fileId).setTrashed(true); } catch (e) {}
}

function getPhotoBlobByAtt(att) {
  if (!att) return null;
  if (att.photoFileId) {
    try {
      const f = DriveApp.getFileById(att.photoFileId);
      if (!f.isTrashed()) {
        return f.getBlob().setName(safeFileName(att.fileName || f.getName()) + '.jpg');
      }
    } catch (e) {}
  }
  try {
    const folder = getOrCreatePhotoFolder();
    const targetName = safeFileName(att.fileName) + '.jpg';
    const files = folder.getFilesByName(targetName);
    if (files.hasNext()) {
      const f = files.next();
      return f.getBlob().setName(targetName);
    }
  } catch (e) {}
  return null;
}

function getPhotoDataUrlByAttId(attId) {
  let att = getObjectById('attendance', attId);
  if (!att) {
    const disList = readAllObjects('discharged');
    for (let i = 0; i < disList.length; i++) {
      const found = (disList[i].attendances || []).find(x => x.id === attId);
      if (found) { att = found; break; }
    }
  }
  const blob = getPhotoBlobByAtt(att);
  if (!blob) return null;
  const b64 = Utilities.base64Encode(blob.getBytes());
  return `data:${blob.getContentType() || 'image/jpeg'};base64,${b64}`;
}

/* ============================================================================
 * 5. 출석 / 형제 / 전역자 / 경고 처리
 * ============================================================================ */

function recordAttendanceOnServer(att, photoDataUrl) {
  if (!att || !att.id) throw new Error('출석 데이터가 올바르지 않습니다.');
  const existing = getObjectById('attendance', att.id);
  if (photoDataUrl) {
    if (existing && existing.photoFileId) trashPhotoFile(existing.photoFileId);
    att.photoFileId = savePhotoToDrive(att, photoDataUrl);
    att.hasPhoto = true;
  } else if (existing && existing.photoFileId) {
    att.photoFileId = existing.photoFileId;
  }
  upsertRow('attendance', att);
  return { id: att.id, photoFileId: att.photoFileId || null };
}

function replacePhotoOnServer(att, photoDataUrl) {
  return recordAttendanceOnServer(att, photoDataUrl);
}

function uploadPhotoOnServer(attId, fileName, photoDataUrl) {
  if (!attId || !photoDataUrl) return { id: attId, uploaded: false };
  const att = getObjectById('attendance', attId);
  if (att) {
    if (att.photoFileId) {
      try {
        const f = DriveApp.getFileById(att.photoFileId);
        if (!f.isTrashed()) return { id: attId, photoFileId: att.photoFileId, skipped: true };
      } catch (e) {}
    }
    att.photoFileId = savePhotoToDrive(att, photoDataUrl);
    att.hasPhoto = true;
    upsertRow('attendance', att);
    return { id: attId, photoFileId: att.photoFileId, uploaded: true };
  }
  const fileId = savePhotoToDrive({ id: attId, fileName: fileName || attId }, photoDataUrl);
  return { id: attId, photoFileId: fileId, uploaded: true };
}

function deleteAttendanceOnServer(attId) {
  const existing = getObjectById('attendance', attId);
  if (existing && existing.photoFileId) trashPhotoFile(existing.photoFileId);
  deleteRowById('attendance', attId);
}

function cancelAttendanceOnServer(attId, removeNewMember, memberId) {
  const existing = getObjectById('attendance', attId);
  const targetMemberId = memberId || (existing && existing.memberId);
  deleteAttendanceOnServer(attId);
  if (removeNewMember && targetMemberId) {
    const rest = readAllObjects('attendance').filter(a => a.memberId === targetMemberId);
    const m = getObjectById('members', targetMemberId);
    if (!rest.length && m && !m.baseCount) {
      deleteRowById('members', targetMemberId);
    }
  }
}

function deleteMemberOnServer(memberId) {
  const atts = readAllObjects('attendance').filter(a => a.memberId === memberId);
  atts.forEach(a => deleteAttendanceOnServer(a.id));
  const grants = readAllObjects('mileage').filter(g => g.memberId === memberId);
  grants.forEach(g => deleteRowById('mileage', g.id));
  deleteRowById('members', memberId);
}

function processDischargesOnServer(todayStrOverride) {
  const today = todayStrOverride || fmtDateKST(new Date());
  const members = readAllObjects('members');
  const allAtts = readAllObjects('attendance');
  const allGrants = readAllObjects('mileage');
  let moved = 0;

  members.forEach(m => {
    if (m.dischargeDate && m.dischargeDate < today) {
      const atts = allAtts.filter(a => a.memberId === m.id);
      const grants = allGrants.filter(g => g.memberId === m.id);
      const disObj = Object.assign({}, m, {
        attendances: atts,
        mileage: grants,
        movedAt: today,
      });
      upsertRow('discharged', disObj);
      atts.forEach(a => deleteRowById('attendance', a.id));
      grants.forEach(g => deleteRowById('mileage', g.id));
      deleteRowById('members', m.id);
      moved++;
    }
  });
  return moved;
}

function restoreDischargedOnServer(id, newDischargeDate) {
  const d = getObjectById('discharged', id);
  if (!d) return;
  const attendances = d.attendances || [];
  const mileage = d.mileage || [];
  const m = Object.assign({}, d);
  delete m.attendances;
  delete m.mileage;
  delete m.movedAt;
  m.dischargeDate = newDischargeDate;
  upsertRow('members', m);
  attendances.forEach(a => upsertRow('attendance', a));
  mileage.forEach(g => upsertRow('mileage', g));
  deleteRowById('discharged', id);
}

/* ============================================================================
 * 6. [경고-확인필요] 기록 및 즉시 이메일 발송
 * ============================================================================ */

function addWarningOnServer(w, inlinePhotos, sendEmailNow) {
  if (!w || !w.id) throw new Error('경고 데이터가 없습니다.');
  const existing = getObjectById('warnings', w.id);
  if (existing && existing.emailSent) {
    w.emailSent = true;
  }
  upsertRow('warnings', w);

  let emailSent = !!(w.emailSent);
  let emailError = null;
  if (sendEmailNow && !emailSent) {
    try {
      const res = sendWarningEmailInternal(w, inlinePhotos || {});
      emailSent = res.sent;
      w.emailSent = emailSent;
      w.emailSentAt = Date.now();
      upsertRow('warnings', w);
    } catch (err) {
      emailError = String(err && err.message ? err.message : err);
      console.error('Warning email error:', emailError);
    }
  }
  return { id: w.id, emailSent, emailError };
}

function resolveWarningOnServer(id, memo, resolvedAt) {
  const w = getObjectById('warnings', id);
  if (!w) return;
  w.resolved = true;
  w.resolvedAt = resolvedAt || Date.now();
  w.memo = memo || '';
  upsertRow('warnings', w);
}

function sendWarningEmailById(warningId, inlinePhotos) {
  const w = getObjectById('warnings', warningId);
  if (!w) throw new Error('해당 경고 기록을 서버에서 찾을 수 없습니다.');
  const res = sendWarningEmailInternal(w, inlinePhotos || {});
  w.emailSent = res.sent;
  w.emailSentAt = Date.now();
  upsertRow('warnings', w);
  bumpSyncRev();
  return { id: w.id, emailSent: res.sent, to: res.to };
}

function sendWarningEmailInternal(w, inlinePhotos) {
  const settings = getSettingsFromServer();
  const to = settings.adminEmail || APP_CONFIG.defaultAdminEmail;
  const allAtts = readAllObjects('attendance');
  const atts = (w.attendanceIds || [])
    .map(id => allAtts.find(a => a.id === id))
    .filter(Boolean);

  const subject = `[경고-확인필요] ${w.date} ${w.unitLabel} ${w.name} (${APP_CONFIG.churchName})`;
  const lines = [
    `[경고-확인필요] ${APP_CONFIG.churchName} 출석 중복/재시도 알림`,
    '',
    `- 날짜: ${w.date}`,
    `- 소속: ${w.unitLabel}`,
    `- 이름: ${w.name}`,
    `- 내용: ${w.detail}`,
    `- 발생 시각: ${fmtDateTimeKST(new Date(w.createdAt || Date.now()))}`,
  ];
  if (atts.length) {
    lines.push('- 관련 출석 기록:');
    atts.forEach(a => lines.push(`   · ${a.fileName}${a.retakes ? ` (재촬영 ${a.retakes}회)` : ''}`));
  }
  lines.push('', '첨부된 사진으로 동일인 여부를 확인해 주세요.');
  const plainBody = lines.join('\n');

  const htmlBody = `
    <div style="font-family:'Malgun Gothic',sans-serif;max-width:640px;color:#1d2433;line-height:1.6;">
      <div style="background:#c0392b;color:#fff;padding:14px 18px;border-radius:10px 10px 0 0;">
        <h2 style="margin:0;font-size:18px;">⚠️ [경고-확인필요] ${escHtml(APP_CONFIG.churchName)} 출석 중복 의심</h2>
      </div>
      <div style="border:1px solid #e5e1d8;border-top:0;padding:18px;border-radius:0 0 10px 10px;background:#fff;">
        <table style="width:100%;border-collapse:collapse;font-size:14px;">
          <tr><td style="padding:6px 0;color:#6b7280;width:90px;">날짜</td><td style="padding:6px 0;font-weight:bold;">${escHtml(w.date)}</td></tr>
          <tr><td style="padding:6px 0;color:#6b7280;">소속</td><td style="padding:6px 0;font-weight:bold;">${escHtml(w.unitLabel)}</td></tr>
          <tr><td style="padding:6px 0;color:#6b7280;">이름</td><td style="padding:6px 0;font-weight:bold;color:#c0392b;">${escHtml(w.name)}</td></tr>
          <tr><td style="padding:6px 0;color:#6b7280;">상세 내용</td><td style="padding:6px 0;">${escHtml(w.detail)}</td></tr>
          <tr><td style="padding:6px 0;color:#6b7280;">발생 시각</td><td style="padding:6px 0;">${escHtml(fmtDateTimeKST(new Date(w.createdAt || Date.now())))}</td></tr>
        </table>
        ${atts.length ? `<hr style="border:0;border-top:1px solid #eee;margin:14px 0;">
          <p style="margin:0 0 6px;font-weight:bold;">관련 출석 기록 (${atts.length}건):</p>
          <ul style="margin:0;padding-left:20px;">
            ${atts.map(a => `<li>${escHtml(a.fileName)}${a.retakes ? ` (재촬영 ${a.retakes}회)` : ''}</li>`).join('')}
          </ul>` : ''}
        <p style="margin:16px 0 0;color:#6b7280;font-size:13px;">※ 첨부된 인증 사진으로 동일인/대리출석 여부를 확인해 주세요.</p>
      </div>
    </div>`;

  const attachments = [];
  atts.forEach(a => {
    let blob = null;
    if (inlinePhotos && inlinePhotos[a.id]) {
      const m = String(inlinePhotos[a.id]).match(/^data:([^;]+);base64,(.+)$/);
      if (m) blob = Utilities.newBlob(Utilities.base64Decode(m[2]), m[1], safeFileName(a.fileName) + '.jpg');
    }
    if (!blob) blob = getPhotoBlobByAtt(a);
    if (blob) attachments.push(blob);
  });

  GmailApp.sendEmail(to, subject, plainBody, {
    name: `${APP_CONFIG.churchName} 출석체크`,
    htmlBody: htmlBody,
    attachments: attachments,
  });

  return { sent: true, to, attachmentCount: attachments.length };
}

/* ============================================================================
 * 7. 주간 리포트 계산 및 매주 일요일 13:00 자동 이메일 발송
 * ============================================================================ */

function allUnitLabels() {
  const out = [];
  APP_CONFIG.units.forEach(u => {
    if (u.companies) u.companies.forEach(c => out.push({ unit: u.name, company: c, label: `${u.name} ${c}` }));
    else out.push({ unit: u.name, company: null, label: u.name });
  });
  return out;
}

function unitOrder(label) {
  return allUnitLabels().findIndex(x => x.label === label);
}

function unitLabel(m) {
  return m.company ? `${m.unit} ${m.company}` : m.unit;
}

function koSort(a, b) {
  return String(a.name || '').localeCompare(String(b.name || ''), 'ko') ||
    String(a.dischargeDate || '').localeCompare(String(b.dischargeDate || ''));
}

function fmtDateKST(d) {
  return Utilities.formatDate(d, 'Asia/Seoul', 'yyyy-MM-dd');
}

function fmtTimeKST(d) {
  return Utilities.formatDate(d, 'Asia/Seoul', 'HH:mm');
}

function fmtDateTimeKST(d) {
  return Utilities.formatDate(d, 'Asia/Seoul', 'yyyy-MM-dd HH:mm:ss');
}

function weekdayOfDateStr(s) {
  const [y, m, d] = String(s).split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return WEEK_KO[dt.getDay()];
}

function shortDate(s) {
  const [, m, d] = String(s).split('-');
  return `${+m}/${+d}(${weekdayOfDateStr(s)})`;
}

function getLastCutoff(refDate) {
  const ref = refDate ? new Date(refDate.getTime()) : new Date();
  const kstStr = Utilities.formatDate(ref, 'Asia/Seoul', 'yyyy-MM-dd');
  const [y, m, d] = kstStr.split('-').map(Number);
  let cut = new Date(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}T${String(APP_CONFIG.reportHour).padStart(2, '0')}:00:00+09:00`);
  const dayOfWeek = new Date(y, m - 1, d).getDay();
  const diffDays = (dayOfWeek - APP_CONFIG.reportWeekday + 7) % 7;
  cut = new Date(cut.getTime() - diffDays * 86400000);
  if (cut.getTime() > ref.getTime()) {
    cut = new Date(cut.getTime() - 7 * 86400000);
  }
  return cut;
}

function grantedUpTo(m, grants) {
  const U = APP_CONFIG.mileageUnit;
  return Math.max((+m.baseGrantedBlocks || 0) * U, ...(grants || []).map(g => +g.uptoCount || 0), 0);
}

function withStats(m, atts) {
  const sorted = (atts || []).slice().sort((a, b) => (+a.ts || 0) - (+b.ts || 0));
  const total = (+m.baseCount || 0) + sorted.length;
  const lastSys = sorted.length ? sorted[sorted.length - 1].date : null;
  const last = [lastSys, m.baseLastDate].filter(Boolean).sort().pop() || null;
  return Object.assign({}, m, { atts: sorted, total, last });
}

function getAllPeopleFullOnServer() {
  const ms = readAllObjects('members');
  const att = readAllObjects('attendance');
  const grants = readAllObjects('mileage');
  const dis = readAllObjects('discharged');

  const A = {}, G = {};
  att.forEach(a => (A[a.memberId] = A[a.memberId] || []).push(a));
  grants.forEach(g => (G[g.memberId] = G[g.memberId] || []).push(g));

  return [
    ...ms.map(m => Object.assign(withStats(m, A[m.id]), { grants: G[m.id] || [], discharged: false })),
    ...dis.map(d => Object.assign(withStats(d, d.attendances || []), { grants: d.mileage || [], discharged: true })),
  ];
}

function buildReportOnServer(cutoffDate) {
  const cutoff = cutoffDate || getLastCutoff(new Date());
  const U = APP_CONFIG.mileageUnit;
  const end = cutoff.getTime();
  const prev = new Date(end - 7 * 86400000);
  const start = prev.getTime();
  const people = getAllPeopleFullOnServer();

  const achievers = [];
  people.forEach(p => {
    const atts = (p.atts || []).filter(a => (+a.ts || 0) <= end);
    const base = +p.baseCount || 0;
    const c1 = base + atts.length;
    const c0 = base + atts.filter(a => (+a.ts || 0) <= start).length;
    const k0 = Math.floor(c0 / U), k1 = Math.floor(c1 / U);
    if (k1 <= k0) return;
    const grantedBlocks = Math.floor(grantedUpTo(p, p.grants) / U);
    for (let k = k0 + 1; k <= k1; k++) {
      const lo = U * (k - 1), hi = U * k;
      const block = atts.filter((a, i) => {
        const ord = base + i + 1;
        return ord > lo && ord <= hi;
      });
      achievers.push({
        person: p,
        milestone: hi,
        total: c1,
        block: block,
        missing: U - block.length,
        allDates: atts.map(a => a.date),
        grantedBlocks: grantedBlocks,
        earnedBlocks: k1,
        pendingBlocks: Math.max(0, k1 - grantedBlocks),
      });
    }
  });

  achievers.sort((a, b) => unitOrder(unitLabel(a.person)) - unitOrder(unitLabel(b.person)) || koSort(a.person, b.person));

  const inWin = [];
  people.forEach(p => (p.atts || []).forEach(a => {
    if ((+a.ts || 0) > start && (+a.ts || 0) <= end) {
      inWin.push(Object.assign({}, a, { label: unitLabel(p) }));
    }
  }));
  const dates = Array.from(new Set(inWin.map(a => a.date))).sort();
  const rows = allUnitLabels().map(u => {
    const counts = dates.map(d => inWin.filter(a => a.label === u.label && a.date === d).length);
    return { label: u.label, counts: counts, sum: counts.reduce((x, y) => x + y, 0) };
  });
  const totals = dates.map((d, i) => rows.reduce((s, r) => s + r.counts[i], 0));

  const warnings = readAllObjects('warnings').filter(w => (+w.createdAt || 0) > start && (+w.createdAt || 0) <= end);

  return { cutoff, prev, achievers, stats: { dates, rows, totals }, warnings };
}

function formatReportPeriod(r) {
  const pDate = fmtDateKST(r.prev), pTime = fmtTimeKST(r.prev), pDay = weekdayOfDateStr(pDate);
  const cDate = fmtDateKST(r.cutoff), cTime = fmtTimeKST(r.cutoff), cDay = weekdayOfDateStr(cDate);
  return `${pDate}(${pDay}) ${pTime} ~ ${cDate}(${cDay}) ${cTime}`;
}

function formatReportPlainText(r) {
  const U = APP_CONFIG.mileageUnit;
  const L = [];
  L.push(`[${APP_CONFIG.churchName} 주간 예배 출석 리포트]`);
  L.push(`기간: ${formatReportPeriod(r)}`);
  L.push('');
  L.push(`■ ${U}회 단위 달성자 (${r.achievers.length}건)`);
  if (!r.achievers.length) L.push('  - 이번 주 달성자가 없습니다.');
  r.achievers.forEach((a, i) => {
    const p = a.person;
    L.push(`${i + 1}) ${unitLabel(p)} ${p.name} (전역 ${p.dischargeDate})${p.discharged ? ' [전역 처리됨]' : ''}`);
    L.push(`   - 이번 달성: ${a.milestone}회째 (현재 누적 ${a.total}회)`);
    L.push(`   - 마일리지 지급(건의) 완료: ${a.grantedBlocks}회 / 지급 대상: ${a.earnedBlocks}회 / 미지급: ${a.pendingBlocks}회`);
    if (a.block.length) L.push(`   - 이번 ${U}회 기간: ${a.block[0].date} ~ ${a.block[a.block.length - 1].date}`);
    L.push(`   - 첨부 사진: ${a.block.filter(b => b.hasPhoto).length}장` +
      (a.missing ? ` (시스템 도입 전 기록 ${a.missing}회는 사진 없음)` : '') +
      (a.block.some(b => b.manual) ? ` (수동 보정 ${a.block.filter(b => b.manual).length}회 포함)` : ''));
    a.block.filter(b => b.manual).forEach(b => L.push(`     · 수동 보정 ${b.date}: ${b.reason}`));
    L.push(`   - 전체 예배 날짜(${a.allDates.length}회 기록${p.baseCount ? `, 도입 전 ${p.baseCount}회 별도` : ''}):`);
    for (let j = 0; j < a.allDates.length; j += 6) L.push('     ' + a.allDates.slice(j, j + 6).join(', '));
    L.push('');
  });
  if (r.warnings && r.warnings.length) {
    L.push(`■ [경고-확인필요] 이번 주 중복 의심 (${r.warnings.length}건)`);
    r.warnings.forEach(w => L.push(`  - ${w.date} ${w.unitLabel} ${w.name}: ${w.detail}${w.resolved ? ` → 확인 완료(${w.memo || ''})` : ''}`));
    L.push('');
  }
  L.push('■ 부대별 출석 현황');
  const s = r.stats;
  if (!s.dates.length) L.push('  - 이 기간 출석 기록이 없습니다.');
  else {
    L.push('  부대 | ' + s.dates.map(shortDate).join(' | ') + ' | 합계');
    s.rows.filter(x => x.sum).forEach(x => L.push(`  ${x.label} | ${x.counts.join(' | ')} | ${x.sum}`));
    L.push(`  전체 | ${s.totals.join(' | ')} | ${s.totals.reduce((a, b) => a + b, 0)}`);
  }
  return L.join('\n');
}

function formatReportHtml(r) {
  const U = APP_CONFIG.mileageUnit;
  const s = r.stats;
  const activeRows = s.rows.filter(x => x.sum);

  const achieverHtml = r.achievers.length ? r.achievers.map((a, i) => {
    const p = a.person;
    const manualList = a.block.filter(b => b.manual)
      .map(b => `<div style="font-size:12px;color:#6b7280;">· 수동 보정 (${escHtml(b.date)}): ${escHtml(b.reason)}</div>`).join('');
    return `
      <div style="border:1px solid #e5e1d8;border-radius:10px;padding:14px;margin-bottom:12px;background:#fbf7ef;">
        <div style="font-size:16px;font-weight:bold;color:#1f3a5f;">
          ${i + 1}. ${escHtml(unitLabel(p))} ${escHtml(p.name)}
          <span style="background:#2c5282;color:#fff;padding:2px 8px;border-radius:99px;font-size:12px;margin-left:6px;">${a.milestone}회째 달성</span>
          ${p.discharged ? '<span style="background:#9ca3af;color:#fff;padding:2px 8px;border-radius:99px;font-size:12px;margin-left:4px;">전역</span>' : ''}
        </div>
        <div style="font-size:13px;color:#374151;margin-top:6px;">
          · 전역일: <b>${escHtml(p.dischargeDate)}</b> | 현재 누적: <b>${a.total}회</b><br>
          · 마일리지 지급 완료: <b>${a.grantedBlocks}회</b> / 지급 대상: <b>${a.earnedBlocks}회</b> /
          <b style="color:${a.pendingBlocks ? '#c0392b' : '#2f855a'};">미지급: ${a.pendingBlocks}회</b><br>
          · 이번 ${U}회 기간: ${a.block.length ? `${escHtml(a.block[0].date)} ~ ${escHtml(a.block[a.block.length - 1].date)}` : '-'}
          (인증 사진 <b>${a.block.filter(b => b.hasPhoto).length}장</b> 첨부${a.missing ? `, 도입 전 ${a.missing}회 사진 없음` : ''})
        </div>
        ${manualList}
        <div style="margin-top:8px;font-size:12px;color:#4b5563;background:#fff;padding:8px;border-radius:6px;">
          <b>전체 출석일(${a.allDates.length}회${p.baseCount ? `, 도입 전 ${p.baseCount}회 별도` : ''}):</b><br>
          ${a.allDates.map(d => `${escHtml(d)}(${weekdayOfDateStr(d)})`).join(', ')}
        </div>
      </div>`;
  }).join('') : '<p style="color:#6b7280;">이번 주에 24회 단위를 달성한 용사가 없습니다.</p>';

  const statsHtml = s.dates.length ? `
    <table style="width:100%;border-collapse:collapse;font-size:13px;text-align:center;">
      <thead>
        <tr style="background:#eef2f7;color:#374151;">
          <th style="padding:8px;border:1px solid #dfe3e8;text-align:left;">부대</th>
          ${s.dates.map(d => `<th style="padding:8px;border:1px solid #dfe3e8;">${escHtml(shortDate(d))}</th>`).join('')}
          <th style="padding:8px;border:1px solid #dfe3e8;">합계</th>
        </tr>
      </thead>
      <tbody>
        ${activeRows.map(row => `
          <tr>
            <td style="padding:7px 8px;border:1px solid #eef0f3;text-align:left;font-weight:bold;">${escHtml(row.label)}</td>
            ${row.counts.map(c => `<td style="padding:7px 8px;border:1px solid #eef0f3;">${c || '-'}</td>`).join('')}
            <td style="padding:7px 8px;border:1px solid #eef0f3;font-weight:bold;">${row.sum}</td>
          </tr>`).join('')}
        <tr style="background:#f8fafc;font-weight:bold;">
          <td style="padding:8px;border:1px solid #dfe3e8;text-align:left;">전체</td>
          ${s.totals.map(t => `<td style="padding:8px;border:1px solid #dfe3e8;">${t}</td>`).join('')}
          <td style="padding:8px;border:1px solid #dfe3e8;color:#1f3a5f;">${s.totals.reduce((a, b) => a + b, 0)}</td>
        </tr>
      </tbody>
    </table>` : '<p style="color:#6b7280;">이 기간 출석 기록이 없습니다.</p>';

  const warnHtml = r.warnings && r.warnings.length ? `
    <h3 style="color:#c0392b;margin:22px 0 8px;">⚠️ [경고-확인필요] 이번 주 중복 의심 (${r.warnings.length}건)</h3>
    <ul style="padding-left:20px;margin:0;">
      ${r.warnings.map(w => `<li><b>${escHtml(w.date)} ${escHtml(w.unitLabel)} ${escHtml(w.name)}</b>: ${escHtml(w.detail)}${w.resolved ? ` <span style="color:#2f855a;">(확인완료: ${escHtml(w.memo || '')})</span>` : ''}</li>`).join('')}
    </ul>` : '';

  return `
    <div style="font-family:'Malgun Gothic',sans-serif;max-width:760px;color:#1d2433;line-height:1.6;">
      <div style="background:#1f3a5f;color:#fff;padding:18px 22px;border-radius:12px 12px 0 0;">
        <h2 style="margin:0;font-size:20px;">✝ ${escHtml(APP_CONFIG.churchName)} 주간 예배 출석 리포트</h2>
        <p style="margin:4px 0 0;opacity:0.85;font-size:13px;">기간: ${escHtml(formatReportPeriod(r))}</p>
      </div>
      <div style="border:1px solid #e5e1d8;border-top:0;padding:20px;border-radius:0 0 12px 12px;background:#fff;">
        <h3 style="color:#1f3a5f;margin:0 0 10px;">🎖 ${U}회 단위 달성자 (${r.achievers.length}건)</h3>
        ${achieverHtml}
        ${warnHtml}
        <h3 style="color:#1f3a5f;margin:22px 0 10px;">📋 부대별 출석 현황</h3>
        ${statsHtml}
      </div>
    </div>`;
}

function sendWeeklyReportEmail(cutoffDate, achieverOnlyKey, isManualTrigger) {
  processDischargesOnServer();
  const r = buildReportOnServer(cutoffDate);
  if (achieverOnlyKey) {
    r.achievers = r.achievers.filter(a => `${a.person.id}_${a.milestone}` === achieverOnlyKey || a.person.id === achieverOnlyKey);
  }

  const settings = getSettingsFromServer();
  const to = settings.adminEmail || APP_CONFIG.defaultAdminEmail;
  const cutStr = fmtDateKST(r.cutoff);
  const baseSubject = `[${APP_CONFIG.churchName}] 주간 예배 출석 리포트 (${cutStr})` +
    (achieverOnlyKey && r.achievers[0] ? ` - ${r.achievers[0].person.name}` : '');
  const plainBody = formatReportPlainText(r);
  const htmlBody = formatReportHtml(r);

  const MAX_EMAIL_BYTES = 18 * 1024 * 1024;
  const groups = r.achievers.map(a => {
    const blobs = [];
    let bytes = 0;
    (a.block || []).forEach(att => {
      if (!att.hasPhoto) return;
      const b = getPhotoBlobByAtt(att);
      if (b) {
        blobs.push(b);
        bytes += b.getBytes().length;
      }
    });
    return { achiever: a, blobs, bytes };
  });

  const totalBytes = groups.reduce((s, g) => s + g.bytes, 0);
  const totalPhotos = groups.reduce((s, g) => s + g.blobs.length, 0);
  let emailsSent = 0;

  if (totalBytes <= MAX_EMAIL_BYTES) {
    const allBlobs = [];
    groups.forEach(g => g.blobs.forEach(b => allBlobs.push(b)));
    GmailApp.sendEmail(to, baseSubject, plainBody, {
      name: `${APP_CONFIG.churchName} 출석체크`,
      htmlBody: htmlBody,
      attachments: allBlobs,
    });
    emailsSent = 1;
  } else {
    GmailApp.sendEmail(to, baseSubject, plainBody + '\n\n※ 첨부 사진 용량이 커서 달성자별 인증 사진 메일을 이어서 발송합니다.', {
      name: `${APP_CONFIG.churchName} 출석체크`,
      htmlBody: htmlBody,
    });
    emailsSent++;
    groups.forEach(g => {
      if (!g.blobs.length) return;
      const p = g.achiever.person;
      const sub = `${baseSubject} - 인증사진 (${unitLabel(p)} ${p.name} ${g.achiever.milestone}회차)`;
      const singleReport = Object.assign({}, r, { achievers: [g.achiever] });
      GmailApp.sendEmail(to, sub, formatReportPlainText(singleReport), {
        name: `${APP_CONFIG.churchName} 출석체크`,
        htmlBody: formatReportHtml(singleReport),
        attachments: g.blobs,
      });
      emailsSent++;
    });
  }

  if (!achieverOnlyKey) {
    saveSettingsOnServer({
      lastWeeklyReportCutoff: String(r.cutoff.getTime()),
      lastWeeklyReportSentAt: fmtDateTimeKST(new Date()),
    });
  }

  return {
    sent: true,
    to: to,
    cutoff: cutStr,
    achieverCount: r.achievers.length,
    photoCount: totalPhotos,
    emailsSent: emailsSent,
    isManualTrigger: !!isManualTrigger,
  };
}

function cronWeeklyReport() {
  const now = new Date();
  const cutoff = getLastCutoff(now);
  const settings = getSettingsFromServer();
  const cutoffKey = String(cutoff.getTime());
  if (settings.lastWeeklyReportCutoff === cutoffKey) {
    return;
  }
  if (now.getTime() >= cutoff.getTime()) {
    sendWeeklyReportEmail(cutoff, null, false);
  }
}

function installTriggers() {
  const existing = ScriptApp.getProjectTriggers();
  existing.forEach(t => {
    const fn = t.getHandlerFunction();
    if (fn === 'cronWeeklyReport' || fn === 'sendWeeklyReportEmail') {
      ScriptApp.deleteTrigger(t);
    }
  });

  ScriptApp.newTrigger('cronWeeklyReport')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.SUNDAY)
    .atHour(APP_CONFIG.reportHour)
    .nearMinute(0)
    .inTimezone('Asia/Seoul')
    .create();

  ScriptApp.newTrigger('cronWeeklyReport')
    .timeBased()
    .everyMinutes(10)
    .create();

  const settings = getSettingsFromServer();
  if (!settings.lastWeeklyReportCutoff) {
    const lastCut = getLastCutoff(new Date());
    if (Date.now() - lastCut.getTime() > 2 * 3600 * 1000) {
      saveSettingsOnServer({ lastWeeklyReportCutoff: String(lastCut.getTime()) });
    }
  }
}

/* ============================================================================
 * 8. 전체 데이터 내보내기(pullAll) / 가져오기(pushAll) / 상태 조회
 * ============================================================================ */

function exportAllFromServer(includePhotos, isAdminAuthenticated) {
  const members = readAllObjects('members');
  const attendance = readAllObjects('attendance');
  const mileage = readAllObjects('mileage');
  const discharged = readAllObjects('discharged');
  const warnings = readAllObjects('warnings');
  const settings = getSettingsFromServer();
  if (!isAdminAuthenticated) {
    // 백엔드 비밀번호 없이 일반 공기계에서 명단 동기화만 할 때는 비밀번호를 내려주지 않음
    delete settings.password;
  }
  const photos = {};

  if (includePhotos) {
    attendance.forEach(a => {
      if (a.hasPhoto) {
        const url = getPhotoDataUrlByAttId(a.id);
        if (url) photos[a.id] = url;
      }
    });
  }

  return {
    app: 'cheongun-attendance',
    version: 2,
    syncRev: getSyncRev(),
    exportedAt: new Date().toISOString(),
    settings,
    members,
    attendance,
    mileage,
    discharged,
    warnings,
    photos,
  };
}

function importAllToServer(data) {
  if (!data || data.app !== 'cheongun-attendance') {
    throw new Error('천군교회 출석 데이터가 아닙니다.');
  }
  if (data.settings) saveSettingsOnServer(data.settings);

  const photos = data.photos || {};
  const attendance = (data.attendance || []).map(a => {
    const existing = getObjectById('attendance', a.id);
    if (photos[a.id] && (!existing || !existing.photoFileId)) {
      a.photoFileId = savePhotoToDrive(a, photos[a.id]);
      a.hasPhoto = true;
    } else if (existing && existing.photoFileId) {
      a.photoFileId = existing.photoFileId;
    }
    return a;
  });

  clearAndWriteSheet('members', data.members || []);
  clearAndWriteSheet('attendance', attendance);
  clearAndWriteSheet('mileage', data.mileage || []);
  clearAndWriteSheet('discharged', data.discharged || []);
  clearAndWriteSheet('warnings', data.warnings || []);
}

function getServerStatus() {
  const ss = getOrCreateDb();
  const folder = getOrCreatePhotoFolder();
  const settings = getSettingsFromServer();
  const triggers = ScriptApp.getProjectTriggers().map(t => t.getHandlerFunction());
  const hasWeeklyTrigger = triggers.includes('cronWeeklyReport');

  return {
    spreadsheetUrl: ss.getUrl(),
    spreadsheetName: ss.getName(),
    photoFolderUrl: folder.getUrl(),
    photoFolderName: folder.getName(),
    memberCount: readAllObjects('members').length,
    attendanceCount: readAllObjects('attendance').length,
    warningCount: readAllObjects('warnings').filter(w => !w.resolved).length,
    dischargedCount: readAllObjects('discharged').length,
    adminEmail: settings.adminEmail,
    senderEmail: Session.getEffectiveUser().getEmail() || settings.senderEmail,
    hasWeeklyTrigger: hasWeeklyTrigger,
    lastWeeklyReportSentAt: settings.lastWeeklyReportSentAt || null,
    syncRev: getSyncRev(),
    serverTime: fmtDateTimeKST(new Date()),
  };
}

function escHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

/* ============================================================================
 * 9. 백엔드 직접 접속 시 비밀번호(초기 0113) 잠금 웹 콘솔 HTML
 *    (노트북 등에서 백엔드 주소로 바로 들어왔을 때 비밀번호 없이는 아무것도 볼 수 없음)
 * ============================================================================ */

function getBackendConsoleHtml() {
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>천군교회 백엔드 서버 관리</title>
  <style>
    :root { --navy:#1f3a5f; --gold:#d9a441; --cream:#fbf7ef; --red:#c0392b; --green:#2f855a; }
    * { box-sizing:border-box; font-family:'Pretendard','Malgun Gothic',sans-serif; }
    body { margin:0; background:var(--cream); color:#1d2433; display:flex; align-items:center; justify-content:center; min-height:100vh; padding:16px; }
    .box { background:#fff; border-radius:16px; box-shadow:0 8px 28px rgba(31,58,95,.12); width:min(96vw,560px); padding:28px; }
    h1 { margin:0 0 8px; color:var(--navy); font-size:22px; }
    h3 { margin:18px 0 8px; color:var(--navy); font-size:16px; }
    p { margin:6px 0; color:#4b5563; font-size:14px; line-height:1.5; }
    input { width:100%; padding:11px 12px; font-size:16px; border:2px solid #dfe3e8; border-radius:10px; margin-top:6px; }
    input:focus { outline:none; border-color:var(--navy); }
    .btn { border:0; border-radius:10px; padding:11px 16px; background:var(--navy); color:#fff; font-weight:700; font-size:14px; cursor:pointer; text-decoration:none; display:inline-block; }
    .btn.ghost { background:#fff; color:var(--navy); border:1.5px solid var(--navy); }
    .btn:disabled { opacity:.5; }
    .row { display:flex; flex-wrap:wrap; gap:8px; margin-top:10px; }
    .card { background:#f8fafc; border:1px solid #e5e7eb; border-radius:12px; padding:14px; margin-top:12px; font-size:14px; line-height:1.7; }
    .err { color:var(--red); font-weight:700; }
    .hidden { display:none !important; }
  </style>
</head>
<body>
  <div class="box" id="login-box">
    <h1>🔒 천군교회 백엔드 서버</h1>
    <p>이 페이지는 군종목사님 전용 백엔드 관리 화면입니다.<br>백엔드 비밀번호(초기 <b>0113</b>)를 입력해 주세요.</p>
    <form id="login-form">
      <input type="password" id="pw" inputmode="numeric" maxlength="8" placeholder="백엔드 비밀번호 입력" required autofocus>
      <p class="err hidden" id="login-err"></p>
      <div class="row"><button class="btn" type="submit" id="login-btn">잠금 해제</button></div>
    </form>
  </div>

  <div class="box hidden" id="adm-box">
    <div style="display:flex;justify-content:space-between;align-items:center;">
      <h1>☁️ 천군교회 백엔드 관리 콘솔</h1>
      <button class="btn ghost" id="lock-btn">🔒 잠그기</button>
    </div>
    <div class="card" id="st-card">불러오는 중…</div>

    <h3>🚀 빠른 작업</h3>
    <div class="row">
      <button class="btn" id="send-rep">📧 이번 주 리포트 즉시 발송</button>
      <button class="btn ghost" id="setup-trig">⏰ 일요일 13:00 자동발송 트리거 재설정</button>
    </div>

    <h3>📧 리포트 수신 이메일 변경</h3>
    <form id="email-form">
      <input type="email" id="adm-email" placeholder="수신 이메일 (예: crossyoman@gmail.com)" required>
      <div class="row"><button class="btn" type="submit">이메일 저장</button></div>
    </form>

    <h3>🔑 백엔드 비밀번호 변경</h3>
    <form id="pw-form">
      <input type="password" id="new-pw1" inputmode="numeric" maxlength="8" placeholder="새 백엔드 비밀번호 (숫자 4~8자리)" required>
      <input type="password" id="new-pw2" inputmode="numeric" maxlength="8" placeholder="새 백엔드 비밀번호 확인" required>
      <div class="row"><button class="btn" type="submit">백엔드 비밀번호 변경</button></div>
    </form>
  </div>

  <script>
    let currentPw = '';
    const $ = id => document.getElementById(id);

    function callServer(action, payload) {
      return new Promise((resolve, reject) => {
        google.script.run
          .withSuccessHandler(resolve)
          .withFailureHandler(err => reject(new Error(err.message || String(err))))
          .consoleRequest(action, payload || {}, currentPw);
      });
    }

    function renderStatus(st) {
      $('adm-email').value = st.adminEmail || '';
      $('st-card').innerHTML =
        '<b>발신 계정:</b> ' + st.senderEmail + ' → <b>수신 계정:</b> ' + st.adminEmail + '<br>' +
        '<b>보관 데이터:</b> 현역 ' + st.memberCount + '명 / 출석 ' + st.attendanceCount + '건 / 전역 ' + st.dischargedCount + '명<br>' +
        '<b>일요일 13:00 자동발송:</b> ' + (st.hasWeeklyTrigger ? '🟢 작동 중' : '⚪ 꺼짐') +
        (st.lastWeeklyReportSentAt ? ' (최근 발송: ' + st.lastWeeklyReportSentAt + ')' : '') +
        '<div class="row" style="margin-top:8px">' +
          '<a class="btn ghost" href="' + st.spreadsheetUrl + '" target="_blank">📊 구글 시트 DB 열기</a>' +
          '<a class="btn ghost" href="' + st.photoFolderUrl + '" target="_blank">📁 사진 폴더 열기</a>' +
        '</div>';
    }

    $('login-form').onsubmit = async e => {
      e.preventDefault();
      $('login-err').classList.add('hidden');
      $('login-btn').disabled = true;
      currentPw = $('pw').value.trim();
      try {
        const res = await callServer('status', {});
        $('login-box').classList.add('hidden');
        $('adm-box').classList.remove('hidden');
        renderStatus(res.status);
      } catch (err) {
        $('login-err').textContent = err.message;
        $('login-err').classList.remove('hidden');
        currentPw = '';
      } finally {
        $('login-btn').disabled = false;
      }
    };

    $('lock-btn').onclick = () => {
      currentPw = '';
      $('pw').value = '';
      $('adm-box').classList.add('hidden');
      $('login-box').classList.remove('hidden');
    };

    $('send-rep').onclick = async () => {
      $('send-rep').disabled = true;
      try {
        const res = await callServer('sendWeeklyReport', {});
        alert('발송 완료! 수신: ' + res.to + ' (달성자 ' + res.achieverCount + '건, 사진 ' + res.photoCount + '장)');
        const st = await callServer('status', {});
        renderStatus(st.status);
      } catch (err) { alert('오류: ' + err.message); }
      finally { $('send-rep').disabled = false; }
    };

    $('setup-trig').onclick = async () => {
      $('setup-trig').disabled = true;
      try {
        const st = await callServer('setupTrigger', {});
        renderStatus(st.status);
        alert('매주 일요일 13:00 자동 발송 트리거가 설정되었습니다.');
      } catch (err) { alert('오류: ' + err.message); }
      finally { $('setup-trig').disabled = false; }
    };

    $('email-form').onsubmit = async e => {
      e.preventDefault();
      try {
        await callServer('saveSettings', { adminEmail: $('adm-email').value.trim() });
        const st = await callServer('status', {});
        renderStatus(st.status);
        alert('수신 이메일을 변경했습니다.');
      } catch (err) { alert('오류: ' + err.message); }
    };

    $('pw-form').onsubmit = async e => {
      e.preventDefault();
      const p1 = $('new-pw1').value.trim(), p2 = $('new-pw2').value.trim();
      if (p1 !== p2) return alert('새 비밀번호가 일치하지 않습니다.');
      try {
        await callServer('changeBackendPassword', { newPassword: p1 });
        currentPw = p1;
        $('new-pw1').value = ''; $('new-pw2').value = '';
        alert('백엔드 비밀번호를 변경했습니다.');
      } catch (err) { alert('오류: ' + err.message); }
    };
  </script>
</body>
</html>`;
}
