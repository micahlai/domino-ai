from pathlib import Path
from xml.sax.saxutils import escape
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import letter
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, KeepTogether
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

ROOT=Path('/Users/micahlai/code/domino-ai')
OUT=ROOT/'output/pdf/domino-feature-status-overview.pdf'
FONT=Path('/Users/micahlai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/pdfjs-dist/standard_fonts')
for n,f in [('Body','LiberationSans-Regular.ttf'),('Bold','LiberationSans-Bold.ttf'),('Italic','LiberationSans-Italic.ttf')]:
    pdfmetrics.registerFont(TTFont(n,str(FONT/f)))
pdfmetrics.registerFontFamily('Body', normal='Body', bold='Bold', italic='Italic', boldItalic='Bold')
INK=colors.HexColor('#242D2A'); MUTED=colors.HexColor('#59635D'); GREEN=colors.HexColor('#176447'); MINT=colors.HexColor('#E7F4EA'); CREAM=colors.HexColor('#FAF9F4'); LINE=colors.HexColor('#DFE4DC'); AMBER=colors.HexColor('#8C5710'); RED=colors.HexColor('#9A3D42')
W,H=letter
styles={
 'title':ParagraphStyle('title',fontName='Bold',fontSize=34,leading=37,textColor=INK,spaceAfter=13),
 'h1':ParagraphStyle('h1',fontName='Bold',fontSize=23,leading=27,textColor=INK,spaceAfter=10),
 'h2':ParagraphStyle('h2',fontName='Bold',fontSize=13,leading=17,textColor=INK,spaceBefore=11,spaceAfter=5),
 'body':ParagraphStyle('body',fontName='Body',fontSize=10,leading=14.3,textColor=INK,spaceAfter=8),
 'small':ParagraphStyle('small',fontName='Body',fontSize=8.5,leading=11.8,textColor=MUTED,spaceAfter=5),
 'cell':ParagraphStyle('cell',fontName='Body',fontSize=8.5,leading=11.0,textColor=INK),
 'label':ParagraphStyle('label',fontName='Bold',fontSize=8.7,leading=11.5,textColor=INK),
 'status':ParagraphStyle('status',fontName='Bold',fontSize=8,leading=10,textColor=INK),
 'head':ParagraphStyle('head',fontName='Bold',fontSize=8,leading=10,textColor=colors.white),
 'eyebrow':ParagraphStyle('eyebrow',fontName='Bold',fontSize=9,leading=12,textColor=GREEN,spaceAfter=14),
}
story=[]
def p(text,style='body'): return Paragraph(text,styles[style])
def add(text,style='body'): story.append(p(text,style))
def title(kicker,name,intro):
    add(kicker.upper(),'eyebrow');add(name,'h1');add(intro,'body');story.append(Spacer(1,6))
def page(): story.append(PageBreak())
def callout(head,text):
    t=Table([[p(head,'h2')],[p(text,'body')]],colWidths=[524])
    t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),MINT),('BOX',(0,0),(-1,-1),0.5,LINE),('LEFTPADDING',(0,0),(-1,-1),13),('RIGHTPADDING',(0,0),(-1,-1),13),('TOPPADDING',(0,0),(-1,0),0),('BOTTOMPADDING',(0,-1),(-1,-1),7)]))
    story.append(t);story.append(Spacer(1,10))
