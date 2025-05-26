export default {
	async fetch(request, env, ctx): Promise<Response> {
		// check URL is /turn-credentials
		const url = new URL(request.url);
		if (url.pathname !== '/turn-credentials') {
			return new Response('Not found', {
				status: 404,
			});
		}

		// check if referrer URL is allowed
		const referrer = getRefererURL(request);
		const allowedOrigins = env.REALTIME_TURN_ORIGINS.split(',');
		if (referrer === null || allowedOrigins.indexOf(referrer.origin) === -1) {
			return new Response('Unauthorized', {
				status: 401,
			});
		}

		// request API keys from Cloudflare Realtime
		const res = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${env.REALTIME_TURN_TOKEN_ID}/credentials/generate`, {
			method: 'post',
			headers: {
				authorization: `Bearer ${env.REALTIME_TURN_TOKEN_SECRET}`,
				'content-type': 'application/json',
			},
			body: JSON.stringify({
				ttl: env.REALTIME_TURN_TOKEN_TTL_SECONDS,
			}),
		});

		// check response is acceptable
		if (res.status !== 201) {
			console.log(`Bad response from Cloudflare Realtime API (${res.status} ${res.statusText}): ${await res.text()}`);
			return new Response(`Bad response`, {
				status: 500,
			});
		}

		// parse JSON
		const creds = await res.json<{
			iceServers: {
				urls: string[];
				username: string;
				credential: string;
			};
		}>();

		// return to client
		return new Response(
			JSON.stringify({
				urls: creds.iceServers.urls.filter((urlString) => {
					const url = new URL(urlString);
					return url.protocol === 'turn:' && url.searchParams.get('transport') === 'udp';
				}),
				username: creds.iceServers.username,
				credential: creds.iceServers.credential,
			}),
			{
				headers: {
					'content-type': 'application/json',
					'access-control-allow-origin': referrer.origin,
				},
			},
		);
	},
} satisfies ExportedHandler<Env>;

function getRefererURL(request: Request) {
	const referer = request.headers.get('Referer');
	if (referer === null) {
		return null;
	}

	try {
		return new URL(referer);
	} catch (e) {
		return null;
	}
}
