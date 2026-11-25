/* =========================================================
 * 공통 유틸
 * ========================================================= */
const pad = n => String(n).padStart(2, '0');
const fmtDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fmtTime = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const todayStr = () => fmtDate(new Date());
const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
const weekdayOf = s => WEEK[new Date(s + 'T00:00:00').getDay()];
const worshipDayOf = dOrStr => {
  const day = (dOrStr instanceof Date) ? dOrStr.getDay() : new Date(dOrStr + 'T00:00:00').getDay();
  return day === 0 ? '주일' : `${WEEK[day]}요일`;
};
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
  const t = String(v).trim();
  // 숫자만 입력해도 인식: 261112 / 20261112
  const dg = t.match(/^(\d{2}|\d{4})(\d{2})(\d{2})$/);
  if (dg) {
    let y = +dg[1]; if (y < 100) y += 2000;
    const d = new Date(y, +dg[2] - 1, +dg[3]);
    return (isNaN(d) || d.getMonth() !== +dg[2] - 1) ? '' : fmtDate(d);
  }
  const m = t.match(/^(\d{2,4})[.\-\/년\s]+(\d{1,2})[.\-\/월\s]+(\d{1,2})/);
  if (!m) return '';
  let y = +m[1]; if (y < 100) y += 2000;
  const d = new Date(y, +m[2] - 1, +m[3]);
  if (isNaN(d) || d.getMonth() !== +m[2] - 1) return '';
  return fmtDate(d);
}

/** 사진 명단에서 날짜를 알 수 없는 출석 (표기: 00-00 / 00.00.00) */
const UNKNOWN_DATE = '0000-00-00';
const isUnknownDate = s => !s || String(s).startsWith('0000');
/** 월-일 표기 (날짜를 모르면 00-00) */
const fmtMD = s => (isUnknownDate(s) ? '00-00' : String(s).slice(5, 10));
/** '26.02.01, 00.00.00 ...' 형태의 문자열 → ['2026-02-01', '0000-00-00', ...] */
function parseDateList(v) {
  return String(v || '').split(/[,;\s·]+/).map(t => t.trim()).filter(Boolean).map(t => {
    if (/^0{2,4}[.\-\/]0{1,2}[.\-\/]0{1,2}$/.test(t)) return UNKNOWN_DATE;
    return normalizeDate(t);
  }).filter(Boolean);
}

/** 날짜를 26.02.01 (YY.MM.DD) 형식으로 표기 */
function fmtYYMMDD(v) {
  if (String(v || '').startsWith('0000')) return '00.00.00';
  const s = normalizeDate(v);
  if (!s) return '';
  const [y, m, d] = s.split('-');
  return `${y.slice(-2)}.${m}.${d}`;
}

/** 날짜를 9월6일 (M월D일) 형식으로 표기 */
function fmtKorMD(v) {
  if (!v || String(v).startsWith('0000')) return '';
  const s = normalizeDate(v);
  if (!s) return '';
  const [, m, d] = s.split('-');
  return `${+m}월${+d}일`;
}

const HISTORY_SEED_REV = 2026112501;
const SYS_ATT_SEED_REV = 2026111502;

/** 앱 출석 기록(m.atts)과 겹치는 날짜를 과거 출석일자 목록에서 1회씩 제외해 중복 합산을 방지 */
function dedupePastDates(seedDates, atts) {
  const dates = Array.isArray(seedDates) ? seedDates.slice() : [];
  const sortedAtts = (atts || []).slice().sort((a, b) => (a.ts || 0) - (b.ts || 0));
  for (const a of sortedAtts) {
    if (!a || !a.date) continue;
    const idx = dates.lastIndexOf(a.date);
    if (idx >= 0) dates.splice(idx, 1);
  }
  return dates;
}

function seedSlotsToObjects(rawSlots) {
  const U = CONFIG.mileageUnit;
  const arr = Array.isArray(rawSlots) ? rawSlots : [];
  const out = [];
  for (let s = 1; s <= 5; s++) {
    const baseDate = normalizeDate(arr[(s - 1) * 2] || '');
    const proposedDate = normalizeDate(arr[(s - 1) * 2 + 1] || '');
    if (baseDate || proposedDate) {
      out.push({ stage: s, count: s * U, baseDate, proposedDate, memo: `${s}차(${s * U}회)` });
    }
  }
  return out;
}

