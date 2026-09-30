from docx import Document
from docx.shared import Inches,Pt,RGBColor
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_CELL_VERTICAL_ALIGNMENT
D=Document('tmp/executive-summary/before-scenarios.docx')
p=D.paragraphs
p[27].text='Three planning cases link marketing activity to annual consumer sales. Conservative assumes slower organic reach and weak conversion; realistic assumes steady educational content, campus outreach, and referrals; optimistic assumes stronger referrals and successful community distribution. These are testable assumptions, not measured conversion rates or guaranteed outcomes.'
p[28].text='Qualified visits are website or store visits from prospective buyers; activation means completing a first evaluation. Paying customers equal activated shoppers multiplied by paid conversion. Counts assume deduplicated shoppers within each year. Figures below are ordered 2026 / 2027 / 2028; 2026 is a launch-year total, not an annualized run rate.'
def para_after(anchor,text,size=None):
 x=D.add_paragraph(text)
 if size:
  for r in x.runs:r.font.size=Pt(size)
 anchor.addnext(x._p)
 return x._p

def table_after(anchor,rows,widths,size=10):
 t=D.add_table(rows=0,cols=len(widths));t.autofit=False
 for c,w in zip(t.columns,widths):c.width=Inches(w)
 for n,row in enumerate(rows):
  cells=t.add_row().cells
  for j,(c,txt) in enumerate(zip(cells,row)):
   c.width=Inches(widths[j]);c.text=str(txt);c.vertical_alignment=WD_CELL_VERTICAL_ALIGNMENT.CENTER
   pr=c._tc.get_or_add_tcPr();sh=OxmlElement('w:shd');sh.set(qn('w:fill'),'E8EEF3' if n==0 else ('F6F7F8' if n%2==0 else 'FFFFFF'));pr.append(sh)
   mar=OxmlElement('w:tcMar')
   for edge in ['top','left','bottom','right']:
    el=OxmlElement('w:'+edge);el.set(qn('w:w'),'70');el.set(qn('w:type'),'dxa');mar.append(el)
   pr.append(mar)
   for pp in c.paragraphs:
    pp.paragraph_format.space_after=Pt(1);pp.paragraph_format.space_before=Pt(1);pp.paragraph_format.line_spacing=1.0
    pp.alignment=WD_ALIGN_PARAGRAPH.LEFT if j==0 else WD_ALIGN_PARAGRAPH.CENTER
    for r in pp.runs:r.font.size=Pt(size);r.font.bold=n==0;r.font.color.rgb=RGBColor(0,0,0)
  trpr=t.rows[-1]._tr.get_or_add_trPr();trpr.append(OxmlElement('w:cantSplit'))
  if n==0:trpr.append(OxmlElement('w:tblHeader'))
 borders=OxmlElement('w:tblBorders')
 for edge in ['top','left','bottom','right','insideH','insideV']:
  e=OxmlElement('w:'+edge);e.set(qn('w:val'),'single');e.set(qn('w:sz'),'4');e.set(qn('w:color'),'D9D9D9');borders.append(e)
 t._tbl.tblPr.append(borders);anchor.addnext(t._tbl)
 return t._tbl
cases=[('Conservative',[20000,40000,80000],.10,.03,[300,600,1200],[1800,2400,3600]),('Realistic',[50000,100000,200000],.20,.05,[1500,3000,6000],[3600,4800,7200]),('Optimistic',[80000,200000,400000],.25,.08,[3000,8000,16000],[6000,12000,24000])]
fmt=lambda v:f'{v:,.0f}'
seq=lambda a:' / '.join(fmt(v) for v in a)
rows=[['Annual funnel','Conservative','Realistic','Optimistic']]
vals=[]
for name,vis,act,conv,mkt,fixed in cases:
 activated=[round(v*act) for v in vis];paid=[round(v*conv) for v in activated];rev=[v*12 for v in paid];variable=[round(a*.15+b*.75) for a,b in zip(activated,paid)];expense=[a+b+c for a,b,c in zip(mkt,fixed,variable)];net=[a-b for a,b in zip(rev,expense)]
 vals.append(dict(name=name,vis=vis,act=act,conv=conv,activated=activated,paid=paid,mkt=mkt,fixed=fixed,rev=rev,variable=variable,expense=expense,net=net))
