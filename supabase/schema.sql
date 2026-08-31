-- Rainbow Deep Field — the shared sky.
--
-- Paste this whole file into the Supabase SQL editor and run it once.
--
-- Design rules this schema exists to enforce:
--   1. The browser holds only the anon key, which is public by design. So the
--      anon role may INSERT nothing directly and UPDATE nothing at all. Every
--      write goes through a security-definer function that decides for itself
--      what is allowed.
--   2. Client-side moderation is a courtesy, not a control — anyone can post
--      straight to the API with curl. The same rules are therefore enforced
--      here, in the database, where they cannot be skipped.
--   3. Rate limiting is by IP, server-side, for the same reason.

-- pgcrypto gives us sha256 and random bytes. Supabase ships it; this is here so
-- the script also works on a bare Postgres.
create extension if not exists pgcrypto with schema extensions;

-- ───────────────────────────────────────────────────────────── the messages

create table if not exists public.messages (
  id          text primary key,
  body        text not null,
  ts          bigint not null,
  lights      integer not null default 0,
  reports     integer not null default 0,
  hidden      boolean not null default false,
  created_at  timestamptz not null default now()
);

create index if not exists messages_visible_idx
  on public.messages (created_at desc) where not hidden;

alter table public.messages enable row level security;

-- Anyone may read the sky, but only the parts of it that are still visible.
drop policy if exists "read visible messages" on public.messages;
create policy "read visible messages"
  on public.messages for select
  to anon, authenticated
  using (not hidden);

-- Deliberately no insert/update/delete policies. Without one, those operations
-- are denied for anon — which is the point. Writes happen through the functions
-- below, which run as the owner.

-- ─────────────────────────────────────────────────────────── rate limiting

create table if not exists public.senders (
  ip_hash    text primary key,
  last_at    timestamptz not null default now(),
  today      date not null default current_date,
  count_today integer not null default 0
);

alter table public.senders enable row level security;   -- no policies: nobody reads this

-- The caller's IP, hashed with a salt so the table holds no addresses. Supabase
-- puts the original client IP in x-forwarded-for; take the first hop.
create or replace function public.rdf_ip_hash()
returns text language plpgsql stable set search_path = public, extensions as $$
declare
  hdrs json;
  fwd  text;
begin
  begin
    hdrs := current_setting('request.headers', true)::json;
  exception when others then
    return 'unknown';
  end;
  if hdrs is null then return 'unknown'; end if;
  fwd := split_part(coalesce(hdrs ->> 'x-forwarded-for', 'unknown'), ',', 1);
  return encode(digest(btrim(fwd) || '::rainbow-deep-field', 'sha256'), 'hex');
end $$;

-- ──────────────────────────────────────────────────────────────  moderation

-- Fold the usual evasions together before matching, so "sh1t" and "s h i t"
-- both collapse onto the same string the blocklist is checked against.
create or replace function public.rdf_flatten(t text)
returns text language sql immutable as $$
  select regexp_replace(
           translate(lower(t), '0134578@$!|', 'oieastbasii'),
           '[^a-z]', '', 'g')
$$;

