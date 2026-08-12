const { db } = require('../db');
const { sendJSON, readBody, getCurrentUser } = require('../util');
const { withImage } = require('./catalog');
const { buildProductQuery } = require('./products');

const fs = require('fs');
const path = require('path');

function loadFileConfig() {
  const configPath = path.join(__dirname, '..', 'assistant.config.json');
  try {
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, 'utf8');
      const parsed = JSON.parse(raw);
      return { url: parsed.url || '', key: parsed.apiKey || '', model: parsed.model || '' };
    }
  } catch (e) {
    console.error('[AI assistant] Failed to read assistant.config.json:', e.message);
  }
  return { url: '', key: '', model: '' };
}
const fileConfig = loadFileConfig();

const ASSISTANT_API_URL = process.env.ASSISTANT_API_URL || fileConfig.url || '';
const ASSISTANT_API_KEY = process.env.ASSISTANT_API_KEY || fileConfig.key || '';
const ASSISTANT_MODEL = process.env.ASSISTANT_MODEL || fileConfig.model || 'gpt-4o-mini';
const ASSISTANT_TIMEOUT_MS = 20000;

if (ASSISTANT_API_URL && ASSISTANT_API_KEY) {
  console.log(`[AI assistant] LLM mode ON — calling ${ASSISTANT_API_URL} (model: ${ASSISTANT_MODEL})`);
} else {
  console.log('[AI assistant] LLM mode OFF — using local rule-based engine. ' +
    'To enable LLM mode, create assistant.config.json in the project root (see assistant.config.example.json), ' +
    'or set ASSISTANT_API_URL / ASSISTANT_API_KEY / ASSISTANT_MODEL environment variables.');
}

const ACTION_LABELS = {
  search_products: 'View Results',
  open_product: 'Open Product',
  open_category: 'Open Category',
  open_brand: 'Open Brand',
  open_cart: 'Open Cart',
  open_orders: 'View Orders',
  open_wishlist: 'View Saved Items',
  open_profile: 'Open Profile',
  track_order: 'Track Order',
};

function tool_search_products(params) {
  const q = {};
  if (params.category) q.category = params.category;
  if (params.brand) q.brand = params.brand;
  if (params.color) q.color = params.color;
  if (params.maxPrice) q.maxPrice = params.maxPrice;
  if (params.minPrice) q.minPrice = params.minPrice;
  if (params.q) q.q = params.q;
  if (params.excludeId) q.excludeId = params.excludeId;
  q.sort = params.sort || 'featured';
  q.limit = 6;
  const { sql, args } = buildProductQuery(q);
  const rows = db.prepare(sql).all(...args);
  return rows.map(withImage);
}

function tool_open_category(slugOrName) {
  let cat = db.prepare('SELECT * FROM categories WHERE slug = ?').get(slugOrName);
  if (!cat) cat = db.prepare('SELECT * FROM categories WHERE LOWER(name) = LOWER(?)').get(slugOrName);
  return cat || null;
}

function tool_search_brands(term) {
  return db.prepare('SELECT * FROM brands WHERE LOWER(name) LIKE LOWER(?) LIMIT 5').all(`%${term}%`);
}

function tool_build_outfit({ color, brand, preferredCategory } = {}) {
  const picked = [];
  const usedIds = new Set();
  const take = (rows, n = 1) => {
    const out = [];
    for (const r of rows) {
      if (usedIds.has(r.id)) continue;
      out.push(r); usedIds.add(r.id);
      if (out.length >= n) break;
    }
    return out;
  };
  const search = (category) => tool_search_products({ category, color, brand, sort: 'featured' });

  const baseCategories = [preferredCategory, 'dresses', 'abayas', 'modest-sets'].filter(Boolean);
  let base = [];
  for (const cat of baseCategories) {
    base = take(search(cat), 1);
    if (base.length) break;
  }
  if (!base.length) {
    const top = take(search('tops-blouses'), 1);
    let bottom = take(search('pants-trousers'), 1);
    if (!bottom.length) bottom = take(search('skirts'), 1);
    base = [...top, ...bottom];
  }
  picked.push(...base);

  const topper = take(search('hijabs-scarves'), 1);
  picked.push(...topper);

  if (picked.length < 4) {
    let finisher = take(search('outerwear'), 1);
    if (!finisher.length) finisher = take(search('accessories'), 1);
    picked.push(...finisher);
  }

  return picked.slice(0, 4);
}

