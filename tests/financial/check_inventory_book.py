"""Exhaustively score small one-lot families using independent rational arithmetic."""
import json
from fractions import Fraction
from hashlib import sha256
from random import Random

from check_shared_inventory import native


def oracle(venue, epoch, debtors, winners):
    def rank(member):
        prefix=b'Rivalt/frozen-member-order/v1\0'+venue+epoch.to_bytes(8,'little')
        return sha256(prefix+member.to_bytes(8,'little')).digest(),member
    debtors=sorted(debtors,key=lambda pair:rank(pair[0]))
    winners=sorted(winners,key=lambda pair:rank(pair[0]))
    total_capacity=sum(value for _,value in winners)
    best_rank,best,count=None,None,0
    def search(index,remaining,pairs):
        nonlocal best_rank,best,count
        if index==len(winners):
            count+=1
            total=sum(pairs.values())
            charges=[sum(pairs.get((debtor,winner),0) for debtor,_ in debtors) for winner,_ in winners]
            deviation=sum((charge-Fraction(total*cap,total_capacity))**2/cap
                for charge,(_,cap) in zip(charges,winners) if cap)
            key=(total,-deviation,-len(pairs),tuple(charges),
                 tuple(pairs.get((debtor,winner),0) for winner,_ in winners for debtor,_ in debtors))
            if best_rank is None or key>best_rank:
                best_rank,best=key,sorted((debtor,winner,amount) for (debtor,winner),amount in pairs.items())
            return
        winner,cap=winners[index]
        search(index+1,remaining,pairs)
        for debtor,budget in remaining:
            available=tuple(member for member in remaining if member[0]!=debtor)
            for amount in range(1,min(cap,budget)+1):
                search(index+1,available,{**pairs,(debtor,winner):amount})
    search(0,debtors,{})
    return best,count


def main():
    rng=Random(20261120)
    tested=count=0
    for debtors_count in range(6):
        for winners_count in range(6):
            for _ in range(12):
                ids=rng.sample(range(2**32),debtors_count+winners_count)
                debtors=sorted((member,rng.randrange(5)) for member in ids[:debtors_count])
                winners=sorted((member,rng.randrange(5)) for member in ids[debtors_count:])
                venue=rng.randbytes(32)
                expected,settings=oracle(venue,tested,debtors,winners)
                assert native(venue,tested,debtors,winners,population=True)==expected
                tested+=1
                count+=settings
    print(json.dumps(dict(books=tested,admissibleAssignments=count)))


if __name__=='__main__':
    main()
