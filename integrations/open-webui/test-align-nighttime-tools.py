import importlib.util
from pathlib import Path
import unittest
s=importlib.util.spec_from_file_location('alignment',Path(__file__).with_name('align-nighttime-tools.py'))
m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
class AlignmentTests(unittest.TestCase):
    def test_tool_parity_preserves_identity_access_and_parameters(self):
        source={'meta':{'capabilities':{'vision':True,'builtin_tools':True,'web_search':True,'terminal':True},'defaultFeatureIds':['web_search'],'builtinTools':{'memory':False},'toolIds':['test-tool']}}
        target={'id':'night','name':'Night','base_model_id':'nighttime','params':{'think':True,'reasoning_effort':'max'},'access_grants':[{'permission':'read'}],'meta':{'profile_image_url':'night-icon','capabilities':{'builtin_tools':False},'actionIds':['stale']}}
        result=m.align_tools(source,target,['completion','thinking','tools'])
        self.assertEqual(result['params'],target['params'])
        self.assertEqual(result['access_grants'],target['access_grants'])
        self.assertEqual(result['id'],target['id'])
        self.assertEqual(result['meta']['profile_image_url'],'night-icon')
        self.assertEqual(result['meta']['toolIds'],['test-tool'])
        self.assertEqual(result['meta']['builtinTools'],{'memory':False})
        self.assertNotIn('actionIds',result['meta'])
        self.assertTrue(result['meta']['capabilities']['builtin_tools'])
        self.assertFalse(result['meta']['capabilities']['vision'])
        self.assertFalse(target['meta']['capabilities']['builtin_tools'])
        self.assertTrue(source['meta']['capabilities']['vision'])
    def test_unqualified_backend_cannot_enable_tools(self):
        with self.assertRaises(ValueError):m.align_tools({}, {}, ['completion'])
if __name__=='__main__':unittest.main()
