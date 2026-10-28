import {spawn,type ChildProcess} from 'node:child_process';
import {appendFileSync,existsSync,renameSync,rmSync,statSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';

/** Only owned ChildProcess handles are signalled; no broad pkill/port eviction. */
export class DemoProcesses {
  readonly children=new Map<string,ChildProcess>();
  stopping=false;
  constructor(readonly directory:string,readonly redact:(text:string)=>string){}
  start(name:string,command:string,args:string[],env:NodeJS.ProcessEnv=process.env){
    if(this.stopping)throw new Error('Demo is stopping');
    const path=`${this.directory}/${name}.log`;
    const child=spawn(command,args,{cwd:process.cwd(),env,stdio:['ignore','pipe','pipe']});
    const log=(chunk:Buffer)=>{
      // Operational logs have a bounded two-file window. Acceptance captures
      // live elsewhere and are never subject to this rotation.
      if(existsSync(path)&&statSync(path).size>2*1024*1024){rmSync(path+'.1',{force:true});renameSync(path,path+'.1');}
      appendFileSync(path,this.redact(chunk.toString()),{mode:0o600});
    };
    child.stdout!.on('data',log);child.stderr!.on('data',log);
    child.on('error',error=>log(Buffer.from(error.message)));
    this.children.set(name,child);return child;
  }
  async run(name:string,command:string,args:string[],env?:NodeJS.ProcessEnv){
    const child=this.start(name,command,args,env);
    await new Promise<void>((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(new Error(`${name} exited ${code}; see its local log`)));});
  }
  async stop(){
    this.stopping=true;
    const live=[...this.children.values()].filter(child=>child.exitCode===null&&child.signalCode===null);
    for(const child of live)child.kill('SIGTERM');
    for(let attempt=0;attempt<40&&live.some(child=>child.exitCode===null&&child.signalCode===null);attempt++)await delay(200);
    for(const child of live)if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');
  }
}
