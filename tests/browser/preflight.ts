/** Check the configured local browser before provisioning an integration chain. */
import {access} from 'node:fs/promises';
import {constants} from 'node:fs';
import {chromium} from 'playwright-core';

const executablePath=process.env.RIVALT_CHROME_PATH??chromium.executablePath();
await access(executablePath,constants.X_OK);
const browser=await chromium.launch({executablePath,headless:true,
  args:['--disable-background-networking','--disable-component-update','--no-first-run']});
try{console.log(`Browser preflight: ${browser.version()} (${executablePath})`);}finally{await browser.close();}
