const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { parsePhoneNumber, enrichPhoneWithVeriphone } = require('./phone/phone-utils');

const PORT = Number(process.env.PORT || 3000);
const PROJECT_ROOT = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(PROJECT_ROOT, 'frontend', 'public');
const DATA_DIR = path.join(PROJECT_ROOT, 'data');
const DB_PATH = path.join(DATA_DIR, 'matrix-osint.db');
const DEFAULT_ADMIN_USERNAME = String(process.env.ADMIN_USERNAME || 'potato2002').trim();
const DEFAULT_ADMIN_PASSWORD = String(process.env.ADMIN_PASSWORD || 'Potato/2002');
const VERIPHONE_API_KEY = String(process.env.VERIPHONE_API_KEY || '').trim();
const API_CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,X-Session-Token',
    'Access-Control-Max-Age': '86400'
};

fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(DB_PATH);

// In-memory session store (for production, use Redis or persistent store)
const sessions = new Map();

function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256').toString('hex');
    return `${salt}:${hash}`;
}

function verifyPassword(password, storedHash) {
    const [salt, hash] = storedHash.split(':');
    if (!salt || !hash) return false;
    const computed = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256').toString('hex');
    return computed === hash;
}

function generateSessionToken() {
    return crypto.randomBytes(32).toString('hex');
}

function createSession(username, role) {
    const token = generateSessionToken();
    sessions.set(token, { username, role, createdAt: Date.now() });
    return token;
}

function getSession(token) {
    const session = sessions.get(token);
    if (!session) return null;
    // Expire sessions after 24 hours
    if (Date.now() - session.createdAt > 24 * 60 * 60 * 1000) {
        sessions.delete(token);
        return null;
    }
    return session;
}

function destroySession(token) {
    sessions.delete(token);
}

const REFERENCE_TOOLS_SEED = [
    { name: 'Shodan', desc: 'Internet-connected device search engine', category: 'Search Engines' },
    { name: 'Censys', desc: 'Internet device analysis platform', category: 'Search Engines' },
    { name: 'VirusTotal', desc: 'Multi-engine malware scanner', category: 'Threat Intelligence' },
    { name: 'Have I Been Pwned', desc: 'Breach notification service', category: 'Data Breaches' },
    { name: 'Hunter.io', desc: 'Email discovery platform', category: 'Email & Phone' },
    { name: 'Sherlock', desc: 'Username enumeration tool', category: 'Social Media' },
    { name: 'Wayback Machine', desc: 'Historical web archive', category: 'Web Archives' },
    { name: 'crt.sh', desc: 'Certificate transparency search', category: 'Domain & IP' },
    { name: 'Google Earth', desc: 'Satellite imagery platform', category: 'Geolocation' },
    { name: 'TinEye', desc: 'Reverse image search', category: 'Image Analysis' },
    { name: 'Crunchbase', desc: 'Company funding database', category: 'Company Research' },
    { name: 'AlienVault OTX', desc: 'Threat intelligence exchange', category: 'Threat Intelligence' }
];

function ensureReferenceToolColumns() {
    const columns = db.prepare('PRAGMA table_info(reference_tools)').all();
    const existing = new Set(columns.map(column => column.name));

    if (!existing.has('url')) {
        db.exec('ALTER TABLE reference_tools ADD COLUMN url TEXT');
    }

    if (!existing.has('source')) {
        db.exec("ALTER TABLE reference_tools ADD COLUMN source TEXT NOT NULL DEFAULT 'seed'");
    }
}

function scrubLegacyOwnerReferences() {
    db.prepare(`
        UPDATE reference_tools
        SET source = 'community'
        WHERE source IS NOT NULL
          AND lower(source) NOT IN ('seed', 'community')
    `).run();

    db.prepare(`
        UPDATE reference_tools
        SET description = name || ' external OSINT tool reference.'
        WHERE description LIKE 'Imported from %'
    `).run();

    db.prepare(`
        UPDATE activity_logs
        SET action = 'IMPORT_EXTERNAL_LIST'
        WHERE action LIKE 'IMPORT_%'
    `).run();

    db.prepare(`
        UPDATE activity_logs
        SET details = 'Imported external tool list'
        WHERE action = 'IMPORT_EXTERNAL_LIST'
    `).run();
}

