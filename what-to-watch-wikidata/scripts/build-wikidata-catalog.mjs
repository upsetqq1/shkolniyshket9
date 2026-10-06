import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getEntities, isMovieEntity, normalizeWikidataEntity, wikidataRequest } from '../lib/wikidata.mjs';
import { openCatalog, upsertMovies } from '../lib/catalog-db.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const args=new Map();
const rawArgs=process.argv.slice(2);
for(let i=0;i<rawArgs.length;i++)if(rawArgs[i].startsWith('--'))args.set(rawArgs[i],rawArgs[i+1]);
const seedsPath=resolve(root,args.get('--seeds')||'data/wikidata-seed-titles.txt');
const dbPath=resolve(root,args.get('--db')||'data/wikidata-catalog.sqlite');
const reportPath=resolve(root,args.get('--report')||'data/wikidata-search-quality.json');
const cachePath=resolve(root,args.get('--search-cache')||'data/wikidata-search-cache.json');
const seedLimit=Math.max(1,Number(args.get('--limit')??15));
const candidateLimit=Math.max(1,Math.min(15,Number(args.get('--candidates')??5)));
const delayMs=Math.max(1000,Number(args.get('--delay')??1200));
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const normalize=s=>String(s||'').normalize('NFKC').trim().replace(/[ёЁ]/g,'е').toLocaleLowerCase('ru').replace(/\s+/g,' ');

const allSeeds=(await readFile(seedsPath,'utf8')).split(/\r?\n/).map(s=>s.trim()).filter(s=>s&&!s.startsWith('#'));
const seeds=allSeeds.slice(0,seedLimit);
if(!seeds.length)throw new Error(`No seed titles in ${seedsPath}`);
let searchCache={};try{searchCache=JSON.parse(await readFile(cachePath,'utf8'))}catch{}
const seedCandidates=[];
for(const [index,query] of seeds.entries()){
  if(searchCache[query])seedCandidates.push({query,ids:searchCache[query]});
  else try{
    const found=await wikidataRequest({action:'wbsearchentities',search:query,language:'ru',uselang:'ru',type:'item',limit:'15'});
    const ids=(found.search||[]).map(x=>x.id).filter(x=>/^Q\d+$/.test(x));
    searchCache[query]=ids;seedCandidates.push({query,ids});
    await writeFile(cachePath,JSON.stringify(searchCache,null,2),'utf8');
  }catch(error){seedCandidates.push({query,ids:[],error:error.message});if(error.status===429||error.status===503){console.warn(`Wikidata rate limit. Search progress is saved; wait ${error.retryAfterSeconds||30}s and rerun.`);break}}
  if(index<seeds.length-1)await pause(delayMs);
  if((index+1)%10===0)console.log(`Wikidata title search: ${index+1}/${seeds.length}`);
}

const allIds=[...new Set(seedCandidates.flatMap(x=>x.ids.slice(0,candidateLimit)))];
const entities=await getEntities(allIds);
const matched=[];
for(const item of seedCandidates){
  const candidates=item.ids.slice(0,candidateLimit).map(id=>entities[id]).filter(isMovieEntity);
  const term=normalize(item.query);
  const entity=candidates.find(e=>[e.labels?.ru?.value,e.labels?.en?.value,...(e.aliases?.ru||[]).map(x=>x.value),...(e.aliases?.en||[]).map(x=>x.value)].some(name=>normalize(name)===term)) || candidates[0] || null;
  if(entity)matched.push({query:item.query,qid:entity.id});
}

const chosenEntities=[...new Map(matched.map(x=>[x.qid,entities[x.qid]])).values()];
const linkedIds=[];
for(const entity of chosenEntities){
  for(const property of ['P136','P495','P57','P161']){
    const list=(entity.claims?.[property]||[]).map(c=>c.mainsnak?.datavalue?.value?.id).filter(x=>/^Q\d+$/.test(x||''));
    linkedIds.push(...(property==='P161'?list.slice(0,8):list));
  }
}
const linked=await getEntities(linkedIds);
const movies=chosenEntities.map(entity=>normalizeWikidataEntity(entity,linked));

await mkdir(dirname(dbPath),{recursive:true});
const db=openCatalog(dbPath);upsertMovies(db,movies);
const report={generatedAt:new Date().toISOString(),source:'Wikidata wbsearchentities + wbgetentities',seedCount:seeds.length,candidateLimit,matchedCount:matched.length,missed:seedCandidates.filter(x=>!matched.some(y=>y.query===x.query)).map(x=>({query:x.query,error:x.error||'No matching movie/series entity'})),matches:movies.map(m=>({query:matched.find(x=>x.qid===m.sourceId)?.query,qid:m.sourceId,title:m.title,originalTitle:m.originalTitle,year:m.year,genres:m.genres,duration:m.duration,hasDirector:!!m.director,actors:m.actors.length}))};
await writeFile(reportPath,JSON.stringify(report,null,2),'utf8');
console.log(`Saved ${movies.length} Wikidata movies/series to ${dbPath}`);
console.log(`Search coverage: ${matched.length}/${seeds.length}; quality report: ${reportPath}`);
console.table(report.matches.slice(0,12));
db.close();
