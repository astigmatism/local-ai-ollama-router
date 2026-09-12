import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('align', Path(__file__).with_name('align-primary.py'))
align = importlib.util.module_from_spec(spec)
spec.loader.exec_module(align)


def catalog(day='current-day-model', night='current-night-model'):
    return [{'model': service, 'x_ollama_router': {'complete': True, 'warnings': [],
        'upstream_model': target, 'aliases': aliases}}
        for service, target, aliases in [('daytime', day, ['local-active', 'daytime']), ('nighttime', night, ['nighttime'])]]


class StableBases(unittest.TestCase):
    def test_migration_preserves_custom_fields_and_explicit_limits(self):
        preset = {'id': 'custom', 'name': 'Custom', 'base_model_id': 'local-active',
            'params': {'think': True, 'max_tokens': 16384, 'reasoning_effort': 'max'}, 'access_grants': ['private']}
        result = align.rebase_preset(preset, align.stable_base_ids(catalog()))
        self.assertEqual(result, {**preset, 'base_model_id': 'daytime'})
        self.assertEqual(preset['base_model_id'], 'local-active')
        self.assertEqual(align.rebase_preset(result, align.stable_base_ids(catalog())), result)

    def test_replacement_models_do_not_rebase_existing_stable_presets(self):
        routes = align.stable_base_ids(catalog('future-day', 'future-night'))
        self.assertEqual(routes['future-night'], 'nighttime')
        for base in ['daytime', 'nighttime', 'unrelated-provider-model']:
            preset = {'base_model_id': base, 'params': {}}
            self.assertEqual(align.rebase_preset(preset, routes), preset)

    def test_missing_or_ambiguous_services_fail_before_mutation(self):
        with self.assertRaises(ValueError):
            align.stable_base_ids(catalog()[:1])
        with self.assertRaises(ValueError):
            align.stable_base_ids(catalog('same-model', 'same-model'))


if __name__ == '__main__':
    unittest.main()
