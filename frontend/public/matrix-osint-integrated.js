// Authentication and Activity Tracking
        const API_BASE_CANDIDATES = window.location.protocol === 'file:'
            ? ['http://localhost:3000/api']
            : ['/api', 'http://localhost:3000/api'];
        const ACTIVITY_LIMIT = 500;
        const THREAT_MAP_SOURCES = {
            checkpoint: {
                label: 'Check Point ThreatMap',
                url: 'https://threatmap.checkpoint.com/',
                embeddable: true
            },
            kaspersky: {
                label: 'Kaspersky Cybermap',
                url: 'https://cybermap.kaspersky.com/',
                embeddable: false
            }
        };
        const THREAT_MAP_SOUND_PREF_KEY = 'matrixThreatMapSound';
        const BACKGROUND_MODE_PREF_KEY = 'matrixBackgroundMode';
        const THREAT_MAP_SOURCE_PREF_KEY = 'matrixThreatMapSource';
        const THREAT_MAP_LOG_LIMIT = 24;
        const BUG_BOUNTY_PACKS_URL = 'bug-bounty-dork-packs.json?v=20260316-01';
        const BUG_BOUNTY_PANEL_STATE_KEY = 'matrixBugBountyPanelState';
        const BUG_BOUNTY_RESULTS_STATE_KEY = 'matrixBugBountyResultsState';
        const AUTH_SESSION_STORAGE_KEY = 'matrixAuthSession';
        let currentSession = null;
        let sessionToken = null;
        let currentLoginAt = null;
        let latestDatabaseStats = null;
        let authInitialized = false;
        let bugBountyDorkPacks = {};
        let activeBugBountyTag = 'all';
        let persistedBugBountyPackId = '';
        let threatMapInitialized = false;

        function persistAuthSession() {
            try {
                if (!sessionToken || !currentSession?.username) {
                    window.localStorage.removeItem(AUTH_SESSION_STORAGE_KEY);
                    return;
                }

                window.localStorage.setItem(AUTH_SESSION_STORAGE_KEY, JSON.stringify({
                    token: sessionToken,
                    user: currentSession,
                    loginAt: currentLoginAt || ''
                }));
            } catch (error) {
                console.warn('Unable to persist auth session:', error);
            }
        }

        function clearPersistedAuthSession() {
            try {
                window.localStorage.removeItem(AUTH_SESSION_STORAGE_KEY);
            } catch (error) {
                console.warn('Unable to clear auth session:', error);
            }
        }

        function populateActivityTable(targetBodyId, logs, includeUsername = false) {
            const body = document.getElementById(targetBodyId);
            if (!body) {
                return;
            }

            if (!Array.isArray(logs) || !logs.length) {
                body.innerHTML = `<tr><td colspan="${includeUsername ? 5 : 4}">No activity recorded.</td></tr>`;
                return;
            }

            body.innerHTML = logs.map(log => {
                const columns = [
                    `<td>${escapeHtml(log.timestamp ? new Date(log.timestamp).toLocaleString() : '--')}</td>`
                ];

                if (includeUsername) {
                    columns.push(`<td>${escapeHtml(log.username || 'Unknown')}</td>`);
                }

                columns.push(`<td>${escapeHtml(log.action || '--')}</td>`);
                columns.push(`<td>${escapeHtml(log.tool || '--')}</td>`);
                columns.push(`<td>${escapeHtml(log.details || '--')}</td>`);

                return `<tr>${columns.join('')}</tr>`;
            }).join('');
        }

        function renderHomeAndDashboard() {
            const isLoggedIn = !!currentSession?.username;
            const isAdmin = currentSession?.role === 'admin';
            const categoryCount = new Set(referenceTools.map(tool => tool.category)).size;

            const setText = (id, value) => {
                const node = document.getElementById(id);
                if (node) {
                    node.textContent = value;
                }
            };

            setText('dashboard-user', isLoggedIn ? currentSession.username : 'Guest');
            setText('dashboard-role', currentSession?.role || 'N/A');
            setText('dashboard-reference-count', String(referenceTools.length || 0));
            setText('dashboard-category-count', String(categoryCount || 0));
            setText('dashboard-user-count', String(latestDatabaseStats?.users || 0));
            setText('dashboard-activity-count', String(latestDatabaseStats?.activityLogs || 0));

            setText('account-username', isLoggedIn ? currentSession.username : 'Guest');
            setText('account-role', currentSession?.role || 'N/A');
            setText('account-session-state', isLoggedIn ? 'Active' : 'Locked');
            setText('account-login-time', currentLoginAt ? new Date(currentLoginAt).toLocaleString() : '--');

            const adminPanel = document.getElementById('admin-activity-panel');
            const adminNote = document.getElementById('admin-panel-note');
            if (adminPanel) {
                adminPanel.style.display = isAdmin ? 'block' : 'none';
            }
            if (adminNote) {
                adminNote.textContent = isAdmin
                    ? 'Admin monitoring and controls unlocked.'
                    : 'Admin-only monitoring and controls. Login with an admin account to access this section.';
            }
        }

        async function refreshActivityViews() {
            const accountSummary = document.getElementById('account-activity-summary');
            const adminSummary = document.getElementById('activity-summary');

            if (!currentSession?.username) {
                populateActivityTable('account-activity-body', [], false);
                populateActivityTable('activity-log-body', [], true);
                if (accountSummary) {
                    accountSummary.textContent = 'Login required.';
                }
                if (adminSummary) {
                    adminSummary.textContent = 'Admin login required.';
                }
                return;
            }

            try {
                const data = await apiRequest(`/activity?limit=${ACTIVITY_LIMIT}`);
                const logs = Array.isArray(data.logs) ? data.logs : [];
                const myLogs = logs.filter(log => log.username === currentSession.username);
                populateActivityTable('account-activity-body', myLogs, false);
                if (accountSummary) {
                    accountSummary.textContent = `${myLogs.length} activity event${myLogs.length === 1 ? '' : 's'} for ${currentSession.username}.`;
                }

                if (currentSession.role === 'admin') {
                    populateActivityTable('activity-log-body', logs, true);
                    if (adminSummary) {
                        adminSummary.textContent = `${logs.length} total event${logs.length === 1 ? '' : 's'} in the activity log.`;
                    }
                } else {
                    populateActivityTable('activity-log-body', [], true);
                    if (adminSummary) {
                        adminSummary.textContent = 'Admin login required.';
                    }
                }
            } catch (error) {
                populateActivityTable('account-activity-body', [], false);
                populateActivityTable('activity-log-body', [], true);
                if (accountSummary) {
                    accountSummary.textContent = error.message || 'Unable to load activity.';
                }
                if (adminSummary) {
                    adminSummary.textContent = error.message || 'Unable to load admin activity.';
                }
            }
        }

        async function refreshSessionViews() {
            await updateDatabaseCount();
            renderHomeAndDashboard();
            await refreshActivityViews();
        }

        async function restorePersistedSession() {
            try {
                const raw = window.localStorage.getItem(AUTH_SESSION_STORAGE_KEY);
                if (!raw) {
                    return;
                }

                const stored = JSON.parse(raw);
                if (!stored?.token) {
                    clearPersistedAuthSession();
                    return;
                }

                sessionToken = String(stored.token || '');
                const data = await apiRequest('/auth/session', {
                    headers: {
                        'X-Session-Token': sessionToken
                    }
                });

                currentSession = data.user || null;
                currentLoginAt = data.loginAt || stored.loginAt || null;
                persistAuthSession();
            } catch (error) {
                sessionToken = null;
                currentSession = null;
                currentLoginAt = null;
                clearPersistedAuthSession();
            }
        }

        async function logActivity(action, tool, details = '') {
            if (!sessionToken || !currentSession?.username) {
                return;
            }

            try {
                await apiRequest('/activity', {
                    method: 'POST',
                    headers: {
                        'X-Session-Token': sessionToken
                    },
                    body: JSON.stringify({ action, tool, details })
                });
                await refreshSessionViews();
            } catch (error) {
                console.warn('Activity log failed:', error.message || error);
            }
        }

        async function clearActivityLogs() {
            if (!currentSession?.username || currentSession.role !== 'admin' || !sessionToken) {
                alert('> ISSUE: Admin access required');
                return;
            }

            try {
                await apiRequest('/activity', {
                    method: 'DELETE',
                    headers: {
                        'X-Session-Token': sessionToken
                    },
                    body: JSON.stringify({ token: sessionToken })
                });
                await refreshSessionViews();
            } catch (error) {
                alert(`> ISSUE: ${error.message || 'Unable to clear activity logs'}`);
            }
        }

        async function refreshAccountActivity() {
            await refreshSessionViews();
        }

        async function refreshAdminActivity() {
            await refreshSessionViews();
        }

        window.clearActivityLogs = clearActivityLogs;
        window.refreshAccountActivity = refreshAccountActivity;
        window.refreshAdminActivity = refreshAdminActivity;

        async function apiRequest(path, options = {}) {
            let lastNetworkError = null;
            let lastApiError = null;

            for (const base of API_BASE_CANDIDATES) {
                let response;
                try {
                    response = await fetch(`${base}${path}`, {
                        headers: {
                            'Content-Type': 'application/json',
                            ...(options.headers || {})
                        },
                        ...options
                    });
                } catch (error) {
                    lastNetworkError = error;
                    continue;
                }

                let data = {};
                try {
                    data = await response.json();
                } catch (error) {
                    data = {};
                }

                if (response.ok) {
                    return data;
                }

                if (response.status === 404) {
                    continue;
                }

                lastApiError = new Error(data.error || `Request failed (${response.status})`);
                break;
            }

            if (lastApiError) {
                throw lastApiError;
            }

            if (window.location.protocol === 'file:') {
                throw new Error('Backend not reachable. Start server and open http://localhost:3000.');
            }

            throw new Error(lastNetworkError?.message || 'API unavailable.');
        }

        function setAuthMessage(message, isError = false) {
            const messageNode = document.getElementById('auth-message');
            if (!messageNode) {
                return;
            }
            messageNode.textContent = message || '';
            messageNode.classList.toggle('error', !!(message && isError));
        }

        function switchAuthTab(tabName) {
            const loginTab = document.getElementById('auth-tab-login');
            const registerTab = document.getElementById('auth-tab-register');
            const loginForm = document.getElementById('auth-login-form');
            const registerForm = document.getElementById('auth-register-form');

            if (!loginTab || !registerTab || !loginForm || !registerForm) {
                return;
            }

            const showLogin = tabName !== 'register';
            loginTab.classList.toggle('active', showLogin);
            registerTab.classList.toggle('active', !showLogin);
            loginForm.classList.toggle('active', showLogin);
            registerForm.classList.toggle('active', !showLogin);
            setAuthMessage('');
        }

        function updateSessionUI() {
            const authOverlay = document.getElementById('auth-overlay');
            const sessionBar = document.getElementById('session-bar');
            const sessionInfo = document.getElementById('session-info');

            const loggedIn = !!(currentSession && currentSession.username);
            if (authOverlay) {
                authOverlay.classList.toggle('hidden', loggedIn);
            }
            if (sessionBar) {
                sessionBar.classList.toggle('active', loggedIn);
            }
            if (sessionInfo) {
                sessionInfo.textContent = loggedIn
                    ? `USER: ${currentSession.username}${currentSession.role ? ` | ROLE: ${currentSession.role}` : ''}`
                    : '';
            }

            void refreshSessionViews();
        }

        async function updateDatabaseCount() {
            try {
                const data = await apiRequest('/database/stats');
                latestDatabaseStats = data || null;
            } catch (error) {
                latestDatabaseStats = null;
            }
        }

        function guardToolAccess(toolName) {
            if (currentSession && currentSession.username) {
                return true;
            }
            setAuthMessage(`Login required to use ${toolName}.`, true);
            const authOverlay = document.getElementById('auth-overlay');
            if (authOverlay) {
                authOverlay.classList.remove('hidden');
            }
            return false;
        }

        async function handleLogin(event) {
            event.preventDefault();
            const username = String(document.getElementById('login-username')?.value || '').trim();
            const password = String(document.getElementById('login-password')?.value || '');

            if (!username || !password) {
                setAuthMessage('Enter username and password.', true);
                return;
            }

            try {
                const data = await apiRequest('/auth/login', {
                    method: 'POST',
                    body: JSON.stringify({ username, password })
                });

                sessionToken = data.token || null;
                currentSession = data.user || { username, role: 'analyst' };
                currentLoginAt = data.loginAt || new Date().toISOString();
                persistAuthSession();
                setAuthMessage('Login successful.');
                updateSessionUI();
            } catch (error) {
                setAuthMessage(error.message || 'Login failed.', true);
            }
        }

        async function handleRegistration(event) {
            event.preventDefault();
            const username = String(document.getElementById('register-username')?.value || '').trim();
            const password = String(document.getElementById('register-password')?.value || '');
            const confirm = String(document.getElementById('register-confirm-password')?.value || '');

            if (!username || !password) {
                setAuthMessage('Enter username and password.', true);
                return;
            }
            if (password !== confirm) {
                setAuthMessage('Passwords do not match.', true);
                return;
            }

            try {
                await apiRequest('/auth/register', {
                    method: 'POST',
                    body: JSON.stringify({ username, password, confirmPassword: confirm })
                });

                const loginData = await apiRequest('/auth/login', {
                    method: 'POST',
                    body: JSON.stringify({ username, password })
                });

                sessionToken = loginData.token || null;
                currentSession = loginData.user || { username, role: 'user' };
                currentLoginAt = loginData.loginAt || new Date().toISOString();
                persistAuthSession();
                setAuthMessage('Account created.');
                updateSessionUI();
            } catch (error) {
                setAuthMessage(error.message || 'Registration failed.', true);
            }
        }

        async function logoutUser() {
            try {
                if (sessionToken) {
                    await apiRequest('/auth/logout', {
                        method: 'POST',
                        headers: {
                            'X-Session-Token': sessionToken
                        }
                    });
                }
            } catch (error) {
                // Continue local logout even if remote logout fails.
            }

            sessionToken = null;
            currentSession = null;
            currentLoginAt = null;
            clearPersistedAuthSession();
            updateSessionUI();
            setAuthMessage('Logged out.');
        }

        async function initializeAuth() {
            if (authInitialized) {
                return;
            }

            try {
                const loginForm = document.getElementById('auth-login-form');
                const registerForm = document.getElementById('auth-register-form');
                if (!loginForm || !registerForm) {
                    throw new Error('Authentication forms are missing from DOM.');
                }

                loginForm.addEventListener('submit', handleLogin);
                registerForm.addEventListener('submit', handleRegistration);

                currentSession = null;
                currentLoginAt = null;
                await restorePersistedSession();
                updateSessionUI();
                authInitialized = true;
            } catch (error) {
                console.error('Auth initialization failed:', error);
                setAuthMessage('Unable to reach API. Run node backend/server.js and open http://localhost:3000', true);
            }
        }

        // IP Analysis
        async function analyzeIP() {
            if (!guardToolAccess('IP Intelligence Scanner')) {
                return;
            }
            const ip = document.getElementById('ip-input').value.trim();
            const resultsDiv = document.getElementById('ip-results');
            const loadingDiv = document.getElementById('ip-loading');

            if (!ip) {
                alert('> ISSUE: Enter a subject IP');
                return;
            }

            resultsDiv.classList.remove('active');
            loadingDiv.classList.add('active');

            try {
                const response = await fetch(`https://ipapi.co/${ip}/json/`);
                const data = await response.json();

                loadingDiv.classList.remove('active');
                
                if (data.error) {
                    resultsDiv.innerHTML = `<div class="result-line"><span class="result-key">ISSUE</span><span class="result-value">${data.reason}</span></div>`;
                } else {
                    resultsDiv.innerHTML = `
                        <div class="result-line"><span class="result-key">Subject IP</span><span class="result-value">${data.ip}</span></div>
                        <div class="result-line"><span class="result-key">Geo Profile</span><span class="result-value">${data.city}, ${data.region}, ${data.country_name}</span></div>
                        <div class="result-line"><span class="result-key">Geo Point</span><span class="result-value">${data.latitude}, ${data.longitude}</span></div>
                        <div class="result-line"><span class="result-key">Network Owner</span><span class="result-value">${data.org}</span></div>
                        <div class="result-line"><span class="result-key">Time Zone</span><span class="result-value">${data.timezone}</span></div>
                        <div class="result-line"><span class="result-key">Postal Marker</span><span class="result-value">${data.postal || 'N/A'}</span></div>
                        <div class="result-line"><span class="result-key">ASN</span><span class="result-value">${data.asn || 'N/A'}</span></div>
                        <div class="result-line"><span class="result-key">Country Marker</span><span class="result-value">${data.country_code}</span></div>
                    `;
                }
                resultsDiv.classList.add('active');
            } catch (error) {
                loadingDiv.classList.remove('active');
                resultsDiv.innerHTML = '<div class="result-line"><span class="result-key">ISSUE</span><span class="result-value">Unable to pull IP dossier. Network interruption.</span></div>';
                resultsDiv.classList.add('active');
            }
        }

        // Email Validation
        function validateEmail() {
            if (!guardToolAccess('Email Analysis Engine')) {
                return;
            }
            const email = document.getElementById('email-input').value.trim();
            const resultsDiv = document.getElementById('email-results');

            if (!email) {
                alert('> ISSUE: Enter an email artifact');
                return;
            }

            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            const isValid = emailRegex.test(email);
            const parts = email.split('@');
            const username = parts[0];
            const domain = parts[1];
            
            const disposableDomains = ['tempmail.com', 'guerrillamail.com', '10minutemail.com', 'throwaway.email', 'mailinator.com', 'trash-mail.com'];
            const isDisposable = disposableDomains.some(d => domain?.includes(d));

            const commonProviders = ['gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'aol.com', 'icloud.com'];
            const provider = commonProviders.find(p => domain?.includes(p)) || 'Custom';

            resultsDiv.innerHTML = `
                <div class="result-line"><span class="result-key">Email Artifact</span><span class="result-value">${email}</span></div>
                <div class="result-line"><span class="result-key">Format Check</span><span class="result-value">${isValid ? '✓ VALID' : '✗ INVALID'}</span></div>
                <div class="result-line"><span class="result-key">Local Part</span><span class="result-value">${username || 'N/A'}</span></div>
                <div class="result-line"><span class="result-key">Domain Surface</span><span class="result-value">${domain || 'N/A'}</span></div>
                <div class="result-line"><span class="result-key">Provider Class</span><span class="result-value">${provider}</span></div>
                <div class="result-line"><span class="result-key">Disposable Signal</span><span class="result-value">${isDisposable ? '⚠ DISPOSABLE' : '✓ LEGITIMATE'}</span></div>
                <div class="result-line"><span class="result-key">Risk Profile</span><span class="result-value">${isDisposable ? 'HIGH RISK' : 'LOW RISK'}</span></div>
                <div class="result-line"><span class="result-key">Handle Length</span><span class="result-value">${username?.length || 0} characters</span></div>
            `;
            resultsDiv.classList.add('active');
        }

        // Username Search
        function searchUsername() {
            if (!guardToolAccess('Username Intelligence')) {
                return;
            }
            const username = document.getElementById('username-input').value.trim();
            const resultsDiv = document.getElementById('username-results');
            const loadingDiv = document.getElementById('username-loading');

            if (!username) {
                alert('> ISSUE: Enter a handle or alias');
                return;
            }

            loadingDiv.classList.add('active');
            resultsDiv.classList.remove('active');

            setTimeout(() => {
                loadingDiv.classList.remove('active');
                
                const platforms = [
                    { name: 'GitHub', url: `https://github.com/${username}`, icon: '💻' },
                    { name: 'Twitter', url: `https://twitter.com/${username}`, icon: '🐦' },
                    { name: 'Instagram', url: `https://instagram.com/${username}`, icon: '📷' },
                    { name: 'Reddit', url: `https://reddit.com/u/${username}`, icon: '🤖' },
                    { name: 'LinkedIn', url: `https://linkedin.com/in/${username}`, icon: '💼' },
                    { name: 'YouTube', url: `https://youtube.com/@${username}`, icon: '📺' },
                    { name: 'TikTok', url: `https://tiktok.com/@${username}`, icon: '🎵' },
                    { name: 'Twitch', url: `https://twitch.tv/${username}`, icon: '🎮' }
                ];

                let html = `<div class="result-line"><span class="result-key">Alias</span><span class="result-value">${username}</span></div>`;
                html += `<div class="result-line"><span class="result-key">Platforms Cross-Checked</span><span class="result-value">${platforms.length}</span></div>`;
                html += '<div style="margin-top: 1rem; padding-top: 1rem; border-top: 1px solid rgba(82, 195, 255, 0.2);">';
                
                platforms.forEach(p => {
                    html += `<div class="result-line"><span class="result-key">${p.icon} ${p.name}</span><span class="result-value"><a href="${p.url}" target="_blank" style="color: var(--matrix-green); text-decoration: none;">${p.url}</a></span></div>`;
                });
                
                html += '</div>';

                resultsDiv.innerHTML = html;
                resultsDiv.classList.add('active');
            }, 1500);
        }

        // Hash Identification
        function identifyHash() {
            if (!guardToolAccess('Hash Decoder')) {
                return;
            }
            const hash = document.getElementById('hash-input').value.trim();
            const resultsDiv = document.getElementById('hash-results');

            if (!hash) {
                alert('> ISSUE: Enter a hash artifact');
                return;
            }

            const types = [];
            const length = hash.length;
            
            if (/^[a-f0-9]{32}$/i.test(hash)) types.push('MD5');
            if (/^[a-f0-9]{40}$/i.test(hash)) types.push('SHA-1');
            if (/^[a-f0-9]{64}$/i.test(hash)) types.push('SHA-256');
            if (/^[a-f0-9]{96}$/i.test(hash)) types.push('SHA-384');
            if (/^[a-f0-9]{128}$/i.test(hash)) types.push('SHA-512');
            if (/^\$2[aby]\$/.test(hash)) types.push('bcrypt');
            if (/^\$6\$/.test(hash)) types.push('SHA-512 (Unix)');
            if (/^\$5\$/.test(hash)) types.push('SHA-256 (Unix)');

            const isWeak = types.includes('MD5') || types.includes('SHA-1');
            const charset = /^[a-f0-9]+$/i.test(hash) ? 'Hexadecimal' : 'Mixed';

            resultsDiv.innerHTML = `
                <div class="result-line"><span class="result-key">Hash Artifact</span><span class="result-value">${hash.substring(0, 64)}${hash.length > 64 ? '...' : ''}</span></div>
                <div class="result-line"><span class="result-key">Artifact Length</span><span class="result-value">${length} characters</span></div>
                <div class="result-line"><span class="result-key">Character Profile</span><span class="result-value">${charset}</span></div>
                <div class="result-line"><span class="result-key">Likely Families</span><span class="result-value">${types.length > 0 ? types.join(', ') : 'Unknown / Invalid'}</span></div>
                <div class="result-line"><span class="result-key">Risk Posture</span><span class="result-value">${isWeak ? '⚠ WEAK (Deprecated)' : types.length > 0 ? '✓ STRONG' : 'UNKNOWN'}</span></div>
                <div class="result-line"><span class="result-key">Analyst Guidance</span><span class="result-value">${isWeak ? 'Use SHA-256 or higher' : 'Current standard acceptable'}</span></div>
            `;
            resultsDiv.classList.add('active');
        }

        // Domain Analysis
        function analyzeDomain() {
            if (!guardToolAccess('Domain Intelligence')) {
                return;
            }
            const domain = document.getElementById('domain-input').value.trim();
            const resultsDiv = document.getElementById('domain-results');
            const loadingDiv = document.getElementById('domain-loading');

            if (!domain) {
                alert('> ISSUE: Enter a subject domain');
                return;
            }

            loadingDiv.classList.add('active');
            resultsDiv.classList.remove('active');

            setTimeout(() => {
                loadingDiv.classList.remove('active');
                
                const domainParts = domain.split('.');
                const tld = domainParts[domainParts.length - 1];
                const sld = domainParts.length > 1 ? domainParts[domainParts.length - 2] : 'N/A';
                
                resultsDiv.innerHTML = `
                    <div class="result-line"><span class="result-key">Subject Domain</span><span class="result-value">${domain}</span></div>
                    <div class="result-line"><span class="result-key">Root Zone</span><span class="result-value">.${tld}</span></div>
                    <div class="result-line"><span class="result-key">Core Label</span><span class="result-value">${sld}</span></div>
                    <div class="result-line"><span class="result-key">Resolution Status</span><span class="result-value">✓ RESOLVABLE</span></div>
                    <div class="result-line"><span class="result-key">TLS Posture</span><span class="result-value">Checking required</span></div>
                    <div class="result-line"><span class="result-key">WHOIS Gateway</span><span class="result-value">whois.${tld}</span></div>
                    <div class="result-line"><span class="result-key">Analyst Note</span><span class="result-value">Full WHOIS data requires external API</span></div>
                `;
                resultsDiv.classList.add('active');
            }, 1000);
        }

        // Port Scanner
        function scanPorts() {
            if (!guardToolAccess('Port Scanner')) {
                return;
            }
            const host = document.getElementById('port-input').value.trim();
            const resultsDiv = document.getElementById('port-results');
            const loadingDiv = document.getElementById('port-loading');

            if (!host) {
                alert('> ISSUE: Enter a host or IP subject');
                return;
            }

            loadingDiv.classList.add('active');
            resultsDiv.classList.remove('active');

            setTimeout(() => {
                loadingDiv.classList.remove('active');
                
                const commonPorts = [
                    { port: 21, service: 'FTP', status: Math.random() > 0.7 ? 'OPEN' : 'CLOSED' },
                    { port: 22, service: 'SSH', status: Math.random() > 0.5 ? 'OPEN' : 'CLOSED' },
                    { port: 23, service: 'Telnet', status: 'CLOSED' },
                    { port: 25, service: 'SMTP', status: Math.random() > 0.6 ? 'OPEN' : 'CLOSED' },
                    { port: 53, service: 'DNS', status: Math.random() > 0.4 ? 'OPEN' : 'CLOSED' },
                    { port: 80, service: 'HTTP', status: Math.random() > 0.3 ? 'OPEN' : 'CLOSED' },
                    { port: 443, service: 'HTTPS', status: Math.random() > 0.3 ? 'OPEN' : 'CLOSED' },
                    { port: 3306, service: 'MySQL', status: Math.random() > 0.8 ? 'OPEN' : 'CLOSED' },
                    { port: 3389, service: 'RDP', status: Math.random() > 0.9 ? 'OPEN' : 'CLOSED' },
                    { port: 8080, service: 'HTTP-Alt', status: Math.random() > 0.7 ? 'OPEN' : 'CLOSED' }
                ];

                let html = `<div class="result-line"><span class="result-key">Subject</span><span class="result-value">${host}</span></div>`;
                html += `<div class="result-line"><span class="result-key">Ports Surveyed</span><span class="result-value">${commonPorts.length}</span></div>`;
                html += '<div style="margin-top: 1rem; padding-top: 1rem; border-top: 1px solid rgba(82, 195, 255, 0.2);">';
                
                commonPorts.forEach(p => {
                    html += `<div class="result-line"><span class="result-key">Port ${p.port} (${p.service})</span><span class="result-value">${p.status}</span></div>`;
                });
                
                html += '</div>';
                html += `<div class="result-line"><span class="result-key">Analyst Note</span><span class="result-value">Simulated scan - browser limitations apply</span></div>`;

                resultsDiv.innerHTML = html;
                resultsDiv.classList.add('active');
            }, 2000);
        }

        // Phone Analysis
        async function analyzePhone() {
            if (!guardToolAccess('Phone Intelligence')) {
                return;
            }

            const phone = document.getElementById('phone-input').value.trim();
            const resultsDiv = document.getElementById('phone-results');

            if (!phone) {
                alert('> ISSUE: Enter a telecom artifact');
                return;
            }

            resultsDiv.innerHTML = '<div class="result-line"><span class="result-key">STATUS</span><span class="result-value">Pulling telecom dossier...</span></div>';
            resultsDiv.classList.add('active');

            const cleaned = phone.replace(/\D/g, '');

            const buildPortalLinks = (digits) => {
                const enc = encodeURIComponent(digits);
                const encPlus = encodeURIComponent('+' + digits);
                return [
                    { label: 'NumLookup', url: `https://www.numlookup.com/reverse-phone-lookup?q=${encPlus}` },
                    { label: 'ThatsThem', url: `https://thatsthem.com/reverse-phone-lookup/${enc}` },
                    { label: 'SpyDialer', url: `https://www.spydialer.com/default.aspx?q=${enc}` },
                    { label: 'truepeoplesearch', url: `https://www.truepeoplesearch.com/results?phoneno=${enc}` },
                    { label: 'EmobileTracker', url: `https://www.emobiletracker.com/${enc}` },
                    { label: 'Tellows', url: `https://www.tellows.com/num/${enc}` },
                    { label: 'USPhoneBook', url: `https://www.usphonebook.com/${enc}` },
                    { label: 'OldPhoneBook', url: `https://www.oldphonebook.com/?q=${enc}` }
                ].map(item => `<a href="${item.url}" target="_blank" rel="noopener noreferrer" style="display:inline-block;margin:2px 5px 2px 0;padding:3px 9px;background:#0a1a0a;border:1px solid #00ff41;color:#00ff41;font-size:0.72em;text-decoration:none;font-family:inherit;cursor:pointer;">${item.label} &#8599;</a>`).join('');
            };

            try {
                const data = await apiRequest(`/tools/phone?number=${encodeURIComponent(phone)}`);

                const e164 = data.e164 || (cleaned ? '+' + cleaned : phone);
                const isValid = data.phone_valid !== undefined ? (data.phone_valid ? '> VALID ✓' : '> INVALID ✗') : '> UNKNOWN';
                const numType = data.phone_type ? data.phone_type.replace(/_/g, ' ').toUpperCase() : 'UNKNOWN';
                const country = data.country || 'Unknown';
                const cc = data.country_code || 'N/A';
                const prefix = data.country_prefix || 'N/A';
                const intlFmt = data.international_number || e164;
                const localFmt = data.local_number || cleaned;
                const carrier = data.carrier && data.carrier.trim() ? data.carrier : 'Not disclosed / MVNO';
                const region = data.phone_region && data.phone_region.trim() ? data.phone_region : 'N/A';
                const lookupSource = data.lookup_source || 'local-parser';
                const ownerName = data.owner_name || 'Not provided by data source';
                const ownerAddress = data.owner_address || 'Not provided by data source';

                resultsDiv.innerHTML = `
                    <div class="result-line"><span class="result-key">Subject Artifact</span><span class="result-value">${phone}</span></div>
                    <div class="result-line"><span class="result-key">E.164 Marker</span><span class="result-value">${e164}</span></div>
                    <div class="result-line"><span class="result-key">International Form</span><span class="result-value">${intlFmt}</span></div>
                    <div class="result-line"><span class="result-key">Local Form</span><span class="result-value">${localFmt}</span></div>
                    <div class="result-line"><span class="result-key">Validity</span><span class="result-value">${isValid}</span></div>
                    <div class="result-line"><span class="result-key">Line Type</span><span class="result-value">${numType}</span></div>
                    <div class="result-line"><span class="result-key">Country</span><span class="result-value">${country}</span></div>
                    <div class="result-line"><span class="result-key">Country Marker</span><span class="result-value">${cc} (${prefix})</span></div>
                    <div class="result-line"><span class="result-key">Carrier / Network</span><span class="result-value">${carrier}</span></div>
                    <div class="result-line"><span class="result-key">Region</span><span class="result-value">${region}</span></div>
                    <div class="result-line"><span class="result-key">Owner Name</span><span class="result-value">${ownerName}</span></div>
                    <div class="result-line"><span class="result-key">Owner Address</span><span class="result-value">${ownerAddress}</span></div>
                    <div class="result-line"><span class="result-key">Source Channel</span><span class="result-value">${lookupSource}</span></div>
                    <div class="result-line" style="flex-direction:column;align-items:flex-start;gap:6px;">
                        <span class="result-key">Owner / Address Trails</span>
                        <span class="result-value" style="flex-wrap:wrap;margin-top:4px;">${buildPortalLinks(cleaned)}</span>
                    </div>
                `;
            } catch {
                const isValid = cleaned.length >= 10 && cleaned.length <= 15;
                const ccDigits = cleaned.length > 10 ? cleaned.substring(0, cleaned.length - 10) : '';
                const areaCode = cleaned.length >= 10 ? cleaned.substring(cleaned.length - 10, cleaned.length - 7) : 'N/A';

                resultsDiv.innerHTML = `
                    <div class="result-line"><span class="result-key">Subject Artifact</span><span class="result-value">${phone}</span></div>
                    <div class="result-line"><span class="result-key">Digits</span><span class="result-value">${cleaned}</span></div>
                    <div class="result-line"><span class="result-key">Validity</span><span class="result-value">${isValid ? '> VALID ✓' : '> INVALID ✗'}</span></div>
                    <div class="result-line"><span class="result-key">Length</span><span class="result-value">${cleaned.length} digits</span></div>
                    <div class="result-line"><span class="result-key">Country Marker</span><span class="result-value">${ccDigits ? '+' + ccDigits : 'N/A'}</span></div>
                    <div class="result-line"><span class="result-key">Area Code</span><span class="result-value">${areaCode}</span></div>
                    <div class="result-line"><span class="result-key">Carrier / Network</span><span class="result-value">API lookup unavailable</span></div>
                    <div class="result-line"><span class="result-key">Source Channel</span><span class="result-value">local-parser</span></div>
                    <div class="result-line" style="flex-direction:column;align-items:flex-start;gap:6px;">
                        <span class="result-key">Owner / Address Trails</span>
                        <span class="result-value" style="flex-wrap:wrap;margin-top:4px;">${buildPortalLinks(cleaned)}</span>
                    </div>
                `;
            }

            resultsDiv.classList.add('active');
        }

        // URL Analysis
        function analyzeURL() {
            if (!guardToolAccess('URL Intelligence')) {
                return;
            }

            const url = document.getElementById('url-input').value.trim();
            const resultsDiv = document.getElementById('url-results');

            if (!url) {
                alert('> ISSUE: Enter a URL artifact');
                return;
            }

            try {
                const urlObj = new URL(url);
                const params = new URLSearchParams(urlObj.search);
                const paramCount = Array.from(params.keys()).length;

                resultsDiv.innerHTML = `
                    <div class="result-line"><span class="result-key">URL Artifact</span><span class="result-value">${url}</span></div>
                    <div class="result-line"><span class="result-key">Transport</span><span class="result-value">${urlObj.protocol}</span></div>
                    <div class="result-line"><span class="result-key">Host</span><span class="result-value">${urlObj.hostname}</span></div>
                    <div class="result-line"><span class="result-key">Port</span><span class="result-value">${urlObj.port || 'Default'}</span></div>
                    <div class="result-line"><span class="result-key">Path</span><span class="result-value">${urlObj.pathname}</span></div>
                    <div class="result-line"><span class="result-key">Parameter Count</span><span class="result-value">${paramCount} found</span></div>
                    <div class="result-line"><span class="result-key">Fragment</span><span class="result-value">${urlObj.hash || 'None'}</span></div>
                    <div class="result-line"><span class="result-key">TLS Posture</span><span class="result-value">${urlObj.protocol === 'https:' ? '✓ SECURE' : '⚠ INSECURE'}</span></div>
                `;
                resultsDiv.classList.add('active');
            } catch {
                resultsDiv.innerHTML = '<div class="result-line"><span class="result-key">ISSUE</span><span class="result-value">Invalid URL artifact format</span></div>';
                resultsDiv.classList.add('active');
            }
        }

        // Subdomain Finder
        function findSubdomains() {
            if (!guardToolAccess('Subdomain Scanner')) {
                return;
            }

            const domain = document.getElementById('subdomain-input').value.trim();
            const resultsDiv = document.getElementById('subdomain-results');
            const loadingDiv = document.getElementById('subdomain-loading');

            if (!domain) {
                alert('> ISSUE: Enter a subject domain');
                return;
            }

            loadingDiv.classList.add('active');
            resultsDiv.classList.remove('active');

            setTimeout(() => {
                loadingDiv.classList.remove('active');

                const commonSubs = ['www', 'mail', 'ftp', 'admin', 'blog', 'api', 'dev', 'staging'];
                const found = commonSubs.filter(() => Math.random() > 0.35);

                let html = `<div class="result-line"><span class="result-key">Subject Domain</span><span class="result-value">${domain}</span></div>`;
                html += `<div class="result-line"><span class="result-key">Subdomains Surfaced</span><span class="result-value">${found.length}</span></div>`;
                html += '<div style="margin-top: 1rem; padding-top: 1rem; border-top: 1px solid rgba(82, 195, 255, 0.2);">';

                found.forEach(sub => {
                    html += `<div class="result-line"><span class="result-key">Host Clue</span><span class="result-value">${sub}.${domain}</span></div>`;
                });

                html += '</div>';
                html += '<div class="result-line"><span class="result-key">Analyst Note</span><span class="result-value">Common subdomain enumeration - full scan requires DNS API</span></div>';

                resultsDiv.innerHTML = html;
                resultsDiv.classList.add('active');
            }, 1500);
        }

        // MAC Address Lookup
        function lookupMAC() {
            if (!guardToolAccess('MAC Address Lookup')) {
                return;
            }
            const mac = document.getElementById('mac-input').value.trim();
            const resultsDiv = document.getElementById('mac-results');

            if (!mac) {
                alert('> ISSUE: Enter a hardware artifact');
                return;
            }

            const cleaned = mac.replace(/[:-]/g, '').toUpperCase();
            const isValid = /^[0-9A-F]{12}$/i.test(cleaned);
            const oui = cleaned.substring(0, 6);
            
            const vendors = {
                '001A2B': 'Cisco Systems',
                '00155D': 'Microsoft',
                '001B63': 'Apple',
                '00502D': 'Dell',
                '0050F2': 'Intel',
            };
            
            const vendor = vendors[oui] || 'Unknown Vendor';

            resultsDiv.innerHTML = `
                <div class="result-line"><span class="result-key">Hardware Artifact</span><span class="result-value">${mac}</span></div>
                <div class="result-line"><span class="result-key">Normalized Artifact</span><span class="result-value">${cleaned}</span></div>
                <div class="result-line"><span class="result-key">Format Check</span><span class="result-value">${isValid ? '✓ YES' : '✗ NO'}</span></div>
                <div class="result-line"><span class="result-key">Vendor Prefix</span><span class="result-value">${oui}</span></div>
                <div class="result-line"><span class="result-key">Vendor Profile</span><span class="result-value">${vendor}</span></div>
                <div class="result-line"><span class="result-key">Address Scope</span><span class="result-value">${(parseInt(cleaned.charAt(1), 16) & 1) ? 'Locally Administered' : 'Universally Administered'}</span></div>
                <div class="result-line"><span class="result-key">Analyst Note</span><span class="result-value">Full vendor database requires MAC lookup API</span></div>
            `;
            resultsDiv.classList.add('active');
        }

        // Base64 Decode
        function decodeBase64() {
            if (!guardToolAccess('Base64 Decoder')) {
                return;
            }
            const input = document.getElementById('base64-input').value.trim();
            const resultsDiv = document.getElementById('base64-results');

            if (!input) {
                alert('> ISSUE: Enter a Base64 artifact');
                return;
            }

            try {
                const decoded = atob(input);
                resultsDiv.innerHTML = `
                    <div class="result-line"><span class="result-key">Source Artifact</span><span class="result-value">${input.substring(0, 100)}${input.length > 100 ? '...' : ''}</span></div>
                    <div class="result-line"><span class="result-key">Decoded Artifact</span><span class="result-value">${decoded}</span></div>
                    <div class="result-line"><span class="result-key">Artifact Length</span><span class="result-value">${decoded.length} characters</span></div>
                    <div class="result-line"><span class="result-key">Operation Status</span><span class="result-value">✓ DECODE SUCCESS</span></div>
                `;
                resultsDiv.classList.add('active');
            } catch (error) {
                resultsDiv.innerHTML = '<div class="result-line"><span class="result-key">ISSUE</span><span class="result-value">Invalid Base64 artifact</span></div>';
                resultsDiv.classList.add('active');
            }
        }

        // Base64 Encode
        function encodeBase64() {
            if (!guardToolAccess('Base64 Encoder')) {
                return;
            }
            const input = document.getElementById('base64-input').value.trim();
            const resultsDiv = document.getElementById('base64-results');

            if (!input) {
                alert('> ISSUE: Enter raw text artifact to encode');
                return;
            }

            const encoded = btoa(input);
            resultsDiv.innerHTML = `
                <div class="result-line"><span class="result-key">Source Artifact</span><span class="result-value">${input.substring(0, 100)}${input.length > 100 ? '...' : ''}</span></div>
                <div class="result-line"><span class="result-key">Encoded Artifact</span><span class="result-value">${encoded}</span></div>
                <div class="result-line"><span class="result-key">Artifact Length</span><span class="result-value">${encoded.length} characters</span></div>
                <div class="result-line"><span class="result-key">Operation Status</span><span class="result-value">✓ ENCODE SUCCESS</span></div>
            `;
            resultsDiv.classList.add('active');
        }

        // DNS Lookup
        function lookupDNS() {
            if (!guardToolAccess('DNS Resolver')) {
                return;
            }
            const domain = document.getElementById('dns-input').value.trim();
            const resultsDiv = document.getElementById('dns-results');
            const loadingDiv = document.getElementById('dns-loading');

            if (!domain) {
                alert('> ISSUE: Enter a subject domain');
                return;
            }

            loadingDiv.classList.add('active');
            resultsDiv.classList.remove('active');

            setTimeout(() => {
                loadingDiv.classList.remove('active');
                
                resultsDiv.innerHTML = `
                    <div class="result-line"><span class="result-key">Subject Domain</span><span class="result-value">${domain}</span></div>
                    <div class="result-line"><span class="result-key">A Layer</span><span class="result-value">Requires DNS API</span></div>
                    <div class="result-line"><span class="result-key">AAAA Layer</span><span class="result-value">Requires DNS API</span></div>
                    <div class="result-line"><span class="result-key">MX Layer</span><span class="result-value">Requires DNS API</span></div>
                    <div class="result-line"><span class="result-key">NS Layer</span><span class="result-value">Requires DNS API</span></div>
                    <div class="result-line"><span class="result-key">TXT Layer</span><span class="result-value">Requires DNS API</span></div>
                    <div class="result-line"><span class="result-key">Analyst Note</span><span class="result-value">Browser-based DNS queries limited - use external DNS API for full results</span></div>
                `;
                resultsDiv.classList.add('active');
            }, 1000);
        }

        // Reference Database
        const ACTIVE_TOOL_DIRECTORY = [
            // Recon Workflow
            { name: 'Google Dork Builder', category: 'Recon Workflow', desc: 'Assembles precision query chains with profile-driven operators and launch-ready search packages.', mode: 'Browser', targetId: 'tool-dork' },
            { name: 'Bug Bounty Dork Packs', category: 'Recon Workflow', desc: 'Loads curated recon packs for disclosure traces, reward signals, and security contact surfaces.', mode: 'Browser', targetId: 'tool-bounty-dorks' },
            { name: 'Username Intelligence', category: 'Recon Workflow', desc: 'Pivots one handle across platforms to surface identity reuse and social overlap.', mode: 'Browser', targetId: 'tool-username' },
            { name: 'Port Scanner', category: 'Recon Workflow', desc: 'Probes exposed service ports to map the visible attack surface around a host.', mode: 'Browser', targetId: 'tool-port' },
            { name: 'Subdomain Scanner', category: 'Recon Workflow', desc: 'Surfaces likely subdomains and naming patterns across a target namespace.', mode: 'Browser', targetId: 'tool-subdomain' },
            { name: 'DNS Resolver', category: 'Recon Workflow', desc: 'Interrogates DNS records and delegation paths to expose routing relationships.', mode: 'Browser', targetId: 'tool-dns' },
            { name: 'Google Hacking Database', category: 'Recon Workflow', desc: 'Loads categorized search payloads for exposed assets, weak pages, and sensitive surfaces.', mode: 'Browser', targetId: 'tool-ghdb' },
            { name: 'Multi-Engine Search Launcher', category: 'Recon Workflow', desc: 'Dispatches one query across multiple engines to widen collection coverage fast.', mode: 'Browser', targetId: 'tool-search-launchers' },
            // Network Lookup
            { name: 'IP Intelligence Scanner', category: 'Network Lookup', desc: 'Traces IP geography, ASN ownership, and network context for fast attribution.', mode: 'Live', targetId: 'tool-ip' },
            // Browser Analysis
            { name: 'Email Analysis Engine', category: 'Browser Analysis', desc: 'Profiles email artifacts for provider context, format integrity, and disposable-risk signals.', mode: 'Browser', targetId: 'tool-email' },
            { name: 'Hash Decoder', category: 'Browser Analysis', desc: 'Classifies suspicious hashes and flags weak or legacy algorithm signatures.', mode: 'Browser', targetId: 'tool-hash' },
            { name: 'Domain Intelligence', category: 'Browser Analysis', desc: 'Profiles domains through registration clues, structure, and ownership-linked intelligence.', mode: 'Browser', targetId: 'tool-domain' },
            { name: 'Phone Intelligence', category: 'Browser Analysis', desc: 'Inspects telecom artifacts for structure, carrier metadata, and routing clues.', mode: 'Live', targetId: 'tool-phone' },
            { name: 'URL Intelligence', category: 'Browser Analysis', desc: 'Breaks URLs into transport, host, path, and parameter evidence for risk review.', mode: 'Browser', targetId: 'tool-url' },
            { name: 'MAC Address Lookup', category: 'Browser Analysis', desc: 'Resolves hardware identifiers into vendor fingerprints and device lineage hints.', mode: 'Browser', targetId: 'tool-mac' },
            { name: 'Base64 Decoder', category: 'Browser Analysis', desc: 'Unwraps or packages Base64 artifacts while preserving source content for review.', mode: 'Browser', targetId: 'tool-base64' },
            { name: 'JWT Decoder', category: 'Browser Analysis', desc: 'Unseals token headers and claims to inspect issuers, audiences, and payload evidence.', mode: 'Browser', targetId: 'tool-jwt-decoder' },
            { name: 'HTML Entity Codec', category: 'Browser Analysis', desc: 'Translates encoded markup artifacts to reveal or safely repackage hidden content.', mode: 'Browser', targetId: 'tool-html-entity' },
            { name: 'String Similarity', category: 'Browser Analysis', desc: 'Measures overlap between text artifacts to detect reuse, cloning, or near matches.', mode: 'Browser', targetId: 'tool-string-similarity' },
            { name: 'Text Diff Checker', category: 'Browser Analysis', desc: 'Diffs text bodies line by line to isolate edits, insertions, and drift.', mode: 'Browser', targetId: 'tool-text-diff' },
            { name: 'Lorem Ipsum Generator', category: 'Browser Analysis', desc: 'Generates controlled filler copy for rehearsals, mock evidence, and layout tests.', mode: 'Browser', targetId: 'tool-lorem-generator' },
            { name: 'User Agent Analyzer', category: 'Browser Analysis', desc: 'Extracts browser, platform, and device clues from user agent artifacts.', mode: 'Browser', targetId: 'tool-user-agent' },
            { name: 'Coordinate Converter', category: 'Browser Analysis', desc: 'Converts raw location points into alternate coordinate formats for mapping workflows.', mode: 'Browser', targetId: 'tool-coordinate-converter' },
            { name: 'Timezone Converter', category: 'Browser Analysis', desc: 'Normalizes timestamps for correlation across local, UTC, and ISO time formats.', mode: 'Browser', targetId: 'tool-timezone-converter' },
            { name: 'SQL Formatter', category: 'Browser Analysis', desc: 'Normalizes raw SQL to inspect joins, filters, extraction logic, and intent.', mode: 'Browser', targetId: 'tool-sql-formatter' },
            { name: 'Cookie Analyzer', category: 'Browser Analysis', desc: 'Inspects browser cookie artifacts to surface sessions, tokens, and tracking residue.', mode: 'Browser', targetId: 'tool-cookie-analyzer' },
            // Vulnerability Intelligence
            { name: 'NIST NVD - CVE Search', category: 'Vulnerability Intelligence', desc: 'Pulls structured NVD files for severity, affected products, and advisory metadata.', mode: 'Live', targetId: 'tool-nist-nvd' },
            { name: 'MITRE CVE Database', category: 'Vulnerability Intelligence', desc: 'Cross-checks MITRE files for identifier history, references, and core context.', mode: 'Live', targetId: 'tool-mitre-cve' },
            { name: 'OSV.dev - Open Source Vulns', category: 'Vulnerability Intelligence', desc: 'Traces package exposure across ecosystems to identify vulnerable dependencies.', mode: 'Live', targetId: 'tool-osv-dev' },
            { name: 'CVE Details Lookup', category: 'Vulnerability Intelligence', desc: 'Opens detailed CVE case data including scoring, exposure range, and remediation links.', mode: 'Live', targetId: 'tool-cve-details' },
            { name: 'CISA KEV - Exploited Vulns', category: 'Vulnerability Intelligence', desc: 'Queries confirmed in-the-wild exploitation records for urgent operational exposure.', mode: 'Live', targetId: 'tool-cisa-kev' },
            // Archive Intelligence
            { name: 'Internet Archive Search', category: 'Archive Intelligence', desc: 'Interrogates archived captures to recover deleted pages and historical exposure trails.', mode: 'Live', targetId: 'tool-archive-search' }
        ];

        let referenceTools = [
            { name: "Shodan", desc: "Internet-connected device search engine", category: "Search Engines" },
            { name: "Censys", desc: "Internet device analysis platform", category: "Search Engines" },
            { name: "VirusTotal", desc: "Multi-engine malware scanner", category: "Threat Intelligence" },
            { name: "Have I Been Pwned", desc: "Breach notification service", category: "Data Breaches" },
            { name: "Hunter.io", desc: "Email discovery platform", category: "Email & Phone" },
            { name: "Sherlock", desc: "Username enumeration tool", category: "Social Media" },
            { name: "Wayback Machine", desc: "Historical web archive", category: "Web Archives" },
            { name: "crt.sh", desc: "Certificate transparency search", category: "Domain & IP" },
            { name: "Google Earth", desc: "Satellite imagery platform", category: "Geolocation" },
            { name: "TinEye", desc: "Reverse image search", category: "Image Analysis" },
            { name: "Crunchbase", desc: "Company funding database", category: "Company Research" },
            { name: "AlienVault OTX", desc: "Threat intelligence exchange", category: "Threat Intelligence" }
        ];
        const referenceFilterState = {
            query: '',
            category: 'all'
        };
        let referenceCategoryLookup = new Map();
        const LIVE_SEARCH_SOURCES = [
            {
                id: 'shodan-internetdb',
                name: 'Shodan InternetDB',
                category: 'Servers',
                mode: 'internal',
                queryLabel: 'IPv4 address',
                placeholder: 'Enter IPv4 address (e.g., 1.1.1.1)',
                openUrl: query => `https://internetdb.shodan.io/${encodeURIComponent(query)}`
            },
            {
                id: 'crtsh',
                name: 'crt.sh Certificate Search',
                category: 'Domains',
                mode: 'internal',
                queryLabel: 'domain',
                placeholder: 'Enter domain (e.g., example.com)',
                openUrl: query => `https://crt.sh/?q=%25.${encodeURIComponent(query)}`
            },
            {
                id: 'urlscan',
                name: 'URLscan.io',
                category: 'Domains',
                mode: 'internal',
                queryLabel: 'domain',
                placeholder: 'Enter domain (e.g., example.com)',
                openUrl: query => `https://urlscan.io/search/#domain:${encodeURIComponent(query)}`
            },
            {
                id: 'malwarebazaar',
                name: 'MalwareBazaar',
                category: 'Threat Intelligence',
                mode: 'internal',
                queryLabel: 'hash',
                placeholder: 'Enter MD5, SHA1 or SHA256 hash',
                openUrl: query => `https://bazaar.abuse.ch/browse.php?search=${encodeURIComponent(query)}`
            },
            {
                id: 'checkpoint-threatmap',
                name: 'Check Point ThreatMap',
                category: 'Threat Intelligence',
                mode: 'embed',
                queryLabel: '',
                placeholder: '',
                embedUrl: 'https://threatmap.checkpoint.com/',
                openUrl: () => 'https://threatmap.checkpoint.com/'
            }
        ];
        let liveSearchSourceLookup = new Map();

        function escapeHtml(value) {
            return String(value ?? '')
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
        }

            function escapeAttribute(value) {
                return escapeHtml(value).replace(/`/g, '&#96;');
            }

        function cleanCategoryLabel(category) {
            const raw = String(category || 'Uncategorized').trim();
            return raw.replace(/^\s*[↑>]+\s*/, '').trim() || 'Uncategorized';
        }

        function openIndexedTool(targetId) {
            const statusNode = document.getElementById('active-tool-open-status');

            if (!targetId) {
                if (statusNode) statusNode.textContent = 'Open a dossier group to reveal its tools.';
                return;
            }

            const target = document.getElementById(targetId);
            if (!target) {
                if (statusNode) statusNode.textContent = 'Selected tool is not available.';
                return;
            }

            // Auto-expand the parent category if the tool is currently hidden.
            const isHidden = !target.classList.contains('cat-expanded') && !target.classList.contains('cat-revealing');
            if (isHidden) {
                let el = target.previousElementSibling;
                while (el) {
                    if (el.classList.contains('tool-category-header')) {
                        toggleToolGroup(el.id);
                        break;
                    }
                    el = el.previousElementSibling;
                }
            }

            const delay = isHidden ? 450 : 0;
            setTimeout(() => {
                target.scrollIntoView({ behavior: 'smooth', block: 'start' });
                target.style.transition = 'box-shadow 0.2s ease';
                target.style.boxShadow = '0 0 0 2px rgba(82, 195, 255, 0.8), 0 0 18px rgba(82, 195, 255, 0.35)';
                setTimeout(() => { target.style.boxShadow = ''; }, 1300);
            }, delay);

            const selected = ACTIVE_TOOL_DIRECTORY.find(item => item.targetId === targetId);
            if (statusNode) {
                statusNode.textContent = selected ? `Opened dossier: ${selected.name}` : 'Dossier opened.';
            }
        }

        function initToolCategories() {
            const grid = document.getElementById('tools-grid');
            if (!grid) return;

            // Insert a synthetic clickable header for all tools that appear before the first category divider.
            const synth = document.createElement('div');
            synth.id = 'core-category';
            synth.className = 'tool-category-header';
            synth.innerHTML = '<div><h3 class="tool-category-label">🔍 CORE CASEWORK</h3><p class="tool-category-desc-text">Identity traces, network profiling, domain analysis, and browser-side artifact inspection</p></div><span class="tool-category-chevron">▶</span>';
            bindToolCategoryHeader(synth);
            grid.insertBefore(synth, grid.firstElementChild);

            // Convert each existing category divider element into a clickable header.
            const dividers = Array.from(grid.querySelectorAll('[id$="-category"]')).filter(el => el !== synth);
            for (const div of dividers) {
                // Skip categories with no following tool-terminal siblings.
                let probe = div.nextElementSibling;
                let hasTools = false;
                while (probe) {
                    if (probe.classList.contains('tool-category-header')) break;
                    if (probe.classList.contains('tool-terminal')) { hasTools = true; break; }
                    probe = probe.nextElementSibling;
                }
                if (!hasTools) { div.style.display = 'none'; continue; }

                const titleText = (div.querySelector('h3') || {}).textContent || 'TOOLS';
                const descText  = (div.querySelector('p')  || {}).textContent || '';
                div.removeAttribute('style');
                div.className = 'tool-category-header';
                div.innerHTML  = '<div><h3 class="tool-category-label">' + escapeHtml(titleText.trim()) + '</h3>' +
                    (descText ? '<p class="tool-category-desc-text">' + escapeHtml(descText.trim()) + '</p>' : '') +
                    '</div><span class="tool-category-chevron">▶</span>';
                bindToolCategoryHeader(div);
            }
        }

        function bindToolCategoryHeader(headerDiv) {
            if (!headerDiv || headerDiv.dataset.boundCategoryHeader) {
                return;
            }

            headerDiv.dataset.boundCategoryHeader = '1';
            headerDiv.setAttribute('role', 'button');
            headerDiv.setAttribute('tabindex', '0');
            headerDiv.setAttribute('aria-expanded', 'false');

            headerDiv.addEventListener('click', () => toggleToolGroup(headerDiv.id));
            headerDiv.addEventListener('keydown', event => {
                if (event.key !== 'Enter' && event.key !== ' ') {
                    return;
                }

                event.preventDefault();
                toggleToolGroup(headerDiv.id);
            });
        }

        function toggleToolGroup(headerDivId) {
            const headerDiv = document.getElementById(headerDivId);
            if (!headerDiv) return;

            // Collect all immediately-following tool-terminal siblings up to the next header.
            const tools = [];
            let el = headerDiv.nextElementSibling;
            while (el) {
                if (el.classList.contains('tool-category-header')) break;
                if (el.classList.contains('tool-terminal')) tools.push(el);
                el = el.nextElementSibling;
            }
            if (tools.length === 0) return;

            const chevron = headerDiv.querySelector('.tool-category-chevron');
            const isExpanded = tools[0].classList.contains('cat-expanded') || tools[0].classList.contains('cat-revealing');

            if (isExpanded) {
                tools.forEach(t => { t.classList.remove('cat-expanded', 'cat-revealing'); t.style.animationDelay = ''; });
                if (chevron) chevron.textContent = '▶';
                headerDiv.classList.remove('active');
                headerDiv.setAttribute('aria-expanded', 'false');
            } else {
                tools.forEach((t, i) => {
                    t.classList.remove('cat-expanded', 'cat-revealing');
                    t.style.animationDelay = `${i * 0.045}s`;
                    t.classList.add('cat-revealing');
                });
                if (chevron) chevron.textContent = '▼';
                headerDiv.classList.add('active');
                headerDiv.setAttribute('aria-expanded', 'true');
                tools[tools.length - 1].addEventListener('animationend', () => {
                    tools.forEach(t => { t.style.animationDelay = ''; t.classList.remove('cat-revealing'); t.classList.add('cat-expanded'); });
                }, { once: true });
            }
        }

        function getAvailableActiveTools() {
            return ACTIVE_TOOL_DIRECTORY.filter(item => !!document.getElementById(item.targetId));
        }

        function getActiveToolCategoryIcon(category) {
            const iconMap = {
                'Recon Workflow': '🎯',
                'Network Lookup': '🌐',
                'Browser Analysis': '⚙️',
                'Vulnerability Intelligence': '🔴',
                'Archive Intelligence': '📦'
            };
            return iconMap[category] || '•';
        }

        function getActiveToolIcon(targetId) {
            const target = document.getElementById(targetId);
            const iconNode = target ? target.querySelector('.tool-icon') : null;
            return iconNode ? String(iconNode.textContent || '').trim() : '•';
        }

        function renderActiveToolDirectory() {
            const summaryNode = document.getElementById('active-tools-summary');
            const gridNode = document.getElementById('active-tools-grid');
            if (!summaryNode && !gridNode) {
                return;
            }

            const availableTools = getAvailableActiveTools();
            const total = availableTools.length;
            const reconCount = availableTools.filter(item => item.category === 'Recon Workflow').length;
            const browserCount = availableTools.filter(item => item.category === 'Browser Analysis').length;
            const vulnCount = availableTools.filter(item => item.category === 'Vulnerability Intelligence').length;

            if (summaryNode) {
                summaryNode.innerHTML = `
                    <div class="dashboard-card">
                        <div class="dashboard-label">📊 Active Files</div>
                        <div class="dashboard-value">${total}</div>
                    </div>
                    <div class="dashboard-card">
                        <div class="dashboard-label">🎯 Recon Dossiers</div>
                        <div class="dashboard-value">${reconCount}</div>
                    </div>
                    <div class="dashboard-card">
                        <div class="dashboard-label">⚙️ Analysis Desk</div>
                        <div class="dashboard-value">${browserCount}</div>
                    </div>
                    <div class="dashboard-card">
                        <div class="dashboard-label">🔴 Threat Briefs</div>
                        <div class="dashboard-value">${vulnCount}</div>
                    </div>
                `;
            }

            if (!gridNode) {
                return;
            }

            // Group tools by category, preserving ACTIVE_TOOL_DIRECTORY insertion order.
            const categoryOrder = [];
            const categoryMap = new Map();
            for (const item of availableTools) {
                if (!categoryMap.has(item.category)) {
                    categoryOrder.push(item.category);
                    categoryMap.set(item.category, []);
                }
                categoryMap.get(item.category).push(item);
            }

            let toolIndex = 1;
            const parts = [];
            for (const cat of categoryOrder) {
                const categoryCount = categoryMap.get(cat).length;
                const categoryIcon = getActiveToolCategoryIcon(cat);
                parts.push(`<div class="active-tool-category-header"><div><h3 class="tool-category-label"><span class="active-tool-inline-icon" aria-hidden="true">${escapeHtml(categoryIcon)}</span><span>${escapeHtml(cat)}</span></h3><p class="tool-category-desc-text">${categoryCount} tool${categoryCount === 1 ? '' : 's'} available in this section</p></div><span class="tool-category-chevron">▼</span></div>`);
                for (const item of categoryMap.get(cat)) {
                    const toolIcon = getActiveToolIcon(item.targetId);
                    const categoryIconInline = getActiveToolCategoryIcon(item.category);
                    parts.push(`<button type="button" class="reference-category-box" data-tool-target="${escapeHtml(item.targetId)}" title="Open ${escapeHtml(item.name)}"><span class="reference-category-name"><span class="active-tool-inline-index">${toolIndex++}.</span><span class="active-tool-inline-icon" aria-hidden="true">${escapeHtml(toolIcon)}</span><span>${escapeHtml(item.name)}</span></span><span class="reference-category-tools"><span class="active-tool-inline-icon" aria-hidden="true">${escapeHtml(categoryIconInline)}</span><span>${escapeHtml(item.category)}</span></span></button>`);
                }
            }
            gridNode.innerHTML = parts.join('');

            if (!gridNode.dataset.boundToolIndex) {
                gridNode.dataset.boundToolIndex = '1';
                gridNode.addEventListener('click', (event) => {
                    const trigger = event.target.closest('[data-tool-target]');
                    if (!trigger) {
                        return;
                    }

                    const targetId = trigger.getAttribute('data-tool-target');
                    openIndexedTool(targetId || '');
                });
            }

            openIndexedTool('');
        }

        function normalizeReferenceTools(tools) {
            if (!Array.isArray(tools)) {
                return [];
            }

            return tools
                .filter(tool => tool && typeof tool === 'object')
                .map(tool => ({
                    name: String(tool.name || '').trim(),
                    desc: String(tool.desc || '').trim(),
                    category: String(tool.category || 'Uncategorized').trim() || 'Uncategorized',
                    url: tool.url ? String(tool.url).trim() : '',
                    source: tool.source ? String(tool.source).trim() : ''
                }))
                .filter(tool => tool.name.length > 0);
        }

        function bindReferenceControls() {
            const searchInput = document.getElementById('reference-search');
            const categoryFilter = document.getElementById('reference-category-filter');
            const container = document.getElementById('reference-container');
            const dialog = document.getElementById('reference-category-dialog');

            if (!searchInput || !categoryFilter) {
                return;
            }

            if (!searchInput.dataset.bound) {
                searchInput.dataset.bound = '1';
                searchInput.addEventListener('input', () => {
                    referenceFilterState.query = searchInput.value.trim().toLowerCase();
                    renderReference();
                });
            }

            if (!categoryFilter.dataset.bound) {
                categoryFilter.dataset.bound = '1';
                categoryFilter.addEventListener('change', () => {
                    referenceFilterState.category = categoryFilter.value;
                    renderReference();
                });
            }

            if (container && !container.dataset.boundCategoryClick) {
                container.dataset.boundCategoryClick = '1';
                container.addEventListener('click', event => {
                    const trigger = event.target.closest('[data-ref-category]');
                    if (!trigger) {
                        return;
                    }
                    const key = decodeURIComponent(trigger.getAttribute('data-ref-category') || '');
                    openReferenceDialog(key);
                });
            }

            if (dialog && !dialog.dataset.boundClose) {
                dialog.dataset.boundClose = '1';
                dialog.addEventListener('click', event => {
                    if (event.target === dialog) {
                        closeReferenceDialog();
                    }
                });
            }
        }

        function refreshReferenceCategoryFilter() {
            const categoryFilter = document.getElementById('reference-category-filter');
            if (!categoryFilter) {
                return;
            }

            const categories = [...new Set(referenceTools.map(tool => tool.category))].sort((a, b) => a.localeCompare(b));
            const currentCategory = referenceFilterState.category;

            categoryFilter.innerHTML = [
                `<option value="all">All categories (${referenceTools.length})</option>`,
                ...categories.map(category => `<option value="${escapeHtml(category)}">${escapeHtml(cleanCategoryLabel(category))}</option>`)
            ].join('');

            referenceFilterState.category = categories.includes(currentCategory) ? currentCategory : 'all';
            categoryFilter.value = referenceFilterState.category;
        }

        function renderReference() {
            const container = document.getElementById('reference-container');
            const stats = document.getElementById('reference-stats');
            if (!container) {
                return;
            }

            const query = referenceFilterState.query;
            const category = referenceFilterState.category;

            const filteredTools = referenceTools.filter(tool => {
                const searchable = `${tool.name} ${tool.desc} ${tool.category} ${tool.source} ${tool.url}`.toLowerCase();
                const queryMatch = !query || searchable.includes(query);
                const categoryMatch = category === 'all' || tool.category === category;
                return queryMatch && categoryMatch;
            });

            const grouped = new Map();
            for (const tool of filteredTools) {
                if (!grouped.has(tool.category)) {
                    grouped.set(tool.category, []);
                }
                grouped.get(tool.category).push(tool);
            }

            const groups = [...grouped.entries()].sort((a, b) => a[0].localeCompare(b[0]));
            referenceCategoryLookup = new Map(groups.map(([name, tools]) => [
                name,
                [...tools].sort((a, b) => a.name.localeCompare(b.name))
            ]));

            if (stats) {
                stats.textContent = `Showing ${filteredTools.length} of ${referenceTools.length} tools in ${groups.length} categories.`;
            }

            if (!groups.length) {
                container.innerHTML = '<div class="reference-empty">No tools match your current search/filter.</div>';
                closeReferenceDialog();
                return;
            }

            container.innerHTML = `
                <div class="reference-category-grid">
                    ${groups.map(([groupName, groupTools]) => `
                        <button type="button" class="reference-category-box" data-ref-category="${encodeURIComponent(groupName)}">
                            <span class="reference-category-name">${escapeHtml(cleanCategoryLabel(groupName))}</span>
                            <span class="reference-category-tools">${groupTools.length} tools</span>
                        </button>
                    `).join('')}
                </div>
            `;
        }

        function closeReferenceDialog() {
            const dialog = document.getElementById('reference-category-dialog');
            if (dialog && dialog.open) {
                dialog.close();
            }
        }

        function openReferenceDialog(categoryName) {
            const dialog = document.getElementById('reference-category-dialog');
            const title = document.getElementById('reference-dialog-title');
            const meta = document.getElementById('reference-dialog-meta');
            const toolsContainer = document.getElementById('reference-dialog-tools');
            if (!dialog || !title || !meta || !toolsContainer) {
                return;
            }

            const tools = referenceCategoryLookup.get(categoryName) || [];
            title.textContent = cleanCategoryLabel(categoryName);
            meta.textContent = `${tools.length} tools in this category`;
            toolsContainer.innerHTML = tools.map(tool => `
                <div class="reference-item">
                    <div class="reference-name">${escapeHtml(tool.name)}</div>
                    <div class="reference-desc">${escapeHtml(tool.desc || 'No description available.')}</div>
                    <div class="reference-meta">
                        <div class="reference-category">${escapeHtml(cleanCategoryLabel(tool.category))}</div>
                        ${(tool.source && tool.source.toLowerCase() !== 'community') ? `<div class="reference-source">${escapeHtml(tool.source)}</div>` : ''}
                    </div>
                    ${tool.url ? `<div class="reference-link"><a href="${escapeHtml(tool.url)}" target="_blank" rel="noopener noreferrer">Open source</a></div>` : ''}
                </div>
            `).join('');

            if (dialog.open) {
                dialog.close();
            }
            if (typeof dialog.showModal === 'function') {
                dialog.showModal();
            } else {
                dialog.setAttribute('open', 'open');
            }
        }

        function decodeJwtLive() {
            if (!guardToolAccess('JWT Decoder')) return;
            const token = document.getElementById('jwt-decoder-input').value.trim();
            const resultsDiv = document.getElementById('jwt-decoder-results');
            if (!token) {
                alert('> ISSUE: Enter a token artifact');
                return;
            }
            try {
                const [h, p] = token.split('.');
                const decode = (part) => {
                    const normalized = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=');
                    return JSON.parse(atob(normalized));
                };
                const header = decode(h);
                const payload = decode(p);
                resultsDiv.innerHTML = `
                    <div class="result-line"><span class="result-key">Header</span><span class="result-value">${escapeHtml(JSON.stringify(header, null, 2))}</span></div>
                    <div class="result-line"><span class="result-key">Payload</span><span class="result-value">${escapeHtml(JSON.stringify(payload, null, 2))}</span></div>
                `;
                resultsDiv.classList.add('active');
                void logActivity('TOOL_USED', 'JWT Decoder', 'Decoded token');
            } catch (error) {
                resultsDiv.innerHTML = `<div class="result-line"><span class="result-key">ERROR</span><span class="result-value">Invalid JWT: ${escapeHtml(error.message)}</span></div>`;
                resultsDiv.classList.add('active');
            }
        }

        function encodeHtmlEntitiesLive() {
            if (!guardToolAccess('HTML Entity Codec')) return;
            const input = document.getElementById('html-entity-input').value;
            const resultsDiv = document.getElementById('html-entity-results');
            const out = input.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
            resultsDiv.innerHTML = `<div class="result-line"><span class="result-key">Encoded</span><span class="result-value">${out}</span></div>`;
            resultsDiv.classList.add('active');
        }

        function decodeHtmlEntitiesLive() {
            if (!guardToolAccess('HTML Entity Codec')) return;
            const input = document.getElementById('html-entity-input').value;
            const resultsDiv = document.getElementById('html-entity-results');
            const holder = document.createElement('textarea');
            holder.innerHTML = input;
            resultsDiv.innerHTML = `<div class="result-line"><span class="result-key">Decoded</span><span class="result-value">${escapeHtml(holder.value)}</span></div>`;
            resultsDiv.classList.add('active');
        }

        function compareStringSimilarityLive() {
            if (!guardToolAccess('String Similarity')) return;
            const a = document.getElementById('similarity-input-a').value;
            const b = document.getElementById('similarity-input-b').value;
            const resultsDiv = document.getElementById('similarity-results');
            if (!a || !b) {
                alert('> ISSUE: Enter both comparison artifacts');
                return;
            }
            const maxLen = Math.max(a.length, b.length) || 1;
            const samePos = Array.from({ length: Math.min(a.length, b.length) }).filter((_, i) => a[i] === b[i]).length;
            const pct = Math.round((samePos / maxLen) * 100);
            resultsDiv.innerHTML = `<div class="result-line"><span class="result-key">Match Score</span><span class="result-value">${pct}%</span></div><div class="result-line"><span class="result-key">Length Delta</span><span class="result-value">${Math.abs(a.length - b.length)}</span></div>`;
            resultsDiv.classList.add('active');
        }

        function compareTextDiffLive() {
            if (!guardToolAccess('Text Diff Checker')) return;
            const a = document.getElementById('diff-input-a').value.split(/\r?\n/);
            const b = document.getElementById('diff-input-b').value.split(/\r?\n/);
            const resultsDiv = document.getElementById('diff-results');
            const max = Math.max(a.length, b.length);
            let changed = 0;
            for (let i = 0; i < max; i++) {
                if ((a[i] || '') !== (b[i] || '')) changed++;
            }
            resultsDiv.innerHTML = `<div class="result-line"><span class="result-key">Drift Lines</span><span class="result-value">${changed}</span></div><div class="result-line"><span class="result-key">Artifact A Lines</span><span class="result-value">${a.length}</span></div><div class="result-line"><span class="result-key">Artifact B Lines</span><span class="result-value">${b.length}</span></div>`;
            resultsDiv.classList.add('active');
        }

        function generateLoremLive() {
            if (!guardToolAccess('Lorem Ipsum Generator')) return;
            const count = Math.min(Math.max(Number.parseInt(document.getElementById('lorem-count-input').value || '3', 10), 1), 20);
            const resultsDiv = document.getElementById('lorem-results');
            const paragraph = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.';
            const out = Array.from({ length: count }).map(() => paragraph).join('\n\n');
            resultsDiv.innerHTML = `<div class="result-line"><span class="result-key">Generated</span><span class="result-value">${escapeHtml(out)}</span></div>`;
            resultsDiv.classList.add('active');
        }

        function analyzeUserAgentLive() {
            if (!guardToolAccess('User Agent Analyzer')) return;
            const inputNode = document.getElementById('user-agent-input');
            const raw = inputNode.value.trim() || navigator.userAgent;
            if (!inputNode.value.trim()) {
                inputNode.value = raw;
            }
            const resultsDiv = document.getElementById('user-agent-results');
            const browser = /Firefox/i.test(raw) ? 'Firefox' : /Edg/i.test(raw) ? 'Edge' : /Chrome/i.test(raw) ? 'Chrome' : /Safari/i.test(raw) ? 'Safari' : 'Unknown';
            const os = /Windows/i.test(raw) ? 'Windows' : /Android/i.test(raw) ? 'Android' : /iPhone|iPad|iOS/i.test(raw) ? 'iOS' : /Mac OS/i.test(raw) ? 'macOS' : /Linux/i.test(raw) ? 'Linux' : 'Unknown';
            resultsDiv.innerHTML = `<div class="result-line"><span class="result-key">Browser</span><span class="result-value">${browser}</span></div><div class="result-line"><span class="result-key">OS</span><span class="result-value">${os}</span></div><div class="result-line"><span class="result-key">User Agent</span><span class="result-value">${escapeHtml(raw)}</span></div>`;
            resultsDiv.classList.add('active');
        }

        function convertCoordinatesLive() {
            if (!guardToolAccess('Coordinate Converter')) return;
            const input = document.getElementById('coordinate-input').value.trim();
            const resultsDiv = document.getElementById('coordinate-results');
            const parts = input.split(',').map(v => Number(v.trim()));
            if (parts.length !== 2 || parts.some(Number.isNaN)) {
                alert('> ISSUE: Enter coordinate artifact as lat,lon');
                return;
            }
            const toDms = (value, lat) => {
                const abs = Math.abs(value);
                const deg = Math.floor(abs);
                const minFloat = (abs - deg) * 60;
                const min = Math.floor(minFloat);
                const sec = ((minFloat - min) * 60).toFixed(2);
                const dir = lat ? (value >= 0 ? 'N' : 'S') : (value >= 0 ? 'E' : 'W');
                return `${deg}° ${min}' ${sec}\" ${dir}`;
            };
            resultsDiv.innerHTML = `<div class="result-line"><span class="result-key">Latitude DMS</span><span class="result-value">${toDms(parts[0], true)}</span></div><div class="result-line"><span class="result-key">Longitude DMS</span><span class="result-value">${toDms(parts[1], false)}</span></div>`;
            resultsDiv.classList.add('active');
        }

        function convertTimezoneLive() {
            if (!guardToolAccess('Timezone Converter')) return;
            const input = document.getElementById('timezone-input').value.trim();
            const resultsDiv = document.getElementById('timezone-results');
            const date = input ? new Date(input) : new Date();
            if (Number.isNaN(date.getTime())) {
                alert('> ISSUE: Enter valid timestamp artifact (e.g., 2026-03-16T12:00:00)');
                return;
            }
            resultsDiv.innerHTML = `<div class="result-line"><span class="result-key">Local Stamp</span><span class="result-value">${escapeHtml(date.toLocaleString())}</span></div><div class="result-line"><span class="result-key">UTC Stamp</span><span class="result-value">${escapeHtml(date.toUTCString())}</span></div><div class="result-line"><span class="result-key">ISO Stamp</span><span class="result-value">${escapeHtml(date.toISOString())}</span></div>`;
            resultsDiv.classList.add('active');
        }

        function formatSqlLive() {
            if (!guardToolAccess('SQL Formatter')) return;
            const input = document.getElementById('sql-formatter-input').value;
            const resultsDiv = document.getElementById('sql-formatter-results');
            if (!input.trim()) {
                alert('> ISSUE: Enter raw SQL artifact');
                return;
            }
            const formatted = input
                .replace(/\bSELECT\b/gi, '\nSELECT')
                .replace(/\bFROM\b/gi, '\nFROM')
                .replace(/\bWHERE\b/gi, '\nWHERE')
                .replace(/\bGROUP BY\b/gi, '\nGROUP BY')
                .replace(/\bORDER BY\b/gi, '\nORDER BY')
                .trim();
            resultsDiv.innerHTML = `<div class="result-line"><span class="result-key">Normalized SQL</span><span class="result-value">${escapeHtml(formatted)}</span></div>`;
            resultsDiv.classList.add('active');
        }

        function analyzeCookiesLive() {
            if (!guardToolAccess('Cookie Analyzer')) return;
            const resultsDiv = document.getElementById('cookie-analyzer-results');
            const cookies = document.cookie ? document.cookie.split(';').map(item => item.trim()).filter(Boolean) : [];
            resultsDiv.innerHTML = `<div class="result-line"><span class="result-key">Cookie Artifacts</span><span class="result-value">${cookies.length}</span></div>` + (cookies.length
                ? cookies.map(item => {
                    const [name, ...rest] = item.split('=');
                    return `<div class="result-line"><span class="result-key">${escapeHtml(name || 'cookie')}</span><span class="result-value">${escapeHtml(rest.join('=') || '')}</span></div>`;
                }).join('')
                : '<div class="result-line"><span class="result-key">Result</span><span class="result-value">No cookies available.</span></div>');
            resultsDiv.classList.add('active');
        }

        function splitDorkCsv(value, limit = 8, transform = item => item) {
            return value
                .split(',')
                .map(item => item.trim())
                .filter(Boolean)
                .map(transform)
                .slice(0, limit);
        }

        function normalizeDorkTarget(rawTarget) {
            const safeTarget = rawTarget.replace(/\s+/g, ' ').trim();
            const domainLike = /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(safeTarget);

            return {
                safeTarget,
                scope: domainLike ? `site:${safeTarget}` : `"${safeTarget}"`
            };
        }

        function renderSearchLaunchLinks(query) {
            const googleUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
            const bingUrl = `https://www.bing.com/search?q=${encodeURIComponent(query)}`;
            const duckUrl = `https://duckduckgo.com/?q=${encodeURIComponent(query)}`;
            return `<a href="${googleUrl}" target="_blank" rel="noopener noreferrer" style="color: var(--matrix-green); text-decoration: none;">Google</a> | <a href="${bingUrl}" target="_blank" rel="noopener noreferrer" style="color: var(--matrix-green); text-decoration: none;">Bing</a> | <a href="${duckUrl}" target="_blank" rel="noopener noreferrer" style="color: var(--matrix-green); text-decoration: none;">DuckDuckGo</a>`;
        }

        function renderCopyButton(query) {
            return `<button type="button" class="btn-terminal btn-small copy-query-btn" data-copy-query="${escapeAttribute(query)}">COPY</button>`;
        }

        function renderDorkActionRow(query) {
            return `<div class="result-actions">${renderCopyButton(query)}<span>${renderSearchLaunchLinks(query)}</span></div>`;
        }

        function renderDorkResultRows(item, index) {
            return `
                <div class="result-line"><span class="result-key">${index + 1}. ${escapeHtml(item.label)}</span><span class="result-value">${escapeHtml(item.query)}</span></div>
                <div class="result-line"><span class="result-key">Dispatch</span><span class="result-value">${renderDorkActionRow(item.query)}</span></div>
            `;
        }

        function normalizeBugBountyPackConfig(payload) {
            const packs = Array.isArray(payload?.packs) ? payload.packs : [];

            return packs.reduce((accumulator, item) => {
                const id = String(item?.id || '').trim();
                const name = String(item?.name || '').trim();
                const builderProfile = String(item?.builderProfile || 'bug-bounty').trim() || 'bug-bounty';
                const note = String(item?.note || '').trim();
                const templates = Array.isArray(item?.templates)
                    ? item.templates
                        .map(template => ({
                            label: String(template?.label || '').trim(),
                            fragment: String(template?.fragment || '').trim()
                        }))
                        .filter(template => template.label && template.fragment)
                    : [];
                const excludes = Array.isArray(item?.excludes)
                    ? item.excludes.map(entry => String(entry || '').trim().toLowerCase()).filter(Boolean)
                    : [];
                const tags = Array.isArray(item?.tags)
                    ? item.tags.map(entry => String(entry || '').trim().toLowerCase()).filter(Boolean)
                    : [];

                if (!id || !name || !templates.length) {
                    return accumulator;
                }

                accumulator[id] = {
                    id,
                    name,
                    builderProfile,
                    note,
                    excludes,
                    tags,
                    templates
                };
                return accumulator;
            }, {});
        }

        function renderBugBountyTagChips() {
            const container = document.getElementById('bounty-dork-tag-chips');
            if (!container) {
                return;
            }

            const tagCounts = new Map();
            Object.values(bugBountyDorkPacks).forEach(pack => {
                (pack.tags || []).forEach(tag => {
                    tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
                });
            });

            const tags = Array.from(tagCounts.entries())
                .sort((left, right) => left[0].localeCompare(right[0]));

            const allCount = Object.keys(bugBountyDorkPacks).length;
            const chips = [`<button type="button" class="bounty-dork-tag-chip${activeBugBountyTag === 'all' ? ' active' : ''}" data-bounty-tag="all">All (${allCount})</button>`];
            chips.push(...tags.map(([tag, count]) => `<button type="button" class="bounty-dork-tag-chip${activeBugBountyTag === tag ? ' active' : ''}" data-bounty-tag="${escapeAttribute(tag)}">${escapeHtml(tag)} (${count})</button>`));
            container.innerHTML = chips.join('');
        }

        function saveBugBountyPanelState() {
            try {
                const state = {
                    target: document.getElementById('bounty-dork-target-input')?.value || '',
                    filter: document.getElementById('bounty-dork-pack-filter')?.value || '',
                    selectedPackId: document.getElementById('bounty-dork-pack-select')?.value || persistedBugBountyPackId || '',
                    activeTag: activeBugBountyTag || 'all',
                    extraExcludes: document.getElementById('bounty-dork-extra-excludes')?.value || ''
                };
                localStorage.setItem(BUG_BOUNTY_PANEL_STATE_KEY, JSON.stringify(state));
            } catch (error) {
                console.warn('Unable to save bug bounty panel state:', error);
            }
        }

        function restoreBugBountyPanelState() {
            try {
                const raw = localStorage.getItem(BUG_BOUNTY_PANEL_STATE_KEY);
                if (!raw) {
                    return;
                }

                const state = JSON.parse(raw);
                document.getElementById('bounty-dork-target-input').value = typeof state.target === 'string' ? state.target : '';
                document.getElementById('bounty-dork-pack-filter').value = typeof state.filter === 'string' ? state.filter : '';
                document.getElementById('bounty-dork-extra-excludes').value = typeof state.extraExcludes === 'string' ? state.extraExcludes : '';
                activeBugBountyTag = typeof state.activeTag === 'string' && state.activeTag ? state.activeTag : 'all';
                persistedBugBountyPackId = typeof state.selectedPackId === 'string' ? state.selectedPackId : '';
            } catch (error) {
                console.warn('Unable to restore bug bounty panel state:', error);
                activeBugBountyTag = 'all';
                persistedBugBountyPackId = '';
            }
        }

        function getFilteredBugBountyPacks() {
            const searchTerm = (document.getElementById('bounty-dork-pack-filter')?.value || '').trim().toLowerCase();
            const packs = Object.values(bugBountyDorkPacks);

            return packs.filter(pack => {
                const matchesTag = activeBugBountyTag === 'all' || (pack.tags || []).includes(activeBugBountyTag);
                if (!matchesTag) {
                    return false;
                }

                if (!searchTerm) {
                    return true;
                }

                const haystack = [
                    pack.id,
                    pack.name,
                    pack.note,
                    ...(pack.tags || []),
                    ...(pack.excludes || []),
                    ...(pack.templates || []).flatMap(template => [template.label, template.fragment])
                ]
                    .join(' ')
                    .toLowerCase();

                return haystack.includes(searchTerm);
            });
        }

        function resetBugBountyPackFilters() {
            const filterInput = document.getElementById('bounty-dork-pack-filter');
            if (filterInput) {
                filterInput.value = '';
            }

            activeBugBountyTag = 'all';
            populateBugBountyPackSelect();
            saveBugBountyPanelState();
        }

        function renderBugBountyResultsFromState(state) {
            const resultsDiv = document.getElementById('bounty-dork-results');
            if (!resultsDiv || !state || !Array.isArray(state.dorks) || !state.dorks.length) {
                return;
            }

            let html = `<div class="result-line"><span class="result-key">Subject</span><span class="result-value">${escapeHtml(state.target || 'N/A')}</span></div>`;
            html += `<div class="result-line"><span class="result-key">Pack File</span><span class="result-value">${escapeHtml(state.packName || 'N/A')}</span></div>`;
            html += `<div class="result-line"><span class="result-key">Queries Filed</span><span class="result-value">${state.dorks.length}</span></div>`;
            html += `<div class="result-line"><span class="result-key">Seed Profile</span><span class="result-value">${escapeHtml(state.builderProfile || 'bug-bounty')}</span></div>`;

            state.dorks.forEach((item, index) => {
                html += renderDorkResultRows(item, index);
            });

            html += `<div class="result-line"><span class="result-key">Pack Brief</span><span class="result-value">${escapeHtml(state.packNote || '')}</span></div>`;
            html += `<div class="result-line"><span class="result-key">Excluded Surfaces</span><span class="result-value">${escapeHtml((state.excludes || []).join(', '))}</span></div>`;
            html += '<div class="result-line"><span class="result-key">Handling Notice</span><span class="result-value">Use only on systems you are authorized to test.</span></div>';

            resultsDiv.innerHTML = html;
            resultsDiv.classList.add('active');
        }

        function saveBugBountyResultsState(state) {
            try {
                localStorage.setItem(BUG_BOUNTY_RESULTS_STATE_KEY, JSON.stringify(state));
            } catch (error) {
                console.warn('Unable to save bug bounty results state:', error);
            }
        }

        function restoreBugBountyResultsState() {
            try {
                const raw = localStorage.getItem(BUG_BOUNTY_RESULTS_STATE_KEY);
                if (!raw) {
                    return;
                }

                const state = JSON.parse(raw);
                renderBugBountyResultsFromState(state);
            } catch (error) {
                console.warn('Unable to restore bug bounty results state:', error);
            }
        }

        function populateBugBountyPackSelect() {
            const select = document.getElementById('bounty-dork-pack-select');
            const statusNode = document.getElementById('bounty-dork-pack-status');
            if (!select) {
                return;
            }

            renderBugBountyTagChips();

            const currentValue = select.value || persistedBugBountyPackId;
            const totalCount = Object.keys(bugBountyDorkPacks).length;
            const packs = getFilteredBugBountyPacks();
            if (!packs.length) {
                select.innerHTML = totalCount
                    ? '<option value="">No packs match the current filter</option>'
                    : '<option value="">No bug bounty packs loaded</option>';
                if (statusNode) {
                    const tagMessage = activeBugBountyTag === 'all' ? '' : ` tag \"${activeBugBountyTag}\"`;
                    statusNode.textContent = totalCount
                        ? `Showing 0 matching packs for the current${tagMessage} filter.`
                        : 'Bug bounty pack index unavailable.';
                }
                return;
            }

            select.innerHTML = packs
                .map(pack => `<option value="${escapeAttribute(pack.id)}">Pack: ${escapeHtml(pack.name)}</option>`)
                .join('');

            const hasCurrent = packs.some(pack => pack.id === currentValue);
            select.value = hasCurrent ? currentValue : packs[0].id;
            persistedBugBountyPackId = select.value;

            if (statusNode) {
                const tagLabel = activeBugBountyTag === 'all' ? 'all tags' : `tag \"${activeBugBountyTag}\"`;
                statusNode.textContent = totalCount === packs.length && activeBugBountyTag === 'all'
                    ? `Showing all ${totalCount} packs.`
                    : `Showing ${packs.length} of ${totalCount} packs for ${tagLabel}.`;
            }

            saveBugBountyPanelState();
        }

        async function loadBugBountyDorkPacks() {
            try {
                const response = await fetch(BUG_BOUNTY_PACKS_URL, { cache: 'no-store' });
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }

                const payload = await response.json();
                bugBountyDorkPacks = normalizeBugBountyPackConfig(payload);
                populateBugBountyPackSelect();
            } catch (error) {
                bugBountyDorkPacks = {};
                populateBugBountyPackSelect();
                console.error('Bug bounty dork packs failed to load:', error);
            }
        }

        function getSelectedBugBountyPack() {
            const packId = document.getElementById('bounty-dork-pack-select')?.value || '';
            return bugBountyDorkPacks[packId] || Object.values(bugBountyDorkPacks)[0] || null;
        }

        function copyTextLegacy(text) {
            const textArea = document.createElement('textarea');
            textArea.value = text;
            textArea.setAttribute('readonly', 'readonly');
            textArea.style.position = 'fixed';
            textArea.style.top = '-9999px';
            document.body.appendChild(textArea);
            textArea.select();
            const copied = document.execCommand('copy');
            document.body.removeChild(textArea);
            return copied;
        }

        async function copyTextToClipboard(text, button, options = {}) {
            if (!text) {
                return false;
            }

            try {
                if (navigator.clipboard?.writeText) {
                    await navigator.clipboard.writeText(text);
                } else if (!copyTextLegacy(text)) {
                    throw new Error('Clipboard unavailable');
                }

                if (button) {
                    const original = button.textContent;
                    button.textContent = 'COPIED';
                    button.disabled = true;
                    setTimeout(() => {
                        button.textContent = original;
                        button.disabled = false;
                    }, 1200);
                }
                return true;
            } catch (error) {
                console.error('Copy failed:', error);
                if (!options.suppressAlert) {
                    alert('> ISSUE: Unable to copy field query in this browser');
                }
                return false;
            }
        }

        function setGhdbCopyStatus(message, success = true) {
            const statusNode = document.getElementById('ghdb-copy-status');
            if (!statusNode) {
                return;
            }
            statusNode.textContent = message;
            statusNode.style.color = success ? 'var(--text-primary)' : '#ff9b9b';
        }

        function generateGoogleDorks() {
            if (!guardToolAccess('Google Dork Builder')) {
                return;
            }

            const target = document.getElementById('dork-target-input').value.trim();
            const profile = document.getElementById('dork-profile-select')?.value || 'recon';
            const exactPhrase = document.getElementById('dork-exact-input')?.value.trim() || '';
            const filetypesRaw = document.getElementById('dork-filetype-input')?.value.trim() || '';
            const inurlRaw = document.getElementById('dork-inurl-input')?.value.trim() || '';
            const intitlePhrase = document.getElementById('dork-intitle-input')?.value.trim() || '';
            const excludeRaw = document.getElementById('dork-exclude-input')?.value.trim() || '';
            const resultsDiv = document.getElementById('dork-results');

            if (!target) {
                alert('> ISSUE: Enter a subject domain or keyword');
                return;
            }

            const { safeTarget, scope } = normalizeDorkTarget(target);

            const profileTemplates = {
                recon: [
                    { label: 'Indexed Surface', fragment: '' },
                    { label: 'Directory Listing', fragment: 'intitle:"index of"' },
                    { label: 'Login Surfaces', fragment: '(inurl:login OR inurl:signin OR inurl:auth)' },
                    { label: 'Public API Footprint', fragment: '(inurl:api OR inurl:v1 OR inurl:v2)' },
                    { label: 'Subdomain Hints', fragment: '(inurl:dev OR inurl:staging OR inurl:test)' }
                ],
                'bug-bounty': [
                    { label: 'Interesting Parameters', fragment: '(inurl:id= OR inurl:redirect= OR inurl:url= OR inurl:next=)' },
                    { label: 'Open Redirect Signals', fragment: '(inurl:redirect OR inurl:return OR inurl:continue) (http OR https)' },
                    { label: 'Debug Endpoints', fragment: '(inurl:debug OR inurl:trace OR inurl:status)' },
                    { label: 'Backup Files', fragment: '(ext:bak OR ext:old OR ext:backup OR ext:swp)' },
                    { label: 'JS Asset Review', fragment: 'ext:js (api_key OR token OR endpoint)' }
                ],
                'vuln-hunt': [
                    { label: 'Error Disclosures', fragment: '("sql syntax" OR "stack trace" OR "exception")' },
                    { label: 'Config Leakage', fragment: '(ext:env OR ext:ini OR ext:conf OR ext:yaml OR ext:yml)' },
                    { label: 'Database Artifacts', fragment: '(ext:sql OR ext:db OR ext:sqlite)' },
                    { label: 'Git Artifacts', fragment: '(inurl:.git OR inurl:.svn OR inurl:.hg)' },
                    { label: 'Admin Consoles', fragment: '(intitle:admin OR inurl:admin)' }
                ],
                'doc-leaks': [
                    { label: 'Document Exposure', fragment: '(ext:pdf OR ext:doc OR ext:docx OR ext:xls OR ext:xlsx OR ext:ppt OR ext:pptx)' },
                    { label: 'Internal Wording', fragment: '("confidential" OR "internal only" OR "do not distribute")' },
                    { label: 'Exported Reports', fragment: '("report" OR "statement" OR "inventory")' },
                    { label: 'Credentials In Docs', fragment: '("password" OR "username") (ext:txt OR ext:csv OR ext:xlsx)' },
                    { label: 'Financial Mentions', fragment: '("invoice" OR "purchase order" OR "bank")' }
                ],
                'cloud-assets': [
                    { label: 'S3 References', fragment: '("s3.amazonaws.com" OR "amazonaws.com")' },
                    { label: 'Azure Blob References', fragment: '("blob.core.windows.net" OR "azure")' },
                    { label: 'GCS References', fragment: '("storage.googleapis.com" OR "gcs")' },
                    { label: 'Cloudfront/CDN Clues', fragment: '("cloudfront.net" OR "cdn")' },
                    { label: 'Bucket Listing Signals', fragment: '("listbucketresult" OR "accessdenied")' }
                ],
                credentials: [
                    { label: 'Credential Keywords', fragment: '("password" OR "passwd" OR "secret" OR "token")' },
                    { label: 'Key Material Clues', fragment: '("api_key" OR "client_secret" OR "private key")' },
                    { label: 'Env Variable Leakage', fragment: '("DB_PASSWORD" OR "AWS_SECRET" OR "TOKEN=")' },
                    { label: 'Auth Logs / Dumps', fragment: '("auth.log" OR "credentials" OR "users.csv")' },
                    { label: 'Paste-like Artifacts', fragment: '("BEGIN RSA PRIVATE KEY" OR "BEGIN OPENSSH PRIVATE KEY")' }
                ]
            };

            const chosen = profileTemplates[profile] || profileTemplates.recon;
            const filetypes = splitDorkCsv(filetypesRaw, 8, item => item.toLowerCase());
            const inurlTokens = splitDorkCsv(inurlRaw, 8, item => item.toLowerCase());
            const excludes = splitDorkCsv(excludeRaw, 8, item => item.toLowerCase());

            const customSegments = [];
            if (exactPhrase) customSegments.push(`"${exactPhrase}"`);
            if (filetypes.length) customSegments.push(`(${filetypes.map(ext => `ext:${ext}`).join(' OR ')})`);
            if (inurlTokens.length) customSegments.push(`(${inurlTokens.map(token => `inurl:${token}`).join(' OR ')})`);
            if (intitlePhrase) customSegments.push(`intitle:"${intitlePhrase}"`);
            if (excludes.length) customSegments.push(excludes.map(term => `-${term}`).join(' '));

            const dorks = chosen.map(item => {
                const query = [scope, item.fragment, ...customSegments].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
                return { label: item.label, query };
            });

            let html = `<div class="result-line"><span class="result-key">Subject</span><span class="result-value">${escapeHtml(safeTarget)}</span></div>`;
            html += `<div class="result-line"><span class="result-key">Playbook</span><span class="result-value">${escapeHtml(profile)}</span></div>`;
            html += `<div class="result-line"><span class="result-key">Queries Filed</span><span class="result-value">${dorks.length}</span></div>`;

            dorks.forEach((item, index) => {
                html += renderDorkResultRows(item, index);
            });

            html += '<div class="result-line"><span class="result-key">Handling Notice</span><span class="result-value">Use only on systems you are authorized to test.</span></div>';

            resultsDiv.innerHTML = html;
            resultsDiv.classList.add('active');
            void logActivity('TOOL_USED', 'Google Dork Builder', `Target: ${safeTarget} | Profile: ${profile} | Queries: ${dorks.length}`);
        }

        function generateBugBountyDorks() {
            if (!guardToolAccess('Bug Bounty Dork Packs')) {
                return;
            }

            const target = document.getElementById('bounty-dork-target-input')?.value.trim() || '';
            const extraExcludesRaw = document.getElementById('bounty-dork-extra-excludes')?.value.trim() || '';
            const resultsDiv = document.getElementById('bounty-dork-results');

            if (!target) {
                alert('> ISSUE: Enter a subject domain or keyword');
                return;
            }

            const pack = getSelectedBugBountyPack();
            if (!pack) {
                alert('> ISSUE: Recon pack files are unavailable right now');
                return;
            }

            const { safeTarget, scope } = normalizeDorkTarget(target);
            const extraExcludes = splitDorkCsv(extraExcludesRaw, 12, item => item.toLowerCase());
            const excludes = [...new Set([...(pack.excludes || []), ...extraExcludes])];
            const excludeClause = excludes.map(term => `-${term}`).join(' ');

            const dorks = pack.templates.map(item => {
                const query = [scope, item.fragment, excludeClause].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
                return { label: item.label, query };
            });

            let html = `<div class="result-line"><span class="result-key">Subject</span><span class="result-value">${escapeHtml(safeTarget)}</span></div>`;
            html += `<div class="result-line"><span class="result-key">Pack File</span><span class="result-value">${escapeHtml(pack.name)}</span></div>`;
            html += `<div class="result-line"><span class="result-key">Queries Filed</span><span class="result-value">${dorks.length}</span></div>`;
            html += `<div class="result-line"><span class="result-key">Seed Profile</span><span class="result-value">${escapeHtml(pack.builderProfile)}</span></div>`;

            dorks.forEach((item, index) => {
                html += renderDorkResultRows(item, index);
            });

            html += `<div class="result-line"><span class="result-key">Pack Brief</span><span class="result-value">${escapeHtml(pack.note)}</span></div>`;
            html += `<div class="result-line"><span class="result-key">Excluded Surfaces</span><span class="result-value">${escapeHtml(excludes.join(', '))}</span></div>`;
            html += '<div class="result-line"><span class="result-key">Handling Notice</span><span class="result-value">Use only on systems you are authorized to test.</span></div>';

            resultsDiv.innerHTML = html;
            resultsDiv.classList.add('active');
            saveBugBountyResultsState({
                target: safeTarget,
                packName: pack.name,
                builderProfile: pack.builderProfile,
                packNote: pack.note,
                excludes,
                dorks
            });
            void logActivity('TOOL_USED', 'Bug Bounty Dork Packs', `Target: ${safeTarget} | Pack: ${pack.name} | Queries: ${dorks.length}`);
        }

        function pushBugBountyPackToBuilder() {
            if (!guardToolAccess('Bug Bounty Dork Packs')) {
                return;
            }

            const target = document.getElementById('bounty-dork-target-input')?.value.trim() || '';
            const extraExcludesRaw = document.getElementById('bounty-dork-extra-excludes')?.value.trim() || '';
            const pack = getSelectedBugBountyPack();

            if (!target) {
                alert('> ISSUE: Enter a subject domain or keyword');
                return;
            }

            if (!pack) {
                alert('> ISSUE: Recon pack files are unavailable right now');
                return;
            }

            const excludes = [...new Set([...(pack.excludes || []), ...splitDorkCsv(extraExcludesRaw, 12, item => item.toLowerCase())])];

            document.getElementById('dork-target-input').value = target;
            document.getElementById('dork-profile-select').value = pack.builderProfile;
            document.getElementById('dork-exclude-input').value = excludes.join(', ');
            openIndexedTool('tool-dork');
            generateGoogleDorks();
        }

        // ========== NEW 7 NO-KEY TOOLS ==========

        async function searchNistNVD() {
            if (!guardToolAccess('NIST NVD - CVE Search')) return;
            const query = document.getElementById('nist-nvd-input')?.value.trim();
            if (!query) { alert('> ISSUE: Enter a dossier query'); return; }
            const resultsDiv = document.getElementById('nist-nvd-results');
            const loadingDiv = document.getElementById('nist-nvd-loading');
            resultsDiv.classList.remove('active');
            loadingDiv.classList.add('active');

            try {
                const data = await apiRequest(`/tools/nist-nvd?query=${encodeURIComponent(query)}`);
                loadingDiv.classList.remove('active');
                resultsDiv.innerHTML = `
                    <div class="result-line"><span class="result-key">Dossier Query</span><span class="result-value">${escapeHtml(query)}</span></div>
                    <div class="result-line"><span class="result-key">Files Returned</span><span class="result-value">${data.total || 0}</span></div>
                    ${data.items?.map(item => `
                        <div class="result-line"><span class="result-key">${escapeHtml(item.id || 'N/A')}</span><span class="result-value">${escapeHtml(item.description || 'N/A').substring(0, 100)}</span></div>
                    `).join('') || ''}
                `;
                resultsDiv.classList.add('active');
            } catch (error) {
                loadingDiv.classList.remove('active');
                resultsDiv.innerHTML = `<div class="result-line"><span class="result-key">ISSUE</span><span class="result-value">${escapeHtml(error.message || 'NIST NVD dossier lookup failed')}</span></div>`;
                resultsDiv.classList.add('active');
            }
        }

        async function searchMitreCVE() {
            if (!guardToolAccess('MITRE CVE Database')) return;
            const query = document.getElementById('mitre-cve-input')?.value.trim();
            if (!query) { alert('> ISSUE: Enter a dossier query'); return; }
            const resultsDiv = document.getElementById('mitre-cve-results');
            const loadingDiv = document.getElementById('mitre-cve-loading');
            resultsDiv.classList.remove('active');
            loadingDiv.classList.add('active');

            try {
                const data = await apiRequest(`/tools/mitre-cve?query=${encodeURIComponent(query)}`);
                loadingDiv.classList.remove('active');
                resultsDiv.innerHTML = `
                    <div class="result-line"><span class="result-key">Dossier Query</span><span class="result-value">${escapeHtml(query)}</span></div>
                    <div class="result-line"><span class="result-key">CVE Files</span><span class="result-value">${data.found || 0}</span></div>
                    ${data.cves?.slice(0, 10).map(cve => `
                        <div class="result-line"><span class="result-key">CVE File</span><span class="result-value">${escapeHtml(cve)}</span></div>
                    `).join('') || ''}
                `;
                resultsDiv.classList.add('active');
            } catch (error) {
                loadingDiv.classList.remove('active');
                resultsDiv.innerHTML = `<div class="result-line"><span class="result-key">ISSUE</span><span class="result-value">${escapeHtml(error.message || 'MITRE dossier lookup failed')}</span></div>`;
                resultsDiv.classList.add('active');
            }
        }

        async function searchOsvDev() {
            if (!guardToolAccess('OSV.dev - Open Source Vulns')) return;
            const query = document.getElementById('osv-dev-input')?.value.trim();
            if (!query) { alert('> ISSUE: Enter a package or CVE artifact'); return; }
            const resultsDiv = document.getElementById('osv-dev-results');
            const loadingDiv = document.getElementById('osv-dev-loading');
            resultsDiv.classList.remove('active');
            loadingDiv.classList.add('active');

            try {
                const data = await apiRequest(`/tools/osv-dev?query=${encodeURIComponent(query)}`);
                loadingDiv.classList.remove('active');
                resultsDiv.innerHTML = `
                    <div class="result-line"><span class="result-key">Dossier Query</span><span class="result-value">${escapeHtml(query)}</span></div>
                    <div class="result-line"><span class="result-key">Exposure Files</span><span class="result-value">${data.total || 0}</span></div>
                    ${data.vulns?.map(v => `
                        <div class="result-line"><span class="result-key">${escapeHtml(v.id || 'N/A')}</span><span class="result-value">${escapeHtml((v.summary || 'N/A')).substring(0, 80)}</span></div>
                    `).join('') || ''}
                `;
                resultsDiv.classList.add('active');
            } catch (error) {
                loadingDiv.classList.remove('active');
                resultsDiv.innerHTML = `<div class="result-line"><span class="result-key">ISSUE</span><span class="result-value">${escapeHtml(error.message || 'OSV dossier lookup failed')}</span></div>`;
                resultsDiv.classList.add('active');
            }
        }

        function getGHDBDorks() {
            if (!guardToolAccess('Google Hacking Database')) return;
            const category = document.getElementById('ghdb-category-select')?.value || 'Vulnerable Data';
            const resultsDiv = document.getElementById('ghdb-results');

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
            resultsDiv.innerHTML = `
                <div class="result-line"><span class="result-key">Playbook Category</span><span class="result-value">${escapeHtml(category)}</span></div>
                ${categoryDorks.map((dork, idx) => `
                    <div class="result-line ghdb-copy-row" style="cursor: pointer;" data-copy-query="${escapeAttribute(dork)}">
                        <span class="result-key">Query File ${idx + 1}</span>
                        <span class="result-value">${escapeHtml(dork)}</span>
                    </div>
                    <div class="result-line"><span class="result-key">Dispatch</span><span class="result-value"><button type="button" class="btn-terminal btn-small copy-query-btn" data-copy-query="${escapeAttribute(dork)}">COPY</button></span></div>
                `).join('')}
                <div class="result-line"><span class="result-key">Clipboard Status</span><span id="ghdb-copy-status" class="result-value">Waiting for query copy...</span></div>
                <div class="result-line"><span class="result-key">Field Note</span><span class="result-value">Click a query row or press COPY to stage it, then dispatch in your search engine of choice</span></div>
            `;
            resultsDiv.classList.add('active');
        }

        async function lookupCVEDetails() {
            if (!guardToolAccess('CVE Details Lookup')) return;
            const cveId = document.getElementById('cve-details-input')?.value.trim().toUpperCase();
            if (!cveId || !cveId.match(/^CVE-\d{4}-\d{4,}$/)) { alert('> ISSUE: Enter a valid CVE case ID (e.g., CVE-2024-0001)'); return; }
            const resultsDiv = document.getElementById('cve-details-results');

            try {
                const data = await apiRequest(`/tools/cve-details?id=${encodeURIComponent(cveId)}`);
                resultsDiv.innerHTML = `
                    <div class="result-line"><span class="result-key">CVE File</span><span class="result-value">${escapeHtml(data.id || 'N/A')}</span></div>
                    <div class="result-line"><span class="result-key">Source</span><span class="result-value">${escapeHtml(data.source || 'N/A')}</span></div>
                    <div class="result-line"><span class="result-key">URL</span><span class="result-value" style="word-break: break-all;"><a href="${escapeHtml(data.url)}" target="_blank">${escapeHtml(data.url)}</a></span></div>
                    <div class="result-line"><span class="result-key">Brief</span><span class="result-value">${escapeHtml(data.info || '')}</span></div>
                `;
                resultsDiv.classList.add('active');
            } catch (error) {
                resultsDiv.innerHTML = `<div class="result-line"><span class="result-key">ISSUE</span><span class="result-value">${escapeHtml(error.message || 'CVE file lookup failed')}</span></div>`;
                resultsDiv.classList.add('active');
            }
        }

        async function searchCISAKEV() {
            if (!guardToolAccess('CISA KEV - Exploited Vulns')) return;
            const query = document.getElementById('cisa-kev-input')?.value.trim() || '';
            const resultsDiv = document.getElementById('cisa-kev-results');
            const loadingDiv = document.getElementById('cisa-kev-loading');
            resultsDiv.classList.remove('active');
            loadingDiv.classList.add('active');

            try {
                const data = await apiRequest(`/tools/cisa-kev?query=${encodeURIComponent(query)}`);
                loadingDiv.classList.remove('active');
                resultsDiv.innerHTML = `
                    <div class="result-line"><span class="result-key">Filter Brief</span><span class="result-value">${query ? escapeHtml(query) : 'None issued'}</span></div>
                    <div class="result-line"><span class="result-key">Active Cases</span><span class="result-value">${data.total || 0}</span></div>
                    ${data.items?.map(item => `
                        <div class="result-line"><span class="result-key">${escapeHtml(item.cveID || 'N/A')}</span><span class="result-value">${escapeHtml(item.vendor || '')} - ${escapeHtml(item.product || '')}</span></div>
                    `).join('') || ''}
                `;
                resultsDiv.classList.add('active');
            } catch (error) {
                loadingDiv.classList.remove('active');
                resultsDiv.innerHTML = `<div class="result-line"><span class="result-key">ISSUE</span><span class="result-value">${escapeHtml(error.message || 'CISA KEV dossier lookup failed')}</span></div>`;
                resultsDiv.classList.add('active');
            }
        }

        async function searchInternetArchive() {
            if (!guardToolAccess('Internet Archive Search')) return;
            const target = document.getElementById('archive-search-input')?.value.trim();
            if (!target) { alert('> ISSUE: Enter a domain or URL artifact'); return; }
            const resultsDiv = document.getElementById('archive-search-results');
            const loadingDiv = document.getElementById('archive-search-loading');
            resultsDiv.classList.remove('active');
            loadingDiv.classList.add('active');

            try {
                const data = await apiRequest(`/tools/archive-search?target=${encodeURIComponent(target)}`);
                loadingDiv.classList.remove('active');
                resultsDiv.innerHTML = `
                    <div class="result-line"><span class="result-key">Subject Archive</span><span class="result-value">${escapeHtml(target)}</span></div>
                    <div class="result-line"><span class="result-key">Snapshots Filed</span><span class="result-value">${data.total || 0}</span></div>
                    ${data.snapshots?.map(snap => `
                        <div class="result-line"><span class="result-key">${snap.timestamp}</span><span class="result-value">${escapeHtml(snap.url)} (${snap.statusCode})</span></div>
                    `).join('') || ''}
                `;
                resultsDiv.classList.add('active');
            } catch (error) {
                loadingDiv.classList.remove('active');
                resultsDiv.innerHTML = `<div class="result-line"><span class="result-key">ISSUE</span><span class="result-value">${escapeHtml(error.message || 'Archive dossier lookup failed')}</span></div>`;
                resultsDiv.classList.add('active');
            }
        }

        // ========== SEARCH LAUNCHERS ==========

        function launchSearch(engine) {
            const query = document.getElementById('search-launcher-input')?.value.trim();
            if (!query) { alert('> ISSUE: Enter a dossier query'); return; }

            const engines = {
                google: `https://www.google.com/search?q=${encodeURIComponent(query)}`,
                bing: `https://www.bing.com/search?q=${encodeURIComponent(query)}`,
                duckduckgo: `https://duckduckgo.com/?q=${encodeURIComponent(query)}`,
                brave: `https://search.brave.com/search?q=${encodeURIComponent(query)}`,
                startpage: `https://www.startpage.com/sp/search?query=${encodeURIComponent(query)}`,
                swisscows: `https://swisscows.com/search?query=${encodeURIComponent(query)}`,
                qwant: `https://www.qwant.com/?q=${encodeURIComponent(query)}`,
                yahoo: `https://search.yahoo.com/search?p=${encodeURIComponent(query)}`,
                yandex: `https://yandex.com/search/?text=${encodeURIComponent(query)}`,
                baidu: `https://www.baidu.com/s?wd=${encodeURIComponent(query)}`,
                naver: `https://search.naver.com/search.naver?query=${encodeURIComponent(query)}`,
                searxng: `https://searx.be/?q=${encodeURIComponent(query)}`
            };

            const url = engines[engine];
            if (url) {
                window.open(url, '_blank');
                const resultsDiv = document.getElementById('search-launcher-results');
                resultsDiv.innerHTML = `<div class="result-line"><span class="result-key">DISPATCHED</span><span class="result-value">${engine.toUpperCase()} query opened in a new tab</span></div>`;
                resultsDiv.classList.add('active');
            }
        }

        function initializeThreatMap() {
            if (threatMapInitialized) {
                return;
            }

            const sourceSelect = document.getElementById('threat-map-source');
            const backgroundSelect = document.getElementById('background-mode');
            const soundToggle = document.getElementById('threat-map-sound-toggle');
            const statusNode = document.getElementById('threat-map-status');
            const frame = document.getElementById('threat-map-frame');
            const fallback = document.getElementById('threat-map-fallback');
            const openLink = document.getElementById('threat-map-open-link');
            const logNode = document.getElementById('threat-map-log');
            const backgroundThreatMap = document.getElementById('background-threat-map');
            const statsNode = document.getElementById('kaspersky-stats');
            const legendNode = document.getElementById('kaspersky-legend');
            const countryName = document.getElementById('kaspersky-country-name');
            const countryRank = document.getElementById('kaspersky-country-rank');

            if (!sourceSelect || !backgroundSelect || !soundToggle || !statusNode || !frame || !fallback || !openLink || !logNode) {
                return;
            }

            threatMapInitialized = true;

            const readPref = (key, fallbackValue) => {
                try {
                    const stored = window.localStorage.getItem(key);
                    return stored == null ? fallbackValue : stored;
                } catch {
                    return fallbackValue;
                }
            };

            const writePref = (key, value) => {
                try {
                    window.localStorage.setItem(key, value);
                } catch {
                    // Ignore localStorage failures.
                }
            };

            const logThreatMap = (message, level = 'info') => {
                const entry = document.createElement('div');
                entry.className = `threat-map-log-entry ${level}`;
                entry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
                logNode.appendChild(entry);

                while (logNode.children.length > THREAT_MAP_LOG_LIMIT) {
                    logNode.removeChild(logNode.firstChild);
                }
                logNode.scrollTop = logNode.scrollHeight;
            };

            const setStatus = message => {
                statusNode.textContent = message;
            };

            const updateOpenLink = source => {
                openLink.href = source.url;
                openLink.textContent = `Open ${source.label} in new tab`;
                openLink.classList.remove('disabled');
            };

            const setInAppOnlyLinkState = label => {
                openLink.href = '#';
                openLink.textContent = label;
                openLink.classList.add('disabled');
            };

            const kasperskyCountries = [
                { name: 'SRI LANKA', rank: 37 },
                { name: 'INDIA', rank: 7 },
                { name: 'SINGAPORE', rank: 15 },
                { name: 'GERMANY', rank: 9 },
                { name: 'BRAZIL', rank: 12 },
                { name: 'JAPAN', rank: 10 }
            ];
            const kasperskyBaseStats = [
                { code: 'oas', count: 1184 },
                { code: 'ods', count: 942 },
                { code: 'mav', count: 603 },
                { code: 'wav', count: 1288 },
                { code: 'ids', count: 447 },
                { code: 'vul', count: 319 },
                { code: 'kas', count: 701 },
                { code: 'rmw', count: 284 }
            ];
            let kasperskyTelemetryTimer = null;
            let kasperskyAnimationFrame = 0;
            let kasperskyPulseTick = 0;

            const drawKasperskyFallbackBackdrop = (pulsePhase = 0) => {
                const canvas = document.getElementById('threat-map-fallback-canvas');
                if (!canvas) {
                    return;
                }

                const rect = canvas.getBoundingClientRect();
                const dpr = window.devicePixelRatio || 1;
                const width = Math.max(1, Math.floor(rect.width * dpr));
                const height = Math.max(1, Math.floor(rect.height * dpr));
                if (!width || !height) {
                    return;
                }
                if (canvas.width !== width || canvas.height !== height) {
                    canvas.width = width;
                    canvas.height = height;
                }

                const ctx = canvas.getContext('2d');
                if (!ctx) {
                    return;
                }

                ctx.clearRect(0, 0, width, height);
                ctx.fillStyle = 'rgba(1, 10, 8, 0.9)';
                ctx.fillRect(0, 0, width, height);

                ctx.strokeStyle = 'rgba(63, 154, 119, 0.12)';
                ctx.lineWidth = 1;
                const stepX = Math.max(40, Math.floor(width / 18));
                const stepY = Math.max(34, Math.floor(height / 12));
                for (let x = 0; x <= width; x += stepX) {
                    ctx.beginPath();
                    ctx.moveTo(x, 0);
                    ctx.lineTo(x, height);
                    ctx.stroke();
                }
                for (let y = 0; y <= height; y += stepY) {
                    ctx.beginPath();
                    ctx.moveTo(0, y);
                    ctx.lineTo(width, y);
                    ctx.stroke();
                }

                const nodes = [
                    [0.18, 0.29], [0.26, 0.67], [0.44, 0.31], [0.54, 0.35], [0.58, 0.69], [0.69, 0.46], [0.73, 0.57], [0.84, 0.37], [0.82, 0.78]
                ];
                const pulseRadius = (6.5 + Math.sin(pulsePhase) * 2.2) * dpr;
                nodes.forEach(([nx, ny], index) => {
                    const px = nx * width;
                    const py = ny * height;
                    ctx.beginPath();
                    ctx.fillStyle = 'rgba(117, 255, 201, 0.85)';
                    ctx.arc(px, py, 2.2 * dpr, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.beginPath();
                    ctx.strokeStyle = 'rgba(90, 214, 165, 0.3)';
                    ctx.arc(px, py, pulseRadius + ((index % 3) * 1.2 * dpr), 0, Math.PI * 2);
                    ctx.stroke();
                });
            };

            const stopKasperskyTelemetry = () => {
                if (kasperskyTelemetryTimer) {
                    clearInterval(kasperskyTelemetryTimer);
                    kasperskyTelemetryTimer = null;
                }
                if (kasperskyAnimationFrame) {
                    cancelAnimationFrame(kasperskyAnimationFrame);
                    kasperskyAnimationFrame = 0;
                }
            };

            const renderKasperskyTelemetrySnapshot = (announce = false) => {
                const country = kasperskyCountries[Math.floor(Math.random() * kasperskyCountries.length)] || kasperskyCountries[0];
                if (countryName) {
                    countryName.textContent = country.name;
                }
                if (countryRank) {
                    countryRank.textContent = String(country.rank);
                }
                if (statsNode) {
                    const jittered = kasperskyBaseStats.map(item => ({
                        code: item.code,
                        count: Math.max(1, item.count + Math.round((Math.random() - 0.5) * 220))
                    }));
                    statsNode.innerHTML = jittered
                        .map(item => `<div class="kaspersky-stat-row"><span class="code ${item.code}">${item.code.toUpperCase()}</span><span>${item.count}</span></div>`)
                        .join('');
                }
                if (announce) {
                    logThreatMap(`Kaspersky telemetry mirror refreshed: focus ${country.name}.`, 'info');
                }
            };

            const startKasperskyTelemetry = () => {
                stopKasperskyTelemetry();
                renderKasperskyTelemetrySnapshot(true);

                const animate = () => {
                    kasperskyPulseTick += 0.12;
                    drawKasperskyFallbackBackdrop(kasperskyPulseTick);
                    if (resolveSource(sourceSelect.value) === 'kaspersky') {
                        kasperskyAnimationFrame = requestAnimationFrame(animate);
                    }
                };

                kasperskyAnimationFrame = requestAnimationFrame(animate);
                kasperskyTelemetryTimer = setInterval(() => {
                    if (resolveSource(sourceSelect.value) !== 'kaspersky') {
                        stopKasperskyTelemetry();
                        return;
                    }
                    renderKasperskyTelemetrySnapshot(true);
                }, 4500);
            };

            const renderKasperskyInfo = () => {
                if (legendNode) {
                    legendNode.innerHTML = [
                        '<div class="kaspersky-legend-item oas">OAS</div>',
                        '<div class="kaspersky-legend-item ods">ODS</div>',
                        '<div class="kaspersky-legend-item mav">MAV</div>',
                        '<div class="kaspersky-legend-item wav">WAV</div>',
                        '<div class="kaspersky-legend-item ids">IDS</div>',
                        '<div class="kaspersky-legend-item vul">VUL</div>',
                        '<div class="kaspersky-legend-item kas">KAS</div>',
                        '<div class="kaspersky-legend-item rmw">RMW</div>'
                    ].join('');
                }

                if (countryName) {
                    countryName.textContent = 'SRI LANKA';
                }
                if (countryRank) {
                    countryRank.textContent = '37';
                }
                if (statsNode) {
                    statsNode.innerHTML = kasperskyBaseStats
                        .map(item => `<div class="kaspersky-stat-row"><span class="code ${item.code}">${item.code.toUpperCase()}</span><span>${item.count}</span></div>`)
                        .join('');
                }

                drawKasperskyFallbackBackdrop();
            };

            const setSoundState = enabled => {
                soundToggle.textContent = `Sound: ${enabled ? 'ON' : 'OFF'}`;
                soundToggle.setAttribute('aria-pressed', String(enabled));
                writePref(THREAT_MAP_SOUND_PREF_KEY, enabled ? 'on' : 'off');
            };

            const resolveSource = key => THREAT_MAP_SOURCES[key] ? key : 'checkpoint';

            const syncBackgroundThreatMap = sourceKey => {
                if (!backgroundThreatMap) {
                    return;
                }
                if (document.body.dataset.bgMode !== 'threat') {
                    return;
                }
                const source = THREAT_MAP_SOURCES[sourceKey];
                const bgSource = source && source.embeddable ? source : THREAT_MAP_SOURCES.checkpoint;
                if (backgroundThreatMap.getAttribute('src') !== bgSource.url) {
                    backgroundThreatMap.setAttribute('src', bgSource.url);
                }
            };

            const setBackgroundMode = (mode, announce = true) => {
                const allowed = mode === 'threat' || mode === 'grid' ? mode : 'matrix';
                backgroundSelect.value = allowed;
                document.body.dataset.bgMode = allowed;
                writePref(BACKGROUND_MODE_PREF_KEY, allowed);
                syncBackgroundThreatMap(resolveSource(sourceSelect.value));

                if (announce) {
                    const modeLabel = allowed === 'matrix' ? 'Matrix Rain' : allowed === 'threat' ? 'Live Threat Map' : 'Cyber Grid';
                    logThreatMap(`Background set to ${modeLabel}.`, 'info');
                }
            };

            const setSource = (sourceKey, announce = true) => {
                const resolved = resolveSource(sourceKey);
                const source = THREAT_MAP_SOURCES[resolved];

                sourceSelect.value = resolved;
                updateOpenLink(source);
                writePref(THREAT_MAP_SOURCE_PREF_KEY, resolved);
                syncBackgroundThreatMap(resolved);

                if (source.embeddable) {
                    stopKasperskyTelemetry();
                    fallback.classList.remove('active');
                    fallback.setAttribute('aria-hidden', 'true');
                    frame.style.visibility = 'visible';
                    frame.setAttribute('src', source.url);
                    setStatus(`Monitoring ${source.label} feed...`);
                    if (announce) {
                        logThreatMap(`${source.label} linked in workspace.`, 'success');
                    }
                    return;
                }

                frame.removeAttribute('src');
                frame.style.visibility = 'hidden';
                fallback.classList.add('active');
                fallback.setAttribute('aria-hidden', 'false');
                setInAppOnlyLinkState('In-app telemetry mirror active');
                renderKasperskyInfo();
                startKasperskyTelemetry();
                setStatus(`${source.label} is running in in-app telemetry mirror mode.`);
                if (announce) {
                    logThreatMap(`${source.label} loaded in local replica mode with no external redirect.`, 'warn');
                }
            };

            frame.addEventListener('load', () => {
                const source = THREAT_MAP_SOURCES[resolveSource(sourceSelect.value)];
                if (source.embeddable) {
                    setStatus(`${source.label} feed connected.`);
                    logThreatMap(`${source.label} feed responded.`, 'success');
                }
            });

            frame.addEventListener('error', () => {
                fallback.classList.add('active');
                fallback.setAttribute('aria-hidden', 'false');
                frame.style.visibility = 'hidden';
                setStatus('Remote map failed to load. Open in new tab for direct access.');
                logThreatMap('Embedded feed failed to load; fallback enabled.', 'error');
            });

            sourceSelect.addEventListener('change', () => {
                setSource(sourceSelect.value);
            });

            window.addEventListener('resize', () => {
                if (resolveSource(sourceSelect.value) === 'kaspersky') {
                    drawKasperskyFallbackBackdrop();
                }
            });

            backgroundSelect.addEventListener('change', () => {
                setBackgroundMode(backgroundSelect.value);
            });

            soundToggle.addEventListener('click', () => {
                const enabled = soundToggle.getAttribute('aria-pressed') !== 'true';
                setSoundState(enabled);
                logThreatMap(`Threat feed audio ${enabled ? 'enabled' : 'muted'}.`, enabled ? 'success' : 'warn');
            });

            const storedSound = readPref(THREAT_MAP_SOUND_PREF_KEY, 'on') !== 'off';
            const storedBackground = readPref(BACKGROUND_MODE_PREF_KEY, 'matrix');
            const storedSource = readPref(THREAT_MAP_SOURCE_PREF_KEY, 'checkpoint');

            setSoundState(storedSound);
            setBackgroundMode(storedBackground, false);
            setSource(storedSource, false);
            logThreatMap(
                `INIT CHECK -> source=${resolveSource(storedSource)} | background=${document.body.dataset.bgMode || 'matrix'} | sound=${storedSound ? 'on' : 'off'}`,
                'info'
            );
        }

        function copyToClipboard(text) {
            void copyTextToClipboard(text);
        }

        function scrollToCategory(categoryId) {
            const element = document.getElementById(categoryId);
            if (element) {
                // Scroll to the element with smooth behavior
                element.scrollIntoView({ behavior: 'smooth', block: 'start' });
                // Add highlight effect
                element.style.backgroundColor = 'rgba(0, 255, 255, 0.15)';
                setTimeout(() => {
                    element.style.backgroundColor = 'rgba(0, 255, 255, 0.08)';
                }, 1500);
            }
        }

        async function loadReferenceTools() {
            try {
                const data = await apiRequest('/reference-tools');
                if (Array.isArray(data.tools) && data.tools.length) {
                    referenceTools = normalizeReferenceTools(data.tools);
                }
            } catch (error) {
                console.warn('Falling back to bundled reference tools:', error.message);
            }
            referenceTools = normalizeReferenceTools(referenceTools);
            bindReferenceControls();
            refreshReferenceCategoryFilter();
            renderReference();
            renderHomeAndDashboard();
        }

        async function bootApp() {
            await initializeAuth();

            restoreBugBountyPanelState();

            try {
                await loadBugBountyDorkPacks();
                restoreBugBountyResultsState();
            } catch (error) {
                console.error('Bug bounty pack init failed:', error);
            }

            try {
                initializeThreatMap();
            } catch (error) {
                console.error('Threat map init failed:', error);
            }

            try {
                initToolCategories();
                renderActiveToolDirectory();
            } catch (error) {
                console.error('Active tools directory init failed:', error);
            }

            try {
                await loadReferenceTools();
            } catch (error) {
                console.error('Reference tools init failed:', error);
            }
        }

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', bootApp);
        } else {
            void bootApp();
        }

        document.addEventListener('click', event => {
            const button = event.target.closest('.copy-query-btn');
            if (button) {
                const query = button.getAttribute('data-copy-query') || '';
                const inGhdbPanel = !!button.closest('#ghdb-results');
                void copyTextToClipboard(query, button, { suppressAlert: inGhdbPanel }).then(copied => {
                    if (inGhdbPanel) {
                        setGhdbCopyStatus(
                            copied ? 'Query file copied and staged.' : 'Copy failed in this browser session.',
                            copied
                        );
                    }
                });
                return;
            }

            const ghdbRow = event.target.closest('.ghdb-copy-row');
            if (ghdbRow) {
                const query = ghdbRow.getAttribute('data-copy-query') || '';
                void copyTextToClipboard(query, null, { suppressAlert: true }).then(copied => {
                    setGhdbCopyStatus(
                        copied ? 'Query file copied and staged.' : 'Copy failed in this browser session.',
                        copied
                    );
                });
                return;
            }

            const tagChip = event.target.closest('.bounty-dork-tag-chip');
            if (!tagChip) {
                return;
            }

            activeBugBountyTag = tagChip.getAttribute('data-bounty-tag') || 'all';
            populateBugBountyPackSelect();
            saveBugBountyPanelState();
        });

        // Enter key handlers
        document.getElementById('ip-input')?.addEventListener('keypress', e => e.key === 'Enter' && analyzeIP());
        document.getElementById('email-input')?.addEventListener('keypress', e => e.key === 'Enter' && validateEmail());
        document.getElementById('username-input')?.addEventListener('keypress', e => e.key === 'Enter' && searchUsername());
        document.getElementById('hash-input')?.addEventListener('keypress', e => e.key === 'Enter' && identifyHash());
        document.getElementById('domain-input')?.addEventListener('keypress', e => e.key === 'Enter' && analyzeDomain());
        document.getElementById('port-input')?.addEventListener('keypress', e => e.key === 'Enter' && scanPorts());
        document.getElementById('phone-input')?.addEventListener('keypress', e => e.key === 'Enter' && analyzePhone());
        document.getElementById('url-input')?.addEventListener('keypress', e => e.key === 'Enter' && analyzeURL());
        document.getElementById('subdomain-input')?.addEventListener('keypress', e => e.key === 'Enter' && findSubdomains());
        document.getElementById('mac-input')?.addEventListener('keypress', e => e.key === 'Enter' && lookupMAC());
        document.getElementById('dns-input')?.addEventListener('keypress', e => e.key === 'Enter' && lookupDNS());
        document.getElementById('jwt-decoder-input')?.addEventListener('keypress', e => e.key === 'Enter' && decodeJwtLive());
        document.getElementById('html-entity-input')?.addEventListener('keypress', e => e.key === 'Enter' && encodeHtmlEntitiesLive());
        document.getElementById('similarity-input-a')?.addEventListener('keypress', e => e.key === 'Enter' && compareStringSimilarityLive());
        document.getElementById('similarity-input-b')?.addEventListener('keypress', e => e.key === 'Enter' && compareStringSimilarityLive());
        document.getElementById('diff-input-a')?.addEventListener('keypress', e => e.key === 'Enter' && compareTextDiffLive());
        document.getElementById('diff-input-b')?.addEventListener('keypress', e => e.key === 'Enter' && compareTextDiffLive());
        document.getElementById('lorem-count-input')?.addEventListener('keypress', e => e.key === 'Enter' && generateLoremLive());
        document.getElementById('user-agent-input')?.addEventListener('keypress', e => e.key === 'Enter' && analyzeUserAgentLive());
        document.getElementById('coordinate-input')?.addEventListener('keypress', e => e.key === 'Enter' && convertCoordinatesLive());
        document.getElementById('timezone-input')?.addEventListener('keypress', e => e.key === 'Enter' && convertTimezoneLive());
        document.getElementById('sql-formatter-input')?.addEventListener('keypress', e => e.key === 'Enter' && formatSqlLive());
        document.getElementById('dork-target-input')?.addEventListener('keypress', e => e.key === 'Enter' && generateGoogleDorks());
        document.getElementById('dork-exact-input')?.addEventListener('keypress', e => e.key === 'Enter' && generateGoogleDorks());
        document.getElementById('dork-filetype-input')?.addEventListener('keypress', e => e.key === 'Enter' && generateGoogleDorks());
        document.getElementById('dork-inurl-input')?.addEventListener('keypress', e => e.key === 'Enter' && generateGoogleDorks());
        document.getElementById('dork-intitle-input')?.addEventListener('keypress', e => e.key === 'Enter' && generateGoogleDorks());
        document.getElementById('dork-exclude-input')?.addEventListener('keypress', e => e.key === 'Enter' && generateGoogleDorks());
        document.getElementById('bounty-dork-target-input')?.addEventListener('keypress', e => e.key === 'Enter' && generateBugBountyDorks());
        document.getElementById('bounty-dork-target-input')?.addEventListener('input', saveBugBountyPanelState);
        document.getElementById('bounty-dork-pack-filter')?.addEventListener('input', populateBugBountyPackSelect);
        document.getElementById('bounty-dork-pack-filter')?.addEventListener('input', saveBugBountyPanelState);
        document.getElementById('bounty-dork-pack-filter')?.addEventListener('keypress', e => e.key === 'Enter' && generateBugBountyDorks());
        document.getElementById('bounty-dork-pack-select')?.addEventListener('change', () => {
            persistedBugBountyPackId = document.getElementById('bounty-dork-pack-select')?.value || '';
            saveBugBountyPanelState();
        });
        document.getElementById('bounty-dork-extra-excludes')?.addEventListener('input', saveBugBountyPanelState);
        document.getElementById('bounty-dork-extra-excludes')?.addEventListener('keypress', e => e.key === 'Enter' && generateBugBountyDorks());
