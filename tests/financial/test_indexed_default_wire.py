"""Wire regressions for exact fractional collections and recovery pass units."""
import unittest

from indexed_default_certificate import certificate, encode_rate_passes
from test_market_indexed_default import frozen


class CertificateWire(unittest.TestCase):
    def test_par_rates_can_require_half_atom_collections(self):
        book = frozen([(1, [-1, -1]), (1, [-1, -1]), (0, [2, 2])])
        for market in book["markets"]:
            market["pool"] = "1"
        book["vault"] = "4"
        proof = certificate(book, [[(0, 0)] * 2 for _ in book["rows"]])
        self.assertEqual((proof["denominator"], proof["numerators"], proof["cash"]),
                         (2, [2, 2], [0, 0, 4]))

    def test_incompatible_grids_use_individually_representable_passes(self):
        self.assertEqual(encode_rate_passes([[65536, 1], [65537, 2]], False),
                         (0, [65536, 1, 65537, 2]))
        with self.assertRaises(ValueError):
            encode_rate_passes([[2**32, 1]], True)


if __name__ == "__main__":
    unittest.main()