/* =========================================================
 * Store : 데이터 처리 (로컬 IndexedDB + 백엔드 자동 동기화)
 * ========================================================= */
const Store = {
  parseDateList,
  _seedingPromise: null,
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
    const lastPast = Array.isArray(m.pastDates)
      ? m.pastDates.filter(d => !isUnknownDate(d)).sort().pop() || null
      : null;
    const last = [lastSys, m.baseLastDate, lastPast].filter(Boolean).sort().pop() || null;
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
    if (!m || m.discharged) return false;
    const today = todayStr();
    if (m.dischargeDate && m.dischargeDate < today) return false;
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
      pastDates: Array.isArray(p.pastDates) ? p.pastDates.slice() : [],   // 사진촬영 전 출석일 목록 (모르면 0000-00-00)
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
        if (Array.isArray(p.pastDates) && p.pastDates.length) ex.pastDates = p.pastDates.slice();
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

  /* ---------- 출석 타임라인 (사진촬영 전 출석일 + 앱 기록) ---------- */
  /** 1회째부터 순서대로 [{date, unknown, att?}] — 도입 전 날짜는 m.pastDates, 이후는 앱 출석 기록 */
  timeline(m, atts) {
    const base = m.baseCount || 0;
    let past = Array.isArray(m.pastDates) ? m.pastDates.slice() : [];
    if (past.length > base) past = past.slice(0, base);
    while (past.length < base) past.unshift(UNKNOWN_DATE);
    const list = (atts || m.atts || []).slice().sort((a, b) => a.ts - b.ts);
    return [
      ...past.map(d => ({ date: d, unknown: isUnknownDate(d) })),
      ...list.map(a => ({ date: a.date, unknown: false, att: a })),
    ];
  },

  /** 출석이력 엑셀 반영: [{unit, name, dates/pastDates:[...], dc/dischargeDate}] → 형제별 pastDates·baseCount 저장 */
  async applyPastDatesBatch(list) {
    const [ms, allAtts] = await Promise.all([DB.all('members'), DB.all('attendance')]);
    const attByMember = {};
    allAtts.forEach(a => (attByMember[a.memberId] = attByMember[a.memberId] || []).push(a));
    const res = { applied: 0, updated: 0, missing: [], missed: 0, ambiguous: [], countDiff: [] };
    const changed = [];
    for (const it of list) {
      const unit = String(it.unit || '').trim();
      const name = String(it.name || '').replace(/\s/g, '');
      const dc = normalizeDate(it.dc || it.dischargeDate || '');
      let hit = ms.filter(m => m.unit === unit && m.name === name && (!dc || !m.dischargeDate || m.dischargeDate === dc));
      if (!hit.length) {
        const byUN = ms.filter(m => m.unit === unit && m.name === name);
        if (byUN.length === 1) hit = byUN;
      }
      if (!hit.length) { res.missing.push(`${unit} ${name}`); continue; }
      if (hit.length > 1) { res.ambiguous.push(`${unit} ${name}`); continue; }
      const m = hit[0];
      const rawDates = Array.isArray(it.dates) ? it.dates : (Array.isArray(it.pastDates) ? it.pastDates : []);
      const pastDates = dedupePastDates(rawDates, attByMember[m.id]);
      if ((m.baseCount || 0) !== pastDates.length) {
        res.countDiff.push(`${unit} ${name} (기존 ${m.baseCount || 0}회 → 반영 ${pastDates.length}회)`);
      }
      m.pastDates = pastDates;
      m.baseCount = pastDates.length;
      const lastKnown = pastDates.filter(d => !isUnknownDate(d)).pop() || null;
      if (lastKnown || m.baseCount === 0) m.baseLastDate = lastKnown;
      await DB.put('members', m);
      changed.push(m);
      res.applied++;
    }
    res.updated = res.applied;
    res.missed = res.missing.length;
    if (changed.length && typeof Backend !== 'undefined') {
      await Backend.enqueue('upsertMembersBatch', { members: changed });
    }
    return res;
  },

  /** 내장된 전체 출석이력·정정 내역(window.SEED_PEOPLE_HISTORY)을 로컬 DB에 자동 반영 */
  async ensureHistorySeeded(force = false) {
    if (this._seedingPromise) return this._seedingPromise;
    this._seedingPromise = this._runHistorySeed(force).finally(() => { this._seedingPromise = null; });
    return this._seedingPromise;
  },

  async _runHistorySeed(force = false) {
    const seeds = (typeof window !== 'undefined' && Array.isArray(window.SEED_PEOPLE_HISTORY))
      ? window.SEED_PEOPLE_HISTORY : [];
    const sysAtts = (typeof window !== 'undefined' && Array.isArray(window.SEED_SYSTEM_ATTENDANCE))
      ? window.SEED_SYSTEM_ATTENDANCE : [];
    if (!seeds.length) return { seeded: false, created: 0, updated: 0 };

    let [ms, allAtts, allGrants, rawSettings, disList] = await Promise.all([
      DB.all('members'),
      DB.all('attendance'),
      DB.all('mileage'),
      DB.get('settings', 'main'),
      DB.all('discharged'),
    ]);
    const settings = rawSettings || {};
    const activeSeeds = seeds.filter(p => !p.discharged);
    const dischargedSeeds = seeds.filter(p => p.discharged);
    const seedByUN = Object.fromEntries(activeSeeds.map(p => [`${p.unit}|${p.name}`, p]));

    const hasEmptyPast = ms.some(m => {
      const seed = seedByUN[`${m.unit}|${m.name}`];
      return seed && seed.dates.length > 0 && (!Array.isArray(m.pastDates) || m.pastDates.length === 0);
    });
    if (!force && ms.length > 0 && settings.historySeedRev === HISTORY_SEED_REV
      && settings.sysAttSeededRev === SYS_ATT_SEED_REV && !hasEmptyPast) {
      return { seeded: false, created: 0, updated: 0 };
    }

    let created = 0;
    const isFreshDb = ms.length === 0 && disList.length === 0;
    if (isFreshDb) {
      for (const seed of activeSeeds) {
        const seedSlots = seedSlotsToObjects(seed.slots);
        await this.addMember({
          unit: seed.unit,
          name: seed.name,
          dischargeDate: seed.dc,
          baseCount: seed.dates.length,
          baseLastDate: seed.last || null,
          mileageSlots: seedSlots,
          pastDates: seed.dates.slice(),
        }, false);
        created++;
      }
      ms = await DB.all('members');
      allGrants = await DB.all('mileage');
    }

    // 전역자 시드 (예: 표승진) 반영 및 누락 시 전역자 보관함 생성
    for (const dSeed of dischargedSeeds) {
      const seedSlots = seedSlotsToObjects(dSeed.slots);
      const inActive = ms.find(m => m.unit === dSeed.unit && m.name === dSeed.name);
      if (inActive) continue;
      let dEx = disList.find(d => d.unit === dSeed.unit && d.name === dSeed.name);
      if (!dEx) {
        const memberId = uid();
        const grants = seedSlots.map(sl => ({
          id: uid(),
          memberId,
          memberName: dSeed.name,
          unitLabel: dSeed.unit,
          stage: sl.stage,
          baseDate: sl.baseDate || '',
          proposedDate: sl.proposedDate || sl.baseDate || dSeed.dc,
          fromCount: (sl.stage - 1) * CONFIG.mileageUnit + 1,
          uptoCount: sl.count,
          days: 1,
          memo: sl.memo || `${sl.stage}차(${sl.count}회)`,
          createdAt: Date.now(),
        }));
        dEx = {
          id: memberId,
          name: dSeed.name,
          unit: dSeed.unit,
          company: null,
          dischargeDate: dSeed.dc,
          baseCount: dSeed.dates.length,
          baseGrantedBlocks: seedSlots.reduce((mx, sl) => Math.max(mx, sl.stage), 0),
          baseLastDate: dSeed.last || null,
          mileageSlots: seedSlots,
          pastDates: dSeed.dates.slice(),
          createdAt: dSeed.dc,
          attendances: [],
          mileage: grants,
          movedAt: dSeed.dc,
        };
        await DB.put('discharged', dEx);
        disList.push(dEx);
      } else if (!Array.isArray(dEx.pastDates) || dEx.pastDates.length !== dSeed.dates.length) {
        const nextPast = dedupePastDates(dSeed.dates, dEx.attendances);
        dEx.pastDates = nextPast;
        dEx.baseCount = nextPast.length;
        dEx.baseLastDate = nextPast.filter(dt => !isUnknownDate(dt)).pop() || null;
        if (seedSlots.length && (!Array.isArray(dEx.mileageSlots) || !dEx.mileageSlots.length)) {
          dEx.mileageSlots = seedSlots;
          dEx.baseGrantedBlocks = Math.max(dEx.baseGrantedBlocks || 0, seedSlots.reduce((mx, sl) => Math.max(mx, sl.stage), 0));
        }
        await DB.put('discharged', dEx);
      }
    }

    const attByMember = {};
    allAtts.forEach(a => (attByMember[a.memberId] = attByMember[a.memberId] || []).push(a));
    const grantsByMember = {};
    allGrants.forEach(g => (grantsByMember[g.memberId] = grantsByMember[g.memberId] || []).push(g));

    // 11.11(수) / 11.15(일) 시스템 출석 기록 누락분 자동 채움 (이미 해당 일자 사진/출석이 있으면 그대로 유지)
    if (sysAtts.length && (isFreshDb || settings.sysAttSeededRev !== SYS_ATT_SEED_REV)) {
      const mByUN = Object.fromEntries(ms.map(m => [`${m.unit}|${m.name}`, m]));
      for (const sa of sysAtts) {
        const m = mByUN[`${sa.unit}|${sa.name}`];
        if (!m) continue;
        const mAtts = attByMember[m.id] || [];
        if (mAtts.some(a => a.date === sa.date)) continue;
        const ts = new Date(`${sa.date}T${sa.time || '11:00'}:00+09:00`).getTime();
        const attRec = {
          id: `seed_att_${sa.date}_${sa.unit}_${sa.name}`,
          memberId: m.id,
          date: sa.date,
          time: sa.time || '11:00',
          ts: isNaN(ts) ? Date.now() : ts,
          fileName: sa.fileName || `${sa.date} ${sa.time || '11:00'} ${m.name}`,
          unitLabel: unitLabel(m),
          memberName: m.name,
          manual: false,
          reason: '',
          hasPhoto: false,
          createdAt: isNaN(ts) ? Date.now() : ts,
        };
        await DB.put('attendance', attRec);
        mAtts.push(attRec);
        attByMember[m.id] = mAtts;
      }
      settings.sysAttSeededRev = SYS_ATT_SEED_REV;
    }

    let updated = 0;
    const today = todayStr();
    // 미래 연도 오기재(예: 2025→2026), 기준일>건의일 뒤바뀜, 이전 차수가 이후 차수보다 늦은 오기재 감지
    const isCorruptedLegacySlot = (sl, allSlots) => {
      if (!sl) return false;
      if (sl.baseDate && sl.baseDate > today) return true;
      if (sl.proposedDate && sl.proposedDate > today) return true;
      if (sl.baseDate && sl.proposedDate && sl.baseDate > sl.proposedDate) return true;
      return (allSlots || []).some(other => other && other.stage > sl.stage && (
        (sl.baseDate && other.baseDate && sl.baseDate > other.baseDate) ||
        (sl.proposedDate && other.proposedDate && sl.proposedDate > other.proposedDate)
      ));
    };
    for (const seed of activeSeeds) {
      const seedSlots = seedSlotsToObjects(seed.slots);
      let hit = ms.filter(m => m.unit === seed.unit && m.name === seed.name && (!seed.dc || !m.dischargeDate || m.dischargeDate === seed.dc));
      if (!hit.length) {
        const byUN = ms.filter(m => m.unit === seed.unit && m.name === seed.name);
        if (byUN.length === 1) hit = byUN;
      }
      if (!hit.length) {
        const dHit = disList.filter(d => d.unit === seed.unit && d.name === seed.name);
        if (dHit.length === 1) {
          const d = dHit[0];
          let dChanged = false;
          if (!Array.isArray(d.pastDates) || !d.pastDates.length) {
            const nextPast = dedupePastDates(seed.dates, d.attendances);
            d.pastDates = nextPast;
            d.baseCount = nextPast.length;
            d.baseLastDate = nextPast.filter(dt => !isUnknownDate(dt)).pop() || null;
            dChanged = true;
          }
          const dCurSlots = this.getMemberSlots(d, d.mileage || []);
          let dCorrupted = false;
          const dMergedSlots = this.normalizeSlots(
            dCurSlots.map(sl => {
              const inc = seedSlots.find(x => +x.stage === sl.stage);
              if (isCorruptedLegacySlot(sl, dCurSlots) && inc && (inc.baseDate || inc.proposedDate)) {
                dCorrupted = true;
                return {
                  stage: sl.stage,
                  count: sl.count,
                  baseDate: inc.baseDate || '',
                  proposedDate: inc.proposedDate || '',
                  memo: sl.memo || inc.memo || '',
                };
              }
              return {
                stage: sl.stage,
                count: sl.count,
                baseDate: sl.baseDate || '',
                proposedDate: sl.proposedDate || '',
                memo: sl.memo || '',
              };
            })
          );
          if (dCorrupted) {
            d.mileageSlots = dMergedSlots;
            d.baseGrantedBlocks = Math.max(d.baseGrantedBlocks || 0, dMergedSlots.reduce((mx, sl) => Math.max(mx, sl.stage), 0));
            d.mileage = dMergedSlots.map(sl => ({
              id: uid(),
              memberId: d.id,
              memberName: d.name,
              unitLabel: unitLabel(d),
              stage: sl.stage,
              baseDate: sl.baseDate || '',
              proposedDate: sl.proposedDate || sl.baseDate || today,
              fromCount: (sl.stage - 1) * CONFIG.mileageUnit + 1,
              uptoCount: sl.count,
              days: 1,
              memo: sl.memo || `${sl.stage}차(${sl.count}회)`,
              createdAt: Date.now(),
            }));
            dChanged = true;
          }
          if (dChanged) {
            await DB.put('discharged', d);
            updated++;
          }
        }
        continue;
      }
      if (hit.length > 1) continue;

      const ex = hit[0];
      const mAtts = attByMember[ex.id] || [];
      const mGrants = grantsByMember[ex.id] || [];
      const nextPast = dedupePastDates(seed.dates, mAtts);
      const nextBaseCount = nextPast.length;
      const nextLastDate = nextPast.filter(d => !isUnknownDate(d)).pop() || null;
      const totalAfter = nextBaseCount + mAtts.length;

      const curSlots = this.getMemberSlots(ex, mGrants);
      const isPostSeedSlot = sl => (sl.proposedDate && sl.proposedDate > '2026-11-15') || (sl.baseDate && sl.baseDate > '2026-11-15');
      let hadCorruptedFix = false;
      const mergedSlots = this.normalizeSlots(
        curSlots.map(sl => {
          const inc = seedSlots.find(x => +x.stage === sl.stage);
          // 과거 오기재 슬롯(연도 2025→2026, 기준일>건의일, 차수 역전)은 교정된 시드 값으로 자동 치유
          if (isCorruptedLegacySlot(sl, curSlots) && inc && (inc.baseDate || inc.proposedDate)) {
            hadCorruptedFix = true;
            return {
              stage: sl.stage,
              count: sl.count,
              baseDate: inc.baseDate || '',
              proposedDate: inc.proposedDate || '',
              memo: sl.memo || inc.memo || '',
            };
          }
          // 2026-11-15 이후(시드 기준일 이후)에 새로 입력·건의된 마일리지는 overrideSlots라도 절대 지우지 않고 보존
          if (seed.overrideSlots && !isPostSeedSlot(sl)) {
            return {
              stage: sl.stage,
              count: sl.count,
              baseDate: (inc && inc.baseDate) || '',
              proposedDate: (inc && inc.proposedDate) || '',
              memo: (inc && inc.memo) || sl.memo || '',
            };
          }
          const rawProp = sl.proposedDate || (inc && inc.proposedDate) || '';
          const safeProp = (rawProp && rawProp > today && inc && inc.proposedDate && inc.proposedDate <= today)
            ? inc.proposedDate : rawProp;
          return {
            stage: sl.stage,
            count: sl.count,
            baseDate: sl.baseDate || (inc && inc.baseDate) || '',
            proposedDate: safeProp,
            memo: sl.memo || (inc && inc.memo) || '',
          };
        }).filter(sl => (seed.overrideSlots && !isPostSeedSlot(sl)) ? totalAfter >= sl.count : true)
      );
      const prevNormSlots = this.normalizeSlots(ex.mileageSlots || []);
      const prevEffective = this.normalizeSlots(curSlots);
      const nextBlocks = seed.overrideSlots
        ? mergedSlots.reduce((mx, sl) => Math.max(mx, sl.stage), 0)
        : Math.max(ex.baseGrantedBlocks || 0, mergedSlots.reduce((mx, sl) => Math.max(mx, sl.stage), 0));

      const pastChanged = !Array.isArray(ex.pastDates) || ex.pastDates.length !== nextPast.length
        || ex.pastDates.some((d, i) => d !== nextPast[i]);
      const baseChanged = (ex.baseCount || 0) !== nextBaseCount;
      const lastChanged = (ex.baseLastDate || null) !== nextLastDate;
      const slotsFieldChanged = JSON.stringify(prevNormSlots) !== JSON.stringify(mergedSlots);
      const effectiveChanged = JSON.stringify(prevEffective) !== JSON.stringify(mergedSlots);
      const blocksChanged = (ex.baseGrantedBlocks || 0) !== nextBlocks;

      if (pastChanged || baseChanged || lastChanged || slotsFieldChanged || effectiveChanged || blocksChanged) {
        ex.pastDates = nextPast;
        ex.baseCount = nextBaseCount;
        ex.baseLastDate = nextLastDate;
        ex.mileageSlots = mergedSlots;
        ex.baseGrantedBlocks = nextBlocks;
        await DB.put('members', ex);
        if (effectiveChanged || hadCorruptedFix) {
          await this.syncGrantsWithSlots(ex, mergedSlots, hadCorruptedFix);
        }
        if (hadCorruptedFix && typeof Backend !== 'undefined') {
          await Backend.enqueue('upsertMember', { member: ex });
        }
        updated++;
      }
    }

    // 시드 처리 도중 다른 비동기 작업이 settings(단말기 승인, 비밀번호 등)를 변경했을 수 있으므로 최신본을 다시 읽어 병합
    const latestSettings = (await DB.get('settings', 'main')) || {};
    latestSettings.historySeedRev = HISTORY_SEED_REV;
    if (settings.sysAttSeededRev !== undefined) latestSettings.sysAttSeededRev = settings.sysAttSeededRev;
    if (latestSettings.sysAttSeededRev === undefined) latestSettings.sysAttSeededRev = SYS_ATT_SEED_REV;
    await DB.put('settings', latestSettings, 'main');

    return { seeded: true, created, updated };
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

  /** 가장 최근에 부대에 건의 완료된 마일리지 내역 반환 (없으면 null) */
  latestMileageProposal(m, grants = []) {
    if (!m) return null;
    const slots = this.getMemberSlots(m, grants);
    const proposed = slots.filter(sl => sl && sl.proposedDate);
    if (!proposed.length) return null;
    const last = proposed[proposed.length - 1];
    const baseRaw = last.baseDate || last.achievedDate || last.proposedDate;
    const baseMD = fmtKorMD(baseRaw);
    const propMD = fmtKorMD(last.proposedDate);
    if (!baseMD || !propMD) return null;
    return {
      stage: last.stage,
      count: last.count,
      baseDate: baseRaw,
      proposedDate: last.proposedDate,
      baseMD,
      propMD,
      text: `마일리지 : ${baseMD}부 ${last.count}회 -> ${propMD} 건의완료`,
    };
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

  /* ---------- 📓 소나기 (소중한 나의 병영일기) 현황 ---------- */
  normalizeSonagiItem(raw = {}) {
    const pickPeriod = (st, en, txt) => {
      const s = normalizeDate(st || '');
      const e = normalizeDate(en || '');
      if (txt && String(txt).trim()) return String(txt).trim();
      if (s && e) return `${fmtYYMMDD(s)}~${fmtYYMMDD(e)}`;
      if (s) return `${fmtYYMMDD(s)}~`;
      if (e) return `~${fmtYYMMDD(e)}`;
      return '';
    };
    const item = {
      id: String(raw.id || uid()),
      name: String(raw.name || '').replace(/\s/g, ''),
      unit: String(raw.unit || '').trim(),
      company: String(raw.company || '').trim(),
      memberId: String(raw.memberId || ''),
      churchAttend: ['auto', 'yes', 'no'].includes(raw.churchAttend) ? raw.churchAttend : 'auto',
      bundleMode: ['separate', '1_2', '2_3', '1_2_3'].includes(raw.bundleMode) ? raw.bundleMode : 'separate',
      s1Start: normalizeDate(raw.s1Start || ''),
      s1End: normalizeDate(raw.s1End || ''),
      s1Period: String(raw.s1Period || '').trim(),
      s1Essay: !!raw.s1Essay,
      s1Proposed: normalizeDate(raw.s1Proposed || ''),
      s2Start: normalizeDate(raw.s2Start || ''),
      s2End: normalizeDate(raw.s2End || ''),
      s2Period: String(raw.s2Period || '').trim(),
      s2Essay: !!raw.s2Essay,
      s2Proposed: normalizeDate(raw.s2Proposed || ''),
      s3Start: normalizeDate(raw.s3Start || ''),
      s3End: normalizeDate(raw.s3End || ''),
      s3Period: String(raw.s3Period || '').trim(),
      s3Essay: !!raw.s3Essay,
      s3Proposed: normalizeDate(raw.s3Proposed || ''),
      memo: String(raw.memo || '').trim(),
      createdAt: raw.createdAt || Date.now(),
      updatedAt: raw.updatedAt || Date.now(),
    };
    item.s1Period = pickPeriod(item.s1Start, item.s1End, item.s1Period);
    item.s2Period = pickPeriod(item.s2Start, item.s2End, item.s2Period);
    item.s3Period = pickPeriod(item.s3Start, item.s3End, item.s3Period);
    return item;
  },

  async sonagiList(peoplePreloaded = null) {
    const s = (await DB.get('settings', 'main')) || {};
    let arr = [];
    if (s.sonagiJson) {
      try { arr = JSON.parse(s.sonagiJson); } catch (e) { arr = []; }
    }
    if (!Array.isArray(arr)) arr = [];
    const people = peoplePreloaded || await this.allPeopleFull();
    const byId = Object.fromEntries(people.map(p => [String(p.id), p]));

    return arr.map(raw => {
      const it = this.normalizeSonagiItem(raw);
      let matched = it.memberId ? byId[it.memberId] : null;
      if (!matched && it.name) {
        matched = people.find(p => p.name === it.name && (!it.unit || p.unit === it.unit || unitLabel(p) === it.unit));
        if (!matched) {
          const sameName = people.filter(p => p.name === it.name);
          if (sameName.length === 1) matched = sameName[0];
        }
      }
      const bm = it.bundleMode;
      // 합산 모드에 따른 유효 기간/수기/건의 계산
      const has1 = !!(it.s1Period || it.s1Start || it.s1End || it.s1Proposed || it.s1Essay);
      const eff2Period = (bm === '1_2' || bm === '1_2_3') ? it.s1Period : it.s2Period;
      const eff2Proposed = (bm === '1_2' || bm === '1_2_3') ? (it.s2Proposed || it.s1Proposed) : it.s2Proposed;
      const eff2Essay = (bm === '1_2' || bm === '1_2_3') ? (it.s1Essay || it.s2Essay) : it.s2Essay;
      const has2 = (bm === '1_2' || bm === '1_2_3') ? has1 : !!(it.s2Period || it.s2Start || it.s2End || it.s2Proposed || it.s2Essay);

      const eff3Period = bm === '1_2_3' ? it.s1Period : (bm === '2_3' ? it.s2Period : it.s3Period);
      const eff3Proposed = bm === '1_2_3' ? (it.s3Proposed || it.s1Proposed) : (bm === '2_3' ? (it.s3Proposed || it.s2Proposed) : it.s3Proposed);
      const eff3Essay = bm === '1_2_3' ? (it.s1Essay || it.s3Essay) : (bm === '2_3' ? (it.s2Essay || it.s3Essay) : it.s3Essay);
      const has3 = bm === '1_2_3' ? has1 : (bm === '2_3' ? has2 : !!(it.s3Period || it.s3Start || it.s3End || it.s3Proposed || it.s3Essay));

      const isChurchMemberAttending = it.churchAttend === 'yes'
        ? true
        : (it.churchAttend === 'no' ? false : !!(matched && matched.total > 0));

      // 미건의 / 수기 미제출 개수 (합산 제출은 1건의 행정 조치 단위로 집계)
      let pendingProposals = 0;
      let missingEssays = 0;
      if (bm === '1_2') {
        if (has1 && !(it.s1Proposed || it.s2Proposed)) pendingProposals++;
        if (has1 && !(it.s1Essay || it.s2Essay)) missingEssays++;
        if (has3 && !it.s3Proposed) pendingProposals++;
        if (has3 && !it.s3Essay) missingEssays++;
      } else if (bm === '2_3') {
        if (has1 && !it.s1Proposed) pendingProposals++;
        if (has1 && !it.s1Essay) missingEssays++;
        if (has2 && !(it.s2Proposed || it.s3Proposed)) pendingProposals++;
        if (has2 && !(it.s2Essay || it.s3Essay)) missingEssays++;
      } else if (bm === '1_2_3') {
        if (has1 && !(it.s1Proposed || it.s2Proposed || it.s3Proposed)) pendingProposals++;
        if (has1 && !(it.s1Essay || it.s2Essay || it.s3Essay)) missingEssays++;
      } else {
        if (has1 && !it.s1Proposed) pendingProposals++;
        if (has1 && !it.s1Essay) missingEssays++;
        if (has2 && !it.s2Proposed) pendingProposals++;
        if (has2 && !it.s2Essay) missingEssays++;
        if (has3 && !it.s3Proposed) pendingProposals++;
        if (has3 && !it.s3Essay) missingEssays++;
      }

      return {
        ...it,
        matchedMember: matched || null,
        isChurchAttending: isChurchMemberAttending,
        eff: {
          has1, has2, has3,
          s1Period: it.s1Period, s1Proposed: it.s1Proposed, s1Essay: it.s1Essay,
          s2Period: eff2Period, s2Proposed: eff2Proposed, s2Essay: eff2Essay,
          s3Period: eff3Period, s3Proposed: eff3Proposed, s3Essay: eff3Essay,
        },
        pendingProposals,
        missingEssays,
      };
    }).sort((a, b) =>
      b.pendingProposals - a.pendingProposals ||
      String(a.unit).localeCompare(String(b.unit), 'ko') ||
      String(a.company).localeCompare(String(b.company), 'ko') ||
      String(a.name).localeCompare(String(b.name), 'ko')
    );
  },

  async saveSonagiList(list, syncServer = true) {
    const clean = (list || []).map(x => {
      const { matchedMember, isChurchAttending, eff, pendingProposals, missingEssays, ...raw } = x;
      return this.normalizeSonagiItem(raw);
    });
    const sonagiJson = JSON.stringify(clean);
    const s = Object.assign(await this.settings(), { sonagiJson });
    await DB.put('settings', s, 'main');
    if (syncServer && typeof Backend !== 'undefined') {
      await Backend.enqueue('saveSettings', { sonagiJson });
    }
    return clean;
  },

  async upsertSonagi(item) {
    const s = (await DB.get('settings', 'main')) || {};
    let arr = [];
    try { arr = s.sonagiJson ? JSON.parse(s.sonagiJson) : []; } catch (e) { arr = []; }
    if (!Array.isArray(arr)) arr = [];
    const norm = this.normalizeSonagiItem({ ...item, updatedAt: Date.now() });
    const idx = arr.findIndex(x => String(x.id) === String(norm.id));
    if (idx >= 0) arr[idx] = norm;
    else arr.push(norm);
    await this.saveSonagiList(arr);
    return norm;
  },

  async deleteSonagi(id) {
    const s = (await DB.get('settings', 'main')) || {};
    let arr = [];
    try { arr = s.sonagiJson ? JSON.parse(s.sonagiJson) : []; } catch (e) { arr = []; }
    if (!Array.isArray(arr)) arr = [];
    await this.saveSonagiList(arr.filter(x => String(x.id) !== String(id)));
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
