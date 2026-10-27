import {afterEach,expect,it,vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import * as sdk from '@rivalt/sdk';
import {accountTradeFixture} from '../../../../packages/sdk/src/account-test-fixture.js';
import {AccountApp} from './AccountApp.js';
import {useAccountController,type AccountController} from './useAccountController.js';

const fixture=vi.hoisted(()=>({venue:undefined as any}));
vi.mock('./useAccountVenue.js',()=>({useAccountVenue:()=>fixture.venue}));
vi.mock('@solana/wallet-adapter',()=>({WalletMultiButton:()=>null}));
afterEach(()=>vi.unstubAllGlobals());

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
