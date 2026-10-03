(function () {
    const urlParams = new URLSearchParams(window.location.search);
    const userUuid = 'a1fdd1b0-2199-4907-87a6-e17d67dd83b3';
    const pageview = 'https://track4you.app/api/v2/webhook/pageview';
    const click = 'https://track4you.app/api/v2/webhook/click';
    const event_id = crypto.randomUUID();
    let pixels = ["1676666486942549","1390043269679359","2292194478249346"];

    // ==========================================
    // VARIÁVEIS DE ENGAJAMENTO E BOT
    // ==========================================
    const startTime = Date.now();
    let maxScroll = 0;
    let isBot = navigator.webdriver ? true : false;
    let hasHumanInteraction = false;
    let cachedEncryptedGeoIp = null; // Guardará o IP criptografado para os próximos eventos

    function markAsHuman() {
        if (!hasHumanInteraction) {
            hasHumanInteraction = true;
            isBot = false;
        }
    }

    ['mousemove', 'touchstart', 'keydown', 'wheel'].forEach(evt => {
        window.addEventListener(evt, markAsHuman, { once: true });
    });

    window.addEventListener('scroll', () => {
        markAsHuman();
        let scrollTop = window.scrollY || document.documentElement.scrollTop;
        let docHeight = document.documentElement.scrollHeight - document.documentElement.clientHeight;
        let scrollPercent = docHeight > 0 ? (scrollTop / docHeight) * 100 : 100;
        if (scrollPercent > maxScroll) maxScroll = Math.round(scrollPercent);
    }, { passive: true });
    // ==========================================

    // Carregamento do Pixel do Facebook
    if (Array.isArray(pixels) && pixels.length > 0) {
        !function(f,b,e,v,n,t,s)
        {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
            n.callMethod.apply(n,arguments):n.queue.push(arguments)}
        ;if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
            n.queue=[];t=b.createElement(e);t.async=!0;
            t.src=v;s=b.getElementsByTagName(e)[0];
            s.parentNode.insertBefore(t,s)}(window, document,'script',
            'https://connect.facebook.net/en_US/fbevents.js');

        if (Array.isArray(pixels)) {
            pixels.forEach(pixel => {
                fbq('init', pixel);
                fbq('track', 'PageView');
            });
        }
    }

    function getCleanHostname() {
        const host = window.location.hostname;
        return host.startsWith("www.") ? host.slice(4) : host;
    }

    function extractUTMsFromUrl() {
        let utms = '';
        ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'].forEach((param) => {
            if (urlParams.has(param)) {
                utms += `${param}=${urlParams.get(param)}&`;
            }
        });
        return utms.slice(0, -1);
    }

    function getFbpCookie() {
        return getCookie('_fbp');
    }

    function getFbcCookie() {
        return getCookie('_fbc');
    }

    function getCookie(name) {
        const nameEQ = `${name}=`;
        const decodedCookies = decodeURIComponent(document.cookie);
        const cookies = decodedCookies.split(';');
        for (let cookie of cookies) {
            cookie = cookie.trim();
            if (cookie.indexOf(nameEQ) === 0) return cookie.substring(nameEQ.length);
        }
        return null;
    }

    function createFbcCookieFromFbclid() {
        const fbclid = urlParams.get('fbclid');
        if (fbclid) {
            const fbcValue = `fb.1.${Date.now()}.${fbclid}`;
            document.cookie = `_fbc=${fbcValue}; path=/; domain=${window.location.hostname}; samesite=lax`;
        }
    }

    // ==========================================
    // TÓPICO 1: GeoIP Criptografado
    // ==========================================
    async function getEncryptedGeoIp() {
        if (cachedEncryptedGeoIp) return cachedEncryptedGeoIp;
        try {
            const response = await fetch('https://tracker-v1.track4you-app.workers.dev/');
            if (!response.ok) return null;
            cachedEncryptedGeoIp = await response.text();
            return cachedEncryptedGeoIp;
        } catch (error) {
            console.error('GeoIP service fetch error:', error);
            return null;
        }
    }

    // ==========================================
    // TÓPICO 2: sendEvent com sendBeacon + fallback fetch
    // ==========================================
    async function sendEvent(eventName, payload, expectResponse = false) {
        const endpoint = `https://track4you.app/api/v2/webhook/${eventName}`;
        const data = JSON.stringify(payload);

        // Uso do sendBeacon para disparar e esquecer
        if (!expectResponse && navigator.sendBeacon) {
            navigator.sendBeacon(endpoint, new Blob([data], { type: 'application/json' }));
            return null;
        }

        // Fallback para fetch
        try {
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: data,
                keepalive: true
            });

            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            if (expectResponse) return await response.json();
            return null;
        } catch (error) {
            console.error(`Event send error for ${eventName}:`, error);
            return null;
        }
    }

    // ==========================================
    // NORMALIZAÇÃO DE LINKS TELEGRAM/T4Y + INJEÇÃO DE ATRIBUIÇÃO
    // Roda em todo dispositivo. É o único caminho de injeção de atribuição:
    // sem ela, o click no t4y.io perde UTMs e cookies _fbp/_fbc first-party.
    // ==========================================
    const TELEGRAM_HOSTS = ['t4y.io', 't.me', 'telegram.me'];
    const RESERVED_PARAMS = ['fbp', 'fbc', 'eid', 'btn'];
    let lastCorrectLink = null; // guardado para re-normalizar links injetados depois do pageview

    function normalizeTelegramLinks(correctLink) {
        if (!correctLink) return;
        lastCorrectLink = correctLink;
        correctLink=correctLink.replace(
            'https://t4y.iov2/',
            'https://t4y.io/v2/'
        );
        document.querySelectorAll('a[href]').forEach(a => {
            let host;
            try { host = new URL(a.href).hostname.replace(/^www\./, ''); } catch { return; }
            if (!TELEGRAM_HOSTS.includes(host)) return; // hostname, não substring (evita falso-positivo tipo cart.me...)

            const target = new URL(correctLink); // link certo do funil, sempre

            // PASSTHROUGH TOTAL: copia TODOS os params da URL da landing
            // (utm_*, fbclid, gclid, ttclid, sub-ids de afiliado, o que vier)
            urlParams.forEach((v, k) => {
                if (!RESERVED_PARAMS.includes(k)) target.searchParams.set(k, v);
            });

            // reservados por último — nenhum param da URL sobrescreve
            const fbc = getFbcCookie(); if (fbc) target.searchParams.set('fbc', fbc);
            const fbp = getFbpCookie(); if (fbp) target.searchParams.set('fbp', fbp);
            target.searchParams.set('eid', event_id); // liga edge click ↔ pageview/engagement
            const btn = a.id || a.innerText?.trim().slice(0, 40);
            if (btn) target.searchParams.set('btn', btn); // preserva o buttonId por âncora

            a.href = target.toString();
        });
    }

    // Cobre links injetados depois do pageview (React/UI builders montando o botão async).
    // MutationObserver re-normaliza sempre que um <a> novo entra no DOM.
    const linkObserver = new MutationObserver(() => {
        if (lastCorrectLink) normalizeTelegramLinks(lastCorrectLink);
    });
    linkObserver.observe(document.body, { childList: true, subtree: true });

    // ==========================================
    // DISPARO DE EVENTOS
    // ==========================================
    async function trackViewPage() {
        const encryptedGeoData = await getEncryptedGeoIp();
        createFbcCookieFromFbclid();

        const payload = {
            url: getCleanHostname(),
            path: window.location.pathname,
            utms: extractUTMsFromUrl(),
            encrypted_geoip: encryptedGeoData,
            user_agent: navigator.userAgent,
            fbp: getFbpCookie(),
            fbc: getFbcCookie(),
            action: 'viewpage',
            user_id: userUuid,
            event_id: event_id,
            is_bot: isBot,
        };

        const response = await sendEvent('pageview', payload, true);

        if (response && response.telegram_link) {
            normalizeTelegramLinks(response.telegram_link);
        }
        // sem telegram_link (funil não resolvido): nada é tocado
    }

    // ==========================================
    // ENGAJAMENTO: evento de saída da página
    // ==========================================
    let engagementSent = false;
    function sendFinalEngagement() {
        if (engagementSent) return;
        engagementSent = true;

        const payload = {
            action: 'engagement',
            event_id: event_id,
            user_id: userUuid,
            url: getCleanHostname(),
            time_on_page_seconds: Math.round((Date.now() - startTime) / 1000),
            max_scroll_percentage: maxScroll,
            is_bot: isBot,
        };

        // sendBeacon ideal para o fechamento da página
        sendEvent('engagement', payload, false);
    }

    window.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') sendFinalEngagement();
    });
    window.addEventListener('pagehide', sendFinalEngagement);
    window.addEventListener('beforeunload', sendFinalEngagement);

    // Inicializa o rastreamento
    trackViewPage();

})();
