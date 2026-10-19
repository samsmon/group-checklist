# Legacy: AWS EC2 deployment

Historical only. The EC2 instance (`checky.suryatmaja.dev`) has been shut down and the app now runs on the homelab;
see [../../docs/deploy-homelab.md](../../docs/deploy-homelab.md).

These files are kept for reference and are not wired into the app. Paths inside them (for example
`nginx/group-checklist.conf`, `scripts/migrate.ts`) assumed the old repository layout and will not work from this
folder without edits.

| File | Was used for |
|------|--------------|
| `deploy-ec2.md` | Full EC2 + Cloudflare + Neon setup guide |
| `init.sh`, `setup-ec2.sh` | First-time setup of a fresh instance |
| `update.sh`, `deploy.sh` | Pull, install, restart the systemd service |
| `nginx/`, `systemd/` | Nginx site config and systemd unit |
