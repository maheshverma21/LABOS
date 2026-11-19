# Deploy LabOS from GitHub to Render

1. **Push the code to GitHub** (private repo):
   - On https://github.com/new create an EMPTY private repo (no README), e.g. `labos`.
   - In this folder run:
     ```
     git remote add origin https://github.com/YOUR-USER/labos.git
     git push -u origin main
     ```
     (Sign in when Git asks. A personal access token works as the password.)
2. **Render**: https://render.com > sign up with GitHub > **New > Blueprint** > select the repo > **Apply**.
   It creates the web service, PostgreSQL and Redis from `render.yaml`.
3. When it asks for `WEB_ORIGIN`, enter a placeholder like `https://labos.onrender.com`. Leave `SMTP_URL` empty for now.
4. Wait for the first build (5 to 15 minutes). Migrations run at start.
5. Open the service URL from Render. Then in the service **Environment**, set `WEB_ORIGIN` to exactly that URL (https, no trailing slash) and let it redeploy.
6. Open the URL > **Create an account** to set up your lab.
7. Optional: add your own domain in the service **Settings > Custom Domains**, then update `WEB_ORIGIN`.

Notes
- The `free` web plan has 512 MB RAM and sleeps when idle; the build may fail on it. `starter` is safer.
- The Render free Postgres expires after 30 days, so `render.yaml` uses a paid `basic-256mb` database.
- Every `git push` to `main` redeploys automatically.
