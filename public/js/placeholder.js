const Placeholder = {
  _palette: [
    ['#e7ded0', '#3a3226'], ['#ddd6c9', '#4a3f2c'], ['#e3cfae', '#5a4526'],
    ['#d9e0dc', '#2f4038'], ['#e6d9d2', '#5a362b'], ['#dce1e8', '#2c3a4a'],
  ],
  _hash(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) { h = (h << 5) - h + str.charCodeAt(i); h |= 0; }
    return Math.abs(h);
  },
  productImage(seed, label) {
    const [bg, fg] = this._palette[this._hash(seed) % this._palette.length];
    const initials = (label || '?').split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 400">
      <rect width="300" height="400" fill="${bg}"/>
      <text x="150" y="215" font-family="Georgia, serif" font-size="56" fill="${fg}" text-anchor="middle" opacity="0.55">${initials}</text>
    </svg>`;
    return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
  },
  brandLogo(seed, name) {
    const [bg, fg] = this._palette[this._hash(seed) % this._palette.length];
    const initial = (name || '?')[0].toUpperCase();
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <circle cx="50" cy="50" r="50" fill="${fg}"/>
      <text x="50" y="64" font-family="Georgia, serif" font-size="40" fill="#fff" text-anchor="middle">${initial}</text>
    </svg>`;
    return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
  },
  brandCover(seed, name) {
    const [bg, fg] = this._palette[this._hash(seed + 'c') % this._palette.length];
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 270">
      <rect width="480" height="270" fill="${bg}"/>
      <text x="240" y="145" font-family="Georgia, serif" font-size="30" fill="${fg}" text-anchor="middle" opacity="0.6">${(name||'')}</text>
    </svg>`;
    return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
  },
  categoryImage(seed, label) {
    const [bg, fg] = this._palette[this._hash(seed + 'cat') % this._palette.length];
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 500">
      <rect width="400" height="500" fill="${bg}"/>
      <text x="200" y="270" font-family="Georgia, serif" font-size="34" fill="${fg}" text-anchor="middle" opacity="0.5">${label}</text>
    </svg>`;
    return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
  },
  heroImage() {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900">
      <rect width="1600" height="900" fill="#3d3527"/>
    </svg>`;
    return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
  },
};

