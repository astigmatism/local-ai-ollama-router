"""Explicit Open WebUI alignment; keep auth/config secrets in process."""
import copy
import datetime
import json
import sqlite3
import urllib.parse
import urllib.request


def stable_base_ids(models):
    """Build migration targets from discovered service metadata, never model names."""
    routes = {}
    for service in ['daytime', 'nighttime']:
        rows = [row for row in models if row.get('model') == service]
        if len(rows) != 1:
            raise ValueError('Expected one native service identifier: ' + service)
        meta = rows[0]['x_ollama_router']
        target = meta['upstream_model']
        if not meta.get('complete') or meta.get('warnings') or service not in meta.get('aliases', []):
            raise ValueError('Incomplete stable service discovery: ' + service)
        for identifier in [target, *meta['aliases']]:
            if identifier in routes and routes[identifier] != service:
                raise ValueError('Ambiguous stable service identifier: ' + identifier)
            routes[identifier] = service
    return routes


def rebase_preset(preset, routes):
    result = copy.deepcopy(preset)
    base = result.get('base_model_id')
    if base in routes:
        result['base_model_id'] = routes[base]
    return result


def main():
    from open_webui.utils.auth import create_token
    db = sqlite3.connect('/app/backend/data/webui.db')
    uid = db.execute("select id from user where role='admin' order by created_at limit 1").fetchone()[0]
    token = create_token({'id': uid}, expires_delta=datetime.timedelta(minutes=10))
    with urllib.request.urlopen('http://ai-router:11434/api/tags', timeout=30) as response:
        models = json.load(response)['models']
    routes = stable_base_ids(models)

    def api(path, body=None):
        req = urllib.request.Request('http://127.0.0.1:8080' + path,
            data=None if body is None else json.dumps(body).encode(),
            headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'})
        with urllib.request.urlopen(req, timeout=120) as response:
            return json.load(response)

    config = api('/openai/config')
    urls = config['OPENAI_API_BASE_URLS']
    keep = [i for i, url in enumerate(urls) if url.rstrip('/') != 'http://ai-router:11434/v1']
    if len(keep) != len(urls):
        config['OPENAI_API_BASE_URLS'] = [urls[i] for i in keep]
        config['OPENAI_API_KEYS'] = [config['OPENAI_API_KEYS'][i] if i < len(config['OPENAI_API_KEYS']) else '' for i in keep]
        config['OPENAI_API_CONFIGS'] = {str(n): config['OPENAI_API_CONFIGS'][str(i)] for n, i in enumerate(keep) if str(i) in config['OPENAI_API_CONFIGS']}
        api('/openai/config/update', config)
        print('Removed duplicate router OpenAI connection; Ollama route retained.')
    for model_id, base in db.execute('select id, base_model_id from model').fetchall():
        if base in routes and base != routes[base]:
            preset = api('/api/v1/models/model?id=' + urllib.parse.quote(model_id))
            api('/api/v1/models/model/update', rebase_preset(preset, routes))
            print('Updated preset stable base:', model_id, routes[base])
    # Preserve canonical display overrides as well as the selectable service rows.
    for entry in models:
        model_id = entry['model']
        if model_id == 'local-active':
            continue
        metadata = entry['x_ollama_router']
        row = db.execute('select id from model where id=?', (model_id,)).fetchone()
        model = api('/api/v1/models/model?id=' + urllib.parse.quote(model_id)) if row else {
            'id': model_id, 'name': model_id, 'params': {}, 'meta': {},
            'access_grants': api('/api/v1/models/model?id=bear-castle-ai').get('access_grants')}
        model['name'] = metadata['display_name']
        vision = 'vision' in metadata['capabilities']
        tools = 'tools' in metadata['capabilities']
        caps = model['meta'].get('capabilities') or {}
        caps.update(vision=vision, builtin_tools=tools, web_search=tools, code_interpreter=tools, terminal=tools, image_generation=tools)
        model['meta']['capabilities'] = caps
        model['meta']['hidden'] = False
        model['meta']['description'] = f"{metadata['display_name']}; {metadata['context_window']} context, {metadata['active_request_limit']} active request; " + ', '.join(metadata['capabilities']) + '.'
        model['params'].pop('num_ctx', None)
        api('/api/v1/models/model/update' if row else '/api/v1/models/create', model)
    refreshed = api('/api/models?refresh=true')['data']
    for model in refreshed:
        if model['id'] in ['daytime', 'nighttime']:
            print(json.dumps({'id': model['id'], 'name': model['name'], 'owner': model['owned_by']}))


if __name__ == '__main__':
    main()
