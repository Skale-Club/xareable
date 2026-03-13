# Hetzner Deploy

This repository still supports the current Vercel deploy. The files in `deploy/hetzner/` are optional and only meant for a VPS deploy.

## What is included

- `deploy/hetzner/deploy.sh`
  Deploy script with build logs and failure output similar to hosted platform deploy logs.
- `deploy/hetzner/ecosystem.config.cjs`
  PM2 process config with dedicated stdout/stderr log files.
- `deploy/hetzner/nginx.conf.example`
  Reverse proxy example for Nginx.

## Expected server layout

- App directory: `/var/www/xareable`
- App logs: `/var/log/xareable/app`
- Deploy logs: `/var/log/xareable/deploy`
- Node app port: `5000`

## First-time server setup

Install the base packages:

```bash
sudo apt update
sudo apt install -y nginx git curl
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g pm2
```

Clone the project and install dependencies:

```bash
sudo mkdir -p /var/www
sudo chown -R "$USER":"$USER" /var/www
git clone <your-repo-url> /var/www/xareable
cd /var/www/xareable
npm ci
```

Create the log folders:

```bash
sudo mkdir -p /var/log/xareable/app /var/log/xareable/deploy
sudo chown -R "$USER":"$USER" /var/log/xareable
```

Copy your production `.env` into `/var/www/xareable/.env`.

## Nginx

Copy `deploy/hetzner/nginx.conf.example` into `/etc/nginx/sites-available/xareable`, replace the domain, then enable it:

```bash
sudo ln -s /etc/nginx/sites-available/xareable /etc/nginx/sites-enabled/xareable
sudo nginx -t
sudo systemctl reload nginx
```

After DNS is configured, add HTTPS:

```bash
sudo certbot --nginx -d example.com -d www.example.com
```

## Deploy flow

Run the deploy script on the server:

```bash
cd /var/www/xareable
bash deploy/hetzner/deploy.sh
```

The script will:

1. fetch and fast-forward the selected branch
2. run `npm ci`
3. run `npm run check`
4. run `npm run build`
5. reload the app with PM2
6. write a timestamped deploy log to `/var/log/xareable/deploy`

Environment overrides are supported:

```bash
APP_DIR=/var/www/xareable BRANCH=main PORT=5000 bash deploy/hetzner/deploy.sh
```

## Logs

Application logs:

```bash
tail -f /var/log/xareable/app/out.log
tail -f /var/log/xareable/app/error.log
pm2 logs xareable
```

Deploy logs:

```bash
ls -lah /var/log/xareable/deploy
tail -f /var/log/xareable/deploy/latest.log
```

Nginx logs:

```bash
tail -f /var/log/nginx/xareable.access.log
tail -f /var/log/nginx/xareable.error.log
```

## Notes

- This setup does not replace Vercel. It only prepares an alternative VPS deployment path.
- `deploy.sh` assumes `pm2` is installed globally.
- If you want the PM2 process to survive reboots, run:

```bash
pm2 startup
pm2 save
```
