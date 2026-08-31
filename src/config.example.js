/* Copy this file to src/config.js and fill in your project's two values.
   build.js picks up src/config.js automatically and inlines it ahead of
   everything else. Without it the site runs on its founding messages alone,
   which is a working site — just not a shared one.

   Both values below are safe to commit. The URL is public, and the key below is
   the one Supabase designs to be published in client code: it names the project,
   it does not authorise anything. The database refuses every direct write and
   exposes only three functions, each of which re-checks moderation and rate
   limits for itself.

   Use the PUBLISHABLE key (sb_publishable_…) or, on an older project, the legacy
   ANON key (starts eyJ). Either works — the app detects which it has.

   Do NOT use the SECRET key (sb_secret_…) or the legacy SERVICE_ROLE key. Those
   bypass every rule in the database. They must never appear in this file, in the
   repo, or anywhere a browser can reach. */

window.RDF_CONFIG = {
  supabase: {
    url: 'https://YOUR-PROJECT-REF.supabase.co',
    anonKey: 'sb_publishable_YOUR_KEY_HERE'
  }
};
