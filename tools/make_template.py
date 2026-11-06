# -*- coding: utf-8 -*-
"""형제 명단 일괄등록 엑셀 양식 생성"""
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.worksheet.datavalidation import DataValidation
import sys

out = sys.argv[1]
UNITS = ['본부근무대', '정보통신대', '단본부', '단통신', '8급양대', '18보급대대', '608본부', '608중형', '608버스', '608대형', '78정비대대']
HEAD = ['소속부대', '이름', '전역일', '기존 누적 출석횟수', '기존 마일리지 지급횟수', '마지막 출석일']
WIDTH = [16, 12, 14, 18, 20, 16]

navy = PatternFill('solid', fgColor='1F3A5F')
cream = PatternFill('solid', fgColor='FFF8E6')
thin = Side(style='thin', color='CCCCCC')
box = Border(left=thin, right=thin, top=thin, bottom=thin)

wb = Workbook()
ws = wb.active
ws.title = '명단'
ws.append(HEAD)
for i, w in enumerate(WIDTH):
    c = ws.cell(row=1, column=i + 1)
    c.font = Font(bold=True, color='FFFFFF'); c.fill = navy
    c.alignment = Alignment(horizontal='center', vertical='center', wrap_text=True)
    ws.column_dimensions[chr(65 + i)].width = w
ws.row_dimensions[1].height = 32
ws.freeze_panes = 'A2'
for r in range(2, 302):
    for col in range(1, len(HEAD) + 1):
        cell = ws.cell(row=r, column=col); cell.border = box
        if col in (3, 6): cell.number_format = 'yyyy-mm-dd'

dv_u = DataValidation(type='list', formula1='"' + ','.join(UNITS) + '"', allow_blank=True)
dv_u.error = '목록에서 부대를 선택해 주세요.'
ws.add_data_validation(dv_u)
dv_u.add('A2:A301')

# 작성 예시 (등록되지 않는 별도 시트)
ex = wb.create_sheet('작성예시')
ex.append(HEAD)
ex.append(['608중형', '홍길동', '2027-05-14', 30, 1, '2026-10-29'])
ex.append(['본부근무대', '김철수', '2027-08-02', 0, 0, ''])
ex.append(['18보급대대', '이영희', '2027-01-20', 12, 0, '2026-11-01'])
for i, w in enumerate(WIDTH):
    c = ex.cell(row=1, column=i + 1); c.font = Font(bold=True, color='FFFFFF'); c.fill = navy
    ex.column_dimensions[chr(65 + i)].width = w

# 작성 방법
g = wb.create_sheet('작성방법')
g.column_dimensions['A'].width = 24; g.column_dimensions['B'].width = 80
rows = [
    ('천군교회 예배 출석 - 형제 명단 일괄등록 양식', ''),
    ('', ''),
    ('항목', '작성 방법'),
    ('소속부대 (필수)', '목록에서 선택: ' + ', '.join(UNITS)),
    ('이름 (필수)', '띄어쓰기 없이 입력 (예: 홍길동)'),
    ('전역일 (필수)', '2027-05-14 형식. 같은 부대 동명이인은 전역일로 구분됩니다.'),
    ('기존 누적 출석횟수', '이 프로그램을 쓰기 전까지 출석한 횟수 (모르면 0). 24회 마일리지 계산에 합산됩니다.'),
    ('기존 마일리지 지급횟수', '이미 부대에 건의(지급)한 마일리지 횟수 (24회당 1회). 없으면 0.'),
    ('마지막 출석일', '이 프로그램 이전 마지막 출석일 (모르면 비움). 3개월 지난 형제는 ‘오랜만에 왔어요’ 명단에 표시됩니다.'),
    ('', ''),
    ('주의', '‘명단’ 시트에만 작성해 주세요. ‘작성예시’ 시트는 참고용이며 등록되지 않습니다.\n이미 전역한 형제, 이미 등록된 형제(부대·이름·전역일 동일)는 자동으로 건너뜁니다.'),
    ('등록 방법', '목사님 전용 → 📥 엑셀 등록 → 파일 선택 → 미리보기 확인 → 등록하기'),
]
for r in rows: g.append(r)
g['A1'].font = Font(bold=True, size=14, color='1F3A5F')
for c in ('A3', 'B3'): g[c].font = Font(bold=True, color='FFFFFF'); g[c].fill = navy
for row in g.iter_rows(min_row=4):
    for c in row:
        c.alignment = Alignment(wrap_text=True, vertical='top')
        if c.column == 1 and c.value: c.font = Font(bold=True); c.fill = cream

wb.move_sheet('작성방법', offset=-2)
wb.active = 1
wb.save(out)
print('saved', out)
