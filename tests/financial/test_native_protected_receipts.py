"""Real Rust D117/D118 settlement versus the independent exact two-market model."""
from fractions import Fraction
from itertools import product
import unittest

from account_contract_reference import Account
from cross_market_adl_model import linked_winner
from joint_reduction_model import evaluate, market_plans
from market_settlement_reference import MarketBook
from settlement_liquidation_model import MarketSnapshot, paired_reduction, terminal
from test_creditor_payout_floors import fractional_debtors, linked_creditors
from test_frozen_cash_allocation import encoded
from test_joint_market_ties import mirror_book
from test_scalable_settlement import decode, frozen_book_command, run


def protected_command(original, effective):
    def rows(book):
        return [(account.cash, account.claims) for account in book.accounts]
    reduced, _, _ = encoded(rows(original), rows(effective), original.insurance, original.fees)
    baseline = frozen_book_command(original).split('|')
    return '|'.join(['protected', *reduced.split('|')[1:], *baseline[5:8]])


class NativeProtectedReceipts(unittest.TestCase):
    def test_additional_flat_creditor_changes_who_receives_two_funded_atoms(self):
        original = MarketBook((Account(19_976, (-10_002, -10_002)), Account(19_970, (4_996, 0)),
                               Account(1_000_000, (5_006, 0)), Account(1_000_000, (0, 10_002))),
                              insurance=(9, 1), fees=(30, 6), frozen=True)
        effective = MarketBook((Account(19_976, (-9_997, -9_989)), original.accounts[1],
                                Account(1_000_000, (5_001, 0)), Account(1_000_000, (0, 9_989))),
                               insurance=original.insurance, fees=original.fees, frozen=True)
        before, after = [decode(line) for line in run([protected_command(original, proposed)
                                                      for proposed in (original, effective)])]
        self.assertEqual(before['cash'], (0, 24_964, 1_005_003, 1_009_989))
        self.assertEqual(after['cash'], (0, 24_966, 1_005_001, 1_009_989))
        self.assertEqual(before['spent'], after['spent'])
        self.assertEqual(after['spent'], (9, 1))

    def test_protected_cash_and_fractional_ownership(self):
        half_rows = ((3, -8, 3), (2, 4, -3), (2, 4, -7), (1, 3, -4), (1, -3, 11))
        book = MarketBook(tuple(Account(cash, (btc, Fraction(eth, 2))) for cash, btc, eth in half_rows),
                          frozen=True)
        hidden = MarketSnapshot(book, (-1, 1, 0, 0, 0), 100, (99, 99, None, None, None))
        for state, gain, charge, expected in (
            (linked_creditors(), 2, 2, (0, 0, 0, 3, 1, 1)),
            (fractional_debtors(), 3, 3, (0, 0, 0, 2, 1)),
            (hidden, 1, 1, None),
        ):
            effective, _ = paired_reduction(state, 0, 1, gain, charge)
            result = decode(run([protected_command(state.book, effective.book)])[0])
            if expected is None:
                self.assertEqual(tuple(result['movements'][i][1] for i in (0, 4)), (1, 6))
            else:
                self.assertEqual(result['cash'], expected)
            self.assertEqual(result['spent'], (0, 0))

    def test_reducing_a_foreign_creditor_or_spending_its_insurance_is_refused(self):
        cases = []
        for insurance in (0, 25):
            state, _ = linked_winner(eth_insurance=insurance)
            charged, _ = paired_reduction(state, 0, 1, 20, 20)
            ordinary = terminal(charged.book)
            self.assertEqual((ordinary.cash[-1], ordinary.insurance_spent[1]),
                             (15, 0) if insurance == 0 else (40, 25))
            cases.append(protected_command(state.book, charged.book))
        self.assertEqual(run(cases), ['err:Entitlement']*2)

    def test_does_not_trust_a_supplied_baseline_rate_or_receipt_order(self):
        state = linked_creditors()
        charged, _ = paired_reduction(state, 0, 1, 2, 2)
        fields = protected_command(state.book, charged.book).split('|')
        forged_rate, forged_order = fields.copy(), fields.copy()
        forged_rate[10] = '1,0,0'
        forged_order[12] = ','.join(reversed(forged_order[12].split(',')))
        for result in run(['|'.join(forged_rate), '|'.join(forged_order)]):
            self.assertTrue(result.startswith('err:'), result)

    def test_all_complete_joint_proposals_match_the_independent_financial_protections(self):
        original, exposures = mirror_book()
        baseline = terminal(original)
        markets = [market_plans(original, i, exposure, baseline) for i, exposure in enumerate(exposures)]
        inputs, expected = [], []
        for btc, eth in product(*markets):
            rows = tuple(Account(a.cash, (b, e)) for a, b, e in
                         zip(original.accounts, btc.claims, eth.claims, strict=True))
            effective = MarketBook(rows, insurance=original.insurance, frozen=True)
            inputs.append(protected_command(original, effective))
            expected.append(evaluate(original, baseline, (btc, eth)))
        self.assertEqual((len(expected), sum(plan is not None for plan in expected)), (100, 70))
        for line, plan in zip(run(inputs), expected, strict=True):
            if plan is None:
                self.assertIn(line, ('err:Entitlement', 'err:Invariant'))
                continue
            result = decode(line)
            self.assertEqual((result['cash'], result['movements'], result['spent']),
                             (plan.payout.cash, plan.payout.claim_cash_movements, plan.payout.insurance_spent))


if __name__ == '__main__':
    unittest.main()
