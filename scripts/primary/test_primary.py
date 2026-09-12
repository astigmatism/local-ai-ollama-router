import json
from pathlib import Path
import contextlib
import unittest
from unittest.mock import patch, MagicMock
import primary

def deployment(catalog):
    services = [{'role': role, 'model_alias': row['model'], 'container_name': name}
        for role, name, row in zip(['coding', 'everyday'], primary.NAMES, catalog['models'])]
    compose = {'services': {service['role']: {'networks': {'router': {'aliases':
        [row['backend_url'].split('//', 1)[1].split(':', 1)[0]]}}}
        for service, row in zip(services, catalog['models'])}}
    return {'engine': {'revision': 'verified'}, 'services': services}, compose

class DeploymentRecoveryTests(unittest.TestCase):
    def setUp(self):
        self.manifest = patch.object(primary.Path, 'read_bytes', return_value=b'test manifest')
        self.manifest.start()
        self.addCleanup(self.manifest.stop)

    def patches(self, **overrides):
        stack = contextlib.ExitStack()
        names = ['validate', 'drain', 'wait_idle', 'start_pair', 'publish_marker', 'rollback', 'install_entrypoints', 'write']
        mocks = {name: stack.enter_context(patch.object(primary, name, **overrides.get(name, {}))) for name in names}
        return stack, mocks

    def test_historical_deploy_rejected_before_any_side_effect(self):
        stack, mocks = self.patches()
        with stack, self.assertRaisesRegex(RuntimeError, 'retired'):
            primary.apply(deploy=True)
        for mock in mocks.values(): mock.assert_not_called()

    def test_historical_rollback_rejected_before_any_side_effect(self):
        with patch.object(primary, 'drain') as drain, patch.object(primary, 'docker') as docker, patch.object(primary, 'write') as write:
            with self.assertRaisesRegex(RuntimeError, 'retired'):
                primary.rollback()
            for mock in [drain, docker, write]: mock.assert_not_called()

    def test_busy_router_never_stops_a_model(self):
        stack, mocks = self.patches(wait_idle={'side_effect': RuntimeError('busy')})
        record = {'manifest_sha256': primary.hashlib.sha256(b'test manifest').hexdigest()}
        with stack, patch.object(primary.Path, 'exists', return_value=True), patch.object(primary, 'read', return_value=record), patch.object(primary, 'runtime_identity', side_effect=RuntimeError('not ready')), self.assertRaisesRegex(RuntimeError, 'busy'):
            primary.apply()
        mocks['start_pair'].assert_not_called()
        mocks['rollback'].assert_not_called()
        self.assertEqual(mocks['drain'].call_args_list[-1].args, (False,))

    def test_healthy_apply_is_idempotent(self):
        stack, mocks = self.patches()
        record = {'schema_version': 3, 'selected_profile': 'primary', 'manifest_sha256': primary.hashlib.sha256(b'test manifest').hexdigest()}
        with stack, patch.object(primary.Path, 'exists', return_value=True), patch.object(primary, 'runtime_identity', return_value={}), patch.object(primary, 'read', return_value=record), patch.object(primary, 'admin', return_value={'active_model': {'profile': 'primary'}, 'runtime': {'draining': False}, 'backend': {'health': {'ok': True}}, 'models': [{'id': 'coding'}, {'id': 'everyday'}]}):
            primary.apply()
        mocks['drain'].assert_not_called()
        mocks['start_pair'].assert_not_called()

    def test_publish_uses_complete_durable_catalog(self):
        catalog = json.loads((Path(__file__).resolve().parents[2] / 'runtime/primary-model-catalog.json').read_text())
        state = {'active_model': {'profile': 'primary'}, 'models': [
            {'id': row['model'], 'x_ollama_router': {'health': {'available': True}, 'output_policy': 'unrestricted'}}
            for row in catalog['models']]}
        manifest, compose = deployment(catalog)
        def inspect(name):
            entry = catalog['models'][primary.NAMES.index(name)]
            return {'Id': 'fake', 'State': {'StartedAt': '2026-09-12T00:00:00Z'}, 'Config': {'Cmd': ['--alias', entry['model'], '--n-predict', '-1', '--reasoning-budget', '-1', '--reasoning-effort', 'default']}}
        def read(path):
            if path == primary.MANIFEST: return manifest
            if path == primary.ROOT / 'compose.json': return compose
            if path == primary.ROOT / 'model-catalog.json': return catalog
            raise AssertionError('Legacy rollback snapshot must not supply resident metadata')
        with patch.object(primary, 'inspect', side_effect=inspect), patch.object(primary, 'read', side_effect=read), patch.object(primary, 'write') as write, patch.object(primary, 'admin', return_value=state):
            primary.publish_marker()
        saved = write.call_args.args[1]
        self.assertEqual([m['model'] for m in saved['models']], [m['model'] for m in catalog['models']])
        self.assertEqual(saved['reasoning_policy'], saved['models'][0]['reasoning_policy'])
        self.assertTrue(all(m['backend_revision'] == 'verified' for m in saved['models']))

    def test_request_minus_one_cannot_hide_a_capped_launch(self):
        catalog_path = Path(__file__).resolve().parents[2] / 'runtime/primary-model-catalog.json'
        for limit in ['1024', '32768']:
            catalog = json.loads(catalog_path.read_text())
            manifest, compose = deployment(catalog)
            inspected = {'Id': 'fake', 'State': {'StartedAt': 'now'}, 'Config': {'Cmd': [
                '--alias', catalog['models'][0]['model'], '--n-predict', limit,
                '--reasoning-budget', '-1', '--reasoning-effort', 'default']}}
            def read(path):
                if path == primary.MANIFEST: return manifest
                if path == primary.ROOT / 'compose.json': return compose
                return catalog
            with patch.object(primary, 'inspect', return_value=inspected), patch.object(primary, 'read', side_effect=read), patch.object(primary, 'write') as write, patch.object(primary, 'admin') as admin:
                with self.assertRaises(RuntimeError):
                    primary.publish_marker()
                write.assert_not_called()
                admin.assert_not_called()

    def test_failed_boot_does_not_restore_legacy_configuration(self):
        stack, mocks = self.patches(start_pair={'side_effect': RuntimeError('load failed')})
        record = {'manifest_sha256': primary.hashlib.sha256(b'test manifest').hexdigest()}
        with stack, patch.object(primary.Path, 'exists', return_value=True), patch.object(primary, 'read', return_value=record), patch.object(primary, 'runtime_identity', side_effect=RuntimeError('not ready')), self.assertRaises(RuntimeError):
            primary.apply()
        mocks['rollback'].assert_not_called()
        self.assertEqual(mocks['drain'].call_args_list[-1].args, (True,))

if __name__ == '__main__':
    unittest.main()