status_colors={'Complete':GREEN,'Partial':AMBER,'Not built':RED,'Optional':MUTED}
def matrix(rows,widths=(125,62,337)):
    data=[[p('FEATURE / SCOPE','head'),p('STATUS','head'),p('WHAT EXISTS / WHAT REMAINS','head')]]
    for name,status,detail in rows:
        stat=f'<font color="{status_colors[status].hexval()}">{status}</font>'
        data.append([p(name,'label'),p(stat,'status'),p(detail,'cell')])
    t=Table(data,colWidths=widths,repeatRows=1,hAlign='LEFT')
    cmds=[('BACKGROUND',(0,0),(-1,0),INK),('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),8),('RIGHTPADDING',(0,0),(-1,-1),8),('TOPPADDING',(0,0),(-1,-1),4),('BOTTOMPADDING',(0,0),(-1,-1),4)]
    for i in range(1,len(data)):
        cmds.extend([('BACKGROUND',(0,i),(-1,i),colors.white if i%2 else CREAM),('LINEBELOW',(0,i),(-1,i),0.35,LINE)])
    t.setStyle(TableStyle(cmds));story.append(t)
def bullets(items):
    for lead,body in items:
        add(f'<b>{lead}</b> {body}')

# PAGE 1
add('DOMINO / PRODUCT DELIVERY SNAPSHOT','eyebrow')
add('Feature &amp; project\nstatus overview'.replace('\n','<br/>'),'title')
add('As of October 24, 2026 (Pacific time)','body')
add('Main: <b>694ab2a</b> | origin/main fetched and matched | Includes current local runtime setup','small')
callout('The computed prototype is working.', 'Domino can display a 13-week cash forecast, compare named scenarios, show their consequences, simulate saved fixes, and record a person\'s decision. The complete connect-to-next-week workflow is still unfinished.')
add('What is usable today','h2')
bullets([
 ('Cash workspace.', 'A live Convex-backed Kestrel company with an interactive timeline, ranked risks, evidence drawers, fix previews and confirmed approvals.'),
 ('Calculation engine.', 'Forecasting, risk scanning, domino chains, fix scoring, stress tests, historical views, grading and conservative learning are implemented as tested library functions.'),
 ('AI adapters.', 'CREAO and Claude transports, output validation, bounded retries and fallback are implemented. Project handoffs record direct live passes for all five default jobs; the app has not wired them into its scheduled AI actions.')])
add('What prevents a complete product flow','h2')
add('Source ingestion and bank reconciliation are missing. Simulator week advancement is unmerged and under repair. The Next week action and scheduled AI actions are placeholders. Connect, learning, decision-record and branch-detail pages still show previews.')
legend=Table([[p('Complete','label'),p('The named scope is implemented in main. A completed library is not automatically a completed app flow.','cell')],[p('Partial','label'),p('Some behavior exists, but integration, coverage or verification remains.','cell')],[p('Not built','label'),p('Absent, a placeholder, or work only in an unmerged branch.','cell')],[p('Optional','label'),p('A stretch feature outside the core completion path.','cell')]],colWidths=[80,444])
legend.setStyle(TableStyle([('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),8),('TOPPADDING',(0,0),(-1,-1),4),('BOTTOMPADDING',(0,0),(-1,-1),4),('LINEABOVE',(0,0),(-1,0),0.6,LINE)]));story.append(legend)
add('Reading guide: screens and experience (p2), engine (p3), data and simulation (p4), AI and backend (p5), remaining delivery work (p6), evidence and status docs (p7).','small')

# PAGE 2
page();title('01 / Product experience','Screens &amp; interactions','Three of the seven planned routes have their main intended surface implemented. Four routes still render the shared preview shell. [S4, S5]')
matrix([
 ('Landing page /','Complete','Product introduction and a Connect a company entry point are implemented. The linked onboarding flow remains a preview. [S5]'),
 ('Cash workspace /c/[id]','Complete','Live company, history, reports, risks, branches and fix queries drive the main screen. Includes loading, missing-data and connection states. [S5, S7]'),
 ('Playground /playground','Complete','Fixture-based component previews and the assembled workspace are available for design and interaction checks. [S4, S5]'),
 ('Connect /connect','Partial','Route and reusable source-checklist component exist. The page is a preview; no functioning company onboarding or live source-progress flow. [S5, S8]'),
 ('Branch detail /branch/[id]','Partial','Route and chart components exist. Dedicated future-detail page is a preview; selected future details work in the main workspace. [S5]'),
 ('Learning /learning','Partial','Learning-chart and rule-card components exist. The route is a preview; no live accuracy trend or learned-rule feed. [S5, S9]'),
 ('Decision record /record','Partial','Approval storage, query and audit logs exist. The actual record page is a preview. [S5, S7]'),
 ('Risk and future selection','Complete','Choose a scenario or a combination of risks. Explicit identities link the correct future, chain and fixes; unavailable combinations have an empty state. [S5]'),
 ('Fix preview and simulation','Complete','Preview with/without-fix reports and simulate a saved candidate under a computed branch. Gains are calculated by the engine. Seed proposals are labelled synthetic. [S5, S7]'),
 ('Add an event','Partial','Computed companies can add a selected existing risk as a scenario. The dialog has no general editor for custom days, amounts, customers or arbitrary changes. [S5, S7]'),
 ('Approval confirmation','Complete','A person reviews and confirms a saved simulated fix. The decision updates its status and writes an audit entry; it executes no payment or external action. [S7]'),
 ('Next week control','Not built','Button is disabled. Backend capabilities return nextWeek=false and the scheduled advance action throws "not built". [S7]'),
])

# PAGE 3
page();title('02 / Forecasting and visual analysis','The calculation core','All nine public engine functions are implemented in main. Completion below describes the calculation scope; rolling source data and product learning still require integration. [S9]')
matrix([
 ('13-week cash forecast','Complete','Schedules invoice receipts, qualifying signed deals, bills, payroll and modelled recurring spend. Computes opening, closing, usable cash and the low point in integer cents. [S9]'),
 ('Scenario changes','Complete','Supports delayed/lost invoices, churn, cash added/removed, delayed bills, early-payment discounts and hiring shifts; ancestor changes apply in order. [S9]'),
 ('Restricted cash and rules','Complete','Usable cash excludes restricted funds. Lender minimum, runway and critical bill deadlines are checked with explicit evidence. [S9]'),
 ('Domino chains','Complete','Produces ordered consequences with dates and evidence. Causal links require supported cash effects; ambiguous attribution is omitted. [S9]'),
 ('Risk detection and ranking','Complete','Scans supported late-payment, non-renewal and spend-spike risks. Ranks using expected cash impact; covers single risks and combinations. News-driven failure needs the optional feed. [S9]'),
 ('Fix scoring and ranking','Complete','Recomputes forecasts and rule outcomes for candidates, including ancestor context. Ranks useful fixes using rule outcomes, cash gains and risk. [S9]'),
 ('Multiverse and resilience','Complete','Computes named scenario sets, outcomes, weighted score, with-fix comparisons and sensitivity/breaking-point results where supported. Score is not a survival probability. [S9]'),
 ('History and past events','Complete','Engine derives historical cash points and evidence-backed past events from supplied observations. The current computed seed has no recorded events to display. [S9]'),
 ('Forecast grading','Complete','Pure function measures completed weeks against observed bank data using an explicit origin and complete observation window. Missing evidence cannot become zero error. [S9]'),
 ('Conservative learning','Complete','Learns supported payment-delay and recurring-spend patterns only when replay on preserved origins strictly improves retrospective error. No end-to-end weekly loop yet. [S9, S13]'),
 ('Forward billing and settlements','Partial','C3 schemas are merged, but engine adoption is still assigned to E3c. Billing plans, pending payouts, write-offs and negotiated terms are not fully supported in main calculations. [S10, S13]'),
 ('Timeline and motion','Complete','Past/Today/future fan, rule markers, fix morphing, probability-weighted particles, pause/resume and reduced-motion support are implemented. [S4, S5]'),
 ('Exact cash inspection','Complete','Weekly date and cents readout follows the selected scenario. Pointer crosshairs, keyboard/touch week control and small-screen scrolling are implemented. [S4, S5]'),
])

# PAGE 4
page();title('03 / Data and simulation','Inputs are the main missing link','The running prototype uses explicitly synthetic saved inputs. No complete pipeline currently discovers tool data, validates every source and reconciles it to the bank. [S3, S8, S10]')
matrix([
 ('Shared contracts','Complete','Typed domain records, Zod boundary schemas, fixtures and C1/C2/C3 additions are merged. Consumers must adopt optional new fields before the simulator emits them. [S10]'),
 ('Kestrel company creation','Complete','Seeded generator creates synthetic customers, invoices, deals, expenses and 26 observed bank weeks. Repeated seeds are deterministic. [S11]'),
 ('Public-company calibration','Partial','SEC peer research and qualified accounting ratios are documented. Current synthetic assumptions are not a completed calibration or validated cash-accuracy result. [S11, S13]'),
 ('Rolling simulator advance','Not built','Main advanceWeek still throws. E1b worker implementation was blocked in review for cash, timing and horizon-coverage defects; repair is not integrated. [S11, S13]'),
 ('Planted errors and answer key','Not built','Some scenario seeds exist, but main answerKey throws. Full planted-error generation, isolation checks and evaluation workflow remain incomplete. [S11, S12]'),
 ('Held-out Tally and Orbit','Not built','Main generator supports the Kestrel slice. Held-out companies and independent evaluation results remain E8 work. [S11, S12]'),
 ('Source-shaped mock APIs','Not built','Billing/Stripe, CRM, cards/Ramp, books, payroll and documents are planned. apps/mocks in main contains a README only; E2a worker output is not counted as integrated. [S8, S13]'),
 ('Nessie bank integration','Partial','A prior documented API probe verified sandbox access, backdated records and balance behavior. Durable bank seeding and the app connector remain unbuilt. No new live bank call for this report. [S8, S13]'),
 ('Seed/reset workflow','Partial','Computed Convex seed is idempotent. sim:print shows a summary, not a forecast/domino table. Full pnpm seed for all mock tools and isolated bank resources is unbuilt. [S7, S11]'),
 ('Source discovery and mapping','Partial','Mapping agent and canonical mapping types exist. Executable conversion rules, validated pull helpers and saved mapping adoption still need implementation. [S6, S8]'),
 ('Canonical pulls and tie-out','Not built','No working billing/bank/CRM/cards/books/payroll/document ingestion flow. Exact reconciliation, stale-data handling and source-ready gating remain planned. [S8]'),
 ('Private world and source hosting','Not built','Versioned simulator state and authenticated source HTTP exposure are planned for the backend. Private queues and answer keys must stay outside public snapshots. [S8]'),
])

# PAGE 5
page();title('04 / AI, persistence and control','Pieces exist; orchestration is partial','The provider library works independently. The current app computes with saved synthetic proposals, while scheduled proposal and explanation actions remain placeholders. [S3, S6, S7]')
matrix([
 ('CREAO and Claude adapters','Complete','Authenticated transports, prompt construction, validation, bounded polling/downloads and sanitized diagnostics are implemented. [S6]'),
 ('Job routing and fallback','Complete','Five jobs: map sources, read constraints, propose fixes, explain a branch and write a weekly brief. Defaults are configurable; CREAO retries can fall back to Claude with provider identity. [S6]'),
 ('Live provider validation','Partial','Latest project handoff records a direct passing run for each default job. CREAO brief formatting remains intermittent. These are historical smoke results, not fresh validation of today\'s local keys. [S3]'),
 ('Structured/text extraction','Complete','Strict schemas and bounded trusted JSON/text/Markdown artifact parsing reject malformed or conflicting responses. Live artifact recovery itself is not proven by the latest successful brief. [S6]'),
 ('AI fixes and explanations in app','Not built','Convex agents.proposeFixes and agents.explain still throw. Seeded proposals are demo instructions; provider-generated app results, persistence and cache orchestration remain to be wired. [S7]'),
 ('Weekly AI brief in app','Not built','Provider method exists, but no completed post-advance app workflow generates and presents a persisted brief. [S6, S8]'),
 ('Convex data layer','Complete','14 domain tables, indexes, validated payloads and live query/mutation APIs are implemented for the fixed-snapshot prototype. [S7]'),
 ('Computed publication','Complete','Recompute, add-event and simulate-fix actions run transactional engine mutations. Saved branch consistency and stale-parent guards protect current results. [S7]'),
 ('Approval storage and audit','Complete','Decision, branch status and audit entry are written atomically. Candidate, parent and company ownership must match the simulated changes. [S7]'),
 ('Identity and approval policy','Partial','Demo clicks are labelled "demo-user (unverified)". Sign-in, company access control, approver roles/separation and learning from rejection feedback are unfinished. [S7]'),
 ('Retained forecast generations','Not built','I4 is prepared, not integrated. Preserving older forecasts and decisions across new snapshot dates blocks reliable week advancement. [S8, S13]'),
 ('Weekly orchestration','Not built','Durable request/version handling, candidate worlds, bank posting ledger, new-source pull, grading, learning and atomic publication remain planned. [S8]'),
 ('Local development setup','Complete','Next runs on 3000, this checkout\'s Convex on 3220/3221, 25 environment settings loaded and computed company seeded. Capability query enables event/simulate only. [S14]'),
 ('Production release','Not built','A production build has passed in prior handoffs; this is not evidence of a production deployment. Hosting, production access and full-flow acceptance remain outstanding. [S3, S12]'),
])

# PAGE 6
page();title('05 / Remaining delivery work','What to complete next','Suggested order follows the dependency plans. Jayden owns engine/simulator/source work; Micah owns UI and Convex product surfaces. Shared contracts require joint review. [S1, S8, S13]')
bullets([
 ('1. Finish trustworthy forward data.', 'Repair and review E1b simulator cash/date rules and rolling obligations. Integrate E3c engine support for public billing plans, pending payouts and negotiated terms.'),
 ('2. Make source ingestion real.', 'Integrate E2a mocks, implement the deterministic mapping/pull layer, and add durable isolated Nessie seeding with exact bank reconciliation. Preserve uncertainty on failed writes.'),
 ('3. Preserve history before advancing.', 'Implement I4 forecast generations, private world/version state, durable request identities and retry-safe posting ledgers. Old decisions must retain their exact evidence.'),
 ('4. Wire the complete weekly loop.', 'Replace connect/week/agent placeholders. Pull validated observations, grade authentic prior forecasts, learn conservatively, publish the new generation, and generate the optional brief. Enable Next week only after a successful full-flow test.'),
 ('5. Finish product screens.', 'Build functioning onboarding, branch-detail, learning and decision-record pages; extend Add event to editable custom scenarios; complete supported approval roles and company access control.'),
 ('6. Prove and package the demo.', 'Run held-out companies, populate the proof table, test with three people, reconcile the script with actual engine outputs, rehearse, record the video and complete submission materials.')])
add('Evidence still missing','h2')
t=Table([[p('MEASURE','head'),p('CURRENT EVIDENCE','head')]]+[[p(a,'label'),p(b,'cell')] for a,b in [
 ('Mapping / bank tie-out','Proof table is TBD; no complete ingestion run.'),
 ('1- and 4-week accuracy','TBD for Kestrel, Tally, Orbit and baseline.'),
 ('Improvement over 8 weeks','Pure learning tests exist; no published rolling evaluation.'),
 ('Early warnings / planted errors','Recall, warning lead time and false alarms remain TBD.'),
 ('Usability / submission','3-person result, video, run-share links and most checklist items remain open.')]],colWidths=[170,354],repeatRows=1)
t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),INK),('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),8),('RIGHTPADDING',(0,0),(-1,-1),8),('TOPPADDING',(0,0),(-1,-1),6),('BOTTOMPADDING',(0,0),(-1,-1),6),('LINEBELOW',(0,1),(-1,-1),0.4,LINE)]));story.append(t)
add('Optional stretch work','h2')
add('Apify customer-news signals and CRS test credit data are planned add-ons with no implemented main flow found. They are not prerequisites for the core fixed-snapshot prototype. [S12]')

# PAGE 7
page();title('06 / Evidence and project status docs','Where to look for current status','This report combines the fetched main snapshot with the existing local runtime setup. Code and reviewed integration notes take precedence over old board headlines or aspirational demo copy.')
refs=[
 ('S1','kb/status/board.md','Task ownership and milestones. Some broad E6/E7 labels lag the completed sub-slices.'),
 ('S2','kb/handoffs.md','Newest session results and local runtime handoff; read the latest entries first.'),
 ('S3','HANDOFF.md','Backend integration narrative and recorded direct provider checks through the 04:05 continuation.'),
 ('S4','kb/spec/build-spec.md; design-spec.md','Product scope, seven planned routes, components, timeline motion and weekly inspection behavior.'),
 ('S5','apps/web/app/ + components/','Actual route implementations, PageStub screens, company workspace and AddEventDialog.'),
 ('S6','packages/agents/src/','Provider implementations, routing, validation, strict extraction and tests.'),
 ('S7','apps/web/convex/','Persistence, computed actions, approvals, capability flags and unbuilt actions.'),
 ('S8','kb/spec/source-ingestion-plan.md; week-pipeline-plan.md','Planned source conversion, bank reconciliation, durable transitions and retained history. Also apps/mocks/README.md.'),
 ('S9','packages/engine/src/','All public engine implementations and focused tests; engine/index.ts confirms wiring.'),
 ('S10','packages/contracts/src/; kb/spec/forward-data-contract.md','Merged shared types and optional forward-data semantics.'),
 ('S11','packages/sim/src/; kb/tasks/E1a-kestrel.md','Main Kestrel generator, simulator placeholders and initial-slice scope.'),
 ('S12','kb/product/proof.md; submission.md; demo-script.md','Results still TBD, submission readiness, and intended demo narrative.'),
 ('S13','kb/tasks/ + kb/reviews/','E3c, E1b repair/review, E2a/E2b and I4 show work that is planned or unmerged.'),
 ('S14','kb/tasks/S0-local-runtime.md','Current ignored runtime setup. Report checks: company HTTP 200; addEvent/simulate=true, nextWeek=false.'),
]
data=[[p('REF','head'),p('DOCUMENT / LOCATION','head'),p('HOW TO USE IT','head')]]
for a,b,c in refs: data.append([p(a,'label'),p(escape(b),'cell'),p(c,'cell')])
t=Table(data,colWidths=[34,222,268],repeatRows=1)
t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),INK),('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),6),('RIGHTPADDING',(0,0),(-1,-1),6),('TOPPADDING',(0,0),(-1,-1),4),('BOTTOMPADDING',(0,0),(-1,-1),4),('LINEBELOW',(0,1),(-1,-1),0.35,LINE)]));story.append(t)
add('Read old claims carefully','h2')
add('The original overview/demo script cites 7/11 to 9/11 and 64% to 93%; these are illustrative targets. The verified computed seed shows 0/11 passing before and after its labelled demo proposals. Learning improvements and source tie-out claims remain unmeasured.','small')
add('<b>Verification:</b> pnpm check passed during this report (five package typechecks, 647 tests represented by cached passing results, and lint). This report did not rerun external provider jobs, bank writes, branch workers or a production build. Existing passing checks do not establish unfinished full-flow behavior.','small')
add('Repository: <link href="https://github.com/micahlai/domino-ai/tree/694ab2a" color="#176447">github.com/micahlai/domino-ai at 694ab2a</link>. Existing uncommitted runtime/knowledge changes were preserved. No credentials are included.','small')


def decorate(c,doc):
    c.saveState();c.setFillColor(CREAM);c.rect(0,0,W,H,fill=1,stroke=0)
    # Page background must be beneath story: this callback runs before flowables.
    c.setFillColor(GREEN);c.roundRect(44,H-27,10,10,2,fill=1,stroke=0)
    c.setFillColor(INK);c.setFont('Bold',8);c.drawString(61,H-25,'DOMINO')
    c.setFont('Body',7.4);c.setFillColor(MUTED);c.drawRightString(W-44,H-25,'FEATURE STATUS / OCT 24, 2026')
    c.setStrokeColor(LINE);c.line(44,36,W-44,36)
    c.setFont('Body',7.3);c.drawString(44,23,'Main 694ab2a + local runtime | Evidence-based project snapshot')
    c.drawRightString(W-44,23,f'{doc.page}');c.restoreState()

doc=SimpleDocTemplate(str(OUT),pagesize=letter,rightMargin=44,leftMargin=44,topMargin=52,bottomMargin=48,title='Domino - Feature and Project Status Overview',author='Domino project',subject='Completed, partial, missing and optional features as of October 24, 2026',pageCompression=1)
doc.build(story,onFirstPage=decorate,onLaterPages=decorate)
print(OUT)