for label,key in [('Qualified visits','vis'),('Activation rate','act'),('Activated shoppers','activated'),('Paid conversion','conv'),('Paying customers','paid'),('Marketing budget $','mkt')]:
 rows.append([label]+[f'{v[key]:.0%}' if key in ('act','conv') else seq(v[key]) for v in vals])
a=table_after(p[28]._p,rows,[1.5,1.8,1.8,1.8],9.5)
a=para_after(a,'Marketing budgets cover small content, outreach, and paid tests; founder outreach time is unpaid. The visits depend mainly on organic distribution, not purchased clicks. Review activation, conversion, and acquisition cost monthly before expanding spend. The optimistic case requires repeatable distribution before scaling.',11)
a=para_after(a,'In parallel, we will pursue inspection-provider and institutional pilots. No signed distribution agreements or partner-generated consumer traffic are assumed; business sales will be validated separately.',11)
p[32].text='Current revenue, monthly burn, and capital received: [confirm actual amounts and sources, or none]. The realistic case budgets $6,975, $11,550, and $20,700 in annual spending for 2026–2028. It produces operating results of negative $975, positive $450, and positive $3,300. These figures exclude founder compensation and institutional development; the detailed cases below show the impact of weaker or stronger consumer adoption.'
p[49].text='Proposed milestones include 20 buyer interviews and a 25-person pilot within 30 days; initial paid purchases and ten prospective partner interviews within 90 days; and a defined service-provider or institutional pilot within six months. Launch-year paying-customer targets are 60 conservative, 500 realistic, and 1,600 optimistic, subject to the remaining 2026 launch window.'
p[51].paragraph_format.page_break_before=True
p[52].text='Curbside began in 2026. The following consumer projections use the sales funnel above for launch year 2026 and calendar years 2027–2028. All figures are illustrative planning assumptions; the realistic case is a working base case, not a validated forecast. Replace 2026 assumptions with year-to-date actuals plus the remaining-period forecast before submission.'
for t in list(D.tables):
 if t.cell(0,0).text=='Financials ($ US)':t._element.getparent().remove(t._element)
a=p[52]._p
a=para_after(a,'Revenue equals annual paying customers × $12 average total spend per payer, with no assumed recurring retention. Variable costs allow $0.15 per activated shopper for evaluations and $0.75 per payer for payment costs. These allowances cover free use and must be tested against actual usage. Fixed costs cover basic hosting, software, administration, and limited support.',10)
for v in vals:
 a=para_after(a,v['name'],11)
 # keep caption with table
 from docx.text.paragraph import Paragraph
 Paragraph(a,D._body).paragraph_format.keep_with_next=True
 rows=[['Financials ($ US)','2026','2027','2028']]
 for label,key in [('Consumer revenue','rev'),('Marketing','mkt'),('Variable service costs','variable'),('Fixed operating costs','fixed'),('Total expenditures','expense'),('Operating result','net')]:
  rows.append([label]+[f'({fmt(-n)})' if n<0 else fmt(n) for n in v[key]])
 a=table_after(a,rows,[2.7,1.4,1.4,1.4],9.5)
a=para_after(a,'Operating results exclude founder salaries, taxes, financing, capital purchases, and institutional development. No award, referral, or licensing revenue is included. Positive results therefore do not establish full business profitability. The conservative case needs $10,275 to cover cumulative modeled losses through 2028, before contingency or excluded costs.',10)
D.save('output/documents/Curbside_Executive_Summary.docx')
for v in vals:print(v)
