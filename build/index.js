let multiExecAsync = (() => {
    var _ref = _asyncToGenerator(function* (client, multiFunction) {
        const multi = client.multi();
        multiFunction(multi);
        return Promise.promisify(multi.exec).call(multi);
    });

    return function multiExecAsync(_x, _x2) {
        return _ref.apply(this, arguments);
    };
})();

let startTest = (() => {
    var _ref3 = _asyncToGenerator(function* () {
        return start();
    });

    return function startTest() {
        return _ref3.apply(this, arguments);
    };
})();

let startDevelopment = (() => {
    var _ref4 = _asyncToGenerator(function* () {
        return start();
    });

    return function startDevelopment() {
        return _ref4.apply(this, arguments);
    };
})();

let startProduction = (() => {
    var _ref5 = _asyncToGenerator(function* () {
        return start();
    });

    return function startProduction() {
        return _ref5.apply(this, arguments);
    };
})();

let start = (() => {
    var _ref6 = _asyncToGenerator(function* () {
        sub.on('message', function (channel, message) {
            logger.debug({ channel, message });
            handleMessage(JSON.parse(message));
        });
        sub.subscribe('telebot:' + config.secret);
        return startHttpServer();
    });

    return function start() {
        return _ref6.apply(this, arguments);
    };
})();

let startHttpServer = (() => {
    var _ref7 = _asyncToGenerator(function* () {
        api.post('/webhook/*', (() => {
            var _ref8 = _asyncToGenerator(function* (ctx) {
                ctx.body = '';
                const id = ctx.params[0];
                if (id !== config.secret) {
                    logger.debug('invalid', ctx.request.url);
                } else {
                    yield handleMessage(ctx.request.body);
                }
            });

            return function (_x3) {
                return _ref8.apply(this, arguments);
            };
        })());
        api.get('/login/:username/:token', (() => {
            var _ref9 = _asyncToGenerator(function* (ctx) {
                yield handleLogin(ctx);
            });

            return function (_x4) {
                return _ref9.apply(this, arguments);
            };
        })());
        api.get('/logout/:username', (() => {
            var _ref10 = _asyncToGenerator(function* (ctx) {
                yield handleLogout(ctx);
            });

            return function (_x5) {
                return _ref10.apply(this, arguments);
            };
        })());
        app.use(api.routes());
        app.use((() => {
            var _ref11 = _asyncToGenerator(function* (ctx) {
                ctx.status = 404;
            });

            return function (_x6) {
                return _ref11.apply(this, arguments);
            };
        })());
        state.server = app.listen(config.port);
    });

    return function startHttpServer() {
        return _ref7.apply(this, arguments);
    };
})();

let handleLogout = (() => {
    var _ref12 = _asyncToGenerator(function* (ctx) {});

    return function handleLogout(_x7) {
        return _ref12.apply(this, arguments);
    };
})();

let handleLogin = (() => {
    var _ref13 = _asyncToGenerator(function* (ctx) {
        const ua = ctx.get('User-Agent');
        logger.debug('handleLogin', ua);
        if (ua.startsWith('TelegramBot')) {
            ctx.status = 403;
            return;
        }
        const { username, token } = ctx.params;
        const loginKey = [config.namespace, 'login', token].join(':');
        const [hgetall] = yield multiExecAsync(client, function (multi) {
            multi.hgetall(loginKey);
        });
        logger.debug('login', ua, loginKey, hgetall);
        if (!hgetall) {
            ctx.status = 403;
            ctx.redirect(state.redirectNoAuth);
            return;
        }
        assert.equal(hgetall.username, username, 'id');
        const sessionId = [token, generateToken(16)].join('_');
        const sessionRedisKey = [config.namespace, 'session', sessionId].join(':');
        const [hmset] = yield multiExecAsync(client, function (multi) {
            multi.hmset(sessionRedisKey, { username });
            multi.expire(sessionRedisKey, config.sessionExpire);
            multi.del(loginKey);
        });
        ctx.cookie('sessionId', sessionId, { maxAge: config.cookieExpire, domain: config.domain });
        ctx.redirect(config.redirectAuth);
    });

    return function handleLogin(_x8) {
        return _ref13.apply(this, arguments);
    };
})();

let handleMessage = (() => {
    var _ref14 = _asyncToGenerator(function* (message) {
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
    });

    return function handleMessage(_x9) {
        return _ref14.apply(this, arguments);
    };
})();

let handleTelegramLogin = (() => {
    var _ref15 = _asyncToGenerator(function* (request) {
        const match = request.text.match(/\/login$/);
        if (!match) {
            yield sendTelegram(request.chatId, 'html', [`Try <code>/login</code>`]);
            return;
        }
        const username = request.username;
        const token = generateToken(8);
        const loginKey = [config.namespace, 'login', token].join(':');
        let [hmset] = yield multiExecAsync(client, function (multi) {
            multi.hmset(loginKey, { username });
            multi.expire(loginKey, config.loginExpire);
        });
        if (hmset) {
            yield sendTelegramReply(request, 'html', [`You can login via https://${ [config.domain, 'login', username, token].join('/') }.`, `This login expires in ${ config.loginExpire } seconds`]);
        } else {
            yield sendTelegramReply(request, 'html', [`Apologies, the login command failed.`]);
        }
    });

    return function handleTelegramLogin(_x10) {
        return _ref15.apply(this, arguments);
    };
})();

