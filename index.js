const assert = require('assert');
const crypto = require('crypto');
const fetch = require('node-fetch');
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
    loggerLevel: 'debug'
};

const configMeta = {
    domain: {
        description: 'HTTPS web domain to auth access',
        example: 'authdemo.webserva.com'
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
    account: {
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
if (missingConfigKeys.length) {
    const sp = Array(3).join(' ');
    console.error(`Missing configs:`);
    console.error(lodash.flatten(missingConfigKeys.map(key => {
        const meta = configMeta[key];
        const lines = [`${sp}${key} e.g. '${meta.example}'`];
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
    })).join('\n'));
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
    process.exit(1);
}

logger.level = config.loggerLevel;

state.redirectNoAuth = process.env.redirectNoAuth || `https://telegram.me/${config.bot}`;
state.botUrl = `https://api.telegram.org/bot${config.token}`;

if (configFile && process.env.NODE_ENV === 'development') {
    [
        `https://${configFile.hubDomain}/webhook/${config.secret}`,
        `https://${config.domain}/authbot/webhook/${config.secret}`
    ].forEach(webhookUrl => {
        const apiUrl = `${state.botUrl}/setWebhook?url=${encodeURI(webhookUrl)}`;
        console.log(`curl -s '${apiUrl}' | jq '.'`);
    });
    console.log(`\nssh -L${configFile.hubLocalPort}:127.0.0.1:6379 ${configFile.hubHost}`);
    const subscribeChannel = [configFile.hubNamespace, config.secret].join(':');
    console.log(`\nredis-cli -p ${configFile.hubLocalPort} subscribe "${subscribeChannel}"\n`);
    console.log([
        ...Object.keys(config).map(key => `${key}=${config[key]}`),
        'npm run development'
    ].join(' '));
    console.log([
        `Bot commands:`,
        ``,
        `in - login to https://${config.domain}`,
        `out - logout`,
        `grant - [username role] grant role to user`,
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
    return crypto.randomBytes(length).map(value => charset.charCodeAt(Math.floor(value * charset.length / 256))).toString();
}

(async function() {
    state.started = Math.floor(Date.now()/1000);
    state.pid = process.pid;
    logger.info('start', JSON.stringify({config, state}, null, 2));
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
    if (config.hubRedis) {
        assert(config.hubNamespace, 'hubNamespace');
        state.sub = redis.createClient(config.hubRedis);
        state.sub.on('message', (channel, message) => {
            logger.debug({channel, message});
            handleMessage(JSON.parse(message));
        });
        state.sub.subscribe([config.hubNamespace, config.secret].join(':'));
    }
    return startHttpServer();
}

async function startHttpServer() {
    api.post('/authbot/webhook/:secret', async ctx => {
        ctx.body = '';
        if (ctx.params.secret !== config.secret) {
            logger.debug('invalid', ctx.request.url);
        } else {
            logger.debug('webhook', typeof ctx.request.body, ctx.request.body);
            await handleMessage(ctx.request.body);
        }
    });
    api.get('/authbot/in/:username/:token', async ctx => {
        await handleLogin(ctx);
    });
    api.get('/authbot/logout', async ctx => {
        await handleLogout(ctx);
    });
    api.get('/auth', async ctx => {
        await handleAuth(ctx);
    });
    api.get('/noauth', async ctx => {
        await handleNoAuth(ctx);
    });
    api.get('/', async ctx => {
        await handleHome(ctx);
    });
    app.use(bodyParser());
    app.use(api.routes());
    app.use(async ctx => {
        ctx.status = 404;
    });
    state.server = app.listen(config.port);
}

async function handleHome(ctx) {
    const name = ctx.cookies.get('sessionId');
    ctx.body = [
        `<html>`,
        `<head>`,
        `  <title>AuthBot Demo</title>`,
        `</head>`,
        `<body>`,
        `<h1>Welcome</h1>`,
        `<p><a href='https://telegram.me/${config.bot}'>Use https://telegram.me/${config.bot} to login</a></p>`,
        `</body>`,
        `</html>`
    ].join('\n');
}

async function handleAuth(ctx) {
    const name = ctx.cookies.get('sessionId');
    ctx.body = [
        `<html>`,
        `<head>`,
        `  <title>AuthBot Demo</title>`,
        `</head>`,
        `<body>`,
        `<h1>Hello ${name}</h1>`,
        `</body>`,
        `</html>`
    ].join('\n');
}

async function handleNoAuth(ctx) {
    ctx.body = [
        `<html>`,
        `<head>`,
        `  <title>AuthBot Demo</title>`,
        `</head>`,
        `<body>`,
        `<h1>No Auth</h1>`,
        `</body>`,
        `</html>`
    ].join('\n');
}

async function handleLogout(ctx) {
    const sessionId = ctx.cookies.get('sessionId');
    if (sessionId) {
        const sessionKey = [config.namespace, 'session', sessionId].join(':');
        const [session] = await multiExecAsync(client, multi => {
            multi.hgetall(sessionKey);
            multi.del(sessionKey);
        });
        if (session && session.username) {
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
    const loginKey = [config.namespace, 'login', username].join(':');
    const [login] = await multiExecAsync(client, multi => {
        multi.hgetall(loginKey);
    });
    logger.debug('handleLogin', ua, loginKey, login);
    if (!login) {
        const sessionId = ctx.cookies.get('sessionId', sessionId);
        if (sessionId) {
            logger.debug('handleLogin', {sessionId}, state.redirectNoAuth);
        }
        ctx.status = 403;
        ctx.redirect(state.redirectNoAuth);
        return;
    }
    assert.equal(login.username, username, 'username');
    const sessionId = [token, generateToken(16)].join('_');
    const sessionKey = [config.namespace, 'session', sessionId].join(':');
    const [hmset] = await multiExecAsync(client, multi => {
        multi.hmset(sessionKey, {username});
        multi.expire(sessionKey, config.sessionExpire);
        multi.del(loginKey);
    });
    ctx.cookies.set('sessionId', sessionId, {maxAge: config.cookieExpire, domain: config.domain, path: '/'});
    ctx.redirect(config.redirectAuth);
}

async function handleMessage(message) {
    const from = message.message.from;
    const request = {
        chatId: message.message.chat.id,
        username: from.username,
        name: from.first_name || from.username,
        text: message.message.text,
        timestamp: message.message.date
    };
    logger.debug('webhook', request, message.message);
    handleTelegramLogin(request);
}

async function handleTelegramLogin(request) {
    const match = request.text.match(/\/in$/);
    if (!match) {
        await sendTelegram(request.chatId, 'html', [
            `Try <code>/in</code>`
        ]);
        return;
    }
    const {username, name, chatId} = request;
    const token = generateToken(10);
    const loginKey = [config.namespace, 'login', username].join(':');
    let [hmset] = await multiExecAsync(client, multi => {
        multi.hmset(loginKey, {token, username, name, chatId});
        multi.expire(loginKey, config.loginExpire);
    });
    if (hmset) {
        await sendTelegramReply(request, 'html', [
            `You can login via https://${[config.domain, 'authbot', 'in', username, token].join('/')}.`,
            `This link expires in ${config.loginExpire} seconds.`
        ]);
    } else {
        await sendTelegramReply(request, 'html', [
            `Apologies, the login command failed.`,
        ]);
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
    if (state.sub) {
        state.sub.quit();
    }
}
