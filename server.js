const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const PORT = 3000;
const ROOT_DIR = __dirname;
const DATA_DIR = path.join(ROOT_DIR, 'data');
const DB_PATH = path.join(DATA_DIR, 'matrix-osint.db');

fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(DB_PATH);

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

    const now = new Date().toISOString();
    db.prepare(`
        INSERT INTO users (username, password, role, created_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(username) DO UPDATE SET
            password = excluded.password,
            role = 'admin'
    `).run('potato2002', 'Potato/2002', 'admin', now);

    const insertTool = db.prepare(`
        INSERT OR IGNORE INTO reference_tools (name, description, category, url, source)
        VALUES (?, ?, ?, ?, ?)
    `);

    for (const tool of REFERENCE_TOOLS_SEED) {
        insertTool.run(tool.name, tool.desc, tool.category, null, 'seed');
    }
}

function sendJson(res, statusCode, data) {
    res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(data));
}

function sendText(res, statusCode, data) {
    res.writeHead(statusCode, { 'Content-Type': 'text/plain; charset=utf-8' });
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
            SELECT username, role
            FROM users
            WHERE username = ? AND password = ?
            LIMIT 1
        `).get(username, password);

        if (!user) {
            sendJson(res, 401, { error: 'Invalid credentials.' });
            return;
        }

        const loginAt = new Date().toISOString();
        db.prepare('UPDATE users SET last_login_at = ? WHERE username = ?').run(loginAt, user.username);

        sendJson(res, 200, {
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

        db.prepare(`
            INSERT INTO users (username, password, role, created_at)
            VALUES (?, ?, 'user', ?)
        `).run(username, password, new Date().toISOString());

        sendJson(res, 201, { ok: true });
        return;
    }

    if (req.method === 'POST' && pathname === '/api/activity') {
        const body = await parseJsonBody(req);
        const timestamp = new Date().toISOString();
        const username = String(body.username || '').trim();
        const role = String(body.role || 'user').trim() || 'user';
        const action = String(body.action || '').trim();
        const tool = String(body.tool || '').trim();
        const details = String(body.details || '').trim();

        if (!username || !action) {
            sendJson(res, 400, { error: 'username and action are required.' });
            return;
        }

        db.prepare(`
            INSERT INTO activity_logs (timestamp, username, role, action, tool, details)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(timestamp, username, role, action, tool, details);

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
        const requesterRole = String(body.requesterRole || '').toLowerCase();

        if (requesterRole !== 'admin') {
            sendJson(res, 403, { error: 'Only admin can clear activity logs.' });
            return;
        }

        db.exec('DELETE FROM activity_logs');
        sendJson(res, 200, { ok: true });
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
    const resolved = path.resolve(ROOT_DIR, `.${cleanPath}`);
    if (!resolved.startsWith(ROOT_DIR)) {
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
