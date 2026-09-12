import importlib.util
import json
from pathlib import Path
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('publisher', Path(__file__).with_name('deploy-router-only.py'))
publisher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(publisher)


class CommittedPublicationTests(unittest.TestCase):
    def test_matching_clean_source_and_image_are_required(self):
        revision = 'a' * 40
        image = [{'Id': 'sha256:tested', 'Config': {'Labels': {'org.opencontainers.image.revision': revision}}}]
        with patch.object(publisher.subprocess, 'check_output', side_effect=[revision, '', json.dumps(image)]):
            self.assertEqual(publisher.reviewed_image(), (revision, 'sha256:tested'))

    def test_dirty_source_stops_before_image_or_runtime_work(self):
        with patch.object(publisher.subprocess, 'check_output', side_effect=['a' * 40, ' M src/server.js']) as run:
            with self.assertRaisesRegex(RuntimeError, 'clean checkout'):
                publisher.reviewed_image()
            self.assertEqual(run.call_count, 2)

    def test_mismatched_or_missing_image_revision_is_rejected(self):
        for labels in [None, {}, {'org.opencontainers.image.revision': 'b' * 40}]:
            image = [{'Id': 'sha256:other', 'Config': {'Labels': labels}}]
            with patch.object(publisher.subprocess, 'check_output', side_effect=['a' * 40, '', json.dumps(image)]):
                with self.assertRaisesRegex(RuntimeError, 'image revision'):
                    publisher.reviewed_image()


if __name__ == '__main__':
    unittest.main()
