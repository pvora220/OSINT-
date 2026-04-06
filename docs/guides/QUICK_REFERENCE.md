# QUICK REFERENCE - Security Changes

## ✅ What Was Done (Phase 1 & 2)

| Component | Before | After | Status |
|-----------|--------|-------|--------|
| Admin Credentials | Visible in UI | Removed from UI | ✅ Fixed |
| Password Storage | Plaintext in DB | PBKDF2 Hashed + Salted | ✅ Fixed |
| Authorization | Client-trusted role | Server-validated sessions | ✅ Fixed |
| Admin Account | Force-reset every start | One-time bootstrap | ✅ Fixed |
| Session Validation | None | Secure tokens (24h expiry) | ✅ Fixed |

---

## 🚀 First-Time Setup

```
1. Start server: node server.js
2. Copy admin password from console
3. Open http://localhost:3000
4. Login: admin / <password-from-console>
```

---

## 🔑 Custom Admin Password

```powershell
# PowerShell:
$env:ADMIN_PASSWORD = "MyPassword"
node server.js

# Batch file: Edit start-matrix-osint.bat
# Uncomment: set ADMIN_PASSWORD=MyPassword
```

---

## 📁 Files Changed

```
✅ matrix-osint-integrated.html    - Removed hardcoded credentials
✅ server.js                        - Added hashing, sessions, token auth
✅ matrix-osint-integrated.js      - Updated to use session tokens
✅ docs/security/SECURITY_UPDATES.md             - NEW: Detailed security guide
✅ docs/implementation/IMPLEMENTATION_SUMMARY.md - NEW: Implementation details
✅ docs/guides/howtorun.txt                      - Updated with new setup
✅ start-matrix-osint.bat          - Updated with password support
```

---

## 🔍 Verify It Works

1. **Check Hashed Passwords**
   - Open `data/matrix-osint.db` 
   - View `users` table
   - Password should show: `salt:hash` format

2. **Check Session Tokens**
   - Login
   - DevTools → Network → `/api/activity POST`
   - Body shows: `{"token": "abc123..."}`

3. **Check Admin Verification**
   - Try to delete logs with wrong token
   - Should get: `403 Forbidden`

---

## 🎯 API Changes

| Endpoint | Before | After | Notes |
|----------|--------|-------|-------|
| POST /auth/login | Returns user object | Returns token + user | Store token! |
| POST /activity | Sends username/role | Sends token | Server validates |
| DELETE /activity | Trusts requesterRole | Validates token | No spoofing |
| POST /auth/logout | Didn't exist | New endpoint | Invalidates token |

---

## 📋 Phase 3 To-Do (Future)

- [ ] Fix XSS in tool results (use textContent)
- [ ] Fix XSS in activity logs (use escapeHtml)
- [ ] Add CSRF token validation
- [ ] Add rate limiting on login
- [ ] Deploy with HTTPS
- [ ] Use Redis for sessions
- [ ] Use secrets manager

---

## ⚠️ Important Notes

- **Old passwords won't work** - plaintext passwords are invalidated
- **Auto-upgrade** - successful login creates hashed version
- **Session token expiry** - 24 hours (re-login needed)
- **In-memory sessions** - restarting server logs everyone out
- **Production** - use Redis or persistent session store

---

## 💾 Backup Your Password

On first run, the console shows:
```
Admin account created. Password: 3f7a2bcd8e1f4a9b2c5d...
```

**Save this immediately!** You can't recover it without:
- Resetting the password via env var
- Or deleting and recreating the database

---

**Questions?** See ../security/SECURITY_UPDATES.md and ../implementation/IMPLEMENTATION_SUMMARY.md for detailed docs.
