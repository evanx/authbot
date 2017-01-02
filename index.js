const assert = require('assert');
const crypto = require('crypto');
const fetch = require('node-fetch');
const fs = require('fs');
const lodash = require('lodash');
const Promise = require('bluebird');
const Koa = require('koa');
const KoaRouter = require('koa-router');
const bodyParser = require('koa-bodyparser');
const logger = require('winston');

const app = new Koa();
const api = KoaRouter();

const configDefault = {
    port: 8080,
    namespace: 'authbot',
    redisHost: '127.0.0.1',
    loginExpire: 30,
    sessionExpire: 300,
    cookieExpire: 60000,
    sendTimeout: 8000,
    redirectAuth: '/auth',
    redirectNoAuth: '/noauth',
    sessionRoute: true,
    loggerLevel: 'debug'
};

const configMeta = {
    domain: {
        description: 'HTTPS web domain to auth access',
        example: 'authdemo.webserva.com'
    },
    demo: {
        required: false,
        description: 'Serve site pages for the demo',
        example: true
    },
    bot: {
        description: 'Telegram Bot name i.e. this authbot',
        example: 'ExAuthDemoBot',
        info: 'https://core.telegram.org/bots/api',
        hint: 'https://telegram.me/BotFather'
    },
    secret: {
        description: 'Telegram Bot secret',
        example: 'z7WnDUfuhtDCBjX54Ks5vB4SAdGmdzwRVlGQjWBt',
        info: 'https://core.telegram.org/bots/api#setwebhook',
        hint: 'https://github.com/evanx/random-base56'
    },
    token: {
        description: 'Telegram Bot token',
        example: '243751977:AAH-WYXgsiZ8XqbzcqME7v6mUALxjktvrQc',
        info: 'https://core.telegram.org/bots/api#authorizing-your-bot',
        hint: 'https://telegram.me/BotFather'
    },
    admin: {
        description: 'Authoritative Telegram username i.e. bootstrap admin user',
        example: 'evanxsummers',
        info: 'https://telegram.org'
    },
    hubRedis: {
        required: false,
        description: 'Remote hub for bot messages via Redis, especially for development',
        example: 'redis://localhost:6333',
        info: 'https://github.com/evanx/webhook-push'
    }
};

const state = {};
const configFile = (!process.env.configFile? null: require(process.env.configFile));
const configKeys = [];
const missingConfigKeys = [];
const config = Object.keys(configMeta)
.concat(Object.keys(configDefault))
.reduce((config, key) => {
    if (process.env[key]) {
        assert(process.env[key] !== '', key);
        config[key] = process.env[key];
        configKeys.push(key);
    } else if (configFile && configFile[key]) {
        config[key] = configFile[key];
        configKeys.push(key);
    } else if (!configDefault[key] && configMeta[key].required !== false) {
        missingConfigKeys.push(key);
    }
    return config;
}, configDefault);

const sp = Array(3).join(' ');

function formatHelp(configKey) {
    const meta = configMeta[configKey];
    const lines = [`${sp}${configKey} e.g. '${meta.example}'`];
    if (meta.description) {
        lines.push(`${sp+sp}"${meta.description}"`);
    }
    if (meta.info) {
        lines.push(`${sp+sp+sp}see ${meta.info}`);
    }
    if (meta.hint) {
        lines.push(`${sp+sp+sp}see ${meta.hint}`);
    }
    return lines;
}

function printStartHelp() {
    console.error('\nExample start:');
    console.error([
        ...configKeys.map(key => {
            return `${sp}${key}='${config[key]}' \\`;
        }),
        ...missingConfigKeys.map(key => {
            const meta = configMeta[key];
            return `${sp}${key}='' \\`;
        }),
        `${sp}npm start`
    ].join('\n'));
}

function printDockerHelp() {
    console.error('\nTest Docker build:');
    console.error([
        `${sp}docker build -t authbot:test git@github.com:evanx/authbot.git`
    ].join('\n'));
    console.error('\nExample Docker run:');
    console.error([
        `${sp}docker run -t ${config.namespace}:test -d \\`,
        ...configKeys.map(key => {
            return `${sp+sp}-e ${key}='${config[key]}' \\`;
        }),
        ...missingConfigKeys.map(key => {
            const meta = configMeta[key];
            return `${sp+sp}-e ${key}='' \\`;
        }),
        `${sp+sp}${config.namespace}-test`
    ].join('\n'));
}

