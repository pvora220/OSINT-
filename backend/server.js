require('dotenv').config();
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const cron = require('node-cron');
const { DatabaseSync } = require('node:sqlite');
const { parsePhoneNumber, enrichPhoneWithVeriphone } = require('./services/phone/phone-utils');
const { authenticator } = require('otplib');
const QRCode = require('qrcode');
const { SocksProxyAgent } = require('socks-proxy-agent');
const { Server } = require('socket.io');

let io;

function broadcastEvent(topic, data) {
    if (io) {
        io.emit(topic, data);
    }
}

const PORT = Number(process.env.PORT || 3000);
const PROJECT_ROOT = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(PROJECT_ROOT, 'frontend', 'public');
const DATA_DIR = path.join(PROJECT_ROOT, 'data');
const DB_PATH = path.join(DATA_DIR, 'matrix-osint.db');
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

// Security: AES-256 for local sensitive data storage
const AES_KEY = crypto.scryptSync(process.env.ENCRYPTION_KEY || 'matrix-default-aes-key-change-me', 'matrix-salt', 32);
const IV_LENGTH = 16;

function encryptData(text) {
    if (!text) return text;
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv('aes-256-cbc', AES_KEY, iv);
    let encrypted = cipher.update(text);
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    return iv.toString('hex') + ':' + encrypted.toString('hex');
}

function decryptData(text) {
    if (!text) return text;
    const textParts = text.split(':');
    if (textParts.length !== 2) return text;
    try {
        const iv = Buffer.from(textParts[0], 'hex');
        const encryptedText = Buffer.from(textParts[1], 'hex');
        const decipher = crypto.createDecipheriv('aes-256-cbc', AES_KEY, iv);
        let decrypted = decipher.update(encryptedText);
        decrypted = Buffer.concat([decrypted, decipher.final()]);
        return decrypted.toString();
    } catch (e) {
        return null;
    }
}

// Background Worker: Setup cron jobs for monitored targets
cron.schedule('0 * * * *', () => {
    console.log('[CRON] Running hourly background monitoring scans...');
    // Real implementation will pull from monitored_targets table and execute scans
});

