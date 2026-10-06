import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isMovieEntity, normalizeWikidataEntity } from '../lib/wikidata.mjs';
import { findMovie, listMovies, openCatalog, upsertMovies } from '../lib/catalog-db.mjs';

const entity={id:'Q123',labels:{ru:{value:'Русское название'},en:{value:'Original title'}},descriptions:{ru:{value:'Краткое описание'}},claims:{
 P31:[{mainsnak:{datavalue:{value:{id:'Q11424'}}}}],
 P1476:[{mainsnak:{datavalue:{value:{text:'Original title',language:'en'}}}}],
 P577:[{mainsnak:{datavalue:{value:{time:'+2014-11-07T00:00:00Z'}}}}],
 P136:[{mainsnak:{datavalue:{value:{id:'Q130232'}}}},{mainsnak:{datavalue:{value:{id:'Q24925'}}}}],
 P495:[{mainsnak:{datavalue:{value:{id:'Q30'}}}}],
 P2047:[{mainsnak:{datavalue:{value:{amount:'+169',unit:'http://www.wikidata.org/entity/Q7727'}}}}],
 P57:[{mainsnak:{datavalue:{value:{id:'Q42'}}}}],
 P161:[{mainsnak:{datavalue:{value:{id:'Q64'}}}}]
}};
assert.equal(isMovieEntity(entity),true);
assert.equal(isMovieEntity({...entity,claims:{...entity.claims,P31:[{mainsnak:{datavalue:{value:{id:'Q5398426'}}}}]}}),true);
assert.equal(isMovieEntity({...entity,claims:{...entity.claims,P31:[{mainsnak:{datavalue:{value:{id:'Q5'}}}}]}}),false);
const movie=normalizeWikidataEntity(entity,{
 Q130232:{labels:{ru:{value:'драма'},en:{value:'drama film'}}},Q24925:{labels:{ru:{value:'научно-фантастический фильм'},en:{value:'science fiction film'}}},
 Q30:{labels:{ru:{value:'США'}}},Q42:{labels:{en:{value:'Director Name'}}},Q64:{labels:{en:{value:'Actor Name'}}}
});
assert.equal(movie.id,'wikidata:Q123');
assert.equal(movie.title,'Русское название');
assert.equal(movie.originalTitle,'Original title');
assert.equal(movie.year,2014);
assert.deepEqual(movie.genres,['drama','sci-fi']);
assert.deepEqual(movie.country,['USA']);
assert.equal(movie.duration,169);
assert.equal(movie.director,'Director Name');
assert.deepEqual(movie.actors,['Actor Name']);
assert.equal(movie.description,'Краткое описание');
for(const field of ['pacing','emotionalIntensity','tension','humor','romance','darkness','intellectualComplexity','comfortLevel','actionLevel','predictability','realism','fantasyLevel','rewatchability'])assert.equal(movie[field],null,`${field} is not fabricated`);
const tv=normalizeWikidataEntity({...entity,id:'Q456',claims:{...entity.claims,P31:[{mainsnak:{datavalue:{value:{id:'Q5398426'}}}}]}});
assert.equal(tv.type,'series');
const unknownGenre=normalizeWikidataEntity({...entity,claims:{...entity.claims,P136:[{mainsnak:{datavalue:{value:{id:'Q999'}}}}]}},{Q999:{labels:{en:{value:'cyberpunk'}}}});
assert.deepEqual(unknownGenre.genres,[],'unsupported labels do not become fake scoring genres');

const dir=await mkdtemp(join(tmpdir(),'wikidata-catalog-test-'));
let db;
try{
  db=openCatalog(join(dir,'catalog.sqlite'));
  upsertMovies(db,[movie]);
  assert.equal(listMovies(db).total,1);
  assert.equal(listMovies(db,{query:'Русское',limit:10}).items[0].id,'wikidata:Q123');
  assert.equal(findMovie(db,'Q123').title,'Русское название');
}finally{db?.close();await rm(dir,{recursive:true,force:true})}

console.log('Wikidata mapping and SQLite catalog checks passed.');
