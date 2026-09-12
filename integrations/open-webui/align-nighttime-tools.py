"""Explicitly align nighttime preset tools with their daytime counterparts."""
import copy
import datetime
import json
import sqlite3
import sys
import urllib.parse
import urllib.request

PAIRS = [('bear-castle-ai', 'bear-castle-ai-nighttime'),
         ('bear-castle-ai-deep-thinking', 'bear-castle-ai-nighttime-deep-thinking')]
TOOL_FIELDS = ('defaultFeatureIds', 'toolIds', 'builtinTools', 'filterIds', 'actionIds', 'knowledge')

def align_tools(source, target, capabilities):
    if 'tools' not in capabilities:
        raise ValueError('Nighttime backend must be qualified for native tools first')
    result = copy.deepcopy(target)
    meta = result['meta']
    meta['capabilities'] = copy.deepcopy(source['meta']['capabilities'])
    meta['capabilities']['vision'] = 'vision' in capabilities
    for field in TOOL_FIELDS:
        if field in source['meta']:
            meta[field] = copy.deepcopy(source['meta'][field])
        else:
            meta.pop(field, None)
    return result

def main():
    from open_webui.utils.auth import create_token
    db = sqlite3.connect('file:/app/backend/data/webui.db?mode=ro', uri=True)
    uid = db.execute("select id from user where role='admin' order by created_at limit 1").fetchone()[0]
    token = create_token({'id': uid}, expires_delta=datetime.timedelta(minutes=10))
    def api(path, body=None):
        req = urllib.request.Request('http://127.0.0.1:8080' + path,
            data=None if body is None else json.dumps(body).encode(),
            headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'})
        with urllib.request.urlopen(req, timeout=90) as response:
            return json.load(response)
    def model(mid):
        return api('/api/v1/models/model?' + urllib.parse.urlencode({'id': mid}))
    mode = sys.argv[1]
    if mode == 'snapshot':
        if api('/api/tasks')['tasks']:
            raise RuntimeError('Open WebUI has active tasks; retry deployment after they finish')
        settings = api('/api/v1/configs/namespace/web.search')
        print(json.dumps({'models': [model(mid) for pair in PAIRS for mid in pair] + [model('qwen3.8-27b-abliterated-q6_k')],
            'config': {key: settings[key] for key in ['web.search.ddgs_backend','web.search.concurrent_requests']}}))
        return
    if mode == 'apply-search':
        api('/api/v1/configs/import', {'config': {'web.search.ddgs_backend':'duckduckgo,yandex,brave','web.search.concurrent_requests':1}})
        settings = api('/api/v1/configs/namespace/web.search')
        assert settings['web.search.ddgs_backend'] == 'duckduckgo,yandex,brave'
        assert settings['web.search.concurrent_requests'] == 1
        print('Verified deployed three-provider search fallback configuration')
        return
    with urllib.request.urlopen(urllib.request.Request('http://ai-router:11434/api/show',
            data=json.dumps({'model':'nighttime'}).encode(), headers={'Content-Type':'application/json'}), timeout=30) as response:
        info = json.load(response)
    capabilities = info['capabilities']
    if mode == 'apply':
        # Prepare every model before any writes, including backend qualification.
        proposed = [align_tools(model(day), model(night), capabilities) for day,night in PAIRS]
        for result in proposed:
            api('/api/v1/models/model/update', result)
            print('Aligned tools:', result['id'])
        base = model(info['model'])
        for key in ['builtin_tools','web_search','code_interpreter','terminal','image_generation']:
            base['meta']['capabilities'][key] = True
        base['meta']['capabilities']['vision'] = 'vision' in capabilities
        features = 'text, images, tools and reasoning' if 'vision' in capabilities else 'text, tools and reasoning'
        base['meta']['description'] = f'Nighttime; {features}; 32K context, one active request.'
        api('/api/v1/models/model/update', base)
        api('/api/v1/configs/import', {'config': {'web.search.ddgs_backend':'duckduckgo,yandex,brave','web.search.concurrent_requests':1}})
        api('/api/models?refresh=true')
    elif mode != 'verify':
        raise ValueError(mode)
    for day,night in PAIRS:
        source,target = model(day),model(night)
        expected = align_tools(source,target,capabilities)
        assert target['meta'] == expected['meta'], 'Tool parity failed: ' + night
        assert target['base_model_id'] == 'nighttime'
        print('Verified tool parity:', night)
    settings = api('/api/v1/configs/namespace/web.search')
    assert settings['web.search.ddgs_backend'] == 'duckduckgo,yandex,brave'
    assert settings['web.search.concurrent_requests'] == 1
    print('Verified search backend and concurrency settings')

if __name__ == '__main__':
    main()
