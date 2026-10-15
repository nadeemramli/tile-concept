import json,subprocess,sys,uuid,os
from pathlib import Path
sys.stdout.reconfigure(encoding='utf-8',errors='replace')
workflow=json.loads(Path(__file__).with_name('tile-concept-progress.workflow.json').read_text())[0]
keep=[n for n in workflow['nodes'] if n['id'].startswith(('tc-delivery-','tc-pending-','tc-split-','tc-card-','tc-existing-','tc-send-','tc-edit-','tc-check-','tc-confirm-','tc-telegram-events','tc-save-telegram','tc-ack-provider','tc-is-','tc-answer-')) and n['id']!='tc-delivery-timer']
names={n['name'] for n in keep}
workflow['nodes']=keep
workflow['connections']={k:{'main':[[edge for edge in branch if edge['node'] in names] for branch in v['main']]} for k,v in workflow['connections'].items() if k in names}
for n in keep:
 if n['type']=='n8n-nodes-base.httpRequest': n['parameters']['url']='http://intake-relay:8681/telegram'
 if n['type']=='n8n-nodes-base.telegram': n['credentials']={'telegramApi':{'id':'tc-telegram-fixture','name':'Fixture bot - no real token'}}
workflow['nodes'].append({'id':'tc-delivery-test-entry','name':'Delivery fixture entry','type':'n8n-nodes-base.webhook','typeVersion':2,'position':[0,400],'parameters':{'httpMethod':'POST','path':'tile-routing-delivery-fixture','authentication':'headerAuth','responseMode':'onReceived','options':{}},'credentials':{'httpHeaderAuth':{'id':'tc-telegram-webhook-secret','name':'Fixture header authentication'}},'webhookId':'tc-routing-delivery-fixture'})
workflow['connections']['Delivery fixture entry']={'main':[[{'node':'Claim pending Telegram cards','type':'main','index':0}]]}
workflow['id']='tc-routing-native-contract';workflow['name']='Tile routing isolated native contract';workflow['active']=False
credentials=[{'id':'tc-telegram-fixture','name':'Fixture bot - no real token','type':'telegramApi','data':{'accessToken':'fixture-token','baseUrl':'http://intake-relay:8681'}},{'id':'tc-telegram-webhook-secret','name':'Fixture header authentication','type':'httpHeaderAuth','data':{'name':'X-Telegram-Bot-Api-Secret-Token','value':'fixture-webhook-secret'}}]
mock=r'''
const http=require('node:http'),fs=require('node:fs');
const root=process.argv[2];fs.writeFileSync(root+'/mock.pid',String(process.pid));
const receipts={pending:0,updates:0,sent:[],edited:[],confirmed:[],callbacks:[],links:[],errors:[]};
const cards=[{lead_id:'11111111-0000-0000-0000-000000000001',token:'70dac769-0688-4a32-8b8b-621bd71cf846',chat_id:'-700123',message_id:null,text:'Fixture <prospect> & test',reply_markup:{inline_keyboard:[[{text:'WhatsApp sent',callback_data:'tc:70dac769-0688-4a32-8b8b-621bd71cf846:sent'}],[{text:'Open Inquiry',url:'https://example.test/sales/inbox?lead=11111111-0000-0000-0000-000000000001'}]]}},
{lead_id:'11111111-0000-0000-0000-000000000002',token:'80dac769-0688-4a32-8b8b-621bd71cf846',chat_id:'-700123',message_id:777,text:'Existing card fixture',reply_markup:{inline_keyboard:[[{text:'Customer replied',callback_data:'tc:80dac769-0688-4a32-8b8b-621bd71cf846:reply'}]]}}];
cards.push({...cards[1],lead_id:'11111111-0000-0000-0000-000000000003',message_id:888,status:'disqualified',text:'Closed inquiry fixture'});
for(const c of cards){c.status=c.status||'new';c.lead_url='https://example.test/sales/inbox?lead='+c.lead_id;c.whatsapp_url=null;}
const server=http.createServer(async(req,res)=>{const chunks=[];for await(const c of req)chunks.push(c);const raw=Buffer.concat(chunks).toString();let b={};try{b=raw?JSON.parse(raw):{};}catch{}
const reply=(status,body)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(body));};
if(req.url==='/receipts')return reply(200,receipts);
if(req.url==='/telegram'){
 if(b.operation==='pending'){receipts.pending++;return reply(200,{ok:true,cards:receipts.pending===1?cards:[]});}
 if(b.operation==='sent'){receipts.confirmed.push(b);return reply(200,{ok:true});}
 if(b.operation==='update'){if(b.update.update_id===999)return reply(503,{ok:false,error:'fixture_unavailable'});receipts.updates++;return reply(200,{ok:true,result:b.update.callback_query?{kind:'callback',callback_query_id:'fixture-callback',text:'Saved in Inquiry Box.',show_alert:false}:{kind:'message',chat_id:'333',text:'Telegram linked.'}});}
}
if(req.url==='/botfixture-token/sendMessage'){
 if(String(b.chat_id)==='333'){receipts.links.push(b);return reply(200,{ok:true,result:{message_id:502,chat:{id:333}}});}
 receipts.sent.push(b);return reply(200,{ok:true,result:{message_id:501,chat:{id:-700123}}});
}
if(req.url==='/botfixture-token/editMessageText'){receipts.edited.push(b);return reply(400,{ok:false,error_code:400,description:'Bad Request: message is not modified'});}
if(req.url==='/botfixture-token/answerCallbackQuery'){receipts.callbacks.push(b);return reply(200,{ok:true,result:true});}
receipts.errors.push({path:req.url});reply(404,{ok:false});
});server.listen(8681,'0.0.0.0');
'''
source=r'''
import json,subprocess,time,uuid
c='tile-concept-automation-n8n-1';relay='tile-concept-automation-intake-relay-1';root='/tmp/tc-routing-contract-'+uuid.uuid4().hex[:10];runner='tc-routing-contract-runner-'+uuid.uuid4().hex[:8]
assert root.startswith('/tmp/tc-routing-contract-')
env=['DB_TYPE=sqlite','DB_SQLITE_DATABASE='+root+'/db.sqlite','N8N_USER_FOLDER='+root,'N8N_ENCRYPTION_KEY=fixture-only-no-real-access-key','N8N_PORT=5682','N8N_HOST=127.0.0.1','N8N_PROTOCOL=http','WEBHOOK_URL=http://127.0.0.1:5682/','N8N_RUNNERS_BROKER_PORT=5681','N8N_DIAGNOSTICS_ENABLED=false','N8N_VERSION_NOTIFICATIONS_ENABLED=false']
def run(args,timeout=110,check=True):
 r=subprocess.run(args,capture_output=True,text=True,timeout=timeout)
 if check and r.returncode: raise RuntimeError('Command failed: '+r.stdout[-800:]+' '+r.stderr[-500:])
 return r
def cli(*args):return run(['docker','exec',c,'env',*env,'n8n',*args])
def put(name,data,target=None):
 r=subprocess.run(['docker','exec','-i',target or c,'sh','-c','umask 077; cat > '+root+'/'+name],input=data,text=True,capture_output=True,check=True)
def request(path,body=None,secret=None):
 code="const o=JSON.parse(process.argv[1]);fetch(o.url,{method:o.body===null?'GET':'POST',headers:{'content-type':'application/json',...(o.secret?{'X-Telegram-Bot-Api-Secret-Token':o.secret}:{})},...(o.body===null?{}:{body:JSON.stringify(o.body)})}).then(async r=>console.log(JSON.stringify({status:r.status,text:await r.text()}))).catch(e=>{console.error(e.message);process.exit(1)})"
 r=run(['docker','exec',c,'node','-e',code,json.dumps({'url':'http://127.0.0.1:5682'+path if path!='/receipts' else 'http://intake-relay:8681/receipts','body':body,'secret':secret})],timeout=20)
 return json.loads(r.stdout)
try:
 run(['docker','exec',c,'mkdir','-m','700',root])
 run(['docker','exec',relay,'mkdir','-m','700',root])
 put('workflow.json',WORKFLOW);put('credentials.json',CREDENTIALS);put('mock.cjs',MOCK,relay)
 cli('import:credentials','--input='+root+'/credentials.json')
 assert run(['docker','exec',c,'test','-f',root+'/db.sqlite'],check=False).returncode==0,'Isolated SQLite database was not created'
 cli('import:workflow','--input='+root+'/workflow.json')
 cli('publish:workflow','--id=tc-routing-native-contract')
 run(['docker','exec','-d',relay,'sh','-c','node '+root+'/mock.cjs '+root+' > '+root+'/mock.log 2>&1'])
 run(['docker','exec','-d',c,'sh','-c','echo $$ > '+root+'/n8n.pid; exec env '+' '.join(env)+' n8n start > '+root+'/n8n.log 2>&1'])
 run(['docker','compose','--project-directory','/opt/tile-concept-automation','--env-file','/opt/tile-concept-automation/.env','run','-d','--no-deps','--name',runner,'-e','N8N_RUNNERS_TASK_BROKER_URI=http://n8n:5681','task-runners'])
 ready=False
 for _ in range(30):
  try:
   if request('/healthz/readiness')['status']==200:ready=True;break
  except Exception:pass
  time.sleep(1)
 if not ready:
  log=run(['docker','exec',c,'tail','-35',root+'/n8n.log']).stdout
  raise RuntimeError('Isolated n8n did not become ready: '+log)
 bad=request('/webhook/tile-concept-telegram-progress',{'update_id':1,'callback_query':{}},'wrong-secret');assert bad['status'] in (401,403),bad
 failed=request('/webhook/tile-concept-telegram-progress',{'update_id':999,'callback_query':{}},'fixture-webhook-secret');assert failed['status']==503,failed
 callback=request('/webhook/tile-concept-telegram-progress',{'update_id':2,'callback_query':{'id':'fixture-callback'}},'fixture-webhook-secret');assert callback['status']==200,callback
 receipts=None
 for _ in range(30):
  time.sleep(1);receipts=json.loads(request('/receipts')['text'])
  if len(receipts['confirmed'])==3 and len(receipts['callbacks'])==1:break
 assert len(receipts['sent'])==1,receipts
 assert receipts['sent'][0]['text']=='Fixture &lt;prospect&gt; &amp; test',receipts['sent']
 buttons=receipts['sent'][0]['reply_markup']['inline_keyboard'];assert buttons and buttons[0] and buttons[0][0].get('callback_data','').endswith(':sent'),receipts
 assert sorted(r['message_id'] for r in receipts['confirmed'])==[501,777,888],receipts
 closed=[r for r in receipts['edited'] if str(r.get('message_id'))=='888'];assert closed,receipts
 assert all('callback_data' not in b for r in closed for row in r['reply_markup']['inline_keyboard'] for b in row),receipts
 assert len(receipts['callbacks'])==1 and receipts['callbacks'][0]['text']=='Saved in Inquiry Box.',receipts
 assert not receipts['errors'],receipts
 link=request('/webhook/tile-concept-telegram-progress',{'update_id':3,'message':{'text':'/start tc_fixture'}},'fixture-webhook-secret');assert link['status']==200,link
 for _ in range(10):
  time.sleep(1);receipts=json.loads(request('/receipts')['text'])
  if len(receipts['links'])==1:break
 assert len(receipts['links'])==1,receipts
 print(json.dumps({'outcome':'passed','environment':'isolated SQLite n8n runtime with fixture bot and mock vendor; production database and bot unchanged','header_auth':'wrong secret denied; correct secret accepted','delivery':'new card sent once and individually confirmed','keyboard':'serialized opaque callback buttons correctly; closed leads have navigation only','html':'escaped','edit_recovery':'message-is-not-modified safely confirmed','persistence_failure':'503 requests provider retry','callback':'provider acknowledged after persistence and salesperson answered','linking':'private confirmation delivered','confirmed_message_ids':sorted(r['message_id'] for r in receipts['confirmed'])}))
finally:
 run(['docker','stop','-t','3',runner],check=False);run(['docker','rm',runner],check=False)
 for name,target in [('n8n.pid',c),('mock.pid',relay)]:
  r=run(['docker','exec',target,'cat',root+'/'+name],check=False)
  if r.returncode==0 and r.stdout.strip().isdigit():run(['docker','exec',target,'kill',r.stdout.strip()],check=False)
 run(['docker','exec',c,'rm','-rf',root],check=False)
 run(['docker','exec',relay,'rm','-rf',root],check=False)
'''
source='WORKFLOW='+repr(json.dumps([workflow]))+'\nCREDENTIALS='+repr(json.dumps(credentials))+'\nMOCK='+repr(mock)+'\n'+source
host=os.environ.get('TC_N8N_TEST_HOST');key=os.environ.get('TC_N8N_TEST_SSH_KEY')
if not host or not key: raise SystemExit('Set TC_N8N_TEST_HOST and TC_N8N_TEST_SSH_KEY explicitly for an authorized test host.')
ssh=(['wsl','-d','Ubuntu','--'] if os.name=='nt' else [])+['ssh','-o','BatchMode=yes','-o','ConnectTimeout=15','-o','StrictHostKeyChecking=yes','-i',key,host,'python3','-']
r=subprocess.run(ssh,input=source.encode(),capture_output=True,timeout=330)
output=r.stdout.decode('utf-8',errors='replace');print(output)
if r.returncode:print(r.stderr.decode('utf-8',errors='replace')[-4000:],file=sys.stderr)

sys.exit(r.returncode)
