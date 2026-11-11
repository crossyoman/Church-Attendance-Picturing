/* =========================================================
 * 공통 유틸
 * ========================================================= */
const pad = n => String(n).padStart(2, '0');
const fmtDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fmtTime = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const todayStr = () => fmtDate(new Date());
const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
const weekdayOf = s => WEEK[new Date(s + 'T00:00:00').getDay()];
const dotDate = s => (s ? s.replace(/-/g, '.') : '');
const shortDate = s => { const [, m, d] = s.split('-'); return `${+m}/${+d}(${weekdayOf(s)})`; };
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const unitLabel = m => (m.company ? `${m.unit} ${m.company}` : m.unit);
const koSort = (a, b) => a.name.localeCompare(b.name, 'ko') || String(a.dischargeDate).localeCompare(String(b.dischargeDate));
// 윈도우/안드로이드 파일명에는 ':' 를 쓸 수 없어 저장(다운로드) 시에만 '-' 로 바꿉니다.
const safeFileName = s => s.replace(/:/g, '-').replace(/[\\/*?"<>|]/g, '_');

/** 모든 부대/중대 라벨을 설정 순서대로 */
function allUnitLabels() {
  const out = [];
  CONFIG.units.forEach(u => {
    if (u.companies) u.companies.forEach(c => out.push({ unit: u.name, company: c, label: `${u.name} ${c}` }));
    else out.push({ unit: u.name, company: null, label: u.name });
  });
  return out;
}
const unitOrder = label => allUnitLabels().findIndex(x => x.label === label);

/** 다양한 날짜 표현을 yyyy-mm-dd 로 */
function normalizeDate(v) {
  if (v === null || v === undefined || v === '') return '';
  if (v instanceof Date && !isNaN(v)) return fmtDate(v);
  if (typeof v === 'number') { // 엑셀 날짜 일련번호
    const d = new Date(Math.round((v - 25569) * 864e5));
    return fmtDate(new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  }
  const m = String(v).trim().match(/^(\d{2,4})[.\-\/년\s]+(\d{1,2})[.\-\/월\s]+(\d{1,2})/);
  if (!m) return '';
  let y = +m[1]; if (y < 100) y += 2000;
  const d = new Date(y, +m[2] - 1, +m[3]);
  if (isNaN(d) || d.getMonth() !== +m[2] - 1) return '';
  return fmtDate(d);
}

/** 날짜를 26.02.01 (YY.MM.DD) 형식으로 표기 */
function fmtYYMMDD(v) {
  const s = normalizeDate(v);
  if (!s) return '';
  const [y, m, d] = s.split('-');
  return `${y.slice(-2)}.${m}.${d}`;
}

/* =========================================================
 * Store : 데이터 처리 (로컬 IndexedDB + 백엔드 자동 동기화)
 * ========================================================= */
const Store = {
  /** 서버에서 백엔드 비밀번호를 요구하는 작업(삭제·설정 변경) 전에 인증 확인 */
  async needBackendAuth() {
    if (typeof Backend === 'undefined' || !(await Backend.isConfigured())) return;
    await Backend.ensureBackendAuth();
  },

  /* ---------- 기기 승인 (예배당 공기계 잠금) ---------- */
  async isDeviceAuthorized() {
    const s = await DB.get('settings', 'main');
    return !!(s && s.isKioskAuthorized);
  },
  async setDeviceAuthorized(auth) {
    const s = await this.settings();
    s.isKioskAuthorized = !!auth;
    s.kioskAuthorizedAt = auth ? Date.now() : null;
    await DB.put('settings', s, 'main');
    return s;
  },

  /* ---------- 설정 ---------- */
  async settings() {
    const s = await DB.get('settings', 'main');
    return Object.assign({
      password: CONFIG.defaultPassword,
      adminEmail: CONFIG.defaultAdminEmail,
      senderEmail: CONFIG.defaultSenderEmail,
      apiUrl: CONFIG.defaultApiUrl || '',
      isKioskAuthorized: false,
    }, s || {});
  },
  async saveSettings(patch, syncServer = true) {
    if (syncServer) await this.needBackendAuth();
    const s = Object.assign(await this.settings(), patch);
    await DB.put('settings', s, 'main');
    if (syncServer && typeof Backend !== 'undefined') {
      await Backend.enqueue('saveSettings', {
        password: s.password,
        adminEmail: s.adminEmail,
        senderEmail: s.senderEmail,
      });
    }
    return s;
  },

  /* ---------- 형제(멤버) ---------- */
  withStats(m, atts) {
    atts = (atts || []).slice().sort((a, b) => a.ts - b.ts);
    const total = (m.baseCount || 0) + atts.length;
    const lastSys = atts.length ? atts[atts.length - 1].date : null;
    const last = [lastSys, m.baseLastDate].filter(Boolean).sort().pop() || null;
    return { ...m, atts, total, last };
  },

  async membersWithStats() {
    const [ms, att] = await Promise.all([DB.all('members'), DB.all('attendance')]);
    const by = {};
    att.forEach(a => (by[a.memberId] = by[a.memberId] || []).push(a));
    return ms.map(m => this.withStats(m, by[m.id]));
  },

  async memberWithStats(id) {
    const m = await DB.get('members', id);
    if (!m) return null;
    return this.withStats(m, await DB.byIndex('attendance', 'memberId', id));
  },

  isLongAbsent(m) {
    const ref = m.last || m.createdAt;
    if (!ref) return false;
    const cut = new Date();
    cut.setMonth(cut.getMonth() - CONFIG.longAbsentMonths);
    return ref < fmtDate(cut);
  },

  /** 부대 명단 (mode: 'normal' | 'long') */
  async listForUnit(unit, company, mode = 'normal') {
    const all = (await this.membersWithStats())
      .filter(m => m.unit === unit && (m.company || null) === (company || null));
    const cnt = {};
    all.forEach(m => (cnt[m.name] = (cnt[m.name] || 0) + 1));
    const dup = new Set(Object.keys(cnt).filter(k => cnt[k] > 1));
    const list = all.filter(m => (mode === 'long') === this.isLongAbsent(m)).sort(koSort);
    return { list, dup };
  },

  async findSameName(unit, company, name) {
    return (await this.membersWithStats())
      .filter(m => m.unit === unit && (m.company || null) === (company || null) && m.name === name);
  },

  normalizeSlots(slots) {
    const U = CONFIG.mileageUnit;
    const out = [];
    for (let s = 1; s <= 5; s++) {
      const found = (slots || []).find(x => x && (+x.stage === s || +x.count === s * U)) || {};
      const baseDate = normalizeDate(found.baseDate);
      const proposedDate = normalizeDate(found.proposedDate);
      if (baseDate || proposedDate) {
        out.push({ stage: s, count: s * U, baseDate, proposedDate, memo: found.memo || '' });
      }
    }
    return out;
  },

  async addMember(p, syncServer = true) {
    const mileageSlots = this.normalizeSlots(p.mileageSlots);
    const slotBlocks = mileageSlots.reduce((mx, sl) => Math.max(mx, sl.stage), 0);
    const m = {
      id: uid(),
      name: p.name.trim(),
      unit: p.unit,
      company: p.company || null,
      dischargeDate: p.dischargeDate,
      baseCount: +p.baseCount || 0,                 // 시스템 도입 전 출석 횟수
      baseGrantedBlocks: Math.max(+p.baseGrantedBlocks || 0, slotBlocks), // 마일리지 지급 차수
      baseLastDate: p.baseLastDate || null,         // 시스템 도입 전 마지막 출석일
      mileageSlots,                                 // 1~5차 (24/48/72/96/120회) 기준일·건의일
      createdAt: todayStr(),
    };
    await DB.put('members', m);
    for (const sl of mileageSlots) {
      await this.addGrant({
        memberId: m.id,
        memberName: m.name,
        unitLabel: unitLabel(m),
        stage: sl.stage,
        baseDate: sl.baseDate || '',
        proposedDate: sl.proposedDate || sl.baseDate || todayStr(),
        fromCount: (sl.stage - 1) * CONFIG.mileageUnit + 1,
        uptoCount: sl.count,
        days: 1,
        memo: sl.memo || `${sl.stage}차(${sl.count}회)`,
      }, syncServer);
    }
    if (syncServer && typeof Backend !== 'undefined') {
      await Backend.enqueue('upsertMember', { member: m });
    }
    return m;
  },

  async addMembersBatch(list) {
    const existing = await DB.all('members');
    const byKey = {};
    existing.forEach(m => {
      byKey[`${m.unit}|${m.company || ''}|${m.name}|${m.dischargeDate}`] = m;
    });
    const upserted = [];
    for (const p of list) {
      const key = `${p.unit}|${p.company || ''}|${p.name}|${p.dischargeDate}`;
      const ex = byKey[key];
      if (ex) {
        const mergedSlots = this.getMemberSlots(ex, await this.grantsOf(ex.id)).map(sl => {
          const inc = (p.mileageSlots || []).find(x => +x.stage === sl.stage);
          return {
            stage: sl.stage,
            count: sl.count,
            baseDate: (inc && inc.baseDate) ? normalizeDate(inc.baseDate) : sl.baseDate,
            proposedDate: (inc && inc.proposedDate) ? normalizeDate(inc.proposedDate) : sl.proposedDate,
            memo: (inc && inc.memo) || sl.memo || '',
          };
        });
        const normSlots = this.normalizeSlots(mergedSlots);
        const slotBlocks = normSlots.reduce((mx, sl) => Math.max(mx, sl.stage), 0);
        ex.baseCount = p.baseCount !== undefined && p.baseCount !== '' ? (+p.baseCount || 0) : ex.baseCount;
        if (p.baseLastDate) ex.baseLastDate = p.baseLastDate;
        ex.mileageSlots = normSlots;
        ex.baseGrantedBlocks = Math.max(ex.baseGrantedBlocks || 0, +p.baseGrantedBlocks || 0, slotBlocks);
        await DB.put('members', ex);
        await this.syncGrantsWithSlots(ex, normSlots, false);
        upserted.push(ex);
      } else {
        upserted.push(await this.addMember(p, false));
      }
    }
    if (upserted.length && typeof Backend !== 'undefined') {
      await Backend.enqueue('upsertMembersBatch', { members: upserted });
    }
    return upserted;
  },

  async updateMember(id, patch) {
    const m = await DB.get('members', id);
    Object.assign(m, patch);
    await DB.put('members', m);
    if (typeof Backend !== 'undefined') {
      await Backend.enqueue('upsertMember', { member: m });
    }
    return m;
  },

  async deleteMember(id) {
    // 목사님 전용 화면(PIN 통과) 안에서는 추가 비밀번호 팝업 없이 즉시 로컬 DB에서 삭제하고 백엔드 동기화 큐에 등록
    const targetId = String(id);
    const allAtts = await DB.all('attendance');
    for (const a of allAtts) {
      if (String(a.memberId) === targetId) {
        await DB.del('attendance', a.id);
        await DB.del('photos', a.id);
      }
    }
    const allGrants = await DB.all('mileage');
    for (const g of allGrants) {
      if (String(g.memberId) === targetId) {
        await DB.del('mileage', g.id);
      }
    }
    await DB.del('members', id);
    if (typeof id === 'string' && /^\d+$/.test(id)) {
      try { await DB.del('members', Number(id)); } catch (e) {}
    }
    if (typeof Backend !== 'undefined') {
      if (!Backend.sessionBackendPw) {
        const s = await this.settings();
        Backend.sessionBackendPw = s.password || CONFIG.defaultPassword || '0113';
      }
      await Backend.enqueue('deleteMember', { id });
    }
  },

  async deleteMembersBatch(ids) {
    if (!ids || !ids.length) return;
    for (const id of ids) {
      await this.deleteMember(id);
    }
  },

  /* ---------- 출석 ---------- */
  async attendedOn(memberId, date) {
    return (await DB.byIndex('attendance', 'memberId', memberId)).some(a => a.date === date);
  },

  /** 출석 기록. 같은 날 중복 출석은 거부합니다. */
  async recordAttendance({ memberId, blob = null, when = new Date(), manual = false, reason = '' }) {
    const m = await DB.get('members', memberId);
    if (!m) throw new Error('등록되지 않은 형제입니다.');
    const date = fmtDate(when), time = fmtTime(when);
    if (await this.attendedOn(memberId, date)) {
      const e = new Error(`${m.name} 형제님은 ${date}에 이미 출석 기록이 있습니다.`);
      e.code = 'DUP'; throw e;
    }
    const a = {
      id: uid(), memberId, date, time, ts: when.getTime(),
      fileName: `${date} ${time} ${m.name}`,   // 요청하신 "yyyy-mm-dd hh:mm 이름" 형식
      unitLabel: unitLabel(m), memberName: m.name,
      manual, reason, hasPhoto: !!blob, createdAt: Date.now(),
    };
    await DB.put('attendance', a);
    if (blob) await DB.put('photos', blob, a.id);
    if (typeof Backend !== 'undefined') {
      await Backend.enqueue('recordAttendance', { attendance: a });
    }

    // 같은 날 · 같은 부대 · 같은 이름으로 다른 기록이 있으면 [경고-확인필요]
    if (!manual) {
      const sameDay = (await DB.byIndex('attendance', 'date', date))
        .filter(x => x.id !== a.id && x.unitLabel === a.unitLabel && (x.memberName || x.fileName.split(' ').pop()) === m.name);
      if (sameDay.length) {
        await this.addWarning({
          type: 'DUP_SAME_DAY', date, unitLabel: a.unitLabel, name: m.name,
          detail: `같은 날 같은 부대·같은 이름으로 출석이 ${sameDay.length + 1}건 기록되었습니다. (동명이인인지, 대리/중복 출석인지 확인 필요)`,
          attendanceIds: [...sameDay.map(x => x.id), a.id],
        });
      }
    }
    const s = await this.memberWithStats(memberId);
    return { attendance: a, total: s.total };
  },

  /** 다시 찍기: 같은 출석 기록의 사진·시간을 새 것으로 교체 (재촬영 횟수 기록) */
  async replacePhoto(attId, blob, when) {
    const a = await DB.get('attendance', attId);
    const m = await DB.get('members', a.memberId);
    a.time = fmtTime(when); a.ts = when.getTime();
    a.fileName = `${a.date} ${a.time} ${m.name}`;
    a.retakes = (a.retakes || 0) + 1;
    a.hasPhoto = true;
    await DB.put('attendance', a);
    await DB.put('photos', blob, a.id);
    if (typeof Backend !== 'undefined') {
      await Backend.enqueue('replacePhoto', { attendance: a });
    }
    return a;
  },

  /** 기록 취소: 출석 삭제. 이번에 새로 등록한 형제면 형제 정보도 삭제 */
  async cancelAttendance(attId, removeNewMember = false) {
    const a = await DB.get('attendance', attId);
    if (!a) return;
    await this.deleteAttendance(attId, false);
    if (removeNewMember) {
      const rest = await DB.byIndex('attendance', 'memberId', a.memberId);
      const m = await DB.get('members', a.memberId);
      if (!rest.length && m && !m.baseCount) await DB.del('members', a.memberId);
    }
    if (typeof Backend !== 'undefined') {
      await Backend.enqueue('cancelAttendance', { attId, removeNewMember, memberId: a.memberId });
    }
  },

  async deleteAttendance(id, syncServer = true) {
    await DB.del('attendance', id);
    await DB.del('photos', id);
    if (syncServer && typeof Backend !== 'undefined') {
      if (!Backend.sessionBackendPw) {
        const s = await this.settings();
        Backend.sessionBackendPw = s.password || CONFIG.defaultPassword || '0113';
      }
      await Backend.enqueue('deleteAttendance', { id });
    }
  },

  /* ---------- 경고 [경고-확인필요] ---------- */
  async addWarning(w) {
    const rec = { id: uid(), createdAt: Date.now(), resolved: false, emailSent: false, ...w };
    await DB.put('warnings', rec);
    if (typeof Backend !== 'undefined') {
      await Backend.enqueue('addWarning', { warning: rec, sendEmail: true });
    }
    return rec;
  },
  async warnings() { return (await DB.all('warnings')).sort((a, b) => b.createdAt - a.createdAt); },
  async resolveWarning(id, memo) {
    const w = await DB.get('warnings', id);
    const resolvedAt = Date.now();
    Object.assign(w, { resolved: true, resolvedAt, memo });
    await DB.put('warnings', w);
    if (typeof Backend !== 'undefined') {
      await Backend.enqueue('resolveWarning', { id, memo, resolvedAt });
    }
  },
  async attendanceById(id) {
    const a = await DB.get('attendance', id);
    if (a) return a;
    for (const d of await DB.all('discharged')) {
      const f = (d.attendances || []).find(x => x.id === id);
      if (f) return f;
    }
    return null;
  },

  async getPhoto(id) {
    const local = await DB.get('photos', id);
    if (local) return local;
    if (typeof Backend !== 'undefined') {
      return Backend.fetchPhotoAndCache(id);
    }
    return null;
  },

  async recentManual(limit = 30) {
    const [att, ms] = await Promise.all([DB.all('attendance'), DB.all('members')]);
    const byId = Object.fromEntries(ms.map(m => [m.id, m]));
    return att.filter(a => a.manual).sort((a, b) => b.createdAt - a.createdAt).slice(0, limit)
      .map(a => ({ ...a, member: byId[a.memberId] }));
  },

  /* ---------- 마일리지 (1~5차: 24/48/72/96/120회 기준일·건의일) ---------- */
  getMemberSlots(m, grants = []) {
    const U = CONFIG.mileageUnit;
    const atts = (m.atts || []).slice().sort((a, b) => a.ts - b.ts);
    const baseCount = m.baseCount || 0;
    const rawSlots = Array.isArray(m.mileageSlots) ? m.mileageSlots : [];
    const byStage = {};
    for (let s = 1; s <= 5; s++) {
      const targetCount = s * U;
      let achievedDate = '';
      if (baseCount + atts.length >= targetCount) {
        const idxInAtts = targetCount - baseCount - 1;
        if (idxInAtts >= 0 && atts[idxInAtts]) {
          achievedDate = atts[idxInAtts].date;
        } else if (m.baseLastDate) {
          achievedDate = m.baseLastDate;
        } else if (atts.length) {
          achievedDate = atts[atts.length - 1].date;
        } else {
          achievedDate = m.createdAt || todayStr();
        }
      }
      byStage[s] = {
        stage: s,
        count: targetCount,
        label: `${targetCount}회`,
        baseDate: '',
        proposedDate: '',
        achievedDate,
        memo: '',
        grantId: null,
      };
    }
    rawSlots.forEach(item => {
      if (!item) return;
      const st = +item.stage || Math.round((+item.count || 0) / U);
      if (st >= 1 && st <= 5) {
        if (item.baseDate) byStage[st].baseDate = normalizeDate(item.baseDate);
        if (item.proposedDate) byStage[st].proposedDate = normalizeDate(item.proposedDate);
        if (item.memo) byStage[st].memo = item.memo;
      }
    });
    (grants || []).slice().sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)).forEach(g => {
      const st = +g.stage || Math.round((+g.uptoCount || 0) / U);
      if (st >= 1 && st <= 5) {
        if (g.baseDate) byStage[st].baseDate = normalizeDate(g.baseDate);
        if (g.proposedDate) byStage[st].proposedDate = normalizeDate(g.proposedDate);
        if (g.memo) byStage[st].memo = g.memo;
        byStage[st].grantId = g.id;
      }
    });
    return [1, 2, 3, 4, 5].map(s => byStage[s]);
  },

  grantedUpTo(m, grants) {
    const U = CONFIG.mileageUnit;
    const slots = this.getMemberSlots(m, grants);
    let maxFromSlots = 0;
    slots.forEach(sl => {
      if (sl.proposedDate || sl.baseDate) maxFromSlots = Math.max(maxFromSlots, sl.count);
    });
    return Math.max((m.baseGrantedBlocks || 0) * U, maxFromSlots, ...(grants || []).map(g => g.uptoCount || 0), 0);
  },

  async grantsOf(memberId) { return DB.byIndex('mileage', 'memberId', memberId); },
  async allGrants() { return DB.all('mileage'); },

  async addGrant(g, syncServer = true) {
    const U = CONFIG.mileageUnit;
    const stage = +g.stage || Math.round((+g.uptoCount || U) / U);
    const rec = {
      id: uid(),
      createdAt: Date.now(),
      stage,
      baseDate: normalizeDate(g.baseDate || ''),
      proposedDate: normalizeDate(g.proposedDate || todayStr()),
      fromCount: (stage - 1) * U + 1,
      uptoCount: stage * U,
      days: 1,
      ...g,
    };
    await DB.put('mileage', rec);
    if (syncServer && typeof Backend !== 'undefined') {
      await Backend.enqueue('addGrant', { grant: rec });
    }
    return rec;
  },

  async deleteGrant(id, syncServer = true) {
    await DB.del('mileage', id);
    if (syncServer && typeof Backend !== 'undefined') {
      await Backend.enqueue('deleteGrant', { id });
    }
  },

  async syncGrantsWithSlots(m, normSlots, syncServer = true) {
    const oldGrants = await this.grantsOf(m.id);
    for (const g of oldGrants) {
      await this.deleteGrant(g.id, syncServer);
    }
    for (const sl of normSlots) {
      await this.addGrant({
        memberId: m.id,
        memberName: m.name,
        unitLabel: unitLabel(m),
        stage: sl.stage,
        baseDate: sl.baseDate || '',
        proposedDate: sl.proposedDate || sl.baseDate || todayStr(),
        fromCount: (sl.stage - 1) * CONFIG.mileageUnit + 1,
        uptoCount: sl.count,
        days: 1,
        memo: sl.memo || `${sl.stage}차(${sl.count}회)`,
      }, syncServer);
    }
  },

  async saveMemberSlots(memberId, slotsInput) {
    const m = await DB.get('members', memberId);
    if (!m) return null;
    const normSlots = this.normalizeSlots(slotsInput);
    const slotBlocks = normSlots.reduce((mx, sl) => Math.max(mx, sl.stage), 0);
    m.mileageSlots = normSlots;
    m.baseGrantedBlocks = slotBlocks;
    await DB.put('members', m);
    await this.syncGrantsWithSlots(m, normSlots, true);
    if (typeof Backend !== 'undefined') {
      await Backend.enqueue('upsertMember', { member: m });
    }
    return m;
  },

  /* ---------- 전역자 ---------- */
  /** 전역일이 지난 형제를 전역자 보관함으로 이동 (사진은 그대로 보존) */
  async processDischarges() {
    const today = todayStr();
    const ms = await DB.all('members');
    let moved = 0;
    for (const m of ms) {
      if (m.dischargeDate && m.dischargeDate < today) {
        const atts = await DB.byIndex('attendance', 'memberId', m.id);
        const grants = await DB.byIndex('mileage', 'memberId', m.id);
        await DB.put('discharged', { ...m, attendances: atts, mileage: grants, movedAt: today });
        for (const a of atts) await DB.del('attendance', a.id);
        for (const g of grants) await DB.del('mileage', g.id);
        await DB.del('members', m.id);
        moved++;
      }
    }
    if (moved && typeof Backend !== 'undefined') {
      await Backend.enqueue('processDischarges', { today });
    }
    return moved;
  },
  async dischargedList() {
    return (await DB.all('discharged')).map(d => this.withStats(d, d.attendances)).sort(koSort);
  },
  /** 전역일을 잘못 넣었을 때 복원 */
  async restoreDischarged(id, newDischargeDate) {
    const d = await DB.get('discharged', id);
    const { attendances = [], mileage = [], movedAt, ...m } = d;
    m.dischargeDate = newDischargeDate;
    await DB.put('members', m);
    for (const a of attendances) await DB.put('attendance', a);
    for (const g of mileage) await DB.put('mileage', g);
    await DB.del('discharged', id);
    if (typeof Backend !== 'undefined') {
      await Backend.enqueue('restoreDischarged', { id, newDischargeDate });
    }
  },

  /** 리포트용: 현역 + 전역자 전부 (출석/마일리지 포함) */
  async allPeopleFull() {
    const [ms, att, grants, dis] = await Promise.all([
      DB.all('members'), DB.all('attendance'), DB.all('mileage'), DB.all('discharged')]);
    const A = {}, G = {};
    att.forEach(a => (A[a.memberId] = A[a.memberId] || []).push(a));
    grants.forEach(g => (G[g.memberId] = G[g.memberId] || []).push(g));
    return [
      ...ms.map(m => ({ ...this.withStats(m, A[m.id]), grants: G[m.id] || [], discharged: false })),
      ...dis.map(d => ({ ...this.withStats(d, d.attendances), grants: d.mileage || [], discharged: true })),
    ];
  },

  /* ---------- 백업 / 복원 (기기 교체·인계용) ---------- */
  async exportBackup() {
    const blobToDataURL = b => new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(b); });
    const photoKeys = await DB.keys('photos');
    const photos = {};
    for (const k of photoKeys) { const b = await DB.get('photos', k); if (b) photos[k] = await blobToDataURL(b); }
    return {
      app: 'cheongun-attendance', version: 1, exportedAt: new Date().toISOString(),
      settings: await DB.get('settings', 'main') || null,
      members: await DB.all('members'),
      attendance: await DB.all('attendance'),
      mileage: await DB.all('mileage'),
      discharged: await DB.all('discharged'),
      warnings: await DB.all('warnings'),
      photos,
    };
  },
  async importBackup(data) {
    if (data.app !== 'cheongun-attendance') throw new Error('천군교회 출석 백업 파일이 아닙니다.');
    for (const s of ['members', 'attendance', 'mileage', 'discharged', 'photos', 'warnings']) await DB.clear(s);
    for (const w of data.warnings || []) await DB.put('warnings', w);
    if (data.settings) await DB.put('settings', data.settings, 'main');
    for (const m of data.members || []) await DB.put('members', m);
    for (const a of data.attendance || []) await DB.put('attendance', a);
    for (const g of data.mileage || []) await DB.put('mileage', g);
    for (const d of data.discharged || []) await DB.put('discharged', d);
    for (const [k, url] of Object.entries(data.photos || {})) {
      const blob = await (await fetch(url)).blob();
      await DB.put('photos', blob, k);
    }
  },
};
