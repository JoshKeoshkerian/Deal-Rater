from docx import Document
from docx.shared import Pt
from docx.oxml.ns import qn
p='output/documents/Curbside_Executive_Summary.docx';d=Document(p)
for x in d.paragraphs:
 if x.text in ['Competitors','Management Team']:x.paragraph_format.page_break_before=False
 if x.text in ['Conservative','Realistic','Optimistic']:
  x.paragraph_format.space_before=Pt(7);x.paragraph_format.space_after=Pt(4)
  for r in x.runs:r.bold=True
 if x.text.startswith('Marketing budgets'):x.paragraph_format.space_before=Pt(6)
 if x.text.startswith('Operating results exclude'):
  x.text=x.text.replace('$10,275','$7,275');x.paragraph_format.space_before=Pt(6)
  for r in x.runs:r.font.size=Pt(9)
 if x.text.startswith('Curbside began in 2026.'):
  x.text='Curbside began in 2026. These consumer projections follow the sales funnel for launch year 2026 and calendar years 2027–2028. All cases are planning assumptions; the realistic case is not a validated forecast. The 2026 figures remain subject to actual results and launch timing.'
  for r in x.runs:r.font.size=Pt(10)
for t in d.tables[1:]:
 for row in t.rows:
  for c in row.cells:
   for edge in c._tc.xpath('.//w:tcMar/w:top | .//w:tcMar/w:bottom'):edge.set(qn('w:w'),'40')
   for x in c.paragraphs:
    x.paragraph_format.space_after=Pt(0);x.paragraph_format.space_before=Pt(0)
# Verify every financial column from the rendered data source.
for t in d.tables[1:]:
 for col in range(1,4):
  def n(row):
   s=t.cell(row,col).text.replace(',','');return -int(s[1:-1]) if s.startswith('(') else int(s)
  assert sum(n(row) for row in (2,3,4))==n(5)
  assert n(1)-n(5)==n(6)
d.save(p)
