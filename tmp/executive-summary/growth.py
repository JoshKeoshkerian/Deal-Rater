from docx import Document
from docx.shared import Pt,Inches,RGBColor
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
D=Document('tmp/executive-summary/before-growth.docx');p=D.paragraphs
edits={
4:'Founded in 2026, Curbside is building the buying platform for the private-party used-car market: one place to compare vehicles, negotiate, arrange inspections, and connect with financing and secure transaction services.',
5:'Our entry product is a Chrome extension that compares asking prices directly across Facebook Marketplace listings and combines price, risk, and negotiation guidance in an explained score out of 100. Facebook Marketplace is the starting point; our roadmap extends to Craigslist, OfferUp, and other vehicle-listing platforms.',
6:'Our ambition is to become the buyer’s companion across marketplaces and throughout the purchase. Consumer payments establish the first revenue stream; inspection and financing partnerships, credit-union integrations, and software licensing create paths to recurring business revenue.',
10:'Curbside turns scattered listing information into a shortlist, a negotiation position, and a clear next step. A paid shopping pass is designed for the concentrated period when buyers are comparing their options.',
12:'The working extension compares Facebook Marketplace asking prices, adjusting for characteristics such as mileage and trim, and saves evaluations for a shortlist. Planned support for additional marketplaces will let buyers compare opportunities across platforms. Asking prices are not completed sale prices, and evaluations do not replace inspections.',
13:'The next stage connects evaluations to inspection booking, financing, and secure transactions through providers. Credit unions and automotive platforms could embed Curbside’s tools in their own customer experience. Additional platform support and provider integrations are planned, subject to access rights and agreements.',
18:'Curbside’s U.S. consumer market model uses 38.5 million annual used-vehicle purchases, Cox Automotive’s September 2026 forecast, as a proxy for buying episodes. [2] At $42 average spend per paying episode, the long-term TAM is $1.617 billion annually. This includes eventual expansion beyond the initial private-party segment.',
19:'TAM, SAM, and SOM below measure consumer software revenue, not vehicle transaction value. SAM assumes 25% of buying episodes are digitally researched private-party purchases serviceable after platform expansion; this is a management sizing assumption. SOM targets 100,000 annual paying customers by 2029, about 1.04% of SAM. Partner and licensing revenue are additional opportunities outside these estimates.',
21:'Initial customers are active private-party shoppers, especially first-time buyers and households seeking value. A buyer comparing multiple vehicles can use Curbside to assess alternatives, prioritize inspections, and prepare an offer.',
22:'Expansion customers include shoppers on Craigslist, OfferUp, and other listing platforms, followed by credit unions and automotive businesses seeking embedded buying tools.',
24:'We will launch in the hottest U.S. used-car sales metro at rollout, selected by recent sales volume, turnover speed, and private-party listing density. We will screen 50 large metros, test acquisition in the top five, and concentrate the first launch in the strongest-performing market. The base-case rollout targets five metros in 2027, 15 in 2028, and 40 in 2029.',
25:'Local automotive creators, search advertising, buyer communities, and referrals will drive traffic to the website and Chrome Web Store. Launch content will demonstrate Marketplace comparisons; additional platform support will broaden reach. Conservative assumes slower conversion; realistic is our execution target; optimistic assumes stronger distribution. All are projections.',
26:'Values below follow 2027 / 2028 / 2029, the first three full commercial years after 2026 development. Activation means a first completed evaluation. Annual paying customers = unique qualified visitors × activation × paid conversion. The realistic case reaches 100,000 payers from four million visitors in 2029.',
27:'Marketing budgets cover advertising, creators, content, and referrals. Base-case spend per acquired payer is $20 / $16 / $15, blending paid and organic channels. Market expansion depends on demonstrated conversion and delivery costs; no existing partner distribution is assumed.',
29:'Proposed launch pricing: three free evaluations, a five-evaluation pack for $19.99, a 20-evaluation pack for $39.99, and a 30-day shopping pass with 50 evaluations for $59.99. A 20% / 50% / 30% purchase mix yields $41.99, rounded to $42 average spend per payer. Pricing replaces the lower test offer in this plan and will be validated at launch.',
30:'The long-term model adds service-provider referral revenue and recurring software subscriptions and licensing for credit unions and automotive platforms. These channels extend monetization beyond a single consumer shopping period; contract revenue is excluded until pilot terms are established.',
31:'Curbside has no revenue or funding to date and no significant operating costs. The $7,500 request funds initial validation. The 2027–2029 growth plan requires additional capital and revenue reinvestment as marketing, staffing, and platform coverage expand.',
34:'Curbside sells a coordinated buying workflow: listing comparisons, actionable questions, negotiation guidance, and a path to purchase services. The higher proposed price reflects that positioning; conversion tests will determine which packages buyers value.',
36:'Curbside’s advantage is the context it carries from listing discovery to purchase. Direct Marketplace comparisons provide the entry point; planned comparisons across platforms and purchase-service integrations would let a buyer keep the same shortlist and decision history throughout the process.',
37:'We intend to build compounding advantages through permitted buyer and inspection feedback, service integrations, and institutional distribution. These are development priorities, not established exclusive assets. Evaluation scores will remain independent of partner compensation.',
43:'Curbside seeks $7,500 to validate premium pricing, improve evaluation reliability, and establish its first launch-market and partner pilots.',
44:'Within 90 days, we aim to interview 50 buyers, test the paid packages, and screen 50 metros. Within six months, we aim to launch in the selected market and define one provider or institutional pilot. The realistic commercial targets are 5,000 payers in 2027, 25,000 in 2028, and 100,000 in 2029, with platform expansion supporting growth.',
45:'Initial funds: $2,500 for reliability and product improvements, $2,000 for market and pricing tests, $1,500 for partner-pilot development, and $1,500 for specialist advice and contingency. This 2026 validation budget precedes the full commercial projections and does not fund the entire expansion.',
47:'The 2027–2029 consumer projections follow the sales funnel and proposed pricing above. Revenue = annual paying customers × $42, with no assumed subscription renewal. The realistic case reaches $4.2 million annual revenue and $900,000 operating profit in 2029. These are execution targets, not actual results.',
48:'Variable costs assume $1 per activated shopper for evaluation delivery, including free use, plus $2 per payer for payment and refund costs. Fixed budgets cover staffing and contractors, hosting, administration, and platform development. All cost allowances require validation against usage and supplier quotes.',
52:'Operating results are before tax and financing costs; staffing allowances are included in fixed costs. Referral, licensing, and award income are excluded. In the realistic case, $10,000 of 2027 operating loss plus working capital must be financed beyond the initial pilot; cash needs depend on when spending and revenue occur.',
53:'Sources: [1] Internal calibration review, docs/calibration-pass-1.md. [2] Cox Automotive, September 2026 forecast: coxautoinc.com/wp-content/uploads/2026/09/Q3-2026-Cox-Automotive-Sales-Forecasts.pdf. [3] kbb.com/whats-my-car-worth/ [4] cargurus.com/research/car-valuation [5] carfax.com/vehicle-history-reports/ [7] CarScout, Chrome Web Store: chromewebstore.google.com/detail/andcdhiiobnhninfkfodhhghcjjkdaol. Market sizing, prices, funnels, and costs are Curbside planning assumptions. Sources reviewed September–October 2026.'
}
for i,t in edits.items():
 size=p[i].runs[0].font.size if p[i].runs else None
 p[i].text=t
 if size:p[i].runs[0].font.size=size
