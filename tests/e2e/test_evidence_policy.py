import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('evidence_policy', Path(__file__).resolve().parents[2] / 'ops/check-evidence-policy.py')
policy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(policy)


class EvidencePolicy(unittest.TestCase):
    def test_summaries_and_small_fixtures_remain_reviewable(self):
        self.assertEqual(policy.violations([('docs/evidence/P14.md', 4000), ('tests/fixtures/price.hex', 269)]), [])

    def test_raw_output_and_oversized_fixture_cannot_hide_in_source(self):
        self.assertEqual(len(policy.violations([('docs/evidence/p14/capture.json', 1), ('tests/fixtures/dump.json', 100_000)])), 2)

    def test_splitting_a_dump_cannot_bypass_the_total_budget(self):
        self.assertEqual(len(policy.violations([(f'tests/fixtures/{i}.json', 80_000) for i in range(3)])), 1)

    def test_performance_summaries_have_separate_individual_and_total_bounds(self):
        prefix = 'tests/performance/baselines/'
        self.assertEqual(policy.violations([(prefix + 'metrics.json', 64 * 1024)]), [])
        self.assertEqual(len(policy.violations([(prefix + 'trace.json', 64 * 1024 + 1)])), 1)
        self.assertEqual(len(policy.violations([(prefix + f'{i}.json', 64 * 1024) for i in range(3)])), 1)