if (missingConfigKeys.length) {
    console.error(`Missing configs:`);
    console.error(lodash.flatten(missingConfigKeys.map(
        configKey => formatHelp(configKey)
    )).join('\n'));
    printStartHelp();
    printDockerHelp();
    process.exit(1);
}

logger.level = config.loggerLevel;

state.botUrl = `https://api.telegram.org/bot${config.token}`;

if (configFile && process.env.NODE_ENV === 'development') {
    [
        `https://${configFile.hubDomain}/webhook/${config.secret}`,
        `https://${config.domain}/authbot/webhook/${config.secret}`
    ].forEach(webhookUrl => {
        const apiUrl = `${state.botUrl}/setWebhook?url=${encodeURI(webhookUrl)}`;
        console.log(`curl -s '${apiUrl}' | jq '.'`);
    });
    if (configFile.hubNamespace && configFile.hubLocalPort && configFile.hubHost) {
        const subscribeChannel = [configFile.hubNamespace, config.secret].join(':');
        console.log(`\nssh -L${configFile.hubLocalPort}:127.0.0.1:6379 ${configFile.hubHost}`);
        console.log(`\nredis-cli -p ${configFile.hubLocalPort} subscribe "${subscribeChannel}"\n`);
    }
    console.log([
        ...Object.keys(config).map(key => `${key}=${config[key]}`),
        'npm run development'
    ].join(' '));
    console.log([
        ``,
        `Bot commands:`,
        ``,
        `login - login to https://${config.domain}`,
        `sessions - list your recent sessions`,
        `logout - force logout your recent sessions`,
        `grant - role to user`,
        `revoke - role from user`,
        `users - list users and their granted roles`,
        ``
    ].join('\n'));
}

const redis = require('redis');
const client = redis.createClient(6379, config.redisHost);

assert(process.env.NODE_ENV, 'NODE_ENV');

async function multiExecAsync(client, multiFunction) {
    const multi = client.multi();
    multiFunction(multi);
    return Promise.promisify(multi.exec).call(multi);
}

function generateToken(length = 16) {
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const charset = '0123456789' + letters + letters.toLowerCase();
    return crypto.randomBytes(length).map(
        value => charset.charCodeAt(Math.floor(value * charset.length / 256))
    ).toString();
}

(async function() {
    state.started = Math.floor(Date.now()/1000);
    state.pid = process.pid;
    logger.info('start', JSON.stringify({config, configFile, state}, null, 2));
    multiExecAsync(client, multi => {
        multi.hmset([config.namespace, 'started'].join(':'), state);
    });
    if (process.env.NODE_ENV === 'development') {
        return startDevelopment();
    } else if (process.env.NODE_ENV === 'test') {
        return startTest();
    } else {
        return startProduction();
    }
}());

async function startTest() {
    return start();
}

async function startDevelopment() {
    return start();
}

async function startProduction() {
    return start();
}

async function start() {
    await startHttpServer();
    if (config.hubRedis) {
        await startSubscribeHub();
    } else if (configFile.srcChannel) {
        await startSubscribeSrc();
    } else if (configFile.endChannel) {
        await startSubscribeEnd();
    }
}

async function startSubscribeHub() {
    assert(configFile.hubNamespace, 'hubNamespace');
    state.sub = redis.createClient(config.hubRedis);
    state.sub.on('message', (channel, message) => {
        if (channel.endsWith(config.secret)) {
            logger.debug({channel, message});
            handleTelegramMessage(JSON.parse(message));
        } else {
            logger.warn('hubRedis', {channel});
        }
    });
    state.sub.subscribe([configFile.hubNamespace, config.secret].join(':'));
}

