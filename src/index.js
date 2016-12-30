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
    namespace: 'tb-login',
    telebotRedis: 'redis://localhost:6333',
    redisHost: '127.0.0.1'
});

const state = {
};

const redis = require('redis');
const sub = redis.createClient(config.telebotRedis);
const client = redis.createClient(6379, config.redisHost);

assert(process.env.NODE_ENV);

async function multiExecAsync(client, multiFunction) {
    const multi = client.multi();
    multiFunction(multi);
    return Promise.promisify(multi.exec).call(multi);
}

(async function() {
    state.started = Math.floor(Date.now()/1000);
    state.pid = process.pid;
    console.log('start', {config, state});
    if (process.env.NODE_ENV === 'development') {
        return startDevelopment();
    } else if (process.env.NODE_ENV === 'test') {
        return startTest();
    } else {
        return startProduction();
    }
}());

async function startTest() {
    return startProduction();
}

async function startDevelopment() {
    return startProduction();
}

async function startProduction() {
    sub.on('message', (channel, message) => {
        if (process.env.NODE_ENV !== 'production') {
            console.log({channel, message});
        }
    });
    sub.subscribe('telebot:' + config.secret);
    return startHttpServer();
}

async function startHttpServer() {
    api.get('/webhook', async ctx => {
    	ctx.body = ctx.params;
    });
    api.get('/login', async ctx => {
    	ctx.body = ctx.params;
    });
    app.use(api.routes());
    app.use(async ctx => {
        ctx.statusCode = 404;
    });
    state.server = app.listen(config.port);
}

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

async function end() {
    sub.quit();
}

