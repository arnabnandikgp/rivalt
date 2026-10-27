#!/usr/bin/env python3
"""Untrusted test proposal from the independent Fraction reference, never a keeper.
The actual program must verify the complete rows and prescribed insurance passes.
"""
from fractions import Fraction
from math import gcd, lcm
import json
import sys
from account_contract_reference import Account
from clearing_network_reference import clear_rational_cohort

data=json.load(sys.stdin)
rows=tuple((int(row['cash']),tuple(map(int,row['claims']))) for row in data['rows'])
pools=tuple(map(int,data['pools']));budgets=tuple(map(int,data['budgets']))
accounts=tuple(Account(cash,tuple(Fraction(claim,10**9) for claim in claims)) for cash,claims in rows)
result=clear_rational_cohort(accounts,pools,budgets,whole_cash_collection=True)
common=1
for cash,claims in rows:
    debts=tuple(max(-claim,0) for claim in claims)
    if all(debts) and min(cash,sum(debts)//10**9):common*=sum(debts)
denominator=lcm(*(rate.denominator for rate in result.rates))
factor=denominator//gcd(common,denominator)
assert 0 < factor < 1<<186 and common.bit_length()<=5632
numerators=tuple(rate*common*factor for rate in result.rates)
assert all(value.denominator==1 for value in numerators)
print(json.dumps({'common':str(common),'factor':str(factor),'rates':[str(int(value)) for value in numerators],
    'spent':[str(int(value)) for value in result.insurance_spent],
    'fractional':[value.denominator!=1 for value in result.insurance_spent]}))