async function startSubscribeSrc() {
    assert(configFile.srcFile, 'srcFile');
    state.sub = redis.createClient();
    state.sub.on('message', (channel, message) => {
        if (channel === configFile.srcChannel) {
            fs.writeFile(configFile.srcFile, message, err => {
                if (err) {
                    logger.error('srcFile', configFile.srcFile, err);
                } else if (configFile.srcQueue) {
                    if (!state.srcPort || state.srcPort > config.port + 4) {
                        state.srcPort = config.port + 1;
                    } else {
                        state.srcPort++;
                    }
                    client.lpush(configFile.srcQueue, state.srcPort);
                } else if (!configFile.endChannel) {
                    end();
                }
            });
        }
    });
    state.sub.subscribe(configFile.srcChannel);
}

async function startSubscribeEnd() {
    state.sub = redis.createClient();
    state.sub.on('message', (channel, message) => {
        if (channel === configFile.endChannel) {
            if (message === configFile.endMessage) {
                end();
            }
        }
    });
    state.sub.subscribe(configFile.endChannel);
}

async function startHttpServer() {
    api.post('/authbot/webhook/:secret', async ctx => {
        ctx.body = '';
        if (ctx.params.secret !== config.secret) {
            logger.debug('invalid', ctx.request.url);
        } else {
            logger.debug('webhook', typeof ctx.request.body, ctx.request.body);
            await handleTelegramMessage(ctx.request.body);
        }
    });
    api.get('/authbot/login/:username/:token', async ctx => {
        await handleLogin(ctx);
    });
    if (config.sessionRoute) {
        api.get('/authbot-session/:username/:sessionId', async ctx => {
            await handleSession(ctx);
        });
    }
    api.get('/authbot/logout', async ctx => {
        await handleLogout(ctx);
    });
    if (config.demo) {
        api.get('/auth', async ctx => {
            await handleAuth(ctx);
        });
        api.get('/noauth', async ctx => {
            await handleNoAuth(ctx);
        });
        api.get('/', async ctx => {
            await handleHome(ctx);
        });
    }
    app.use(bodyParser());
    app.use(async (ctx, next) => {
        try {
            await next();
        } catch (err) {
            return handleError(ctx, err);
        }
    });
    app.use(api.routes());
    app.use(async ctx => {
        ctx.status = 404;
    });
    state.server = app.listen(config.port);
    logger.info('http', config.port, formatTime(new Date()));
}

function getBotUrl(ctx) {
    return /(Mobile)/.test(ctx.get('user-agent'))
    ? `tg://${config.bot}`
    : `https://web.telegram.org/#/im?p=@${config.bot}`;
}

function renderPage(ctx, content) {
    const botUrl = getBotUrl(ctx);
    const botLink = `<a href="${botUrl}">@${config.bot}</a> Telegram Bot`;
    const paragraphs = content.paragraphs.map(p => p.replace('{botLink}', botLink));
    ctx.body = lodash.flatten([
        `<html>`,
        `<head>`,
        `<title>AuthBot Demo</title>`,
        `<meta name="viewport" content="width=device-width, initial-scale=1">`,
        `</head>`,
        `<body>`,
        `<h1>${content.heading}</h1>`,
        paragraphs.map(p => `<p>${p}</p>`),
        `</body>`,
        `</html>`
    ]).join('\n');
}

async function handleError(ctx, err) {
    logger.debug('handleError', err);
    renderPage(ctx, {
        heading: `Error: ${err.message}`,
        paragraphs: [
            `Use {botLink} to login`
        ]
    });
}

async function handleNoAuth(ctx) {
    renderPage(ctx, {
        heading: `No Auth`,
        paragraphs: [
            `Use {botLink} to login`
        ]
    });
}

async function handleHome(ctx) {
    renderPage(ctx, {
        heading: `Welcome`,
        paragraphs: [
            `Use {botLink} to login`
        ]
    });
}

async function getSession(sessionId) {
    if (!sessionId) {
        throw new Error('No sessionId');
    }
    const sessionKey = [config.namespace, 'session', sessionId, 'h'].join(':');
    const [session] = await multiExecAsync(client, multi => {
        multi.hgetall(sessionKey);
    });
    if (!session) {
        throw new Error('Session expired');
    }
    session.sessionId = sessionId;
    return session;
}

async function handleSession(ctx) {
    const {username, sessionId} = ctx.params;
    const session = await getSession(sessionId);
    if (session && session.username === username
        && (Date.now() - session.started)/1000 < config.loginExire
    ) {
        ctx.status = 200;
        ctx.body = 'Authenticated';
    } else {
        ctx.status = 403;
        ctx.body = 'Access prohibited';
    }
}

