const http = require('http');
const path = require('path');
const Router = require('./router');
const { getOrCreateSession, serveStatic, sendJSON } = require('./util');

require('./db'); 

const router = new Router();
require('./routes/auth').register(router);
require('./routes/catalog').register(router);
require('./routes/products').register(router);
require('./routes/cart').register(router);
require('./routes/account').register(router);
require('./routes/orders').register(router);
require('./routes/admin').register(router);
require('./routes/ai').register(router);

const PUBLIC_DIR = path.join(__dirname, 'public');
const PORT = process.env.PORT || 3000;

const server = http.createServer(async (req, res) => {
  try {
    const urlPath = req.url.split('?')[0];
    const session = getOrCreateSession(req, res);

    if (urlPath.startsWith('/api/')) {
      const match = router.match(req.method, urlPath);
      if (!match) return sendJSON(res, 404, { error: 'Not found.' });
      await match.handler(req, res, { params: match.params, session });
      return;
    }

    const served = serveStatic(req, res, PUBLIC_DIR);
    if (!served) {
      res.writeHead(404, { 'Content-Type': 'text/html' });
      res.end('<h1>404</h1><p>Page not found. <a href="/">Go home</a></p>');
    }
  } catch (err) {
    console.error(err);
    if (!res.headersSent) sendJSON(res, 500, { error: 'Internal server error.' });
  }
});

server.listen(PORT, () => {
  console.log(`Marketplace running at http://localhost:${PORT}`);
  console.log(`Admin login: admin@marketplace.local / Admin123!`);
});
