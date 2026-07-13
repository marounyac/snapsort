// Supabase project settings — filled in once the project exists.
// The anon key is PUBLIC by design: every read/write is checked server-side
// by Row Level Security, so committing it here is safe.
// While these are empty, all social features stay hidden and SnapSort works
// exactly as the solo, on-device app it always was.
window.SNAPSORT_CONFIG = {
  supabaseUrl: '',      // e.g. 'https://abcdefghijkl.supabase.co'
  supabaseAnonKey: '',  // Settings → API → anon public key
};
