/* =========================================================
 * 주간 리포트 (매주 일요일 13:00 기준)
 * - 24회 배수 달성자 + 사진촬영 전 출석 분리 표기
 * - 당일/주간 전체 출석자 명단, 날짜별·부대별 통계, 전체 촬영 사진 및 엑셀 생성
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
      const atts = p.atts.filter(a => a.ts <= end);
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
          missing: U - block.length,
          allDates: atts.map(a => a.date),
          grantedBlocks, earnedBlocks: k1, pendingBlocks: Math.max(0, k1 - grantedBlocks),
        });
      }
    }
    achievers.sort((a, b) => unitOrder(unitLabel(a.person)) - unitOrder(unitLabel(b.person)) || koSort(a.person, b.person));

    // 이번 주간(그날) 출석한 전체 기록 (부대별 누가 출석했는지 + 촬영 사진 전체)
    const inWin = [];
    people.forEach(p => {
      const base = p.baseCount || 0;
      p.atts.forEach((a, idx) => {
        if (a.ts > start && a.ts <= end) {
          inWin.push({
            ...a,
            label: unitLabel(p),
            memberName: p.name,
            dischargeDate: p.dischargeDate,
            cumCount: base + idx + 1,
            totalNow: p.total,
          });
        }
      });
    });
    inWin.sort((a, b) => a.date.localeCompare(b.date) || unitOrder(a.label) - unitOrder(b.label) || a.time.localeCompare(b.time) || a.memberName.localeCompare(b.memberName, 'ko'));

    const dates = [...new Set(inWin.map(a => a.date))].sort();
    const rows = allUnitLabels().map(u => {
      const counts = dates.map(d => inWin.filter(a => a.label === u.label && a.date === d).length);
      return { label: u.label, counts, sum: counts.reduce((x, y) => x + y, 0) };
    });
    const totals = dates.map((d, i) => rows.reduce((s, r) => s + r.counts[i], 0));

    const warnings = (await Store.warnings()).filter(w => w.createdAt > start && w.createdAt <= end);

    return { cutoff, prev, achievers, periodAtts: inWin, people, stats: { dates, rows, totals }, warnings };
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
    L.push(`[${CONFIG.churchName} 주간 예배 출석 리포트 및 통계]`);
    L.push(`기간: ${this.periodText(r)}`);
    L.push(`첨부: 1) 주간 출석명단·부대통계·마일리지 엑셀 파일(.xlsx)  2) 금주 촬영 출석사진 전체 (${(r.periodAtts || []).filter(a => a.hasPhoto).length}장)`);
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

      L.push(`   · [사진 인증 출석]: 총 ${photoAtts.length}회 (인증 사진 ${photoAtts.length}장)`);
      if (photoAtts.length > 0) {
        L.push(`     - 사진 인증 일자: ${photoAtts.map(b => b.date).join(', ')}`);
      }
      L.push(`   · 이번 24회 구간: ${a.block.length ? (a.block[0].date + ' ~ ' + a.block[a.block.length - 1].date) : '도입 전 수기 출석'}`);
      L.push(`--------------------------------------------------`);
      L.push('');
    });

    if (r.warnings && r.warnings.length) {
      L.push(`■ [경고-확인필요] 이번 주 중복/재출석 의심 (${r.warnings.length}건)`);
      r.warnings.forEach(w => L.push(`  - ${w.date} ${w.unitLabel} ${w.name}: ${w.detail}${w.resolved ? ' → 확인 완료(' + (w.memo || '이상없음') + ')' : ''}`));
      L.push('');
    }

    L.push('■ 날짜별 · 부대별 출석 인원 통계');
    const s = r.stats;
    if (!s.dates.length) {
      L.push('  - 이 기간 출석 기록이 없습니다.');
    } else {
      L.push('  부대 | ' + s.dates.map(shortDate).join(' | ') + ' | 합계');
      s.rows.filter(x => x.sum).forEach(x => L.push(`  ${x.label} | ${x.counts.join(' | ')} | ${x.sum}명`));
      L.push(`  전체합계 | ${s.totals.join(' | ')} | 총 ${s.totals.reduce((a, b) => a + b, 0)}명`);
    }
    L.push('');

    const pAtts = r.periodAtts || [];
    L.push(`■ 이번 주 예배 출석자 전체 명단 (총 ${pAtts.length}명)`);
    if (!pAtts.length) {
      L.push('  - 출석자가 없습니다.');
    } else {
      s.dates.forEach(d => {
        const dayList = pAtts.filter(a => a.date === d);
        L.push(`  [${d} (${weekdayOf(d)}) - 총 ${dayList.length}명]`);
        allUnitLabels().forEach(u => {
          const uList = dayList.filter(a => a.label === u.label);
          if (uList.length) {
            L.push(`   · ${u.label} (${uList.length}명): ` + uList.map(a => `${a.memberName}(${a.time}, 누적${a.cumCount}회${a.manual ? ', 수동' : ''})`).join(', '));
          }
        });
      });
    }
    return L.join('\n');
  },

  /** 주간 리포트 메일 첨부용 엑셀 파일(.xlsx) 생성 */
  async buildWeeklyExcelFile(r) {
    if (typeof XLSX === 'undefined') return null;
    const wb = XLSX.utils.book_new();
    const s = r.stats;

    // 1. 날짜별_부대통계 시트
    const statAoa = [
      ['부대', ...s.dates.map(d => `${d} (${weekdayOf(d)})`), '주간 합계'],
      ...s.rows.map(row => [row.label, ...row.counts, row.sum]),
      ['전체 합계', ...s.totals, s.totals.reduce((a, b) => a + b, 0)],
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(statAoa), '날짜별_부대통계');

    // 2. 주간_출석자_명단 시트
    const attRows = (r.periodAtts || []).map((a, idx) => ({
      연번: idx + 1,
      출석날짜: a.date,
      요일: weekdayOf(a.date),
      출석시간: a.time,
      소속부대: a.label,
      이름: a.memberName,
      전역일: fmtYYMMDD(a.dischargeDate),
      금회포함_누적출석: a.cumCount,
      출석구분: a.manual ? '수동보정' : '사진촬영',
      수동사유: a.reason || '',
      재촬영횟수: a.retakes || 0,
      사진파일명: a.hasPhoto ? (a.fileName + '.jpg') : '사진없음',
    }));
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(attRows.length ? attRows : [{ 안내: '이번 기간 출석 기록이 없습니다.' }]),
      '주간_출석자_명단'
    );

    // 3. 24회_마일리지_달성자 시트
    const achRows = (r.achievers || []).map((a, idx) => {
      const p = a.person;
      const photoAtts = a.block.filter(b => b.hasPhoto);
      const manualAtts = a.block.filter(b => !b.hasPhoto);
      const preCount = (a.missing || 0) + manualAtts.length;
      return {
        연번: idx + 1,
        소속부대: unitLabel(p),
        이름: p.name,
        전역일: fmtYYMMDD(p.dischargeDate),
        달성회차: `${a.milestone}회차`,
        총누적출석: a.total,
        사진촬영전_출석횟수: preCount,
        사진인증_출석횟수: photoAtts.length,
        사진인증_일자목록: photoAtts.map(b => b.date).join(', '),
      };
    });
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(achRows.length ? achRows : [{ 안내: '이번 주 24회 마일리지 신규 달성자가 없습니다.' }]),
      '24회_마일리지_달성자'
    );

    // 4. 전체_마일리지_현황 (1~5차 기준일·건의일 2행 헤더)
    const people = r.people || await Store.allPeopleFull();
    const milAoa = [
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
      slots.forEach(sl => row.push(fmtYYMMDD(sl.baseDate), fmtYYMMDD(sl.proposedDate)));
      milAoa.push(row);
    });
    const wsMil = XLSX.utils.aoa_to_sheet(milAoa);
    wsMil['!merges'] = [
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
    XLSX.utils.book_append_sheet(wb, wsMil, '전체_마일리지_현황');

    const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const fileName = `천군교회_주간출석명단_및_부대통계_${fmtDate(r.cutoff)}.xlsx`;
    return new File([wbout], fileName, {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
  },
};
