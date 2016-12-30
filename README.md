# telegrambot-login

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
```

Note that `config` is populated from environment variables as follows:
```javascript
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
```
where we default `redisHost` to `localhost`

Note that we check that an environment variable is not empty, for safety sake.

For example we start this service:
```shell
port=8888 secret=my-bot-secret token=my-bot-token npm start
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
docker build -t telegrambot-login:test https://github.com/evanx/telegrambot-login.git
```
where the image is named and tagged as `telegrambot-login:test`

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
docker run --network=redis --name telegrambot-login-test \
  -e NODE_ENV=test -e redisHost=$redisHost -e subscribeChannel=logger:mylogger -d telegrambot-login:test
```
where we configure `redisHost` as the `redis-login` container.

Note that we:
- use the `redis` isolated network bridge for the `redis-login` container
- name this container `telegrambot-login-test`
- use the previously built image `telegrambot-login:test`

Get its IP address:
```
address=`
  docker inspect --format '{{ .NetworkSettings.Networks.redis.IPAddress }}' telegrambot-login-test
`
```

Print and curl its URL:
```
echo "http://$address:8080"
curl -s $address:8080 | python -mjson.tool
```
