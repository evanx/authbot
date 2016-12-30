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
        return startProduction();
    });

    return function startTest() {
        return _ref3.apply(this, arguments);
    };
})();

let startDevelopment = (() => {
    var _ref4 = _asyncToGenerator(function* () {
        return startProduction();
    });

    return function startDevelopment() {
        return _ref4.apply(this, arguments);
    };
})();

let startProduction = (() => {
    var _ref5 = _asyncToGenerator(function* () {
        sub.on('message', function (channel, message) {
            if (process.env.NODE_ENV !== 'production') {
                console.log({ channel, message });
            }
        });
        sub.subscribe('telebot:' + config.secret);
        return startHttpServer();
    });

    return function startProduction() {
        return _ref5.apply(this, arguments);
    };
})();

let startHttpServer = (() => {
    var _ref6 = _asyncToGenerator(function* () {
        api.get('/webhook', (() => {
            var _ref7 = _asyncToGenerator(function* (ctx) {
                ctx.body = ctx.params;
            });

            return function (_x3) {
                return _ref7.apply(this, arguments);
            };
        })());
        api.get('/login', (() => {
            var _ref8 = _asyncToGenerator(function* (ctx) {
                ctx.body = ctx.params;
            });

            return function (_x4) {
                return _ref8.apply(this, arguments);
            };
        })());
        app.use(api.routes());
        app.use((() => {
            var _ref9 = _asyncToGenerator(function* (ctx) {
                ctx.statusCode = 404;
            });

            return function (_x5) {
                return _ref9.apply(this, arguments);
            };
        })());
        state.server = app.listen(config.port);
    });

    return function startHttpServer() {
        return _ref6.apply(this, arguments);
    };
})();

/*
async handleTelegramLogin(request) {
   const now = Millis.now();
   this.logger.info('handleTelegramLogin', request);
   const match = request.text.match(/\/login$/);
   if (!match) {
      await this.sendTelegram(request.chatId, 'html', [
         `Try <code>/login</code>`
      ]);
      return;
   }
   const account = request.username;
   const role = 'admin';
   const id = 'admin';
   const token = this.generateTokenKey().toLowerCase();
   const loginKey = this.adminKey('login', token);
   this.logger.info('handleTelegramLogin', loginKey, token, request);
   let [hmset] = await this.redis.multiExecAsync(multi => {
      this.logger.info('handleTelegramLogin hmset', loginKey, this.config.loginExpire);
      multi.hmset(loginKey, {account, role, id});
      multi.expire(loginKey, this.config.loginExpire);
   });
   if (hmset) {
      await this.sendTelegramReply(request, 'html', [
         `You can login via https://${[this.config.openHostname, 'login', account, role, id, token].join('/')}.`,
         `This must be done in the next ${Millis.formatVerboseDuration(1000*this.config.loginExpire)}`,
         `otherwise you need to repeat this request, after it expires.`
      ]);
   } else {
      await this.sendTelegramReply(request, 'html', [
         `Apologies, the login command failed.`,
      ]);
   }
}
*/

let end = (() => {
    var _ref10 = _asyncToGenerator(function* () {
        sub.quit();
    });

    return function end() {
        return _ref10.apply(this, arguments);
    };
})();

function _asyncToGenerator(fn) { return function () { var gen = fn.apply(this, arguments); return new Promise(function (resolve, reject) { function step(key, arg) { try { var info = gen[key](arg); var value = info.value; } catch (error) { reject(error); return; } if (info.done) { resolve(value); } else { return Promise.resolve(value).then(function (value) { step("next", value); }, function (err) { step("throw", err); }); } } return step("next"); }); }; }

const assert = require('assert');
const lodash = require('lodash');
const Promise = require('bluebird');
const Koa = require('koa');
const KoaRouter = require('koa-router');
const bodyParser = require('koa-bodyparser');

const app = new Koa();
const api = KoaRouter();

const config = ['namespace', 'secret', 'token', 'username', 'telebotRedis'].reduce((config, key) => {
    if (process.env[key] === '') {
        throw new Error('empty config ' + key);
    } else if (process.env[key]) {
        config[key] = process.env[key];
    } else if (!config[key]) {
        throw new Error('missing config ' + key);
    }
    return config;
}, {
    namespace: 'telegrambot-login',
    redisHost: '127.0.0.1'
});

const state = {};

const redis = require('redis');
const sub = redis.createClient(config.telebotRedis);
const client = redis.createClient(6379, config.redisHost);

assert(process.env.NODE_ENV);

_asyncToGenerator(function* () {
    state.started = Math.floor(Date.now() / 1000);
    state.pid = process.pid;
    console.log('start', { config, state });
    if (process.env.NODE_ENV === 'development') {
        return startDevelopment();
    } else if (process.env.NODE_ENV === 'test') {
        return startTest();
    } else {
        return startProduction();
    }
})();
