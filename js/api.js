/* =========================================================
 * 백엔드 연동 및 오프라인 동기화 큐 (Google Apps Script 웹앱)
 * - 키오스크(예배당 공기계) ↔ 백엔드(Google Sheets/Drive) ↔ 교회 데스크탑 실시간 동기화
 * - 백엔드 관리 작업 시 별도 백엔드 비밀번호(초기 0113, 변경 가능) 인증 지원
 * ========================================================= */
const Backend = {
  flushing: false,
  syncing: false,
  lastSyncAt: null,
  lastError: null,
  serverStatus: null,
  sessionBackendPw: '', // 현재 관리자 세션에서 인증된 백엔드 비밀번호 (잠그고 나가면 초기화)
  photoInflight: {},

  lockSession() {
    this.sessionBackendPw = '';
  },

  blobToDataURL(blob) {
    return new Promise((resolve, reject) => {
      if (!blob) return resolve(null);
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = () => reject(fr.error);
      fr.readAsDataURL(blob);
    });
  },

  async dataURLToBlob(dataUrl) {
    if (!dataUrl) return null;
    const res = await fetch(dataUrl);
    return res.blob();
  },

  async getUrl() {
    const s = await DB.get('settings', 'main');
    const url = (s && s.apiUrl) || CONFIG.defaultApiUrl || '';
    return String(url).trim();
  },

  async isConfigured() {
    return !!(await this.getUrl());
  },

  /**
   * 백엔드 비밀번호 입력 모달 (초기값 0113)
   */
  promptBackendPassword(title = '🔐 백엔드 서버 비밀번호 확인') {
    return new Promise(resolve => {
      const w = Modal.open(`
        <h3>${title}</h3>
        <p class="modal-msg small">백엔드 서버 보호를 위해 백엔드 비밀번호(초기 <b>0113</b>)를 입력해 주세요.</p>
        <form class="mform" id="bpw-form" style="margin-top:.8rem">
          <input type="password" id="bpw-in" inputmode="numeric" maxlength="8" placeholder="백엔드 비밀번호 (초기 0113)" required style="text-align:center;font-size:1.3rem;letter-spacing:.2em">
          <div class="modal-actions">
            <button type="button" class="btn ghost" id="bpw-cancel">취소</button>
            <button type="submit" class="btn primary">확인</button>
          </div>
        </form>`);
      setTimeout(() => { const el = document.getElementById('bpw-in'); if (el) el.focus(); }, 100);
      w.querySelector('#bpw-cancel').onclick = () => { Modal.close(w); resolve(null); };
      w.querySelector('#bpw-form').onsubmit = e => {
        e.preventDefault();
        const val = w.querySelector('#bpw-in').value.trim();
        Modal.close(w);
        resolve(val || null);
      };
    });
  },

  /**
   * 현재 세션에 백엔드 비밀번호가 없으면 입력받아 서버에 검증
   */
  async ensureBackendAuth(customUrl = null) {
    if (this.sessionBackendPw) return this.sessionBackendPw;
    const pw = await this.promptBackendPassword();
    if (!pw) throw new Error('백엔드 비밀번호 입력이 취소되었습니다.');
    const res = await this.call('verifyBackendPassword', {}, customUrl, pw);
    this.sessionBackendPw = pw;
    if (res.status) this.serverStatus = res.status;
    return pw;
  },

  /**
   * Google Apps Script Web App 호출
   * CORS Preflight(OPTIONS)를 피하기 위해 Content-Type: text/plain 사용
   */
  async call(action, payload = {}, customUrl = null, overridePw = null) {
    const url = (customUrl || await this.getUrl()).trim();
    if (!url) throw new Error('백엔드 서버 URL이 설정되지 않았습니다.');

    const backendPassword = overridePw !== null ? overridePw : (this.sessionBackendPw || '');

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, payload, backendPassword }),
      redirect: 'follow',
    });

    if (!res.ok) {
      throw new Error(`서버 응답 오류 (HTTP ${res.status})`);
    }

    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch (e) {
      throw new Error('서버 응답을 해석할 수 없습니다. 웹앱 배포 권한이 "모든 사용자(Anyone)"인지 확인해 주세요.');
    }

    if (!json.ok) {
      if (String(json.error || '').includes('백엔드 비밀번호')) {
        this.sessionBackendPw = '';
      }
      throw new Error(json.error || '서버 처리 중 오류가 발생했습니다.');
    }

    this.lastSyncAt = Date.now();
    this.lastError = null;
    if (json.status) this.serverStatus = json.status;
    return json;
  },

  /** 백엔드 비밀번호가 필요한 관리자 API 호출 */
  async adminCall(action, payload = {}, customUrl = null) {
    await this.ensureBackendAuth(customUrl);
    return this.call(action, payload, customUrl, this.sessionBackendPw);
  },

  /** 백그라운드 동기화 작업 등록 */
  async enqueue(action, payload = {}) {
    if (!(await this.isConfigured())) return null; // 서버 미연결 상태에서는 기기에만 저장
    const item = {
      id: uid(),
      createdAt: Date.now(),
      action,
      payload,
      backendPassword: this.sessionBackendPw || '',
    };
    await DB.put('syncQueue', item);
    this.flush().catch(err => console.warn('[Backend.flush]', err));
    return item.id;
  },

  async pendingCount() {
    const all = await DB.all('syncQueue');
    return all.length;
  },

  /** 대기 중인 동기화 큐를 순서대로 서버에 전송 */
  async flush() {
    if (this.flushing) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    if (!(await this.isConfigured())) return;

    this.flushing = true;
    try {
      const queue = (await DB.all('syncQueue')).sort((a, b) => a.createdAt - b.createdAt);
      for (const item of queue) {
        if (item.needsAuth && !this.sessionBackendPw) continue;
        try {
          const payload = { ...item.payload };

          if (item.action === 'recordAttendance' || item.action === 'replacePhoto') {
            const attId = payload.attendance && payload.attendance.id;
            const latestAtt = attId ? await DB.get('attendance', attId) : null;
            if (!latestAtt && item.action === 'recordAttendance') {
              await DB.del('syncQueue', item.id);
              continue;
            }
            if (latestAtt) payload.attendance = latestAtt;
            if (attId && !payload.photoDataUrl) {
              const blob = await DB.get('photos', attId);
              if (blob) payload.photoDataUrl = await this.blobToDataURL(blob);
            }
          }

          if (item.action === 'addWarning' && payload.warning) {
            const photos = {};
            for (const attId of payload.warning.attendanceIds || []) {
              const blob = await DB.get('photos', attId);
              if (blob) photos[attId] = await this.blobToDataURL(blob);
            }
            payload.photos = photos;
          }

          const pw = this.sessionBackendPw || item.backendPassword || '';
          const res = await this.call(item.action, payload, null, pw);

          if (item.action === 'addWarning' && res.emailSent && payload.warning) {
            const w = await DB.get('warnings', payload.warning.id);
            if (w) {
              w.emailSent = true;
              w.emailSentAt = Date.now();
              await DB.put('warnings', w);
            }
          }

          if (res.syncRev) {
            const s = await DB.get('settings', 'main') || {};
            s.lastSyncRev = res.syncRev;
            await DB.put('settings', s, 'main');
          }

          await DB.del('syncQueue', item.id);
        } catch (err) {
          this.lastError = err.message || String(err);
          console.warn('[Backend sync failed]', item.action, this.lastError);
          // 비밀번호 문제로 실패한 작업은 큐를 막지 않도록 건너뛰고, 다음에 목사님이 인증하면 재시도
          if (this.lastError.includes('백엔드 비밀번호')) {
            item.needsAuth = true;
            await DB.put('syncQueue', item);
            continue;
          }
          break;
        }
      }
    } finally {
      this.flushing = false;
    }
  },

  /**
   * 다중 기기 동기화 (예배당 공기계 ↔ 백엔드 서버 ↔ 교회 데스크탑)
   * 서버의 syncRev가 로컬보다 최신이면 최신 명단·출석·마일리지·경고를 자동으로 가져옵니다.
   */
  async syncFromServerIfChanged(force = false) {
    if (this.syncing) return false;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;
    if (!(await this.isConfigured())) return false;

    this.syncing = true;
    try {
      await this.flush();
      const pending = (await DB.all('syncQueue')).filter(i => !i.needsAuth).length;
      if (pending > 0 && !force) return false; // 아직 업로드 못한 로컬 작업이 있으면 덮어쓰기 방지

      const s = await DB.get('settings', 'main') || {};
      const chk = await this.call('checkSync', {});
      const localMembers = await DB.all('members');

      if (!force && localMembers.length > 0 && s.lastSyncRev && Number(s.lastSyncRev) === Number(chk.syncRev)) {
        return false; // 변경 없음
      }

      const res = await this.call('pullAll', { includePhotos: false });
      const data = res.data;
      if (!data || data.app !== 'cheongun-attendance') return false;

      // 서버가 아직 완전히 비어 있는데 로컬에 데이터가 있는 초기 상태면 덮어쓰지 않음
      if (!force && (data.members || []).length === 0 && localMembers.length > 0) {
        return false;
      }

      for (const storeName of ['members', 'attendance', 'mileage', 'discharged', 'warnings']) {
        await DB.clear(storeName);
      }
      const mergedSettings = Object.assign({}, s, data.settings || {}, {
        apiUrl: s.apiUrl || CONFIG.defaultApiUrl || '',
        lastSyncRev: data.syncRev || chk.syncRev,
      });
      await DB.put('settings', mergedSettings, 'main');

      for (const m of data.members || []) await DB.put('members', m);
      for (const a of data.attendance || []) await DB.put('attendance', a);
      for (const g of data.mileage || []) await DB.put('mileage', g);
      for (const d of data.discharged || []) await DB.put('discharged', d);
      for (const w of data.warnings || []) await DB.put('warnings', w);
      return true;
    } catch (e) {
      console.warn('[Backend.syncFromServerIfChanged]', e);
      return false;
    } finally {
      this.syncing = false;
    }
  },

  /** 로컬에 없는 사진을 서버(Google Drive)에서 가져와 캐시 */
  async fetchPhotoAndCache(attId) {
    if (!attId || !(await this.isConfigured())) return null;
    if (this.photoInflight[attId]) return this.photoInflight[attId];

    this.photoInflight[attId] = (async () => {
      try {
        const res = await this.call('getPhoto', { id: attId });
        if (!res.dataUrl) return null;
        const blob = await this.dataURLToBlob(res.dataUrl);
        if (blob) await DB.put('photos', blob, attId);
        return blob;
      } catch (e) {
        console.warn('[Backend.fetchPhotoAndCache]', attId, e);
        return null;
      } finally {
        delete this.photoInflight[attId];
      }
    })();

    return this.photoInflight[attId];
  },

  /** 서버 연결 확인 및 일요일 13:00 자동 메일 발송 트리거 설치 (백엔드 비밀번호 필요) */
  async connectAndSetup(apiUrl, backendPw) {
    if (backendPw) this.sessionBackendPw = backendPw.trim();
    const res = await this.adminCall('setupTrigger', {}, apiUrl);
    await Store.saveSettings({ apiUrl: apiUrl.trim() }, false);
    const s = await Store.settings();
    await this.adminCall('saveSettings', {
      password: s.password,
      adminEmail: s.adminEmail,
      senderEmail: s.senderEmail,
    }, apiUrl);
    await this.flush();
    return res.status;
  },

  /** 백엔드 비밀번호 변경 */
  async changeBackendPassword(currentPw, newPassword) {
    const res = await this.call('changeBackendPassword', { newPassword }, null, currentPw);
    this.sessionBackendPw = newPassword;
    return res;
  },

  /** 이 기기의 전체 데이터 + 사진을 서버로 업로드 (백엔드 비밀번호 필요) */
  async pushAllToServer(onProgress) {
    await this.ensureBackendAuth();
    const settings = await Store.settings();
    const members = await DB.all('members');
    const attendance = await DB.all('attendance');
    const mileage = await DB.all('mileage');
    const discharged = await DB.all('discharged');
    const warnings = await DB.all('warnings');

    if (onProgress) onProgress(0, 1, '명단 및 출석 기록을 서버에 업로드하는 중…');
    await this.adminCall('pushAll', {
      data: {
        app: 'cheongun-attendance',
        version: 2,
        settings: {
          password: settings.password,
          adminEmail: settings.adminEmail,
          senderEmail: settings.senderEmail,
        },
        members,
        attendance,
        mileage,
        discharged,
        warnings,
        photos: {},
      },
    });

    const photoKeys = await DB.keys('photos');
    const attMap = Object.fromEntries(attendance.map(a => [a.id, a]));
    for (let i = 0; i < photoKeys.length; i++) {
      const k = photoKeys[i];
      if (onProgress) onProgress(i + 1, photoKeys.length, `인증 사진 업로드 중 (${i + 1}/${photoKeys.length})…`);
      const blob = await DB.get('photos', k);
      if (!blob) continue;
      const dataUrl = await this.blobToDataURL(blob);
      const att = attMap[k];
      await this.adminCall('uploadPhoto', {
        attId: k,
        fileName: att ? att.fileName : k,
        photoDataUrl: dataUrl,
      });
    }

    await DB.clear('syncQueue');
    const st = await this.adminCall('status');
    return st.status;
  },

  /** 서버의 전체 데이터 + 사진을 이 기기로 복원 (백엔드 비밀번호 필요) */
  async pullAllFromServer(onProgress, requireAuth = true) {
    if (requireAuth) await this.ensureBackendAuth();
    const apiUrl = await this.getUrl();
    if (onProgress) onProgress(0, 1, '서버에서 명단 및 출석 기록을 불러오는 중…');
    const res = await this.call('pullAll', { includePhotos: false }, null, this.sessionBackendPw);
    const data = res.data;
    if (!data || data.app !== 'cheongun-attendance') {
      throw new Error('서버 데이터 형식이 올바르지 않습니다.');
    }

    for (const s of ['members', 'attendance', 'mileage', 'discharged', 'warnings', 'syncQueue']) {
      await DB.clear(s);
    }

    const curSettings = await DB.get('settings', 'main') || {};
    const mergedSettings = Object.assign({}, curSettings, data.settings || {}, {
      apiUrl,
      lastSyncRev: data.syncRev || Date.now(),
    });
    await DB.put('settings', mergedSettings, 'main');

    for (const m of data.members || []) await DB.put('members', m);
    for (const a of data.attendance || []) await DB.put('attendance', a);
    for (const g of data.mileage || []) await DB.put('mileage', g);
    for (const d of data.discharged || []) await DB.put('discharged', d);
    for (const w of data.warnings || []) await DB.put('warnings', w);

    const needPhotos = (data.attendance || []).filter(a => a.hasPhoto);
    for (let i = 0; i < needPhotos.length; i++) {
      const a = needPhotos[i];
      if (onProgress) onProgress(i + 1, needPhotos.length, `인증 사진 내려받는 중 (${i + 1}/${needPhotos.length})…`);
      const existing = await DB.get('photos', a.id);
      if (!existing) {
        await this.fetchPhotoAndCache(a.id);
      }
    }

    return {
      members: (data.members || []).length,
      attendance: (data.attendance || []).length,
      photos: needPhotos.length,
    };
  },

  /** 서버에서 즉시 주간 리포트 이메일 발송 (백엔드 비밀번호 확인) */
  async sendWeeklyReportNow(cutoffDate, achieverOnlyKey = null) {
    await this.ensureBackendAuth();
    await this.flush();
    return this.adminCall('sendWeeklyReport', {
      cutoffMs: cutoffDate ? cutoffDate.getTime() : null,
      achieverOnlyId: achieverOnlyKey,
    });
  },

  /** 서버에서 즉시 [경고-확인필요] 이메일 발송 (백엔드 비밀번호 확인) */
  async sendWarningEmailNow(warning) {
    await this.ensureBackendAuth();
    await this.flush();
    const photos = {};
    for (const attId of warning.attendanceIds || []) {
      const blob = await Store.getPhoto(attId);
      if (blob) photos[attId] = await this.blobToDataURL(blob);
    }
    const res = await this.adminCall('sendWarningEmail', { id: warning.id, photos });
    if (res.emailSent) {
      const w = await DB.get('warnings', warning.id);
      if (w) {
        w.emailSent = true;
        w.emailSentAt = Date.now();
        await DB.put('warnings', w);
      }
    }
    return res;
  },

  /** 앱 시작 시 자동 동기화 루프 */
  async init() {
    window.addEventListener('online', () => {
      this.flush().catch(() => {});
      this.syncFromServerIfChanged().catch(() => {});
    });
    setInterval(() => {
      this.flush().catch(() => {});
      this.syncFromServerIfChanged().catch(() => {});
    }, 20000);

    if (!(await this.isConfigured())) return;
    try {
      await this.syncFromServerIfChanged();
    } catch (e) {
      console.warn('[Backend.init]', e);
    }
  },
};