function tool_track_order(user, ref) {
  if (!user) return null;
  if (ref) {
    return db.prepare('SELECT * FROM orders WHERE user_id = ? AND order_number LIKE ?').get(user.id, `%${ref}%`);
  }
  return db.prepare('SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC LIMIT 1').get(user.id);
}

function catalogSummary(limit = 250) {
  const rows = db.prepare(`
    SELECT p.id, p.name, p.price, p.discount_price, b.name as brand, c.name as category, c.slug as category_slug
    FROM products p JOIN brands b ON b.id = p.brand_id JOIN categories c ON c.id = p.category_id
    WHERE p.active = 1 LIMIT ?
  `).all(limit);
  const colorStmt = db.prepare('SELECT DISTINCT color FROM product_variants WHERE product_id = ? AND color != \'\'');
  return rows.map(r => ({
    id: r.id, name: r.name, brand: r.brand, category: r.category_slug, price: r.discount_price || r.price,
    colors: colorStmt.all(r.id).map(c => c.color),
  }));
}

async function callLLM(message, context, user, history) {
  if (!ASSISTANT_API_URL || !ASSISTANT_API_KEY) return null;

  const brandsList = db.prepare('SELECT name, slug FROM brands').all();
  const categoriesList = db.prepare('SELECT name, slug, parent_id FROM categories').all();
  const ordersSummary = user
    ? db.prepare('SELECT order_number, status, total FROM orders WHERE user_id = ? ORDER BY created_at DESC LIMIT 5').all(user.id)
    : [];

  const system = `You are the Fashion Assistant for M3RAFSH, a marketplace for women's modest wear from independent local brands.
You have two jobs at once, and either can come up in the same conversation: (1) styling and modest-wear advice — occasion dressing, what to pair with what, fabric/coverage guidance, and building full outfits — and (2) helping the shopper find and navigate real products, brands, and categories on the site. Answer styling questions in your own words; when a real product would help, ground it in the actual catalog below.
When the shopper asks for an outfit, a "look", what to wear, or what goes with something (by occasion, color, vibe, or a specific piece), act as a stylist: pick 2–4 real, complementary items FROM DIFFERENT CATEGORIES in the catalog below that would genuinely work together as a coordinated outfit — e.g. a dress/abaya plus a hijab, or a top plus bottom plus a hijab, optionally plus outerwear or an accessory. Don't just return a list of similar items from one category. In "reply", briefly say why the pieces work together (color/silhouette/occasion), not just that you found them.
You are given the FULL product catalog and the shopper's current context below. Never invent products, brands, categories, ids or prices that are not in the catalog.
Respond ONLY with strict JSON, no markdown, no code fences, matching exactly this schema:
{"reply": string, "product_ids": number[], "action": {"type": "search_products"|"open_product"|"open_category"|"open_brand"|"open_cart"|"open_orders"|"open_wishlist"|"open_profile"|"track_order"|"none", "params": object}}
Rules:
- "reply" is warm and helpful. Pure styling questions and outfit recommendations can run a bit longer than product-search replies (a few sentences), since real advice needs room.
- "product_ids" is up to 4 ids taken EXACTLY from the catalog's "id" field, only when genuinely relevant. For outfit requests, prefer picking ids across different categories per the styling rule above, rather than several of the same type of item. Pure styling-advice questions with no matching product need can leave this empty.
- Use the conversation history below to stay consistent — if the shopper says "that one" or "cheaper than that" or is continuing a styling thread from a prior turn, resolve it against the history rather than asking them to repeat themselves.
- If the shopper is on a product page and asks something relative like "cheaper" or "similar", use currentProduct as the reference (same category, lower price for "cheaper").
- If asked about cart/orders/wishlist/profile while unauthenticated, still set the action type — the app will prompt login.
- "open_category" needs params {"slug": string} taken from CATEGORIES. "search_products" needs params among {category, brand, color, maxPrice, minPrice, q} (category/brand as slugs). "open_brand" needs {"slug": string} from BRANDS. "open_product" needs {"id": number}.
- Use "none" when just answering with no navigation (e.g. styling advice, comparing two products).

CATALOG: ${JSON.stringify(catalogSummary())}
BRANDS: ${JSON.stringify(brandsList)}
CATEGORIES: ${JSON.stringify(categoriesList)}
CONTEXT: ${JSON.stringify({ ...context, authenticated: !!user })}
RECENT ORDERS: ${JSON.stringify(ordersSummary)}`;

  const turns = Array.isArray(history) ? history.slice(-10) : [];
  const messages = [{ role: 'system', content: system }];
  turns.forEach(m => {
    if (m.role === 'user' && m.text) messages.push({ role: 'user', content: m.text });
    else if (m.role === 'assistant' && m.text) messages.push({ role: 'assistant', content: m.text });
  });
  messages.push({ role: 'user', content: message });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ASSISTANT_TIMEOUT_MS);
  try {
    const response = await fetch(ASSISTANT_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + ASSISTANT_API_KEY },
      signal: controller.signal,
      body: JSON.stringify({ model: ASSISTANT_MODEL, messages }),
    });
    clearTimeout(timeoutId);
    if (!response.ok) {
      const bodyText = await response.text().catch(() => '');
      console.error(`[AI assistant] LLM call failed — HTTP ${response.status}. Response body: ${bodyText.slice(0, 500)}`);
      return null;
    }

    const data = await response.json();
    let raw = data?.choices?.[0]?.message?.content;
    if (!raw) {
      console.error('[AI assistant] LLM response had no choices[0].message.content. Full response:', JSON.stringify(data).slice(0, 800));
      return null;
    }
    raw = raw.trim().replace(/^```json/, '').replace(/^```/, '').replace(/```$/, '').trim();

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      const match = raw.match(/\{[\s\S]*\}/);
      if (match) {
        try { parsed = JSON.parse(match[0]); } catch (e2) {}
      }
      if (!parsed) {
        console.error('[AI assistant] Could not parse LLM output as JSON. Raw output:', raw.slice(0, 500));
        return null;
      }
    }
    const ids = Array.isArray(parsed.product_ids) ? parsed.product_ids : [];
    const products = ids
      .map(id => db.prepare('SELECT * FROM products WHERE id = ? AND active = 1').get(id))
      .filter(Boolean)
      .map(withImage);

    const actions = [];
    const action = parsed.action;
    if (action && action.type && action.type !== 'none') {
      const label = ACTION_LABELS[action.type] || 'Open';
      actions.push({ type: action.type, label, payload: action.params || {} });
    }

    return { reply: parsed.reply || '...', actions, products, brands: [], _mode: 'llm' };
  } catch (e) {
    clearTimeout(timeoutId);
    if (e.name === 'AbortError') {
      console.error(`[AI assistant] LLM call timed out after ${ASSISTANT_TIMEOUT_MS}ms.`);
    } else {
      console.error('[AI assistant] LLM call threw an error:', e.message);
    }
    return null;
  }
}
const COLOR_WORDS = ['black', 'white', 'grey', 'gray', 'navy', 'blue', 'red', 'green', 'beige', 'brown', 'olive', 'pink', 'cream', 'khaki', 'orange', 'purple', 'yellow'];

function extractMaxPrice(text) {
  const m = text.match(/(?:under|below|less than|cheaper than|<)\s*\$?(\d+)/i);
  return m ? Number(m[1]) : null;
}
function extractMinPrice(text) {
  const m = text.match(/(?:over|above|more than|>)\s*\$?(\d+)/i);
  return m ? Number(m[1]) : null;
}
function extractColor(text) {
  const lower = text.toLowerCase();
  return COLOR_WORDS.find(c => lower.includes(c)) || null;
}
function extractCategoryWord(text) {
  const lower = text.toLowerCase();
  const ORDERED = [
    ['abayas', 'abayas'], ['abaya', 'abayas'],
    ['kaftans', 'tunics-kaftans'], ['kaftan', 'tunics-kaftans'], ['tunics', 'tunics-kaftans'], ['tunic', 'tunics-kaftans'],
    ['blouses', 'tops-blouses'], ['blouse', 'tops-blouses'], ['tops', 'tops-blouses'], ['top', 'tops-blouses'],
    ['dresses', 'dresses'], ['dress', 'dresses'],
    ['skirts', 'skirts'], ['skirt', 'skirts'],
    ['trousers', 'pants-trousers'], ['pants', 'pants-trousers'], ['pant', 'pants-trousers'],
    ['sets', 'modest-sets'], ['set', 'modest-sets'], ['co-ord', 'modest-sets'],
    ['outerwear', 'outerwear'], ['coat', 'outerwear'], ['cardigan', 'outerwear'],
    ['hijabs', 'hijabs-scarves'], ['hijab', 'hijabs-scarves'], ['scarves', 'hijabs-scarves'], ['scarf', 'hijabs-scarves'],
    ['loungewear', 'loungewear'], ['sleepwear', 'loungewear'],
    ['accessories', 'accessories'], ['accessory', 'accessories'],
  ];
  const found = ORDERED.find(([word]) => lower.includes(word));
  return found ? found[1] : null;
}
function extractBrandMention(text) {
  const brands = db.prepare('SELECT name, slug FROM brands').all();
  const lower = text.toLowerCase();
  return brands.find(b => lower.includes(b.name.toLowerCase())) || null;
}
const OCCASION_GUIDES = [
  { words: ['wedding', 'nikkah', 'walima'], category: 'dresses',
    reply: "For a wedding, an elegant maxi dress or a kaftan in a rich color works beautifully — pair it with a matching or contrasting hijab and add a statement layer like an embellished abaya if the dress code leans formal. Here's where to start." },
  { words: ['work', 'office', 'interview'], category: 'tops-blouses',
    reply: "For work, structured blouses or tunics paired with wide-leg trousers or a midi skirt read polished and professional. Neutral tones (navy, camel, black) are easiest to build a capsule wardrobe around." },
  { words: ['gym', 'workout', 'exercise', 'sport'], category: 'loungewear',
    reply: "For movement, look for breathable, opaque fabrics with a relaxed fit — modest activewear sets or loose loungewear pieces that won't cling. Here's what's available." },
  { words: ['casual', 'everyday', 'weekend'], category: 'tunics-kaftans',
    reply: "For everyday wear, a tunic or kaftan over trousers is comfortable and effortless — easy to dress up with a nicer hijab or down with flats. Here's a starting point." },
  { words: ['summer', 'hot weather'], category: 'tops-blouses',
    reply: "In hot weather, look for lightweight, breathable fabrics like linen or cotton blends in looser silhouettes — they stay modest without trapping heat. Here's what's in season." },
  { words: ['winter', 'cold weather'], category: 'outerwear',
    reply: "For cold weather, a long structured coat or cardigan layered over your outfit keeps you warm without compromising coverage. Here's our outerwear." },
  { words: ['eid', 'party', 'formal', 'evening'], category: 'modest-sets',
    reply: "For a special occasion, a coordinated modest set or an embellished abaya makes a strong, put-together statement without much extra styling effort. Here's where to look." },
];
function extractOccasionGuide(text) {
  const lower = text.toLowerCase();
  return OCCASION_GUIDES.find(g => g.words.some(w => lower.includes(w))) || null;
}

function localAssistant(message, context, user) {
  const lower = message.toLowerCase();
  let reply = '';
  let actions = [];
  let products = [];
  let brandsOut = [];

  const maxPrice = extractMaxPrice(lower);
  const minPrice = extractMinPrice(lower);
  const color = extractColor(lower);
  const categoryWord = extractCategoryWord(lower);
  const brandMention = extractBrandMention(lower);
  const occasionGuide = extractOccasionGuide(lower);
  const wantsOutfit = /\boutfit\b|\bstyle me\b|\bput together\b|\bwhat should i wear\b|\bwhat goes with\b|\bpair (it|this|that)? ?with\b|\bcomplete (the|this|my) look\b|\bcoordinat/.test(lower);
  const ONE_PIECE_CATS = ['dresses', 'abayas', 'modest-sets', 'tunics-kaftans', 'loungewear'];

  if (occasionGuide) {
    const preferredCategory = ONE_PIECE_CATS.includes(occasionGuide.category) ? occasionGuide.category : null;
    products = tool_build_outfit({ color, preferredCategory });
    reply = occasionGuide.reply;

  } else if (wantsOutfit) {
    products = tool_build_outfit({ color });
    reply = products.length
      ? (color ? `Here's a coordinated outfit built around ${color} — these pieces are chosen to work together.` : "Here's a coordinated outfit — these pieces are chosen to work together.")
      : "I don't have enough pieces in stock yet to put together a full outfit — try browsing the shop directly, or check back once more products are added.";

  } else if (/\bcart\b/.test(lower) && /what|show|view|open/.test(lower)) {
    reply = "Here's what's currently in your cart.";
    actions.push({ type: 'open_cart', label: 'Open Cart' });

  } else if (/\border(s)?\b/.test(lower) && /track/.test(lower)) {
    if (!user) {
      reply = "You'll need to log in first so I can look up your orders.";
      actions.push({ type: 'open_login', label: 'Log In' });
    } else {
      const numMatch = message.match(/ORD-[A-Z0-9-]+/i);
      const order = tool_track_order(user, numMatch ? numMatch[0] : null);
      if (order) {
        reply = `Your order ${order.order_number} is currently "${order.status}".`;
        actions.push({ type: 'open_order', label: 'View Order', payload: { orderId: order.id } });
      } else {
        reply = "I couldn't find that order. Here are all your orders.";
        actions.push({ type: 'open_orders', label: 'View Orders' });
      }
    }

  } else if (/\border(s)?\b/.test(lower) && /show|my|view|history/.test(lower)) {
    if (!user) {
      reply = "Log in to view your orders.";
      actions.push({ type: 'open_login', label: 'Log In' });
    } else {
      reply = "Here are your orders.";
      actions.push({ type: 'open_orders', label: 'View Orders' });
    }

  } else if (/saved item|wishlist|favorite/.test(lower)) {
    if (!user) {
      reply = "Log in to view your saved items.";
      actions.push({ type: 'open_login', label: 'Log In' });
    } else {
      reply = "Here are your saved items.";
      actions.push({ type: 'open_wishlist', label: 'Open Saved Items' });
    }

  } else if (/\bprofile\b|\baccount\b|dashboard/.test(lower)) {
    if (!user) {
      reply = "Log in to view your profile.";
      actions.push({ type: 'open_login', label: 'Log In' });
    } else {
      reply = "Here's your profile.";
      actions.push({ type: 'open_profile', label: 'Open Profile' });
    }

  } else if (/change my address|manage address|addresses/.test(lower)) {
    if (!user) {
      reply = "Log in to manage your addresses.";
      actions.push({ type: 'open_login', label: 'Log In' });
    } else {
      reply = "You can manage your saved addresses here.";
      actions.push({ type: 'open_addresses', label: 'Manage Addresses' });
    }

  } else if (/cheaper|less expensive|lower price/.test(lower) || (/similar|something like this|alternative/.test(lower))) {
    let refProduct = null;
    if (context.productId) refProduct = db.prepare('SELECT * FROM products WHERE id = ?').get(context.productId);
    if (refProduct) {
      const refPrice = refProduct.discount_price || refProduct.price;
      products = tool_search_products({
        category: (db.prepare('SELECT slug FROM categories WHERE id = ?').get(refProduct.category_id) || {}).slug,
        maxPrice: /cheaper|less expensive|lower price/.test(lower) ? refPrice : undefined,
        excludeId: refProduct.id,
      });
      reply = products.length
        ? `I found ${products.length} option${products.length > 1 ? 's' : ''} similar to "${refProduct.name}"${/cheaper/.test(lower) ? ' at a lower price' : ''}.`
        : `I couldn't find similar items right now — here's the current catalog instead.`;
      if (!products.length) products = tool_search_products({ sort: 'featured' });
    } else {
      reply = "I don't have a product in view right now — tell me what you're comparing to, or browse a category.";
      actions.push({ type: 'open_category', label: 'Browse New Arrivals', payload: { category: 'new' } });
    }

  } else if (/compare|difference between/.test(lower)) {
    reply = "Tell me the two product names (or open both product pages) and I can compare material, price, sizes and availability.";
    if (context.productId) {
      const p = db.prepare('SELECT * FROM products WHERE id = ?').get(context.productId);
      if (p) {
        products = tool_search_products({ category: (db.prepare('SELECT slug FROM categories WHERE id=?').get(p.category_id) || {}).slug, excludeId: p.id });
        reply = `You're viewing "${p.name}". Here are similar products you could compare it with.`;
      }
    }

  } else if (brandMention || /\bbrands?\b/.test(lower)) {
    if (brandMention) {
      reply = `Here's ${brandMention.name}'s storefront.`;
      actions.push({ type: 'open_brand', label: `Open ${brandMention.name}`, payload: { slug: brandMention.slug } });
    } else {
      brandsOut = db.prepare('SELECT * FROM brands ORDER BY name LIMIT 8').all();
      reply = brandsOut.length ? "Here are the local brands on the marketplace." : "We don't have any brands listed yet — check back soon.";
      actions.push({ type: 'open_brands', label: 'View All Brands' });
    }

  } else if (/new arrival/.test(lower)) {
    products = tool_search_products({ sort: 'newest' });
    reply = products.length ? "Here are the newest arrivals." : "No new arrivals just yet — check back soon.";

  } else if (/trending|popular/.test(lower)) {
    products = tool_search_products({ sort: 'popular' });
    reply = products.length ? "Here's what's trending right now." : "Nothing trending yet — the catalog is still growing.";

  } else if (categoryWord && /show|open|go to|take me to/.test(lower) && !color && !maxPrice && !minPrice) {
    const cat = tool_open_category(categoryWord);
    if (cat) {
      reply = `Sure — here's ${cat.name}.`;
      actions.push({ type: 'open_category', label: `Open ${cat.name}`, payload: { slug: cat.slug } });
    } else {
      products = tool_search_products({ q: categoryWord });
      reply = products.length ? `Here's what I found for "${categoryWord}".` : `I couldn't find that category yet.`;
    }

  } else if (color || maxPrice || minPrice || categoryWord || /find|show|looking for|search/.test(lower)) {
    const params = {};
    if (categoryWord) params.category = categoryWord;
    if (color) params.color = color;
    if (maxPrice) params.maxPrice = maxPrice;
    if (minPrice) params.minPrice = minPrice;
    if (!categoryWord && !color && !maxPrice && !minPrice) params.q = message;

    products = tool_search_products(params);
    if (products.length) {
      reply = `I found ${products.length} item${products.length > 1 ? 's' : ''}${color ? ` in ${color}` : ''}${maxPrice ? ` under $${maxPrice}` : ''}.`;
    } else {
      reply = "I couldn't find anything matching that yet — the catalog may still be growing, or try different filters.";
    }

  } else {
    reply = "Hi! I'm your Fashion Assistant — I can help with styling advice for an occasion, or with finding products, brands, and categories. What are you looking for?";
    actions.push({ type: 'search_products', label: 'Find a product' });
    actions.push({ type: 'open_categories', label: 'Explore categories' });
    actions.push({ type: 'open_brands', label: 'Find a brand' });
    actions.push({ type: 'open_orders', label: 'Track an order' });
  }

  return { reply, actions, products, brands: brandsOut, _mode: 'local' };
}

function register(router) {
  router.post('/api/ai/chat', async (req, res, ctx) => {
    const body = await readBody(req);
    const message = (body.message || '').trim();
    const context = body.context || {};
    const history = Array.isArray(body.history) ? body.history : [];
    const user = getCurrentUser(ctx.session);

    if (!message) return sendJSON(res, 400, { error: 'Message is required.' });

    let result = await callLLM(message, context, user, history);
    if (!result) result = localAssistant(message, context, user);

    try {
      db.prepare('INSERT INTO ai_logs (session_token, message, reply) VALUES (?, ?, ?)').run(ctx.session.token, message, result.reply);
    } catch (e) {}

    sendJSON(res, 200, result);
  });
}

module.exports = { register };


