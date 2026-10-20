'use strict';
/*
 * pvproxy.js - on-device proxy that removes Prime Video ads on LG webOS TVs.
 *
 * The Prime Video app (Amazon "Ignition" engine) is pointed at this proxy through the
 * "http-proxy-server" option in its default_config.json. The proxy applies the same
 * edits the uBlock Origin / AdGuard filter lists make in a browser, but to the network data:
 *
 *  Responses of Get(Vod)PlaybackResources:
 *    - intraTitlePlaylist[].shouldShowOnScrubBar  -> removed  (ad markers on the progress bar)
 *    - playbackUrls.pauseBehavior, pauseAdsResolution -> removed (pause ads)
 *    - cuepointPlaylist, ...cuepoints, ads            -> removed (ad cue points)
 *    - intraTitlePlaylist entries of type "Remote"    -> removed (the ad breaks)
 *  Requests:
 *    - .../getVideoAds and .../getAds                 -> blocked
 *    - deviceAdInsertionTypeOverride parameter        -> removed
 *    - ",CuepointPlaylist" in requested resources     -> removed
 *
 * Fail-open: anything that cannot be parsed or edited is passed through unchanged.
 * Only *.primevideo.com, *.amazonvideo.com and *.amazon.dev are decrypted. All other
 * traffic, including the video CDN, is tunnelled untouched.
 *
 * Compatible with Node.js 8 and newer (webOS 4.x and later).
 *
 * Environment:
 *   PROXY_PORT      listen port (default 8888)
 *   PROXY_BIND      listen address (default 127.0.0.1)
 *   TLS_KEY         path to the TLS key (default: key.pem next to this file)
 *   TLS_CERT        path to the TLS certificate (default: cert.pem next to this file)
 *   REMOVE_REMOTE   set to 0 to keep "Remote" playlist entries (uBlock-only edits)
 *   PIDFILE         optional path to write the process id to
 */
var http = require('http');
var https = require('https');
var net = require('net');
var fs = require('fs');
var path = require('path');
var zlib = require('zlib');
var URL = require('url').URL;

var PORT = Number(process.env.PROXY_PORT) || 8888;
var BIND = process.env.PROXY_BIND || '127.0.0.1';
var REMOVE_REMOTE = process.env.REMOVE_REMOTE !== '0';

var MITM_HOSTS = /(^|\.)(primevideo\.com|amazonvideo\.com|amazon\.dev)$/i;
var PLAYBACK_RES = /Get(Vod)?PlaybackResources/i;
var AD_REQUEST = /\/(getVideoAds|getAds)(\?|$|\/)/i;
var LOG_PATHS = /getVideoAds|getAds|PlaybackResources/i;

function log() {
  var args = Array.prototype.slice.call(arguments);
  args.unshift(new Date().toISOString());
  console.log(args.join(' '));
}

/* ---------------- edits ---------------- */

function del(obj, key, label, changes) {
  if (obj && typeof obj === 'object' && Object.prototype.hasOwnProperty.call(obj, key)) {
    delete obj[key];
    changes.push(label);
  }
}

function editPlaybackJson(text, removeRemote) {
  if (removeRemote === undefined) removeRemote = REMOVE_REMOTE;
  var j;
  try { j = JSON.parse(text); } catch (e) { return { error: 'not JSON' }; }
  if (!j || typeof j !== 'object') return { error: 'not an object' };
  var changes = [];

  del(j, 'cuepointPlaylist', 'cuepointPlaylist', changes);
  del(j, 'ads', 'ads', changes);

  var vpu = j.vodPlaybackUrls && j.vodPlaybackUrls.result && j.vodPlaybackUrls.result.playbackUrls;
  del(vpu, 'cuepoints', 'vodPlaybackUrls.cuepoints', changes);

  var pu = j.vodPlaylistedPlaybackUrls && j.vodPlaylistedPlaybackUrls.result &&
    j.vodPlaylistedPlaybackUrls.result.playbackUrls;
  if (pu && typeof pu === 'object') {
    del(pu, 'pauseBehavior', 'pauseBehavior', changes);
    del(pu, 'pauseAdsResolution', 'pauseAdsResolution', changes);
    del(pu, 'cuepoints', 'playlisted.cuepoints', changes);
    if (Array.isArray(pu.intraTitlePlaylist)) {
      var flags = 0;
      pu.intraTitlePlaylist.forEach(function (item) {
        if (item && typeof item === 'object' && 'shouldShowOnScrubBar' in item) {
          delete item.shouldShowOnScrubBar;
          flags++;
        }
      });
      if (flags) changes.push('shouldShowOnScrubBar x' + flags);
      if (removeRemote) {
        var before = pu.intraTitlePlaylist.length;
        var kept = pu.intraTitlePlaylist.filter(function (x) { return !(x && x.type === 'Remote'); });
        // Only drop ad entries when real content remains.
        if (kept.length && kept.length < before) {
          pu.intraTitlePlaylist = kept;
          changes.push('Remote ad break x' + (before - kept.length));
        }
      }
    }
  }
  if (!changes.length) return { changes: changes, body: null, keys: Object.keys(j) };
  return { changes: changes, body: JSON.stringify(j) };
}