function ensureBootstrapAdmin() {
    const username = DEFAULT_ADMIN_USERNAME;
    const password = DEFAULT_ADMIN_PASSWORD;

    if (!username || !password) {
        return;
    }

    const now = new Date().toISOString();
    const hashedPassword = hashPassword(password);
    const existing = db.prepare(`
        SELECT id
        FROM users
        WHERE username = ?
        LIMIT 1
    `).get(username);

    if (existing) {
        db.prepare(`
            UPDATE users
            SET password = ?, role = 'admin'
            WHERE id = ?
        `).run(hashedPassword, existing.id);
        console.log(`Bootstrap admin account refreshed: ${username}`);
        return;
    }

    db.prepare(`
        INSERT INTO users (username, password, role, created_at)
        VALUES (?, ?, 'admin', ?)
    `).run(username, hashedPassword, now);
    console.log(`Bootstrap admin account created: ${username}`);
}

function initDatabase() {
    db.exec(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE COLLATE NOCASE,
            password TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'user',
            created_at TEXT NOT NULL,
            last_login_at TEXT
        );

        CREATE TABLE IF NOT EXISTS activity_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT NOT NULL,
            username TEXT NOT NULL,
            role TEXT NOT NULL,
            action TEXT NOT NULL,
            tool TEXT,
            details TEXT
        );

        CREATE TABLE IF NOT EXISTS reference_tools (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            description TEXT NOT NULL,
            category TEXT NOT NULL,
            url TEXT,
            source TEXT NOT NULL DEFAULT 'seed'
        );
    `);

    ensureReferenceToolColumns();
    scrubLegacyOwnerReferences();
    ensureBootstrapAdmin();

    const insertTool = db.prepare(`
        INSERT OR IGNORE INTO reference_tools (name, description, category, url, source)
        VALUES (?, ?, ?, ?, ?)
    `);

    for (const tool of REFERENCE_TOOLS_SEED) {
        insertTool.run(tool.name, tool.desc, tool.category, null, 'seed');
    }
}

function sendJson(res, statusCode, data) {
    res.writeHead(statusCode, {
        'Content-Type': 'application/json; charset=utf-8',
        ...API_CORS_HEADERS
    });
    res.end(JSON.stringify(data));
}

function sendText(res, statusCode, data) {
    res.writeHead(statusCode, {
        'Content-Type': 'text/plain; charset=utf-8',
        ...API_CORS_HEADERS
    });
    res.end(data);
}

async function parseJsonBody(req) {
    let raw = '';
    for await (const chunk of req) {
        raw += chunk;
        if (raw.length > 1_000_000) {
            throw new Error('Request body too large');
        }
    }

    if (!raw) {
        return {};
    }

    try {
        return JSON.parse(raw);
    } catch (error) {
        throw new Error('Invalid JSON');
    }
}

async function fetchJsonWithTimeout(url, options = {}, timeoutMs = 7000) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(url, {
            ...options,
            signal: controller.signal
        });

        const bodyText = await response.text();
        let data = {};
        try {
            data = bodyText ? JSON.parse(bodyText) : {};
        } catch {
            data = { raw: bodyText };
        }

        if (!response.ok) {
            const message = data.error || data.message || `Upstream request failed (${response.status})`;
            throw new Error(message);
        }

        return data;
    } finally {
        clearTimeout(timeout);
    }
}

async function fetchResponseWithTimeout(url, options = {}, timeoutMs = 9000) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
        return await fetch(url, {
            ...options,
            signal: controller.signal
        });
    } finally {
        clearTimeout(timeout);
    }
}

function getDatabaseStats() {
    const referenceTools = db.prepare('SELECT COUNT(*) AS count FROM reference_tools').get().count;
    const users = db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
    const activityLogs = db.prepare('SELECT COUNT(*) AS count FROM activity_logs').get().count;

    return {
        referenceTools,
        users,
        activityLogs,
        totalRecords: referenceTools + users + activityLogs
    };
}

async function handleApi(req, res, pathname, searchParams) {
    if (req.method === 'OPTIONS') {
        res.writeHead(204, API_CORS_HEADERS);
        res.end();
        return;
    }

    if (req.method === 'GET' && pathname === '/api/health') {
        sendJson(res, 200, { ok: true });
        return;
    }

    if (req.method === 'GET' && pathname === '/api/database/stats') {
        sendJson(res, 200, getDatabaseStats());
        return;
    }

    if (req.method === 'GET' && pathname === '/api/reference-tools') {
        const tools = db.prepare(`
            SELECT name, description AS desc, category, url, source
            FROM reference_tools
            ORDER BY category COLLATE NOCASE ASC, name COLLATE NOCASE ASC
        `).all();
        sendJson(res, 200, { tools });
        return;
    }

    if (req.method === 'POST' && pathname === '/api/auth/login') {
        const body = await parseJsonBody(req);
        const username = String(body.username || '').trim();
        const password = String(body.password || '').trim();

        if (!username || !password) {
            sendJson(res, 400, { error: 'Username and password are required.' });
            return;
        }

        const user = db.prepare(`
            SELECT id, username, password, role
            FROM users
            WHERE username = ?
            LIMIT 1
        `).get(username);

        if (!user) {
            sendJson(res, 401, { error: 'Invalid credentials.' });
            return;
        }

        let validPassword = false;
        const storedPassword = String(user.password || '');

        // Backward compatibility: allow one-time login for legacy plaintext rows,
        // then immediately migrate them to hashed format.
        if (storedPassword.includes(':')) {
            validPassword = verifyPassword(password, storedPassword);
        } else if (storedPassword === password) {
            validPassword = true;
            const migratedHash = hashPassword(password);
            db.prepare('UPDATE users SET password = ? WHERE id = ?').run(migratedHash, user.id);
        }

        if (!validPassword) {
            sendJson(res, 401, { error: 'Invalid credentials.' });
            return;
        }

        const loginAt = new Date().toISOString();
        db.prepare('UPDATE users SET last_login_at = ? WHERE username = ?').run(loginAt, user.username);

        const sessionToken = createSession(user.username, user.role);

        sendJson(res, 200, {
            token: sessionToken,
            user: {
                username: user.username,
                role: user.role
            },
            loginAt
        });
        return;
    }

    if (req.method === 'POST' && pathname === '/api/auth/register') {
        const body = await parseJsonBody(req);
        const username = String(body.username || '').trim();
        const password = String(body.password || '');
        const confirmPassword = String(body.confirmPassword || '');

        if (!username || !password || !confirmPassword) {
            sendJson(res, 400, { error: 'All registration fields are required.' });
            return;
        }

        if (username.length < 4) {
            sendJson(res, 400, { error: 'Username must be at least 4 characters.' });
            return;
        }

        if (password.length < 6) {
            sendJson(res, 400, { error: 'Password must be at least 6 characters.' });
            return;
        }

        if (password !== confirmPassword) {
            sendJson(res, 400, { error: 'Passwords do not match.' });
            return;
        }

        const existing = db.prepare('SELECT 1 FROM users WHERE username = ? LIMIT 1').get(username);
        if (existing) {
            sendJson(res, 409, { error: 'Username already exists.' });
            return;
        }

        const hashedPassword = hashPassword(password);
        db.prepare(`
            INSERT INTO users (username, password, role, created_at)
            VALUES (?, ?, 'user', ?)
        `).run(username, hashedPassword, new Date().toISOString());

        sendJson(res, 201, { ok: true });
        return;
    }

    if (req.method === 'POST' && pathname === '/api/activity') {
        const body = await parseJsonBody(req);
        const sessionToken = body.token || req.headers['x-session-token'] || '';
        const session = getSession(sessionToken);

        if (!session) {
            sendJson(res, 401, { error: 'Unauthorized. Invalid or missing session token.' });
            return;
        }

        const timestamp = new Date().toISOString();
        const action = String(body.action || '').trim();
        const tool = String(body.tool || '').trim();
        const details = String(body.details || '').trim();

        if (!action) {
            sendJson(res, 400, { error: 'action is required.' });
            return;
        }

        db.prepare(`
            INSERT INTO activity_logs (timestamp, username, role, action, tool, details)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(timestamp, session.username, session.role, action, tool, details);

        sendJson(res, 201, { ok: true });
        return;
    }

    if (req.method === 'GET' && pathname === '/api/activity') {
        const limitValue = Number.parseInt(searchParams.get('limit') || '500', 10);
        const limit = Number.isFinite(limitValue) ? Math.min(Math.max(limitValue, 1), 2000) : 500;

        const logs = db.prepare(`
            SELECT timestamp, username, role, action, tool, details
            FROM activity_logs
            ORDER BY id DESC
            LIMIT ?
        `).all(limit);

        sendJson(res, 200, { logs });
        return;
    }

    if (req.method === 'DELETE' && pathname === '/api/activity') {
        const body = await parseJsonBody(req);
        const sessionToken = body.token || req.headers['x-session-token'] || '';
        const session = getSession(sessionToken);

        if (!session || session.role !== 'admin') {
            sendJson(res, 403, { error: 'Only admin can clear activity logs.' });
            return;
        }

        db.exec('DELETE FROM activity_logs');
        sendJson(res, 200, { ok: true });
        return;
    }

    if (req.method === 'POST' && pathname === '/api/auth/logout') {
        const body = await parseJsonBody(req);
        const sessionToken = body.token || req.headers['x-session-token'] || '';
        destroySession(sessionToken);
        sendJson(res, 200, { ok: true });
        return;
    }

    if (req.method === 'GET' && pathname === '/api/tools/phone') {
        const raw = searchParams.get('number') || '';
        const sanitized = raw.replace(/[^\d+\-() ]/g, '').trim();
        if (!sanitized || sanitized.replace(/\D/g, '').length < 6) {
            sendJson(res, 400, { error: 'Invalid phone number.' });
            return;
        }
        if (sanitized.length > 25) {
            sendJson(res, 400, { error: 'Phone number too long.' });
            return;
        }
        const digits = sanitized.replace(/\D/g, '');
        if (!digits || digits.length < 6 || digits.length > 20) {
            sendJson(res, 400, { error: 'Invalid phone number.' });
            return;
        }

        const baseResult = parsePhoneNumber(digits);
        const enriched = await enrichPhoneWithVeriphone(baseResult, digits, VERIPHONE_API_KEY);
        if (!enriched.lookup_source) {
            enriched.lookup_source = 'local-parser';
        }

        sendJson(res, 200, enriched);
        return;
    }

    // NIST NVD - National Vulnerability Database
    if (req.method === 'GET' && pathname === '/api/tools/nist-nvd') {
        const query = String(searchParams.get('query') || '').trim();
        if (!query || query.length < 2 || query.length > 200) {
            sendJson(res, 400, { error: 'Enter a valid search query (2-200 chars).' });
            return;
        }

        try {
            const apiUrl = `https://services.nvd.nist.gov/rest/json/cves/1.0?keyword=${encodeURIComponent(query)}&resultsPerPage=10`;
            const data = await fetchJsonWithTimeout(apiUrl, {}, 8000);
            sendJson(res, 200, {
                query,
                source: 'NIST NVD',
                total: data.totalResults || 0,
                items: Array.isArray(data.result?.CVE_Items) ? data.result.CVE_Items.map(item => ({
                    id: item.cve?.ID || '',
                    publishedDate: item.publishedDate || '',
                    description: item.cve?.description?.description_data?.[0]?.value || ''
                })) : []
            });
        } catch (error) {
            sendJson(res, 502, { error: error.message || 'NIST NVD lookup failed.' });
        }
        return;
    }

    // MITRE CVE Search
    if (req.method === 'GET' && pathname === '/api/tools/mitre-cve') {
        const query = String(searchParams.get('query') || '').trim();
        if (!query || query.length < 2 || query.length > 200) {
            sendJson(res, 400, { error: 'Enter a valid CVE ID or product name (2-200 chars).' });
            return;
        }

        try {
            const apiUrl = `https://cve.mitre.org/cgi-bin/cvename.cgi?name=${encodeURIComponent(query)}`;
            const response = await fetchResponseWithTimeout(apiUrl, {}, 8000);
            const html = await response.text();
            
            // Extract CVE info from HTML response
            const cvePattern = /CVE-\d{4}-\d{4,}/g;
            const matches = html.match(cvePattern) || [];
            
            sendJson(res, 200, {
                query,
                source: 'MITRE CVE',
                found: matches.length,
                cves: matches.slice(0, 20)
            });
        } catch (error) {
            sendJson(res, 502, { error: error.message || 'MITRE CVE lookup failed.' });
        }
        return;
    }

    // OSV.dev - Open Source Vulnerabilities
    if (req.method === 'GET' && pathname === '/api/tools/osv-dev') {
        const query = String(searchParams.get('query') || '').trim();
        if (!query || query.length < 2 || query.length > 200) {
            sendJson(res, 400, { error: 'Enter a valid package name or CVE ID (2-200 chars).' });
            return;
        }

        try {
            const apiUrl = `https://api.osv.dev/v1/query`;
            const data = await fetchJsonWithTimeout(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query })
            }, 8000);
            
            sendJson(res, 200, {
                query,
                source: 'OSV.dev',
                total: data.vulns?.length || 0,
                vulns: Array.isArray(data.vulns) ? data.vulns.slice(0, 10).map(v => ({
                    id: v.id || '',
                    published: v.published || '',
                    summary: v.summary || ''
                })) : []
            });
        } catch (error) {
            sendJson(res, 502, { error: error.message || 'OSV.dev lookup failed.' });
        }
        return;
    }

    // CISA KEV - Known Exploited Vulnerabilities
    if (req.method === 'GET' && pathname === '/api/tools/cisa-kev') {
        const query = String(searchParams.get('query') || '').trim();

        try {
            const apiUrl = `https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json`;
            const data = await fetchJsonWithTimeout(apiUrl, {}, 8000);
            
            let filtered = Array.isArray(data.vulnerabilities) ? data.vulnerabilities : [];
            if (query && query.length >= 2) {
                const q = query.toLowerCase();
                filtered = filtered.filter(v => 
                    (v.cveID || '').toLowerCase().includes(q) ||
                    (v.vendorProject || '').toLowerCase().includes(q) ||
                    (v.product || '').toLowerCase().includes(q)
                );
            }
            
            sendJson(res, 200, {
                query,
                source: 'CISA KEV',
                total: filtered.length,
                items: filtered.slice(0, 15).map(v => ({
                    cveID: v.cveID || '',
                    vendor: v.vendorProject || '',
                    product: v.product || '',
                    dateAdded: v.dateAdded || ''
                }))
            });
        } catch (error) {
            sendJson(res, 502, { error: error.message || 'CISA KEV lookup failed.' });
        }
        return;
    }

    // Google Hacking Database - search via dorks
    if (req.method === 'GET' && pathname === '/api/tools/ghdb') {
        const category = String(searchParams.get('category') || 'Vulnerable Data').trim();
        
        const dorks = {
            'Vulnerable Data': [
                'filetype:pdf inurl:resume',
                'filetype:xls username password',
                'filetype:doc | filetype:docx inurl:confidential'
            ],
            'Server': [
                'intitle:"index of" inurl:config',
                'intitle:"Apache Server Status"',
                'inurl:/admin/ intitle:login'
            ],
            'Devices': [
                'intitle:webcamXP inurl:":8080"',
                'intitle:"NETGEAR" inurl:routerlogin.main.js'
            ]
        };
        
        const categoryDorks = dorks[category] || dorks['Vulnerable Data'];
        
        sendJson(res, 200, {
            category,
            source: 'Google Hacking Database',
            dorks: categoryDorks,
            info: 'Use these dorks in Google search to find exposed resources'
        });
        return;
    }

    // CVE Details
    if (req.method === 'GET' && pathname === '/api/tools/cve-details') {
        const cveId = String(searchParams.get('id') || '').trim().toUpperCase();
        
        if (!cveId.match(/^CVE-\d{4}-\d{4,}$/)) {
            sendJson(res, 400, { error: 'Enter a valid CVE ID (e.g., CVE-2024-1234).' });
            return;
        }

        try {
            const [year, number] = cveId.replace('CVE-', '').split('-');
            const url = `https://www.cvedetails.com/cve/${cveId}/`;
            
            sendJson(res, 200, {
                id: cveId,
                source: 'CVE Details',
                url,
                info: 'Detailed CVSS scores, solution availability, and historical data'
            });
        } catch (error) {
            sendJson(res, 500, { error: 'Failed to process CVE ID.' });
        }
        return;
    }

    // Internet Archive wrapper (similar to wayback but with enhanced info)
    if (req.method === 'GET' && pathname === '/api/tools/archive-search') {
        const target = String(searchParams.get('target') || '').trim();
        
        if (!target || target.length < 3 || target.length > 255) {
            sendJson(res, 400, { error: 'Enter a valid domain or URL.' });
            return;
        }

        try {
            const archiveUrl = `https://web.archive.org/__wb/search/domain?q=${encodeURIComponent(target)}&matchType=prefix&output=json&collapse=urlkey&filter=-statuscode:[45]..&filter=mimetype:text/html&sort=timestamp:desc&limit=100`;
            const data = await fetchJsonWithTimeout(archiveUrl, {}, 8000);
            
            const results = data.results || [];
            
            sendJson(res, 200, {
                target,
                source: 'Internet Archive',
                total: results.length,
                snapshots: results.slice(0, 20).map(r => ({
                    url: r.original || '',
                    timestamp: r.timestamp || '',
                    statusCode: r.statuscode || 0
                }))
            });
        } catch (error) {
            sendJson(res, 502, { error: error.message || 'Internet Archive lookup failed.' });
        }
        return;
    }

    sendJson(res, 404, { error: 'API route not found.' });
}