async function handleAuth(ctx) {
    const sessionId = ctx.cookies.get('sessionId');
    if (!sessionId) {
        throw new Error('No cookie');
    }
    const session = await getSession(sessionId);
    renderPage(ctx, {
        heading: `Welcome ${session.name}`,
        paragraphs: [
            `Logout to clear the session and cookie via <a href="/authbot/logout">/authbot/logout</a>`,
            `You can also logout by sending <tt>/logout</tt> command to {botLink}.`,
            `Incidently, your session ID is set via cookie on this domain, and can be validated ` +
            `against the Redis storage used by this AuthBot.`
        ]
    });
}

async function handleLogout(ctx) {
    const sessionId = ctx.cookies.get('sessionId');
    if (sessionId) {
        const sessionKey = [config.namespace, 'session', sessionId, 'h'].join(':');
        const [session] = await multiExecAsync(client, multi => {
            multi.hgetall(sessionKey);
            multi.del(sessionKey);
        });
        if (session && session.username) {
            const loginKey = [config.namespace, 'login', session.username, 'h'].join(':');
            await multiExecAsync(client, multi => {
                multi.del(loginKey);
            });
        }
        ctx.cookies.set('sessionId', '', {expires: new Date(0), domain: config.domain, path: '/'});
    }
    ctx.redirect(config.redirectNoAuth);
}

async function handleLogin(ctx) {
    const ua = ctx.get('User-Agent');
    logger.debug('handleLogin', ua);
    if (ua.startsWith('TelegramBot')) {
        ctx.status = 403;
        return;
    }
    const {username, token} = ctx.params;
    const loginKey = [config.namespace, 'login', username, 'h'].join(':');
    const [login] = await multiExecAsync(client, multi => {
        multi.hgetall(loginKey);
    });
    logger.debug('handleLogin', {loginKey, login});
    if (!login) {
        const sessionId = ctx.cookies.get('sessionId');
        if (sessionId) {
            logger.debug('handleLogin', {sessionId}, config.redirectNoAuth);
        }
        ctx.status = 403;
        ctx.redirect(config.redirectNoAuth);
        return;
    }
    assert.equal(login.username, username, 'username');
    assert.equal(login.token, token, 'token');
    const sessionId = [token, generateToken(16)].join('_');
    const sessionKey = [config.namespace, 'session', sessionId, 'h'].join(':');
    const sessionListKey = [config.namespace, 'session', username, 'l'].join(':');
    const session = Object.assign({}, login, {started: Date.now()});
    const [hmset] = await multiExecAsync(client, multi => {
        multi.hmset(sessionKey, session);
        multi.expire(sessionKey, config.sessionExpire);
        multi.del(loginKey);
        multi.lpush(sessionListKey, sessionId);
        multi.ltrim(sessionListKey, 0, 3);
    });
    ctx.cookies.set('sessionId', sessionId, {maxAge: config.cookieExpire, domain: config.domain, path: '/'});
    ctx.redirect(config.redirectAuth);
    if (session.chatId && session.name) {
        await sendTelegram(session.chatId, 'html', [
            `Thanks ${session.name}, you have logged in.`
        ]);
    }
}

async function handleTelegramMessage(message) {
    const from = message.message.from;
    const request = {
        chatId: message.message.chat.id,
        username: from.username,
        name: from.first_name || from.username,
        text: message.message.text,
        timestamp: message.message.date
    };
    logger.debug('webhook', request, message.message);
    if (request.text === '/login') {
        return handleTelegramLogin(request);
    } else if (request.text === '/logout') {
        return handleTelegramLogout(request);
    } else if (request.text.startsWith('/session')) {
        return handleTelegramListSessions(request);
    } else if (request.text.startsWith('/user')) {
        return handleTelegramListUsers(request);
    } else if (request.text.startsWith('/grant')) {
        return handleTelegramGrant(request);
    } else if (request.text.startsWith('/revoke')) {
        return handleTelegramRevoke(request);
    } else {
        await sendTelegram(request.chatId, 'html', [
            `Try <code>/login</code>`
        ]);
    }
}

