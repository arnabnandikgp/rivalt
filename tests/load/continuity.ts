/** Detect sleep/stalls and wall-clock jumps; elapsed wall time alone is never soak evidence. */
export class Continuity {
  private lastWall:number;private lastMono:number;readonly startWall:number;readonly startMono:number;
  samples=0;maxGap=0;maxClockDrift=0;
  constructor(wall:number,mono:number){this.startWall=this.lastWall=wall;this.startMono=this.lastMono=mono;}
  observe(wall:number,mono:number){
    const w=wall-this.lastWall,m=mono-this.lastMono,drift=Math.abs((wall-this.startWall)-(mono-this.startMono));
    if(w<0||m<0||w>10000||m>10000||Math.abs(w-m)>2000||drift>2000+(mono-this.startMono)/10000)throw new Error('Continuity gap, clock jump or system sleep; soak incomplete');
    this.samples++;this.maxGap=Math.max(this.maxGap,w,m);this.maxClockDrift=Math.max(this.maxClockDrift,drift);this.lastWall=wall;this.lastMono=mono;
  }
  result(){return{heartbeatGapBoundMs:10000,clockJumpBoundMs:2000,cumulativeSlewBudgetPpm:100,samples:this.samples,maxGapMs:this.maxGap,maxClockDriftMs:this.maxClockDrift,wallSeconds:(this.lastWall-this.startWall)/1000,monotonicSeconds:(this.lastMono-this.startMono)/1000};}
}
