/* =========================================================
 * 키오스크(용사용) 화면
 * ========================================================= */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

/* ---------- 모달 ---------- */
const Modal = {
  root: () => document.getElementById('modal-root'),
  open(html, cls = '') {
    const w = document.createElement('div');
    w.className = 'modal-back';
    w.innerHTML = `<div class="modal ${cls}">${html}</div>`;
    this.root().appendChild(w);
    return w;
  },
  close(w) { if (w) w.remove(); },
  closeAll() { this.root().innerHTML = ''; },
  alert(msg, title = '') {
    return new Promise(res => {
      const w = this.open(`${title ? `<h3>${title}</h3>` : ''}<p class="modal-msg">${msg}</p>
        <div class="modal-actions"><button class="btn primary" data-ok>확인</button></div>`);
      w.querySelector('[data-ok]').onclick = () => { this.close(w); res(); };
    });
  },
  confirm(msg, ok = '확인', cancel = '취소') {
    return new Promise(res => {
      const w = this.open(`<p class="modal-msg">${msg}</p>
        <div class="modal-actions"><button class="btn ghost" data-no>${cancel}</button><button class="btn primary" data-ok>${ok}</button></div>`);
      w.querySelector('[data-ok]').onclick = () => { this.close(w); res(true); };
      w.querySelector('[data-no]').onclick = () => { this.close(w); res(false); };
    });
  },
};

