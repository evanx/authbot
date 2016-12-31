# telegrambot-auth

A service to enable web auth and login via Telegram bot.

## Implementation

The essence of the implementation is as follows:
```javascript
async function start() {
    sub.on('message', (channel, message) => {
        if (process.env.NODE_ENV !== 'production') {
            console.log({channel, message});
        }
        handleMessage(JSON.parse(message));
    });
    sub.subscribe(config.subscribeChannel);
    return startHttpServer();
}
```

We auth HTTP logins using Koa:
```javascript
async function startHttpServer() {
    api.post('/webhook/*', async ctx => {
        ctx.body = '';
        const id = ctx.params[0];
        if (id !== config.secret) {
            logger.debug('invalid', ctx.request.url);
        } else {
            await handleMessage(ctx.request.body);
        }
    });
    api.get('/login/:username/:token', async ctx => {
        await handleLogin(ctx);
    });
    api.get('/logout/:username', async ctx => {
        await handleLogout(ctx);
    });
    app.use(api.routes());
    app.use(async ctx => {
        ctx.status = 404;
    });
    state.server = app.listen(config.port);
}
```

## Config

The default configuration properties are hard-coded as follows:
```javascript
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
```

The following declares meta information about further required configuration:

```javascript
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
        required: false,
        description: 'Remote redis for incoming bot messages, especially for development',
        example: 'redis://localhost:6333',
        info: 'https://github.com/evanx/webhook-push'
    }
};
```

Our `config` is populated from environment variables as follows:
```javascript
const missingConfigs = [];
const config = Object.keys(configMeta)
.concat(Object.keys(configDefault))
.reduce((config, key) => {
    if (process.env[key]) {
        assert(process.env[key] !== '', key);
        config[key] = process.env[key];
    } else if (!configDefault[key] && configMeta[key].required !== false) {
        missingConfigs.push(key);
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
secret e.g. 'z7WnDUfuhtDCBjX54Ks5vB4SAdGmdzwRVlGQjWBt'
  "Telegram Bot secret"
    see https://core.telegram.org/bots/api#setwebhook
    see https://github.com/evanx/random-base56
token e.g. '243751977:AAH-WYXgsiZ8XqbzcqME7v6mUALxjktvrQc'
  "Telegram Bot token"
    see https://core.telegram.org/bots/api#authorizing-your-bot
    see https://telegram.me/BotFather
account e.g. 'evanxsummers'
  "Authoritative Telegram username"
    see https://telegram.org
telebotRedis e.g. 'redis://localhost:6333'
  "Remote redis for bot messages, especially for development"
    see https://github.com/evanx/webhook-push
```

Also it prints a `npm start` CLI using the `example` config properties:
```
domain='authdemo.webserva.com' \
secret='z7WnDUfuhtDCBjX54Ks5vB4SAdGmdzwRVlGQjWBt' \
token='243751977:AAH-WYXgsiZ8XqbzcqME7v6mUALxjktvrQc' \
account='evanxsummers' \
telebotRedis='redis://localhost:6333' \
npm start
```
where this help is generated from `configMeta`
```javascript
console.error('Example start:');
console.error([
    ...missingConfigs.map(key => {
        const meta = configMeta[key];
        return `${key}='${meta.example}' \\`;
    }),
    'npm start'
].join('\n'));
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

### Build application container

Let's build our application container:
```shell
docker build -t telegrambot-auth:test https://github.com/evanx/telegrambot-auth.git
```
where the image is named and tagged as `telegrambot-auth:test`

Notce that the default `Dockerfile` is as follows:
```
FROM mhart/alpine-node
ADD . .
RUN npm install
ENV port 80
EXPOSE 80
CMD ["node", "build/index.js"]
```

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
docker run --network=redis --name telegrambot-auth-test \
  -e NODE_ENV=test -e redisHost=$redisHost -e subscribeChannel=logger:mylogger -d telegrambot-auth:test
```
where we configure `redisHost` as the `redis-login` container.

Note that we:
- use the `redis` isolated network bridge for the `redis-login` container
- name this container `telegrambot-auth-test`
- use the previously built image `telegrambot-auth:test`

Get its IP address:
```
address=`
  docker inspect --format '{{ .NetworkSettings.Networks.redis.IPAddress }}' telegrambot-auth-test
`
```

Print and curl its URL:
```
echo "http://$address:8080"
curl -s $address:8080 | python -mjson.tool
```
