Script you can run on your computer in the background, to export your Safari history every hour and upload it to a D1 database. The goal with this is to be able to have browsing history as additional context for your AI.

# How to use:

- Ensure you have `node` and `bun`
- install pm2 with `npm install -g pm2`
  To look at the data locally:

- Go to privacy & security -> Full Disk Access, and allow full disk access to `Terminal`
- Run `sudo bun run export-history-formatted.ts` (or other scripts); (need administrator access to export browsing history)

To run this in the background and upload it every hour:

- run `npm run create` to create your db and copy the result in `wrangler.toml`
- run `npx wrangler deploy` and put the domain in `.env` as `DOMAIN=Your Domain Here`
- run `pm2 start job.js --name "safari-history-tracker"`
- run `pm2 save` to ensure it reruns at restart
- run `pm2 logs safari-history-tracker` to view if it worked

# Ideas for making this useful

- Try scraping every page stored and augment the with its markdown and raw text (e.g. with https://github.com/janwilmake/llmtext.reader)
- Analyse each url+text into a summary of a sentence (with your desired LLM API)
- Create an endpoint that shows domains visited most, average page duration, total duration, duration percentage, etc.
- Create an endpoint to get context between two times (?from=...&until=...) that allows us to gather the context for cros-processing this with another context (e.g. audio or video)
- Analyse URL structure of domains visited (uncover patterns) using LLMs

# Wishlist

- Run workerd locally (https://github.com/cloudflare/workerd) so this doesn't need to be hosted on cloudflare (Full privacy)