-- Returns null when the text is acceptable, otherwise the reason it is not.
create or replace function public.rdf_reject(t text)
returns text language plpgsql immutable as $$
declare
  n       text;
  flat    text;
  spaced  text;
  word    text;
  phrase  text;
  toks    text[];
  parts   text[];
  run     text;
  i       int;
  j       int;
  denied  boolean;
  -- Whole words, on word boundaries. The previous version collapsed every space
  -- and looked for these as substrings, which refused "who remembers" because
  -- whoremembers contains whore -- and with it "whoever", "grapefruit",
  -- "peacock" and "auspicious". Two of the founding messages were unpublishable.
  blocked text[] := array[
    'fuck','fucking','shit','bitch','cunt','asshole','arsehole','bastard',
    'dick','cock','pussy','whore','slut','rape','raping','rapist',
    'nigg[a-z]*','fagg[a-z]*','retard','retarded','tranny','kike','spic',
    'chink','wetback','kys','suicide','nazi','hitler','porn','crypto',
    'nft','airdrop','subscribe'
  ];
  -- compounds with no innocent substring reading, so these still match anywhere
  frags text[] := array[
    'killyourself','killurself','hangyourself','onlyfans',
    'freemoney','buynow','clickhere','followme','promocode'
  ];
  -- cruelty built out of ordinary words, which a profanity list never sees
  harsh text[] := array[
    'worthless','useless','pathetic','hopeless','disgusting','repulsive',
    'unlovable','unloved','unwanted','stupid','idiot','idiotic','moron',
    'moronic','dumb','ugly','hideous','loser','failure','pitiful',
    'contemptible','insufferable','despicable','vile'
  ];
  spite text[] := array[
    'nobody loves you','no one loves you','nobody cares about you',
    'no one cares about you','nobody will miss you','no one will miss you',
    'everyone hates you','everybody hates you','nobody likes you',
    'no one likes you','you should give up','you should quit',
    'you deserve to suffer','you deserve this','you are a mistake',
    'you were a mistake','go away and never','drop dead','shut up',
    'you ruin everything','you always ruin','the world is better without you',
    'nobody wants you here','you dont belong here','you do not belong here'
  ];
  link_w text[] := array[
    'are','is','was','were','am','be','been','being','r','look','looks','looked',
    'seem','seems','seemed','sound','sounds','feel','feels','felt','a','an','the',
    'so','such','just','really','totally','completely','absolutely','utterly',
    'always','still','pretty','very','too','quite','have','has','had','all',
    'both','kind','sort','bit','complete','total','utter','absolute','right',
    'proper','massive','huge','big','giant','one'
  ];
  neg_w  text[] := array[
    'not','never','no','arent','isnt','aint','wasnt','werent','dont','doesnt',
    'didnt','cant','cannot','wont','couldnt','shouldnt','neither','nor',
    'anything','but','far','less','least','stop','stopped','hardly','barely'
  ];
begin
  t := btrim(t);
  if length(t) < 8   then return 'too short'; end if;
  if length(t) > 160 then return 'too long'; end if;
  if t ~* '(https?://|www\.|\.(com|net|org|io|co|xyz|ru)\y)' then return 'no links'; end if;
  if t ~* '[[:alnum:]._%+-]+@[[:alnum:].-]+\.[a-z]{2,}'      then return 'no email'; end if;
  if t ~  '(^|[[:space:]])[@#][[:alnum:]_]{2,}'              then return 'no handles'; end if;
  if t ~  '[+]?[0-9][0-9[:space:]().-]{7,}[0-9]'             then return 'no numbers'; end if;
  if t ~  '(.)\1{5,}'                                        then return 'repeated characters'; end if;
  if length(regexp_replace(t, '[^A-Za-z]', '', 'g')) > 12
     and t = upper(t)                                        then return 'no shouting'; end if;

  -- normalised, spaces kept
  n := regexp_replace(lower(t), '[^a-z ]', '', 'g');
  n := btrim(regexp_replace(n, ' +', ' ', 'g'));
  /* "f u c k" collapses; "who remembers" does not. Done by walking the tokens
     rather than with a regex, because a global replace cannot collapse a run
     it has already half-joined — the first attempt turned "f u c k" into
     "fu ck" and stopped there, which let the word straight through. */
  parts := string_to_array(n, ' ');
  spaced := '';
  run := '';
  for i in 1 .. coalesce(array_length(parts, 1), 0) loop
    if length(parts[i]) = 1 then
      run := run || parts[i];
    else
      if run <> '' then spaced := spaced || ' ' || run; run := ''; end if;
      spaced := spaced || ' ' || parts[i];
    end if;
  end loop;
  if run <> '' then spaced := spaced || ' ' || run; end if;
  spaced := btrim(spaced);
  flat := public.rdf_flatten(t);

  foreach word in array blocked loop
    if n ~ ('\y' || word || '\y') or spaced ~ ('\y' || word || '\y') then
      return 'unkind';
    end if;
  end loop;
  foreach word in array frags loop
    if position(word in flat) > 0 then return 'unkind'; end if;
  end loop;
  foreach phrase in array spite loop
    if position(phrase in n) > 0 then return 'unkind'; end if;
  end loop;

  -- a demeaning word predicated of the reader, unless the sentence denies it
  toks := string_to_array(n, ' ');
  for i in 1 .. coalesce(array_length(toks, 1), 0) loop
    if toks[i] in ('you','youre','ur','u','yous') then
      denied := false;
      j := i + 1;
      while j <= least(array_length(toks, 1), i + 6) loop
        if toks[j] = any (harsh) then
          if not denied then return 'unkind'; end if;
          exit;
        elsif toks[j] = any (neg_w) then
          denied := true;
        elsif not (toks[j] = any (link_w)) then
          exit;
        end if;
        j := j + 1;
      end loop;
    end if;
  end loop;

  return null;
