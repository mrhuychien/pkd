// Reactive store with TTL-based caching. Pub/sub for views.

const subscribers = new Map();   // key → Set<callback>
const data        = new Map();   // key → { value, expiresAt }

function notify(key) {
    const subs = subscribers.get(key);
    if (subs) subs.forEach((cb) => { try { cb(get(key)); } catch (e) { console.error(e); } });
}

export function get(key) {
    const entry = data.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
        data.delete(key);
        return undefined;
    }
    return entry.value;
}

export function set(key, value, ttlMs) {
    data.set(key, {
        value,
        expiresAt: ttlMs ? Date.now() + ttlMs : null,
    });
    notify(key);
}

export function invalidate(key) {
    if (key) {
        data.delete(key);
        notify(key);
    } else {
        data.clear();
        subscribers.forEach((_subs, k) => notify(k));
    }
}

export function subscribe(key, cb) {
    if (!subscribers.has(key)) subscribers.set(key, new Set());
    subscribers.get(key).add(cb);
    return () => subscribers.get(key)?.delete(cb);
}

/** Convenience: get cached value if fresh, else fetch via `loader()` and cache. */
export async function ensure(key, loader, ttlMs) {
    const cached = get(key);
    if (cached !== undefined) return cached;
    const value = await loader();
    set(key, value, ttlMs);
    return value;
}

export const TTL = {
    SHORT:  2 * 60 * 1000,   //  2 min — dashboard summary, outstanding
    MEDIUM: 10 * 60 * 1000,  // 10 min — promotions, customer info
    LONG:   30 * 60 * 1000,  // 30 min — items, prices
};
