class Router {
  constructor() {
    this.routes = [];
  }

  add(method, pattern, handler) {
    const keys = [];
    const regexStr = pattern
      .replace(/\//g, '\\/')
      .replace(/:([A-Za-z0-9_]+)/g, (_, key) => { keys.push(key); return '([^\\/]+)'; });
    const regex = new RegExp(`^${regexStr}$`);
    this.routes.push({ method, regex, keys, handler });
  }

  get(p, h) { this.add('GET', p, h); }
  post(p, h) { this.add('POST', p, h); }
  put(p, h) { this.add('PUT', p, h); }
  del(p, h) { this.add('DELETE', p, h); }

  match(method, urlPath) {
    for (const r of this.routes) {
      if (r.method !== method) continue;
      const m = urlPath.match(r.regex);
      if (!m) continue;
      const params = {};
      r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      return { handler: r.handler, params };
    }
    return null;
  }
}

module.exports = Router;