# Insert market sizing table, reusing the existing table design.
from copy import deepcopy
base=D.tables[1];new=deepcopy(base._tbl);p[18]._p.addnext(new)
from docx.table import Table
mt=Table(new,D._body)
while len(mt.rows)>4:mt._tbl.remove(mt.rows[-1]._tr)
market=[['Market','Annual episodes','Spend per payer','Revenue potential'],['TAM','38,500,000','$42','$1.617 billion'],['SAM','9,625,000','$42','$404.25 million'],['SOM in 2029','100,000','$42','$4.2 million']]
for row,values in zip(mt.rows,market):
 for c,v in zip(row.cells,values):
  c.paragraphs[0].runs[0].text=v
for col,w in zip(mt.columns,[1.3,1.8,1.6,2.2]):col.width=Inches(w)
for row in mt.rows:
 for c,w in zip(row.cells,[1.3,1.8,1.6,2.2]):c.width=Inches(w)
# Existing tables: market sizing, sales funnel, three financial cases.
cases=[('Conservative',[100000,500000,2000000],.20,.05,[20000,75000,240000],[30000,75000,200000]),('Realistic',[200000,1000000,4000000],.25,.10,[100000,400000,1500000],[60000,200000,600000]),('Optimistic',[320000,2400000,8000000],.25,.125,[150000,1125000,3750000],[100000,450000,1200000])]
vals=[]
for name,vis,act,conv,mkt,fixed in cases:
 active=[round(x*act) for x in vis];paid=[round(x*conv) for x in active];rev=[x*42 for x in paid];var=[a+2*b for a,b in zip(active,paid)];exp=[a+b+c for a,b,c in zip(mkt,fixed,var)];net=[a-b for a,b in zip(rev,exp)]
 vals.append(dict(name=name,vis=vis,act=act,conv=conv,active=active,paid=paid,mkt=mkt,fixed=fixed,rev=rev,var=var,exp=exp,net=net))
fmt=lambda x:f'{x:,.0f}'
short=lambda x:(f'{x/1000000:g}m' if x>=1000000 else f'{x/1000:g}k' if x>=1000 else str(x))
sales=D.tables[1]
for r,(label,key) in enumerate([('Qualified visitors','vis'),('Activation rate','act'),('Activated shoppers','active'),('Paid conversion','conv'),('Paying customers','paid'),('Marketing budget $','mkt')],1):
 sales.cell(r,0).paragraphs[0].runs[0].text=label
 for j,v in enumerate(vals,1):sales.cell(r,j).paragraphs[0].runs[0].text=f'{v[key]*100:g}%' if key in ('act','conv') else ' / '.join(short(n) for n in v[key])
for t,v in zip(D.tables[2:],vals):
 for c,year in zip(t.rows[0].cells[1:],['2027','2028','2029']):c.paragraphs[0].runs[0].text=year
 for row,key in zip(t.rows[1:],['rev','mkt','var','fixed','exp','net']):
  for c,n in zip(row.cells[1:],v[key]):c.paragraphs[0].runs[0].text=f'({fmt(-n)})' if n<0 else fmt(n)
 for i in range(3):assert v['rev'][i]-v['exp'][i]==v['net'][i]
# Let sections flow; reserve last page for financial tables.
for x in D.paragraphs:
 if x.text!='Financials ($ US)':x.paragraph_format.page_break_before=False
# Separate table from its explanation.
p[19].paragraph_format.space_before=Pt(7)
D.save('output/documents/Curbside_Executive_Summary.docx')
for v in vals:print(v)