function rewritePath(p) {
  var q = p.indexOf('?');
  if (q < 0) return p;
  var base = p.slice(0, q);
  var query = p.slice(q + 1).split('&')
    .filter(function (kv) { return !/^deviceAdInsertionTypeOverride=/i.test(kv); })
    .join('&')
    .replace(/%2CCuepointPlaylist/gi, '')
    .replace(/,CuepointPlaylist/gi, '');
  return query ? base + '?' + query : base;
}

function rewriteBody(text) {
  return text
    .replace(/%2CCuepointPlaylist/gi, '')
    .replace(/,CuepointPlaylist/gi, '')
    .replace(/(^|&)deviceAdInsertionTypeOverride=[^&]*/gi, '');
}

function decode(buf, enc) {
  switch ((enc || '').toLowerCase()) {
    case 'gzip': return zlib.gunzipSync(buf);
    case 'deflate': return zlib.inflateSync(buf);
    case 'br':
      if (!zlib.brotliDecompressSync) throw new Error('brotli not supported by this Node.js');
      return zlib.brotliDecompressSync(buf);
    case '': case 'identity': return buf;
    default: throw new Error('unknown encoding ' + enc);
  }
}

/* ---------------- forwarding ---------------- */

function readAll(stream, cb) {
  var chunks = [];
  stream.on('data', function (c) { chunks.push(c); });
  stream.on('end', function () { cb(null, Buffer.concat(chunks)); });
  stream.on('error', function (e) { cb(e); });
}

function fail(res, code) {
  try {
    if (!res.headersSent) res.writeHead(code || 502);
    res.end();
  } catch (e) { /* ignore */ }
}

function forward(req, res, secure) {
  var hostname, port, reqPath;
  if (secure) {
    var hostHdr = req.headers.host || '';
    var i = hostHdr.lastIndexOf(':');
    hostname = i > 0 ? hostHdr.slice(0, i) : hostHdr;
    port = i > 0 ? Number(hostHdr.slice(i + 1)) : 443;
    reqPath = req.url;
  } else {
    var u;
    try { u = new URL(req.url); } catch (e) { return fail(res, 400); }
    hostname = u.hostname; port = u.port || 80; reqPath = u.pathname + u.search;
  }

  if (LOG_PATHS.test(reqPath)) log('[req]', req.method, hostname + reqPath.split('?')[0]);

  if (AD_REQUEST.test(reqPath)) {
    log('[block]', hostname + reqPath.split('?')[0]);
    req.resume();
    res.writeHead(403, { 'content-type': 'text/plain', 'content-length': 0 });
    return res.end();
  }

  var headers = Object.assign({}, req.headers);
  delete headers['proxy-connection'];
  var isPR = PLAYBACK_RES.test(reqPath);

  function send(body) {
    var opts = { hostname: hostname, port: port, path: reqPath, method: req.method, headers: headers };
    if (secure) opts.servername = hostname;
    var up = (secure ? https : http).request(opts, function (ur) {
      if (!isPR) {
        res.writeHead(ur.statusCode, ur.headers);
        ur.pipe(res);
        return;
      }
      readAll(ur, function (err, raw) {
        if (err) { log('[pv] response read failed:', err.message); return fail(res); }
        var h = Object.assign({}, ur.headers);
        var out = raw;
        try {
          var r = editPlaybackJson(decode(raw, ur.headers['content-encoding']).toString('utf8'));
          if (r.error) log('[pv] left unchanged:', r.error);
          else if (!r.body) log('[pv] nothing to remove; top keys:', (r.keys || []).join(','));
          else {
            out = Buffer.from(r.body, 'utf8');
            delete h['content-encoding'];
            log('[pv] removed:', r.changes.join(', '));
          }
        } catch (e) {
          out = raw; // fail open
          log('[pv] edit failed, original passed through:', e.message);
        }
        delete h['transfer-encoding'];
        h['content-length'] = out.length;
        res.writeHead(ur.statusCode, h);
        res.end(out);
      });
    });
    up.on('error', function (e) {
      log('[upstream error]', hostname, e.message);
      fail(res);
    });
    if (body) up.end(body);
    else req.pipe(up);
  }

  if (!isPR) return send(null);

  try {
    var np = rewritePath(reqPath);
    if (np !== reqPath) { log('[pv] request params cleaned'); reqPath = np; }
  } catch (e) { log('[pv] path rewrite skipped:', e.message); }

  readAll(req, function (err, body) {
    if (err) { log('[pv] request body read failed:', err.message); return fail(res); }
    var enc = (headers['content-encoding'] || '').toLowerCase();
    if (body.length && (enc === '' || enc === 'identity')) {
      var t = body.toString('utf8');
      var nt = rewriteBody(t);
      if (nt !== t) { body = Buffer.from(nt, 'utf8'); log('[pv] request body cleaned'); }
    }
    headers['content-length'] = body.length;
    delete headers['transfer-encoding'];
    send(body);
  });
}

