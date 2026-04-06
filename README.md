# Matrix OSINT - Deploy Guide

This project is now configured to run on free hosting with a free public domain.

## Project Structure

```text
Tool/
	backend/
		server.js
		services/
			phone/
				country-codes.json
				phone-utils.js
	frontend/
		public/
			data/
				bug-bounty-dork-packs.json
			js/
				advanced-features.js
				core-ui.js
			matrix-osint-integrated.html
			matrix-osint-integrated.css
			matrix-osint-integrated.js
	data/
		(local SQLite db files)
	scripts/
		start-matrix-osint.bat
	deploy/
		docker-compose.yml
		Dockerfile
	docs/
		*.md / *.txt
	package.json
	render.yaml (kept at root for Render auto-detect)
```

## Best Free Domain Recommendation

Use the Render free subdomain first:
- Example: `https://matrix-osint.onrender.com`

Why this is best for this project:
- Your app uses a Node.js backend (`backend/server.js`) and SQLite.
- Static hosts like GitHub Pages cannot run this backend.
- Render provides a free HTTPS domain and easy GitHub auto-deploy.

Optional later:
- Add a custom free subdomain using `is-a.dev` + Cloudflare DNS.
- Keep Render as your app host and point DNS to it.

## 1. Install Prerequisites

On your Windows PC (PowerShell):

```powershell
winget install --id Git.Git -e --source winget
winget install --id GitHub.cli -e --source winget
```

Restart terminal after install.

## 2. Create GitHub Repository and Push

In project folder:

```powershell
cd "C:\Users\Potato\Desktop\Tool"
git init
git add .
git commit -m "Initial Matrix OSINT deploy-ready setup"
```

Create an empty repo on GitHub named `matrix-osint` (no README/license), then:

```powershell
git branch -M main
git remote add origin https://github.com/<YOUR_USERNAME>/matrix-osint.git
git push -u origin main
```

## 3. Deploy to Render (Free)

1. Go to `https://dashboard.render.com`.
2. Click `New +` -> `Blueprint`.
3. Connect your GitHub account.
4. Select your `matrix-osint` repo.
5. Render auto-detects `render.yaml`.
6. Create service.

After first deploy, your free live domain will be:
- `https://<your-service-name>.onrender.com`

## 4. Environment Variables (Optional)

In Render service settings -> Environment:
- `VERIPHONE_API_KEY` (optional)

App works without them; related tools degrade gracefully.

## 5. Important Notes

- `data/*.db` is git-ignored intentionally (local user database should not be committed).
- Render free instances can sleep when idle.
- SQLite on ephemeral free hosts can reset on redeploy/restart. For persistent auth data, later move to managed Postgres.

## 6. Local Run

```powershell
cd "C:\Users\Potato\Desktop\Tool"
node backend/server.js
```

Open:
- `http://localhost:3000`

## 7. Docker Helpers

From project root:

```powershell
npm run docker:up
npm run docker:logs
npm run docker:down
```
