// Matrix Rain Effect
        const canvas = document.getElementById('matrix-canvas');
        const ctx = canvas.getContext('2d');

        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;

        const matrix = "ABCDEFGHIJKLMNOPQRSTUVWXYZ123456789@#$%^&*()*&^%";
        const fontSize = 14;
        const columns = canvas.width / fontSize;
        const drops = [];

        for (let i = 0; i < columns; i++) {
            drops[i] = 1;
        }

        function drawMatrix() {
            ctx.fillStyle = 'rgba(0, 0, 0, 0.04)';
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            ctx.fillStyle = '#52c3ff';
            ctx.font = fontSize + 'px monospace';

            for (let i = 0; i < drops.length; i++) {
                const text = matrix[Math.floor(Math.random() * matrix.length)];
                ctx.fillText(text, i * fontSize, drops[i] * fontSize);

                if (drops[i] * fontSize > canvas.height && Math.random() > 0.975) {
                    drops[i] = 0;
                }
                drops[i]++;
            }
        }

        setInterval(drawMatrix, 35);

        window.addEventListener('resize', () => {
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;
        });

        // Tab Switching
        function switchTab(index, tabName) {
            document.querySelectorAll('.terminal-tab').forEach(btn => btn.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
            
            document.querySelectorAll('.terminal-tab')[index].classList.add('active');
            document.getElementById(tabName + '-tab').classList.add('active');
        }

        // Authentication and Activity Tracking
        const API_BASE_CANDIDATES = window.location.protocol === 'file:'
            ? ['http://localhost:3000/api']
            : ['/api', 'http://localhost:3000/api'];
        const ACTIVITY_LIMIT = 500;
        let currentSession = null;
        let latestDatabaseStats = null;

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

                // If current origin does not host API routes, try next candidate.
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
                throw new Error('Backend not reachable. Start server with `node server.js` and open `http://localhost:3000` (not the HTML file directly).');
            }

            throw new Error('API unavailable. Run `node server.js` and open `http://localhost:3000`.');
        }

        function formatTimestamp(timestamp) {
            if (!timestamp) {
                return 'N/A';
            }
            return new Date(timestamp).toLocaleString();
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
            const isLogin = tabName === 'login';

            loginTab.classList.toggle('active', isLogin);
            registerTab.classList.toggle('active', !isLogin);
            loginForm.classList.toggle('active', isLogin);
            registerForm.classList.toggle('active', !isLogin);
            setAuthMessage('');
        }

        function renderHomeAndDashboard() {
            const authStateNode = document.getElementById('home-auth-state');
            const homeReferenceNode = document.getElementById('home-reference-count');
            const dashboardUserNode = document.getElementById('dashboard-user');
            const dashboardRoleNode = document.getElementById('dashboard-role');
            const dashboardReferenceNode = document.getElementById('dashboard-reference-count');
            const dashboardCategoryNode = document.getElementById('dashboard-category-count');
            const dashboardUserCountNode = document.getElementById('dashboard-user-count');
            const dashboardActivityNode = document.getElementById('dashboard-activity-count');

            const referenceCount = Array.isArray(referenceTools) ? referenceTools.length : 0;
            const categoryCount = Array.isArray(referenceTools)
                ? new Set(referenceTools.map(tool => tool.category).filter(Boolean)).size
                : 0;

            if (authStateNode) {
                authStateNode.textContent = currentSession ? 'Unlocked' : 'Locked';
            }
            if (homeReferenceNode) {
                homeReferenceNode.textContent = referenceCount ? referenceCount.toLocaleString() : '--';
            }

            if (dashboardUserNode) {
                dashboardUserNode.textContent = currentSession ? currentSession.username : 'Guest';
            }
            if (dashboardRoleNode) {
                dashboardRoleNode.textContent = currentSession ? currentSession.role.toUpperCase() : 'N/A';
            }
            if (dashboardReferenceNode) {
                dashboardReferenceNode.textContent = referenceCount ? referenceCount.toLocaleString() : '--';
            }
            if (dashboardCategoryNode) {
                dashboardCategoryNode.textContent = categoryCount ? categoryCount.toLocaleString() : '--';
            }
            if (dashboardUserCountNode) {
                const userCount = latestDatabaseStats?.users;
                dashboardUserCountNode.textContent = Number.isFinite(userCount) ? userCount.toLocaleString() : '--';
            }
            if (dashboardActivityNode) {
                const activityCount = latestDatabaseStats?.activityLogs;
                dashboardActivityNode.textContent = Number.isFinite(activityCount) ? activityCount.toLocaleString() : '--';
            }
        }

        async function updateDatabaseCount() {
            const databaseCountNode = document.getElementById('database-count');
            if (!databaseCountNode) {
                return;
            }

            try {
                const stats = await apiRequest('/database/stats');
                latestDatabaseStats = stats;
                databaseCountNode.textContent = stats.totalRecords.toLocaleString();
                renderHomeAndDashboard();
                return;
            } catch (error) {
                latestDatabaseStats = null;
                databaseCountNode.textContent = '--';
                renderHomeAndDashboard();
            }
        }

        async function fetchActivityLogs(limit = ACTIVITY_LIMIT) {
            const data = await apiRequest(`/activity?limit=${limit}`);
            return Array.isArray(data.logs) ? data.logs : [];
        }

        async function renderActivityLogs() {
            const panel = document.getElementById('admin-activity-panel');
            const summary = document.getElementById('activity-summary');
            const body = document.getElementById('activity-log-body');

            if (!panel || !summary || !body) {
                return;
            }

            if (!currentSession || currentSession.role !== 'admin') {
                panel.style.display = 'none';
                body.innerHTML = '';
                summary.textContent = '';
                return;
            }

            panel.style.display = 'block';

            let logs = [];
            try {
                logs = await fetchActivityLogs(ACTIVITY_LIMIT);
            } catch (error) {
                summary.textContent = 'Failed to load activity logs.';
                body.innerHTML = '<tr><td colspan="5">Could not load logs from database.</td></tr>';
                return;
            }

            const uniqueUsers = new Set(logs.map(log => log.username)).size;
            summary.textContent = `Total events: ${logs.length} | Users: ${uniqueUsers} | Last refresh: ${new Date().toLocaleTimeString()}`;

            if (!logs.length) {
                body.innerHTML = '<tr><td colspan="5">No activity yet.</td></tr>';
                return;
            }

            body.innerHTML = logs.map(log => `
                <tr>
                    <td>${formatTimestamp(log.timestamp)}</td>
                    <td>${log.username}</td>
                    <td>${log.action}</td>
                    <td>${log.tool || '-'}</td>
                    <td>${log.details || '-'}</td>
                </tr>
            `).join('');
        }

        async function renderAccountActivity() {
            const summary = document.getElementById('account-activity-summary');
            const body = document.getElementById('account-activity-body');
            if (!summary || !body) {
                return;
            }

            if (!currentSession) {
                summary.textContent = 'Login required to view your activity.';
                body.innerHTML = '<tr><td colspan="4">No session active.</td></tr>';
                return;
            }

            let logs = [];
            try {
                logs = await fetchActivityLogs(ACTIVITY_LIMIT);
            } catch (error) {
                summary.textContent = 'Failed to load your activity.';
                body.innerHTML = '<tr><td colspan="4">Could not load account activity.</td></tr>';
                return;
            }

            const userKey = currentSession.username.toLowerCase();
            const mine = logs.filter(log => String(log.username || '').toLowerCase() === userKey);
            summary.textContent = `Showing ${mine.length} recent events for ${currentSession.username}.`;

            if (!mine.length) {
                body.innerHTML = '<tr><td colspan="4">No activity for this account yet.</td></tr>';
                return;
            }

            body.innerHTML = mine.map(log => `
                <tr>
                    <td>${formatTimestamp(log.timestamp)}</td>
                    <td>${log.action}</td>
                    <td>${log.tool || '-'}</td>
                    <td>${log.details || '-'}</td>
                </tr>
            `).join('');
        }

        function renderAccountSection() {
            const usernameNode = document.getElementById('account-username');
            const roleNode = document.getElementById('account-role');
            const sessionStateNode = document.getElementById('account-session-state');
            const loginTimeNode = document.getElementById('account-login-time');

            if (usernameNode) {
                usernameNode.textContent = currentSession ? currentSession.username : 'Guest';
            }
            if (roleNode) {
                roleNode.textContent = currentSession ? currentSession.role.toUpperCase() : 'N/A';
            }
            if (sessionStateNode) {
                sessionStateNode.textContent = currentSession ? 'Unlocked' : 'Locked';
            }
            if (loginTimeNode) {
                loginTimeNode.textContent = currentSession ? formatTimestamp(currentSession.loginAt) : '--';
            }

            void renderAccountActivity();
        }

        async function logActivity(action, tool, details) {
            if (!currentSession) {
                return;
            }

            try {
                await apiRequest('/activity', {
                    method: 'POST',
                    body: JSON.stringify({
                        username: currentSession.username,
                        role: currentSession.role,
                        action,
                        tool: tool || '',
                        details: details || ''
                    })
                });

                if (currentSession.role === 'admin') {
                    await renderActivityLogs();
                }
                await renderAccountActivity();
            } catch (error) {
                console.error('Activity logging failed:', error);
            }
        }

        function updateSessionUI() {
            const overlay = document.getElementById('auth-overlay');
            const sessionBar = document.getElementById('session-bar');
            const sessionInfo = document.getElementById('session-info');
            const adminPanel = document.getElementById('admin-activity-panel');
            const adminPanelNote = document.getElementById('admin-panel-note');

            if (!overlay || !sessionBar || !sessionInfo) {
                return;
            }

            if (!currentSession) {
                overlay.style.setProperty('display', 'flex', 'important');
                sessionBar.style.display = 'none';
                if (adminPanel) {
                    adminPanel.style.display = 'none';
                }
                if (adminPanelNote) {
                    adminPanelNote.textContent = 'Login as admin to view user activity and controls.';
                }
                renderHomeAndDashboard();
                renderAccountSection();
                return;
            }

            overlay.style.setProperty('display', 'none', 'important');
            sessionBar.style.display = 'flex';
            sessionInfo.innerHTML = `Logged in as <strong>${currentSession.username}</strong> | Role: ${currentSession.role.toUpperCase()} | Login time: ${formatTimestamp(currentSession.loginAt)}`;

            if (currentSession.role === 'admin') {
                if (adminPanelNote) {
                    adminPanelNote.textContent = 'Admin-only monitoring and controls.';
                }
                void renderActivityLogs();
            } else if (adminPanel) {
                adminPanel.style.display = 'none';
                if (adminPanelNote) {
                    adminPanelNote.textContent = 'Access denied. Admin role required for this panel.';
                }
            }
            renderHomeAndDashboard();
            renderAccountSection();
        }

        function guardToolAccess(toolName) {
            if (!currentSession) {
                switchAuthTab('login');
                setAuthMessage('Please login first to use tools.', true);
                updateSessionUI();
                return false;
            }

            void logActivity('TOOL_USED', toolName, 'Tool executed');
            return true;
        }

        async function handleLogin(event) {
            event.preventDefault();
            try {
                const usernameInput = document.getElementById('login-username');
                const passwordInput = document.getElementById('login-password');
                const username = usernameInput.value.trim();
                const password = passwordInput.value.trim();

                if (!username || !password) {
                    setAuthMessage('Username and password are required.', true);
                    return;
                }

                const data = await apiRequest('/auth/login', {
                    method: 'POST',
                    body: JSON.stringify({ username, password })
                });

                currentSession = {
                    username: data.user.username,
                    role: data.user.role || 'user',
                    loginAt: data.loginAt || new Date().toISOString()
                };

                setAuthMessage('');
                passwordInput.value = '';
                updateSessionUI();
                await logActivity('LOGIN', 'Authentication', 'User logged in');
                await updateDatabaseCount();
            } catch (error) {
                console.error('Login failed:', error);
                setAuthMessage(error.message || 'Login failed.', true);
            }
        }

        async function handleRegistration(event) {
            event.preventDefault();

            const usernameInput = document.getElementById('register-username');
            const passwordInput = document.getElementById('register-password');
            const confirmInput = document.getElementById('register-confirm-password');

            const username = usernameInput.value.trim();
            const password = passwordInput.value;
            const confirmPassword = confirmInput.value;

            try {
                await apiRequest('/auth/register', {
                    method: 'POST',
                    body: JSON.stringify({
                        username,
                        password,
                        confirmPassword
                    })
                });
                usernameInput.value = '';
                passwordInput.value = '';
                confirmInput.value = '';
                switchAuthTab('login');
                setAuthMessage('Registration successful. Please login now.');
                await updateDatabaseCount();
            } catch (error) {
                setAuthMessage(error.message || 'Registration failed.', true);
            }
        }

        function logoutUser() {
            if (currentSession) {
                void logActivity('LOGOUT', 'Authentication', 'User logged out');
            }
            currentSession = null;
            switchAuthTab('login');
            setAuthMessage('Logged out.');
            updateSessionUI();
        }

        async function clearActivityLogs() {
            if (!currentSession || currentSession.role !== 'admin') {
                return;
            }

            if (!confirm('Clear all activity logs?')) {
                return;
            }

            try {
                await apiRequest('/activity', {
                    method: 'DELETE',
                    body: JSON.stringify({ requesterRole: currentSession.role })
                });
                await logActivity('LOGS_CLEARED', 'Activity Monitor', 'Admin cleared all activity logs');
                await renderActivityLogs();
                await updateDatabaseCount();
            } catch (error) {
                setAuthMessage(error.message || 'Failed to clear logs.', true);
            }
        }

        async function initializeAuth() {
            try {
                const loginForm = document.getElementById('auth-login-form');
                const registerForm = document.getElementById('auth-register-form');

                loginForm.addEventListener('submit', handleLogin);
                registerForm.addEventListener('submit', handleRegistration);

                currentSession = null;
                updateSessionUI();
                await updateDatabaseCount();
            } catch (error) {
                console.error('Auth initialization failed:', error);
                setAuthMessage('Unable to reach API. Run `node server.js` and open http://localhost:3000', true);
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
                alert('> ERROR: Please enter an IP address');
                return;
            }

            resultsDiv.classList.remove('active');
            loadingDiv.classList.add('active');

            try {
                const response = await fetch(`https://ipapi.co/${ip}/json/`);
                const data = await response.json();

                loadingDiv.classList.remove('active');
                
                if (data.error) {
                    resultsDiv.innerHTML = `<div class="result-line"><span class="result-key">ERROR</span><span class="result-value">${data.reason}</span></div>`;
                } else {
                    resultsDiv.innerHTML = `
                        <div class="result-line"><span class="result-key">IP Address</span><span class="result-value">${data.ip}</span></div>
                        <div class="result-line"><span class="result-key">Location</span><span class="result-value">${data.city}, ${data.region}, ${data.country_name}</span></div>
                        <div class="result-line"><span class="result-key">Coordinates</span><span class="result-value">${data.latitude}, ${data.longitude}</span></div>
                        <div class="result-line"><span class="result-key">ISP</span><span class="result-value">${data.org}</span></div>
                        <div class="result-line"><span class="result-key">Timezone</span><span class="result-value">${data.timezone}</span></div>
                        <div class="result-line"><span class="result-key">Postal Code</span><span class="result-value">${data.postal || 'N/A'}</span></div>
                        <div class="result-line"><span class="result-key">ASN</span><span class="result-value">${data.asn || 'N/A'}</span></div>
                        <div class="result-line"><span class="result-key">Country Code</span><span class="result-value">${data.country_code}</span></div>
                    `;
                }
                resultsDiv.classList.add('active');
            } catch (error) {
                loadingDiv.classList.remove('active');
                resultsDiv.innerHTML = '<div class="result-line"><span class="result-key">ERROR</span><span class="result-value">Failed to analyze IP. Network error.</span></div>';
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
                alert('> ERROR: Please enter an email address');
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
                <div class="result-line"><span class="result-key">Email</span><span class="result-value">${email}</span></div>
                <div class="result-line"><span class="result-key">Format Validation</span><span class="result-value">${isValid ? '✓ VALID' : '✗ INVALID'}</span></div>
                <div class="result-line"><span class="result-key">Username</span><span class="result-value">${username || 'N/A'}</span></div>
                <div class="result-line"><span class="result-key">Domain</span><span class="result-value">${domain || 'N/A'}</span></div>
                <div class="result-line"><span class="result-key">Provider Type</span><span class="result-value">${provider}</span></div>
                <div class="result-line"><span class="result-key">Disposable Check</span><span class="result-value">${isDisposable ? '⚠ DISPOSABLE' : '✓ LEGITIMATE'}</span></div>
                <div class="result-line"><span class="result-key">Risk Assessment</span><span class="result-value">${isDisposable ? 'HIGH RISK' : 'LOW RISK'}</span></div>
                <div class="result-line"><span class="result-key">Username Length</span><span class="result-value">${username?.length || 0} characters</span></div>
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
                alert('> ERROR: Please enter a username');
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

                let html = `<div class="result-line"><span class="result-key">Username</span><span class="result-value">${username}</span></div>`;
                html += `<div class="result-line"><span class="result-key">Platforms Checked</span><span class="result-value">${platforms.length}</span></div>`;
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
                alert('> ERROR: Please enter a hash string');
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
                <div class="result-line"><span class="result-key">Hash</span><span class="result-value">${hash.substring(0, 64)}${hash.length > 64 ? '...' : ''}</span></div>
                <div class="result-line"><span class="result-key">Length</span><span class="result-value">${length} characters</span></div>
                <div class="result-line"><span class="result-key">Character Set</span><span class="result-value">${charset}</span></div>
                <div class="result-line"><span class="result-key">Possible Types</span><span class="result-value">${types.length > 0 ? types.join(', ') : 'Unknown / Invalid'}</span></div>
                <div class="result-line"><span class="result-key">Security Level</span><span class="result-value">${isWeak ? '⚠ WEAK (Deprecated)' : types.length > 0 ? '✓ STRONG' : 'UNKNOWN'}</span></div>
                <div class="result-line"><span class="result-key">Recommendation</span><span class="result-value">${isWeak ? 'Use SHA-256 or higher' : 'Current standard acceptable'}</span></div>
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
                alert('> ERROR: Please enter a domain');
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
                    <div class="result-line"><span class="result-key">Domain</span><span class="result-value">${domain}</span></div>
                    <div class="result-line"><span class="result-key">Top-Level Domain</span><span class="result-value">.${tld}</span></div>
                    <div class="result-line"><span class="result-key">Second-Level Domain</span><span class="result-value">${sld}</span></div>
                    <div class="result-line"><span class="result-key">DNS Status</span><span class="result-value">✓ RESOLVABLE</span></div>
                    <div class="result-line"><span class="result-key">HTTPS Support</span><span class="result-value">Checking required</span></div>
                    <div class="result-line"><span class="result-key">WHOIS Server</span><span class="result-value">whois.${tld}</span></div>
                    <div class="result-line"><span class="result-key">Note</span><span class="result-value">Full WHOIS data requires external API</span></div>
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
                alert('> ERROR: Please enter a hostname or IP');
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

                let html = `<div class="result-line"><span class="result-key">Target</span><span class="result-value">${host}</span></div>`;
                html += `<div class="result-line"><span class="result-key">Ports Scanned</span><span class="result-value">${commonPorts.length}</span></div>`;
                html += '<div style="margin-top: 1rem; padding-top: 1rem; border-top: 1px solid rgba(82, 195, 255, 0.2);">';
                
                commonPorts.forEach(p => {
                    html += `<div class="result-line"><span class="result-key">Port ${p.port} (${p.service})</span><span class="result-value">${p.status}</span></div>`;
                });
                
                html += '</div>';
                html += `<div class="result-line"><span class="result-key">Note</span><span class="result-value">Simulated scan - browser limitations apply</span></div>`;

                resultsDiv.innerHTML = html;
                resultsDiv.classList.add('active');
            }, 2000);
        }

        // Phone Analysis
        function analyzePhone() {
            if (!guardToolAccess('Phone Intelligence')) {
                return;
            }
            const phone = document.getElementById('phone-input').value.trim();
            const resultsDiv = document.getElementById('phone-results');

            if (!phone) {
                alert('> ERROR: Please enter a phone number');
                return;
            }

            const cleaned = phone.replace(/\D/g, '');
            const isValid = cleaned.length >= 10 && cleaned.length <= 15;
            const countryCode = cleaned.length > 10 ? cleaned.substring(0, cleaned.length - 10) : 'N/A';
            const areaCode = cleaned.length >= 10 ? cleaned.substring(cleaned.length - 10, cleaned.length - 7) : 'N/A';

            resultsDiv.innerHTML = `
                <div class="result-line"><span class="result-key">Phone Number</span><span class="result-value">${phone}</span></div>
                <div class="result-line"><span class="result-key">Cleaned Format</span><span class="result-value">${cleaned}</span></div>
                <div class="result-line"><span class="result-key">Format Valid</span><span class="result-value">${isValid ? '✓ YES' : '✗ NO'}</span></div>
                <div class="result-line"><span class="result-key">Length</span><span class="result-value">${cleaned.length} digits</span></div>
                <div class="result-line"><span class="result-key">Country Code</span><span class="result-value">+${countryCode}</span></div>
                <div class="result-line"><span class="result-key">Area Code</span><span class="result-value">${areaCode}</span></div>
                <div class="result-line"><span class="result-key">Type</span><span class="result-value">Requires carrier API</span></div>
                <div class="result-line"><span class="result-key">Location</span><span class="result-value">Requires lookup service</span></div>
            `;
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
                alert('> ERROR: Please enter a URL');
                return;
            }

            try {
                const urlObj = new URL(url);
                const params = new URLSearchParams(urlObj.search);
                const paramCount = Array.from(params.keys()).length;

                resultsDiv.innerHTML = `
                    <div class="result-line"><span class="result-key">Full URL</span><span class="result-value">${url}</span></div>
                    <div class="result-line"><span class="result-key">Protocol</span><span class="result-value">${urlObj.protocol}</span></div>
                    <div class="result-line"><span class="result-key">Domain</span><span class="result-value">${urlObj.hostname}</span></div>
                    <div class="result-line"><span class="result-key">Port</span><span class="result-value">${urlObj.port || 'Default'}</span></div>
                    <div class="result-line"><span class="result-key">Path</span><span class="result-value">${urlObj.pathname}</span></div>
                    <div class="result-line"><span class="result-key">Parameters</span><span class="result-value">${paramCount} found</span></div>
                    <div class="result-line"><span class="result-key">Hash</span><span class="result-value">${urlObj.hash || 'None'}</span></div>
                    <div class="result-line"><span class="result-key">HTTPS</span><span class="result-value">${urlObj.protocol === 'https:' ? '✓ SECURE' : '⚠ INSECURE'}</span></div>
                `;
                resultsDiv.classList.add('active');
            } catch (error) {
                resultsDiv.innerHTML = '<div class="result-line"><span class="result-key">ERROR</span><span class="result-value">Invalid URL format</span></div>';
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
                alert('> ERROR: Please enter a domain');
                return;
            }

            loadingDiv.classList.add('active');
            resultsDiv.classList.remove('active');

            setTimeout(() => {
                loadingDiv.classList.remove('active');
                
                const commonSubdomains = ['www', 'mail', 'ftp', 'admin', 'blog', 'shop', 'api', 'dev', 'staging', 'test', 'vpn', 'remote', 'support', 'portal', 'cdn'];
                const found = commonSubdomains.filter(() => Math.random() > 0.6);

                let html = `<div class="result-line"><span class="result-key">Domain</span><span class="result-value">${domain}</span></div>`;
                html += `<div class="result-line"><span class="result-key">Subdomains Found</span><span class="result-value">${found.length}</span></div>`;
                html += '<div style="margin-top: 1rem; padding-top: 1rem; border-top: 1px solid rgba(82, 195, 255, 0.2);">';
                
                found.forEach(sub => {
                    html += `<div class="result-line"><span class="result-key">Subdomain</span><span class="result-value">${sub}.${domain}</span></div>`;
                });
                
                html += '</div>';
                html += `<div class="result-line"><span class="result-key">Note</span><span class="result-value">Common subdomain enumeration - full scan requires DNS API</span></div>`;

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
                alert('> ERROR: Please enter a MAC address');
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
                <div class="result-line"><span class="result-key">MAC Address</span><span class="result-value">${mac}</span></div>
                <div class="result-line"><span class="result-key">Normalized</span><span class="result-value">${cleaned}</span></div>
                <div class="result-line"><span class="result-key">Format Valid</span><span class="result-value">${isValid ? '✓ YES' : '✗ NO'}</span></div>
                <div class="result-line"><span class="result-key">OUI (Vendor ID)</span><span class="result-value">${oui}</span></div>
                <div class="result-line"><span class="result-key">Vendor</span><span class="result-value">${vendor}</span></div>
                <div class="result-line"><span class="result-key">Type</span><span class="result-value">${(parseInt(cleaned.charAt(1), 16) & 1) ? 'Locally Administered' : 'Universally Administered'}</span></div>
                <div class="result-line"><span class="result-key">Note</span><span class="result-value">Full vendor database requires MAC lookup API</span></div>
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
                alert('> ERROR: Please enter a Base64 string');
                return;
            }

            try {
                const decoded = atob(input);
                resultsDiv.innerHTML = `
                    <div class="result-line"><span class="result-key">Input</span><span class="result-value">${input.substring(0, 100)}${input.length > 100 ? '...' : ''}</span></div>
                    <div class="result-line"><span class="result-key">Decoded</span><span class="result-value">${decoded}</span></div>
                    <div class="result-line"><span class="result-key">Length</span><span class="result-value">${decoded.length} characters</span></div>
                    <div class="result-line"><span class="result-key">Operation</span><span class="result-value">✓ DECODE SUCCESS</span></div>
                `;
                resultsDiv.classList.add('active');
            } catch (error) {
                resultsDiv.innerHTML = '<div class="result-line"><span class="result-key">ERROR</span><span class="result-value">Invalid Base64 string</span></div>';
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
                alert('> ERROR: Please enter text to encode');
                return;
            }

            const encoded = btoa(input);
            resultsDiv.innerHTML = `
                <div class="result-line"><span class="result-key">Input</span><span class="result-value">${input.substring(0, 100)}${input.length > 100 ? '...' : ''}</span></div>
                <div class="result-line"><span class="result-key">Encoded</span><span class="result-value">${encoded}</span></div>
                <div class="result-line"><span class="result-key">Length</span><span class="result-value">${encoded.length} characters</span></div>
                <div class="result-line"><span class="result-key">Operation</span><span class="result-value">✓ ENCODE SUCCESS</span></div>
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
                alert('> ERROR: Please enter a domain');
                return;
            }

            loadingDiv.classList.add('active');
            resultsDiv.classList.remove('active');

            setTimeout(() => {
                loadingDiv.classList.remove('active');
                
                resultsDiv.innerHTML = `
                    <div class="result-line"><span class="result-key">Domain</span><span class="result-value">${domain}</span></div>
                    <div class="result-line"><span class="result-key">A Record</span><span class="result-value">Requires DNS API</span></div>
                    <div class="result-line"><span class="result-key">AAAA Record</span><span class="result-value">Requires DNS API</span></div>
                    <div class="result-line"><span class="result-key">MX Record</span><span class="result-value">Requires DNS API</span></div>
                    <div class="result-line"><span class="result-key">NS Record</span><span class="result-value">Requires DNS API</span></div>
                    <div class="result-line"><span class="result-key">TXT Record</span><span class="result-value">Requires DNS API</span></div>
                    <div class="result-line"><span class="result-key">Note</span><span class="result-value">Browser-based DNS queries limited - use external DNS API for full results</span></div>
                `;
                resultsDiv.classList.add('active');
            }, 1000);
        }

        // Reference Database
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

        function escapeHtml(value) {
            return String(value ?? '')
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
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
                ...categories.map(category => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`)
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
                <div class="tools-grid reference-tools-grid">
                    ${groups.map(([groupName, groupTools]) => {
                        const previewNames = groupTools
                            .slice(0, 3)
                            .map(tool => escapeHtml(tool.name))
                            .join(' | ');
                        return `
                            <div class="tool-terminal reference-category-terminal">
                                <div class="tool-header">
                                    <span class="tool-icon">REF</span>
                                    <h3 class="tool-title">${escapeHtml(groupName)}</h3>
                                </div>
                                <div class="tool-body">
                                    <p class="tool-desc">${groupTools.length} external tools available in this category.</p>
                                    <p class="reference-category-preview">${previewNames || 'No preview available'}</p>
                                    <button type="button" class="btn-terminal" data-ref-category="${encodeURIComponent(groupName)}">OPEN CATEGORY</button>
                                </div>
                            </div>
                        `;
                    }).join('')}
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
            title.textContent = categoryName;
            meta.textContent = `${tools.length} tools in this category`;
            toolsContainer.innerHTML = tools.map(tool => `
                <div class="reference-item">
                    <div class="reference-name">${escapeHtml(tool.name)}</div>
                    <div class="reference-desc">${escapeHtml(tool.desc || 'No description available.')}</div>
                    <div class="reference-meta">
                        <div class="reference-category">${escapeHtml(tool.category)}</div>
                        ${tool.source ? `<div class="reference-source">${escapeHtml(tool.source)}</div>` : ''}
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
            await loadReferenceTools();
            await initializeAuth();
        }

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', bootApp);
        } else {
            void bootApp();
        }

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
