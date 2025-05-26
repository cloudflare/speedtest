# TURN credentials worker

This directory contains a sample worker to provide the measurement engine with TURN server credentials.

## Deployment

### Creating a new Realtime TURN App

**Warning**:  
Cloudflare Realtime TURN servers are subject to billing after the free tier limits are reached.  
Read the Cloudflare Realtime [TURN FAQ](https://developers.cloudflare.com/realtime/turn/faq/) for more information on TURN usage billing.

1. In the Cloudflare Dashboard, select `Realtime` from the sidebar, then inside `TURN Server` click `Create`.
2. Select a name for your server, and press `Create`
3. To use these tokens while developing locally, edit the `.dev.vars` file at the root of this directory, setting:
   1. `REALTIME_TURN_TOKEN_ID` to the returned _Turn Token ID_
   2. `REALTIME_TURN_TOKEN_SECRET` to the returned _API Token_.
4. To add these secrets to your remote worker:
   1. Run `npm exec wrangler secret put REALTIME_TURN_TOKEN_ID` and provide the _Turn Token ID_
   2. Run `npm exec wrangler secret put REALTIME_TURN_TOKEN_SECRET` and provide the _API Token_

### Setting routes and allowed origins

If you'd like this worker to be available at your own domain, uncomment the `routes` section in the `wrangler.jsonc` file, replacing the example configuration with your own domain and zone ID.  
Alternatively, you can use the `*.workers.dev` subdomain provided by default.

Add the URLs your worker will be available at to `REALTIME_TURN_ORIGINS` in the `vars` section inside `wrangler.jsonc`.

### Deploying the worker

Run `npm run deploy` and follow the instructions.

### Configuring the measurement engine

When instantiating the measurement engine, set the `turnServerCredsApiUrl` option to `https://<your-worker-domain>/turn-credentials`.

For local development, run `npm run start` and set `turnServerCredsApiUrl` to `http://localhost:8787`

### More information

Read the [Cloudflare Workers guide](https://developers.cloudflare.com/workers/get-started/guide/) for more information.