/* ---------------- servers ---------------- */

function start(tls, port, bind) {
  port = port || PORT;
  bind = bind || BIND;
  var mitm = https.createServer(tls, function (req, res) {
    try { forward(req, res, true); } catch (e) { log('[forward]', e.message); fail(res); }
  });
  mitm.on('tlsClientError', function (e) { log('[tls]', e.message); });
  mitm.on('clientError', function (e, s) { s.destroy(); });

  var seen = {};
  var proxy = http.createServer(function (req, res) {
    try { forward(req, res, false); } catch (e) { log('[forward]', e.message); fail(res); }
  });
  proxy.on('connect', function (req, sock, head) {
    var i = req.url.lastIndexOf(':');
    var host = i > 0 ? req.url.slice(0, i) : req.url;
    var p = i > 0 ? Number(req.url.slice(i + 1)) : 443;
    sock.on('error', function () {});
    var intercept = MITM_HOSTS.test(host);
    if (!seen[host]) { seen[host] = true; log(intercept ? '[mitm]' : '[tunnel]', host); }

    if (intercept) {
      sock.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head && head.length) sock.unshift(head);
      mitm.emit('connection', sock);
      return;
    }
    var up = net.connect(p, host, function () {
      sock.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head && head.length) up.write(head);
      up.pipe(sock);
      sock.pipe(up);
    });
    up.on('error', function () { sock.destroy(); });
    sock.on('close', function () { up.destroy(); });
  });
  proxy.on('clientError', function (e, s) { s.destroy(); });
  proxy.listen(port, bind, function () {
    log('pvproxy listening on ' + bind + ':' + port + ' (remove Remote: ' + REMOVE_REMOTE + ')');
  });
  return proxy;
}

module.exports = {
  editPlaybackJson: editPlaybackJson,
  rewritePath: rewritePath,
  rewriteBody: rewriteBody,
  decode: decode,
  start: start
};

if (require.main === module) {
  process.on('uncaughtException', function (e) { log('[uncaught]', (e && e.stack) || e); });
  process.on('unhandledRejection', function (e) { log('[unhandled]', (e && e.stack) || e); });
  if (process.env.PIDFILE) {
    try { fs.writeFileSync(process.env.PIDFILE, String(process.pid)); } catch (e) { /* ignore */ }
  }
  var keyPath = process.env.TLS_KEY || path.join(__dirname, 'key.pem');
  var certPath = process.env.TLS_CERT || path.join(__dirname, 'cert.pem');
  var tls;
  try {
    tls = { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) };
  } catch (e) {
    log('cannot read TLS key/certificate (' + keyPath + ', ' + certPath + '): ' + e.message);
    process.exit(2);
  }
  start(tls);
}
