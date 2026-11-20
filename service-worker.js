const SHELL_CACHE = 'mp3a-shell-v1';
const ASSET_CACHE = 'mp3a-assets-v1';
const APP_SCOPE = self.registration.scope;
const APP_SHELL_URLS = [
    new URL('./', APP_SCOPE).href,
    new URL('./index.html', APP_SCOPE).href,
    new URL('./manifest.webmanifest', APP_SCOPE).href,
    new URL('./app-icon.svg', APP_SCOPE).href,
    new URL('./app-icon-180.png', APP_SCOPE).href,
    new URL('./app-icon-192.png', APP_SCOPE).href,
    new URL('./app-icon-512.png', APP_SCOPE).href,
    new URL('./ICONO NEW.jpg', APP_SCOPE).href,
    new URL('./LOGO 1.png', APP_SCOPE).href,
    new URL('./RETRO.jpg', APP_SCOPE).href,
    new URL('./CRISTAL.jpg', APP_SCOPE).href,
    new URL('./HACKER.jpg', APP_SCOPE).href,
    new URL('./Synthwave.jpg', APP_SCOPE).href,
    new URL('./comic.jpg', APP_SCOPE).href
];
const EXTERNAL_ORIGINS = new Set([
    'https://cdn.tailwindcss.com',
    'https://cdnjs.cloudflare.com',
    'https://fonts.googleapis.com',
    'https://fonts.gstatic.com',
    'https://images.unsplash.com'
]);
const EXTERNAL_PRELOAD_URLS = [
    'https://cdn.tailwindcss.com/',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css',
    'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;600;700;900&family=Press+Start+2P&family=Fira+Code:wght@400;600;700&family=Bangers&family=Orbitron:wght@500;700;900&family=Quicksand:wght@500;700&display=swap',
    'https://images.unsplash.com/photo-1614149162883-504ce4d13909?w=300&q=80',
    'https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=300&q=80',
    'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=300&q=80',
    'https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?w=300&q=80'
];

async function saveResponse(cache, request, response) {
    if (!response.ok && response.type !== 'opaque') return;
    try {
        await cache.put(request, response.clone());
    } catch (error) {
        console.warn('No se pudo guardar un recurso para uso sin conexión:', request.url, error);
    }
}

async function preloadFontResources(cssText, cssUrl, cache) {
    const urls = [...cssText.matchAll(/url\((?:['"])?([^'")]+)(?:['"])?\)/g)]
        .map(match => new URL(match[1], cssUrl))
        .filter(url => EXTERNAL_ORIGINS.has(url.origin) && url.origin !== 'https://fonts.googleapis.com');

    const results = await Promise.allSettled(urls.map(async url => {
        const request = new Request(url.href, { mode: 'cors', cache: 'reload' });
        const response = await fetch(request);
        await saveResponse(cache, request, response);
    }));
    results.forEach((result, index) => {
        if (result.status === 'rejected') {
            console.warn('No se pudo precargar una fuente para uso sin conexión:', urls[index].href, result.reason);
        }
    });
}

async function preloadExternalAsset(url, cache) {
    let request = new Request(url, { mode: 'cors', cache: 'reload' });
    let response;
    try {
        response = await fetch(request);
    } catch (corsError) {
        request = new Request(url, { mode: 'no-cors', cache: 'reload' });
        try {
            response = await fetch(request);
        } catch (error) {
            console.warn('No se pudo precargar un recurso para uso sin conexión:', url, error || corsError);
            return;
        }
    }

    await saveResponse(cache, request, response);
    if (response.ok && url.endsWith('.css')) {
        await preloadFontResources(await response.clone().text(), url, cache);
    }
}

self.addEventListener('install', event => {
    event.waitUntil((async () => {
        const shellCache = await caches.open(SHELL_CACHE);
        await shellCache.addAll(APP_SHELL_URLS);

        const assetCache = await caches.open(ASSET_CACHE);
        await Promise.allSettled(EXTERNAL_PRELOAD_URLS.map(url => preloadExternalAsset(url, assetCache)));
        await self.skipWaiting();
    })());
});

self.addEventListener('activate', event => {
    event.waitUntil((async () => {
        const keys = await caches.keys();
        await Promise.all(keys
            .filter(key => key.startsWith('mp3a-') && ![SHELL_CACHE, ASSET_CACHE].includes(key))
            .map(key => caches.delete(key)));
        await self.clients.claim();
    })());
});

self.addEventListener('fetch', event => {
    const request = event.request;
    if (request.method !== 'GET' || request.headers.has('range')) return;

    const requestUrl = new URL(request.url);
    if (request.mode === 'navigate') {
        event.respondWith((async () => {
            const shellCache = await caches.open(SHELL_CACHE);
            try {
                const response = await fetch(request);
                if (response.ok) await saveResponse(shellCache, request, response);
                return response;
            } catch {
                return await shellCache.match(request, { ignoreVary: true }) ||
                    await shellCache.match(new URL('./index.html', APP_SCOPE).href) ||
                    Response.error();
            }
        })());
        return;
    }

    if (requestUrl.origin !== self.location.origin && !EXTERNAL_ORIGINS.has(requestUrl.origin)) return;

    event.respondWith((async () => {
        const cache = await caches.open(requestUrl.origin === self.location.origin ? SHELL_CACHE : ASSET_CACHE);
        const cached = await cache.match(request, { ignoreVary: true });
        if (cached) return cached;

        const response = await fetch(request);
        await saveResponse(cache, request, response);
        return response;
    })());
});
