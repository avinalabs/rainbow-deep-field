-- Moderation tests for rdf_reject, runnable against any Postgres that has the
-- schema loaded:
--
--   psql "$DATABASE_URL" -f supabase/moderation-tests.sql
--
-- The client in src/08-store.js carries the same rules, and both must agree —
-- the client's are a courtesy so somebody gets told before they hit send, and
-- these are the ones that actually hold, because a determined poster skips the
-- page entirely and POSTs to PostgREST with curl.
--
-- Expected: 14 of 14 hostile caught, 14 of 14 kind passed, and every one of the
-- founding messages allowed.

create temp table hostile(t text);
insert into hostile(t) values
 ('you are all worthless and I hate every one of you'),
 ('you are an idiot and always have been'),
 ('youre pathetic and everyone knows it'),
 ('nobody loves you and nobody ever will'),
 ('ur useless, just give up already'),
 ('you should give up, honestly'),
 ('everyone hates you here'),
 ('the world is better without you in it'),
 ('you are a mistake'),
 ('u are such a complete idiot honestly'),
 ('fuck this whole place and everyone in it'),
 ('f u c k this place and all of you'),
 ('go and kill yourself you waste'),
 ('subscribe to my channel for free money');

create temp table kind(t text);
insert into kind(t) values
 ('you are not worthless, whatever today told you'),
 ('you were never a burden to the people who love you'),
 ('it is not too late and you are not too far behind'),
 ('you are anything but a failure'),
 ('the version of you that felt stupid was doing their best'),
 ('you have never been unwanted here'),
 ('nobody is hopeless, you included'),
 ('i hope it stops hurting'),
 ('to whoever got rejected today, it goes on'),
 ('i hope you find a grapefruit that is perfectly ripe'),
 ('the peacock at the zoo has no idea how good it looks'),
 ('who remembers what you were worried about last year'),
 ('i hope you laugh at something stupid today'),
 ('someone will find yours the way you found this one');

select 'hostile allowed through' as problem, t from hostile where public.rdf_reject(t) is null;
select 'kind wrongly refused' as problem, t, public.rdf_reject(t) from kind where public.rdf_reject(t) is not null;
select count(*) filter (where public.rdf_reject(t) is not null) as caught, count(*) as total from hostile;
select count(*) filter (where public.rdf_reject(t) is null) as passed, count(*) as total from kind;