async function handleTelegramLogin(request) {
    const {username, name, chatId} = request;
    const token = generateToken(16);
    const loginKey = [config.namespace, 'login', username, 'h'].join(':');
    let [hmset] = await multiExecAsync(client, multi => {
        multi.hmset(loginKey, {token, username, name, chatId});
        multi.expire(loginKey, config.loginExpire);
    });
    if (hmset) {
        await sendTelegramReply(request, 'html', [
            `You can login via https://${[config.domain, 'authbot', 'login', username, token].join('/')}.`,
            `This link expires in ${config.loginExpire} seconds.`,
            `Powered by https://github.com/evanx/authbot.`
        ]);
    } else {
        await sendTelegramReply(request, 'html', [
            `Apologies, the login command failed.`,
        ]);
    }
}

async function handleTelegramListSessions(request) {
    const {username, name, chatId} = request;
    const sessionListKey = [config.namespace, 'session', username, 'l'].join(':');
    const [sessionIds] = await multiExecAsync(client, multi => {
        multi.lrange(sessionListKey, 0, 5);
    });
    if (!sessionIds.length) {
        await sendTelegramReply(request, 'html', [
            `No sessions found.`
        ]);
        return;
    }
    const sessions = lodash.compact(await multiExecAsync(client, multi => {
        sessionIds.forEach(sessionId => {
            const sessionKey = [config.namespace, 'session', sessionId, 'h'].join(':');
            multi.hgetall(sessionKey);
        });
    }));
    if (sessions.length === 0) {
        await sendTelegramReply(request, 'html', [
            `Your latest session has expired.`,
        ]);
    } else if (sessions.length === 1) {
        const session0 = lodash.first(sessions);
        await sendTelegramReply(request, 'html', [
            `Your session was created ${formatElapsed(session0.started)} ago.`,
        ]);
    } else {
        const session0 = lodash.first(sessions);
        const sessionl = lodash.last(sessions);
        await sendTelegramReply(request, 'html', [
            `You have ${sessions.length} active sessions.`,
            `The latest was created ${formatElapsed(session0.started)} ago.`,
            `The oldest was created ${formatElapsed(sessionl.started)} ago.`,
        ]);
    }
}

async function handleTelegramLogout(request) {
    const {username, name, chatId} = request;
    const sessionListKey = [config.namespace, 'session', username, 'l'].join(':');
    const [sessionIds] = await multiExecAsync(client, multi => {
        multi.lrange(sessionListKey, 0, 5);
    });
    if (!sessionIds.length) {
        await sendTelegramReply(request, 'html', [
            `No sessions found.`
        ]);
        return;
    }
    const sessions = lodash.compact(await multiExecAsync(client, multi => {
        sessionIds.forEach(sessionId => {
            const sessionKey = [config.namespace, 'session', sessionId, 'h'].join(':');
            multi.hgetall(sessionKey);
        });
    }));
    await multiExecAsync(client, multi => {
        sessionIds.forEach(sessionId => {
            const sessionKey = [config.namespace, 'session', sessionId, 'h'].join(':');
            multi.del(sessionKey);
        });
    });
    if (sessions.length === 0) {
        await sendTelegramReply(request, 'html', [
            `No active sessions.`,
        ]);
    } else if (sessions.length === 1) {
        const session = sessions[0];
        await sendTelegramReply(request, 'html', [
            `The session that was created ${formatElapsed(session.started)} ago, has now been deleted.`,
        ]);
    } else {
        const session0 = sessions[0];
        const sessionl = lodash.last(sessions);
        await sendTelegramReply(request, 'html', [
            `${sessions.length} sessions have been deleted.`,
            `The latest was created ${formatElapsed(session0.started)} ago.`,
            `The oldest was created ${formatElapsed(sessionl.started)} ago.`,
        ]);
    }
}

