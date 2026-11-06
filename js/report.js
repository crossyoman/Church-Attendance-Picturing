/* =========================================================
 * 주간 리포트 (매주 일요일 13:00 기준)
 * 지난 일요일 13:00 초과 ~ 이번 일요일 13:00 이하 사이에
 * 누적 출석이 24의 배수를 넘어선 형제를 뽑습니다.
 * (백엔드에서 자동 메일 발송 시 이 로직을 그대로 사용)
 * ========================================================= */
const Report = {
  /** ref 시점 기준 가장 최근의 '일요일 13:00' */
  lastCutoff(ref = new Date()) {
    const d = new Date(ref);
    d.setHours(CONFIG.reportHour, 0, 0, 0);
    d.setDate(d.getDate() - ((d.getDay() - CONFIG.reportWeekday + 7) % 7));
    if (d > ref) d.setDate(d.getDate() - 7);
    return d;
  },
  recentCutoffs(n = 12) {
    const out = [];
    let c = this.lastCutoff();
    for (let i = 0; i < n; i++) { out.push(new Date(c)); c.setDate(c.getDate() - 7); }
    return out;
  },

  async build(cutoff) {
    const U = CONFIG.mileageUnit;
    const end = cutoff.getTime();
    const prev = new Date(end - 7 * 864e5);
    const start = prev.getTime();
    const people = await Store.allPeopleFull();

    const achievers = [];
    for (const p of people) {
      const atts = p.atts.filter(a => a.ts <= end);            // 이미 시간순 정렬됨
      const base = p.baseCount || 0;
      const c1 = base + atts.length;
      const c0 = base + atts.filter(a => a.ts <= start).length;
      const k0 = Math.floor(c0 / U), k1 = Math.floor(c1 / U);
      if (k1 <= k0) continue;
      const grantedBlocks = Math.floor(Store.grantedUpTo(p, p.grants) / U);
      for (let k = k0 + 1; k <= k1; k++) {
        const lo = U * (k - 1), hi = U * k;
        const block = atts.filter((a, i) => { const ord = base + i + 1; return ord > lo && ord <= hi; });
        achievers.push({
          person: p, milestone: hi, total: c1, block,
          missing: U - block.length,      // 시스템 도입 전 기록이라 사진이 없는 회차 수
          allDates: atts.map(a => a.date),
          grantedBlocks, earnedBlocks: k1, pendingBlocks: Math.max(0, k1 - grantedBlocks),
        });
      }
    }
    achievers.sort((a, b) => unitOrder(unitLabel(a.person)) - unitOrder(unitLabel(b.person)) || koSort(a.person, b.person));

    // 부대별 출석 현황
    const inWin = [];
    people.forEach(p => p.atts.forEach(a => { if (a.ts > start && a.ts <= end) inWin.push({ ...a, label: unitLabel(p) }); }));
    const dates = [...new Set(inWin.map(a => a.date))].sort();
    const rows = allUnitLabels().map(u => {
      const counts = dates.map(d => inWin.filter(a => a.label === u.label && a.date === d).length);
      return { label: u.label, counts, sum: counts.reduce((x, y) => x + y, 0) };
    });
    const totals = dates.map((d, i) => rows.reduce((s, r) => s + r.counts[i], 0));

    const warnings = (await Store.warnings()).filter(w => w.createdAt > start && w.createdAt <= end);

    return { cutoff, prev, achievers, stats: { dates, rows, totals }, warnings };
  },

  /** [경고-확인필요] 메일 본문 */
  warningText(w, atts = []) {
    const L = [`[경고-확인필요] ${CONFIG.churchName} 출석 중복 의심`, '',
      `- 날짜: ${w.date}`, `- 소속: ${w.unitLabel}`, `- 이름: ${w.name}`, `- 내용: ${w.detail}`,
      `- 발생 시각: ${new Date(w.createdAt).toLocaleString('ko-KR')}`];
    if (atts.length) {
      L.push('- 관련 출석 기록:');
      atts.forEach(a => L.push(`   · ${a.fileName}${a.retakes ? ` (재촬영 ${a.retakes}회)` : ''}`));
    }
    L.push('', '첨부된 사진으로 동일인 여부를 확인해 주세요.');
    return L.join('\n');
  },

  periodText(r) {
    return `${fmtDate(r.prev)}(${WEEK[r.prev.getDay()]}) ${fmtTime(r.prev)} ~ ${fmtDate(r.cutoff)}(${WEEK[r.cutoff.getDay()]}) ${fmtTime(r.cutoff)}`;
  },

  /** 이메일 본문용 텍스트 */
  text(r) {
    const L = [];
    L.push(`[${CONFIG.churchName} 주간 예배 출석 리포트]`);
    L.push(`기간: ${this.periodText(r)}`);
    L.push('');
    L.push(`■ ${CONFIG.mileageUnit}회 마일리지 달성자 (${r.achievers.length}명)`);
    if (!r.achievers.length) {
      L.push('  - 이번 주 신규 마일리지 달성자가 없습니다.');
    }
    r.achievers.forEach((a, i) => {
      const p = a.person;
      const photoAtts = a.block.filter(b => b.hasPhoto);
      const manualAtts = a.block.filter(b => !b.hasPhoto);
      const preCount = (a.missing || 0) + manualAtts.length;

      L.push(`--------------------------------------------------`);
      L.push(`${i + 1}) [${unitLabel(p)}] ${p.name} (전역: ${p.dischargeDate || '미기입'})${p.discharged ? ' [전역 처리]' : ''}`);
      L.push(`   · 마일리지 달성: ${a.milestone}회차 달성 (총 누적 출석: ${a.total}회)`);
      L.push(`   · 마일리지 포상 건의: ${a.pendingBlocks > 0 ? '신규 대상 (' + a.pendingBlocks + '건 건의 필요)' : '기존 건의 완료'}`);

      // 사진촬영 전 출석 명확 분리 표기
      if (preCount > 0) {
        L.push(`   · -사진촬영 전 출석-: 총 ${preCount}회`);
        if (a.missing > 0) {
          L.push(`     - 전산화 이전 수기 명부 확인: ${a.missing}회`);
        }
        if (manualAtts.length > 0) {
          L.push(`     - 수기 입력(사진 미촬영): ${manualAtts.length}회 (${manualAtts.map(b => b.date).join(', ')})`);
          manualAtts.forEach(b => {
            if (b.reason) L.push(`       ※ 사유: ${b.reason}`);
          });
        }
      }

      // 사진 인증 출석 분리 표기
      L.push(`   · [사진 인증 출석]: 총 ${photoAtts.length}회 (인증 사진 ${photoAtts.length}장 개별 첨부)`);
      if (photoAtts.length > 0) {
        L.push(`     - 사진 인증 일자: ${photoAtts.map(b => b.date).join(', ')}`);
      }
      L.push(`   · 이번 24회 구간: ${a.block.length ? (a.block[0].date + ' ~ ' + a.block[a.block.length - 1].date) : '도입 전 수기 출석'}`);
      L.push(`--------------------------------------------------`);
      L.push('');
    });

    if (r.warnings && r.warnings.length) {
      L.push(`■ [경고-확인필요] 이번 주 중복 의심 (${r.warnings.length}건)`);
      r.warnings.forEach(w => L.push(`  - ${w.date} ${w.unitLabel} ${w.name}: ${w.detail}${w.resolved ? ' → 확인 완료(' + (w.memo || '') + ')' : ''}`));
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
};
