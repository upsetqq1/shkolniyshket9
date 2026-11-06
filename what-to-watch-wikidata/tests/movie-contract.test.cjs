const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const htmlPath = path.join(__dirname, '..', 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');
const catalogStart = html.indexOf('const DEMO_MOVIE_CATALOG = [');
const catalogEnd = html.indexOf('\n];\nconst GENRE_RU', catalogStart) + 3;
const helpersStart = html.indexOf('const GENRE_RU=');
const helpersEnd = html.indexOf('let movies=[];', helpersStart);
const moodHelpersStart = html.indexOf('const MOOD_SURPRISE=');
const moodHelpersEnd = html.indexOf('function defaultUser(){', moodHelpersStart);
const userHelpersStart = moodHelpersEnd;
const userHelpersEnd = html.indexOf('function persist(){', userHelpersStart);
const engineStart = html.indexOf('const RECOMMENDATION_WEIGHTS=');
const engineEnd = html.indexOf('const recommendationEngine=', engineStart);
assert.ok(catalogStart >= 0 && catalogEnd > catalogStart, 'Demo catalog source found');
assert.ok(helpersStart >= 0 && helpersEnd > helpersStart, 'Movie normalizer source found');
assert.ok(moodHelpersStart >= 0 && moodHelpersEnd > moodHelpersStart, 'Mood selection helpers found');
assert.ok(userHelpersStart >= 0 && userHelpersEnd > userHelpersStart, 'User normalization source found');
assert.ok(engineStart >= 0 && engineEnd > engineStart, 'Recommendation engine source found');

const context = vm.createContext({
  currentUser: null,
  movies: [],
  console,
});
vm.runInContext(html.slice(catalogStart, catalogEnd), context);
vm.runInContext(html.slice(helpersStart, helpersEnd), context);
vm.runInContext(html.slice(moodHelpersStart, moodHelpersEnd), context);
vm.runInContext(html.slice(userHelpersStart, userHelpersEnd), context);
vm.runInContext(html.slice(engineStart, engineEnd), context);
const get = (expression) => vm.runInContext(expression, context);

assert.equal(get('normalizeScore(0, 1)'), 0);
assert.equal(get('normalizeScore(0.5, 1)'), 0.5);
assert.equal(get('normalizeScore(1, 1)'), 1);
assert.equal(get('clamp01(-0.5)'), 0);
assert.equal(get('clamp01(1.5)'), 1);
assert.equal(get('normalizeScore(null, 10)'), null);
assert.equal(get('scoreSimilarity(0.8, 0.8)'), 1);
assert.ok(Math.abs(get('scoreSimilarity(0.2, 0.8)') - 0.4) < 1e-12);
assert.equal(get('scoreSimilarity(null, 0.8)'), null);
assert.equal(get('pacingSimilarity("slow", "Медленный и атмосферный")'), 1);
assert.ok(get('pacingSimilarity("slow", "Быстрый и динамичный")') < 1);
assert.deepEqual(Array.from(get('toggleMoodSelection([" Хочу расслабиться"], " Хочу посмеяться")')), [" Хочу расслабиться", " Хочу посмеяться"]);
assert.deepEqual(Array.from(get('toggleMoodSelection([" Хочу посмеяться"], MOOD_SURPRISE)')), [" Не знаю — выбери за меня"]);
assert.deepEqual(Array.from(get('normalizeMoodSelection(" Хочу подумать")')), [" Хочу подумать"]);
assert.match(html, /if\(id==="favorites"\)renderFavorites\(\)/, 'Favorites list is rendered during navigation');
assert.match(html, /classList\.toggle\("on",!!currentUser\.profile\.rewatch\)/, 'Rewatch toggle reflects persisted profile state');

const migratedUser = get(`normalizeUser({id:"u1",name:"Test",onboardingAnswers:{favoriteMovies:["favorite-1"],rewatchPreference:"Да, предложи любимое время от времени"},profile:{favoriteMovies:["favorite-1"],rewatch:false},watchHistory:[],dailyMoodAnswers:{mood:" Хочу расслабиться"}})`);
assert.deepEqual(Array.from(migratedUser.watchHistory), ["favorite-1"]);
assert.equal(migratedUser.profile.rewatch, false, 'Saved rewatch toggle survives normalization');
assert.deepEqual(Array.from(migratedUser.dailyMoodAnswers.mood), [" Хочу расслабиться"], 'Old single mood migrates to an array');
assert.equal(get(`normalizeUser({id:"u2",onboardingAnswers:{rewatchPreference:"Нет, хочу только новое"}}).profile.rewatch`), false, 'Legacy users derive the initial toggle from onboarding');

const catalogInfo = get(`(() => {
  const catalog = DEMO_MOVIE_CATALOG.map(movieObj);
  const numeric = ["emotionalIntensity","tension","humor","romance","darkness","intellectualComplexity","comfortLevel","actionLevel","predictability","realism","fantasyLevel","rewatchability"];
  const sourceNumeric = [...numeric,"emotional","intellect","comfort","action","rewatch"];
  const required = ["id","title","originalTitle","year","genres","country","duration","director","actors","description","poster","rating","type"];
  return { count: catalog.length, rawViolations: DEMO_MOVIE_CATALOG.flatMap(m => [...sourceNumeric.filter(k => m[k] !== undefined && (m[k] < 0 || m[k] > 1)).map(k => [m.id,k,m[k]]), ...Object.entries(m.moods||{}).filter(([,v]) => v !== null && (v < 0 || v > 1)).map(([k,v]) => [m.id,"moods."+k,v])]),
    violations: catalog.flatMap(m => [...numeric.filter(k => m[k] !== null && (m[k] < 0 || m[k] > 1)).map(k => [m.id,k,m[k]]), ...Object.entries(m.moods).filter(([,v]) => v !== null && (v < 0 || v > 1)).map(([k,v]) => [m.id,"moods."+k,v])]),
    missingPrediction: catalog.filter(m => m.predictability === null).length,
    invalidPacing: catalog.filter(m => m.pacing !== null && !["slow","moderate","fast","very_fast"].includes(m.pacing)).length,
    missingFields: catalog.flatMap(m => required.filter(k => !(k in m)).map(k => [m.id,k])),
    aliases: catalog.filter(m => ["runtime","emotional","intellect","comfort","action","rewatch"].some(k => Object.hasOwn(m,k))).length };
})()`);
assert.equal(catalogInfo.count, 262);
assert.deepEqual(Array.from(catalogInfo.rawViolations), []);
assert.deepEqual(Array.from(catalogInfo.violations), []);
assert.equal(catalogInfo.missingPrediction, 262);
assert.equal(catalogInfo.invalidPacing, 0);
assert.deepEqual(Array.from(catalogInfo.missingFields), []);
assert.equal(catalogInfo.aliases, 0);

const engine = get('new RecommendationEngine()');
context.engine = engine;
const baseMovie = {
  id: 'target', title: 'Target', originalTitle: 'Target', year: 2020, genres: ['drama'], country: ['USA'],
  duration: 100, director: '', actors: [], description: '', poster: '', rating: 7, type: 'movie', pacing: 'moderate',
  emotionalIntensity: 0.8, tension: 0.5, humor: 0.5, romance: 0.5, darkness: 0.5,
  intellectualComplexity: 0.5, comfortLevel: 0.5, actionLevel: 0.5, predictability: 0.5, realism: 0.5,
  fantasyLevel: 0.5, rewatchability: 0.5, moods: {}, endingType: '', characterTypes: [],
};
context.baseMovie = baseMovie;
context.profile = { preferredEmotionalIntensity: 0.8, preferredGenres: [], dislikedGenres: [], preferredPacing: '', preferredPlotComplexity: '', preferredPredictability: '', preferredAtmosphere: [], preferredEndingType: [], preferredCharacterTypes: [], preferredFormats: [], preferredFilmAge: '', prefersInternationalCinema: '', prefersRealisticStories: '', preferredDuration: '' };
context.user = { profile: context.profile, watchHistory: [], savedMovies: [], likedMovies: [], dislikedMovies: [], ratings: [] };
context.daily = { mood: '', genres: [], format: 'Без разницы', availableTime: 'Неважно', newContent: false };
const score = (movie, user = context.user, daily = context.daily, catalog = [movie]) => {
  context.movieArg = movie; context.userArg = user; context.dailyArg = daily; context.catalogArg = catalog;
  return get('engine.scoreMovie(movieArg,userArg,dailyArg,catalogArg).score');
};
const near = { ...baseMovie, id: 'near', emotionalIntensity: 0.8 };
const far = { ...baseMovie, id: 'far', emotionalIntensity: 0.2 };
assert.ok(score(near) > score(far), 'matching emotional intensity scores higher');
const moodMovie = { ...baseMovie, comfortLevel: 0.8, tension: 0.2, humor: 0.4 };
context.moodMovie = moodMovie;
assert.ok(Math.abs(get('engine.moodScore(moodMovie,{mood:[" Хочу расслабиться"," Хочу посмеяться"],genres:[]})') - 0.6) < 1e-12, 'selected mood matches are averaged');
const horror = { ...baseMovie, id: 'horror', genres: ['horror'] };
const comedy = { ...baseMovie, id: 'comedy', genres: ['comedy'] };
const dislikedUser = { ...context.user, profile: { ...context.profile, dislikedGenres: ['Ужасы'] } };
assert.ok(score(comedy, dislikedUser) > score(horror, dislikedUser), 'disliked genre receives a penalty');
const favoriteUnwatched = { ...baseMovie, id: 'favorite' };
const favoriteUser = { ...context.user, profile: { ...context.profile, favoriteMovies: ['favorite'] }, watchHistory: [] };
assert.ok(score(favoriteUnwatched, favoriteUser, { ...context.daily, newContent: true }) > -1000, 'favorite is not treated as watched');
const watchedFavorite = { ...baseMovie, id: 'watched-favorite' };
const rewatchOff = { ...context.user, profile: { ...context.profile, favoriteMovies: ['watched-favorite'], rewatch: false }, watchHistory: ['watched-favorite'] };
const rewatchOn = { ...context.user, profile: { ...context.profile, favoriteMovies: ['watched-favorite'], rewatch: true }, watchHistory: ['watched-favorite'] };
assert.ok(score(watchedFavorite, rewatchOff) <= -1000, 'watched favorite is excluded when rewatch is off');
assert.ok(score(watchedFavorite, rewatchOn) > -1000, 'watched favorite may be recommended when rewatch is on');
const watchedUser = { ...context.user, watchHistory: ['target'] };
assert.ok(score(baseMovie, watchedUser, { ...context.daily, newContent: true }) <= -1000, 'watched title is excluded in new-content mode');

console.log('Movie/app checks passed: 262 normalized catalog records; numeric ranges; multi-mood selection; rewatch persistence; favorite-to-history migration; scoring and watch-history behavior.');


