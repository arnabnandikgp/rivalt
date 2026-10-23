import { execFileSync } from 'node:child_process';
import { readdirSync,statSync,statfsSync } from 'node:fs';
import type { environment } from './environment.js';

/** Owned file sizes and host measurements are separate; APFS/shared pages are not additive attribution. */
export async function resources(e:Awaited<ReturnType<typeof environment>>){
  const files:Record<string,{logicalBytes:number;allocatedBytes:number}>={};
  function walk(path:string){
    for(const name of readdirSync(path)){const full=path+'/'+name,s=statSync(full);if(s.isDirectory()){walk(full);continue;}
      const group=full.includes('/postgres-data/')?(full.includes('/pg_wal/')?'postgresWal':'postgresOther'):name.endsWith('.log')?'logs':name.endsWith('.gz')?'transactionArchives':'otherRunFiles';
      const v=files[group]??={logicalBytes:0,allocatedBytes:0};v.logicalBytes+=s.size;v.allocatedBytes+=s.blocks*512;
    }
  }
  walk(e.dir);
  const disk=statfsSync('.');
  const tables=(await e.runtime.store.pool.query('SELECT relname,pg_table_size(relid)::text AS heap_bytes,pg_indexes_size(relid)::text AS index_bytes FROM pg_stat_user_tables ORDER BY relname')).rows;
  const databases=(await e.runtime.store.pool.query('SELECT datname,pg_database_size(oid)::text AS bytes FROM pg_database ORDER BY datname')).rows;
  return {at:new Date().toISOString(),diskFreeBytes:disk.bavail*disk.bsize,files,tables,databases,
    hostSwap:execFileSync('sysctl',['-n','vm.swapusage'],{encoding:'utf8'}).trim(),
    vmStatistics:execFileSync('vm_stat',[],{encoding:'utf8'}),
    attribution:'Run file allocations and PostgreSQL sizes overlap. Swap and filesystem-wide free space include other applications; residual changes are unattributed.'};
}
