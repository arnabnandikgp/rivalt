import copy,unittest
from reference import audit

class ReferenceTests(unittest.TestCase):
    def test_literal_split_and_aggregate_fee(self):
        p={'cash':'100000000','lots':'0','virtualScaled':'0','reserved':'0','effectiveOrders':0}
        a={'lower':'59900','upper':'60100','grossLots':'0','referencePrice':'60000','trader':p,
           'candidates':[dict(p,makerId=i,inventoryLimit='1000000',consumed='0',version=1,startSlot='1',expirySlot='1000') for i in (0,1)]}
        # A's first 21 prices 60010..60030; B's next 79 prices all 60030.
        q={'snapshotSlot':'100','side':0,'lots':'100','grossQuote':'6002790','fee':'1201','allIn':'6003991',
           'legs':[{'makerId':0,'lots':'21','grossQuote':'1260420'},{'makerId':1,'lots':'79','grossQuote':'4742370'}]}
        result=audit(a,q);self.assertEqual(result['splitBenefit'],'210');self.assertEqual(result['regret'],'0')
        for field in ['grossQuote','fee','allIn']:
            wrong=copy.deepcopy(q);wrong[field]=str(int(wrong[field])+1)
            with self.assertRaises(AssertionError):audit(a,wrong)
        with self.assertRaises(AssertionError):audit(dict(a,trader=dict(p,cash='0',virtualScaled=str(10**20))),q)
        with self.assertRaises(AssertionError):audit(dict(a,trader=dict(p,effectiveOrders=1)),q)
        # At exclusive expiry A's mathematically attractive quote is unavailable.
        a['candidates'][0]['expirySlot']='100'
        only_b=dict(q,grossQuote='6003000',fee='1201',allIn='6004201',legs=[{'makerId':1,'lots':'100','grossQuote':'6003000'}])
        self.assertEqual(audit(a,only_b)['splitBenefit'],'0')
        # A newly published future epoch is also unavailable at this snapshot.
        a['candidates'][0].update(startSlot='101',expirySlot='1000')
        self.assertEqual(audit(a,only_b)['splitBenefit'],'0')

if __name__=='__main__':unittest.main()
