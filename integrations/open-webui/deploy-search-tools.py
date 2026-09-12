"""Deploy published search overlay and explicitly reconcile nighttime tools."""
import datetime
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import time
import urllib.request

SOURCE=Path(__file__).resolve().parents[2]
ROOT=Path('/home/astigmatism/apps/open-webui')
BASE='local/open-webui:0.11.3-router-unrestricted-v1'

def run(args, **kwargs):
    return subprocess.check_output(args,text=True,**kwargs).strip()

def main():
    revision=run(['git','rev-parse','HEAD'],cwd=SOURCE)
    if run(['git','status','--porcelain','--untracked-files=normal'],cwd=SOURCE):
        raise RuntimeError('Deploy only from a clean published source checkout')
    image=os.environ['OPENWEBUI_PUBLICATION_IMAGE']
    info=json.loads(run(['docker','image','inspect',image]))[0]
    if (info['Config'].get('Labels') or {}).get('org.opencontainers.image.revision') != revision:
        raise RuntimeError('Open WebUI image revision differs from source checkout')
    integration=SOURCE/'integrations/open-webui'
    def operation(mode):
        return run(['docker','exec','-i','open-webui','python','-',mode],input=(integration/'align-nighttime-tools.py').read_text())
    snapshot=operation('snapshot')
    before=json.loads(snapshot.splitlines()[-1])
    compose=ROOT/'compose.yml'
    original=compose.read_text()
    old=re.search(r'^\s+image:\s*(\S+)\s*$',original,re.M).group(1)
    if old != BASE and not old.startswith('local/open-webui:search-tools-git-'):
        raise RuntimeError('Unexpected installed image: '+old)
    backup=ROOT/'backups'/('search-tools-release-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
    backup.mkdir(mode=0o700,parents=True)
    shutil.copy2(compose,backup/'compose.yml')
    (backup/'before.json').write_text(json.dumps(before,indent=2)+'\n')
    (backup/'before.json').chmod(0o600)
    updated=re.sub(r'^(\s+image:)\s*\S+\s*$',lambda m:m[1]+' '+image,original,count=1,flags=re.M)
    updated=re.sub(r'^\s*# Rollback value retained from 2026-09-05: DDGS_BACKEND=duckduckgo\n','\n',updated,flags=re.M)
    variables={'DDGS_BACKEND':'duckduckgo,brave','WEB_SEARCH_CONCURRENT_REQUESTS':'1','DDGS_MIN_REQUEST_INTERVAL':'2.0'}
    for key,value in variables.items():
        pattern=r'^(      '+key+r':).*$'
        if re.search(pattern,updated,re.M):
            updated=re.sub(pattern,lambda m:m[1]+' "'+value+'"',updated,flags=re.M)
        else:
            updated=updated.replace('    environment:\n','    environment:\n      '+key+': "'+value+'"\n',1)
    temporary=compose.with_suffix('.release-new.yml')
    temporary.write_text(updated);temporary.chmod(compose.stat().st_mode & 0o777)
    subprocess.run(['docker','compose','-f',str(temporary),'config','--quiet'],cwd=ROOT,check=True)
    os.replace(temporary,compose)
    subprocess.run(['docker','compose','up','-d','--no-deps','--pull','never','open-webui'],cwd=ROOT,check=True)
    deadline=time.monotonic()+120
    while True:
        try:
            with urllib.request.urlopen('http://127.0.0.1:3000/health',timeout=3) as r:
                if r.status==200:break
        except Exception:pass
        if time.monotonic()>deadline:raise RuntimeError('Open WebUI readiness failed; backup at '+str(backup))
        time.sleep(1)
    print(operation('apply'))
    after=operation('snapshot')
    snapshot_after=json.loads(after.splitlines()[-1])
    prior={m['id']:m for m in before['models']}
    for model in snapshot_after['models']:
        old_model=prior[model['id']]
        for key in ['params','base_model_id','name','is_active']:
            assert model[key] == old_model[key], 'Unexpected change: '+model['id']+' '+key
        assert model['meta'].get('profile_image_url') == old_model['meta'].get('profile_image_url')
        normalize=lambda grants:sorted((g['principal_type'],g['principal_id'],g['permission']) for g in grants)
        assert normalize(model.get('access_grants',[])) == normalize(old_model.get('access_grants',[]))
    receipt={'source_revision':revision,'image':image,'image_id':info['Id'],'backup':str(backup),'deployed_at':datetime.datetime.now(datetime.timezone.utc).isoformat()}
    (backup/'deployment.json').write_text(json.dumps(receipt,indent=2)+'\n')
    print(json.dumps(receipt))

if __name__=='__main__':main()
