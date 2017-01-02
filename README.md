
# authbot

A Telegram bot for auth and login to a web domain.

- create an auth bot for your domain e.g. `@someDomainAuthBot` via command `/newbot` to `@BotFather`
- configure and deploy this auth bot service on your domain for location `/authbot`
- set the bot webhook via `api.telegram.org` to `/authbot`
- as a user, send the command `/login`
- your authbot will reply with a magic login link to itself e.g. `/authbot/in/${user}/${token}`
- the authbot HTTP handler will enroll the session in Redis
- the authbot will redirect e.g. `/auth` for your actual site, with the session cookie set
- your site can verify the session cookie via Redis and get the Telegram username and role
- the original authoritative (admin) Telegram username can authorise other users

![screenshot](https://raw.githubusercontent.com/evanx/authbot/master/docs/images/readme/ab01-bot.png)  
<hr>

This provides a relatively easy way to provide authentication and authorisation for any domain:
- no signup required, just use Telegram
- no email verification required, as you have the authentic Telegram username
- works great on mobile, use the Telegram app
- works great on desktop, use https://web.telegram.org
- minimal code required, just verify the session cookie via Redis

![screenshot](https://raw.githubusercontent.com/evanx/authbot/master/docs/images/readme/ab01-page-auth.png)
<hr>

![screenshot](https://raw.githubusercontent.com/evanx/authbot/master/docs/images/readme/ab01-mobile1.jpg)


## Implementation

We use Koa:
```javascript
async function startHttpServer() {
    api.post('/authbot/webhook/:secret', async ctx => {
        ctx.body = '';
        if (ctx.params.secret !== config.secret) {
            logger.debug('invalid', ctx.request.url);
        } else {
            await handleMessage(ctx.request.body);
        }
    });
    api.get('/authbot/in/:username/:token', async ctx => {
        await handleIn(ctx);
    });
    api.get('/authbot/logout', async ctx => {
        await handleOut(ctx);
    });
```

The `/authbot/in/` HTTP handler will set the session cookie:
```javascript
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
```

For demo purposes we also serve the following pages, which would ordinarily be served by the app:
```javascript
api.get('/', async ctx => {
    await handleHome(ctx);
});
api.get('/auth', async ctx => { // authentication succeeded
    await handleAuth(ctx);
});
api.get('/noauth', async ctx => { // authentication failed
    await handleNoAuth(ctx);
});
```
where `/auth` and `/noauth` are redirects from `/authbot/in`

The login is created in Redis by the Telegram bot, which provides the `/authbot/in/` "magic link."
```javascript
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
            `You can login via https://${[config.domain, 'authbot', 'in', username, token].join('/')}.`,
            `This link expires in ${config.loginExpire} seconds.`,
            `Powered by https://github.com/evanx/authbot.`
```
where a secret token is randomly generated for the "magic link."

## Config

The default configuration properties are hard-coded as follows:
```javascript
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
```
where `namespace` is used to prefix auth bot keys in Redis, for pending logins and active sessions.

The following declares meta information about further required configuration:

```javascript
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
    admin: {
        description: 'Authoritative Telegram username i.e. bootstrap admin user',
        example: 'evanxsummers',
        info: 'https://telegram.org'
    },
    hubRedis: {
        required: false,
        description: 'Remote redis for bot messages, especially for development',
        example: 'redis://localhost:6333',
        info: 'https://github.com/evanx/webhook-push'
    }
};
```

The `config` is populated from environment variables as follows:
```javascript
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
```
where we check that an environment variable is not empty, for safety sake.

## npm start

If we start the service with missing config via environment variables, the following help is printed:
```shell
domain e.g. 'authdemo.webserva.com'
  "HTTPS web domain to auth access"
bot e.g. 'ExAuthDemoBot'
  "Telegram Bot name i.e. this authbot"
    see https://core.telegram.org/bots/api
    see https://telegram.me/BotFather  
secret e.g. 'z7WnDUfuhtDCBjX54Ks5vB4SAdGmdzwRVlGQjWBt'
  "Telegram Bot secret"
    see https://core.telegram.org/bots/api#setwebhook
    see https://github.com/evanx/random-base56
token e.g. '243751977:AAH-WYXgsiZ8XqbzcqME7v6mUALxjktvrQc'
  "Telegram Bot token"
    see https://core.telegram.org/bots/api#authorizing-your-bot
    see https://telegram.me/BotFather
admin e.g. 'evanxsummers'
  "Authoritative Telegram username i.e. bootstrap admin user"
    see https://telegram.org
hubRedis e.g. 'redis://localhost:6333'
  "Remote hub for bot messages via Redis, especially for development"
    see https://github.com/evanx/webhook-push
```

Also it prints a `npm start` CLI using the `example` config properties:
```
domain='authdemo.webserva.com' \
bot='ExAuthDemoBot' \
secret='z7WnDUfuhtDCBjX54Ks5vB4SAdGmdzwRVlGQjWBt' \
token='243751977:AAH-WYXgsiZ8XqbzcqME7v6mUALxjktvrQc' \
admin='evanxsummers' \
hubRedis='redis://localhost:6333' \
npm start
```
where this help is generated from `configMeta`

## Build application container

Let's build our application container:
```shell
docker build -t authbot:test https://github.com/evanx/authbot.git
```
where the image is named and tagged as `authbot:test`

Notice that the default `Dockerfile` is as follows:
```
FROM mhart/alpine-node
ADD package.json .
RUN npm install
ADD index.js .
ENV port 8080
EXPOSE 8080
CMD ["node", "--harmony-async-await", "index.js"]
```

## Docker run

`npm start` with missing configs will print help including for Docker run, which you must edit for your environment
i.e. with your own domain, username, bot name, token, secret etc:
```javascript
  docker run \
    --name authbot-test -d \
    --network host \
    -e NODE_ENV=test \
    -e domain='' \
    -e bot='' \
    -e secret='' \
    -e token='' \
    -e admin='evanxsummers' \
    authbot:test
```

## Docker notes

This tested on Docker 1.12 (Ubuntu 16.04) and 1.11 (Amazon Linux 2016.09)
```
docker -v
```
- `Docker version 1.12.1, build 23cf638`
- `Docker version 1.11.2, build b9f10c9/1.11.2`

```
cat /etc/issue
```
- `Ubuntu 16.04.1 LTS`
- `Amazon Linux AMI release 2016.09`


## Isolated Redis container and network

In this example we create an isolated network:
```shell
docker network create --driver bridge redis
```

We can create a Redis container named `redis-login` as follows
```shell
docker run --network=redis --name redis-login -d redis
```

We query its IP number and store in shell environment variable `redisHost`
```
redisHost=`docker inspect --format '{{ .NetworkSettings.Networks.redis.IPAddress }}' redis-login`
echo $loggerHost
```
which we check that set e.g. to `172.18.0.2`

Finally we run our service container:
```shell
docker run --network=redis --name authbot-test -d -p 8080 \
  -e NODE_ENV=test \
  -e redisHost=$redisHost \
  -e domain='' \
  -e bot='' \
  -e secret='' \
  -e token='' \
  -e admin='' \  
  authbot:test
```
where we configure `redisHost` as the `redis-login` container.

Note that we:
- use the `redis` isolated network bridge for the `redis-login` container
- name this container `authbot-test`
- use the previously built image `authbot:test`

Get its IP address:
```
address=`
  docker inspect --format '{{ .NetworkSettings.Networks.redis.IPAddress }}' authbot-test
`
```
