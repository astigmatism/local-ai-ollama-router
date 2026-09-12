"""Run inside Open WebUI. Keep auth/config secrets in process, never in output."""
import datetime,json,sqlite3,urllib.request,urllib.parse
from open_webui.utils.auth import create_token
DB='/app/backend/data/webui.db'
db=sqlite3.connect(DB);uid=db.execute("select id from user where role='admin' order by created_at limit 1").fetchone()[0]
token=create_token({'id':uid},expires_delta=datetime.timedelta(minutes=10))
with urllib.request.urlopen('http://ai-router:11434/v1/models',timeout=30) as response:
 labels={model['id']:model['x_ollama_router']['display_name'] for model in json.load(response)['data']}
def api(path,body=None):
 req=urllib.request.Request('http://127.0.0.1:8080'+path,data=None if body is None else json.dumps(body).encode(),headers={'Authorization':'Bearer '+token,'Content-Type':'application/json'})
 with urllib.request.urlopen(req,timeout=120) as r:return json.load(r)
config=api('/openai/config')
urls=config['OPENAI_API_BASE_URLS'];keep=[i for i,u in enumerate(urls) if u.rstrip('/')!='http://ai-router:11434/v1']
if len(keep)!=len(urls):
 config['OPENAI_API_BASE_URLS']=[urls[i] for i in keep]
 config['OPENAI_API_KEYS']=[config['OPENAI_API_KEYS'][i] if i<len(config['OPENAI_API_KEYS']) else '' for i in keep]
 config['OPENAI_API_CONFIGS']={str(n):config['OPENAI_API_CONFIGS'][str(i)] for n,i in enumerate(keep) if str(i) in config['OPENAI_API_CONFIGS']}
 api('/openai/config/update',config)
 print('Removed duplicate router OpenAI connection; Ollama route retained.')
for id, in db.execute("select id from model where base_model_id='local-active'"):
 model=api('/api/v1/models/model?id='+urllib.parse.quote(id));model['base_model_id']='qwen3.8-27b-q8_0';api('/api/v1/models/model/update',model)
 print('Updated coding preset base:',id)
for model_id, vision, context in [('qwen3.8-27b-q8_0',True,131072),('qwen3.8-27b-abliterated-q6_k',False,32768)]:
 row=db.execute('select id from model where id=?',(model_id,)).fetchone()
 if row:
  model=api('/api/v1/models/model?id='+urllib.parse.quote(model_id))
 else:
  model={'id':model_id,'name':model_id,'params':{},'meta':{},'access_grants':api('/api/v1/models/model?id=bear-castle-ai').get('access_grants')}
 model['name']=labels[model_id]
 caps=model['meta'].get('capabilities') or {}
 caps.update(vision=vision,builtin_tools=vision,web_search=vision,code_interpreter=vision,terminal=vision,image_generation=vision)
 model['meta']['capabilities']=caps
 model['meta']['hidden']=False
 model['meta']['description']=('Coding Q8_0, text, images, tools and reasoning; 128K, one slot.' if vision else 'windowsxp811203 Qwen3.8-27B Abliterated Q6_K; text and reasoning only; 32K, one slot.')
 # Context is router-owned; Ollama options.num_ctx is deliberately rejected.
 model['params'].pop('num_ctx',None)
 api('/api/v1/models/model/update' if row else '/api/v1/models/create',model)
models=api('/api/models?refresh=true')['data']
for m in models:
 if m['id'] in ['qwen3.8-27b-q8_0','qwen3.8-27b-abliterated-q6_k']:
  print(json.dumps({'id':m['id'],'name':m['name'],'owner':m['owned_by'],'capabilities':m.get('ollama',{}).get('capabilities'),'ui_capabilities':m.get('info',{}).get('meta',{}).get('capabilities'),'context':m.get('ollama',{}).get('context_length')}))
