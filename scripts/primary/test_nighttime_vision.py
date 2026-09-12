"""Check the inference migration's preservation and artifact pairing boundaries."""
import copy
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('vision', Path(__file__).with_name('deploy-nighttime-vision.py'))
v = importlib.util.module_from_spec(spec)
spec.loader.exec_module(v)


class VisionMigrationTests(unittest.TestCase):
    def fixture(self):
        command = ['--model', '/weights/main.gguf', '--alias', v.MODEL, '--ctx-size', '32768',
                   '--n-predict', '-1', '--reasoning-budget', '-1', '--reasoning-effort', 'default']
        service = {'role': 'everyday', 'model_alias': v.MODEL, 'recommended_argv': copy.deepcopy(command),
                   'recommended_model': {'revision': v.REVISION},
                   'container_contract': {'read_only_mounts': [{'source': '/main.gguf', 'target': '/weights/main.gguf'}]},
                   'qualification_contract': {'runtime': 'previous', 'context': 'keep'},
                   'fallback': {'command': ['--n-predict', '-1']}}
        manifest = {'models': [{'persistent_path': '/main.gguf'}], 'services': [{'role': 'coding'}, service],
                    'engine': {'revision': 'pinned'}, 'production_output_policy': 'unrestricted'}
        compose = {'services': {'coding': {'image': 'day'}, 'everyday': {'container_name': 'qwen38-nighttime',
            'command': command, 'volumes': [{'source': '/main.gguf', 'target': '/weights/main.gguf', 'read_only': True}],
            'deploy': {'device_ids': ['night-gpu-1','night-gpu-2']}, 'image': 'pinned-engine'}},
            'networks': {'router': {'external': True}}}
        return manifest, compose

    def test_only_cpu_projector_changes_runtime(self):
        original_m, original_c = self.fixture()
        saved = copy.deepcopy((original_m, original_c))
        manifest, compose = v.proposal(original_m, original_c)
        self.assertEqual((original_m, original_c), saved)
        before, after = original_c['services']['everyday'], compose['services']['everyday']
        self.assertEqual(after['command'][:-len(v.PROJECTOR_ARGS)], before['command'])
        self.assertEqual(after['volumes'][:-1], before['volumes'])
        self.assertEqual({k:x for k,x in after.items() if k not in ['command','volumes']},
                         {k:x for k,x in before.items() if k not in ['command','volumes']})
        self.assertEqual(compose['services']['coding'], original_c['services']['coding'])
        self.assertEqual(manifest['services'][0], original_m['services'][0])
        self.assertEqual(manifest['services'][1]['fallback'], original_m['services'][1]['fallback'])
        self.assertEqual(manifest['engine'], original_m['engine'])
        self.assertEqual(manifest['production_output_policy'], 'unrestricted')
        self.assertEqual(manifest['models'][-1]['sha256'], v.ARTIFACT['sha256'])
        self.assertTrue(after['volumes'][-1]['read_only'])
        self.assertFalse(after['volumes'][-1]['bind']['create_host_path'])

    def test_refuses_changed_model_revision_or_unreviewed_arguments(self):
        for change in ['revision', 'arguments', 'already-loaded']:
            manifest, compose = self.fixture()
            if change == 'revision':
                manifest['services'][1]['recommended_model']['revision'] = 'different'
            elif change == 'arguments':
                compose['services']['everyday']['command'].extend(['--n-predict', '100'])
            else:
                compose['services']['everyday']['command'].extend(v.PROJECTOR_ARGS)
                manifest['services'][1]['recommended_argv'].extend(v.PROJECTOR_ARGS)
            with self.assertRaises(ValueError):
                v.proposal(manifest, compose)

    def test_image_scoring_accepts_equivalent_json_but_preserves_order_and_content(self):
        expected = ['red triangle', 'green square', 'blue circle']
        self.assertEqual(v.recognized_shapes('["red triangle", "green square", "blue circle"]'), expected)
        self.assertEqual(v.recognized_shapes('[{"red":"triangle"}, {"green":"square"}, {"blue":"circle"}]'), expected)
        self.assertNotEqual(v.recognized_shapes('["green square", "red triangle", "blue circle"]'), expected)
        self.assertNotEqual(v.recognized_shapes('["red circle", "green square", "blue triangle"]'), expected)
        with self.assertRaises(ValueError):
            v.recognized_shapes('["red triangle"]')


if __name__ == '__main__':
    unittest.main()