/* ---------- 앱 ---------- */
const App = {
  el: null,
  state: { screen: null },
  idleTimer: null, clockTimer: null, doneTimer: null,
  lastDischargeCheck: null,

  async init() {
    this.el = document.getElementById('app');
    // 예기치 못한 오류(비밀번호 취소, 네트워크 오류 등)를 화면에 알려 줌
    window.addEventListener('unhandledrejection', ev => {
      const msg = (ev.reason && ev.reason.message) || String(ev.reason || '알 수 없는 오류');
      console.error(ev.reason);
      Modal.alert(esc(msg));
    });
    ['pointerdown', 'keydown'].forEach(ev => document.addEventListener(ev, () => this.resetIdle(), true));
    try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch (e) { }
    this.keepAwake();
    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
      navigator.serviceWorker.register('sw.js').catch(() => { });
    }
    this.home();
    if (typeof Backend !== 'undefined') Backend.init().catch(() => { });
  },

  async keepAwake() {
    if (!('wakeLock' in navigator)) return;
    const req = async () => { try { await navigator.wakeLock.request('screen'); } catch (e) { } };
    await req();
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') req(); });
  },

  resetIdle() {
    clearTimeout(this.idleTimer);
    const s = this.state.screen;
    if (!s || s === 'home') return;
    const sec = s === 'admin' ? CONFIG.adminIdleSeconds : CONFIG.idleSeconds;
    this.idleTimer = setTimeout(() => { Modal.closeAll(); this.home(); }, sec * 1000);
  },

  set(screen, html) {
    Camera.stop();
    clearInterval(this.clockTimer); clearTimeout(this.doneTimer);
    this.state.screen = screen;
    this.el.innerHTML = html;
    this.resetIdle();
    window.scrollTo(0, 0);
  },

  topbar(title) {
    return `<header class="topbar">
      <button class="btn-nav" data-back>← 뒤로</button>
      <h2>${title}</h2>
      <button class="btn-nav" data-home>처음으로</button></header>`;
  },
  bindNav(back) {
    const b = $('[data-back]'); if (b) b.onclick = back;
    const h = $('[data-home]'); if (h) h.onclick = () => this.home();
  },

  /* ---------- 1. 첫 화면 ---------- */
  async home() {
    // 하루 한 번 전역자 자동 이동
    if (this.lastDischargeCheck !== todayStr()) {
      this.lastDischargeCheck = todayStr();
      try { await Store.processDischarges(); } catch (e) { console.error(e); }
    }
    this.set('home', `
      <div class="screen home" id="home">
        <div class="home-inner">
          <div class="cross">✝</div>
          <h1>어서오세요!</h1>
          <h2>${CONFIG.churchName} 오신 것을 환영합니다!</h2>
          <p class="touch-hint">화면을 터치해서 출석해 주세요</p>
          <div class="clock" id="clock"></div>
        </div>
        <button class="pastor-btn" id="pastor-btn">목사님 전용</button>
      </div>`);
    const tick = () => {
      const d = new Date(), c = $('#clock');
      if (c) c.textContent = `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEK[d.getDay()]}) ${fmtTime(d)}`;
    };
    tick(); this.clockTimer = setInterval(tick, 10000);
    $('#home').onclick = () => { Sound.unlock(); this.units(); };
    $('#pastor-btn').onclick = e => { e.stopPropagation(); this.adminLogin(); };
  },

  /* ---------- 2. 부대 선택 ---------- */
  units() {
    this.set('units', `${this.topbar('소속 부대를 선택해 주세요')}
      <div class="grid tiles">${CONFIG.units.map((u, i) =>
        `<button class="tile" data-i="${i}">${esc(u.name)}</button>`).join('')}</div>`);
    this.bindNav(() => this.home());
    $$('.tile').forEach(b => b.onclick = () => {
      const u = CONFIG.units[b.dataset.i];
      this.names(u.name, null, 'normal');
    });
  },

  /* ---------- 3. 이름 선택 ---------- */
  async names(unit, company, mode = 'normal') {
    const { list, dup } = await Store.listForUnit(unit, company, mode);
    const label = company ? `${unit} · ${company}` : unit;
    const isLong = mode === 'long';
    const title = isLong ? `${esc(label)} · 오랜만에 온 형제들` : `${esc(label)} · 이름을 선택해 주세요`;
    const top = isLong ? '' : `
      <div class="special-row">
        <button class="special new" id="btn-new">🙋 오늘 처음 왔어요</button>
        <button class="special long" id="btn-long">👋 오랜만에 왔어요</button>
      </div>`;
    const items = list.map(m => `
      <button class="name-tile" data-id="${m.id}">
        <span class="nm">${esc(m.name)}</span>
        ${dup.has(m.name) ? `<span class="sub">전역 ${dotDate(m.dischargeDate)}</span>` : ''}
      </button>`).join('');
    const empty = `<p class="empty">${isLong ? '3개월 이상 오지 않은 형제가 없어요.' : '아직 등록된 형제가 없어요.<br>‘오늘 처음 왔어요’를 눌러 주세요.'}</p>`;

    this.set('names', `${this.topbar(title)}${top}
      <div class="grid names">${items || empty}</div>`);

    this.bindNav(() => {
      if (isLong) return this.names(unit, company, 'normal');
      this.units();
    });
    const nb = $('#btn-new'); if (nb) nb.onclick = () => this.newMember(unit, company);
    const lb = $('#btn-long'); if (lb) lb.onclick = () => this.names(unit, company, 'long');
    $$('.name-tile').forEach(b => b.onclick = async () => {
      const m = list.find(x => x.id === b.dataset.id);
      if (await Store.attendedOn(m.id, todayStr())) {
        await Store.addWarning({
          type: 'REPEAT_ATTEMPT', date: todayStr(), unitLabel: unitLabel(m), name: m.name,
          detail: `오늘 이미 출석한 형제 이름으로 ${fmtTime(new Date())}에 다시 출석을 시도했습니다.`,
          attendanceIds: (m.atts || []).filter(a => a.date === todayStr()).map(a => a.id),
        });
        await Modal.alert(`<b>${esc(m.name)}</b> 형제님은 오늘 이미 출석하셨어요 😊<br>하루에 한 번만 출석할 수 있어요.`);
        return this.home();
      }
      this.camera({ member: m, back: () => this.names(unit, company, mode) });
    });
  },

  /* ---------- 5. 오늘 처음 왔어요 ---------- */
  newMember(unit, company) {
    const label = company ? `${unit} · ${company}` : unit;
    const nowY = new Date().getFullYear();
    const years = [nowY, nowY + 1, nowY + 2, nowY + 3, nowY + 4];
    this.set('new', `${this.topbar(`${esc(label)} · 처음 오셨군요! 환영합니다`)}
      <form class="form-card" id="new-form" autocomplete="off">
        <label>이름<input id="nm" type="text" maxlength="10" placeholder="예) 홍길동" required></label>
        <label>전역일
          <div class="date-combo">
            <div class="date-selects">
              <select id="dc-y" title="전역 연도">
                <option value="">연도</option>
                ${years.map(y => `<option value="${y}">${y}년</option>`).join('')}
              </select>
              <select id="dc-m" title="전역 월">
                <option value="">월</option>
                ${Array.from({ length: 12 }, (_, i) => i + 1).map(m => `<option value="${pad(m)}">${m}월</option>`).join('')}
              </select>
              <select id="dc-d" title="전역 일">
                <option value="">일</option>
                ${Array.from({ length: 31 }, (_, i) => i + 1).map(d => `<option value="${pad(d)}">${d}일</option>`).join('')}
              </select>
            </div>
            <div class="date-cal-wrap">
              <span>📅 달력으로 선택:</span>
              <input id="dc" type="date" required>
            </div>
          </div>
        </label>
        <p class="hint">위의 연/월/일 스크롤 선택 또는 달력에서 전역일을 편하게 고를 수 있어요.</p>
        <button class="btn primary xl" type="submit">다음 (사진 촬영) →</button>
      </form>`);
    this.bindNav(() => this.names(unit, company, 'normal'));

    const dc = $('#dc'), dcy = $('#dc-y'), dcm = $('#dc-m'), dcd = $('#dc-d');
    dc.min = todayStr();

    const syncFromSelects = () => {
      const y = dcy.value, m = dcm.value, d = dcd.value;
      if (y && m && d) {
        const maxD = new Date(Number(y), Number(m), 0).getDate();
        const adjD = Math.min(Number(d), maxD);
        if (Number(d) !== adjD) dcd.value = pad(adjD);
        dc.value = `${y}-${m}-${pad(adjD)}`;
      }
    };

    const syncFromCal = () => {
      if (!dc.value) return;
      const [y, m, d] = dc.value.split('-');
      dcy.value = y;
      dcm.value = m;
      dcd.value = d;
    };

    dcy.onchange = syncFromSelects;
    dcm.onchange = syncFromSelects;
    dcd.onchange = syncFromSelects;
    dc.onchange = syncFromCal;

    setTimeout(() => $('#nm') && $('#nm').focus(), 200);

    $('#new-form').onsubmit = async e => {
      e.preventDefault();
      const name = $('#nm').value.replace(/\s/g, '');
      const dischargeDate = $('#dc').value;
      if (name.length < 2) return Modal.alert('이름을 정확히 입력해 주세요.');
      if (!dischargeDate) return Modal.alert('전역일을 선택해 주세요.');
      if (dischargeDate < todayStr()) return Modal.alert('전역일이 오늘보다 이전이에요. 다시 확인해 주세요.');

      const same = await Store.findSameName(unit, company, name);
      const exact = same.find(m => m.dischargeDate === dischargeDate);
      if (exact) {
        if (await Store.attendedOn(exact.id, todayStr())) {
          await Store.addWarning({
            type: 'REPEAT_REGISTER', date: todayStr(), unitLabel: unitLabel(exact), name,
            detail: `오늘 이미 출석한 형제가 ${fmtTime(new Date())}에 ‘오늘 처음 왔어요’로 다시 등록을 시도했습니다.`,
            attendanceIds: exact.atts.filter(a => a.date === todayStr()).map(a => a.id),
          });
        }
        const where = Store.isLongAbsent(exact) ? '‘오랜만에 왔어요’' : '이름 목록';
        await Modal.alert(`<b>${esc(name)}</b> 형제님은 이미 등록되어 있어요!<br>${where}에서 이름을 찾아 눌러 주세요.`);
        return this.names(unit, company, 'normal');
      }
      if (same.length) {
        const ok = await Modal.confirm(`같은 이름의 형제가 이미 있어요.<br>(${same.map(m => `전역 ${dotDate(m.dischargeDate)}`).join(', ')})<br><br>본인이 아니라면 ‘새로 등록’을 눌러 주세요.`, '새로 등록', '목록으로');
        if (!ok) return this.names(unit, company, 'normal');
      }
      this.camera({ pending: { name, unit, company, dischargeDate }, sameName: same, back: () => this.newMember(unit, company) });
    };
  },

  /* ---------- 6. 사진 촬영 ----------
   * ctx.member  : 기존 형제 / ctx.pending : 오늘 처음 온 형제(촬영 후 등록)
   * ctx.retake  : { att, member, isNew } 다시 찍기(같은 출석 기록의 사진 교체)
   */
  async camera(ctx) {
    const who = ctx.retake ? ctx.retake.member : (ctx.member || ctx.pending);
    this.set('camera', `${this.topbar(`${esc(who.name)} 형제님, 얼굴과 이름표를 함께 찍어 주세요`)}
      <div class="cam-wrap">
        <video id="video" playsinline muted autoplay></video>
        <div class="face-guide" id="guide"></div>
        <div class="nametag-guide">🏷️ 이름표 위치<br>(오른쪽 가슴)</div>
        <div class="countdown" id="cd"></div>
        <div class="flash" id="flash"></div>
      </div>
      <div class="cam-actions" id="actions"></div>
      <p class="hint center" id="cam-hint">얼굴과 오른쪽 가슴의 이름표가 모두 보이도록 서서 ‘촬영하기’를 눌러 주세요</p>`);
    // 다시 찍기 중 '뒤로'를 누르면 기존 사진을 유지한 채 첫 화면으로
    this.bindNav(ctx.retake ? () => this.home() : ctx.back);

    const video = $('#video'), actions = $('#actions');

    const shoot = async () => {
      $('#shoot').disabled = true;
      Sound.unlock();
      const cd = $('#cd');
      for (let n = CONFIG.countdownSeconds; n > 0; n--) {
        if (this.state.screen !== 'camera') return;
        cd.textContent = n; cd.classList.remove('pop'); void cd.offsetWidth; cd.classList.add('pop');
        Sound.beep(n === 1 ? 1100 : 880);
        await sleep(1000);
      }
      if (this.state.screen !== 'camera') return;
      cd.textContent = '';
      Sound.shutter();
      const fl = $('#flash'); fl.classList.remove('go'); void fl.offsetWidth; fl.classList.add('go');

      const shotAt = new Date();
      // 워터마크: 이름표를 가리지 않도록 전역일은 빼고 우측에 배치
      const lines = [
        `${CONFIG.churchName} 예배 출석`,
        `${fmtDate(shotAt)} ${fmtTime(shotAt)} ${who.name}`,
        unitLabel(who),
      ];
      const blob = await Camera.toBlob(Camera.capture(video, lines));
      Camera.stop();
      actions.innerHTML = '<p class="hint">저장 중…</p>';

      try {
        if (ctx.retake) {
          const att = await Store.replacePhoto(ctx.retake.att.id, blob, shotAt);
          const s = await Store.memberWithStats(ctx.retake.member.id);
          return this.done({ member: ctx.retake.member, total: s.total, att, blob, isNew: ctx.retake.isNew, back: ctx.retake.back });
        }
        let member = ctx.member, isNew = false;
        if (!member) { member = await Store.addMember(ctx.pending); isNew = true; }
        const res = await Store.recordAttendance({ memberId: member.id, blob, when: shotAt });
        this.done({ member, total: res.total, att: res.attendance, blob, isNew, back: ctx.back });
      } catch (e) {
        await Modal.alert(esc(e.message));
        this.home();
      }
    };

    try {
      await Camera.start(video);
      actions.innerHTML = `<button class="btn primary xl" id="shoot">📸 촬영하기</button>`;
      $('#shoot').onclick = shoot;
    } catch (e) {
      actions.innerHTML = '';
      $('#cam-hint').innerHTML = '⚠️ 카메라를 켤 수 없어요.<br>카메라 권한을 허용했는지, https 주소로 접속했는지 확인해 주세요.';
    }
  },

  /* ---------- 7. 저장 완료 (사진 확인 + 다시 찍기 / 기록 취소) ---------- */
  done({ member, total, att, blob, isNew, back }) {
    const U = CONFIG.mileageUnit;
    const url = URL.createObjectURL(blob);
    const extra = total % U === 0 ? `<p class="done-extra">🎉 ${total}회 달성을 축하해요!</p>` : '';
    this.set('done', `
      <div class="screen done">
        <div class="done-card">
          <img class="done-photo" src="${url}" alt="저장된 사진">
          <p class="done-title">✅ 저장되었습니다!</p>
          <p class="done-msg">예배 오신 것을 환영합니다!<br>오늘도 주님이 만나주실 거예요!</p>
          <p class="done-count"><b>${esc(member.name)}</b> 형제님, 오늘로 <b class="num">${total}</b>번째 예배에 오셨군요!</p>
          ${extra}
          <div class="done-actions">
            <button class="btn ghost" id="done-retake">↺ 다시 찍기</button>
            <button class="btn ghost danger-text" id="done-cancel">✕ 기록 취소</button>
            <button class="btn primary xl" id="done-ok">확인</button>
          </div>
          <p class="hint">사진이 잘못 나왔다면 ‘다시 찍기’를, 이름을 잘못 골랐다면 ‘기록 취소’를 눌러 주세요.</p>
        </div>
      </div>`);
    Sound.chime();
    const cleanup = () => URL.revokeObjectURL(url);
    $('#done-ok').onclick = () => { cleanup(); this.home(); };
    $('#done-retake').onclick = () => { cleanup(); this.camera({ retake: { att, member, isNew, back } }); };
    $('#done-cancel').onclick = async () => {
      clearTimeout(this.doneTimer);
      if (!await Modal.confirm('방금 저장한 출석 기록을 취소할까요?<br>취소 후 처음부터 다시 출석할 수 있어요.', '기록 취소', '돌아가기')) {
        this.doneTimer = setTimeout(() => this.home(), 30000);
        return;
      }
      await Store.cancelAttendance(att.id, isNew);
      cleanup();
      this.units();
    };
    // 아무것도 누르지 않으면 30초 뒤 첫 화면으로 (기록은 저장된 상태)
    this.doneTimer = setTimeout(() => { cleanup(); this.home(); }, 30000);
  },

  /* ---------- 목사님 전용 로그인 ---------- */
  adminLogin() {
    let code = '';
    const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '취소', '0', '⌫'];
    const w = Modal.open(`<h3>목사님 전용</h3><p class="modal-msg">비밀번호 4자리를 입력해 주세요</p>
      <div class="pin-dots">${'<span></span>'.repeat(4)}</div>
      <div class="keypad">${keys.map(k => `<button data-k="${k}">${k}</button>`).join('')}</div>`, 'pin');
    const dots = $$('.pin-dots span', w);
    const paint = () => dots.forEach((d, i) => d.classList.toggle('on', i < code.length));
    $$('.keypad button', w).forEach(b => b.onclick = async () => {
      const k = b.dataset.k;
      if (k === '취소') return Modal.close(w);
      if (k === '⌫') code = code.slice(0, -1);
      else if (code.length < 4) code += k;
      paint();
      if (code.length === 4) {
        const s = await Store.settings();
        if (code === s.password) { Modal.close(w); Admin.open(); }
        else { $('.pin-dots', w).classList.add('shake'); setTimeout(() => { code = ''; paint(); $('.pin-dots', w).classList.remove('shake'); }, 450); }
      }
    });
  },
};

window.addEventListener('DOMContentLoaded', () => App.init());