end $$;

-- ────────────────────────────────────────────────────────────────── writing

-- Leave a message. The client proposes an id (so its own share links agree with
-- the server); anything malformed or already taken gets a fresh one.
create or replace function public.leave_message(p_text text, p_id text default null)
returns table (id text, ts bigint)
language plpgsql security definer set search_path = public, extensions as $$
declare
  why      text;
  ip       text;
  s        public.senders%rowtype;
  new_id   text;
  new_ts   bigint;
begin
  why := public.rdf_reject(p_text);
  if why is not null then
    raise exception 'rejected: %', why using errcode = 'check_violation';
  end if;

  ip := public.rdf_ip_hash();
  select * into s from public.senders where ip_hash = ip for update;

  if found then
    if s.today <> current_date then
      update public.senders set today = current_date, count_today = 0 where ip_hash = ip;
      s.count_today := 0;
    end if;
    if now() - s.last_at < interval '3 minutes' then
      raise exception 'slow down' using errcode = 'check_violation';
    end if;
    if s.count_today >= 12 then
      raise exception 'enough for today' using errcode = 'check_violation';
    end if;
    update public.senders
       set last_at = now(), count_today = count_today + 1
     where ip_hash = ip;
  else
    insert into public.senders (ip_hash) values (ip);
  end if;

  new_ts := (extract(epoch from now()) * 1000)::bigint;   -- the server decides when
  new_id := case when p_id ~ '^[a-z0-9]{5,12}$' then p_id else null end;
  if new_id is null or exists (select 1 from public.messages m where m.id = new_id) then
    new_id := substr(encode(gen_random_bytes(8), 'hex'), 1, 8);
  end if;

  insert into public.messages (id, body, ts) values (new_id, btrim(p_text), new_ts);
  return query select new_id, new_ts;
end $$;

-- Light one up. Cheap, idempotent-ish, deliberately not audited — the client
-- remembers what it has already lit.
create or replace function public.light_message(p_id text)
returns integer
language plpgsql security definer set search_path = public, extensions as $$
declare n integer;
begin
  update public.messages set lights = lights + 1
   where id = p_id and not hidden
   returning lights into n;
  return coalesce(n, 0);
end $$;

-- Report one. Three reports takes it out of the sky until you look at it.
create or replace function public.report_message(p_id text)
returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  update public.messages
     set reports = reports + 1,
         hidden  = (reports + 1) >= 3
   where id = p_id;
end $$;

-- Only these three entry points are callable from the browser.
revoke all on function public.leave_message(text, text) from public;
revoke all on function public.light_message(text)       from public;
revoke all on function public.report_message(text)      from public;
grant execute on function public.leave_message(text, text) to anon, authenticated;
grant execute on function public.light_message(text)       to anon, authenticated;
grant execute on function public.report_message(text)      to anon, authenticated;

-- ──────────────────────────────────────────────────── your moderation views

-- Anything people have flagged, worst first. Check this occasionally.
create or replace view public.flagged as
  select id, body, reports, hidden, lights, created_at
    from public.messages
   where reports > 0
   order by reports desc, created_at desc;

-- To pull something manually:   update messages set hidden = true where id = '…';
-- To put it back:               update messages set hidden = false, reports = 0 where id = '…';
