const API = 'https://www.wikidata.org/w/api.php';
const USER_AGENT = 'WhatToWatchPrototype/0.2 (movie catalogue; Wikidata API)';
let backoffUntil=0;
let lastRequestAt=0;
let requestQueue=Promise.resolve();
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const MEDIA_TYPES = new Map([['Q11424','movie'],['Q5398426','series']]);
const GENRE_ALIASES = new Map([
  ['комедия','comedy'],['комедийный фильм','comedy'],['comedy','comedy'],['comedy film','comedy'],['драма','drama'],['драматический фильм','drama'],['drama','drama'],['drama film','drama'],
  ['фантастика','sci-fi'],['научная фантастика','sci-fi'],['научно-фантастический фильм','sci-fi'],['science fiction','sci-fi'],['science fiction film','sci-fi'],['sci-fi','sci-fi'],
  ['фэнтези','fantasy'],['фэнтезийный фильм','fantasy'],['fantasy','fantasy'],['fantasy film','fantasy'],['триллер','thriller'],['фильм-триллер','thriller'],['экшен-триллер','thriller'],['thriller','thriller'],['thriller film','thriller'],['детектив','mystery'],['фильм-тайна','mystery'],['mystery','mystery'],['mystery film','mystery'],
  ['боевик','action'],['экшн','action'],['action','action'],['action film','action'],['романтика','romance'],['романтический фильм','romance'],['мелодрама','romance'],['romance','romance'],['romance film','romance'],
  ['ужасы','horror'],['фильм ужасов','horror'],['horror','horror'],['horror film','horror'],['приключения','adventure'],['приключенческий фильм','adventure'],['adventure','adventure'],['adventure film','adventure'],
  ['анимация','animation'],['мультфильм','animation'],['animation','animation'],['animated film','animation'],['криминал','crime'],['криминальный фильм','crime'],['crime','crime'],['crime film','crime'],
  ['семейный фильм','family'],['семейный','family'],['family','family'],['family film','family'],['исторический фильм','history'],['исторический','history'],['history','history'],['historical film','history'],
  ['документальный фильм','documentary'],['документальный','documentary'],['documentary','documentary'],['documentary film','documentary'],['военный фильм','war'],['военный','war'],['war','war'],['war film','war'],['вестерн','western'],['western','western'],['western film','western'],['музыка','music'],['музыкальный фильм','music'],['music','music'],['music film','music'],['биографический фильм','biography'],['биография','biography'],['biography','biography'],['biographical film','biography']
]);
const COUNTRY_ALIASES = new Map([
  ['Q30','USA'],['Q145','UK'],['Q142','France'],['Q183','Germany'],['Q38','Italy'],['Q29','Spain'],['Q17','Japan'],['Q884','South Korea'],['Q148','China'],['Q668','India'],['Q16','Canada'],['Q408','Australia'],['Q159','Russia'],['Q34','Sweden'],['Q33','Finland'],['Q20','Norway'],['Q35','Denmark'],['Q30','USA']
]);

export async function wikidataRequest(params, { signal } = {}) {
  const spaced=requestQueue.then(async()=>{
    if(signal?.aborted)throw new DOMException('Request aborted','AbortError');
    if(backoffUntil>Date.now())await pause(backoffUntil-Date.now());
    const gap=650-(Date.now()-lastRequestAt);if(gap>0)await pause(gap);
    lastRequestAt=Date.now();
  });
  requestQueue=spaced.catch(()=>{});
  await spaced;
  const url = `${API}?${new URLSearchParams({ ...params, format:'json', origin:'*' })}`;
  const response = await fetch(url, { headers:{ 'User-Agent':USER_AGENT, Accept:'application/json' }, signal });
  if (!response.ok) {
    const retrySeconds=Number(response.headers.get('retry-after'))||30;
    if(response.status===429||response.status===503)backoffUntil=Date.now()+Math.max(10,Math.min(300,retrySeconds))*1000;
    const error=new Error(`Wikidata API HTTP ${response.status}; retry after ${Math.ceil((backoffUntil-Date.now())/1000)}s`);
    error.status=response.status;error.retryAfterSeconds=Math.ceil((backoffUntil-Date.now())/1000);throw error;
  }
  const result = await response.json();
  if (result.error) throw new Error(result.error.info || result.error.code || 'Wikidata API error');
  return result;
}

export async function getEntities(ids, { signal } = {}) {
  const unique = [...new Set(ids.filter(id => /^Q\d+$/.test(id)))];
  const entities = {};
  for (let start=0; start<unique.length; start+=50) {
    if(start)await pause(300);
    const result = await wikidataRequest({ action:'wbgetentities', ids:unique.slice(start,start+50).join('|'), props:'labels|descriptions|aliases|claims', languages:'ru|en', languagefallback:1 }, { signal });
    Object.assign(entities, result.entities || {});
  }
  return entities;
}

