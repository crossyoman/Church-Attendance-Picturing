# -*- coding: utf-8 -*-
"""형제 명단 일괄등록 엑셀 양식 생성 (1~5차: 24/48/72/96/120회 기준일·건의일 포함)"""
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation
import sys

out = sys.argv[1] if len(sys.argv) > 1 else 'templates/명단_일괄등록_양식.xlsx'
UNITS = ['본부근무대', '정보통신대', '단본부', '단통신', '8급양대', '18보급대대', '608본부', '608중형', '608버스', '608대형', '78정비대대']
STAGES = ['24회', '48회', '72회', '96회', '120회']

navy = PatternFill('solid', fgColor='1F3A5F')
yellow = PatternFill('solid', fgColor='FFFF00')
cream = PatternFill('solid', fgColor='FFF8E6')
thin = Side(style='thin', color='888888')
box = Border(left=thin, right=thin, top=thin, bottom=thin)

def setup_sheet_headers(ws):
    # 기본 인적사항 (A~E열, 1~2행 병합)
    base_headers = [
        ('A', '소속부대', 16),
        ('B', '이름', 12),
        ('C', '전역일', 14),
        ('D', '기존 누적 출석횟수', 18),
        ('E', '마지막 출석일', 15),
    ]
    for col_letter, title, width in base_headers:
        ws.merge_cells(f'{col_letter}1:{col_letter}2')
        c1 = ws[f'{col_letter}1']
        c2 = ws[f'{col_letter}2']
        c1.value = title
        c1.font = Font(bold=True, color='FFFFFF', size=11)
        c1.fill = navy
        c1.alignment = Alignment(horizontal='center', vertical='center', wrap_text=True)
        c1.border = box
        c2.border = box
        ws.column_dimensions[col_letter].width = width

    # 마일리지 1차(24회) ~ 5차(120회): F열(6)부터 O열(15)까지 각 2열씩 (기준일 / 건의일)
    for idx, label in enumerate(STAGES):
        col1 = 6 + idx * 2
        col2 = col1 + 1
        let1 = get_column_letter(col1)
        let2 = get_column_letter(col2)
        ws.merge_cells(f'{let1}1:{let2}1')

        top1 = ws.cell(row=1, column=col1, value=label)
        top2 = ws.cell(row=1, column=col2)
        sub1 = ws.cell(row=2, column=col1, value='기준일')
        sub2 = ws.cell(row=2, column=col2, value='건의일')

        for cell in (top1, top2, sub1, sub2):
            cell.fill = yellow
            cell.font = Font(bold=True, color='000000', size=11)
            cell.alignment = Alignment(horizontal='center', vertical='center')
            cell.border = box

        ws.column_dimensions[let1].width = 13
        ws.column_dimensions[let2].width = 13

    ws.row_dimensions[1].height = 24
    ws.row_dimensions[2].height = 22
    ws.freeze_panes = 'A3'

wb = Workbook()
ws = wb.active
ws.title = '명단'
setup_sheet_headers(ws)

for r in range(3, 303):
    for col in range(1, 16):
        cell = ws.cell(row=r, column=col)
        cell.border = box
        cell.alignment = Alignment(horizontal='center', vertical='center')
        if col in (3, 5) or col >= 6:
            cell.number_format = '@'

dv_u = DataValidation(type='list', formula1='"' + ','.join(UNITS) + '"', allow_blank=True)
dv_u.error = '목록에서 부대를 선택해 주세요.'
ws.add_data_validation(dv_u)
dv_u.add('A3:A302')

# 작성 예시 시트
ex = wb.create_sheet('작성예시')
setup_sheet_headers(ex)
sample_rows = [
    ['608중형', '홍길동', '2027-05-14', 50, '26.10.25', '26.02.01', '26.02.06', '26.10.25', '26.11.02', '', '', '', '', '', ''],
    ['본부근무대', '김철수', '2027-08-02', 26, '26.03.15', '26.03.08', '26.03.12', '', '', '', '', '', '', '', ''],
    ['18보급대대', '이영희', '2027-01-20', 12, '26.11.01', '', '', '', '', '', '', '', '', '', ''],
]
for r_idx, row_vals in enumerate(sample_rows, start=3):
    for c_idx, val in enumerate(row_vals, start=1):
        cell = ex.cell(row=r_idx, column=c_idx, value=val)
        cell.border = box
        cell.alignment = Alignment(horizontal='center', vertical='center')

# 작성 방법 시트
g = wb.create_sheet('작성방법')
g.column_dimensions['A'].width = 26
g.column_dimensions['B'].width = 82
rows = [
    ('천군교회 예배 출석 - 형제 명단 및 마일리지(1~5차) 일괄등록 양식', ''),
    ('', ''),
    ('항목', '작성 방법'),
    ('소속부대 (필수)', '목록에서 선택: ' + ', '.join(UNITS)),
    ('이름 (필수)', '띄어쓰기 없이 입력 (예: 홍길동)'),
    ('전역일 (필수)', '2027-05-14 또는 27.05.14 형식. 같은 부대 동명이인은 전역일로 구분됩니다.'),
    ('기존 누적 출석횟수', '전자출석(사진촬영) 도입 전까지 출석한 횟수 (없으면 0).'),
    ('마지막 출석일', '시스템 도입 이전 마지막 출석일 (모르면 비움).'),
    ('24회~120회 (1~5차) 기준일', '해당 회차(24회, 48회, 72회, 96회, 120회)가 달성된 예배 날짜 (예: 26.02.01 또는 26-2-1)'),
    ('24회~120회 (1~5차) 건의일', '해당 회차 마일리지를 부대(인사과)에 건의한 날짜 (예: 26.02.06 또는 26-2-6)'),
    ('', ''),
    ('안내', '· ‘명단’ 시트에 작성해 주세요. 이미 등록된 형제도 엑셀을 다시 올리면 마일리지 기준일/건의일이 자동 업데이트됩니다.\n· 날짜는 26.02.01 / 26-2-1 / 2026-02-01 어떤 형식으로 적어도 자동으로 인식되어 26.02.01 형태로 깔끔하게 정리됩니다.'),
]
for r in rows:
    g.append(r)
g['A1'].font = Font(bold=True, size=14, color='1F3A5F')
for c in ('A3', 'B3'):
    g[c].font = Font(bold=True, color='FFFFFF')
    g[c].fill = navy
for row in g.iter_rows(min_row=4):
    for c in row:
        c.alignment = Alignment(wrap_text=True, vertical='top')
        if c.column == 1 and c.value:
            c.font = Font(bold=True)
            c.fill = cream

wb.move_sheet('작성방법', offset=-2)
wb.active = 1
wb.save(out)
print('saved', out)
