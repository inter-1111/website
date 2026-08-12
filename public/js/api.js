const API = {
  async _req(method, url, body) {
    const opts = { method, headers: {}, credentials: 'same-origin' };
    if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    const res = await fetch(url, opts);
    let data = {};
    try { data = await res.json(); } catch (e) {  }
    if (!res.ok) { const err = new Error(data.error || 'Request failed'); err.status = res.status; err.data = data; throw err; }
    return data;
  },
  get(url) { return this._req('GET', url); },
  post(url, body) { return this._req('POST', url, body || {}); },
  put(url, body) { return this._req('PUT', url, body || {}); },
  del(url) { return this._req('DELETE', url); },
};

