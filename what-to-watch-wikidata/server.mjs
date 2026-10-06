import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openCatalog, findMovie, listMovies } from './lib/catalog-db.mjs';
import { getWikidataMovie, searchWikidataMovies } from './lib/wikidata.mjs';

const root=resolve(fileURLToPath(new URL('.',import.meta.url)));
const port=Number(process.env.PORT)||4173;
const dbPath=resolve(root,process.env.WIKIDATA_SQLITE_PATH||'data/wikidata-catalog.sqlite');
const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.svg':'image/svg+xml','.webp':'image/webp'};
const cache=new Map();
let db;
function database(){if(!db)db=openCatalog(dbPath);return db}
function json(res,status,value){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value))}
function remember(key,value,ttl=20*60*1000){cache.set(key,{value,expires:Date.now()+ttl});if(cache.size>500)cache.delete(cache.keys().next().value);return value}
function cached(key){const entry=cache.get(key);if(entry&&entry.expires>Date.now())return entry.value;cache.delete(key);return null}

async function handleApi(url,res){
  if(url.pathname==='/api/wikidata/health'){
    try{return json(res,200,{ok:true,source:'Wikidata',localCount:database().prepare('SELECT COUNT(*) count FROM movies').get().count,searchApi:'on-demand'})}
    catch(error){return json(res,500,{ok:false,error:'Local catalog database is not available',detail:error.message})}
  }
  if(url.pathname==='/api/wikidata/search'){
    const query=String(url.searchParams.get('q')||'').trim();
    if(!query)return json(res,400,{error:'q is required'});
    if([...query].length<3){try{return json(res,200,{...listMovies(database(),{query,limit:30}),source:'sqlite',query})}catch{return json(res,200,{items:[],total:0,source:'empty',query})}}
    const key=`search:${query.toLocaleLowerCase('ru')}`;let result=cached(key);
    if(!result){
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),16000);
      try{const items=await searchWikidataMovies(query,{limit:15,signal:controller.signal});result=remember(key,{items,source:'wikidata-api',query})}
      catch(error){console.warn('Wikidata title search failed:',error.message);const local=listMovies(database(),{query,limit:30});result={items:local.items,source:'sqlite-fallback',query,error:'Wikidata search unavailable'}}
      finally{clearTimeout(timer)}
    }
    return json(res,200,result);
  }
  if(url.pathname==='/api/wikidata/catalog'){
    const query=String(url.searchParams.get('q')||'');
    const page=Math.max(1,Number(url.searchParams.get('page'))||1);
    const limit=Math.max(1,Math.min(5000,Number(url.searchParams.get('limit'))||500));
    try{return json(res,200,{...listMovies(database(),{query,page,limit}),source:'sqlite'})}
    catch(error){console.error('SQLite catalog read failed:',error);return json(res,200,{items:[],total:0,page,limit,source:'empty'})}
  }
  const detailMatch=url.pathname.match(/^\/api\/wikidata\/movie\/(Q\d+)$/);
  if(detailMatch){
    const qid=detailMatch[1],key=`entity:${qid}`;let movie=cached(key);
    if(!movie){
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),16000);
      try{movie=await getWikidataMovie(qid,{signal:controller.signal});if(movie)remember(key,movie,12*60*60*1000)}
      catch(error){console.warn('Wikidata entity lookup failed:',error.message)}
      finally{clearTimeout(timer)}
    }
    if(!movie){try{movie=findMovie(database(),`wikidata:${qid}`)}catch{}}
    return movie?json(res,200,{movie,source:'wikidata'}):json(res,404,{error:'Film or series not found in Wikidata'});
  }
  return json(res,404,{error:'API route not found'});
}

createServer(async(req,res)=>{
  const url=new URL(req.url,`http://${req.headers.host||'localhost'}`);
  if(req.method!=='GET')return json(res,405,{error:'GET only'});
  if(url.pathname.startsWith('/api/'))return handleApi(url,res);
  let relative;
  try{relative=url.pathname==='/'?'index.html':decodeURIComponent(url.pathname).replace(/^\/+/, '')}
  catch{return json(res,400,{error:'Invalid path'})}
  const file=resolve(root,relative);
  if(file!==root&&!file.startsWith(root+sep))return json(res,403,{error:'Forbidden'});
  if(relative.startsWith('.')||['server.mjs','README.md','package.json'].includes(relative)||relative.startsWith('tests/')||relative.startsWith('scripts/')||relative.startsWith('lib/'))return json(res,404,{error:'Not found'});
  try{const info=await stat(file);if(!info.isFile())return json(res,404,{error:'Not found'});res.writeHead(200,{'Content-Type':mime[extname(file).toLowerCase()]||'application/octet-stream','X-Content-Type-Options':'nosniff'});res.end(await readFile(file))}
  catch{return json(res,404,{error:'Not found'})}
}).listen(port,()=>console.log(`Что посмотреть сегодня? доступно: http://localhost:${port}`));