function values(entity, property) {
  return (entity?.claims?.[property] || []).flatMap(claim => {
    const value = claim?.mainsnak?.datavalue?.value;
    return value === undefined || value === null ? [] : [value];
  });
}
const qids = (entity, property) => values(entity, property).map(value => value?.id).filter(id => /^Q\d+$/.test(id || ''));
function label(entity, lang='ru') { return entity?.labels?.[lang]?.value || entity?.labels?.en?.value || ''; }
function localTitle(entity) { return entity?.labels?.ru?.value || label(entity,'en') || entity?.id || ''; }
function dateYear(value) { const match=String(value||'').match(/^[+-]?0*(\d{1,6})-/); return match ? Number(match[1]) : null; }
function durationMinutes(value) {
  const n=Number(value?.amount); if (!Number.isFinite(n)) return null;
  const unit=String(value?.unit||'');
  if (unit.endsWith('/Q7727')) return n;
  if (unit.endsWith('/Q11574')) return n/60;
  if (unit.endsWith('/Q25235')) return n*60;
  return null;
}
function genreKey(name) { return GENRE_ALIASES.get(String(name||'').trim().toLowerCase()) || null; }

export function isMovieEntity(entity) { return qids(entity,'P31').some(id => MEDIA_TYPES.has(id)); }

export function normalizeWikidataEntity(entity, linked={}) {
  const typeIds=qids(entity,'P31');
  const type=typeIds.map(id=>MEDIA_TYPES.get(id)).find(Boolean) || 'movie';
  const genreIds=qids(entity,'P136');
  const countryIds=qids(entity,'P495');
  const directorIds=qids(entity,'P57');
  const actorIds=qids(entity,'P161').slice(0,8);
  const genreNames=genreIds.map(id=>label(linked[id])).filter(Boolean);
  const genres=[...new Set(genreIds.map(id=>genreKey(label(linked[id],'en')||label(linked[id]))).filter(Boolean))];
  const dateValues=values(entity,'P577');
  const release=dateValues.map(v=>v.time).find(Boolean);
  const titles=values(entity,'P1476');
  const originalTitle=titles.find(v=>v.language==='en')?.text || entity?.labels?.en?.value || localTitle(entity);
  const descriptions=entity?.descriptions || {};
  const duration=values(entity,'P2047').map(durationMinutes).find(v=>v!==null) ?? null;
  return {
    id:`wikidata:${entity.id}`, title:localTitle(entity), originalTitle,
    year:dateYear(release), genres,
    country:[...new Set(countryIds.map(id=>COUNTRY_ALIASES.get(id)||label(linked[id])).filter(Boolean))],
    duration, director:directorIds.map(id=>label(linked[id])).filter(Boolean).join('|'),
    actors:actorIds.map(id=>label(linked[id])).filter(Boolean),
    description:descriptions.ru?.value || descriptions.en?.value || '', poster:'', rating:null, type,
    mood:[], moods:{}, pacing:null, emotionalIntensity:null, tension:null, humor:null, romance:null,
    darkness:null, intellectualComplexity:null, comfortLevel:null, actionLevel:null, predictability:null,
    realism:null, fantasyLevel:null, rewatchability:null, source:'wikidata', sourceId:entity.id,
    genreText:genres.join(' · '), genreLabels:genreNames
  };
}

async function linkedLabels(entities, { signal } = {}) {
  const ids=[];
  for (const entity of entities) ids.push(...qids(entity,'P136'),...qids(entity,'P495'),...qids(entity,'P57'),...qids(entity,'P161').slice(0,8));
  return getEntities(ids, { signal });
}

async function linkedGenreLabels(entities, { signal } = {}) {
  const ids=entities.flatMap(entity=>qids(entity,'P136'));
  return getEntities(ids,{signal});
}

export async function searchWikidataMovies(query, { limit=12, signal } = {}) {
  const term=String(query||'').trim();
  if (!term) return [];
  const primary=/[А-Яа-яЁё]/.test(term)?'ru':'en',languages=[primary,primary==='ru'?'en':'ru'];
  for(const language of languages){
    const result=await wikidataRequest({action:'wbsearchentities',search:term,language,uselang:language,type:'item',limit:'20'},{signal});
    const ids=[...new Set((result.search||[]).map(item=>item.id).filter(id=>/^Q\d+$/.test(id)))];
    if(!ids.length)continue;
    const entities=await getEntities(ids,{signal});
    const films=Object.values(entities).filter(isMovieEntity).slice(0,Math.max(1,Math.min(10,limit)));
    if(!films.length)continue;
    const linked=await linkedGenreLabels(films,{signal});
    return films.map(entity=>normalizeWikidataEntity(entity,linked));
  }
  return [];
}

export async function getWikidataMovie(id, { signal } = {}) {
  const qid=String(id||'').replace(/^wikidata:/,'');
  if (!/^Q\d+$/.test(qid)) return null;
  const entities=await getEntities([qid],{signal});
  const entity=entities[qid];
  if (!entity || !isMovieEntity(entity)) return null;
  const linked=await linkedLabels([entity],{signal});
  return normalizeWikidataEntity(entity,linked);
}

export function normalizeWikidataGenre(name) { return genreKey(name); }
