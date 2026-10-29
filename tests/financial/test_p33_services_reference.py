"""Literal trader funding case and offsetting-error regressions for P33 replay."""
import copy
import unittest
from p33_services_reference import check_traders


def fixture():
    root=lambda identity,mode,cash,claims:dict(id=identity,role=0,mode=mode,cash=str(cash),
        positions=[dict(lots='0',virtualScaled=str(claim)) for claim in claims])
    state=dict(venue=dict(markets=['btc','eth']),roots={
        'cross':root(6,0,999786,[-30000000010,-25000000000]),
        'isolated':root(7,1,999879,[-25000000000,0])})
    events=[]
    def add(event_kind,**change):
        events.append(dict(kind=event_kind,payload=dict(sequence=str(len(events)+1),**change)))
    add('AccountFinancialChangedV3',kind=0,roots=['cross'],amount='7')
    fills=[(6,'btc',0,5,300015,61),(6,'eth',0,5,150015,31),
           (6,'eth',1,5,149990,30),(6,'btc',1,5,299990,60),
           (7,'btc',0,5,300015,61),(7,'btc',1,5,299990,60),
           (6,'btc',0,1,60003,13),(6,'btc',1,1,59998,12)]
    for index,(identity,market,side,lots,gross,fee) in enumerate(fills):
        add('LiquidityRouteExecutedV4',market=market,side=side,lots=str(lots),grossQuote=str(gross),fee=str(fee),rootStates=[dict(id=identity)])
        if index==0:add('FundingReportAcceptedV4',state=dict(index=0,fundingIndexScaled='2'))
    add('AccountFinancialChangedV3',kind=0,roots=['isolated'],amount='5')
    add('AccountCustodyChangedV3',kind=4,subject='isolated',amount='5')
    state['sequence']=str(len(events))
    return state,[dict(sequence='0',fundingIndexScaled='0')]*2,events


class TraderReplay(unittest.TestCase):
    def test_literal_cash_and_fractional_funding(self):
        result=check_traders(*fixture())
        self.assertEqual(result['cross']['claims'],[-30000000010,-25000000000])
        self.assertEqual(result['isolated']['cash'],999879)

    def test_rejects_offsetting_errors_even_when_totals_are_unchanged(self):
        for field in ('cash','claim'):
            with self.subTest(field=field):
                state,openings,events=copy.deepcopy(fixture())
                for key,delta in [('cross',1),('isolated',-1)]:
                    value=state['roots'][key]
                    if field=='cash':value['cash']=str(int(value['cash'])+delta)
                    else:value['positions'][0]['virtualScaled']=str(int(value['positions'][0]['virtualScaled'])+delta)
                with self.assertRaises(AssertionError):check_traders(state,openings,events)


if __name__=='__main__':unittest.main()
