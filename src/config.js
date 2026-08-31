/* Rainbow Deep Field — backend configuration.
   build.js inlines this ahead of everything else.

   Both values here are public by design and belong in the repo. The URL names
   the project; the publishable key identifies it and authorises nothing on its
   own. Every write is refused at the database and has to go through one of three
   functions, each of which re-checks moderation and rate limits server-side.
   See supabase/schema.sql.

   The secret key (sb_secret_…) is a different thing entirely and must never
   appear here. */

window.RDF_CONFIG = {
  supabase: {
    url: 'https://tnppieyewrcgqwhcxqfv.supabase.co',
    anonKey: 'sb_publishable_tt3HnBxJsTczi-5P00o9Cg_ziWOBru9'
  }
};
