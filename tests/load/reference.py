"""Independent per-lot exhaustive quote audit, limited explicitly to empty effective books."""
import json,sys,gzip
S=10**9

def trunc(n,d):return (abs(n)//d)*(1 if n>=0 else -1)
def healthy(p,lo,hi):
    cash,q,v=map(int,(p['cash'],p['lots'],p['virtualScaled']))
    unpaid=v+q*(hi if q<0 else lo)*S
    return 0<=cash<=10**15 and abs(q)<=10**8 and abs(v)<=10**26 and cash*S+min(unpaid,0)>=((abs(q)*hi+9)//10)*S

def audit(a,allocation):
    lo,hi,n,side,ref,gross=map(int,(a['lower'],a['upper'],allocation['lots'],allocation['side'],a['referencePrice'],a['grossLots']))
    trader=a['trader'];candidates={int(c['makerId']):c for c in a['candidates']}
    assert all(int(p['effectiveOrders'])==0 and int(p['reserved'])==0 for p in [trader]+list(candidates.values())), 'Reference only covers empty effective books'
    feasible=[]
    for count in range(n+1):
        legs=[];total=0;delta=0;valid=True
        for mid,qty in [(0,count),(1,n-count)]:
            if not qty:continue
            if mid not in candidates:valid=False;break
            p=candidates[mid]
            start,end,slot=map(int,(p['startSlot'],p['expirySlot'],allocation['snapshotSlot']))
            if p['version']!=1 or not 64<=end-start<=3600 or not start<=slot<end:valid=False;break
            q,cash,cons,cap=map(int,(p['lots'],p['cash'],p['consumed'],p['inventoryLimit']))
            depth,flat,step,tick,spread=(512,0,64,4,10) if mid==0 else (4096,256,256,1,30)
            sign=1 if side==0 else -1
            capacity=min(depth-cons,cap+(q if side==0 else -q),max(0,min(cash*10//ref,10**8)-abs(q)))
            if qty>capacity:valid=False;break
            prices=[ref-trunc(q,step)*tick+sign*(spread+max(0,cons+k-flat)) for k in range(qty)]
            value=sum(prices)
            after=dict(p,lots=q-sign*qty,virtualScaled=int(p['virtualScaled'])+sign*value*S)
            if min(prices)<1 or max(prices)>10**6 or not qty*ref*9<=value*10<=qty*ref*11 or abs(after['lots'])>cap or not healthy(after,lo,hi):valid=False;break
            delta+=abs(after['lots'])-abs(q);total+=value;legs.append({'makerId':mid,'lots':str(qty),'grossQuote':str(value)})
        if not valid or total<1000:continue
        fee=(total+4999)//5000;sign=1 if side==0 else -1;after=dict(trader,cash=int(trader['cash'])-fee,lots=int(trader['lots'])+sign*n,virtualScaled=int(trader['virtualScaled'])-sign*total*S)
        if not healthy(after,lo,hi) or not 0<=gross+delta+abs(after['lots'])-abs(int(trader['lots']))<=2*10**8:continue
        cost=total+sign*fee;rank=(sign*cost,len(legs),legs[0]['makerId'],-int(legs[0]['lots']))
        feasible.append((rank,total,fee,cost,legs))
    assert feasible,'No feasible independent route'
    best=min(feasible);assert [best[1],best[2],best[3]]==[int(allocation[k]) for k in ['grossQuote','fee','allIn']]
    assert best[4]==allocation['legs'],'Independent optimum/tie break differs'
    singles=[r for r in feasible if len(r[4])==1];single=min(singles) if singles else None
    return {'gross':str(best[1]),'fee':str(best[2]),'regret':'0','singleFeasible':single is not None,'splitBenefit':str((single[3]-best[3])*(1 if side==0 else -1)) if single else None}

if __name__=='__main__':
    path=sys.argv[1];read=gzip.open if path.endswith('.gz') else open;count=0;split=0;benefit=0;unavailable=0
    with read(path,'rt') as f:
        for line in f:
            row=json.loads(line);result=audit(row['audit'],row['allocation']);count+=1;split+=len(row['allocation']['legs'])==2
            if result['splitBenefit'] is None:unavailable+=1
            else:benefit+=int(result['splitBenefit'])
    assert count>0
    print(json.dumps({'quoteAudits':count,'twoMakerQuotes':split,'totalSameStateSplitBenefitAtoms':str(benefit),'singleMakerUnavailable':unavailable,'independentOptimumRegretAtoms':'0','method':'per-lot integer enumeration; all empty-effective-book quotes; no production math imported'}))
