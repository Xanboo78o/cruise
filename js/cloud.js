// cloud.js — saves follow your email. Supabase magic link: you type your email,
// click the link it sends, and your progress (cash, medals, cars, figurines)
// lives in cruise_saves under your account. Bests go to cruise_bests, which
// everyone can read — that's the leaderboard. Offline, everything still works
// from localStorage; signing in merges the two, best-of.

const URL = 'https://wsjrcoibrigewmwospva.supabase.co';
const KEY = 'sb_publishable_n88dYo7wUYb_utwKiQT3uQ_HGOtXDZb';

export class Cloud {
  constructor() { this.sb = null; this.user = null; this.ready = this.init(); this.onChange = null; }

  async init() {
    try {
      const mod = await import('https://esm.sh/@supabase/supabase-js@2');
      this.sb = mod.createClient(URL, KEY, { auth: { persistSession: true, detectSessionInUrl: true } });
      const { data } = await this.sb.auth.getSession();
      this.user = data.session ? data.session.user : null;
      this.sb.auth.onAuthStateChange((_e, session) => { this.user = session ? session.user : null; if (this.onChange) this.onChange(this.user); });
      return true;
    } catch (e) { console.warn('cloud off', e); return false; }
  }

  get email() { return this.user ? this.user.email : null; }

  async signIn(email) {
    await this.ready; if (!this.sb) return { error: 'offline' };
    const { error } = await this.sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname } });
    return { error: error ? error.message : null };
  }
  async signOut() { await this.ready; if (this.sb) await this.sb.auth.signOut(); this.user = null; }

  // pull the cloud save; returns the data object or null
  async load() {
    await this.ready; if (!this.sb || !this.user) return null;
    const { data } = await this.sb.from('cruise_saves').select('data').eq('user_id', this.user.id).maybeSingle();
    return data ? data.data : null;
  }
  async save(obj) {
    await this.ready; if (!this.sb || !this.user) return false;
    const { error } = await this.sb.from('cruise_saves').upsert({ user_id: this.user.id, email: this.user.email, data: obj, updated_at: new Date().toISOString() });
    return !error;
  }
  async pushBest(eventId, value, name, car) {
    await this.ready; if (!this.sb || !this.user) return false;
    const { error } = await this.sb.from('cruise_bests').upsert({ user_id: this.user.id, event_id: eventId, value, name: name || 'Oo', car, updated_at: new Date().toISOString() });
    return !error;
  }
  async bests(eventId, n = 10) {
    await this.ready; if (!this.sb) return [];
    const { data } = await this.sb.from('cruise_bests').select('name,value,car').eq('event_id', eventId).order('value', { ascending: false }).limit(n);
    return data || [];
  }
}

// merge two progress blobs: more cash wins, medals max, bests max, unions of sets
export function mergeProgress(a, b) {
  if (!a) return b; if (!b) return a;
  const out = { ...a };
  out.cash = Math.max(a.cash || 0, b.cash || 0);
  out.races = Math.max(a.races || 0, b.races || 0); out.wins = Math.max(a.wins || 0, b.wins || 0);
  out.medals = { ...(a.medals || {}) }; for (const k in (b.medals || {})) out.medals[k] = Math.max(out.medals[k] || 0, b.medals[k]);
  out.best = { ...(a.best || {}) }; for (const k in (b.best || {})) out.best[k] = Math.max(out.best[k] ?? -1e9, b.best[k]);
  out.owned = { ...(a.owned || {}), ...(b.owned || {}) };
  out.stickers = [...new Set([...(a.stickers || []), ...(b.stickers || [])])];
  out.found = { fig: [...new Set([...(a.found?.fig || []), ...(b.found?.fig || [])])], photo: [...new Set([...(a.found?.photo || []), ...(b.found?.photo || [])])] };
  return out;
}
