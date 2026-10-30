"""Literal positive/negative cases for the standalone financial audit reader."""
import copy
import unittest
from p34_report import audit_finances


def fixture():
    def root(identity, role, market=0):
        return dict(id=identity, role=role, mode=1, isolatedMarketIndex=market,
                    cash=str(500_000_000 if role else 1_000_000),
                    positions=[dict(lots='0', virtualScaled='0', fundingCheckpointScaled='0') for _ in range(2)])
    roots={f'root{index}':root(index,1 if index<6 else 0,index%2) for index in range(10)}
    markets={key:dict(index=index,fundingIndexScaled='0',referencePrice=str(60000 if index==0 else 30000)) for index,key in enumerate(['btc','eth'])}
    initial=dict(sequence='0',venue=dict(markets=['btc','eth']),roots=copy.deepcopy(roots),markets=markets,makers={})
    journal=[]
    for index,(side,price,fee) in enumerate([(0,60010,13),(1,59990,12)]):
        direction=1 if side==0 else -1
        for key,sign in [('root6',direction),('root0',-direction)]:
            position=roots[key]['positions'][0]
            position['lots']=str(int(position['lots'])+sign)
            position['virtualScaled']=str(int(position['virtualScaled'])-sign*price*10**9)
        roots['root6']['cash']=str(int(roots['root6']['cash'])-fee)
        carry=0 if index==0 else 1
        credit=(fee+carry)//4
        journal.append(dict(cursor=str(index+1),kind='LiquidityRouteExecutedV4',payload=dict(market='btc',marketState=markets['btc'],
                       side=side,lots='1',grossQuote=str(price),fee=str(fee),carryBefore=carry,carryAfter=(fee+carry)%4,
                       insuranceCredit=str(credit),retainedFee=str(fee-credit),
                       legs=[dict(capital='root0',lots='1',gross=str(price))],rootStates=copy.deepcopy([roots['root6'],roots['root0']]))))
    for index in range(2):
        roots['root9']['cash']=str(int(roots['root9']['cash'])-1)
        journal.append(dict(cursor=str(index+3),kind='AccountFinancialChangedV3',payload=dict(kind=0,amount='1',roots=['root9'],rootStates=[copy.deepcopy(roots['root9'])])))
    final=dict(sequence='4',roots=roots,markets=markets,custody=dict(totalCash='3003999973'),
               ledgers={'btc-ledger':dict(market='btc',insurance='6',fees='19',insuranceFeeRemainder=1),
                        'eth-ledger':dict(market='eth',insurance='0',fees='0',insuranceFeeRemainder=0)})
    return dict(serviceReport=dict(opening=initial,state=final,journal=journal,
                                  reconciliation=dict(actualVault='3003999998',unallocatedSurplus='0')))


class FinancialReader(unittest.TestCase):
    def test_literal_funded_cash_and_unpaid_spread(self):
        result=audit_finances(fixture())
        self.assertEqual(result['fee_atoms'],['25','0'])
        maker=next(row for row in result['internal_makers'] if row['capital']=='root0')
        self.assertEqual((maker['funded_pnl_atoms'],maker['unpaid_pnl_scaled']),('0','20000000000'))

    def test_rejects_missing_event_and_one_atom_or_fraction_errors(self):
        for corruption in ('cash','claim','fee','missing','vault'):
            with self.subTest(corruption=corruption):
                run=fixture();record=run['serviceReport']
                if corruption=='cash':record['state']['roots']['root0']['cash']='500000001'
                if corruption=='claim':record['state']['roots']['root0']['positions'][0]['virtualScaled']='20000000001'
                if corruption=='fee':record['journal'][0]['payload']['fee']='12'
                if corruption=='missing':record['journal'].pop(1)
                if corruption=='vault':record['reconciliation']['actualVault']='3003999999'
                with self.assertRaises(AssertionError):audit_finances(run)


if __name__=='__main__':
    unittest.main()
