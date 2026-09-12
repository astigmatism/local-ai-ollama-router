"""Router-owned Open WebUI overlay; preserve the installed base, data and secrets."""
from pathlib import Path
import datetime
import shutil
import subprocess
root=Path('/home/astigmatism/apps/open-webui')
compose=root/'compose.yml'
text=compose.read_text()
old='local/open-webui:0.11.3-folder-scoped-knowledge-v1';new='local/open-webui:0.11.3-router-unrestricted-v1'
assert old in text or new in text, 'Unexpected image: review before deployment'
backup=root/'backups'/('router-policy-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
backup.mkdir(mode=0o700)
shutil.copy2(compose,backup/'compose.yml')
text=text.replace(old,new)
if 'CHAT_RESPONSE_MAX_TOOL_CALL_ITERATIONS:' not in text:
    text=text.replace('      OLLAMA_BASE_URL:', '      CHAT_RESPONSE_MAX_TOOL_CALL_ITERATIONS: "-1"\n      OLLAMA_BASE_URL:')
compose.write_text(text)
subprocess.run(['docker','compose','up','-d','--no-deps','--pull','never','open-webui'],cwd=root,check=True)
print('Open WebUI overlay deployed; existing data and folder-scoped knowledge image preserved')