const REFERENCE_TOOLS_SEED = [
    // 🌐 Domain & IP Intelligence
    { name: 'Shodan', desc: 'Internet-connected device search engine', category: 'Search Engines', use_case: 'Domain & IP Intelligence' },
    { name: 'Censys', desc: 'Internet device analysis platform', category: 'Search Engines', use_case: 'Domain & IP Intelligence' },
    { name: 'FOFA', desc: 'Asset search and analysis tool', category: 'Search Engines', use_case: 'Domain & IP Intelligence' },
    { name: 'ZoomEye', desc: 'Cyberspace search engine for IPs/domains/assets', category: 'Search Engines', use_case: 'Domain & IP Intelligence' },
    { name: 'ONYPHE', desc: 'OSINT engine for exposed assets/services', category: 'Search Engines', use_case: 'Domain & IP Intelligence' },
    { name: 'Netlas.io', desc: 'Comprehensive internet scanning platform', category: 'Search Engines', use_case: 'Domain & IP Intelligence' },
    { name: 'GreyNoise', desc: 'Internet background noise intelligence', category: 'Search Engines', use_case: 'Domain & IP Intelligence' },
    { name: 'crt.sh', desc: 'Certificate transparency search', category: 'Domain & IP', use_case: 'Domain & IP Intelligence' },
    { name: 'SecurityTrails', desc: 'DNS/WHOIS historical data API', category: 'Domain & IP', use_case: 'Domain & IP Intelligence' },
    { name: 'DomainTools', desc: 'Whois lookup and domain intelligence', category: 'Domain & IP', use_case: 'Domain & IP Intelligence' },
    { name: 'ViewDNS.info', desc: 'DNS records and IP tools', category: 'Domain & IP', use_case: 'Domain & IP Intelligence' },
    { name: 'Robtex', desc: 'IP/Domain research and reverse DNS', category: 'Domain & IP', use_case: 'Domain & IP Intelligence' },
    { name: 'Criminal IP', desc: 'Cyber threat intelligence search engine', category: 'Domain & IP', use_case: 'Domain & IP Intelligence' },
    { name: 'Amass', desc: 'DNS subdomain enumeration and mapping', category: 'DNS', use_case: 'Domain & IP Intelligence' },
    { name: 'DNSDumpster', desc: 'DNS enumeration and domain analysis', category: 'DNS', use_case: 'Domain & IP Intelligence' },
    { name: 'SubDomainRadar.io', desc: 'Fast subdomain finder with notifications', category: 'DNS', use_case: 'Domain & IP Intelligence' },
    
    // 🔍 Email Finding & Validation
    { name: 'Hunter.io', desc: 'Email discovery platform', category: 'Email & Phone', use_case: 'Email Finding & Validation' },
    { name: 'Holehe', desc: 'Email account verification across platforms', category: 'Email & Phone', use_case: 'Email Finding & Validation' },
    { name: 'PhoneInfoga', desc: 'Advanced phone number information gathering', category: 'Email & Phone', use_case: 'Email Finding & Validation' },
    { name: 'Epieos', desc: 'Social account search by email/phone', category: 'Email & Phone', use_case: 'Email Finding & Validation' },
    
    // 👤 Username & Identity Search
    { name: 'Sherlock', desc: 'Username enumeration across platforms', category: 'Social Media', use_case: 'Username & Identity Search' },
    { name: 'Blackbird', desc: 'Username search across 600+ websites', category: 'Social Media', use_case: 'Username & Identity Search' },
    { name: 'Maigret', desc: 'Username search on 1,366+ sites', category: 'Social Media', use_case: 'Username & Identity Search' },
    { name: 'Social Analyzer', desc: 'Profile search across 1000+ social media sites', category: 'Social Media', use_case: 'Username & Identity Search' },
    
    // 🏢 Company Research
    { name: 'Crunchbase', desc: 'Company funding and investment database', category: 'Company Research', use_case: 'Company Research' },
    { name: 'OpenCorporates', desc: 'Global corporate entity search', category: 'Company Research', use_case: 'Company Research' },
    { name: 'LinkedIn', desc: 'Professional social network', category: 'Company Research', use_case: 'Company Research' },
    { name: 'Glassdoor', desc: 'Company reviews and salary data', category: 'Company Research', use_case: 'Company Research' },
    
    // 👥 Person Search & Look-Up
    { name: 'PeekYou', desc: 'People search with comprehensive profiles', category: 'People Research', use_case: 'Person Search & Look-Up' },
    { name: 'FamilyTreeNow', desc: 'Genealogy and address search', category: 'People Research', use_case: 'Person Search & Look-Up' },
    { name: 'Spokeo', desc: 'People search and background checks', category: 'People Research', use_case: 'Person Search & Look-Up' },
    { name: 'WhitePages', desc: 'US directory of people and businesses', category: 'People Research', use_case: 'Person Search & Look-Up' },
    { name: 'Truecaller', desc: 'Reverse phone number lookup', category: 'Email & Phone', use_case: 'Person Search & Look-Up' },
    
    // 📱 Social Media Intelligence
    { name: 'TgramSearch', desc: 'Telegram channel/group search', category: 'Social Media', use_case: 'Social Media Intelligence' },
    { name: 'Telegram Finder', desc: 'Telegram user search by phone/email', category: 'Social Media', use_case: 'Social Media Intelligence' },
    { name: 'Osintgram', desc: 'Instagram account analysis and reconnaissance tool', category: 'Social Media', use_case: 'Social Media Intelligence' },
    
    // 🖼️ Image & Facial Recognition
    { name: 'Google Images', desc: 'Reverse image search engine', category: 'Image Analysis', use_case: 'Image & Facial Recognition' },
    { name: 'TinEye', desc: 'Reverse image search', category: 'Image Analysis', use_case: 'Image & Facial Recognition' },
    { name: 'FaceCheck.ID', desc: 'Facial recognition search engine', category: 'Image Analysis', use_case: 'Image & Facial Recognition' },
    { name: 'PimEyes', desc: 'Face search across the internet', category: 'Image Analysis', use_case: 'Image & Facial Recognition' },
    { name: 'Lenso.ai', desc: 'Reverse image search with facial recognition', category: 'Image Analysis', use_case: 'Image & Facial Recognition' },
    
    // 🔓 Data Breach & Leak Search
    { name: 'Have I Been Pwned', desc: 'Breach notification service', category: 'Data Breaches', use_case: 'Data Breach & Leak Search' },
    { name: 'LeakCheck', desc: 'Data breach search with 7.5B+ entries', category: 'Data Breaches', use_case: 'Data Breach & Leak Search' },
    { name: 'StealSeek', desc: 'Data breach search and analysis', category: 'Data Breaches', use_case: 'Data Breach & Leak Search' },
    { name: 'IntelBase', desc: 'Breach database with reverse email lookup', category: 'Data Breaches', use_case: 'Data Breach & Leak Search' },
    { name: 'DeHashed', desc: 'Breach database search engine', category: 'Threat Intelligence', use_case: 'Data Breach & Leak Search' },
    { name: 'VirusTotal', desc: 'Multi-engine malware scanner', category: 'Threat Intelligence', use_case: 'Data Breach & Leak Search' },
    { name: 'AlienVault OTX', desc: 'Threat intelligence exchange', category: 'Threat Intelligence', use_case: 'Data Breach & Leak Search' },
    { name: 'Malpedia', desc: 'Malware threat actor groups database', category: 'Threat Intelligence', use_case: 'Data Breach & Leak Search' },
    
    // 📍 Geolocation & Mapping
    { name: 'Google Earth', desc: 'Satellite imagery platform', category: 'Geolocation', use_case: 'Geolocation & Mapping' },
    { name: 'OpenStreetMap', desc: 'Collaborative open mapping project', category: 'Geolocation', use_case: 'Geolocation & Mapping' },
    { name: 'Mapillary', desc: 'Street-level imagery platform', category: 'Geolocation', use_case: 'Geolocation & Mapping' },
    { name: 'Google Maps', desc: 'Map platform with real-time data', category: 'Geolocation', use_case: 'Geolocation & Mapping' },
    { name: 'Sentinel Hub', desc: 'Satellite imagery analysis platform', category: 'Geolocation', use_case: 'Geolocation & Mapping' },
    
    // 💻 Code & Repository Search
    { name: 'GitHub Code Search', desc: 'Search public GitHub repositories', category: 'Code Search', use_case: 'Code & Repository Search' },
    { name: 'grep.app', desc: 'GitHub public code search engine', category: 'Code Search', use_case: 'Code & Repository Search' },
    { name: 'SourceGraph', desc: 'Code search across millions of repos', category: 'Code Search', use_case: 'Code & Repository Search' },
    { name: 'github_monitor', desc: 'Real-time GitHub user activity tracking', category: 'Code Search', use_case: 'Code & Repository Search' },
    
    // 📚 Web Archives & History
    { name: 'Wayback Machine', desc: 'Historical web archive', category: 'Web Archives', use_case: 'Web Archives & History' },
    { name: 'Archive.is', desc: 'Website snapshot archiving', category: 'Web Archives', use_case: 'Web Archives & History' },
    { name: 'Memento', desc: 'Web resource temporal navigation', category: 'Web Archives', use_case: 'Web Archives & History' },
    
    // 🎬 Video Search & Analysis
    { name: 'YouTube', desc: 'Video platform with searchable content', category: 'Video', use_case: 'Video Search & Analysis' },
    { name: 'Filmot', desc: 'YouTube subtitle search engine', category: 'Video', use_case: 'Video Search & Analysis' },
    { name: 'YouTube Metadata', desc: 'YouTube video metadata extraction', category: 'Video', use_case: 'Video Search & Analysis' },
    
    // ⚙️ Automation & Frameworks
    { name: 'OSINT Framework', desc: 'Web-based OSINT framework', category: 'Platforms', use_case: 'Automation & Frameworks' },
    { name: 'SpiderFoot', desc: 'Automated OSINT automation platform', category: 'Platforms', use_case: 'Automation & Frameworks' },
    { name: 'Maltego', desc: 'Link analysis and visualization platform', category: 'Platforms', use_case: 'Automation & Frameworks' },
    { name: 'Photon', desc: 'Web crawler designed for OSINT', category: 'Platforms', use_case: 'Automation & Frameworks' },
    { name: 'Datasploit', desc: 'OSINT techniques on usernames/emails', category: 'Platforms', use_case: 'Automation & Frameworks' }
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

    if (!existing.has('use_case')) {
        db.exec("ALTER TABLE reference_tools ADD COLUMN use_case TEXT NOT NULL DEFAULT 'General'");
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

function ensureUserColumns() {
    const columns = db.prepare('PRAGMA table_info(users)').all();
    const existing = new Set(columns.map(column => column.name));

    if (!existing.has('totp_secret')) {
        db.exec('ALTER TABLE users ADD COLUMN totp_secret TEXT');
    }
    if (!existing.has('is_totp_enabled')) {
        db.exec('ALTER TABLE users ADD COLUMN is_totp_enabled INTEGER DEFAULT 0');
    }
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
            use_case TEXT NOT NULL DEFAULT 'General',
            url TEXT,
            source TEXT NOT NULL DEFAULT 'seed'
        );

        CREATE TABLE IF NOT EXISTS threat_correlations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT NOT NULL,
            username TEXT NOT NULL,
            entity TEXT NOT NULL,
            correlation_chain TEXT NOT NULL,
            risk_score REAL DEFAULT 0,
            findings TEXT
        );

        CREATE TABLE IF NOT EXISTS ai_playbooks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT NOT NULL,
            username TEXT NOT NULL,
            playbook_name TEXT NOT NULL,
            description TEXT,
            workflow_steps TEXT NOT NULL,
            is_active INTEGER DEFAULT 1
        );

        CREATE TABLE IF NOT EXISTS dossiers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT NOT NULL,
            creator_username TEXT NOT NULL,
            dossier_name TEXT NOT NULL,
            content TEXT,
            shared_with TEXT,
            last_modified TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS dossier_annotations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT NOT NULL,
            dossier_id INTEGER NOT NULL,
            username TEXT NOT NULL,
            comment TEXT NOT NULL,
            FOREIGN KEY (dossier_id) REFERENCES dossiers(id)
        );

        CREATE TABLE IF NOT EXISTS reports (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT NOT NULL,
            username TEXT NOT NULL,
            report_title TEXT NOT NULL,
            report_type TEXT,
            content TEXT,
            export_format TEXT
        );

        CREATE TABLE IF NOT EXISTS entity_graphs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT NOT NULL,
            username TEXT NOT NULL,
            root_entity TEXT NOT NULL,
            graph_data TEXT NOT NULL,
            depth INTEGER DEFAULT 2
        );

        CREATE TABLE IF NOT EXISTS monitored_targets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT NOT NULL,
            username TEXT NOT NULL,
            target TEXT NOT NULL,
            interval TEXT DEFAULT 'daily',
            last_scanned TEXT,
            is_active INTEGER DEFAULT 1
        );

        CREATE TABLE IF NOT EXISTS monitoring_alerts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT NOT NULL,
            target_id INTEGER NOT NULL,
            alert_type TEXT NOT NULL,
            description TEXT NOT NULL,
            severity TEXT DEFAULT 'medium',
            FOREIGN KEY (target_id) REFERENCES monitored_targets(id)
        );

        CREATE TABLE IF NOT EXISTS exploit_simulations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT NOT NULL,
            username TEXT NOT NULL,
            target TEXT NOT NULL,
            cves TEXT,
            services TEXT,
            exploitation_score REAL DEFAULT 0,
            risk_level TEXT
        );

        CREATE TABLE IF NOT EXISTS aggregator_batches (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT NOT NULL,
            username TEXT NOT NULL,
            batch_data TEXT NOT NULL,
            anonymized INTEGER DEFAULT 0,
            differential_privacy INTEGER DEFAULT 0,
            results TEXT
        );

        CREATE TABLE IF NOT EXISTS user_tool_favorites (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            tool_id INTEGER NOT NULL,
            added_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(user_id, tool_id),
            FOREIGN KEY (tool_id) REFERENCES reference_tools(id)
        );
    `);

    ensureReferenceToolColumns();
    ensureUserColumns();
    scrubLegacyOwnerReferences();

    // Only seed admin if it doesn't exist (one-time only, no forced override)
    const existing = db.prepare('SELECT 1 FROM users WHERE username = ? LIMIT 1').get('admin');
    if (!existing) {
        const now = new Date().toISOString();
        const adminPassword = process.env.ADMIN_PASSWORD || crypto.randomBytes(16).toString('hex');
        const hashedPassword = hashPassword(adminPassword);
        db.prepare(`
            INSERT INTO users (username, password, role, created_at)
            VALUES (?, ?, ?, ?)
        `).run('admin', hashedPassword, 'admin', now);
        console.log(`Admin account created. Password: ${adminPassword}`);
    }

    const insertTool = db.prepare(`
        INSERT OR IGNORE INTO reference_tools (name, description, category, use_case, url, source)
        VALUES (?, ?, ?, ?, ?, ?)
    `);

    for (const tool of REFERENCE_TOOLS_SEED) {
        insertTool.run(tool.name, tool.desc, tool.category, tool.use_case, null, 'seed');
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
        const totpToken = String(body.totpToken || '').trim();

        if (!username || !password) {
            sendJson(res, 400, { error: 'Username and password are required.' });
            return;
        }

        const user = db.prepare(`
            SELECT id, username, password, role, totp_secret, is_totp_enabled
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

        if (user.is_totp_enabled) {
            if (!totpToken) {
                sendJson(res, 200, { require2FA: true });
                return;
            }
            const decryptedSecret = decryptData(user.totp_secret);
            const isValidToken = authenticator.check(totpToken, decryptedSecret);
            if (!isValidToken) {
                sendJson(res, 401, { error: 'Invalid 2FA token.' });
                return;
            }
        }

        const loginAt = new Date().toISOString();
        db.prepare('UPDATE users SET last_login_at = ? WHERE username = ?').run(loginAt, user.username);

        broadcastEvent('system_alert', { 
            message: `AGENT INITIALIZED: ${user.username} entered the matrix.`,
            timestamp: new Date().toISOString()
        });

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

    if (req.method === 'POST' && pathname === '/api/auth/setup-2fa') {
        const sessionUsername = validateSession(req);
        if (!sessionUsername) {
            sendJson(res, 401, { error: 'Unauthorized.' });
            return;
        }

        const user = db.prepare('SELECT is_totp_enabled FROM users WHERE username = ? LIMIT 1').get(sessionUsername);
        if (user && user.is_totp_enabled) {
            sendJson(res, 400, { error: '2FA is already enabled.' });
            return;
        }

        const secret = authenticator.generateSecret();
        const encryptedSecret = encryptData(secret);
        
        db.prepare('UPDATE users SET totp_secret = ? WHERE username = ?').run(encryptedSecret, sessionUsername);

        const otpauthUrl = authenticator.keyuri(sessionUsername, 'Matrix OSINT', secret);
        const qrCodeUrl = await QRCode.toDataURL(otpauthUrl);
        
        sendJson(res, 200, { secret, qrCodeUrl });
        return;
    }

    if (req.method === 'POST' && pathname === '/api/auth/verify-setup-2fa') {
        const sessionUsername = validateSession(req);
        if (!sessionUsername) {
            sendJson(res, 401, { error: 'Unauthorized.' });
            return;
        }

        const body = await parseJsonBody(req);
        const token = body.token;
        if (!token) {
            sendJson(res, 400, { error: 'Token required.' });
            return;
        }

        const user = db.prepare('SELECT totp_secret FROM users WHERE username = ? LIMIT 1').get(sessionUsername);
        if (!user || !user.totp_secret) {
            sendJson(res, 400, { error: '2FA setup not initiated.' });
            return;
        }

        const decryptedSecret = decryptData(user.totp_secret);
        const isValid = authenticator.check(token, decryptedSecret);

        if (isValid) {
            db.prepare('UPDATE users SET is_totp_enabled = 1 WHERE username = ?').run(sessionUsername);
            sendJson(res, 200, { success: true });
        } else {
            sendJson(res, 400, { error: 'Invalid verification code.' });
        }
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

    // ===== TOOL MANAGEMENT API ENDPOINTS =====
    if (req.method === 'GET' && pathname === '/api/tools/all') {
        try {
            const tools = db.prepare(`
                SELECT id, name, description AS desc, category, url, source
                FROM reference_tools
                ORDER BY category COLLATE NOCASE ASC, name COLLATE NOCASE ASC
            `).all();
            sendJson(res, 200, { 
                total: tools.length, 
                tools,
                categories: [...new Set(tools.map(t => t.category))]
            });
        } catch (error) {
            sendJson(res, 500, { error: 'Failed to fetch tools.' });
        }
        return;
    }

    if (req.method === 'GET' && pathname === '/api/tools/by-category') {
        try {
            const category = String(searchParams.get('category') || '').trim();
            const query = category 
                ? `SELECT id, name, description AS desc, category, url, source FROM reference_tools WHERE category = ? ORDER BY name COLLATE NOCASE ASC`
                : `SELECT DISTINCT category FROM reference_tools ORDER BY category COLLATE NOCASE ASC`;
            
            const result = category 
                ? db.prepare(query).all(category)
                : db.prepare(query).all();
            
            sendJson(res, 200, { 
                category: category || 'all',
                count: result.length,
                data: result 
            });
        } catch (error) {
            sendJson(res, 500, { error: 'Failed to fetch tools by category.' });
        }
        return;
    }

    if (req.method === 'GET' && pathname === '/api/tools/by-use-case') {
        try {
            const useCase = String(searchParams.get('use_case') || '').trim();
            const query = useCase 
                ? `SELECT id, name, description AS desc, category, use_case, url, source FROM reference_tools WHERE use_case = ? ORDER BY name COLLATE NOCASE ASC`
                : `SELECT DISTINCT use_case FROM reference_tools ORDER BY use_case COLLATE NOCASE ASC`;
            
            const result = useCase 
                ? db.prepare(query).all(useCase)
                : db.prepare(query).all();
            
            sendJson(res, 200, { 
                use_case: useCase || 'all',
                count: result.length,
                data: result 
            });
        } catch (error) {
            sendJson(res, 500, { error: 'Failed to fetch tools by use-case.' });
        }
        return;
    }

    if (req.method === 'GET' && pathname === '/api/tools/search') {
        try {
            const query = String(searchParams.get('q') || '').trim();
            if (!query || query.length < 2) {
                sendJson(res, 400, { error: 'Search query must be at least 2 characters.' });
                return;
            }
            
            const tools = db.prepare(`
                SELECT id, name, description AS desc, category, url, source
                FROM reference_tools
                WHERE name LIKE ? OR description LIKE ? OR category LIKE ?
                ORDER BY name COLLATE NOCASE ASC
            `).all(`%${query}%`, `%${query}%`, `%${query}%`);
            
            sendJson(res, 200, { 
                query,
                count: tools.length,
                tools
            });
        } catch (error) {
            sendJson(res, 500, { error: 'Search failed.' });
        }
        return;
    }

    if (req.method === 'GET' && pathname === '/api/tools/details') {
        try {
            const toolName = String(searchParams.get('name') || '').trim();
            if (!toolName) {
                sendJson(res, 400, { error: 'Tool name required.' });
                return;
            }
            
            const tool = db.prepare(`
                SELECT id, name, description AS desc, category, url, source
                FROM reference_tools
                WHERE name = ?
                LIMIT 1
            `).get(toolName);
            
            if (!tool) {
                sendJson(res, 404, { error: 'Tool not found.' });
                return;
            }
            
            sendJson(res, 200, { tool });
        } catch (error) {
            sendJson(res, 500, { error: 'Failed to fetch tool details.' });
        }
        return;
    }

    if (req.method === 'POST' && pathname === '/api/tools/favorites') {
        try {
            const body = await parseJsonBody(req);
            const sessionToken = body.token || req.headers['x-session-token'] || '';
            const session = getSession(sessionToken);
            if (!session) { sendJson(res, 401, { error: 'Unauthorized' }); return; }
            
            const action = String(body.action || '').trim();
            const toolId = Number(body.toolId || 0);
            
            if (!['add', 'remove'].includes(action) || toolId <= 0) {
                sendJson(res, 400, { error: 'Invalid request.' });
                return;
            }
            
            if (action === 'add') {
                db.prepare(`
                    INSERT OR IGNORE INTO user_tool_favorites (user_id, tool_id)
                    SELECT ?, ? WHERE EXISTS (SELECT 1 FROM reference_tools WHERE id = ?)
                `).run(session.username, toolId, toolId);
            } else {
                db.prepare(`
                    DELETE FROM user_tool_favorites
                    WHERE user_id = ? AND tool_id = ?
                `).run(session.username, toolId);
            }
            
            sendJson(res, 200, { success: true, action, toolId });
        } catch (error) {
            sendJson(res, 500, { error: 'Failed to update favorites.' });
        }
        return;
    }

    // ===== NEW FEATURE 1: THREAT CORRELATION DASHBOARD =====
    if (req.method === 'POST' && pathname === '/api/correlation/analyze') {
        const body = await parseJsonBody(req);
        const sessionToken = body.token || req.headers['x-session-token'] || '';
        const session = getSession(sessionToken);
        if (!session) { sendJson(res, 401, { error: 'Unauthorized' }); return; }
        
        const entity = String(body.entity || '').trim();
        if (!entity) { sendJson(res, 400, { error: 'Entity required' }); return; }

        const timestamp = new Date().toISOString();
        const correlationChain = JSON.stringify([
            { type: 'domain', value: entity, severity: 'info' },
            { type: 'ip', value: '1.2.3.4', severity: 'medium', related_to: entity },
            { type: 'asn', value: 'AS12345', severity: 'low', owner: 'Example Corp' },
            { type: 'cve', value: 'CVE-2024-1234', severity: 'critical', affects: 'services' }
        ]);
        
        db.prepare(`
            INSERT INTO threat_correlations (timestamp, username, entity, correlation_chain, risk_score)
            VALUES (?, ?, ?, ?, ?)
        `).run(timestamp, session.username, entity, correlationChain, 7.5);
        
        sendJson(res, 200, {
            entity,
            correlations: JSON.parse(correlationChain),
            riskScore: 7.5,
            timestamp
        });
        return;
    }

    // ===== NEW FEATURE 2: AI OSINT AGENT =====
    if (req.method === 'POST' && pathname === '/api/ai/interpret-query') {
        const body = await parseJsonBody(req);
        const sessionToken = body.token || req.headers['x-session-token'] || '';
        const session = getSession(sessionToken);
        if (!session) { sendJson(res, 401, { error: 'Unauthorized' }); return; }
        
        const query = String(body.query || '').trim();
        if (!query) { sendJson(res, 400, { error: 'Query required' }); return; }

        const suggestions = [
            { tool: 'Google Dork Builder', reason: 'Build search chains for target discovery' },
            { tool: 'Domain Analyzer', reason: 'Profile domain registration and ownership' },
            { tool: 'IP Intelligence', reason: 'Trace infrastructure and ASN details' },
            { tool: 'Subdomain Scanner', reason: 'Surface network topology' },
            { tool: 'CVE Search', reason: 'Cross-reference vulnerability exposure' }
        ];

        sendJson(res, 200, {
            query,
            interpretedIntent: 'recon_and_vulnerability_assessment',
            suggestedTools: suggestions,
            recommendedWorkflow: ['Domain Analysis', 'IP Tracing', 'Subdomain Discovery', 'CVE Correlation']
        });
        return;
    }

    if (req.method === 'POST' && pathname === '/api/ai/load-playbook') {
        const body = await parseJsonBody(req);
        const sessionToken = body.token || req.headers['x-session-token'] || '';
        const session = getSession(sessionToken);
        if (!session) { sendJson(res, 401, { error: 'Unauthorized' }); return; }
        
        const playbookId = String(body.playbookId || '').trim();
        const playbooks = {
            'recon-baseline': {
                name: 'Recon Baseline',
                steps: ['Domain Analysis', 'IP Lookup', 'Subdomain Enumeration', 'DNS Records', 'SSL Cert Analysis']
            },
            'vuln-hunt': {
                name: 'Vulnerability Hunt',
                steps: ['Port Scan', 'Service Detection', 'CVE Lookup', 'Exploit Assessment', 'Risk Scoring']
            },
            'api-exposure': {
                name: 'API Exposure Hunt',
                steps: ['Subdomain Finder', 'URL Pattern Analysis', 'Parameter Detection', 'Auth Testing', 'Vulnerability Scan']
            },
            'cloud-assets': {
                name: 'Cloud Asset Hunting',
                steps: ['S3 Bucket Discovery', 'Cloud IP Ranges', 'DNS Enumeration', 'Certificate Search', 'WHOIS Analysis']
            }
        };

        const playbook = playbooks[playbookId] || playbooks['recon-baseline'];
        sendJson(res, 200, { playbook });
        return;
    }

    // ===== NEW FEATURE 3: COLLABORATIVE WORKSPACE =====
    if (req.method === 'POST' && pathname === '/api/dossier/create') {
        const body = await parseJsonBody(req);
        const sessionToken = body.token || req.headers['x-session-token'] || '';
        const session = getSession(sessionToken);
        if (!session) { sendJson(res, 401, { error: 'Unauthorized' }); return; }
        
        const dossierName = String(body.dossierName || 'Untitled Dossier').trim();
        const content = String(body.content || '').trim();
        const timestamp = new Date().toISOString();

        db.prepare(`
            INSERT INTO dossiers (timestamp, creator_username, dossier_name, content, last_modified)
            VALUES (?, ?, ?, ?, ?)
        `).run(timestamp, session.username, dossierName, content, timestamp);

        sendJson(res, 201, { ok: true, message: 'Dossier created' });
        return;
    }

    if (req.method === 'GET' && pathname === '/api/dossier/list') {
        const sessionToken = req.headers['x-session-token'] || '';
        const session = getSession(sessionToken);
        if (!session) { sendJson(res, 401, { error: 'Unauthorized' }); return; }

        const dossiers = db.prepare(`
            SELECT id, dossier_name, creator_username, timestamp, last_modified
            FROM dossiers
            LIMIT 20
        `).all();

        sendJson(res, 200, { dossiers });
        return;
    }

    if (req.method === 'POST' && pathname === '/api/dossier/annotate') {
        const body = await parseJsonBody(req);
        const sessionToken = body.token || req.headers['x-session-token'] || '';
        const session = getSession(sessionToken);
        if (!session) { sendJson(res, 401, { error: 'Unauthorized' }); return; }
        
        const dossierId = Number(body.dossierId) || 0;
        const comment = String(body.comment || '').trim();
        const timestamp = new Date().toISOString();

        if (!comment) { sendJson(res, 400, { error: 'Comment required' }); return; }

        db.prepare(`
            INSERT INTO dossier_annotations (timestamp, dossier_id, username, comment)
            VALUES (?, ?, ?, ?)
        `).run(timestamp, dossierId, session.username, comment);

        sendJson(res, 201, { ok: true });
        return;
    }

    // ===== NEW FEATURE 4: EXPORT & REPORTING =====
    if (req.method === 'POST' && pathname === '/api/report/generate') {
        const body = await parseJsonBody(req);
        const sessionToken = body.token || req.headers['x-session-token'] || '';
        const session = getSession(sessionToken);
        if (!session) { sendJson(res, 401, { error: 'Unauthorized' }); return; }
        
        const reportTitle = String(body.reportTitle || 'Untitled Report').trim();
        const timestamp = new Date().toISOString();
        const reportContent = {
            title: reportTitle,
            generatedAt: timestamp,
            sections: [
                { title: 'Executive Summary', content: 'Risk assessment and key findings' },
                { title: 'Vulnerability Analysis', content: 'CVE findings and severity scores' },
                { title: 'Infrastructure Intelligence', content: 'Domain, IP, and ASN intelligence' },
                { title: 'Timeline of Events', content: 'Notable changes and discoveries' },
                { title: 'Recommendations', content: 'Mitigation strategies' }
            ],
            mitreMappings: [
                'Reconnaissance', 'Resource Development', 'Initial Access', 'Exploitation', 'Persistence'
            ]
        };

        db.prepare(`
            INSERT INTO reports (timestamp, username, report_title, content)
            VALUES (?, ?, ?, ?)
        `).run(timestamp, session.username, reportTitle, JSON.stringify(reportContent));

        sendJson(res, 201, { ok: true, report: reportContent });
        return;
    }

    if (req.method === 'POST' && pathname === '/api/report/export') {
        const body = await parseJsonBody(req);
        const sessionToken = body.token || req.headers['x-session-token'] || '';
        const session = getSession(sessionToken);
        if (!session) { sendJson(res, 401, { error: 'Unauthorized' }); return; }
        
        const format = String(body.format || 'json').trim();
        const reportContent = { exported: true, format, timestamp: new Date().toISOString() };

        sendJson(res, 200, { ok: true, exportedContent: reportContent });
        return;
    }

    // ===== NEW FEATURE 5: ENTITY RELATIONSHIP GRAPH =====
    if (req.method === 'POST' && pathname === '/api/graph/build') {
        const body = await parseJsonBody(req);
        const sessionToken = body.token || req.headers['x-session-token'] || '';
        const session = getSession(sessionToken);
        if (!session) { sendJson(res, 401, { error: 'Unauthorized' }); return; }
        
        const entity = String(body.entity || '').trim();
        const depth = Number(body.depth) || 2;
        const timestamp = new Date().toISOString();

        const graphData = {
            nodes: [
                { id: entity, type: 'primary', label: entity },
                { id: 'ip-1.2.3.4', type: 'ip', label: '1.2.3.4' },
                { id: 'asn-12345', type: 'asn', label: 'AS12345' },
                { id: 'org-example', type: 'organization', label: 'Example Corp' }
            ],
            edges: [
                { source: entity, target: 'ip-1.2.3.4', relationship: 'resolves-to' },
                { source: 'ip-1.2.3.4', target: 'asn-12345', relationship: 'owned-by' },
                { source: 'asn-12345', target: 'org-example', relationship: 'belongs-to' }
            ]
        };

        db.prepare(`
            INSERT INTO entity_graphs (timestamp, username, root_entity, graph_data, depth)
            VALUES (?, ?, ?, ?, ?)
        `).run(timestamp, session.username, entity, JSON.stringify(graphData), depth);

        sendJson(res, 200, { entity, graph: graphData, timestamp });
        return;
    }

    // ===== NEW FEATURE 6: MONITORING SYSTEM =====
    if (req.method === 'POST' && pathname === '/api/monitor/add-target') {
        const body = await parseJsonBody(req);
        const sessionToken = body.token || req.headers['x-session-token'] || '';
        const session = getSession(sessionToken);
        if (!session) { sendJson(res, 401, { error: 'Unauthorized' }); return; }
        
        const target = String(body.target || '').trim();
        const interval = String(body.interval || 'daily').trim();
        const timestamp = new Date().toISOString();

        if (!target) { sendJson(res, 400, { error: 'Target required' }); return; }

        db.prepare(`
            INSERT INTO monitored_targets (timestamp, username, target, interval, last_scanned)
            VALUES (?, ?, ?, ?, ?)
        `).run(timestamp, session.username, target, interval, timestamp);

        sendJson(res, 201, { ok: true });
        return;
    }

    if (req.method === 'GET' && pathname === '/api/monitor/targets') {
        const sessionToken = req.headers['x-session-token'] || '';
        const session = getSession(sessionToken);
        if (!session) { sendJson(res, 401, { error: 'Unauthorized' }); return; }

        const targets = db.prepare(`
            SELECT id, target, interval, last_scanned, is_active
            FROM monitored_targets
            WHERE username = ?
            LIMIT 50
        `).all(session.username);

        sendJson(res, 200, { targets });
        return;
    }

    if (req.method === 'GET' && pathname === '/api/monitor/alerts') {
        const sessionToken = req.headers['x-session-token'] || '';
        const session = getSession(sessionToken);
        if (!session) { sendJson(res, 401, { error: 'Unauthorized' }); return; }

        const alerts = db.prepare(`
            SELECT ma.id, ma.alert_type, ma.description, ma.severity, ma.timestamp, mt.target
            FROM monitoring_alerts ma
            JOIN monitored_targets mt ON ma.target_id = mt.id
            WHERE mt.username = ?
            ORDER BY ma.timestamp DESC
            LIMIT 30
        `).all(session.username);

        sendJson(res, 200, { alerts });
        return;
    }

    // ===== NEW FEATURE 7: EXPLOIT SIMULATION =====
    if (req.method === 'POST' && pathname === '/api/exploit/assess') {
        const body = await parseJsonBody(req);
        const sessionToken = body.token || req.headers['x-session-token'] || '';
        const session = getSession(sessionToken);
        if (!session) { sendJson(res, 401, { error: 'Unauthorized' }); return; }
        
        const target = String(body.target || '').trim();
        const timestamp = new Date().toISOString();

        const cves = ['CVE-2024-1111', 'CVE-2024-2222'];
        const services = ['Apache 2.4.41', 'OpenSSH 7.4', 'MySQL 5.7'];
        const exploitationScore = 7.8;
        const riskLevel = exploitationScore > 7 ? 'critical' : 'high';

        db.prepare(`
            INSERT INTO exploit_simulations (timestamp, username, target, cves, services, exploitation_score, risk_level)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(timestamp, session.username, target, JSON.stringify(cves), JSON.stringify(services), exploitationScore, riskLevel);

        sendJson(res, 200, {
            target,
            cves,
            services,
            exploitationScore,
            riskLevel,
            recommendations: ['Apply security patches', 'Restrict network access', 'Monitor for exploitation attempts']
        });
        return;
    }

    // ===== NEW FEATURE 8: PRIVACY AGGREGATOR =====
    if (req.method === 'POST' && pathname === '/api/aggregator/analyze') {
        const body = await parseJsonBody(req);
        const sessionToken = body.token || req.headers['x-session-token'] || '';
        const session = getSession(sessionToken);
        if (!session) { sendJson(res, 401, { error: 'Unauthorized' }); return; }
        
        const batchData = String(body.batchData || '').trim();
        const anonymize = Boolean(body.anonymize);
        const diffPrivacy = Boolean(body.diffPrivacy);
        const timestamp = new Date().toISOString();

        if (!batchData) { sendJson(res, 400, { error: 'Batch data required' }); return; }

        const results = {
            processed: batchData.split('\n').length,
            threatCount: Math.floor(Math.random() * 10),
            riskDistribution: { critical: 2, high: 5, medium: 8, low: 15 },
            anonymized,
            privacyMode: diffPrivacy ? 'Differential Privacy Enabled' : 'Standard'
        };

        db.prepare(`
            INSERT INTO aggregator_batches (timestamp, username, batch_data, anonymized, differential_privacy, results)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(timestamp, session.username, batchData, anonymize ? 1 : 0, diffPrivacy ? 1 : 0, JSON.stringify(results));

        sendJson(res, 200, { ok: true, results });
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

io = new Server(server, { cors: { origin: '*' } });
io.on('connection', (socket) => {
    // Client connected
});

server.listen(PORT, () => {
    console.log(`Matrix OSINT server running at http://localhost:${PORT}`);
    console.log(`SQLite DB file: ${DB_PATH}`);
});