async function handleTelegramGrant(request) {
    const {username, name, chatId} = request;
    if (username !== config.admin) {
        await sendTelegramReply(request, 'html', [
            `You are not the admin user, please ask ${config.admin}.`
        ]);
    } else {
        const [role, user] = (request.text.match(/^\/grant ([a-z_]+) to ([a-z_]+)$/) || []).slice(1);
        if (!user) {
            await sendTelegramReply(request, 'html', [
                `Try /grant <code>role</code> to <code>username</code>`,
                `e.g. <code>/grant admin to other_user</code>`
            ]);
        } else {
            await sendTelegramReply(request, 'html', [
                `You wish to grant role <code>${role}</code> to <code>${user}</code>.`,
                `Oh apologies, this feature not yet implemented. Please check again from Monday 3rd January.`
            ]);
        }
    }
}

async function handleTelegramListUsers(request) {
    const {username, name, chatId} = request;
    if (username !== config.admin) {
        await sendTelegramReply(request, 'html', [
            `You are not the admin user, please ask ${config.admin}.`
        ]);
    } else {
        await sendTelegramReply(request, 'html', [
            `You wish to list users and their roles.`,
            `Oh apologies, this feature not yet implemented. Please check again from Monday 3rd January.`
        ]);
    }
}

async function handleTelegramRevoke(request) {
    const {username, name, chatId} = request;
    if (username !== config.admin) {
        await sendTelegramReply(request, 'html', [
            `You are not the admin user, please ask ${config.admin}.`
        ]);
    } else {
        const [role, user] = (request.text.match(/^\/revoke ([a-z_]+) from ([a-z_]+)$/) || []).slice(1);
        if (!user) {
            await sendTelegramReply(request, 'html', [
                `Try /revoke <code>role</code> from <code>username</code>`,
                `e.g. <code>revoke admin from other_user</code>`
            ]);
        } else {
            await sendTelegramReply(request, 'html', [
                `You wish to revoke role <code>${role}</code> from <code>${user}</code>.`,
                `Oh apologies, this feature not yet implemented. Please check again from Monday 3rd January.`
            ]);
        }
    }
}

async function sendTelegramReply(request, format, ...content) {
    if (request.chatId && request.name) {
        await sendTelegram(request.chatId, format,
            `Thanks, ${request.name}.`,
            ...content
        );
    } else {
        logger.error('sendTelegramReply', request);
    }
}

async function sendTelegram(chatId, format, ...content) {
    logger.debug('sendTelegram', chatId, format, content);
    try {
        const text = lodash.trim(lodash.flatten(content).join(' '));
        assert(chatId, 'chatId');
        let uri = `sendMessage?chat_id=${chatId}`;
        uri += '&disable_notification=true';
        if (format === 'markdown') {
            uri += `&parse_mode=Markdown`;
        } else if (format === 'html') {
            uri += `&parse_mode=HTML`;
        }
        uri += `&text=${encodeURIComponent(text)}`;
        const url = [state.botUrl, uri].join('/');
        const options = {timeout: config.sendTimeout};
        logger.info('sendTelegram url', url, {options});
        const res = await fetch(url, options);
        if (res.status !== 200) {
            logger.warn('sendTelegram status', res.status, {chatId, url});
        }
    } catch (err) {
        logger.error(err);
    }
}

async function end() {
    client.quit();
    if (state.sub) {
        state.sub.quit();
    }
    if (state.server) {
        state.server.close();
    }
}

function formatTime(date) {
    return [
        date.getHours(), date.getMinutes(), date.getSeconds()
    ].map(
        v => ('0' + v).slice(-2)
    ).join(':');
}

function formatElapsed(started) {
    const elapsedMillis = Date.now() - started;
    const elapsedSeconds = Math.floor(elapsedMillis/1000);
    const elapsedMinutes = Math.floor(elapsedSeconds/60);
    const elapsedHours = Math.floor(elapsedMinutes/60);
    const elapsedDays = Math.floor(elapsedHours/24);
    if (elapsedDays > 1) {
        return `${elapsedDays} days`;
    }
    if (elapsedHours > 25) {
        return `1 day and ${elapsedHours - 24} hours`;
    }
    if (elapsedMinutes >= 120) {
        return `${elapsedHours} hours`;
    }
    if (elapsedMinutes > 61) {
        return `1 hour and ${elapsedMinutes - 60} minutes`;
    }
    if (elapsedMinutes > 1) {
        return `${elapsedMinutes} minutes`;
    }
    if (elapsedSeconds > 1) {
        return `${elapsedSeconds} seconds`;
    }
    return `a second`;
}