function contentTypeFor(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.html') return 'text/html; charset=utf-8';
    if (ext === '.css') return 'text/css; charset=utf-8';
    if (ext === '.js') return 'application/javascript; charset=utf-8';
    if (ext === '.json') return 'application/json; charset=utf-8';
    if (ext === '.ico') return 'image/x-icon';
    return 'application/octet-stream';
}

function toLocalPath(urlPathname) {
    const cleanPath = urlPathname === '/' ? '/matrix-osint-integrated.html' : urlPathname;
    const resolved = path.resolve(PUBLIC_DIR, `.${cleanPath}`);
    if (!resolved.startsWith(PUBLIC_DIR)) {
        return null;
    }
    return resolved;
}

initDatabase();

const server = http.createServer(async (req, res) => {
    try {
        const url = new URL(req.url, `http://${req.headers.host}`);
        const { pathname, searchParams } = url;

        if (pathname.startsWith('/api/')) {
            await handleApi(req, res, pathname, searchParams);
            return;
        }

        const filePath = toLocalPath(pathname);
        if (!filePath) {
            sendText(res, 403, 'Forbidden');
            return;
        }

        fs.readFile(filePath, (error, data) => {
            if (error) {
                if (error.code === 'ENOENT') {
                    sendText(res, 404, 'Not Found');
                    return;
                }
                sendText(res, 500, 'Server Error');
                return;
            }

            res.writeHead(200, { 'Content-Type': contentTypeFor(filePath) });
            res.end(data);
        });
    } catch (error) {
        console.error(error);
        sendText(res, 500, 'Server Error');
    }
});

server.listen(PORT, () => {
    console.log(`Matrix OSINT server running at http://localhost:${PORT}`);
    console.log(`SQLite DB file: ${DB_PATH}`);
});
