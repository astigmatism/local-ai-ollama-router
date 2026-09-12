import importlib.util
import time
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch

adapter = Path('/app/backend/open_webui/retrieval/web/duckduckgo.py')
if not adapter.exists():
    adapter = Path(__file__).with_name('search_duckduckgo.py')
spec = importlib.util.spec_from_file_location('tested_ddgs_adapter', adapter)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

class FakeDDGS:
    threads = None
    active = 0
    maximum_active = 0
    starts = []
    observed_threads = []
    fail = False
    def __init__(self, **kwargs): pass
    def __enter__(self): return self
    def __exit__(self, *args): pass
    def text(self, query, **kwargs):
        cls = type(self)
        cls.active += 1
        cls.maximum_active = max(cls.maximum_active, cls.active)
        cls.starts.append(time.monotonic())
        cls.observed_threads.append(cls.threads)
        try:
            time.sleep(0.02)
            if cls.fail: raise RuntimeError('provider failure')
            return [{'href': 'https://example.com', 'title': query, 'body': 'test'}]
        finally: cls.active -= 1

m._min_request_interval = 0.08
with patch.object(m, 'DDGS', FakeDDGS):
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(lambda i: m.search_duckduckgo(str(i), 3, concurrent_requests=1), range(4)))
    assert FakeDDGS.maximum_active == 1, FakeDDGS.maximum_active
    assert all(b-a >= 0.075 for a,b in zip(FakeDDGS.starts, FakeDDGS.starts[1:])), FakeDDGS.starts
    assert FakeDDGS.observed_threads == [1]*4
    assert FakeDDGS.threads is None
    assert [r[0].title for r in results] == ['0','1','2','3']
    FakeDDGS.fail = True
    try: m.search_duckduckgo('failure', 3, concurrent_requests=1)
    except RuntimeError: pass
    else: raise AssertionError('provider failure was swallowed')
    assert FakeDDGS.threads is None
    FakeDDGS.fail = False
    assert m.search_duckduckgo('recovery', 3)[0].title == 'recovery'
print('PASS: concurrent searches serialize, start spacing is enforced, DDGS class limit is applied/restored, and failures release the lock.')

# Verify the installed DDGS fallback path with a failed primary, without network.
from ddgs.ddgs import DDGS as RealDDGS
from ddgs.results import TextResult
calls=[]
class Engine:
    def __init__(self,name,fail):self.name=name;self.provider=name;self.fail=fail
    def search(self,query,**kwargs):
        calls.append(self.name)
        if self.fail:raise RuntimeError('synthetic HTTP 429')
        return [TextResult(href='https://example.com/fallback',title='Fallback result',body='Fallback result')]
with patch.object(RealDDGS,'_get_engines',return_value=[Engine('primary',True),Engine('fallback',False)]):
    result=m.search_duckduckgo('Fallback result',1,concurrent_requests=1,backend='duckduckgo,brave')
assert calls == ['primary','fallback'],calls
assert result[0].link == 'https://example.com/fallback'
assert RealDDGS.threads is None
print('PASS: provider failure reaches the fallback sequentially with the installed DDGS library.')