let sendTelegramReply = (() => {
    var _ref16 = _asyncToGenerator(function* (request, format, ...content) {
        if (request.chatId && request.name) {
            yield sendTelegram(request.chatId, format, `Thanks, ${ request.name }.`, ...content);
        } else {
            logger.error('sendTelegramReply', request);
        }
    });

    return function sendTelegramReply(_x11, _x12) {
        return _ref16.apply(this, arguments);
    };
})();

let sendTelegram = (() => {
    var _ref17 = _asyncToGenerator(function* (chatId, format, ...content) {
        logger.debug('sendTelegram', chatId, format, content);
        try {
            const text = lodash.trim(lodash.flatten(content).join(' '));
            assert(chatId, 'chatId');
            let uri = `sendMessage?chat_id=${ chatId }`;
            uri += '&disable_notification=true';
            if (format === 'markdown') {
                uri += `&parse_mode=Markdown`;
            } else if (format === 'html') {
                uri += `&parse_mode=HTML`;
            }
            uri += `&text=${ encodeURIComponent(text) }`;
            const url = [state.botUrl, uri].join('/');
            logger.info('sendTelegram url', url, chatId, format, text);
            const res = yield fetch(url, { timeout: config.sendTimeout });
            if (res.status !== 200) {
                logger.warn('sendTelegram', chatId, url);
            }
        } catch (err) {
            logger.error(err);
        }
    });

    return function sendTelegram(_x13, _x14) {
        return _ref17.apply(this, arguments);
    };
})();

let end = (() => {
    var _ref18 = _asyncToGenerator(function* () {
        sub.quit();
    });

    return function end() {
        return _ref18.apply(this, arguments);
    };
})();

function _asyncToGenerator(fn) { return function () { var gen = fn.apply(this, arguments); return new Promise(function (resolve, reject) { function step(key, arg) { try { var info = gen[key](arg); var value = info.value; } catch (error) { reject(error); return; } if (info.done) { resolve(value); } else { return Promise.resolve(value).then(function (value) { step("next", value); }, function (err) { step("throw", err); }); } } return step("next"); }); }; }

const assert = require('assert');
const base32 = require('thirty-two');
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
    namespace: 'telegrambot-auth',
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
        description: 'Authoritative Telegram username',
        example: 'evanxsummers',
        info: 'https://telegram.org'
    },
    telebotRedis: {
        description: 'Remote redis for bot messages, especially for development',
        example: 'redis://localhost:6333',
        info: 'https://github.com/evanx/webhook-push'
    }
};

const missingConfigs = [];
const config = Object.keys(configMeta).concat(Object.keys(configDefault)).reduce((config, key) => {
    if (process.env[key]) {
        assert(process.env[key] !== '', key);
        config[key] = process.env[key];
    } else if (!configDefault[key] && configMeta[key].required !== false) {
        missingConfigs.push(key);
    }
    return config;
}, configDefault);
if (missingConfigs.length) {
    console.error(`Missing configs:`);
    console.error(lodash.flatten(missingConfigs.map(key => {
        const meta = configMeta[key];
        const lines = [`  ${ key } e.g. '${ meta.example }'`];
        if (meta.description) {
            lines.push(`    "${ meta.description }"`);
        }
        if (meta.info) {
            lines.push(`      see ${ meta.info }`);
        }
        if (meta.hint) {
            lines.push(`      see ${ meta.hint }`);
        }
        return lines;
    })).join('\n'));
    console.error('\nExample start:');
    console.error([...missingConfigs.map(key => {
        const meta = configMeta[key];
        return `${ key }='${ meta.example }' \\`;
    }), 'npm start'].join('\n'));
    console.error('\nExample Docker run:');
    console.error([`docker run -d -t ${ config.namespace }:test \\`, ...missingConfigs.map(key => {
        const meta = configMeta[key];
        return `  -e ${ key }='${ meta.example }' \\`;
    }), `  ${ config.namespace }-test`].join('\n'));
    process.exit(1);
}

logger.level = config.loggerLevel;

const state = {
    redirectNoAuth: process.env.redirectNoAuth || `https://telegram.me/${ config.name }`,
    botUrl: `https://api.telegram.org/bot${ config.token }`
};

const redis = require('redis');
const sub = redis.createClient(config.telebotRedis);
const client = redis.createClient(6379, config.redisHost);

assert(process.env.NODE_ENV);

function generateToken(length = 16) {
    const Letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const Symbols = Letters + Letters.toLowerCase() + '0123456789';
    return lodash.reduce(crypto.randomBytes(length), (result, value) => {
        return result + Symbols[Math.floor(value * Symbols.length / 256)];
    }, '');
}

_asyncToGenerator(function* () {
    state.started = Math.floor(Date.now() / 1000);
    state.pid = process.pid;
    logger.info('start', { config, state });
    if (process.env.NODE_ENV === 'development') {
        return startDevelopment();
    } else if (process.env.NODE_ENV === 'test') {
        return startTest();
    } else {
        return startProduction();
    }
})();
