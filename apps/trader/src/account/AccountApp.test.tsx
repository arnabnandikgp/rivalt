import {afterEach,expect,it,vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import * as sdk from '@rivalt/sdk';
import {accountTradeFixture} from '../../../../packages/sdk/src/account-test-fixture.js';
import {AccountApp,FundingReports} from './AccountApp.js';
import {useAccountController,type AccountController} from './useAccountController.js';

const fixture=vi.hoisted(()=>({venue:undefined as any}));
vi.mock('./useAccountVenue.js',()=>({useAccountVenue:()=>fixture.venue}));
vi.mock('@solana/wallet-adapter',()=>({WalletMultiButton:()=>null}));
afterEach(()=>vi.unstubAllGlobals());

it('distinguishes independent index, attested impact, classified gaps and superseded publisher reports',()=>{
  const controller={snapshot:{markets:['btc','eth'],now:110n,marketStates:[{referencePrice:60000n,lotsPerUnit:1000000n},{referencePrice:30000n,lotsPerUnit:100000n}]},
    venue:{feed:{group:{liquidity:{reports:{btc:{report:{outcome:0,quantity:'100',bid:'5999800',ask:'6000300',observedTime:'100',authorityEpoch:'1'}},
      eth:{report:{outcome:2,quantity:'0',bid:'0',ask:'0',observedTime:'108',authorityEpoch:'2'}}},
      publishers:{btc:{market:'btc',publisher:sdk.CLEARING_PROGRAM_ADDRESS,enabled:true,authorityEpoch:'1'},
        eth:{market:'eth',publisher:sdk.CLEARING_PROGRAM_ADDRESS,enabled:false,authorityEpoch:'2'}}}}}}} as unknown as AccountController;
  let html=renderToStaticMarkup(<FundingReports controller={controller}/>);
  expect(html).toContain('<td>60,000.5</td>');expect(html).toContain('<td>60,000</td>');expect(html).toContain('10 seconds');
  expect(html).toContain('Maker coverage unavailable');expect(html).toContain('Revoked');expect(html).toContain('restricted operator');
  (controller.venue.feed.group as any).liquidity.publishers.btc.authorityEpoch='2';
  html=renderToStaticMarkup(<FundingReports controller={controller}/>);expect(html).toContain('Superseded by publisher control');
});

it('renders occupied operator slots and funded cash without offering trader actions or registration',async()=>{
  const test=await accountTradeFixture(),client=new sdk.AccountUserClient(test.config);
  client.rpc.call=async(method:string,params:any[]=[])=>method==='getAccountInfo'
    ?{context:{slot:100},value:test.accounts.get(params[0])??null}:test.rpc.call(method,params);
  const config={...test.config,readBase:'/read' as const,apiBase:'/api' as const};
  const selectionKey=`rivalt:selection:v3:${config.genesis}:${config.anchor}:${config.venue}`;
  vi.stubGlobal('localStorage',{getItem:(key:string)=>key===selectionKey?JSON.stringify({portfolio:0,subaccount:1,market:1}):null});
  for(const role of [1,2,0]) {
    const margin=test.margins[1],root=sdk.getMarginAccountV3Decoder().decode(Buffer.from(test.accounts.get(margin).data[0],'base64'));
    test.put(margin,sdk.getMarginAccountV3Encoder().encode({...root,role,cash:12_345_678n}));
    const discovered=await client.ownerAccounts(test.owner,0);
    const snapshot=await sdk.readAccountSnapshot(test.rpc,test.config,[margin],'finalized');
    fixture.venue={client,snapshot,accounts:discovered.accounts,ownerPortfolio:discovered.portfolio,tokens:[],
      canSign:true,busy:'',rpcError:'',records:[],feed:{trades:[],events:[],ready:false}};
    let controller:AccountController|undefined;
    function Capture(){controller=useAccountController(config);return null;}
    renderToStaticMarkup(<Capture/>);
    expect(controller!.margin).toBe(margin);expect(controller!.root!.cash).toBe(12_345_678n);
    expect(controller!.financialDisabled).toBe(false);expect(controller!.marketAllowed).toBe(role===0);
    const html=renderToStaticMarkup(<AccountApp config={config}/>);
    expect(html).toContain('12.345678');
    expect(html).not.toContain('>Register account<');expect(html).not.toContain('>Create portfolio<');
    if(role!==0)expect(html).toContain(role===1?'Maker capital':'Liquidation receiver');
  }
});
