/* =========================================================
 * 목사님 전용 관리 화면
 * ========================================================= */
const Admin = {
  tab: 'report',
  urls: [],
  reportCut: null,
  TABS: [
    ['report', '📊 주간 리포트'],
    ['today', '📸 오늘의 출석자'],
    ['warnings', '⚠️ 경고'],
    ['members', '👥 형제 관리'],
    ['manual', '✍️ 수동 출석'],
    ['mileage', '🎖 마일리지'],
    ['import', '📥 엑셀 등록'],
    ['discharged', '🗂 전역자'],
    ['settings', '⚙️ 설정'],
  ],

  async open(tab) {
    if (typeof Backend !== 'undefined' && !tab) {
      try { await Backend.syncFromServerIfChanged(); } catch (e) { }
    }
    if (!tab) tab = (await Store.warnings()).some(w => !w.resolved) ? 'warnings' : 'report';
    this.tab = tab; this.render();
  },

  async render() {
    this.urls.forEach(u => URL.revokeObjectURL(u)); this.urls = [];
    const open = (await Store.warnings()).filter(w => !w.resolved).length;
    // 미건의 마일리지 대상자 수 계산하여 [🎖 마일리지] 탭에 배지로 표시
    let pendingMilCount = 0;
    try {
      const [msAll, grAll] = await Promise.all([Store.membersWithStats(), Store.allGrants()]);
      const gMap = {};
      grAll.forEach(g => (gMap[g.memberId] = gMap[g.memberId] || []).push(g));
      msAll.forEach(m => {
        const slots = Store.getMemberSlots(m, gMap[m.id]);
        const earned = Math.min(5, Math.floor(m.total / CONFIG.mileageUnit));
        const granted = slots.filter(sl => sl.proposedDate).length;
        if (earned > granted) pendingMilCount += (earned - granted);
      });
    } catch (e) {}

    const isConn = typeof Backend !== 'undefined' && await Backend.isConfigured();
    const pending = isConn ? await Backend.pendingCount() : 0;
    const syncBadge = isConn
      ? `<span class="badge" style="background:${pending ? 'var(--gold);color:#3b2a07' : 'var(--green)'};font-size:.75rem;cursor:pointer" id="adm-sync-badge">${pending ? `☁️ 동기화 대기 ${pending}건` : '☁️ 서버 연결됨'}</span>`
      : `<span class="badge gray" style="font-size:.75rem;cursor:pointer" id="adm-sync-badge">☁️ 서버 미연결</span>`;
    App.set('admin', `<div class="admin">
      <header class="admin-head"><h2>목사님 전용 ${syncBadge}</h2>
        <div class="row" style="margin:0">
          ${isConn ? '<button class="btn ghost small" id="adm-sync-now">🔄 서버 동기화</button>' : ''}
          <button class="btn ghost" id="adm-exit">🔒 잠그고 나가기</button>
        </div>
      </header>
      <nav class="tabs">${this.TABS.map(([k, l]) => `<button data-tab="${k}" class="${k === this.tab ? 'on' : ''}">${l}${k === 'warnings' && open ? ` <span class="badge" style="background:var(--red)">${open}</span>` : ''}${k === 'mileage' && pendingMilCount ? ` <span class="badge" style="background:#dc2626;color:#fff">미건의 ${pendingMilCount}</span>` : ''}</button>`).join('')}</nav>
      <section class="adm-body" id="body"><p class="muted">불러오는 중…</p></section></div>`);
    $('#adm-exit').onclick = () => { if (typeof Backend !== 'undefined') Backend.lockSession(); App.home(); };
    $('#adm-sync-badge').onclick = () => this.open('settings');
    const syncBtn = $('#adm-sync-now');
    if (syncBtn) syncBtn.onclick = async () => {
      syncBtn.disabled = true; syncBtn.textContent = '동기화 중…';
      await Backend.syncFromServerIfChanged(true);
      this.render();
    };
    $$('.tabs button').forEach(b => b.onclick = () => this.open(b.dataset.tab));
    try { await this['tab_' + this.tab]($('#body')); }
    catch (e) { console.error(e); $('#body').innerHTML = `<p class="err">오류: ${esc(e.message)}</p>`; }
  },

  thumbURL(blob) { const u = URL.createObjectURL(blob); this.urls.push(u); return u; },

  unitSelect(id, withAll = false, value = '') {
    const opts = allUnitLabels().map(u => {
      const v = `${u.unit}|${u.company || ''}`;
      return `<option value="${esc(v)}" ${v === value ? 'selected' : ''}>${esc(u.label)}</option>`;
    }).join('');
    return `<select id="${id}">${withAll ? '<option value="">전체 부대</option>' : '<option value="">부대 선택</option>'}${opts}</select>`;
  },
  parseUnit(v) { const [unit, company] = v.split('|'); return { unit, company: company || null }; },

  showPhoto(url, caption) {
    const w = Modal.open(`<img class="big-photo" src="${url}"><p class="modal-msg small">${esc(caption)}</p>
      <div class="modal-actions"><button class="btn primary" data-ok>닫기</button></div>`, 'wide');
    w.querySelector('[data-ok]').onclick = () => Modal.close(w);
  },

  /** 출석 기록 썸네일 HTML 채우기 */
  async fillThumbs(container, atts) {
    const parts = [];
    for (const a of atts) {
      if (a.hasPhoto) {
        const b = await Store.getPhoto(a.id);
        if (b) { parts.push(`<figure data-url="${this.thumbURL(b)}" data-cap="${esc(a.fileName)}"><img src="${this.urls[this.urls.length - 1]}"><figcaption>${esc(a.fileName)}</figcaption></figure>`); continue; }
      }
      parts.push(`<figure class="nophoto"><div>${a.manual ? '수동 보정<br>' + esc(a.reason || '') : '사진 없음'}</div><figcaption>${esc(a.fileName)}</figcaption></figure>`);
    }
    container.innerHTML = parts.join('');
    $$('figure[data-url]', container).forEach(f => f.onclick = () => this.showPhoto(f.dataset.url, f.dataset.cap));
  },

  /* ===================== 주간 리포트 (기본값: 지금 시점 + 최근 주일 순서 선택 + 날짜 직접 지정) ===================== */
  async tab_report(body) {
    const today = todayStr();
    const cuts = Report.recentCutoffs(12);
    // 기본값을 '지금 시점(now)'으로 설정
    const sel = this.reportCut || 'now';
    if (!this.reportEnd || !this.reportStart) {
      const refCut = sel === 'now' ? new Date() : (sel === 'custom' ? new Date() : new Date(+sel));
      this.reportEnd = fmtDate(refCut);
      this.reportStart = fmtDate(new Date(refCut.getTime() - 6 * 864e5));
    }

    body.innerHTML = `
      <div class="card" style="margin-bottom:.8rem;padding:.9rem 1.1rem;background:#f8fafc;border:1.5px solid #cbd5e1">
        <div class="toolbar" style="margin-bottom:.5rem;gap:.6rem;align-items:center">
          <label style="font-weight:700;color:var(--navy)">기준:
            <select id="cut" style="margin-left:.3rem">
              <option value="now" ${sel === 'now' ? 'selected' : ''}>지금 시점 (기본 · 최근 1주일)</option>
              ${cuts.map(c => `<option value="${c.getTime()}" ${String(c.getTime()) === sel ? 'selected' : ''}>${fmtDate(c)} (일) 13:00</option>`).join('')}
              <option value="custom" ${sel === 'custom' ? 'selected' : ''}>직접 날짜 지정 (${esc(this.reportStart)} ~ ${esc(this.reportEnd)})</option>
            </select>
          </label>
          <span style="color:#94a3b8">|</span>
          <label style="display:inline-flex;align-items:center;gap:.35rem;font-weight:700">
            시작일 <input type="date" id="rep-start" value="${esc(this.reportStart)}" max="${esc(today)}">
          </label>
          <span>~</span>
          <label style="display:inline-flex;align-items:center;gap:.35rem;font-weight:700">
            종료일 <input type="date" id="rep-end" value="${esc(this.reportEnd)}" max="${esc(today)}">
          </label>
        </div>
        <p class="muted" style="margin:0;font-size:.82rem">
          ※ ‘기준’에서 <b>지금 시점</b>이나 <b>최근 주일</b>을 순서대로 고르시거나, 우측 달력에서 <b>몇 월 며칠부터 몇 월 며칠까지</b>를 직접 선택하실 수 있습니다. (종료일 선택 시 기본 1주일로 자동 세팅)
        </p>
      </div>
      <div class="toolbar" style="gap:.5rem">
        <button class="btn primary" id="share-excel" style="font-weight:700">📧 1) 출석·통계 엑셀 메일 보내기</button>
        <button class="btn primary" id="share-ach-photos" style="font-weight:700;background:#1e3a8a">📸 2) 24회 달성자 사진 메일 보내기</button>
        <button class="btn ghost small" id="dl-week-xl">📊 엑셀(.xlsx) 다운로드</button>
        <button class="btn ghost small" id="copy">📋 본문 복사</button>
      </div>
      <div class="note" style="line-height:1.6">
        💡 <b>리포트 메일 발송 안내 (안드로이드 Gmail 첨부 호환)</b>:<br>
        스마트폰(안드로이드)에서 엑셀 파일과 사진(JPG)을 한 번에 섞어 보내면 Gmail 앱이 제목·본문·첨부를 빈칸으로 비워버리는 현상이 있어, <b>100% 누락 없이 첨부되도록 버튼 2개로 분리</b>했습니다.<br>
        ① <b>‘📧 1) 출석·통계 엑셀 메일 보내기’</b>: 메일 제목·본문 + <b>주간 출석명단·부대통계·마일리지 엑셀 파일</b>이 Gmail에 즉시 세팅됩니다.<br>
        ② <b>‘📸 2) 24회 달성자 사진 메일 보내기’</b>: 24회 달성자가 있는 주간에 누르시면 <b>달성자의 최근 24회 인증 사진들</b>이 Gmail에 즉시 첨부됩니다. (각 달성자 카드 안의 개별 발송 버튼을 쓰셔도 됩니다)
      </div>
      <div id="rep"><p class="muted">계산 중…</p></div>`;

    const cutSelect = $('#cut');
    const startInput = $('#rep-start');
    const endInput = $('#rep-end');

    cutSelect.onchange = e => {
      const v = e.target.value;
      this.reportCut = v;
      if (v === 'now') {
        const now = new Date();
        this.reportEnd = fmtDate(now);
        this.reportStart = fmtDate(new Date(now.getTime() - 6 * 864e5));
      } else if (v !== 'custom') {
        const dt = new Date(+v);
        this.reportEnd = fmtDate(dt);
        this.reportStart = fmtDate(new Date(dt.getTime() - 7 * 864e5));
      }
      this.render();
    };

    // 종료일을 바꾸면 종료일로부터 1주일(7일간)로 시작일 자동 세팅
    endInput.onchange = () => {
      const endVal = endInput.value || today;
      const [ey, em, ed] = endVal.split('-').map(Number);
      const endDt = new Date(ey, em - 1, ed);
      this.reportCut = 'custom';
      this.reportEnd = endVal;
      this.reportStart = fmtDate(new Date(endDt.getTime() - 6 * 864e5));
      this.render();
    };

    // 시작일을 직접 바꾸면 사용자가 선택한 시작일~종료일 그대로 적용
    startInput.onchange = () => {
      const sVal = startInput.value || today;
      this.reportCut = 'custom';
      this.reportStart = sVal;
      if (this.reportEnd && sVal > this.reportEnd) {
        this.reportEnd = sVal;
      }
      this.render();
    };

    let r;
    if (sel === 'custom') {
      r = await Report.build(null, this.reportStart, this.reportEnd);
    } else {
      const cutDate = sel === 'now' ? new Date() : new Date(+sel);
      r = await Report.build(cutDate);
    }

    const text = Report.text(r);
    const title = `[${CONFIG.churchName}] 주간 예배 출석 리포트 (${fmtDate(r.cutoff)})`;

    $('#rep').innerHTML = `
      <h3>기간: ${Report.periodText(r)}</h3>
      <h3>📋 날짜별 · 부대별 출석 현황</h3>
      ${this.statsTable(r.stats)}

      <h3>📋 기간 내 예배 출석자 명단 (총 ${(r.periodAtts || []).length}명)</h3>
      ${(r.periodAtts || []).length ? `
        <div class="card">
          <div class="tbl-wrap" style="max-height:280px;overflow-y:auto">
            <table class="tbl">
              <thead><tr><th>연번</th><th>날짜 · 시간</th><th>소속부대</th><th>이름</th><th>전역일</th><th>누적출석</th><th>구분</th></tr></thead>
              <tbody>
                ${r.periodAtts.map((a, idx) => `
                  <tr>
                    <td>${idx + 1}</td>
                    <td>${a.date}(${weekdayOf(a.date)}) ${a.time}</td>
                    <td>${esc(a.label)}</td>
                    <td><b>${esc(a.memberName)}</b></td>
                    <td>${fmtYYMMDD(a.dischargeDate)}</td>
                    <td><b>${a.cumCount}회</b></td>
                    <td>${a.manual ? `<span class="badge">수동</span> ${esc(a.reason || '')}` : '📸 사진인증'}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      ` : '<p class="muted">이 기간에 출석한 인원이 없습니다.</p>'}

      <h3>🎖 ${CONFIG.mileageUnit}회 단위 마일리지 달성자 (${r.achievers.length}건)</h3>
      ${r.achievers.length ? r.achievers.map((a, i) => `
        <div class="card ach">
          <div class="ach-head"><b>${esc(unitLabel(a.person))} ${esc(a.person.name)}</b>
            <span class="badge">${a.milestone}회째 달성</span>${a.person.discharged ? '<span class="badge gray">전역</span>' : ''}</div>
          <div class="ach-meta">현재 누적 ${a.total}회 · 지급 완료 ${a.grantedBlocks}회 · 지급 대상 ${a.earnedBlocks}회 ·
            <b class="${a.pendingBlocks ? 'red' : ''}">미지급 ${a.pendingBlocks}회</b> · 전역 ${a.person.dischargeDate}
            ${a.missing ? `<br>※ 사진촬영 전 수기 출석 ${a.missing}회 포함` : ''}</div>
          <details><summary>전체 예배 날짜 (${a.allDates.length}회)</summary>
            <div class="chips">${a.allDates.map(d => `<span>${d}(${weekdayOf(d)})</span>`).join('')}</div></details>
          <div class="thumbs ach-thumbs" data-i="${i}"><p class="muted">사진 불러오는 중…</p></div>
          <div class="row">
            <button class="btn small primary" data-share="${i}">📧 이 형제만 메일 앱 발송 (최근 24회 사진)</button>
            <button class="btn small primary" style="background:var(--green)" data-ach-grant="${a.person.id}">🎖 건의일 입력/조치 (언제부·언제 건의)</button>
            <button class="btn small ghost" data-dl="${i}">💾 이 형제 24회 사진(${a.block.filter(b => b.hasPhoto).length}장) 저장</button>
          </div>
        </div>`).join('') : '<p class="muted">이 기간에 24회 단위를 새로 달성한 형제가 없습니다.</p>'}

      <details><summary>메일 본문 미리보기</summary><pre class="pre">${esc(text)}</pre></details>`;

    for (const el of $$('.ach-thumbs', $('#rep'))) {
      await this.fillThumbs(el, r.achievers[+el.dataset.i].block);
    }

    // 마일리지 달성자별 사진 미리 로드 (클릭 즉시 공유창이 뜨도록 사용자 제스처 보존)
    const achieverPhotoListByIdx = await Promise.all(
      r.achievers.map(a => photoFiles(a.block || []))
    );
    const allAchieverPhotos = achieverPhotoListByIdx.flat();

    $$('[data-share]').forEach(b => b.onclick = () => {
      const idx = +b.dataset.share;
      const a = r.achievers[idx];
      const one = { ...r, achievers: [a] };
      const pFiles = achieverPhotoListByIdx[idx] || [];
      shareReport(`${title} - ${a.person.name}(${a.milestone}회 달성)`, Report.text(one), pFiles, pFiles);
    });
    $$('[data-dl]').forEach(b => b.onclick = () => downloadFiles(achieverPhotoListByIdx[+b.dataset.dl] || []));
    $$('[data-ach-grant]').forEach(b => b.onclick = async () => {
      const mId = b.dataset.achGrant;
      const m = await Store.memberWithStats(mId);
      if (!m) return Modal.alert('전역 처리되었거나 찾을 수 없는 형제입니다.');
      const grants = await Store.grantsOf(mId);
      const slots = Store.getMemberSlots(m, grants);
      this.openMileageModal({ m, slots });
    });

    const csvExcelFile = Report.buildWeeklyCsvFile(r);
    const xlFileReady = await Report.buildWeeklyExcelFile(r);

    $('#dl-week-xl').onclick = () => {
      if (!xlFileReady) return Modal.alert('엑셀 생성 도구를 불러오지 못했습니다.');
      downloadBlob(xlFileReady, xlFileReady.name);
    };

    // 1) 출석·통계 엑셀 파일 단독 공유 (동일 타입 단일 파일이므로 Gmail에서 제목·본문·첨부가 100% 정상 세팅됨)
    let excelShareTarget = [csvExcelFile].filter(Boolean);
    if (xlFileReady && typeof navigator.canShare === 'function') {
      try {
        if (navigator.canShare({ files: [xlFileReady] })) {
          excelShareTarget = [xlFileReady];
        }
      } catch (e) {}
    }

    const shareAchBtn = $('#share-ach-photos');
    if (shareAchBtn) {
      shareAchBtn.textContent = `📸 2) 24회 달성자 사진 메일 보내기 (${allAchieverPhotos.length}장)`;
    }

    $('#share-excel').onclick = () => {
      shareReport(title, text, excelShareTarget, xlFileReady ? [xlFileReady] : [csvExcelFile]);
    };

    $('#share-ach-photos').onclick = () => {
      if (!r.achievers.length) {
        return Modal.alert('선택한 기간에 24회 마일리지를 새로 달성한 형제가 없습니다.<br>(출석 명단과 통계는 <b>‘📧 1) 출석·통계 엑셀 메일 보내기’</b> 버튼을 눌러 보내실 수 있습니다.)');
      }
      if (!allAchieverPhotos.length) {
        return Modal.alert('달성자의 사진 인증 기록이 없습니다.');
      }
      shareReport(`${title} - 24회 달성자 인증사진(${allAchieverPhotos.length}장)`, text, allAchieverPhotos, allAchieverPhotos);
    };

    $('#copy').onclick = async () => { try { await navigator.clipboard.writeText(text); Modal.alert('본문을 복사했어요.'); } catch (e) { Modal.alert('복사에 실패했어요.'); } };
  },

  /* ===================== 📸 오늘의 출석자 (선택한 날짜의 예배 참석자 전체 사진을 한눈에 확인) ===================== */
  async tab_today(body) {
    const today = todayStr();
    const people = await Store.allPeopleFull();
    const allAtts = [];
    people.forEach(p => {
      const base = p.baseCount || 0;
      (p.atts || []).forEach((a, idx) => {
        allAtts.push({
          ...a,
          person: p,
          label: unitLabel(p),
          memberName: p.name,
          dischargeDate: p.dischargeDate,
          discharged: !!p.discharged,
          cumCount: base + idx + 1,
        });
      });
    });

    // 출석 기록이 있는 날짜 목록 (최신순)
    const worshipDates = [...new Set(allAtts.map(a => a.date))].sort((a, b) => b.localeCompare(a));
    if (!this.todayViewDate) {
      this.todayViewDate = worshipDates.includes(today) ? today : (worshipDates[0] || today);
    }

    body.innerHTML = `
      <div class="card" style="margin-bottom:.8rem;padding:.9rem 1.1rem;background:#f8fafc;border:1.5px solid #cbd5e1">
        <div class="toolbar" style="margin-bottom:0;gap:.6rem;align-items:center">
          <b style="color:var(--navy)">📅 예배 날짜 선택:</b>
          <input type="date" id="td-date" value="${esc(this.todayViewDate)}" max="${esc(today)}">
          <select id="td-recent" title="예배 기록이 있는 최근 날짜 바로 선택">
            <option value="">최근 예배일 바로가기 (${worshipDates.length}일)</option>
            ${worshipDates.slice(0, 30).map(d => {
              const cnt = allAtts.filter(x => x.date === d).length;
              return `<option value="${d}" ${d === this.todayViewDate ? 'selected' : ''}>${d} (${weekdayOf(d)}) · ${cnt}명 출석</option>`;
            }).join('')}
          </select>
          <button class="btn ghost small" id="td-go-today">오늘 (${today})</button>
          ${this.unitSelect('td-unit', true, this.tdUnit || '')}
          <input id="td-q" placeholder="이름 검색" value="${esc(this.tdQ || '')}" style="max-width:150px">
        </div>
      </div>
      <div id="td-summary"></div>
      <div id="td-gallery"></div>`;

    const drawToday = async () => {
      const selDate = $('#td-date').value || today;
      this.todayViewDate = selDate;
      this.tdUnit = $('#td-unit').value;
      this.tdQ = $('#td-q').value.trim();

      const dayAll = allAtts
        .filter(a => a.date === selDate)
        .sort((a, b) => unitOrder(a.label) - unitOrder(b.label) || a.time.localeCompare(b.time) || a.memberName.localeCompare(b.memberName, 'ko'));

      const filtered = dayAll.filter(a => {
        if (this.tdUnit) {
          const uStr = `${a.person.unit}|${a.person.company || ''}`;
          if (uStr !== this.tdUnit) return false;
        }
        if (this.tdQ && !a.memberName.includes(this.tdQ)) return false;
        return true;
      });

      // 부대별 요약 배지
      const unitCounts = allUnitLabels()
        .map(u => ({ label: u.label, count: dayAll.filter(a => a.label === u.label).length }))
        .filter(u => u.count > 0);

      $('#td-summary').innerHTML = `
        <div class="card" style="margin-bottom:.8rem">
          <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:.5rem">
            <h3 style="margin:0">📸 ${selDate} (${weekdayOf(selDate)}) 예배 출석자 — 총 <span style="color:var(--navy)">${dayAll.length}명</span> ${filtered.length !== dayAll.length ? `(검색 ${filtered.length}명)` : ''}</h3>
            ${dayAll.length ? `<button class="btn ghost small" id="td-dl-photos">💾 이 날 출석 사진 전체 저장 (${dayAll.filter(a => a.hasPhoto).length}장)</button>` : ''}
          </div>
          ${unitCounts.length ? `
            <div class="chips" style="margin-top:.6rem">
              ${unitCounts.map(u => `<span style="font-weight:700;background:#e2e8f0;color:#1e293b">${esc(u.label)}: <b>${u.count}명</b></span>`).join('')}
            </div>` : ''}
        </div>`;

      const dlBtn = $('#td-dl-photos');
      if (dlBtn) {
        dlBtn.onclick = async () => {
          const files = await photoFiles(dayAll);
          if (!files.length) return Modal.alert('이 날짜에 저장된 사진이 없습니다.');
          await downloadFiles(files);
        };
      }

      if (!filtered.length) {
        $('#td-gallery').innerHTML = `<div class="card"><p class="muted" style="text-align:center;padding:2rem 0">${selDate} (${weekdayOf(selDate)})에는 출석 기록이 없습니다.</p></div>`;
        return;
      }

      $('#td-gallery').innerHTML = `
        <div class="hist-grid">
          ${filtered.map((a, idx) => `
            <div class="hist-card td-att-card" data-id="${a.id}">
              <div class="hist-card-head">
                <div>
                  <span class="badge" style="background:var(--navy);color:#fff;margin-right:.3rem">${idx + 1}</span>
                  <b style="font-size:1.05rem">${esc(a.label)} ${esc(a.memberName)}</b>
                  <div class="muted" style="font-size:.82rem;margin-top:.2rem">
                    ⏰ ${a.time} 출석 · 누적 <b>${a.cumCount}회</b> · 전역 ${fmtYYMMDD(a.dischargeDate)}
                    ${a.retakes ? ` · <span style="color:#b45309;font-weight:700">재촬영 ${a.retakes}회</span>` : ''}
                  </div>
                </div>
                <button class="btn small danger" data-td-del="${a.id}">삭제</button>
              </div>
              <div class="hist-th"><p class="muted">사진 불러오는 중…</p></div>
            </div>
          `).join('')}
        </div>`;

      for (const card of $$('.td-att-card', $('#td-gallery'))) {
        const a = filtered.find(x => x.id === card.dataset.id);
        if (a) await this.fillThumbs($('.hist-th', card), [a]);
      }

      $$('[data-td-del]', $('#td-gallery')).forEach(b => b.onclick = async () => {
        const target = filtered.find(x => x.id === b.dataset.tdDel);
        if (!await Modal.confirm(`<b>${esc(target ? target.label + ' ' + target.memberName : '')}</b> 형제의 ${selDate} 출석 기록(사진 포함)을 삭제할까요?`, '출석 삭제')) return;
        await Store.deleteAttendance(b.dataset.tdDel);
        this.render();
      });
    };

    $('#td-date').onchange = () => {
      $('#td-recent').value = $('#td-date').value;
      drawToday();
    };
    $('#td-recent').onchange = e => {
      if (!e.target.value) return;
      $('#td-date').value = e.target.value;
      drawToday();
    };
    $('#td-go-today').onclick = () => {
      $('#td-date').value = today;
      $('#td-recent').value = worshipDates.includes(today) ? today : '';
      drawToday();
    };
    $('#td-unit').onchange = drawToday;
    $('#td-q').oninput = drawToday;

    await drawToday();
  },

  statsTable(st) {
    if (!st.dates.length) return '<p class="muted">이 기간 출석 기록이 없습니다.</p>';
    const rows = st.rows.filter(r => r.sum);
    return `<div class="tbl-wrap"><table class="tbl stats"><thead><tr><th>부대</th>${st.dates.map(d => `<th>${shortDate(d)}</th>`).join('')}<th>합계</th></tr></thead>
      <tbody>${rows.map(r => `<tr><td>${esc(r.label)}</td>${r.counts.map(c => `<td>${c || '-'}</td>`).join('')}<td><b>${r.sum}</b></td></tr>`).join('')}
      <tr class="total"><td>전체</td>${st.totals.map(t => `<td>${t}</td>`).join('')}<td>${st.totals.reduce((a, b) => a + b, 0)}</td></tr></tbody></table></div>`;
  },

  /* ===================== 경고 [경고-확인필요] ===================== */
  async tab_warnings(body) {
    const list = await Store.warnings();
    body.innerHTML = `<div class="note">같은 날 같은 부대·같은 이름으로 출석이 2건 이상 기록되거나, 이미 출석한 형제가 다시 출석/등록을 시도하면 여기에 남습니다.</div>
      ${list.length ? list.map((w, i) => `
        <div class="card warn-card ${w.resolved ? 'resolved' : ''}">
          <div class="ach-head"><b>[경고-확인필요] ${esc(w.unitLabel)} ${esc(w.name)}</b> <span class="badge">${w.date}</span>
            ${w.resolved ? '<span class="badge gray">확인 완료</span>' : '<span class="badge" style="background:var(--red)">미확인</span>'}</div>
          <div class="ach-meta">${esc(w.detail)}<br><span class="muted">발생: ${new Date(w.createdAt).toLocaleString('ko-KR')}</span>
            ${w.resolved ? `<br><b>특이사항 메모:</b> ${esc(w.memo || '이상없음')}` : ''}</div>
          <div class="thumbs" data-i="${i}"></div>
          <div class="row">
            <button class="btn small ghost" data-wshare="${i}">📧 기기 메일 앱 공유</button>
            ${w.resolved ? `<button class="btn small ghost" data-wok="${i}">✏️ 메모 수정</button>` : `<button class="btn small primary" data-wok="${i}">✔ 확인 완료 처리</button>`}
          </div>
        </div>`).join('') : '<p class="muted">경고가 없습니다. 👍</p>'}`;
    const attsOf = async w => (await Promise.all((w.attendanceIds || []).map(id => Store.attendanceById(id)))).filter(Boolean);
    for (const el of $$('.thumbs', body)) {
      const atts = await attsOf(list[+el.dataset.i]);
      if (atts.length) await this.fillThumbs(el, atts); else el.innerHTML = '<p class="muted">관련 사진 없음 (삭제/취소됨)</p>';
    }
    $$('[data-wshare]', body).forEach(b => b.onclick = async () => {
      const w = list[+b.dataset.wshare];
      const atts = await attsOf(w);
      await shareReport(`[경고-확인필요] ${w.date} ${w.unitLabel} ${w.name}`, Report.warningText(w, atts), await photoFiles(atts));
    });
    $$('[data-wok]', body).forEach(b => b.onclick = () => {
      const w = list[+b.dataset.wok];
      const m = Modal.open(`
        <h3>✔ 경고 확인 완료 처리</h3>
        <p class="modal-msg small" style="margin-bottom:.8rem">${esc(w.date)} · <b>${esc(w.unitLabel)} ${esc(w.name)}</b></p>
        <div style="margin-bottom:1.1rem;padding:.9rem;background:#f0fdf4;border:1.5px solid #86efac;border-radius:12px;text-align:center">
          <p style="margin:0 0 .5rem;font-size:.88rem;color:#166534;font-weight:700">문제가 없는 경우 아래 버튼을 누르면 즉시 ‘이상없음’으로 저장됩니다.</p>
          <button type="button" class="btn primary" id="wf-no-issue" style="background:var(--green);width:100%;font-size:1.05rem;padding:.75em">✅ 이상없음 (즉시 저장)</button>
        </div>
        <form class="mform" id="wf">
          <label>특이사항 메모 (특이사항이 있는 경우 입력)
            <input id="wf-m" value="${esc(w.memo && w.memo !== '이상없음' ? w.memo : '')}" placeholder="예) 동명이인 확인 / 실수로 2회 촬영하여 1건 삭제함" required>
          </label>
          <div class="modal-actions">
            <button type="button" class="btn ghost" id="wf-c">취소</button>
            <button class="btn primary" type="submit">특이사항 저장</button>
          </div>
        </form>`, 'wide');
      $('#wf-c', m).onclick = () => Modal.close(m);
      $('#wf-no-issue', m).onclick = async () => {
        await Store.resolveWarning(w.id, '이상없음');
        Modal.close(m);
        this.render();
      };
      $('#wf', m).onsubmit = async e => {
        e.preventDefault();
        await Store.resolveWarning(w.id, $('#wf-m', m).value.trim() || '이상없음');
        Modal.close(m);
        this.render();
      };
    });
  },

  /* ===================== 형제 관리 (체크박스 선택 일괄 삭제 지원) ===================== */
  async tab_members(body) {
    const ms = (await Store.membersWithStats()).sort((a, b) => unitOrder(unitLabel(a)) - unitOrder(unitLabel(b)) || koSort(a, b));
    this.selectedMemberIds = this.selectedMemberIds || new Set();
    // 이미 삭제된 ID 정리
    const validIds = new Set(ms.map(m => String(m.id)));
    this.selectedMemberIds.forEach(id => { if (!validIds.has(id)) this.selectedMemberIds.delete(id); });

    body.innerHTML = `
      <div class="toolbar">
        ${this.unitSelect('f-unit', true, this.fUnit || '')}
        <input id="f-q" placeholder="이름 검색" value="${esc(this.fQ || '')}">
        <button class="btn primary" id="add">＋ 형제 추가</button>
        <button class="btn danger" id="del-sel" disabled>🗑 선택 삭제 (0명)</button>
      </div>
      <div id="list"></div>`;

    const updateDelBtn = () => {
      const cnt = this.selectedMemberIds.size;
      const btn = $('#del-sel');
      if (!btn) return;
      btn.disabled = cnt === 0;
      btn.textContent = `🗑 선택 삭제 (${cnt}명)`;
    };

    const draw = () => {
      this.fUnit = $('#f-unit').value;
      this.fQ = $('#f-q').value.trim();
      const rows = ms.filter(m => (!this.fUnit || `${m.unit}|${m.company || ''}` === this.fUnit) && (!this.fQ || m.name.includes(this.fQ)));
      const allChecked = rows.length > 0 && rows.every(m => this.selectedMemberIds.has(String(m.id)));

      $('#list').innerHTML = `
        <p class="muted">${rows.length}명 표시 중</p>
        <div class="tbl-wrap">
          <table class="tbl">
            <thead>
              <tr>
                <th style="width:40px;text-align:center"><input type="checkbox" id="chk-all" ${allChecked ? 'checked' : ''} style="width:18px;height:18px;cursor:pointer" title="현재 목록 전체 선택"></th>
                <th>소속</th><th>이름</th><th>전역일</th><th>누적</th><th>최근 출석</th><th></th>
              </tr>
            </thead>
            <tbody>
              ${rows.map(m => `
                <tr>
                  <td style="text-align:center"><input type="checkbox" class="chk-mem" data-id="${m.id}" ${this.selectedMemberIds.has(String(m.id)) ? 'checked' : ''} style="width:18px;height:18px;cursor:pointer"></td>
                  <td>${esc(unitLabel(m))}</td>
                  <td><b>${esc(m.name)}</b>${Store.isLongAbsent(m) ? ' <span class="badge gray">3개월+</span>' : ''}</td>
                  <td>${m.dischargeDate}</td>
                  <td>${m.total}</td>
                  <td>${m.last || '-'}</td>
                  <td class="nowrap">
                    <button type="button" class="btn small ghost" data-hist="${m.id}">기록</button>
                    <button type="button" class="btn small ghost" data-edit="${m.id}">수정</button>
                    <button type="button" class="btn small danger" data-del-one="${m.id}">삭제</button>
                  </td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>`;

      const chkAll = $('#chk-all');
      if (chkAll) {
        chkAll.onchange = e => {
          rows.forEach(m => {
            if (e.target.checked) this.selectedMemberIds.add(String(m.id));
            else this.selectedMemberIds.delete(String(m.id));
          });
          draw();
        };
      }
      $$('.chk-mem', $('#list')).forEach(cb => {
        cb.onchange = e => {
          if (e.target.checked) this.selectedMemberIds.add(String(cb.dataset.id));
          else this.selectedMemberIds.delete(String(cb.dataset.id));
          if (chkAll) chkAll.checked = rows.length > 0 && rows.every(m => this.selectedMemberIds.has(String(m.id)));
          updateDelBtn();
        };
      });
      $$('[data-hist]').forEach(b => b.onclick = () => this.history(ms.find(m => String(m.id) === String(b.dataset.hist))));
      $$('[data-edit]').forEach(b => b.onclick = () => this.memberForm(ms.find(m => String(m.id) === String(b.dataset.edit))));
      $$('[data-del-one]').forEach(b => b.onclick = async () => {
        const target = ms.find(m => String(m.id) === String(b.dataset.delOne));
        if (!target) return;
        if (!await Modal.confirm(`<b>${esc(unitLabel(target))} ${esc(target.name)}</b> 형제의 모든 정보와 출석 기록·사진을 삭제할까요?`, '삭제')) return;
        await Store.deleteMember(target.id);
        this.selectedMemberIds.delete(String(target.id));
        this.render();
      });
      updateDelBtn();
    };

    $('#f-unit').onchange = draw;
    $('#f-q').oninput = draw;
    $('#add').onclick = () => this.memberForm(null);
    $('#del-sel').onclick = async () => {
      const ids = [...this.selectedMemberIds];
      if (!ids.length) return;
      const names = ids.map(id => ms.find(x => String(x.id) === String(id))?.name).filter(Boolean);
      const previewNames = names.slice(0, 5).join(', ') + (names.length > 5 ? ` 외 ${names.length - 5}명` : '');
      if (!await Modal.confirm(`선택한 <b>${ids.length}명</b>(${esc(previewNames)})의 모든 정보와 출석 기록·사진을 일괄 삭제할까요?<br><span class="red">삭제된 데이터는 복구할 수 없습니다.</span>`, '일괄 삭제')) return;
      await Store.deleteMembersBatch(ids);
      this.selectedMemberIds.clear();
      this.render();
    };
    draw();
  },

  async memberForm(m) {
    const v = m || {};
    const grants = m ? await Store.grantsOf(m.id) : [];
    const slots = Store.getMemberSlots(v, grants);
    const w = Modal.open(`<h3>${m ? '형제 정보 및 마일리지 수정' : '형제 추가'}</h3>
      <form class="mform" id="mf">
        <div class="two">
          <label>소속 ${this.unitSelect('mf-unit', false, m ? `${m.unit}|${m.company || ''}` : '')}</label>
          <label>이름 <input id="mf-name" value="${esc(v.name || '')}" required></label>
        </div>
        <div class="two">
          <label>전역일 <input id="mf-dc" type="date" value="${v.dischargeDate || ''}" required></label>
          <label>사진촬영 전 누적 출석횟수 <input id="mf-bc" type="number" min="0" value="${v.baseCount || 0}"></label>
        </div>
        <label>사진촬영 전 마지막 출석일 (선택) <input id="mf-bl" type="date" value="${v.baseLastDate || ''}"></label>
        <fieldset style="margin-top:.4rem">
          <legend>🎖 마일리지 1~5차 (24~120회) 기준일 · 건의일</legend>
          <p class="hint" style="margin:0 0 .5rem">예: 26-02-01 또는 달력 선택 → 표에는 <b>26.02.01</b> 형식으로 표시됩니다.</p>
          ${slots.map(sl => `
            <div class="slot-grid">
              <div class="slot-title">${sl.stage}차 (${sl.count}회)</div>
              <label style="margin:0;font-size:.82rem">기준일(예배일)
                <input type="date" data-slot-base="${sl.stage}" value="${sl.baseDate || ''}">
              </label>
              <label style="margin:0;font-size:.82rem">건의일(부대건의)
                <input type="date" data-slot-prop="${sl.stage}" value="${sl.proposedDate || ''}">
              </label>
            </div>
          `).join('')}
        </fieldset>
        <div class="modal-actions">
          ${m ? '<button type="button" class="btn danger" id="mf-del">삭제</button>' : ''}
          <button type="button" class="btn ghost" id="mf-cancel">취소</button>
          <button type="submit" class="btn primary">저장</button></div>
      </form>`, 'wide');
    $('#mf-cancel', w).onclick = () => Modal.close(w);
    if (m) $('#mf-del', w).onclick = async () => {
      if (!await Modal.confirm(`<b>${esc(m.name)}</b> 형제의 모든 출석 기록과 사진을 완전히 삭제할까요?<br>(전역자는 자동으로 보관함으로 이동하니, 잘못 등록한 경우에만 삭제하세요)`, '삭제')) return;
      await Store.deleteMember(m.id); Modal.close(w); this.render();
    };
    $('#mf', w).onsubmit = async e => {
      e.preventDefault();
      const uv = $('#mf-unit', w).value;
      if (!uv) return Modal.alert('소속을 선택해 주세요.');
      const newSlots = [1, 2, 3, 4, 5].map(st => ({
        stage: st,
        count: st * CONFIG.mileageUnit,
        baseDate: $(`[data-slot-base="${st}"]`, w).value,
        proposedDate: $(`[data-slot-prop="${st}"]`, w).value,
      }));
      const normSlots = Store.normalizeSlots(newSlots);
      const data = {
        ...this.parseUnit(uv),
        name: $('#mf-name', w).value.replace(/\s/g, ''),
        dischargeDate: $('#mf-dc', w).value,
        baseCount: +$('#mf-bc', w).value || 0,
        baseGrantedBlocks: normSlots.reduce((mx, sl) => Math.max(mx, sl.stage), 0),
        baseLastDate: $('#mf-bl', w).value || null,
        mileageSlots: normSlots,
      };
      if (m) {
        await Store.updateMember(m.id, data);
        await Store.saveMemberSlots(m.id, normSlots);
      } else {
        await Store.addMember(data);
      }
      Modal.close(w); this.render();
    };
  },

  /** 출석 기록 보기 (readOnly: 전역자) - 클릭 없이 전체 사진이 한눈에 보이도록 대형 갤러리 창으로 표시 */
  async history(m, readOnly = false) {
    const atts = (m.atts || []).slice().sort((a, b) => b.ts - a.ts);
    const w = Modal.open(`<h3>${esc(unitLabel(m))} ${esc(m.name)} · 출석 기록 전체보기</h3>
      <p class="modal-msg small">누적 <b>${m.total}회</b> (사진촬영 전 ${m.baseCount || 0}회 + 시스템 기록 ${atts.length}회) · 전역일 ${m.dischargeDate}</p>
      <div class="hist-grid">${atts.map(a => `<div class="hist-card hist-row" data-id="${a.id}">
        <div class="hist-card-head">
          <div class="hist-info"><b>${a.date} (${weekdayOf(a.date)}) ${a.time}</b>${a.manual ? ` <span class="badge">수동</span> <span class="muted">${esc(a.reason)}</span>` : ''}</div>
          ${readOnly ? '' : `<button class="btn small danger" data-del="${a.id}">삭제</button>`}
        </div>
        <div class="hist-th"></div>
      </div>`).join('') || '<p class="muted">출석 기록이 없습니다.</p>'}</div>
      <div class="modal-actions"><button class="btn primary" data-ok>닫기</button></div>`, 'xwide');
    w.querySelector('[data-ok]').onclick = () => Modal.close(w);
    for (const row of $$('.hist-row', w)) {
      const a = atts.find(x => x.id === row.dataset.id);
      await this.fillThumbs($('.hist-th', row), [a]);
    }
    $$('[data-del]', w).forEach(b => b.onclick = async () => {
      if (!await Modal.confirm('이 출석 기록(사진 포함)을 삭제할까요?', '삭제')) return;
      await Store.deleteAttendance(b.dataset.del);
      Modal.close(w); this.render();
    });
  },

  /* ===================== 수동 출석 보정 ===================== */
  async tab_manual(body) {
    const ms = await Store.membersWithStats();
    const now = new Date();
    body.innerHTML = `
      <div class="card"><h3>수동 출석 추가</h3>
        <form class="mform" id="man">
          <label>소속 ${this.unitSelect('man-unit')}</label>
          <label>이름 <select id="man-m"><option value="">먼저 소속을 선택하세요</option></select></label>
          <div class="two"><label>날짜 <input type="date" id="man-d" value="${fmtDate(now)}" max="${fmtDate(now)}"></label>
          <label>시간 <input type="time" id="man-t" value="${fmtTime(now)}"></label></div>
          <label>사유 (필수) <textarea id="man-r" rows="2" placeholder="예) 공기계 고장으로 수기 명단 확인 / 근무로 늦게 도착"></textarea></label>
          <button class="btn primary" type="submit">출석 추가</button>
        </form></div>
      <h3>최근 수동 보정 기록</h3><div id="man-list"></div>`;
    $('#man-unit').onchange = e => {
      const { unit, company } = this.parseUnit(e.target.value || '|');
      const list = ms.filter(m => m.unit === unit && (m.company || null) === company).sort(koSort);
      $('#man-m').innerHTML = `<option value="">이름 선택</option>` + list.map(m => `<option value="${m.id}">${esc(m.name)} (전역 ${m.dischargeDate}, 누적 ${m.total}회)</option>`).join('');
    };
    $('#man').onsubmit = async e => {
      e.preventDefault();
      const id = $('#man-m').value, d = $('#man-d').value, t = $('#man-t').value, reason = $('#man-r').value.trim();
      if (!id) return Modal.alert('형제를 선택해 주세요.');
      if (!d || !t) return Modal.alert('날짜와 시간을 입력해 주세요.');
      if (!reason) return Modal.alert('사유를 꼭 입력해 주세요. 나중에 기억하는 데 도움이 돼요.');
      try {
        const res = await Store.recordAttendance({ memberId: id, when: new Date(`${d}T${t}`), manual: true, reason });
        await Modal.alert(`추가했습니다. (누적 ${res.total}회)`);
        this.render();
      } catch (err) { Modal.alert(esc(err.message)); }
    };
    const list = await Store.recentManual();
    $('#man-list').innerHTML = list.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>출석일</th><th>소속 · 이름</th><th>사유</th><th>입력일</th><th></th></tr></thead>
      <tbody>${list.map(a => `<tr><td>${a.date} ${a.time}</td><td>${esc(a.unitLabel)} ${esc(a.member ? a.member.name : '')}</td><td>${esc(a.reason)}</td>
      <td>${fmtDate(new Date(a.createdAt))}</td><td><button class="btn small danger" data-del="${a.id}">삭제</button></td></tr>`).join('')}</tbody></table></div>`
      : '<p class="muted">수동 보정 기록이 없습니다.</p>';
    $$('[data-del]', $('#man-list')).forEach(b => b.onclick = async () => {
      if (!await Modal.confirm('이 수동 출석 기록을 삭제할까요?', '삭제')) return;
      await Store.deleteAttendance(b.dataset.del); this.render();
    });
  },

  /* ===================== 마일리지 (미건의 대상자 즉시 조치 + 1~5차 기준일·건의일 관리) ===================== */
  async tab_mileage(body) {
    const U = CONFIG.mileageUnit;
    const today = todayStr();
    const [ms, grants] = await Promise.all([Store.membersWithStats(), Store.allGrants()]);
    const G = {};
    grants.forEach(g => (G[g.memberId] = G[g.memberId] || []).push(g));

    const allRows = ms.map(m => {
      const slots = Store.getMemberSlots(m, G[m.id]);
      const upTo = Store.grantedUpTo(m, G[m.id]);
      const earned = Math.min(5, Math.floor(m.total / U));
      // 건의일(proposedDate)까지 입력되어야 건의 완료로 인정
      const granted = slots.filter(sl => sl.proposedDate).length;
      const pendingSlots = slots.filter(sl => m.total >= sl.count && !sl.proposedDate);
      const pending = pendingSlots.length;
      return { m, slots, upTo, earned, granted, pending, pendingSlots };
    }).sort((a, b) => b.pending - a.pending || unitOrder(unitLabel(a.m)) - unitOrder(unitLabel(b.m)) || koSort(a.m, b.m));

    // 미건의 항목(용사별 미건의 차수) 추출
    const pendingItems = [];
    allRows.forEach(r => {
      r.pendingSlots.forEach(sl => {
        pendingItems.push({
          member: r.m,
          rowObj: r,
          stage: sl.stage,
          count: sl.count,
          // 언제부(기준일): 기존 입력된 기준일 또는 24/48/72/96/120회째 달성 예배일 자동 세팅
          autoBaseDate: sl.baseDate || sl.achievedDate || today,
          autoPropDate: today,
        });
      });
    });

    body.innerHTML = `
      <div class="card" style="border:2px solid ${pendingItems.length ? '#dc2626' : '#16a34a'};background:${pendingItems.length ? '#fff5f5' : '#f0fdf4'};margin-bottom:1.1rem">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:.5rem;margin-bottom:.6rem">
          <h3 style="margin:0;color:${pendingItems.length ? '#b91c1c' : '#166534'}">
            ${pendingItems.length
              ? `🚨 미건의 대상자 조치 (${pendingItems.length}건) — 언제부로(기준일) 언제 건의신청(건의일)하는지 바로 입력·저장하세요`
              : `✅ 현재 미건의 대상자가 없습니다 (모든 24회 단위 달성자 건의 완료)`}
          </h3>
          ${pendingItems.length > 1 ? `<button class="btn primary small" id="apply-all-pending" style="background:#dc2626">✔ 아래 ${pendingItems.length}건 일괄 건의완료 저장</button>` : ''}
        </div>
        ${pendingItems.length ? `
          <p class="hint" style="margin:0 0 .7rem;color:#7f1d1d">
            ※ <b>‘언제부(기준일)’</b>는 해당 회차(24/48/72/96/120회)를 달성한 예배 날짜가 <b>자동으로 채워지며 직접 수정도 가능</b>합니다.<br>
            ※ <b>‘언제 건의신청(건의일)’</b>은 오늘 날짜(${fmtYYMMDD(today)})가 기본으로 들어가며, 원하는 날짜로 바꾼 뒤 <b>[✔ 건의완료 저장]</b>을 누르면 즉시 조치됩니다.
          </p>
          <div class="tbl-wrap">
            <table class="tbl" style="background:#fff;border-radius:10px;overflow:hidden">
              <thead>
                <tr style="background:#fee2e2;color:#7f1d1d">
                  <th>소속부대 · 이름</th>
                  <th>전역일</th>
                  <th>현재 누적</th>
                  <th>달성 차수</th>
                  <th>📅 언제부 (기준일: 자동/수정가능)</th>
                  <th>📅 언제 건의신청 (건의일)</th>
                  <th>조치</th>
                </tr>
              </thead>
              <tbody>
                ${pendingItems.map((it, idx) => `
                  <tr class="pend-item-row" data-mid="${it.member.id}" data-stage="${it.stage}">
                    <td><b>${esc(unitLabel(it.member))} ${esc(it.member.name)}</b></td>
                    <td>${fmtYYMMDD(it.member.dischargeDate)}</td>
                    <td><b>${it.member.total}회</b></td>
                    <td><span class="badge" style="background:#dc2626;color:#fff">${it.stage}차 (${it.count}회)</span></td>
                    <td>
                      <input type="date" class="pend-base" value="${esc(it.autoBaseDate)}" style="padding:.35rem .5rem;font-weight:700;border:1.5px solid #cbd5e1;border-radius:8px">
                      <div class="muted" style="font-size:.75rem;margin-top:.15rem">표기: <b class="pend-base-prev">${fmtYYMMDD(it.autoBaseDate)}</b>부</div>
                    </td>
                    <td>
                      <input type="date" class="pend-prop" value="${esc(it.autoPropDate)}" style="padding:.35rem .5rem;font-weight:700;border:1.5px solid #2563eb;border-radius:8px">
                      <div class="muted" style="font-size:.75rem;margin-top:.15rem">표기: <b class="pend-prop-prev">${fmtYYMMDD(it.autoPropDate)}</b> 건의</div>
                    </td>
                    <td class="nowrap">
                      <button type="button" class="btn small primary pend-save-one" style="background:#16a34a">✔ 건의완료 저장</button>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        ` : ''}
      </div>

      <div class="note">
        예배 <b>${U}회</b> 달성마다 마일리지(1~5차: 24회·48회·72회·96회·120회) <b>기준일(언제부)</b>과 <b>건의일(언제 건의신청)</b>을 기록·관리합니다.<br>
        날짜는 <code>26.02.01</code> 형식으로 표시되며, 표 우측의 <b>[건의 입력/수정]</b>을 눌러 언제든 모든 차수의 날짜를 수정할 수 있습니다.
      </div>
      <div class="toolbar">
        ${this.unitSelect('mil-unit', true, this.milUnit || '')}
        <input id="mil-q" placeholder="이름 검색" value="${esc(this.milQ || '')}" style="max-width:160px">
        <label><input type="checkbox" id="only-pending" ${this.onlyPending ? 'checked' : ''}> 미건의 대상자만 보기</label>
        <label><input type="checkbox" id="only-earned" ${this.onlyEarned ? 'checked' : ''}> 24회 이상자만 보기</label>
        <button class="btn ghost small" id="mil-xl">📊 마일리지 표 엑셀 다운로드</button>
      </div>
      <div id="mil-table-wrap"></div>`;

    // 미건의 대상자 행의 날짜 변경 시 YY.MM.DD 실시간 미리보기 업데이트
    $$('.pend-item-row', body).forEach(row => {
      const bIn = $('.pend-base', row);
      const pIn = $('.pend-prop', row);
      const bPrev = $('.pend-base-prev', row);
      const pPrev = $('.pend-prop-prev', row);
      if (bIn && bPrev) bIn.onchange = () => { bPrev.textContent = fmtYYMMDD(bIn.value) || '-'; };
      if (pIn && pPrev) pIn.onchange = () => { pPrev.textContent = fmtYYMMDD(pIn.value) || '-'; };

      const saveBtn = $('.pend-save-one', row);
      if (saveBtn) {
        saveBtn.onclick = async () => {
          const mId = row.dataset.mid;
          const stage = +row.dataset.stage;
          const baseVal = bIn.value;
          const propVal = pIn.value;
          if (!baseVal) return Modal.alert('언제부(기준일) 날짜를 선택해 주세요.');
          if (!propVal) return Modal.alert('언제 건의신청(건의일) 날짜를 선택해 주세요.');

          const targetRow = allRows.find(x => String(x.m.id) === String(mId));
          if (!targetRow) return;
          const updatedSlots = targetRow.slots.map(sl => ({
            stage: sl.stage,
            count: sl.count,
            baseDate: sl.stage === stage ? baseVal : sl.baseDate,
            proposedDate: sl.stage === stage ? propVal : sl.proposedDate,
          }));
          await Store.saveMemberSlots(targetRow.m.id, updatedSlots);
          this.render();
        };
      }
    });

    // 미건의 전체 일괄 저장 버튼
    const applyAllBtn = $('#apply-all-pending', body);
    if (applyAllBtn) {
      applyAllBtn.onclick = async () => {
        const rows = $$('.pend-item-row', body);
        if (!rows.length) return;
        if (!await Modal.confirm(`화면 상단의 미건의 대상 <b>${rows.length}건</b>을 입력된 기준일(언제부)·건의일로 한꺼번에 건의완료 처리할까요?`, '일괄 건의완료 저장')) return;

        // 용사별로 슬롯 변경사항 모으기
        const updatesByMember = {};
        rows.forEach(row => {
          const mId = row.dataset.mid;
          const stage = +row.dataset.stage;
          const baseVal = $('.pend-base', row).value;
          const propVal = $('.pend-prop', row).value;
          if (!updatesByMember[mId]) {
            const tr = allRows.find(x => String(x.m.id) === String(mId));
            if (tr) {
              updatesByMember[mId] = tr.slots.map(sl => ({
                stage: sl.stage,
                count: sl.count,
                baseDate: sl.baseDate,
                proposedDate: sl.proposedDate,
              }));
            }
          }
          if (updatesByMember[mId]) {
            const slotObj = updatesByMember[mId].find(s => s.stage === stage);
            if (slotObj) {
              slotObj.baseDate = baseVal;
              slotObj.proposedDate = propVal;
            }
          }
        });

        for (const [mId, slots] of Object.entries(updatesByMember)) {
          await Store.saveMemberSlots(mId, slots);
        }
        this.render();
      };
    }

    const drawTable = () => {
      this.milUnit = $('#mil-unit').value;
      this.milQ = $('#mil-q').value.trim();
      this.onlyPending = $('#only-pending').checked;
      this.onlyEarned = $('#only-earned').checked;

      const filtered = allRows.filter(r => {
        if (this.milUnit && `${r.m.unit}|${r.m.company || ''}` !== this.milUnit) return false;
        if (this.milQ && !r.m.name.includes(this.milQ)) return false;
        if (this.onlyPending && !r.pending) return false;
        if (this.onlyEarned && r.m.total < U && !r.granted) return false;
        return true;
      });

      $('#mil-table-wrap').innerHTML = `
        <p class="muted" style="margin:.4rem 0">총 ${filtered.length}명 (미건의 대상: <b class="red">${filtered.filter(x => x.pending > 0).length}명</b>)</p>
        <div class="tbl-wrap">
          <table class="mil-tbl">
            <thead>
              <tr>
                <th rowspan="2" class="mil-base-th">소속</th>
                <th rowspan="2" class="mil-base-th">이름</th>
                <th rowspan="2" class="mil-base-th">전역일</th>
                <th rowspan="2" class="mil-base-th">누적출석</th>
                <th rowspan="2" class="mil-base-th">상태</th>
                <th colspan="2" class="mil-stage-th">24회</th>
                <th colspan="2" class="mil-stage-th">48회</th>
                <th colspan="2" class="mil-stage-th">72회</th>
                <th colspan="2" class="mil-stage-th">96회</th>
                <th colspan="2" class="mil-stage-th">120회</th>
                <th rowspan="2" class="mil-base-th">관리</th>
              </tr>
              <tr>
                <th class="mil-sub-th">기준일</th><th class="mil-sub-th">건의일</th>
                <th class="mil-sub-th">기준일</th><th class="mil-sub-th">건의일</th>
                <th class="mil-sub-th">기준일</th><th class="mil-sub-th">건의일</th>
                <th class="mil-sub-th">기준일</th><th class="mil-sub-th">건의일</th>
                <th class="mil-sub-th">기준일</th><th class="mil-sub-th">건의일</th>
              </tr>
            </thead>
            <tbody>
              ${filtered.length ? filtered.map(r => `
                <tr>
                  <td>${esc(unitLabel(r.m))}</td>
                  <td><b>${esc(r.m.name)}</b></td>
                  <td>${fmtYYMMDD(r.m.dischargeDate)}</td>
                  <td><b>${r.m.total}회</b></td>
                  <td>${r.pending ? `<span class="badge" style="background:#dc2626;color:#fff">미건의 ${r.pending}건</span>` : (r.granted ? `<span class="badge" style="background:#16a34a;color:#fff">${r.granted}차 완료</span>` : '<span class="muted">-</span>')}</td>
                  ${r.slots.map(sl => {
                    const isAchievedPending = r.m.total >= sl.count && !sl.proposedDate;
                    const dispBase = fmtYYMMDD(sl.baseDate || (isAchievedPending ? sl.achievedDate : ''));
                    const dispProp = fmtYYMMDD(sl.proposedDate);
                    return `
                      <td class="mil-date-cell ${isAchievedPending ? 'mil-pending-cell' : ''}" title="${sl.stage}차(${sl.count}회) 기준일(언제부)">${dispBase || ''}</td>
                      <td class="mil-date-cell ${isAchievedPending ? 'mil-pending-cell' : ''}" title="${sl.stage}차(${sl.count}회) 건의일">${dispProp || (isAchievedPending ? '<span style="font-size:.75rem;color:#dc2626">미건의</span>' : '')}</td>
                    `;
                  }).join('')}
                  <td><button class="btn small primary" data-grant="${r.m.id}">건의 입력/수정</button></td>
                </tr>
              `).join('') : '<tr><td colspan="16" class="muted" style="padding:1.5rem">조건에 해당하는 형제가 없습니다.</td></tr>'}
            </tbody>
          </table>
        </div>`;

      $$('[data-grant]', $('#mil-table-wrap')).forEach(b => b.onclick = () => {
        const r = allRows.find(x => String(x.m.id) === String(b.dataset.grant));
        if (r) this.openMileageModal(r);
      });
    };

    $('#mil-unit').onchange = drawTable;
    $('#mil-q').oninput = drawTable;
    $('#only-pending').onchange = drawTable;
    $('#only-earned').onchange = drawTable;
    $('#mil-xl').onclick = () => this.exportExcel();
    drawTable();
  },

  openMileageModal(r) {
    const U = CONFIG.mileageUnit;
    const w = Modal.open(`
      <h3>🎖 ${esc(unitLabel(r.m))} ${esc(r.m.name)} · 마일리지 1~5차 (언제부 · 언제 건의신청) 설정</h3>
      <p class="modal-msg small">
        현재 누적 출석: <b>${r.m.total}회</b> (도입 전 ${r.m.baseCount || 0}회 + 사진/시스템 ${r.m.atts.length}회)<br>
        달성된 회차의 <b>언제부(예배 달성 기준일)</b>는 자동으로 채워지며 수정할 수 있습니다. <b>언제 건의신청(부대 건의일)</b>을 확인 후 저장해 주세요.
      </p>
      <form class="mform" id="gf">
        ${r.slots.map(sl => {
          const isReached = r.m.total >= sl.count;
          const autoBase = sl.baseDate || (isReached ? sl.achievedDate : '');
          const autoProp = sl.proposedDate || (isReached && !sl.proposedDate && autoBase ? todayStr() : '');
          return `
            <div class="slot-grid ${isReached ? 'achieved' : ''}">
              <div>
                <div class="slot-title">${sl.stage}차 (${sl.count}회)</div>
                <div style="font-size:.75rem;color:${isReached ? '#b45309' : '#64748b'}">${isReached ? (sl.proposedDate ? '✅ 건의완료' : '🚨 달성·미건의') : '미달성'}</div>
              </div>
              <label style="margin:0;font-size:.82rem">
                📅 언제부 (${sl.stage}차 기준일 · 자동/수정가능)
                <input type="date" data-s-base="${sl.stage}" value="${autoBase || ''}">
              </label>
              <label style="margin:0;font-size:.82rem">
                📅 언제 건의신청 (${sl.stage}차 건의일)
                <input type="date" data-s-prop="${sl.stage}" value="${autoProp || ''}">
              </label>
            </div>
          `;
        }).join('')}
        <div class="modal-actions">
          <button type="button" class="btn ghost" id="gf-c">취소</button>
          <button class="btn primary" type="submit">저장하기</button>
        </div>
      </form>`, 'wide');

    $('#gf-c', w).onclick = () => Modal.close(w);
    $('#gf', w).onsubmit = async e => {
      e.preventDefault();
      const updatedSlots = [1, 2, 3, 4, 5].map(st => ({
        stage: st,
        count: st * U,
        baseDate: $(`[data-s-base="${st}"]`, w).value,
        proposedDate: $(`[data-s-prop="${st}"]`, w).value,
      }));
      await Store.saveMemberSlots(r.m.id, updatedSlots);
      Modal.close(w);
      this.render();
    };
  },

  /* ===================== 엑셀 일괄 등록 (1~5차 기준일·건의일 지원) ===================== */
  async tab_import(body) {
    body.innerHTML = `
      <div class="card"><h3>📥 엑셀로 형제 명단 및 기존 마일리지(1~5차) 한 번에 등록</h3>
        <ol class="steps">
          <li>아래 <b>[📄 엑셀 양식 내려받기]</b>를 눌러 ‘명단’ 시트에 작성합니다.</li>
          <li><b>24회(1차) ~ 120회(5차)</b>의 <b>기준일</b>(예배 기준일)과 <b>건의일</b>(부대 건의일)을 <code>26.02.01</code> 또는 <code>26-2-1</code> 형식으로 입력하면 그대로 등록됩니다.</li>
          <li>이미 등록된 형제도 엑셀에 마일리지 기준일/건의일을 적어 다시 올리면 자동으로 업데이트됩니다.</li>
        </ol>
        <div class="row">
          <a class="btn ghost" href="templates/명단_일괄등록_양식.xlsx" download>📄 엑셀 양식 내려받기 (24~120회 기준일·건의일 포함)</a>
          <label class="file-btn btn primary">📂 작성한 엑셀 파일 선택<input type="file" id="xf" accept=".xlsx,.xls,.csv" hidden></label>
        </div>
      </div><div id="xprev"></div>`;
    $('#xf').onchange = async e => {
      const f = e.target.files[0]; if (!f) return;
      if (typeof XLSX === 'undefined') return Modal.alert('엑셀 읽기 도구를 불러오지 못했어요. 인터넷 연결을 확인해 주세요.');
      try {
        const wb = XLSX.read(await f.arrayBuffer(), { cellDates: true });
        const ws = wb.Sheets['명단'] || wb.Sheets[wb.SheetNames[0]];
        this.previewImport(XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' }));
      } catch (err) { Modal.alert('파일을 읽지 못했어요: ' + esc(err.message)); }
    };
  },

  async previewImport(aoa) {
    const hi = aoa.findIndex(r => r.some(c => String(c).includes('이름')));
    if (hi < 0) return Modal.alert('‘이름’ 열을 찾지 못했어요. 양식을 사용해 주세요.');
    const H1 = aoa[hi].map(c => String(c).trim());
    const H2 = (aoa[hi + 1] || []).map(c => String(c).trim());
    const col = kw => H1.findIndex(h => h.includes(kw));
    const C = {
      unit: col('소속'),
      company: col('중대'),
      name: col('이름'),
      dc: col('전역'),
      bc: col('누적') >= 0 ? col('누적') : col('출석횟수'),
      bg: col('마일리지'),
      bl: col('마지막'),
    };

    // 2행 헤더(24회/48회/72회/96회/120회 아래 기준일/건의일) 여부 판별
    const hasSubHeader = !String(H2[C.name] || '').trim() && H2.some(c => c.includes('기준일') || c.includes('건의일'));
    const dataStartIdx = hasSubHeader ? hi + 2 : hi + 1;

    // 1~5차(24, 48, 72, 96, 120회) 기준일/건의일 열 위치 파악
    const stageCols = {};
    [1, 2, 3, 4, 5].forEach(st => {
      const target = st * 24;
      let baseCol = -1, propCol = -1;
      if (hasSubHeader) {
        const topIdx = H1.findIndex(h => h.includes(String(target)) || h.includes(`${st}차`));
        if (topIdx >= 0) {
          baseCol = topIdx;
          propCol = topIdx + 1;
        }
      } else {
        baseCol = H1.findIndex(h => (h.includes(String(target)) || h.includes(`${st}차`)) && h.includes('기준'));
        propCol = H1.findIndex(h => (h.includes(String(target)) || h.includes(`${st}차`)) && h.includes('건의'));
      }
      stageCols[st] = { baseCol, propCol };
    });

    const existing = await Store.membersWithStats();
    const existingKeys = new Set(existing.map(m => `${m.unit}|${m.company || ''}|${m.name}|${m.dischargeDate}`));
    const seenInFile = new Set();
    const rows = [];

    aoa.slice(dataStartIdx).forEach((r, i) => {
      const get = k => (C[k] >= 0 ? r[C[k]] : '');
      const name = String(get('name')).replace(/\s/g, '');
      if (!name) return;
      let unit = String(get('unit')).trim(), company = String(get('company')).trim() || null;
      if (unit === '8단본부') unit = '단본부';
      if (unit === '8단통신') unit = '단통신';
      if (unit === '608수송대대' && company) {
        const map608 = { '본부중대': '608본부', '중형중대': '608중형', '버스중대': '608버스', '대형중대': '608대형' };
        if (map608[company]) { unit = map608[company]; company = null; }
      }
      if (unit === '18보급대대') company = null;
      const u = CONFIG.units.find(x => x.name === unit);

      const mileageSlots = [1, 2, 3, 4, 5].map(st => {
        const { baseCol, propCol } = stageCols[st];
        const bDate = baseCol >= 0 ? normalizeDate(r[baseCol]) : '';
        const pDate = propCol >= 0 ? normalizeDate(r[propCol]) : '';
        return { stage: st, count: st * 24, baseDate: bDate, proposedDate: pDate };
      });
      const slotBlocks = mileageSlots.filter(sl => sl.baseDate || sl.proposedDate).length;

      const rec = {
        line: dataStartIdx + i + 1,
        name,
        unit,
        company: u && u.companies ? company : null,
        dischargeDate: normalizeDate(get('dc')),
        baseCount: parseInt(get('bc')) || 0,
        baseGrantedBlocks: Math.max(parseInt(get('bg')) || 0, slotBlocks),
        baseLastDate: normalizeDate(get('bl')) || null,
        mileageSlots,
      };
      const key = `${rec.unit}|${rec.company || ''}|${rec.name}|${rec.dischargeDate}`;
      let err = '';
      if (!u) err = '소속부대 이름이 올바르지 않음';
      else if (u.companies && !u.companies.includes(company)) err = `중대를 선택해야 함 (${u.companies.join('/')})`;
      else if (!rec.dischargeDate) err = '전역일 형식 오류';
      else if (rec.dischargeDate < todayStr()) err = '이미 전역함';
      else if (seenInFile.has(key)) err = '엑셀 파일 내 중복 행';
      if (!err) seenInFile.add(key);
      rec.isUpdate = !err && existingKeys.has(key);
      rec.err = err;
      rows.push(rec);
    });

    const ok = rows.filter(r => !r.err);
    const newCnt = ok.filter(r => !r.isUpdate).length;
    const updCnt = ok.filter(r => r.isUpdate).length;

    $('#xprev').innerHTML = `
      <h3>미리보기 · 반영 가능 ${ok.length}명 (신규 ${newCnt}명 / 기존 업데이트 ${updCnt}명) · 제외 ${rows.length - ok.length}명</h3>
      <button class="btn primary" id="xgo" ${ok.length ? '' : 'disabled'}>✔ ${ok.length}명 일괄 반영하기</button>
      <div class="tbl-wrap" style="margin-top:.8rem">
        <table class="mil-tbl">
          <thead>
            <tr>
              <th rowspan="2" class="mil-base-th">행</th>
              <th rowspan="2" class="mil-base-th">소속</th>
              <th rowspan="2" class="mil-base-th">이름</th>
              <th rowspan="2" class="mil-base-th">전역일</th>
              <th rowspan="2" class="mil-base-th">기존출석</th>
              <th colspan="2" class="mil-stage-th">24회</th>
              <th colspan="2" class="mil-stage-th">48회</th>
              <th colspan="2" class="mil-stage-th">72회</th>
              <th colspan="2" class="mil-stage-th">96회</th>
              <th colspan="2" class="mil-stage-th">120회</th>
              <th rowspan="2" class="mil-base-th">상태</th>
            </tr>
            <tr>
              <th class="mil-sub-th">기준일</th><th class="mil-sub-th">건의일</th>
              <th class="mil-sub-th">기준일</th><th class="mil-sub-th">건의일</th>
              <th class="mil-sub-th">기준일</th><th class="mil-sub-th">건의일</th>
              <th class="mil-sub-th">기준일</th><th class="mil-sub-th">건의일</th>
              <th class="mil-sub-th">기준일</th><th class="mil-sub-th">건의일</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(r => `
              <tr class="${r.err ? 'bad' : ''}">
                <td>${r.line}</td>
                <td>${esc(r.unit)} ${esc(r.company || '')}</td>
                <td><b>${esc(r.name)}</b></td>
                <td>${fmtYYMMDD(r.dischargeDate)}</td>
                <td>${r.baseCount}</td>
                ${r.mileageSlots.map(sl => `
                  <td class="mil-date-cell">${fmtYYMMDD(sl.baseDate)}</td>
                  <td class="mil-date-cell">${fmtYYMMDD(sl.proposedDate)}</td>
                `).join('')}
                <td>${r.err ? `<span class="red">${esc(r.err)}</span>` : (r.isUpdate ? '🔄 기존 인원 업데이트' : '✅ 신규 등록')}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>`;

    $('#xgo').onclick = async () => {
      await Store.addMembersBatch(ok);
      await Modal.alert(`총 ${ok.length}명(신규 ${newCnt}명, 업데이트 ${updCnt}명)의 명단 및 마일리지 기록을 반영했습니다.`);
      this.open('mileage');
    };
  },

  /* ===================== 전역자 보관함 ===================== */
  async tab_discharged(body) {
    const list = await Store.dischargedList();
    body.innerHTML = `<div class="note">전역일이 지난 형제는 자동으로 이곳에 옮겨져 출석 명단에서 사라집니다. 출석 기록·사진·마일리지 이력은 증빙용으로 보존됩니다.</div>
      ${list.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>소속</th><th>이름</th><th>전역일</th><th>누적</th><th>이동일</th><th></th></tr></thead>
      <tbody>${list.map(d => `<tr><td>${esc(unitLabel(d))}</td><td><b>${esc(d.name)}</b></td><td>${d.dischargeDate}</td><td>${d.total}</td><td>${d.movedAt}</td>
        <td class="nowrap"><button class="btn small ghost" data-hist="${d.id}">기록</button><button class="btn small ghost" data-rest="${d.id}">복원</button></td></tr>`).join('')}</tbody></table></div>`
      : '<p class="muted">전역자가 없습니다.</p>'}`;
    $$('[data-hist]').forEach(b => b.onclick = () => this.history(list.find(d => d.id === b.dataset.hist), true));
    $$('[data-rest]').forEach(b => b.onclick = () => {
      const d = list.find(x => x.id === b.dataset.rest);
      const w = Modal.open(`<h3>${esc(d.name)} 복원</h3><p class="modal-msg small">전역일을 잘못 입력한 경우에만 사용하세요. 올바른 전역일을 입력해 주세요.</p>
        <form class="mform" id="rf"><label>전역일 <input type="date" id="rf-d" min="${todayStr()}" required></label>
        <div class="modal-actions"><button type="button" class="btn ghost" id="rf-c">취소</button><button class="btn primary">복원</button></div></form>`);
      $('#rf-c', w).onclick = () => Modal.close(w);
      $('#rf', w).onsubmit = async e => { e.preventDefault(); await Store.restoreDischarged(d.id, $('#rf-d', w).value); Modal.close(w); this.render(); };
    });
  },

  /* ===================== 설정 / 인계 ===================== */
  async tab_settings(body) {
    const s = await Store.settings();
    const apiUrl = await Backend.getUrl();
    const pending = await Backend.pendingCount();
    let usage = '';
    try { const est = await navigator.storage.estimate(); usage = `${(est.usage / 1048576).toFixed(1)}MB 사용 중 (사용 가능 약 ${(est.quota / 1073741824).toFixed(1)}GB)`; } catch (e) { }
    body.innerHTML = `
      <div class="card" style="border:2px solid #2563eb;background:#f0f7ff;margin-bottom:1.2rem">
        <div style="display:flex;align-items:center;gap:.5rem">
          <span style="font-size:1.6rem">📱</span>
          <h3 style="margin:0;color:#1e3a8a">예배당 출석 단말기(공기계) 승인 관리</h3>
        </div>
        <p class="hint" style="margin-top:.5rem;line-height:1.6;color:#1e293b">
          <b>공기계 2~3대(또는 그 이상) 모두 등록 가능합니다.</b><br>
          예배당에 비치할 각 공기계에서 이 웹앱을 열고, [목사님 전용] 메뉴의 이 화면에서 아래 <b>[📱 이 기기를 출석 단말기로 승인]</b> 버튼을 한 번씩만 눌러두시면 됩니다.<br>
          승인되지 않은 일반 용사들의 스마트폰은 첫 화면 터치 시 출석이 원천 차단됩니다.
        </p>
        <div style="margin-top:.8rem;padding:.8rem;border-radius:10px;background:#fff;border:1px solid #bfdbfe;font-size:1rem;font-weight:700">
          현재 기기 상태: <span id="kiosk-status">${s.isKioskAuthorized ? '🟢 예배당 공식 출석 단말기로 승인됨 (출석 촬영 가능)' : '🔴 미승인 기기 (외부 접속 차단 상태: 출석 촬영 불가)'}</span>
        </div>
        <div class="row" style="margin-top:.8rem">
          <button class="btn primary" id="kiosk-auth-btn" style="font-size:1rem;padding:.6rem 1.2rem">${s.isKioskAuthorized ? '🚫 단말기 승인 해제 (개인 조회 전용 모드로 변경)' : '📱 이 기기를 예배당 출석 단말기로 승인'}</button>
        </div>
      </div>
      <div class="card"><h3>☁️ 백엔드 서버 연동 (Google 계정 통합 · 자동 메일 · 데스크탑 동기화)</h3>
        <p class="hint">보안을 위해 공용 계정이 아닌 <b>목사님 개인 구글 계정</b>에서 배포한 Google Apps Script 웹앱 URL과 <b>백엔드 전용 비밀번호</b>를 입력해 연결합니다.<br>
          봉사자가 교회 공용 계정에 접속하더라도 목사님 개인 구글 드라이브의 DB 시트에는 접근할 수 없으며, 백엔드 비밀번호 역시 보안 영역에만 저장됩니다.</p>
        <form class="mform" id="bf" style="margin-top:.6rem">
          <label>Google Apps Script 웹앱 URL
            <input type="url" id="bf-url" placeholder="https://script.google.com/macros/s/.../exec" value="${esc(apiUrl)}">
          </label>
          <label>백엔드 서버 비밀번호
            <input type="password" id="bf-pw" inputmode="numeric" maxlength="8" placeholder="백엔드 비밀번호 입력" value="${esc(Backend.sessionBackendPw || '')}">
          </label>
          <div class="row">
            <button class="btn primary" type="submit" id="bf-save">🔌 서버 연결 및 일요일 13:00 자동발송 켜기</button>
            ${apiUrl ? `<button class="btn ghost" type="button" id="bf-check">🔓 백엔드 상태 확인</button>` : ''}
            ${apiUrl ? `<button class="btn ghost" type="button" id="bf-flush">🔄 대기 작업 동기화 (${pending}건)</button>` : ''}
          </div>
        </form>
        <div id="bk-status" style="margin-top:.8rem"></div>
        <div class="row" style="margin-top:.8rem;padding-top:.8rem;border-top:1px solid #eef0f3">
          <button class="btn ghost small" id="cloud-push" ${apiUrl ? '' : 'disabled'}>☁️↑ 이 기기 데이터 → 서버로 전체 업로드</button>
          <button class="btn ghost small" id="cloud-pull" ${apiUrl ? '' : 'disabled'}>☁️↓ 서버 데이터 → 이 기기로 전체 복원 (데스크탑/새 기기 동기화)</button>
        </div>
      </div>
      <div class="card"><h3>🔐 백엔드 서버 비밀번호 변경</h3>
        <p class="hint">백엔드 서버(웹 콘솔 및 서버 관리 작업)에 들어갈 때 사용하는 비밀번호입니다. 교회 데스크탑에서 작업하실 때와 후임 군종목사님 인계 시 원하는 번호로 변경하실 수 있습니다.</p>
        <form class="mform" id="bpf" style="margin-top:.5rem">
          <label>현재 백엔드 비밀번호 <input type="password" id="bpf-cur" inputmode="numeric" maxlength="8" placeholder="현재 백엔드 비밀번호" required></label>
          <div class="two">
            <label>새 백엔드 비밀번호 (숫자 4~8자리) <input type="password" id="bpf-1" inputmode="numeric" maxlength="8" pattern="\\d{4,8}" required></label>
            <label>새 백엔드 비밀번호 확인 <input type="password" id="bpf-2" inputmode="numeric" maxlength="8" pattern="\\d{4,8}" required></label>
          </div>
          <button class="btn primary" ${apiUrl ? '' : 'disabled'}>백엔드 비밀번호 변경</button>
        </form>
      </div>

      <div class="card"><h3>📧 이메일</h3>
        <form class="mform" id="ef">
          <label>리포트 받는 이메일 <input type="email" id="ef-a" value="${esc(s.adminEmail)}" required></label>
          <label>리포트 보내는 이메일 (공기계 계정) <input type="email" id="ef-s" value="${esc(s.senderEmail)}" required></label>
          <button class="btn primary">저장</button></form></div>
      <div class="card"><h3>🔑 화면 잠금 비밀번호 변경 (목사님 전용 입장용)</h3>
        <form class="mform" id="pf">
          <div class="two"><label>새 비밀번호 (숫자 4자리) <input id="pf-1" inputmode="numeric" maxlength="4" pattern="\\d{4}" required></label>
          <label>한 번 더 <input id="pf-2" inputmode="numeric" maxlength="4" pattern="\\d{4}" required></label></div>
          <button class="btn primary">변경</button></form></div>
      <div class="card"><h3>💾 파일 백업 · 인계</h3>
        <p class="muted">${usage}</p>
        <p>백엔드 서버와 별개로 기기 전체 데이터를 파일 하나로 내려받거나 복원할 수 있습니다.</p>
        <div class="row">
          <button class="btn primary" id="bk">⬇ 전체 백업 파일 저장 (사진 포함)</button>
          <label class="file-btn btn ghost">⬆ 백업 파일 불러오기<input type="file" id="rs" accept=".json" hidden></label>
          <button class="btn ghost" id="xl">📊 출석 기록 엑셀로 내보내기</button>
        </div>
        <details><summary>후임 군종목사님께 인계하는 방법</summary>
          <ol class="steps"><li>위 ‘이메일’에서 받는 이메일을 후임 목사님 주소로 바꿉니다. (서버에도 자동 반영됩니다)</li>
          <li>‘백엔드 서버 비밀번호 변경’과 ‘화면 잠금 비밀번호 변경’으로 새 비밀번호를 정해 전달합니다.</li>
          <li>교회 데스크탑에서 이 프로그램을 실행하고 웹앱 URL만 연결해 두면 예배당 공기계의 출석 데이터가 데스크탑으로 자동 동기화됩니다.</li></ol></details>
      </div>`;

    const renderServerStatus = st => {
      const box = $('#bk-status');
      if (!box) return;
      if (!st) {
        box.innerHTML = apiUrl
          ? `<p class="muted">🔒 백엔드 상세 상태(구글 시트/사진 폴더 링크 등)를 보려면 백엔드 비밀번호를 입력하고 <b>‘🔓 백엔드 상태 확인’</b>을 눌러 주세요.</p>`
          : `<p class="muted">아직 연결된 백엔드 서버가 없습니다. (<code>백엔드_연동_안내.md</code>를 참고해 5분 만에 무료로 만들 수 있어요)</p>`;
        return;
      }
      box.innerHTML = `
        <div class="note" style="margin:0;background:#f0fdf4;border-left-color:var(--green)">
          <b>✅ 백엔드 인증 및 서버 정상 연결됨</b> (발신 계정: <b>${esc(st.senderEmail)}</b> → 수신 계정: <b>${esc(st.adminEmail)}</b>)<br>
          · 서버 보관 현황: 현역 <b>${st.memberCount}명</b> / 출석기록 <b>${st.attendanceCount}건</b> / 전역보관 <b>${st.dischargedCount}명</b><br>
          · 일요일 13:00 자동 메일 트리거: <b>${st.hasWeeklyTrigger ? '🟢 작동 중' : '⚪ 미설정 («서버 연결» 버튼을 눌러 켜 주세요)'}</b>
          ${st.lastWeeklyReportSentAt ? ` (최근 자동/서버 발송: ${esc(st.lastWeeklyReportSentAt)})` : ''}<br>
          <div class="row" style="margin-top:.4rem">
            <a class="btn small ghost" href="${esc(st.spreadsheetUrl)}" target="_blank" rel="noopener">📊 구글 시트 DB 열기</a>
            <a class="btn small ghost" href="${esc(st.photoFolderUrl)}" target="_blank" rel="noopener">📁 구글 드라이브 사진 폴더 열기</a>
          </div>
        </div>`;
    };

    if (apiUrl && Backend.sessionBackendPw) {
      renderServerStatus(Backend.serverStatus);
      Backend.adminCall('status').then(r => renderServerStatus(r.status)).catch(e => {
        const box = $('#bk-status');
        if (box) box.innerHTML = `<p class="err">⚠️ 서버 상태 확인 실패: ${esc(e.message)}</p>`;
      });
    } else {
      renderServerStatus(null);
    }

    const chkBtn = $('#bf-check');
    if (chkBtn) chkBtn.onclick = async () => {
      const pw = $('#bf-pw').value.trim();
      if (pw) Backend.sessionBackendPw = pw;
      try {
        const r = await Backend.adminCall('status');
        $('#bf-pw').value = Backend.sessionBackendPw;
        renderServerStatus(r.status);
      } catch (err) {
        await Modal.alert(esc(err.message));
      }
    };

    $('#bf').onsubmit = async e => {
      e.preventDefault();
      const url = $('#bf-url').value.trim();
      const pw = $('#bf-pw').value.trim();
      if (!url) {
        await Store.saveSettings({ apiUrl: '' }, false);
        Backend.serverStatus = null;
        Backend.lockSession();
        await Modal.alert('백엔드 서버 연결을 해제했습니다.');
        return this.render();
      }
      if (!pw) return Modal.alert('백엔드 서버 비밀번호를 입력해 주세요.');
      const btn = $('#bf-save');
      btn.disabled = true; btn.textContent = '연결 및 트리거 설정 중…';
      try {
        await Backend.connectAndSetup(url, pw);
        await Modal.alert(`<b>백엔드 서버 인증 및 연결 완료!</b><br>· 매주 일요일 13:00 자동 리포트 발송이 켜졌습니다.<br>· 기존에 이 기기에 있던 명단/사진을 서버로 올리려면 <b>‘☁️↑ 이 기기 데이터 → 서버로 전체 업로드’</b>를, 서버 데이터를 이 데스크탑으로 가져오려면 <b>‘☁️↓ 서버 데이터 → 이 기기로 전체 복원’</b>을 눌러 주세요.`);
        this.render();
      } catch (err) {
        await Modal.alert('연결 실패: ' + esc(err.message));
        btn.disabled = false; btn.textContent = '🔌 서버 연결 및 일요일 13:00 자동발송 켜기';
      }
    };

    $('#bpf').onsubmit = async e => {
      e.preventDefault();
      const cur = $('#bpf-cur').value.trim();
      const p1 = $('#bpf-1').value.trim(), p2 = $('#bpf-2').value.trim();
      if (!/^\d{4,8}$/.test(p1)) return Modal.alert('새 백엔드 비밀번호는 숫자 4~8자리로 입력해 주세요.');
      if (p1 !== p2) return Modal.alert('새 백엔드 비밀번호 두 개가 서로 다릅니다.');
      try {
        await Backend.changeBackendPassword(cur, p1);
        $('#bf-pw').value = p1;
        e.target.reset();
        await Modal.alert('백엔드 서버 비밀번호를 성공적으로 변경했습니다.');
      } catch (err) {
        await Modal.alert('변경 실패: ' + esc(err.message));
      }
    };

    const flushBtn = $('#bf-flush');
    if (flushBtn) flushBtn.onclick = async () => {
      flushBtn.disabled = true; flushBtn.textContent = '동기화 중…';
      await Backend.syncFromServerIfChanged(true);
      if (Backend.lastError) await Modal.alert('동기화 오류: ' + esc(Backend.lastError));
      else await Modal.alert('서버와 최신 상태로 동기화했습니다.');
      this.render();
    };

    $('#cloud-push').onclick = async () => {
      const pw = $('#bf-pw').value.trim();
      if (pw) Backend.sessionBackendPw = pw;
      if (!await Modal.confirm('현재 기기에 있는 모든 형제 명단, 출석 기록, 인증 사진을 서버(Google 시트/드라이브)로 업로드할까요?', '전체 업로드')) return;
      const w = Modal.open(`<h3>☁️↑ 서버로 업로드 중…</h3><p class="modal-msg" id="cp-msg">준비 중…</p>`);
      try {
        await Backend.pushAllToServer((done, total, msg) => {
          const el = $('#cp-msg', w); if (el) el.textContent = msg;
        });
        Modal.close(w);
        await Modal.alert('이 기기의 모든 데이터와 사진을 서버에 안전하게 업로드했습니다!');
        this.render();
      } catch (err) {
        Modal.close(w);
        await Modal.alert('업로드 실패: ' + esc(err.message));
      }
    };

    $('#cloud-pull').onclick = async () => {
      const pw = $('#bf-pw').value.trim();
      if (pw) Backend.sessionBackendPw = pw;
      if (!await Modal.confirm('서버(Google 시트/드라이브)에 저장된 전체 데이터를 이 기기로 가져와 복원할까요?<br><b>현재 기기의 데이터는 서버 데이터로 대체됩니다.</b>', '서버에서 복원')) return;
      const w = Modal.open(`<h3>☁️↓ 서버에서 복원 중…</h3><p class="modal-msg" id="cp-msg">준비 중…</p>`);
      try {
        const res = await Backend.pullAllFromServer((done, total, msg) => {
          const el = $('#cp-msg', w); if (el) el.textContent = msg;
        }, true);
        Modal.close(w);
        await Modal.alert(`서버에서 복원을 완료했습니다!<br>(형제 ${res.members}명, 출석기록 ${res.attendance}건, 사진 ${res.photos}장)`);
        this.render();
      } catch (err) {
        Modal.close(w);
        await Modal.alert('복원 실패: ' + esc(err.message));
      }
    };

        $('#kiosk-auth-btn').onclick = async () => {
      const cur = await Store.isDeviceAuthorized();
      if (!cur) {
        if (!await Modal.confirm('이 기기를 <b>천군교회 예배당 공식 출석 단말기</b>로 승인할까요?<br>승인된 기기에서만 용사들이 출석체크를 진행할 수 있습니다.', '단말기 승인')) return;
        await Store.setDeviceAuthorized(true);
        await Modal.alert('✅ 이 기기가 예배당 공식 출석 단말기로 승인되었습니다!<br>이제 첫 화면 터치 시 정상적으로 출석체크가 진행됩니다.');
      } else {
        if (!await Modal.confirm('이 기기의 단말기 승인을 해제할까요?<br>해제 시 이 기기에서는 출석체크가 차단됩니다. (목사님 PC 등 관리용 모드)', '승인 해제')) return;
        await Store.setDeviceAuthorized(false);
        await Modal.alert('단말기 승인이 해제되었습니다.');
      }
      this.render();
    };

    $('#ef').onsubmit = async e => {
      e.preventDefault();
      try {
        if (apiUrl) await Backend.ensureBackendAuth();
        await Store.saveSettings({ adminEmail: $('#ef-a').value.trim(), senderEmail: $('#ef-s').value.trim() });
        await Modal.alert('저장했습니다. (서버 설정에도 자동 반영됩니다)');
        this.render();
      } catch (err) {
        await Modal.alert(esc(err.message));
      }
    };
    $('#pf').onsubmit = async e => {
      e.preventDefault();
      const a = $('#pf-1').value, b = $('#pf-2').value;
      if (!/^\d{4}$/.test(a)) return Modal.alert('숫자 4자리로 입력해 주세요.');
      if (a !== b) return Modal.alert('두 비밀번호가 달라요.');
      await Store.saveSettings({ password: a }); Modal.alert('화면 잠금 비밀번호를 변경했습니다.'); e.target.reset();
    };
    $('#bk').onclick = async () => {
      const data = await Store.exportBackup();
      downloadBlob(new Blob([JSON.stringify(data)], { type: 'application/json' }), `천군교회_출석백업_${todayStr()}.json`);
    };
    $('#rs').onchange = async e => {
      const f = e.target.files[0]; if (!f) return;
      if (!await Modal.confirm('백업 파일로 복원하면 <b>현재 기기의 데이터가 모두 바뀝니다.</b> 계속할까요?', '복원')) return;
      try { await Store.importBackup(JSON.parse(await f.text())); await Modal.alert('복원했습니다.'); this.render(); }
      catch (err) { Modal.alert('복원 실패: ' + esc(err.message)); }
    };
    $('#xl').onclick = () => this.exportExcel();
  },

  async exportExcel() {
    if (typeof XLSX === 'undefined') return Modal.alert('엑셀 도구를 불러오지 못했어요. 인터넷 연결을 확인해 주세요.');
    const people = await Store.allPeopleFull();
    // 2행 헤더(24회/48회/72회/96회/120회 -> 기준일/건의일) 양식으로 시트 구성
    const aoa = [
      ['상태', '소속부대', '이름', '전역일', '누적출석', '사진촬영전출석', '마지막출석일', '24회', '', '48회', '', '72회', '', '96회', '', '120회', ''],
      ['', '', '', '', '', '', '', '기준일', '건의일', '기준일', '건의일', '기준일', '건의일', '기준일', '건의일', '기준일', '건의일'],
    ];
    people.forEach(p => {
      const slots = Store.getMemberSlots(p, p.grants);
      const row = [
        p.discharged ? '전역' : '현역',
        unitLabel(p),
        p.name,
        fmtYYMMDD(p.dischargeDate),
        p.total,
        p.baseCount || 0,
        fmtYYMMDD(p.last || ''),
      ];
      slots.forEach(sl => {
        row.push(fmtYYMMDD(sl.baseDate), fmtYYMMDD(sl.proposedDate));
      });
      aoa.push(row);
    });
    const wsRoster = XLSX.utils.aoa_to_sheet(aoa);
    wsRoster['!merges'] = [
      { s: { r: 0, c: 0 }, e: { r: 1, c: 0 } },
      { s: { r: 0, c: 1 }, e: { r: 1, c: 1 } },
      { s: { r: 0, c: 2 }, e: { r: 1, c: 2 } },
      { s: { r: 0, c: 3 }, e: { r: 1, c: 3 } },
      { s: { r: 0, c: 4 }, e: { r: 1, c: 4 } },
      { s: { r: 0, c: 5 }, e: { r: 1, c: 5 } },
      { s: { r: 0, c: 6 }, e: { r: 1, c: 6 } },
      { s: { r: 0, c: 7 }, e: { r: 0, c: 8 } },
      { s: { r: 0, c: 9 }, e: { r: 0, c: 10 } },
      { s: { r: 0, c: 11 }, e: { r: 0, c: 12 } },
      { s: { r: 0, c: 13 }, e: { r: 0, c: 14 } },
      { s: { r: 0, c: 15 }, e: { r: 0, c: 16 } },
    ];

    const att = people.flatMap(p => p.atts.map(a => ({
      날짜: a.date, 요일: weekdayOf(a.date), 시간: a.time, 소속: unitLabel(p), 이름: p.name,
      구분: a.manual ? '수동' : '사진', 사유: a.reason || '', 사진파일명: a.hasPhoto ? a.fileName : '',
    }))).sort((a, b) => (a.날짜 + a.시간).localeCompare(b.날짜 + b.시간));

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, wsRoster, '명단_및_마일리지');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(att), '출석기록');
    XLSX.writeFile(wb, `천군교회_마일리지현황_${todayStr()}.xlsx`);
  },
};
