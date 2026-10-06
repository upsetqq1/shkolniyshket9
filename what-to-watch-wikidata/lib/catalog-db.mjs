import { DatabaseSync } from 'node:sqlite';

export function openCatalog(path) {
  const db=new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode=WAL;
    PRAGMA synchronous=NORMAL;
    CREATE TABLE IF NOT EXISTS movies (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, original_title TEXT, year INTEGER,
      genres_json TEXT NOT NULL DEFAULT '[]', country_json TEXT NOT NULL DEFAULT '[]', duration REAL,
      director TEXT NOT NULL DEFAULT '', actors_json TEXT NOT NULL DEFAULT '[]', description TEXT NOT NULL DEFAULT '',
      poster TEXT NOT NULL DEFAULT '', rating REAL, type TEXT NOT NULL DEFAULT 'movie', source_id TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS movies_year_idx ON movies(year DESC);
    CREATE INDEX IF NOT EXISTS movies_title_idx ON movies(title COLLATE NOCASE);
    CREATE VIRTUAL TABLE IF NOT EXISTS movies_fts USING fts5(id UNINDEXED,title,original_title,director,actors,tokenize='unicode61 remove_diacritics 2');
  `);
  return db;
}

export function upsertMovies(db,movies) {
  const upsert=db.prepare(`INSERT INTO movies(id,title,original_title,year,genres_json,country_json,duration,director,actors_json,description,poster,rating,type,source_id,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,original_title=excluded.original_title,year=excluded.year,genres_json=excluded.genres_json,country_json=excluded.country_json,duration=excluded.duration,director=excluded.director,actors_json=excluded.actors_json,description=excluded.description,poster=excluded.poster,rating=excluded.rating,type=excluded.type,source_id=excluded.source_id,updated_at=excluded.updated_at`);
  const ftsDelete=db.prepare('DELETE FROM movies_fts WHERE id=?');
  const ftsInsert=db.prepare('INSERT INTO movies_fts(id,title,original_title,director,actors) VALUES(?,?,?,?,?)');
  db.exec('BEGIN IMMEDIATE');
  try{for(const m of movies){
    upsert.run(m.id,m.title,m.originalTitle||'',m.year||null,JSON.stringify(m.genres||[]),JSON.stringify(m.country||[]),m.duration??null,m.director||'',JSON.stringify(m.actors||[]),m.description||'',m.poster||'',m.rating??null,m.type||'movie',m.sourceId||m.id.replace(/^wikidata:/,''),new Date().toISOString());
    ftsDelete.run(m.id);ftsInsert.run(m.id,m.title,m.originalTitle||'',m.director||'',(m.actors||[]).join(' '));
  }db.exec('COMMIT')}catch(error){db.exec('ROLLBACK');throw error}
}

function fromRow(row) { return {
  id:row.id,title:row.title,originalTitle:row.original_title||row.title,year:row.year,
  genres:JSON.parse(row.genres_json||'[]'),country:JSON.parse(row.country_json||'[]'),duration:row.duration,
  director:row.director||'',actors:JSON.parse(row.actors_json||'[]'),description:row.description||'',poster:row.poster||'',rating:row.rating,
  type:row.type||'movie',mood:[],moods:{},pacing:null,emotionalIntensity:null,tension:null,humor:null,romance:null,darkness:null,
  intellectualComplexity:null,comfortLevel:null,actionLevel:null,predictability:null,realism:null,fantasyLevel:null,rewatchability:null,
  source:'wikidata',sourceId:row.source_id,genreText:JSON.parse(row.genres_json||'[]').join(' · ')
}; }

export function findMovie(db,id) {
  const row=db.prepare('SELECT * FROM movies WHERE id=? OR source_id=? LIMIT 1').get(id,String(id).replace(/^wikidata:/,''));
  return row?fromRow(row):null;
}

export function listMovies(db,{query='',page=1,limit=1000}={}) {
  const q=String(query||'').trim();
  const p=Math.max(1,Number(page)||1),l=Math.max(1,Math.min(5000,Number(limit)||1000));
  let rows,total;
  if(q){
    const tokens=q.normalize('NFKC').split(/\s+/).filter(Boolean).map(t=>`"${t.replaceAll('"','""')}"*`).join(' AND ');
    try{
      total=db.prepare('SELECT COUNT(*) AS count FROM movies_fts WHERE movies_fts MATCH ?').get(tokens).count;
      rows=db.prepare('SELECT m.* FROM movies_fts f JOIN movies m ON m.id=f.id WHERE movies_fts MATCH ? ORDER BY m.year DESC,m.title COLLATE NOCASE LIMIT ? OFFSET ?').all(tokens,l,(p-1)*l);
    }catch{
      const like=`%${q.replaceAll('%','\\%').replaceAll('_','\\_')}%`;
      total=db.prepare('SELECT COUNT(*) AS count FROM movies WHERE title LIKE ? ESCAPE "\\" OR original_title LIKE ? ESCAPE "\\" OR director LIKE ? ESCAPE "\\"').get(like,like,like).count;
      rows=db.prepare('SELECT * FROM movies WHERE title LIKE ? ESCAPE "\\" OR original_title LIKE ? ESCAPE "\\" OR director LIKE ? ESCAPE "\\" ORDER BY year DESC,title COLLATE NOCASE LIMIT ? OFFSET ?').all(like,like,like,l,(p-1)*l);
    }
  } else {
    total=db.prepare('SELECT COUNT(*) AS count FROM movies').get().count;
    rows=db.prepare('SELECT * FROM movies ORDER BY year DESC,title COLLATE NOCASE LIMIT ? OFFSET ?').all(l,(p-1)*l);
  }
  return {items:rows.map(fromRow),total,page:p,limit:l};
}
